import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { copyFile, cp, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { create } from "tar";
import { afterEach, describe, expect, it } from "vitest";
import type { DesktopChannel } from "../packages/desktop/src/desktop-channel.js";
import {
  type EngineManifest,
  getEngineManifestSigningPayload,
} from "../packages/desktop/src/engine-manifest.js";
import type { RuntimeManifestV2 } from "../packages/desktop/src/runtime-manifest.js";
import { canonicalSigningPayload } from "../packages/desktop/src/signed-json.js";
import {
  type DesktopReleaseComponent,
  parseDesktopReleaseCommand,
  parseUpdaterMetadata,
  validateDesktopReleaseArtifacts,
} from "./desktop-release-artifacts.js";

const roots: string[] = [];
const publishedAt = "2026-08-08T01:02:03.000Z";

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function hashEntry(path: string) {
  const bytes = await readFile(path);
  return { sha256: createHash("sha256").update(bytes).digest("hex"), size: bytes.byteLength };
}

async function createCompleteReleaseFixture() {
  const root = await mkdtemp(join(tmpdir(), "coder-studio-release-test-"));
  roots.push(root);
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const publicKeyPem = publicKey.export({ type: "spki", format: "pem" }).toString();
  const installerName = "Coder-Studio-Setup-0.3.0.exe";
  const installer = Buffer.from("signed-installer");
  const installerSha = createHash("sha512").update(installer).digest("base64");
  await Promise.all([
    writeFile(join(root, installerName), installer),
    writeFile(join(root, `${installerName}.blockmap`), "blockmap"),
    writeFile(
      join(root, "latest.yml"),
      [
        "version: 0.3.0",
        "files:",
        `  - url: ${installerName}`,
        `    sha512: ${installerSha}`,
        `    size: ${installer.byteLength}`,
        `path: ${installerName}`,
        `sha512: ${installerSha}`,
      ].join("\n")
    ),
    writeFile(
      join(root, "build-info.json"),
      JSON.stringify({
        schemaVersion: 1,
        shellVersion: "0.3.0",
        builtAt: "2026-08-08T00:50:00.000Z",
        publishedAt,
        engineVersion: "2",
        nodeVersion: "24.19.0",
        runtimeHostApiVersion: 1,
        apiProtocolVersion: 1,
        dataSchemaVersion: 1,
      })
    ),
  ]);

  async function writeRuntime(
    target: "win32-x64" | "linux-x64",
    overrides: Partial<RuntimeManifestV2> = {},
    validSignature = true
  ) {
    const platform = target === "win32-x64" ? "win32" : "linux";
    const manifestName =
      target === "win32-x64"
        ? "coder-studio-runtime-win32-x64.manifest.json"
        : "coder-studio-server-runtime-linux-x64.manifest.json";
    const packageFile =
      target === "win32-x64"
        ? "coder-studio-runtime-0.6.0-win32-x64.tgz"
        : "coder-studio-server-runtime-0.6.0-linux-x64.tgz";
    const staging = await mkdtemp(join(tmpdir(), "coder-studio-runtime-fixture-"));
    roots.push(staging);
    await writeFile(join(staging, "server.mjs"), `export const target = "${target}";\n`);
    if (target === "win32-x64") {
      await mkdir(join(staging, "web"));
      await writeFile(join(staging, "web/index.html"), "<main>Coder Studio</main>\n");
    }
    const files = [
      { path: "server.mjs", ...(await hashEntry(join(staging, "server.mjs"))) },
      ...(target === "win32-x64"
        ? [{ path: "web/index.html", ...(await hashEntry(join(staging, "web/index.html"))) }]
        : []),
    ];
    const unsigned: RuntimeManifestV2 = {
      schemaVersion: 2,
      publishedAt,
      runtimeVersion: "0.6.0",
      minShellVersion: "0.3.0",
      requiredEngineVersion: "2",
      requiredNodeVersion: "24.19.0",
      runtimeHostApiVersion: 1,
      apiProtocolVersion: 1,
      dataSchemaVersion: 1,
      platform,
      arch: "x64",
      entrypoint: "server.mjs",
      ...(target === "win32-x64" ? { webRoot: "web" } : {}),
      packageFile,
      files,
      ...overrides,
    };
    const manifest: RuntimeManifestV2 = {
      ...unsigned,
      signature: {
        algorithm: "ed25519",
        value: sign(null, canonicalSigningPayload(unsigned), privateKey).toString("base64"),
      },
    };
    if (!validSignature) manifest.runtimeVersion = "0.6.1";
    await writeFile(join(staging, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
    await create(
      { cwd: staging, file: join(root, packageFile), gzip: true, portable: true },
      target === "win32-x64"
        ? ["manifest.json", "server.mjs", "web"]
        : ["manifest.json", "server.mjs"]
    );
    await writeFile(join(root, manifestName), `${JSON.stringify(manifest, null, 2)}\n`);
    return manifest;
  }

  async function writeEngine(overrides: Partial<EngineManifest> = {}) {
    const staging = await mkdtemp(join(tmpdir(), "coder-studio-engine-fixture-"));
    roots.push(staging);
    await mkdir(join(staging, "bin"));
    await writeFile(join(staging, "bin/node"), "node-runtime\n");
    const packageFile = "coder-studio-engine-2-linux-x64.tgz";
    await create({ cwd: staging, file: join(root, packageFile), gzip: true, portable: true }, [
      "bin",
    ]);
    const packageBytes = await readFile(join(root, packageFile));
    const unsigned: EngineManifest = {
      schemaVersion: 1,
      engineVersion: "2",
      nodeVersion: "24.19.0",
      platform: "linux",
      arch: "x64",
      libc: "glibc",
      packageFile,
      packageSha256: createHash("sha256").update(packageBytes).digest("hex"),
      packageSize: packageBytes.byteLength,
      files: [{ path: "bin/node", ...(await hashEntry(join(staging, "bin/node"))) }],
      ...overrides,
    };
    const manifest: EngineManifest = {
      ...unsigned,
      signature: {
        algorithm: "ed25519",
        value: sign(null, getEngineManifestSigningPayload(unsigned), privateKey).toString("base64"),
      },
    };
    await writeFile(
      join(root, "coder-studio-engine-linux-x64.manifest.json"),
      `${JSON.stringify(manifest, null, 2)}\n`
    );
    return manifest;
  }

  async function writeChannel(
    overrides: Partial<DesktopChannel> = {},
    validSignature = true,
    filename = "desktop-channel.json"
  ) {
    const unsigned: Omit<DesktopChannel, "signature"> = {
      schemaVersion: 1,
      channel: "stable",
      releaseTag: "desktop-v0.3.0",
      generatedAt: publishedAt,
      shell: {
        version: "0.3.0",
        publishedAt,
        updaterMetadata: "latest.yml",
        engineVersion: "2",
        nodeVersion: "24.19.0",
        runtimeHostApiVersion: 1,
        apiProtocolVersion: 1,
        dataSchemaVersion: 1,
      },
      runtimes: {
        "win32-x64": {
          version: "0.6.0",
          publishedAt,
          manifest: "coder-studio-runtime-win32-x64.manifest.json",
        },
        "linux-x64": {
          version: "0.6.0",
          publishedAt,
          manifest: "coder-studio-server-runtime-linux-x64.manifest.json",
        },
      },
      ...overrides,
    };
    const channel: DesktopChannel = {
      ...unsigned,
      signature: {
        algorithm: "ed25519",
        value: sign(null, canonicalSigningPayload(unsigned), privateKey).toString("base64"),
      },
    };
    if (!validSignature) channel.releaseTag = "tampered-channel";
    await writeFile(join(root, filename), `${JSON.stringify(channel, null, 2)}\n`);
  }

  await writeRuntime("win32-x64");
  await writeRuntime("linux-x64");
  await writeEngine();
  await writeChannel();
  const options = {
    directory: root,
    components: [
      "desktop",
      "win-runtime",
      "wsl-engine",
      "wsl-runtime",
    ] as DesktopReleaseComponent[],
    allowUnsigned: false,
    publicKeyPem,
    releaseKind: "full" as const,
  };
  return { root, options, writeRuntime, writeEngine, writeChannel };
}

describe("desktop-release-artifacts", () => {
  it("parses deterministic staging and validation commands", () => {
    expect(
      parseDesktopReleaseCommand([
        "stage",
        "--directory",
        "release/desktop-release-windows",
        "--components",
        "desktop win-runtime desktop",
      ])
    ).toEqual({
      action: "stage",
      directory: resolve("release/desktop-release-windows"),
      components: ["desktop", "win-runtime"],
    });
    expect(
      parseDesktopReleaseCommand([
        "validate",
        "--directory",
        "release/desktop-release-linux",
        "--components",
        "wsl-engine,wsl-runtime",
        "--allow-unsigned",
      ])
    ).toMatchObject({
      action: "validate",
      directory: resolve("release/desktop-release-linux"),
      components: ["wsl-engine", "wsl-runtime"],
      allowUnsigned: true,
    });
    expect(
      parseDesktopReleaseCommand([
        "validate",
        "--directory",
        "release/desktop-migration",
        "--components",
        "desktop,win-runtime,wsl-engine,wsl-runtime",
        "--release-kind",
        "migration",
        "--allow-resigned-engine",
      ])
    ).toMatchObject({ releaseKind: "migration", allowResignedEngine: true });
  });

  it("reads electron-updater metadata and rejects unsafe installer paths", () => {
    expect(
      parseUpdaterMetadata(
        [
          "version: 0.1.0",
          "files:",
          '  - url: "Coder-Studio-Setup-0.1.0.exe"',
          `    sha512: ${Buffer.alloc(64, 7).toString("base64")}`,
          "    size: 1024",
          'path: "Coder-Studio-Setup-0.1.0.exe"',
          `sha512: ${Buffer.alloc(64, 7).toString("base64")}`,
        ].join("\n")
      )
    ).toEqual({
      version: "0.1.0",
      path: "Coder-Studio-Setup-0.1.0.exe",
      sha512: Buffer.alloc(64, 7).toString("base64"),
      size: 1024,
    });
    expect(() =>
      parseUpdaterMetadata(
        [
          "version: 0.1.0",
          "files:",
          "  - url: ../setup.exe",
          `    sha512: ${Buffer.alloc(64).toString("base64")}`,
          "    size: 1024",
          "path: ../setup.exe",
          `sha512: ${Buffer.alloc(64).toString("base64")}`,
        ].join("\n")
      )
    ).toThrow("invalid version or path");
    expect(() =>
      parseUpdaterMetadata(
        [
          "version: 0.1.0",
          "files:",
          "  - url: different.exe",
          `    sha512: ${Buffer.alloc(64).toString("base64")}`,
          "    size: 1024",
          "path: setup.exe",
          `sha512: ${Buffer.alloc(64).toString("base64")}`,
        ].join("\n")
      )
    ).toThrow("invalid SHA-512 or size");
  });

  it("rejects incomplete commands and unknown components", () => {
    expect(() => parseDesktopReleaseCommand(["stage"])).toThrow("--directory is required");
    expect(() =>
      parseDesktopReleaseCommand([
        "stage",
        "--directory",
        "release/bundle",
        "--components",
        "mac-runtime",
      ])
    ).toThrow("--components must contain");
  });

  it("validates one complete signed Desktop channel against the exact artifacts", async () => {
    const fixture = await createCompleteReleaseFixture();

    await expect(validateDesktopReleaseArtifacts(fixture.options)).resolves.toBeUndefined();
  });

  it("rejects a missing build info or signed channel", async () => {
    const missingBuild = await createCompleteReleaseFixture();
    await rm(join(missingBuild.root, "build-info.json"));
    await expect(validateDesktopReleaseArtifacts(missingBuild.options)).rejects.toThrow(
      /build-info\.json|build info/i
    );

    const missingChannel = await createCompleteReleaseFixture();
    await rm(join(missingChannel.root, "desktop-channel.json"));
    await expect(validateDesktopReleaseArtifacts(missingChannel.options)).rejects.toThrow(
      /desktop-channel\.json|channel/i
    );
  });

  it("rejects invalid channel and Runtime signatures", async () => {
    const badChannel = await createCompleteReleaseFixture();
    await badChannel.writeChannel({}, false);
    await expect(validateDesktopReleaseArtifacts(badChannel.options)).rejects.toThrow(
      /channel signature/i
    );

    const badRuntime = await createCompleteReleaseFixture();
    await badRuntime.writeRuntime("win32-x64", {}, false);
    await expect(validateDesktopReleaseArtifacts(badRuntime.options)).rejects.toThrow(
      /Runtime.*signature/i
    );
  });

  it("rejects channel, manifest, and updater identity drift", async () => {
    const timestamp = await createCompleteReleaseFixture();
    await timestamp.writeRuntime("win32-x64", {
      publishedAt: "2026-09-01T02:03:04.000Z",
    });
    await expect(validateDesktopReleaseArtifacts(timestamp.options)).rejects.toThrow(
      /release time|publishedAt/i
    );

    const updater = await createCompleteReleaseFixture();
    await updater.writeChannel({
      shell: {
        version: "0.4.0",
        publishedAt,
        updaterMetadata: "latest.yml",
        engineVersion: "2",
        nodeVersion: "24.19.0",
        runtimeHostApiVersion: 1,
        apiProtocolVersion: 1,
        dataSchemaVersion: 1,
      },
    });
    await expect(validateDesktopReleaseArtifacts(updater.options)).rejects.toThrow(
      /updater|latest\.yml|Shell/i
    );

    const missingAsset = await createCompleteReleaseFixture();
    await missingAsset.writeChannel({
      runtimes: {
        "win32-x64": {
          version: "0.6.0",
          publishedAt,
          manifest: "missing-win32.manifest.json",
        },
        "linux-x64": {
          version: "0.6.0",
          publishedAt,
          manifest: "coder-studio-server-runtime-linux-x64.manifest.json",
        },
      },
    });
    await expect(validateDesktopReleaseArtifacts(missingAsset.options)).rejects.toThrow(
      /missing-win32|ENOENT|referenced/i
    );
  });

  it("rejects Runtime pair, host capability, and archive drift", async () => {
    const pair = await createCompleteReleaseFixture();
    await pair.writeRuntime("linux-x64", { runtimeVersion: "0.7.0" });
    await expect(validateDesktopReleaseArtifacts(pair.options)).rejects.toThrow(
      /same product|Runtime pair|version/i
    );

    const minimumShell = await createCompleteReleaseFixture();
    await minimumShell.writeRuntime("win32-x64", { minShellVersion: "9.0.0" });
    await minimumShell.writeRuntime("linux-x64", { minShellVersion: "9.0.0" });
    await expect(validateDesktopReleaseArtifacts(minimumShell.options)).rejects.toThrow(
      /minimum Shell|minShellVersion|planned Shell/i
    );

    const hostApi = await createCompleteReleaseFixture();
    await hostApi.writeRuntime("win32-x64", { runtimeHostApiVersion: 2 });
    await hostApi.writeRuntime("linux-x64", { runtimeHostApiVersion: 2 });
    await expect(validateDesktopReleaseArtifacts(hostApi.options)).rejects.toThrow(
      /Host API|runtimeHostApiVersion|capability/i
    );

    const archive = await createCompleteReleaseFixture();
    await archive.writeRuntime("win32-x64", {
      files: [{ path: "server.mjs", sha256: "f".repeat(64), size: 1 }],
    });
    await expect(validateDesktopReleaseArtifacts(archive.options)).rejects.toThrow(
      /archive|verification failed|file set/i
    );
  });

  it("rejects Engine, platform, and architecture incompatibility", async () => {
    const engine = await createCompleteReleaseFixture();
    await engine.writeEngine({ nodeVersion: "25.0.0" });
    await expect(validateDesktopReleaseArtifacts(engine.options)).rejects.toThrow(/Engine|Node/i);

    const platform = await createCompleteReleaseFixture();
    await platform.writeRuntime("win32-x64", { platform: "linux" });
    await expect(validateDesktopReleaseArtifacts(platform.options)).rejects.toThrow(/platform/i);

    const architecture = await createCompleteReleaseFixture();
    await architecture.writeRuntime("linux-x64", { arch: "arm64" });
    await expect(validateDesktopReleaseArtifacts(architecture.options)).rejects.toThrow(
      /architecture|x64/i
    );
  });

  it("requires a valid prior unified channel and byte-identical Runtime-only base", async () => {
    const fixture = await createCompleteReleaseFixture();
    await Promise.all([
      copyFile(join(fixture.root, "latest.yml"), join(fixture.root, "modern.yml")),
      copyFile(join(fixture.root, "build-info.json"), join(fixture.root, "build-info-modern.json")),
    ]);
    await fixture.writeChannel(
      {
        shell: {
          version: "0.3.0",
          publishedAt,
          updaterMetadata: "modern.yml",
          engineVersion: "2",
          nodeVersion: "24.19.0",
          runtimeHostApiVersion: 1,
          apiProtocolVersion: 1,
          dataSchemaVersion: 1,
        },
      },
      true,
      "desktop-channel-modern.json"
    );
    const previous = await mkdtemp(join(tmpdir(), "coder-studio-release-previous-"));
    roots.push(previous);
    await cp(fixture.root, previous, { recursive: true });
    const runtimeOnlyOptions = {
      ...fixture.options,
      releaseKind: "runtime-only" as const,
      previousReleaseDirectory: previous,
    };

    await expect(validateDesktopReleaseArtifacts(runtimeOnlyOptions)).resolves.toBeUndefined();

    await writeFile(join(fixture.root, "Coder-Studio-Setup-0.3.0.exe.blockmap"), "changed");
    await expect(validateDesktopReleaseArtifacts(runtimeOnlyOptions)).rejects.toThrow(
      /carried-forward asset/i
    );

    await copyFile(
      join(previous, "Coder-Studio-Setup-0.3.0.exe.blockmap"),
      join(fixture.root, "Coder-Studio-Setup-0.3.0.exe.blockmap")
    );
    await writeFile(join(fixture.root, "build-info-modern.json"), "{}\n");
    await expect(validateDesktopReleaseArtifacts(runtimeOnlyOptions)).rejects.toThrow(
      /modern asset/i
    );
  });

  it("validates a legacy Runtime channel alongside a manual modern Shell migration", async () => {
    const fixture = await createCompleteReleaseFixture();
    const previous = await mkdtemp(join(tmpdir(), "coder-studio-release-migration-previous-"));
    roots.push(previous);
    await cp(fixture.root, previous, { recursive: true });
    const modernInstallerName = "Coder-Studio-Setup-0.4.0.exe";
    const modernInstaller = Buffer.from("modern-signed-installer");
    const modernInstallerSha = createHash("sha512").update(modernInstaller).digest("base64");
    await Promise.all([
      writeFile(join(fixture.root, modernInstallerName), modernInstaller),
      writeFile(join(fixture.root, `${modernInstallerName}.blockmap`), "modern-blockmap"),
      writeFile(
        join(fixture.root, "modern.yml"),
        [
          "version: 0.4.0",
          "files:",
          `  - url: ${modernInstallerName}`,
          `    sha512: ${modernInstallerSha}`,
          `    size: ${modernInstaller.byteLength}`,
          `path: ${modernInstallerName}`,
          `sha512: ${modernInstallerSha}`,
        ].join("\n")
      ),
      writeFile(
        join(fixture.root, "build-info-modern.json"),
        JSON.stringify({
          schemaVersion: 1,
          shellVersion: "0.4.0",
          builtAt: "2026-08-08T00:55:00.000Z",
          publishedAt,
          engineVersion: "2",
          nodeVersion: "24.19.0",
          runtimeHostApiVersion: 1,
          apiProtocolVersion: 1,
          dataSchemaVersion: 1,
        })
      ),
    ]);
    await fixture.writeChannel(
      {
        shell: {
          version: "0.4.0",
          publishedAt,
          updaterMetadata: "modern.yml",
          engineVersion: "2",
          nodeVersion: "24.19.0",
          runtimeHostApiVersion: 1,
          apiProtocolVersion: 1,
          dataSchemaVersion: 1,
        },
      },
      true,
      "desktop-channel-modern.json"
    );

    await expect(
      validateDesktopReleaseArtifacts({
        ...fixture.options,
        releaseKind: "migration",
        previousReleaseDirectory: previous,
      })
    ).resolves.toBeUndefined();
  });

  it("rejects symlinked release metadata", async () => {
    const fixture = await createCompleteReleaseFixture();
    const channelPath = join(fixture.root, "desktop-channel.json");
    const outsidePath = join(fixture.root, "outside-channel.json");
    await writeFile(outsidePath, await readFile(channelPath));
    await rm(channelPath);
    await symlink(outsidePath, channelPath);

    await expect(validateDesktopReleaseArtifacts(fixture.options)).rejects.toThrow(
      /symbolic|regular file/i
    );
  });
});
