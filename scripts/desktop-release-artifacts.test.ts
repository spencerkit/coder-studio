import { createHash, generateKeyPairSync, type KeyObject, sign } from "node:crypto";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { create } from "tar";
import { afterEach, describe, expect, it } from "vitest";
import type { DesktopChannel } from "../packages/desktop/src/desktop-channel.js";
import {
  type EngineManifest,
  getEngineManifestSigningPayload,
} from "../packages/desktop/src/engine-manifest.js";
import type {
  FactoryProductProvenance,
  ProductChannel,
} from "../packages/desktop/src/product-channel.js";
import {
  getRuntimeManifestSigningPayload,
  type RuntimeManifestV2,
} from "../packages/desktop/src/runtime-manifest.js";
import { canonicalSigningPayload } from "../packages/desktop/src/signed-json.js";
import {
  parseReleaseArtifactsCommand,
  parseUpdaterMetadata,
  type StageProductReleaseOptions,
  stageDesktopReleaseArtifacts,
  stageProductReleaseArtifacts,
  validateDesktopReleaseArtifacts,
  validateProductReleaseArtifacts,
} from "./desktop-release-artifacts.js";

const roots: string[] = [];
const publishedAt = "2026-08-08T01:02:03.000Z";

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function fixtureRoot(prefix: string): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), prefix));
  roots.push(root);
  return root;
}

async function hashEntry(path: string) {
  const bytes = await readFile(path);
  return { sha256: createHash("sha256").update(bytes).digest("hex"), size: bytes.byteLength };
}

function signJson<T extends object>(value: T, privateKey: KeyObject) {
  return {
    ...value,
    signature: {
      algorithm: "ed25519" as const,
      value: sign(null, canonicalSigningPayload(value), privateKey).toString("base64"),
    },
  };
}

async function writeCliPackage(
  root: string,
  version: string,
  name = "@spencer-kit/coder-studio"
): Promise<string> {
  const sourcePackageJsonPath = join(root, "cli-package.json");
  const staging = join(root, "cli-staging");
  await mkdir(join(staging, "package/dist"), { recursive: true });
  const manifest = {
    name,
    version,
    type: "module",
    bin: { "coder-studio": "./dist/cli.mjs" },
  };
  await Promise.all([
    writeFile(sourcePackageJsonPath, `${JSON.stringify(manifest, null, 2)}\n`),
    writeFile(join(staging, "package/package.json"), `${JSON.stringify(manifest, null, 2)}\n`),
    writeFile(join(staging, "package/dist/cli.mjs"), "#!/usr/bin/env node\nconsole.log('ok');\n", {
      mode: 0o755,
    }),
  ]);
  await create(
    { cwd: staging, file: join(root, "coder-studio-cli.tgz"), gzip: true, portable: true },
    ["package"]
  );
  return sourcePackageJsonPath;
}

interface RuntimeFixtureOptions {
  platform: "win32" | "linux";
  root: string;
  privateKey: KeyObject;
  version: string;
  overrides?: Partial<RuntimeManifestV2>;
  outputDirectory?: string;
}

