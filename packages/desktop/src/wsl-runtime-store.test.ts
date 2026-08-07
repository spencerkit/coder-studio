import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { DESKTOP_ENGINE_VERSION, type RuntimeManifest } from "./runtime-manifest.js";
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
    });
    const activate = async (id: string, version: string) => {
      const pointer = await writeRuntime(dataRoot, id, version, `console.log('${version}')`);
      await writeFile(resolve(runtimeStoreRoot, "pending.json"), JSON.stringify(pointer));
      const pending = await client.getLaunchCandidate();
      await client.markLaunchSuccessful(pending);
      return pointer;
    };

    const first = await activate("111111111111111111111111", "0.5.6");
    const orphan = await writeRuntime(
      dataRoot,
      "999999999999999999999999",
      "0.5.0",
      "console.log('orphan')"
    );
    const second = await activate("222222222222222222222222", "0.5.7");
    expect((await readdir(versionsRoot)).sort()).toEqual([first.id, second.id].sort());
    expect(await readdir(engineVersionsRoot)).toEqual([DESKTOP_ENGINE_VERSION]);
    await expect(
      readFile(resolve(versionsRoot, orphan.id, "server.mjs"), "utf8")
    ).rejects.toMatchObject({ code: "ENOENT" });

    const third = await activate("333333333333333333333333", "0.5.8");
    expect((await readdir(versionsRoot)).sort()).toEqual([second.id, third.id].sort());
  });
});
