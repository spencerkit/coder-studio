import { generateKeyPairSync } from "node:crypto";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { prepareDesktopBridgeCandidate } from "./prepare-desktop-bridge-candidate.js";
import { parseCompatibilityDesktopChannel } from "./verify-release-compatibility.js";

describe("prepareDesktopBridgeCandidate", () => {
  it("hydrates a Desktop bridge candidate with Product assets and a signed legacy channel", async () => {
    const root = await mkdtemp(resolve(tmpdir(), "coder-studio-bridge-candidate-test-"));
    const candidate = join(root, "candidate");
    const product = join(root, "product");
    await Promise.all([mkdir(candidate, { recursive: true }), mkdir(product, { recursive: true })]);

    const { privateKey, publicKey } = generateKeyPairSync("ed25519");
    const privateKeyPem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
    const publicKeyPem = publicKey.export({ type: "spki", format: "pem" }).toString();

    const modernChannel = {
      schemaVersion: 1,
      channel: "desktop" as const,
      version: "0.1.5",
      releaseTag: "desktop-v0.1.5",
      generatedAt: "2026-08-24T10:59:22.000Z",
      shell: {
        version: "0.1.5",
        publishedAt: "2026-08-24T10:59:22.000Z",
        updaterMetadata: "latest.yml",
        installer: "Coder-Studio-Setup-0.1.5.exe",
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
        manifestSha256: "1".repeat(64),
      },
      factoryProduct: {
        version: "0.5.8",
        releaseTag: "v0.5.12",
        runtimes: {
          "win32-x64": {
            manifest: "coder-studio-runtime-win32-x64.manifest.json",
            manifestSha256: "b".repeat(64),
          },
          "linux-x64": {
            manifest: "coder-studio-server-runtime-linux-x64.manifest.json",
            manifestSha256: "c".repeat(64),
          },
        },
      },
      signature: {
        algorithm: "ed25519" as const,
        value: "existing-modern-signature",
      },
    };
    const productChannel = {
      schemaVersion: 1,
      channel: "product" as const,
      version: "0.5.8",
      releaseTag: "v0.5.12",
      generatedAt: "2026-08-24T09:00:00.000Z",
      minShellVersion: "0.1.1",
      requirements: {
        engineVersion: "2",
        nodeVersion: "24.19.0",
        runtimeHostApiVersion: 1,
        apiProtocolVersion: 1,
        dataSchemaVersion: 1,
      },
      runtimes: {
        "win32-x64": {
          version: "0.5.8",
          publishedAt: "2026-08-24T09:00:00.000Z",
          manifest: "coder-studio-runtime-win32-x64.manifest.json",
          manifestSha256: "d".repeat(64),
        },
        "linux-x64": {
          version: "0.5.8",
          publishedAt: "2026-08-24T09:00:00.000Z",
          manifest: "coder-studio-server-runtime-linux-x64.manifest.json",
          manifestSha256: "e".repeat(64),
        },
      },
      signature: {
        algorithm: "ed25519" as const,
        value: "existing-product-signature",
      },
    };
    const windowsManifest = {
      schemaVersion: 2,
      runtimeVersion: "0.5.8",
      publishedAt: "2026-08-24T09:00:00.000Z",
      minShellVersion: "0.1.1",
      requiredEngineVersion: "2",
      requiredNodeVersion: "24.19.0",
      runtimeHostApiVersion: 1,
      apiProtocolVersion: 1,
      dataSchemaVersion: 1,
      platform: "win32",
      arch: "x64",
      entrypoint: "server.mjs",
      webRoot: "web",
      packageFile: "coder-studio-runtime-0.5.8-win32-x64.tgz",
      files: [{ path: "server.mjs", sha256: "f".repeat(64), size: 5 }],
    };
    const linuxManifest = {
      schemaVersion: 2,
      runtimeVersion: "0.5.8",
      publishedAt: "2026-08-24T09:00:00.000Z",
      minShellVersion: "0.1.1",
      requiredEngineVersion: "2",
      requiredNodeVersion: "24.19.0",
      runtimeHostApiVersion: 1,
      apiProtocolVersion: 1,
      dataSchemaVersion: 1,
      platform: "linux",
      arch: "x64",
      entrypoint: "server.mjs",
      packageFile: "coder-studio-server-runtime-0.5.8-linux-x64.tgz",
      files: [{ path: "server.mjs", sha256: "a".repeat(64), size: 5 }],
    };

    await Promise.all([
      writeFile(
        join(candidate, "desktop-channel.json"),
        `${JSON.stringify(modernChannel, null, 2)}\n`
      ),
      writeFile(
        join(product, "product-channel.json"),
        `${JSON.stringify(productChannel, null, 2)}\n`
      ),
      writeFile(
        join(product, "coder-studio-runtime-win32-x64.manifest.json"),
        `${JSON.stringify(windowsManifest, null, 2)}\n`
      ),
      writeFile(
        join(product, "coder-studio-server-runtime-linux-x64.manifest.json"),
        `${JSON.stringify(linuxManifest, null, 2)}\n`
      ),
      writeFile(join(product, "coder-studio-cli.tgz"), "cli\n"),
      writeFile(join(product, "coder-studio-runtime-0.5.8-win32-x64.tgz"), "win\n"),
      writeFile(join(product, "coder-studio-server-runtime-0.5.8-linux-x64.tgz"), "linux\n"),
    ]);

    await prepareDesktopBridgeCandidate({
      candidateDirectory: candidate,
      productDirectory: product,
      bridgeTag: "desktop-v0.1.5",
      privateKeyPem,
    });

    const hydratedModern = JSON.parse(
      await readFile(join(candidate, "desktop-channel-modern.json"), "utf8")
    );
    const legacy = JSON.parse(await readFile(join(candidate, "desktop-channel.json"), "utf8"));

    expect(hydratedModern).toMatchObject({
      channel: "desktop",
      releaseTag: "desktop-v0.1.5",
      version: "0.1.5",
      wslEngine: {
        version: "2",
        nodeVersion: "24.19.0",
        manifest: "coder-studio-engine-linux-x64.manifest.json",
      },
    });
    expect(parseCompatibilityDesktopChannel(legacy, publicKeyPem)).toMatchObject({
      releaseTag: "desktop-v0.1.5",
      version: "0.1.5",
      shell: {
        version: "0.1.5",
        engineVersion: "2",
        nodeVersion: "24.19.0",
      },
    });
    expect(legacy).toMatchObject({
      channel: "stable",
      runtimes: {
        "win32-x64": {
          version: "0.5.8",
          manifest: "coder-studio-runtime-win32-x64.manifest.json",
        },
        "linux-x64": {
          version: "0.5.8",
          manifest: "coder-studio-server-runtime-linux-x64.manifest.json",
        },
      },
    });
    await expect(readFile(join(candidate, "product-channel.json"), "utf8")).resolves.toContain(
      '"releaseTag": "v0.5.12"'
    );
    await expect(readFile(join(candidate, "coder-studio-cli.tgz"), "utf8")).resolves.toBe("cli\n");
    await expect(
      readFile(join(candidate, "coder-studio-runtime-0.5.8-win32-x64.tgz"), "utf8")
    ).resolves.toBe("win\n");
    await expect(
      readFile(join(candidate, "coder-studio-server-runtime-0.5.8-linux-x64.tgz"), "utf8")
    ).resolves.toBe("linux\n");
  });
});