async function writeRuntime({
  platform,
  root,
  privateKey,
  version,
  overrides = {},
  outputDirectory = root,
}: RuntimeFixtureOptions): Promise<{ bytes: Buffer; manifest: RuntimeManifestV2; name: string }> {
  const target = platform === "win32" ? "win32-x64" : "linux-x64";
  const prefix = platform === "win32" ? "coder-studio-runtime" : "coder-studio-server-runtime";
  const name = `${prefix}-${target}.manifest.json`;
  const packageFile = `${prefix}-${version}-${target}.tgz`;
  const staging = join(root, `${target}-runtime-staging`);
  await mkdir(staging, { recursive: true });
  await writeFile(join(staging, "server.mjs"), `export const target = "${target}";\n`);
  if (platform === "win32") {
    await mkdir(join(staging, "web"), { recursive: true });
    await writeFile(join(staging, "web/index.html"), "<main>Coder Studio</main>\n");
  }
  const unsigned: RuntimeManifestV2 = {
    schemaVersion: 2,
    publishedAt,
    runtimeVersion: version,
    minShellVersion: "0.3.0",
    requiredEngineVersion: "2",
    requiredNodeVersion: "24.19.0",
    runtimeHostApiVersion: 1,
    apiProtocolVersion: 1,
    dataSchemaVersion: 1,
    platform,
    arch: "x64",
    entrypoint: "server.mjs",
    ...(platform === "win32" ? { webRoot: "web" } : {}),
    packageFile,
    files: [
      { path: "server.mjs", ...(await hashEntry(join(staging, "server.mjs"))) },
      ...(platform === "win32"
        ? [{ path: "web/index.html", ...(await hashEntry(join(staging, "web/index.html"))) }]
        : []),
    ],
    ...overrides,
  };
  const manifest: RuntimeManifestV2 = {
    ...unsigned,
    signature: {
      algorithm: "ed25519",
      value: sign(null, getRuntimeManifestSigningPayload(unsigned), privateKey).toString("base64"),
    },
  };
  const bytes = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`);
  await mkdir(outputDirectory, { recursive: true });
  await writeFile(join(outputDirectory, name), bytes);
  await writeFile(join(staging, "manifest.json"), bytes);
  await create(
    { cwd: staging, file: join(outputDirectory, packageFile), gzip: true, portable: true },
    platform === "win32" ? ["manifest.json", "server.mjs", "web"] : ["manifest.json", "server.mjs"]
  );
  return { bytes, manifest, name };
}

async function createProductFixture(
  options: {
    cliVersion?: string;
    cliName?: string;
    linuxOverrides?: Partial<RuntimeManifestV2>;
    productVersion?: string;
  } = {}
) {
  const root = await fixtureRoot("coder-studio-product-release-");
  const keys = generateKeyPairSync("ed25519");
  const productVersion = options.productVersion ?? "0.6.0";
  const sourcePackageJsonPath = await writeCliPackage(
    root,
    options.cliVersion ?? productVersion,
    options.cliName
  );
  const windows = await writeRuntime({
    platform: "win32",
    root,
    privateKey: keys.privateKey,
    version: productVersion,
  });
  const linux = await writeRuntime({
    platform: "linux",
    root,
    privateKey: keys.privateKey,
    version: productVersion,
    overrides: options.linuxOverrides,
  });
  const unsigned: Omit<ProductChannel, "signature"> = {
    schemaVersion: 1,
    channel: "product",
    version: productVersion,
    releaseTag: `v${productVersion}`,
    generatedAt: publishedAt,
    minShellVersion: "0.3.0",
    requirements: {
      engineVersion: "2",
      nodeVersion: "24.19.0",
      runtimeHostApiVersion: 1,
      apiProtocolVersion: 1,
      dataSchemaVersion: 1,
    },
    runtimes: {
      "win32-x64": {
        version: productVersion,
        publishedAt,
        manifest: windows.name,
        manifestSha256: createHash("sha256").update(windows.bytes).digest("hex"),
      },
      "linux-x64": {
        version: productVersion,
        publishedAt,
        manifest: linux.name,
        manifestSha256: createHash("sha256").update(linux.bytes).digest("hex"),
      },
    },
  };
  const channel = signJson(unsigned, keys.privateKey);
  await writeFile(join(root, "product-channel.json"), `${JSON.stringify(channel, null, 2)}\n`);
  return {
    channel,
    keys,
    options: {
      directory: root,
      publicKeyPem: keys.publicKey.export({ type: "spki", format: "pem" }).toString(),
      sourcePackageJsonPath,
      allowUnsigned: false,
    },
    root,
  };
}

async function writeEngine(root: string, privateKey: KeyObject) {
  const staging = join(root, "engine-staging");
  await mkdir(join(staging, "bin"), { recursive: true });
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
  };
  const manifest: EngineManifest = {
    ...unsigned,
    signature: {
      algorithm: "ed25519",
      value: sign(null, getEngineManifestSigningPayload(unsigned), privateKey).toString("base64"),
    },
  };
  const bytes = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`);
  await writeFile(join(root, "coder-studio-engine-linux-x64.manifest.json"), bytes);
  return { bytes };
}

