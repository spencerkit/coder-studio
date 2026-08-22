import { createHash, generateKeyPairSync } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { parseDesktopChannel } from "../packages/desktop/src/desktop-channel.js";
import { parseProductChannel } from "../packages/desktop/src/product-channel.js";
import type { RuntimeManifestV2 } from "../packages/desktop/src/runtime-manifest.js";
import {
  buildDesktopChannel,
  buildProductChannel,
  normalizeReleaseChannelArgs,
  parseReleaseChannelCommand,
} from "./build-desktop-channel.js";

const roots: string[] = [];
const publishedAt = "2026-08-08T01:02:03.000Z";

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function fixtureRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "coder-studio-channel-"));
  roots.push(root);
  return root;
}

function runtimeManifest(
  platform: "win32" | "linux",
  overrides: Partial<RuntimeManifestV2> = {}
): RuntimeManifestV2 {
  return {
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
    ...(platform === "win32" ? { webRoot: "web" } : {}),
    packageFile:
      platform === "win32"
        ? "coder-studio-runtime-0.6.0-win32-x64.tgz"
        : "coder-studio-server-runtime-0.6.0-linux-x64.tgz",
    files: [{ path: "server.mjs", sha256: "d".repeat(64), size: 12 }],
    signature: { algorithm: "ed25519", value: "manifest-signature" },
    ...overrides,
  };
}

async function writeProductInputs(root: string, linuxOverrides: Partial<RuntimeManifestV2> = {}) {
  const windowsName = "coder-studio-runtime-win32-x64.manifest.json";
  const linuxName = "coder-studio-server-runtime-linux-x64.manifest.json";
  await Promise.all([
    writeFile(join(root, windowsName), `${JSON.stringify(runtimeManifest("win32"), null, 2)}\n`),
    writeFile(
      join(root, linuxName),
      `${JSON.stringify(runtimeManifest("linux", linuxOverrides), null, 2)}\n`
    ),
  ]);
  return { windowsName, linuxName };
}

async function writeDesktopInputs(root: string) {
  const installer = "Coder-Studio-Setup-0.3.0.exe";
  const engineManifest = "coder-studio-engine-linux-x64.manifest.json";
  await Promise.all([
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
    writeFile(
      join(root, "latest.yml"),
      [
        "version: 0.3.0",
        "files:",
        `  - url: ${installer}`,
        `    sha512: ${Buffer.alloc(64, 7).toString("base64")}`,
        "    size: 18",
        `path: ${installer}`,
        `sha512: ${Buffer.alloc(64, 7).toString("base64")}`,
      ].join("\n")
    ),
    writeFile(join(root, installer), "signed-installer\n"),
    writeFile(
      join(root, engineManifest),
      `${JSON.stringify(
        {
          schemaVersion: 1,
          engineVersion: "2",
          nodeVersion: "24.19.0",
          platform: "linux",
          arch: "x64",
          libc: "glibc",
          packageFile: "coder-studio-engine-2-linux-x64.tgz",
          packageSha256: "e".repeat(64),
          packageSize: 20,
          files: [{ path: "bin/node", sha256: "f".repeat(64), size: 20 }],
          signature: { algorithm: "ed25519", value: "engine-signature" },
        },
        null,
        2
      )}\n`
    ),
    writeFile(
      join(root, "factory-product.json"),
      `${JSON.stringify(
        {
          schemaVersion: 1,
          version: "0.6.0",
          releaseTag: "v0.6.0",
          runtimes: {
            "win32-x64": {
              manifest: "coder-studio-runtime-win32-x64.manifest.json",
              manifestSha256: "a".repeat(64),
            },
            "linux-x64": {
              manifest: "coder-studio-server-runtime-linux-x64.manifest.json",
              manifestSha256: "b".repeat(64),
            },
          },
        },
        null,
        2
      )}\n`
    ),
  ]);
  return { installer, engineManifest };
}

