import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { RuntimeManifest } from "./runtime-manifest.js";
import type { WslCommandRunner } from "./wsl-command.js";
import type { WslDistroProbe } from "./wsl-discovery.js";
import { WslRuntimeStoreClient } from "./wsl-runtime-store.js";

const cleanupRoots: string[] = [];

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

async function writeRuntime(root: string, id: string, runtimeVersion: string, source: string) {
  const runtimeRoot = resolve(root, "runtime-store", "versions", id);
  await mkdir(runtimeRoot, { recursive: true });
  const bytes = Buffer.from(source);
  await writeFile(resolve(runtimeRoot, "server.mjs"), bytes);
  const manifest: RuntimeManifest = {
    schemaVersion: 1,
    runtimeVersion,
    minShellVersion: "0.1.0",
    requiredEngineVersion: "1",
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
  await writeFile(resolve(runtimeRoot, "manifest.json"), JSON.stringify(manifest));
  return { id, runtimeVersion, installedAt: "2026-08-05T00:00:00Z" };
}

describe("WslRuntimeStoreClient", () => {
  it("activates a verified pending Runtime and falls back when a newer pending copy is corrupt", async () => {
    const dataRoot = await mkdtemp(resolve(tmpdir(), "coder-studio-wsl-runtime-store-test-"));
    cleanupRoots.push(dataRoot);
    const runtimeStoreRoot = resolve(dataRoot, "runtime-store");
    await mkdir(runtimeStoreRoot, { recursive: true });
    const first = await writeRuntime(
      dataRoot,
      "111111111111111111111111",
      "0.5.6",
      "console.log('first')"
    );
    await writeFile(resolve(runtimeStoreRoot, "pending.json"), JSON.stringify(first));

    const client = new WslRuntimeStoreClient({
      probe: createProbe(dataRoot),
      runner: localNodeRunner,
    });
    const pending = await client.getLaunchCandidate();
    expect(pending).toMatchObject({ source: "pending", pointer: first });

    await client.markLaunchSuccessful(pending);
    await expect(client.getLaunchCandidate()).resolves.toMatchObject({
      source: "active",
      pointer: first,
    });

    const second = await writeRuntime(
      dataRoot,
      "222222222222222222222222",
      "0.5.7",
      "console.log('second')"
    );
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
});