async function createDesktopFixture() {
  const root = await fixtureRoot("coder-studio-desktop-release-");
  const keys = generateKeyPairSync("ed25519");
  const installerName = "Coder-Studio-Setup-0.3.0.exe";
  const installer = Buffer.from("signed-installer");
  const installerSha = createHash("sha512").update(installer).digest("base64");
  await Promise.all([
    writeFile(join(root, installerName), installer),
    writeFile(join(root, `${installerName}.blockmap`), "blockmap\n"),
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
      `${JSON.stringify(
        {
          schemaVersion: 1,
          shellVersion: "0.3.0",
          builtAt: publishedAt,
          publishedAt,
          engineVersion: "2",
          nodeVersion: "24.19.0",
          runtimeHostApiVersion: 1,
          apiProtocolVersion: 1,
          dataSchemaVersion: 1,
        },
        null,
        2
      )}\n`
    ),
  ]);
  await mkdir(join(root, "windows-engine"), { recursive: true });
  await writeFile(join(root, "windows-engine/node.exe"), "windows-node\n");

  const engine = await writeEngine(root, keys.privateKey);
  const factory = await writeRuntime({
    platform: "win32",
    root,
    privateKey: keys.privateKey,
    version: "0.6.0",
  });
  const factoryDirectory = join(root, "factory-runtime");
  await cp(join(root, "win32-x64-runtime-staging"), factoryDirectory, { recursive: true });
  await Promise.all([
    rm(join(root, factory.name), { force: true }),
    rm(join(root, factory.manifest.packageFile), { force: true }),
  ]);
  const factoryProvenance: FactoryProductProvenance = {
    schemaVersion: 1,
    version: "0.6.0",
    releaseTag: "v0.6.0",
    runtimes: {
      "win32-x64": {
        manifest: "coder-studio-runtime-win32-x64.manifest.json",
        manifestSha256: createHash("sha256").update(factory.bytes).digest("hex"),
      },
      "linux-x64": {
        manifest: "coder-studio-server-runtime-linux-x64.manifest.json",
        manifestSha256: "b".repeat(64),
      },
    },
  };
  await writeFile(
    join(root, "factory-product.json"),
    `${JSON.stringify(factoryProvenance, null, 2)}\n`
  );
  const unsigned: Omit<DesktopChannel, "signature"> = {
    schemaVersion: 1,
    channel: "desktop",
    version: "0.3.0",
    releaseTag: "desktop-v0.3.0",
    generatedAt: publishedAt,
    shell: {
      version: "0.3.0",
      publishedAt,
      updaterMetadata: "latest.yml",
      installer: installerName,
      engineVersion: "2",
      nodeVersion: "24.19.0",
      runtimeHostApiVersion: 1,
      apiProtocolVersion: 1,
      dataSchemaVersion: 1,
    },
    wslEngine: {
      version: "2",
      nodeVersion: "24.19.0",
      manifest: "coder-studio-engine-linux-x64.manifest.json",
      manifestSha256: createHash("sha256").update(engine.bytes).digest("hex"),
    },
    factoryProduct: {
      version: factoryProvenance.version,
      releaseTag: factoryProvenance.releaseTag,
      runtimes: factoryProvenance.runtimes,
    },
  };
  const channel = signJson(unsigned, keys.privateKey);
  await writeFile(join(root, "desktop-channel.json"), `${JSON.stringify(channel, null, 2)}\n`);
  return {
    channel,
    factoryProvenance,
    keys,
    options: {
      directory: root,
      publicKeyPem: keys.publicKey.export({ type: "spki", format: "pem" }).toString(),
      allowUnsigned: false,
    },
    root,
  };
}