describe("independent release channel builder", () => {
  it("normalizes pnpm arguments and parses explicit Product/Desktop commands", () => {
    expect(
      normalizeReleaseChannelArgs(["--", "product", "--directory", "release/product"])
    ).toEqual(["product", "--directory", "release/product"]);
    expect(
      parseReleaseChannelCommand([
        "product",
        "--directory",
        "release/product",
        "--release-tag",
        "v0.6.0",
        "--generated-at",
        publishedAt,
        "--private-key",
        "release/private.pem",
        "--product-version",
        "0.6.0",
      ])
    ).toMatchObject({ kind: "product", releaseTag: "v0.6.0", productVersion: "0.6.0" });
    expect(() =>
      parseReleaseChannelCommand([
        "desktop",
        "--directory",
        "release/desktop",
        "--release-kind",
        "runtime-only",
      ])
    ).toThrow("Unknown release channel option");
  });

  it("builds one signed Product pointer from exact Windows and WSL manifests", async () => {
    const root = await fixtureRoot();
    const { windowsName, linuxName } = await writeProductInputs(root);
    const keys = generateKeyPairSync("ed25519");
    const privateKeyPem = keys.privateKey.export({ type: "pkcs8", format: "pem" }).toString();
    const publicKeyPem = keys.publicKey.export({ type: "spki", format: "pem" }).toString();

    const channel = await buildProductChannel({
      directory: root,
      releaseTag: "v0.6.0",
      generatedAt: publishedAt,
      productVersion: "0.6.0",
      privateKeyPem,
    });

    expect(
      parseProductChannel(
        channel,
        publicKeyPem,
        "https://github.com/spencerkit/coder-studio/releases/download/product-stable/product-channel.json"
      )
    ).toEqual(channel);
    expect(channel.runtimes["win32-x64"].manifestSha256).toBe(
      createHash("sha256")
        .update(await readFile(join(root, windowsName)))
        .digest("hex")
    );
    expect(channel.runtimes["linux-x64"].manifestSha256).toBe(
      createHash("sha256")
        .update(await readFile(join(root, linuxName)))
        .digest("hex")
    );
    await expect(readFile(join(root, "product-channel.json"), "utf8")).resolves.toContain(
      '"channel": "product"'
    );
  });

  it("rejects Product inputs that do not describe one release", async () => {
    const root = await fixtureRoot();
    await writeProductInputs(root, { runtimeVersion: "0.7.0" });
    const keys = generateKeyPairSync("ed25519");

    await expect(
      buildProductChannel({
        directory: root,
        releaseTag: "v0.6.0",
        generatedAt: publishedAt,
        productVersion: "0.6.0",
        privateKeyPem: keys.privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
      })
    ).rejects.toThrow("one Product release");
  });

  it("builds one signed Desktop pointer with Engine and Factory Product provenance", async () => {
    const root = await fixtureRoot();
    const { engineManifest, installer } = await writeDesktopInputs(root);
    const keys = generateKeyPairSync("ed25519");
    const privateKeyPem = keys.privateKey.export({ type: "pkcs8", format: "pem" }).toString();
    const publicKeyPem = keys.publicKey.export({ type: "spki", format: "pem" }).toString();

    const channel = await buildDesktopChannel({
      directory: root,
      releaseTag: "desktop-v0.3.0",
      generatedAt: publishedAt,
      privateKeyPem,
      factoryProductFile: "factory-product.json",
    });

    expect(
      parseDesktopChannel(
        channel,
        publicKeyPem,
        "https://github.com/spencerkit/coder-studio/releases/download/desktop-stable/desktop-channel.json"
      )
    ).toEqual(channel);
    expect(channel.shell.installer).toBe(installer);
    expect(channel.factoryProduct).toMatchObject({ version: "0.6.0", releaseTag: "v0.6.0" });
    expect(channel.wslEngine.manifestSha256).toBe(
      createHash("sha256")
        .update(await readFile(join(root, engineManifest)))
        .digest("hex")
    );
    await expect(readFile(join(root, "desktop-channel.json"), "utf8")).resolves.toContain(
      '"channel": "desktop"'
    );
  });

  it("rejects a Desktop Engine that differs from packaged Shell capabilities", async () => {
    const root = await fixtureRoot();
    const { engineManifest } = await writeDesktopInputs(root);
    const value = JSON.parse(await readFile(join(root, engineManifest), "utf8"));
    await writeFile(
      join(root, engineManifest),
      `${JSON.stringify({ ...value, nodeVersion: "25.0.0" })}\n`
    );
    const keys = generateKeyPairSync("ed25519");

    await expect(
      buildDesktopChannel({
        directory: root,
        releaseTag: "desktop-v0.3.0",
        generatedAt: publishedAt,
        privateKeyPem: keys.privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
        factoryProductFile: "factory-product.json",
      })
    ).rejects.toThrow("Engine metadata does not match");
  });
});
