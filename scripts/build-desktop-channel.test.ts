import { createHash, generateKeyPairSync } from "node:crypto";
import { mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { DesktopChannel } from "../packages/desktop/src/desktop-channel.js";
import {
  canonicalSigningPayload,
  verifyEd25519Payload,
} from "../packages/desktop/src/signed-json.js";
import {
  buildDesktopChannel,
  carryForwardDesktopBase,
  carryForwardDesktopShellBase,
  carryForwardLegacyDesktopBase,
  carryForwardModernDesktopBase,
  MODERN_LINUX_RUNTIME_MANIFEST,
  MODERN_WINDOWS_RUNTIME_MANIFEST,
  normalizeDesktopChannelArgs,
  prepareModernDesktopBase,
} from "./build-desktop-channel.js";

const releaseTime = "2026-08-08T01:02:03.000Z";
const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

function runtimeManifest(platform: "win32" | "linux", version = "0.6.0") {
  return {
    schemaVersion: 2,
    publishedAt: releaseTime,
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
    packageFile:
      platform === "win32"
        ? `coder-studio-runtime-${version}-win32-x64.tgz`
        : `coder-studio-server-runtime-${version}-linux-x64.tgz`,
    files: [{ path: "server.mjs", sha256: "a".repeat(64), size: 1 }],
  };
}

async function createChannelFixture() {
  const root = await mkdtemp(join(tmpdir(), "coder-studio-channel-test-"));
  roots.push(root);
  const keys = generateKeyPairSync("ed25519");
  const privateKeyPem = keys.privateKey.export({ type: "pkcs8", format: "pem" }).toString();
  const publicKeyPem = keys.publicKey.export({ type: "spki", format: "pem" }).toString();
  await writeFile(
    join(root, "build-info.json"),
    JSON.stringify({
      schemaVersion: 1,
      shellVersion: "0.3.0",
      builtAt: "2026-08-08T00:50:00.000Z",
      publishedAt: releaseTime,
      engineVersion: "2",
      nodeVersion: "24.19.0",
      runtimeHostApiVersion: 1,
      apiProtocolVersion: 1,
      dataSchemaVersion: 1,
    })
  );
  await writeFile(
    join(root, "latest.yml"),
    [
      "version: 0.3.0",
      "files:",
      "  - url: Coder-Studio-Setup-0.3.0.exe",
      `    sha512: ${Buffer.alloc(64, 1).toString("base64")}`,
      "    size: 1",
      "path: Coder-Studio-Setup-0.3.0.exe",
      `sha512: ${Buffer.alloc(64, 1).toString("base64")}`,
    ].join("\n")
  );
  await writeFile(
    join(root, "coder-studio-runtime-win32-x64.manifest.json"),
    JSON.stringify(runtimeManifest("win32"))
  );
  await writeFile(
    join(root, "coder-studio-server-runtime-linux-x64.manifest.json"),
    JSON.stringify(runtimeManifest("linux"))
  );
  return { root, privateKeyPem, publicKeyPem };
}

describe("build-desktop-channel", () => {
  it("accepts pnpm's explicit argument separator", () => {
    expect(
      normalizeDesktopChannelArgs(["--", "--directory", "release/desktop-release-complete"])
    ).toEqual(["--directory", "release/desktop-release-complete"]);
  });

  it("signs a full channel from staged immutable metadata", async () => {
    const fixture = await createChannelFixture();

    const channel = await buildDesktopChannel({
      directory: fixture.root,
      releaseTag: "desktop-v0.3.0",
      channel: "stable",
      generatedAt: releaseTime,
      privateKeyPem: fixture.privateKeyPem,
    });

    expect(channel).toMatchObject({
      releaseTag: "desktop-v0.3.0",
      shell: { version: "0.3.0", publishedAt: releaseTime },
      runtimes: {
        "win32-x64": { version: "0.6.0", publishedAt: releaseTime },
        "linux-x64": { version: "0.6.0", publishedAt: releaseTime },
      },
    });
    expect(
      verifyEd25519Payload(
        canonicalSigningPayload(channel),
        channel.signature,
        fixture.publicKeyPem
      )
    ).toBe(true);
    await expect(
      readFile(join(fixture.root, "desktop-channel.json"), "utf8").then(
        (value) => JSON.parse(value) as DesktopChannel
      )
    ).resolves.toEqual(channel);
  });

  it("builds a separately signed modern channel from the current Shell base", async () => {
    const fixture = await createChannelFixture();
    await Promise.all([
      writeFile(join(fixture.root, "Coder-Studio-Setup-0.3.0.exe"), "installer"),
      writeFile(join(fixture.root, "Coder-Studio-Setup-0.3.0.exe.blockmap"), "blockmap"),
    ]);
    await prepareModernDesktopBase(fixture.root);

    const channel = await buildDesktopChannel({
      directory: fixture.root,
      releaseTag: "desktop-v0.3.0",
      channel: "stable",
      generatedAt: releaseTime,
      privateKeyPem: fixture.privateKeyPem,
      buildInfoFile: "build-info-modern.json",
      updaterMetadataFile: "modern.yml",
      windowsRuntimeManifestFile: MODERN_WINDOWS_RUNTIME_MANIFEST,
      linuxRuntimeManifestFile: MODERN_LINUX_RUNTIME_MANIFEST,
      outputFile: "desktop-channel-modern.json",
    });

    expect(channel.shell.updaterMetadata).toBe("modern.yml");
    expect(channel.runtimes["win32-x64"].manifest).toBe(MODERN_WINDOWS_RUNTIME_MANIFEST);
    expect(channel.runtimes["linux-x64"].manifest).toBe(MODERN_LINUX_RUNTIME_MANIFEST);
    expect(
      verifyEd25519Payload(
        canonicalSigningPayload(channel),
        channel.signature,
        fixture.publicKeyPem
      )
    ).toBe(true);
    await expect(
      readFile(join(fixture.root, "desktop-channel-modern.json"), "utf8").then(
        (value) => JSON.parse(value) as DesktopChannel
      )
    ).resolves.toEqual(channel);
  });

  it("rejects a product-version or release-time split between Runtime targets", async () => {
    const fixture = await createChannelFixture();
    await writeFile(
      join(fixture.root, "coder-studio-server-runtime-linux-x64.manifest.json"),
      JSON.stringify({
        ...runtimeManifest("linux", "0.7.0"),
        publishedAt: "2026-09-01T02:03:04.000Z",
      })
    );

    await expect(
      buildDesktopChannel({
        directory: fixture.root,
        releaseTag: "desktop-v0.3.0",
        channel: "stable",
        generatedAt: releaseTime,
        privateKeyPem: fixture.privateKeyPem,
      })
    ).rejects.toThrow(/Windows and WSL Runtime metadata/i);
  });

  it("carries forward only the immutable Shell and Engine base", async () => {
    const previous = await createChannelFixture();
    const nextRoot = await mkdtemp(join(tmpdir(), "coder-studio-channel-next-"));
    roots.push(nextRoot);
    const installer = Buffer.from("signed-installer");
    await Promise.all([
      writeFile(join(previous.root, "Coder-Studio-Setup-0.3.0.exe"), installer),
      writeFile(join(previous.root, "Coder-Studio-Setup-0.3.0.exe.blockmap"), "blockmap"),
      writeFile(join(previous.root, "desktop-channel.json"), "{}\n"),
      writeFile(
        join(previous.root, "coder-studio-engine-linux-x64.manifest.json"),
        JSON.stringify({ packageFile: "coder-studio-engine-2-linux-x64.tgz" })
      ),
      writeFile(join(previous.root, "coder-studio-engine-2-linux-x64.tgz"), "engine"),
      writeFile(join(previous.root, "not-allowlisted.pem"), "secret"),
    ]);

    const copied = await carryForwardDesktopBase(previous.root, nextRoot);

    expect(copied).toEqual([
      "Coder-Studio-Setup-0.3.0.exe",
      "Coder-Studio-Setup-0.3.0.exe.blockmap",
      "build-info.json",
      "coder-studio-engine-2-linux-x64.tgz",
      "coder-studio-engine-linux-x64.manifest.json",
      "desktop-channel.json",
      "latest.yml",
    ]);
    expect(
      createHash("sha256")
        .update(await readFile(join(nextRoot, "Coder-Studio-Setup-0.3.0.exe")))
        .digest("hex")
    ).toBe(createHash("sha256").update(installer).digest("hex"));
    await expect(readFile(join(nextRoot, "not-allowlisted.pem"))).rejects.toThrow();
  });

  it("carries forward the immutable modern Shell base for Runtime-only releases", async () => {
    const previous = await createChannelFixture();
    const nextRoot = await mkdtemp(join(tmpdir(), "coder-studio-channel-modern-next-"));
    roots.push(nextRoot);
    await Promise.all([
      writeFile(join(previous.root, "Coder-Studio-Setup-0.3.0.exe"), "installer"),
      writeFile(join(previous.root, "Coder-Studio-Setup-0.3.0.exe.blockmap"), "blockmap"),
      writeFile(join(previous.root, "desktop-channel.json"), "{}\n"),
    ]);
    await prepareModernDesktopBase(previous.root);

    const copied = await carryForwardModernDesktopBase(previous.root, nextRoot);

    expect(copied).toEqual([
      "Coder-Studio-Setup-0.3.0.exe",
      "Coder-Studio-Setup-0.3.0.exe.blockmap",
      "build-info-modern.json",
      "desktop-channel-modern.json",
      "modern.yml",
    ]);
    await expect(readFile(join(nextRoot, "modern.yml"), "utf8")).resolves.toContain(
      "version: 0.3.0"
    );
  });

  it("carries forward the legacy Shell without replacing the acceptance Engine", async () => {
    const previous = await createChannelFixture();
    const nextRoot = await mkdtemp(join(tmpdir(), "coder-studio-channel-shell-next-"));
    roots.push(nextRoot);
    await Promise.all([
      writeFile(join(previous.root, "Coder-Studio-Setup-0.3.0.exe"), "installer"),
      writeFile(join(previous.root, "Coder-Studio-Setup-0.3.0.exe.blockmap"), "blockmap"),
      writeFile(join(previous.root, "desktop-channel.json"), "{}\n"),
      writeFile(join(nextRoot, "coder-studio-engine-linux-x64.manifest.json"), "acceptance"),
    ]);

    const copied = await carryForwardDesktopShellBase(previous.root, nextRoot);

    expect(copied).toEqual([
      "Coder-Studio-Setup-0.3.0.exe",
      "Coder-Studio-Setup-0.3.0.exe.blockmap",
      "build-info.json",
      "desktop-channel.json",
      "latest.yml",
    ]);
    await expect(
      readFile(join(nextRoot, "coder-studio-engine-linux-x64.manifest.json"), "utf8")
    ).resolves.toBe("acceptance");
  });

  it("freezes legacy Shell and Runtime assets without replacing the acceptance Engine", async () => {
    const previous = await createChannelFixture();
    const nextRoot = await mkdtemp(join(tmpdir(), "coder-studio-channel-legacy-next-"));
    roots.push(nextRoot);
    await Promise.all([
      writeFile(join(previous.root, "Coder-Studio-Setup-0.3.0.exe"), "installer"),
      writeFile(join(previous.root, "Coder-Studio-Setup-0.3.0.exe.blockmap"), "blockmap"),
      writeFile(join(previous.root, "coder-studio-runtime-0.6.0-win32-x64.tgz"), "windows"),
      writeFile(join(previous.root, "coder-studio-server-runtime-0.6.0-linux-x64.tgz"), "linux"),
      buildDesktopChannel({
        directory: previous.root,
        releaseTag: "desktop-v0.3.0",
        channel: "stable",
        generatedAt: releaseTime,
        privateKeyPem: previous.privateKeyPem,
      }),
      writeFile(join(nextRoot, "coder-studio-engine-linux-x64.manifest.json"), "acceptance"),
    ]);

    const copied = await carryForwardLegacyDesktopBase(previous.root, nextRoot);

    expect(copied).toEqual([
      "Coder-Studio-Setup-0.3.0.exe",
      "Coder-Studio-Setup-0.3.0.exe.blockmap",
      "build-info.json",
      "coder-studio-runtime-0.6.0-win32-x64.tgz",
      "coder-studio-runtime-win32-x64.manifest.json",
      "coder-studio-server-runtime-0.6.0-linux-x64.tgz",
      "coder-studio-server-runtime-linux-x64.manifest.json",
      "desktop-channel.json",
      "latest.yml",
    ]);
    await expect(
      readFile(join(nextRoot, "coder-studio-engine-linux-x64.manifest.json"), "utf8")
    ).resolves.toBe("acceptance");
  });

  it("rejects a symlinked release directory", async () => {
    const fixture = await createChannelFixture();
    const parent = await mkdtemp(join(tmpdir(), "coder-studio-channel-link-"));
    roots.push(parent);
    const linkedDirectory = join(parent, "release-link");
    await symlink(fixture.root, linkedDirectory, "dir");

    await expect(
      buildDesktopChannel({
        directory: linkedDirectory,
        releaseTag: "desktop-v0.3.0",
        channel: "stable",
        generatedAt: releaseTime,
        privateKeyPem: fixture.privateKeyPem,
      })
    ).rejects.toThrow(/symlink|symbolic/i);
  });
});