describe("independent release artifact commands", () => {
  it("parses explicit Product and Desktop commands", () => {
    expect(
      parseReleaseArtifactsCommand([
        "stage-product",
        "--directory",
        "release/product-windows",
        "--components",
        "cli,win-runtime",
        "--cli-tarball",
        "release/cli/candidate.tgz",
      ])
    ).toEqual({
      action: "stage-product",
      directory: resolve("release/product-windows"),
      components: ["cli", "win-runtime"],
      cliTarballPath: resolve("release/cli/candidate.tgz"),
    });
    expect(
      parseReleaseArtifactsCommand([
        "validate-desktop",
        "--directory",
        "release/desktop-complete",
        "--allow-unsigned",
      ])
    ).toMatchObject({
      action: "validate-desktop",
      directory: resolve("release/desktop-complete"),
      allowUnsigned: true,
    });
  });

  it("rejects unified release modes and carry-forward arguments", () => {
    for (const legacy of [
      ["stage", "--directory", "release/all"],
      ["validate-product", "--directory", "release/product", "--release-kind", "runtime-only"],
      ["validate-desktop", "--directory", "release/desktop", "--release-kind", "migration"],
      [
        "validate-desktop",
        "--directory",
        "release/desktop",
        "--previous-release-directory",
        "release/previous",
      ],
      ["validate-desktop", "--directory", "release/desktop", "--allow-resigned-engine"],
    ]) {
      expect(() => parseReleaseArtifactsCommand(legacy)).toThrow(/command|unknown/i);
    }
  });
});

describe("independent release artifact staging", () => {
  it("stages only CLI and Product Runtime assets and is repeatable", async () => {
    const fixture = await createProductFixture();
    const runtimeSource = join(fixture.root, "runtime");
    const destination = join(fixture.root, "staged-product");
    await mkdir(runtimeSource);
    for (const identity of Object.values(fixture.channel.runtimes)) {
      const manifest = JSON.parse(
        await readFile(join(fixture.root, identity.manifest), "utf8")
      ) as RuntimeManifestV2;
      await Promise.all([
        cp(join(fixture.root, identity.manifest), join(runtimeSource, identity.manifest)),
        cp(join(fixture.root, manifest.packageFile), join(runtimeSource, manifest.packageFile)),
      ]);
    }

    const options: StageProductReleaseOptions = {
      directory: destination,
      releaseRoot: fixture.root,
      components: ["cli", "win-runtime", "wsl-runtime"],
      cliTarballPath: join(fixture.root, "coder-studio-cli.tgz"),
    };
    await stageProductReleaseArtifacts(options);
    await writeFile(join(destination, "stale.txt"), "stale\n");
    await stageProductReleaseArtifacts(options);

    await expect(readFile(join(destination, "coder-studio-cli.tgz"))).resolves.not.toHaveLength(0);
    await expect(readFile(join(destination, "stale.txt"))).rejects.toThrow();
    await expect(
      readFile(join(destination, fixture.channel.runtimes["win32-x64"].manifest))
    ).resolves.not.toHaveLength(0);
    await expect(
      readFile(join(destination, fixture.channel.runtimes["linux-x64"].manifest))
    ).resolves.not.toHaveLength(0);
  });

  it("stages only Desktop Shell, Engine, and Factory Runtime assets", async () => {
    const fixture = await createDesktopFixture();
    const desktopSource = join(fixture.root, "desktop");
    const resourcesSource = join(desktopSource, "win-unpacked/resources");
    const engineSource = join(fixture.root, "engine");
    const destination = join(fixture.root, "staged-desktop");
    await Promise.all([
      mkdir(resourcesSource, { recursive: true }),
      mkdir(engineSource, { recursive: true }),
    ]);
    for (const filename of [
      "latest.yml",
      fixture.channel.shell.installer,
      `${fixture.channel.shell.installer}.blockmap`,
      "build-info.json",
    ]) {
      await cp(join(fixture.root, filename), join(desktopSource, filename));
    }
    await Promise.all([
      cp(join(fixture.root, "windows-engine"), join(resourcesSource, "engine"), {
        recursive: true,
      }),
      cp(join(fixture.root, "factory-runtime"), join(resourcesSource, "factory-runtime"), {
        recursive: true,
      }),
      cp(join(fixture.root, "factory-product.json"), join(resourcesSource, "factory-product.json")),
      cp(
        join(fixture.root, fixture.channel.wslEngine.manifest),
        join(engineSource, fixture.channel.wslEngine.manifest)
      ),
      cp(
        join(fixture.root, "coder-studio-engine-2-linux-x64.tgz"),
        join(engineSource, "coder-studio-engine-2-linux-x64.tgz")
      ),
    ]);

    await stageDesktopReleaseArtifacts({
      directory: destination,
      releaseRoot: fixture.root,
      components: ["windows", "wsl-engine"],
    });

    await expect(readFile(join(destination, fixture.channel.shell.installer))).resolves.toEqual(
      await readFile(join(fixture.root, fixture.channel.shell.installer))
    );
    await expect(readFile(join(destination, "windows-engine/node.exe"))).resolves.not.toHaveLength(
      0
    );
    await expect(
      readFile(join(destination, "factory-runtime/manifest.json"))
    ).resolves.not.toHaveLength(0);
    await expect(
      readFile(join(destination, fixture.channel.wslEngine.manifest))
    ).resolves.not.toHaveLength(0);
    await expect(
      readFile(join(destination, "coder-studio-runtime-win32-x64.manifest.json"))
    ).rejects.toThrow();
  });
});

