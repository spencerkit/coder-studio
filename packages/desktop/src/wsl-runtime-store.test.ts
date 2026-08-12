import { spawn } from "node:child_process";
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  DESKTOP_ENGINE_VERSION,
  getRuntimeManifestSigningPayload,
  type RuntimeManifestV2,
} from "./runtime-manifest.js";
import type { WslCommandRunner } from "./wsl-command.js";
import type { WslDistroProbe } from "./wsl-discovery.js";
import { WslRuntimeStoreClient } from "./wsl-runtime-store.js";

const cleanupRoots: string[] = [];
const signingKeys = generateKeyPairSync("ed25519");
const publicKeyPem = signingKeys.publicKey.export({ type: "spki", format: "pem" }).toString();

afterEach(async () => {
  await Promise.all(
    cleanupRoots.splice(0).map((root) => rm(root, { recursive: true, force: true }))
  );
});

const localNodeRunner: WslCommandRunner = async (args) => {
  const scriptIndex = args.indexOf("-e");
  if (scriptIndex < 0) throw new Error("Expected an inline Node script");
  return new Promise((resolveResult, rejectResult) => {
    const child = spawn(process.execPath, args.slice(scriptIndex), {
      stdio: ["ignore", "pipe", "pipe"],
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
    child.once("error", rejectResult);
    child.once("close", (exitCode) =>
      resolveResult({
        stdout: Buffer.concat(stdout),
        stderr: Buffer.concat(stderr),
        exitCode: exitCode ?? -1,
      })
    );
  });
};

function createProbe(dataRoot: string): WslDistroProbe {
  return {
    target: { id: "wsl:test", kind: "wsl", label: "WSL: Test", distro: "Test" },
    home: "/home/test",
    dataRoot,
    arch: process.arch === "arm64" ? "arm64" : "x64",
    kernel: "microsoft-standard-WSL2",
    libc: "glibc 2.39",
    engineInstalled: true,
    installed: true,
    supported: true,
  };
}

async function writeRuntime(
  root: string,
  runtimeVersion: string,
  source: string,
  options: {
    mutateManifest?: (manifest: RuntimeManifestV2) => void;
    storageId?: string;
  } = {}
) {
  const bytes = Buffer.from(source);
  const unsigned: RuntimeManifestV2 = {
    schemaVersion: 2,
    publishedAt: "2026-08-08T01:02:03.000Z",
    runtimeVersion,
    minShellVersion: "0.1.0",
    requiredEngineVersion: DESKTOP_ENGINE_VERSION,
    requiredNodeVersion: "24.19.0",
    runtimeHostApiVersion: 1,
    apiProtocolVersion: 1,
    dataSchemaVersion: 1,
    platform: "linux",
    arch: process.arch === "arm64" ? "arm64" : "x64",
    entrypoint: "server.mjs",
    files: [
      {
        path: "server.mjs",
        sha256: createHash("sha256").update(bytes).digest("hex"),
        size: bytes.byteLength,
      },
    ],
  };
  options.mutateManifest?.(unsigned);
  const manifest: RuntimeManifestV2 = {
    ...unsigned,
    signature: {
      algorithm: "ed25519",
      value: sign(
        null,
        getRuntimeManifestSigningPayload(unsigned),
        signingKeys.privateKey
      ).toString("base64"),
    },
  };
  const id = createHash("sha256")
    .update(getRuntimeManifestSigningPayload(manifest))
    .digest("hex")
    .slice(0, 24);
  const storageId = options.storageId ?? id;
  const runtimeRoot = resolve(root, "runtime-store", "versions", storageId);
  await mkdir(runtimeRoot, { recursive: true });
  await writeFile(resolve(runtimeRoot, "server.mjs"), bytes);
  await writeFile(resolve(runtimeRoot, "manifest.json"), JSON.stringify(manifest));
  return { id: storageId, runtimeVersion, installedAt: "2026-08-05T00:00:00Z" };
}

describe("WslRuntimeStoreClient", () => {
  it("reads only a valid quarantined Runtime version", async () => {
    const dataRoot = await mkdtemp(resolve(tmpdir(), "coder-studio-wsl-runtime-store-test-"));
    cleanupRoots.push(dataRoot);
    const runtimeStoreRoot = resolve(dataRoot, "runtime-store");
    await mkdir(runtimeStoreRoot, { recursive: true });
    const client = new WslRuntimeStoreClient({
      probe: createProbe(dataRoot),
      runner: localNodeRunner,
      publicKeyPem,
    });

    await expect(client.readFailedVersion()).resolves.toBeNull();
    await writeFile(
      resolve(runtimeStoreRoot, "failed.json"),
      JSON.stringify({ runtimeVersion: "0.6.0", ignored: "secret" })
    );
    await expect(client.readFailedVersion()).resolves.toBe("0.6.0");
    await writeFile(resolve(runtimeStoreRoot, "failed.json"), "not-json");
    await expect(client.readFailedVersion()).resolves.toBeNull();
  });

  it("activates a verified pending Runtime and falls back when a newer pending copy is corrupt", async () => {
    const dataRoot = await mkdtemp(resolve(tmpdir(), "coder-studio-wsl-runtime-store-test-"));
    cleanupRoots.push(dataRoot);
    const runtimeStoreRoot = resolve(dataRoot, "runtime-store");
    await mkdir(runtimeStoreRoot, { recursive: true });
    const first = await writeRuntime(dataRoot, "0.5.6", "console.log('first')");
    await writeFile(resolve(runtimeStoreRoot, "pending.json"), JSON.stringify(first));

    const client = new WslRuntimeStoreClient({
      probe: createProbe(dataRoot),
      runner: localNodeRunner,
      publicKeyPem,
    });
    const pending = await client.getLaunchCandidate();
    expect(pending).toMatchObject({ source: "pending", pointer: first });

    await client.markLaunchSuccessful(pending);
    await expect(client.getLaunchCandidate()).resolves.toMatchObject({
      source: "active",
      pointer: first,
    });

    const second = await writeRuntime(dataRoot, "0.5.7", "console.log('second')");
    await writeFile(resolve(runtimeStoreRoot, "pending.json"), JSON.stringify(second));
    await writeFile(
      resolve(runtimeStoreRoot, "versions", second.id, "server.mjs"),
      "corrupt payload"
    );

    await expect(client.getLaunchCandidate()).resolves.toMatchObject({
      source: "active",
      pointer: first,
    });
    await expect(readFile(resolve(runtimeStoreRoot, "pending.json"), "utf8")).rejects.toMatchObject(
      {
        code: "ENOENT",
      }
    );
  });

  it("ignores but preserves a pending Runtime that does not match the shared Web version", async () => {
    const dataRoot = await mkdtemp(resolve(tmpdir(), "coder-studio-wsl-runtime-store-test-"));
    cleanupRoots.push(dataRoot);
    const runtimeStoreRoot = resolve(dataRoot, "runtime-store");
    await mkdir(runtimeStoreRoot, { recursive: true });
    const active = await writeRuntime(dataRoot, "0.5.6", "console.log('active')");
    await writeFile(resolve(runtimeStoreRoot, "pending.json"), JSON.stringify(active));
    const client = new WslRuntimeStoreClient({
      probe: createProbe(dataRoot),
      runner: localNodeRunner,
      publicKeyPem,
    });
    await client.markLaunchSuccessful(
      await client.getLaunchCandidate({ requiredRuntimeVersion: "0.5.6" })
    );

    const pending = await writeRuntime(dataRoot, "0.5.7", "console.log('pending')");
    await writeFile(resolve(runtimeStoreRoot, "pending.json"), JSON.stringify(pending));

    const activeCandidate = await client.getLaunchCandidate({ requiredRuntimeVersion: "0.5.6" });
    expect(activeCandidate).toMatchObject({
      root: `${dataRoot}/runtime-store/versions/${active.id}`,
      source: "active",
      pointer: active,
    });
    await client.markLaunchSuccessful(activeCandidate);
    await expect(readFile(resolve(runtimeStoreRoot, "pending.json"), "utf8")).resolves.toBe(
      JSON.stringify(pending)
    );
    await expect(
      readFile(resolve(runtimeStoreRoot, "versions", pending.id, "server.mjs"), "utf8")
    ).resolves.toBe("console.log('pending')");

    const pendingCandidate = await client.getLaunchCandidate({
      requiredRuntimeVersion: "0.5.7",
    });
    expect(pendingCandidate).toMatchObject({ source: "pending", pointer: pending });
    await client.markLaunchSuccessful(pendingCandidate);
    await expect(readFile(resolve(runtimeStoreRoot, "active.json"), "utf8")).resolves.toContain(
      '"runtimeVersion": "0.5.7"'
    );
  });

  it("rejects a signed Runtime with an unsafe entrypoint", async () => {
    const dataRoot = await mkdtemp(resolve(tmpdir(), "coder-studio-wsl-runtime-store-test-"));
    cleanupRoots.push(dataRoot);
    const runtimeStoreRoot = resolve(dataRoot, "runtime-store");
    await mkdir(runtimeStoreRoot, { recursive: true });
    const pending = await writeRuntime(dataRoot, "0.5.6", "console.log('unsafe')", {
      mutateManifest: (manifest) => {
        manifest.entrypoint = "../../payload.js";
      },
    });
    await writeFile(resolve(runtimeStoreRoot, "pending.json"), JSON.stringify(pending));
    const client = new WslRuntimeStoreClient({
      probe: createProbe(dataRoot),
      runner: localNodeRunner,
      publicKeyPem,
    });

    await expect(client.getLaunchCandidate()).rejects.toThrow(/No trusted WSL Server Runtime/);
    await expect(readFile(resolve(runtimeStoreRoot, "pending.json"), "utf8")).rejects.toMatchObject(
      {
        code: "ENOENT",
      }
    );
  });

  it("rejects a Runtime pointer whose id does not match the signed manifest", async () => {
    const dataRoot = await mkdtemp(resolve(tmpdir(), "coder-studio-wsl-runtime-store-test-"));
    cleanupRoots.push(dataRoot);
    const runtimeStoreRoot = resolve(dataRoot, "runtime-store");
    await mkdir(runtimeStoreRoot, { recursive: true });
    const pending = await writeRuntime(dataRoot, "0.5.6", "console.log('mismatch')", {
      storageId: "000000000000000000000000",
    });
    await writeFile(resolve(runtimeStoreRoot, "pending.json"), JSON.stringify(pending));
    const client = new WslRuntimeStoreClient({
      probe: createProbe(dataRoot),
      runner: localNodeRunner,
      publicKeyPem,
    });

    await expect(client.getLaunchCandidate()).rejects.toThrow(/No trusted WSL Server Runtime/);
    await expect(readFile(resolve(runtimeStoreRoot, "pending.json"), "utf8")).rejects.toMatchObject(
      {
        code: "ENOENT",
      }
    );
  });

  it("removes a pending pointer whose manifest is missing", async () => {
    const dataRoot = await mkdtemp(resolve(tmpdir(), "coder-studio-wsl-runtime-store-test-"));
    cleanupRoots.push(dataRoot);
    const runtimeStoreRoot = resolve(dataRoot, "runtime-store");
    await mkdir(runtimeStoreRoot, { recursive: true });
    await writeFile(
      resolve(runtimeStoreRoot, "pending.json"),
      JSON.stringify({
        id: "000000000000000000000000",
        runtimeVersion: "0.5.6",
        installedAt: "2026-08-05T00:00:00Z",
      })
    );
    const client = new WslRuntimeStoreClient({
      probe: createProbe(dataRoot),
      runner: localNodeRunner,
      publicKeyPem,
    });

    await expect(client.getLaunchCandidate()).rejects.toThrow(/No trusted WSL Server Runtime/);
    await expect(readFile(resolve(runtimeStoreRoot, "pending.json"), "utf8")).rejects.toMatchObject(
      {
        code: "ENOENT",
      }
    );
  });

  it("restores a trusted previous Runtime when the active Runtime is invalid", async () => {
    const dataRoot = await mkdtemp(resolve(tmpdir(), "coder-studio-wsl-runtime-store-test-"));
    cleanupRoots.push(dataRoot);
    const runtimeStoreRoot = resolve(dataRoot, "runtime-store");
    await mkdir(runtimeStoreRoot, { recursive: true });
    const client = new WslRuntimeStoreClient({
      probe: createProbe(dataRoot),
      runner: localNodeRunner,
      publicKeyPem,
    });
    const activate = async (version: string) => {
      const pointer = await writeRuntime(dataRoot, version, `console.log('${version}')`);
      await writeFile(resolve(runtimeStoreRoot, "pending.json"), JSON.stringify(pointer));
      await client.markLaunchSuccessful(await client.getLaunchCandidate());
      return pointer;
    };
    const previous = await activate("0.5.6");
    const active = await activate("0.5.7");
    await writeFile(
      resolve(runtimeStoreRoot, "versions", active.id, "server.mjs"),
      "corrupt payload"
    );

    await expect(client.getLaunchCandidate()).resolves.toMatchObject({
      source: "active",
      pointer: previous,
    });
    await expect(readFile(resolve(runtimeStoreRoot, "active.json"), "utf8")).resolves.toBe(
      JSON.stringify({ active: previous }, null, 2)
    );
  });

  it("keeps the current and previous Runtime and removes obsolete Runtime and Engine versions", async () => {
    const dataRoot = await mkdtemp(resolve(tmpdir(), "coder-studio-wsl-runtime-store-test-"));
    cleanupRoots.push(dataRoot);
    const runtimeStoreRoot = resolve(dataRoot, "runtime-store");
    const versionsRoot = resolve(runtimeStoreRoot, "versions");
    const engineVersionsRoot = resolve(dataRoot, "engine", "versions");
    await Promise.all([
      mkdir(runtimeStoreRoot, { recursive: true }),
      mkdir(resolve(engineVersionsRoot, "old-engine"), { recursive: true }),
      mkdir(resolve(engineVersionsRoot, DESKTOP_ENGINE_VERSION), { recursive: true }),
    ]);
    const client = new WslRuntimeStoreClient({
      probe: createProbe(dataRoot),
      runner: localNodeRunner,
      publicKeyPem,
    });
    const activate = async (version: string) => {
      const pointer = await writeRuntime(dataRoot, version, `console.log('${version}')`);
      await writeFile(resolve(runtimeStoreRoot, "pending.json"), JSON.stringify(pointer));
      const pending = await client.getLaunchCandidate();
      await client.markLaunchSuccessful(pending);
      return pointer;
    };

    const first = await activate("0.5.6");
    const orphan = await writeRuntime(dataRoot, "0.5.0", "console.log('orphan')");
    const second = await activate("0.5.7");
    expect((await readdir(versionsRoot)).sort()).toEqual([first.id, second.id].sort());
    expect(await readdir(engineVersionsRoot)).toEqual([DESKTOP_ENGINE_VERSION]);
    await expect(
      readFile(resolve(versionsRoot, orphan.id, "server.mjs"), "utf8")
    ).rejects.toMatchObject({ code: "ENOENT" });

    const third = await activate("0.5.8");
    expect((await readdir(versionsRoot)).sort()).toEqual([second.id, third.id].sort());
  });
});