describe("Product release artifacts", () => {
  it("validates the CLI and signed Windows/WSL Runtime as one Product version", async () => {
    const fixture = await createProductFixture();

    await expect(validateProductReleaseArtifacts(fixture.options)).resolves.toBeUndefined();
  });

  it("rejects CLI version drift and mismatched Runtime capabilities", async () => {
    const cli = await createProductFixture({ cliVersion: "0.7.0" });
    await expect(validateProductReleaseArtifacts(cli.options)).rejects.toThrow(
      /CLI.*Product version|Product version.*CLI/i
    );

    const runtime = await createProductFixture({ linuxOverrides: { apiProtocolVersion: 2 } });
    await expect(validateProductReleaseArtifacts(runtime.options)).rejects.toThrow(
      /Runtime.*capabilit|one Product release/i
    );
  });

  it("rejects a different npm package even when its version matches Product", async () => {
    const fixture = await createProductFixture({ cliName: "@example/not-coder-studio" });

    await expect(validateProductReleaseArtifacts(fixture.options)).rejects.toThrow(
      /CLI package identity|npm package/i
    );
  });

  it("rejects a channel manifest digest that does not identify the exact bytes", async () => {
    const fixture = await createProductFixture();
    const { signature: _signature, ...unsignedChannel } = fixture.channel;
    const channel = signJson(
      {
        ...unsignedChannel,
        runtimes: {
          ...unsignedChannel.runtimes,
          "linux-x64": {
            ...unsignedChannel.runtimes["linux-x64"],
            manifestSha256: "f".repeat(64),
          },
        },
      },
      fixture.keys.privateKey
    );
    await writeFile(join(fixture.root, "product-channel.json"), `${JSON.stringify(channel)}\n`);

    await expect(validateProductReleaseArtifacts(fixture.options)).rejects.toThrow(
      /manifest digest|SHA-256/i
    );
  });
});

describe("Desktop release artifacts", () => {
  it("validates Shell, installer, Windows/WSL Engines, and resolved Factory Runtime", async () => {
    const fixture = await createDesktopFixture();

    await expect(validateDesktopReleaseArtifacts(fixture.options)).resolves.toBeUndefined();
  });

  it("allows known zero-byte Windows Engine placeholder files", async () => {
    const fixture = await createDesktopFixture();
    await mkdir(join(fixture.root, "windows-engine/node_modules/node-addon-api"), {
      recursive: true,
    });
    await writeFile(join(fixture.root, "windows-engine/node_modules/node-addon-api/nothing.c"), "");

    await expect(validateDesktopReleaseArtifacts(fixture.options)).resolves.toBeUndefined();
  });

  it("allows zero-byte Windows Engine Python package markers", async () => {
    const fixture = await createDesktopFixture();
    await mkdir(
      join(
        fixture.root,
        "windows-engine/node_modules/npm/node_modules/node-gyp/gyp/pylib/gyp/generator"
      ),
      { recursive: true }
    );
    await writeFile(
      join(
        fixture.root,
        "windows-engine/node_modules/npm/node_modules/node-gyp/gyp/pylib/gyp/generator/__init__.py"
      ),
      ""
    );

    await expect(validateDesktopReleaseArtifacts(fixture.options)).resolves.toBeUndefined();
  });

  it("rejects Factory provenance or bytes that differ from the accepted Product", async () => {
    const provenance = await createDesktopFixture();
    await writeFile(
      join(provenance.root, "factory-product.json"),
      `${JSON.stringify({ ...provenance.factoryProvenance, version: "0.7.0" })}\n`
    );
    await expect(validateDesktopReleaseArtifacts(provenance.options)).rejects.toThrow(
      /Factory.*provenance|Factory Product/i
    );

    const bytes = await createDesktopFixture();
    await writeFile(join(bytes.root, "factory-runtime/server.mjs"), "tampered\n");
    await expect(validateDesktopReleaseArtifacts(bytes.options)).rejects.toThrow(
      /Factory Runtime.*verification|digest/i
    );
  });

  it("rejects Product Runtime publication assets in a Desktop bundle", async () => {
    const fixture = await createDesktopFixture();
    await writeFile(join(fixture.root, "coder-studio-runtime-win32-x64.manifest.json"), "{}\n");

    await expect(validateDesktopReleaseArtifacts(fixture.options)).rejects.toThrow(
      /Desktop bundle.*Product Runtime|does not own Product Runtime/i
    );
  });

  it("rejects unexpected empty Windows Engine files", async () => {
    const fixture = await createDesktopFixture();
    await writeFile(join(fixture.root, "windows-engine/empty.txt"), "");

    await expect(validateDesktopReleaseArtifacts(fixture.options)).rejects.toThrow(
      "Packaged Windows Engine file is empty: empty.txt"
    );
  });
});

describe("electron updater metadata", () => {
  it("accepts one safe installer identity and rejects path traversal", () => {
    const sha512 = Buffer.alloc(64, 7).toString("base64");
    expect(
      parseUpdaterMetadata(
        [
          "version: 0.1.0",
          "files:",
          "  - url: Coder-Studio-Setup-0.1.0.exe",
          `    sha512: ${sha512}`,
          "    size: 1024",
          "path: Coder-Studio-Setup-0.1.0.exe",
          `sha512: ${sha512}`,
        ].join("\n")
      )
    ).toMatchObject({ version: "0.1.0", path: "Coder-Studio-Setup-0.1.0.exe" });
    expect(() =>
      parseUpdaterMetadata(
        [
          "version: 0.1.0",
          "files:",
          "  - url: ../setup.exe",
          `    sha512: ${sha512}`,
          "    size: 1024",
          "path: ../setup.exe",
          `sha512: ${sha512}`,
        ].join("\n")
      )
    ).toThrow("invalid version or path");
  });
});
