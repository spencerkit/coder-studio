import { createHash, generateKeyPairSync, type KeyObject, sign } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { create } from "tar";
import { afterEach, describe, expect, it, vi } from "vitest";
import { type EngineManifest, getEngineManifestSigningPayload } from "./engine-manifest.js";
import { getRuntimeManifestSigningPayload, type RuntimeManifest } from "./runtime-manifest.js";
import type { WslCommandRunner } from "./wsl-command.js";
import type { WslDistroProbe } from "./wsl-discovery.js";
import { WslInstaller } from "./wsl-installer.js";

const cleanupRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    cleanupRoots.splice(0).map((root) => rm(root, { recursive: true, force: true }))
  );
});

function fileEntry(path: string, bytes: Buffer) {
  return {
    path,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    size: bytes.byteLength,
  };
}

function signEngine(manifest: EngineManifest, privateKey: KeyObject): EngineManifest {
  return {
    ...manifest,
    signature: {
      algorithm: "ed25519",
      value: sign(null, getEngineManifestSigningPayload(manifest), privateKey).toString("base64"),
    },
  };
}

function signRuntime(manifest: RuntimeManifest, privateKey: KeyObject): RuntimeManifest {
  return {
    ...manifest,
    signature: {
      algorithm: "ed25519",
      value: sign(null, getRuntimeManifestSigningPayload(manifest), privateKey).toString("base64"),
    },
  };
}

async function createArchive(root: string, name: string, files: Record<string, Buffer | string>) {
  const payloadRoot = resolve(root, `${name}-payload`);
  await mkdir(payloadRoot, { recursive: true });
  for (const [path, content] of Object.entries(files)) {
    const destination = resolve(payloadRoot, ...path.split("/"));
    await mkdir(resolve(destination, ".."), { recursive: true });
    await writeFile(destination, content);
  }
  const archivePath = resolve(root, `${name}.tgz`);
  await create(
    { cwd: payloadRoot, file: archivePath, gzip: true, portable: true },
    Object.keys(files)
  );
  return readFile(archivePath);
}

function createProbe(): WslDistroProbe {
  return {
    target: {
      id: "wsl:ubuntu",
      kind: "wsl",
      label: "WSL: Ubuntu-24.04",
      distro: "Ubuntu-24.04",
    },
    home: "/home/alice",
    dataRoot: "/home/alice/.local/share/coder-studio-desktop",
    arch: "x64",
    kernel: "microsoft-standard-WSL2",
    libc: "glibc 2.39",
    engineInstalled: false,
    installed: false,
    supported: true,
  };
}

describe("WslInstaller", () => {
  it("verifies signed Engine and Server Runtime packages before streaming them to WSL", async () => {
    const root = await mkdtemp(resolve(tmpdir(), "coder-studio-wsl-installer-test-"));
    cleanupRoots.push(root);
    const { privateKey, publicKey } = generateKeyPairSync("ed25519");

    const nodeBytes = Buffer.from("linux-node");
    const engineArchive = await createArchive(root, "engine", { "bin/node": nodeBytes });
    const engineManifest = signEngine(
      {
        schemaVersion: 1,
        engineVersion: "1",
        nodeVersion: "24.19.0",
        platform: "linux",
        arch: "x64",
        libc: "glibc",
        packageFile: "engine.tgz",
        packageSha256: createHash("sha256").update(engineArchive).digest("hex"),
        packageSize: engineArchive.byteLength,
        files: [fileEntry("bin/node", nodeBytes)],
      },
      privateKey
    );

    const serverBytes = Buffer.from("console.log('server')");
    const runtimeManifest = signRuntime(
      {
        schemaVersion: 1,
        runtimeVersion: "0.5.6",
        minShellVersion: "0.1.0",
        requiredEngineVersion: "1",
        requiredNodeVersion: "24.19.0",
        runtimeHostApiVersion: 1,
        apiProtocolVersion: 1,
        dataSchemaVersion: 1,
        platform: "linux",
        arch: "x64",
        entrypoint: "server.mjs",
        packageFile: "runtime.tgz",
        files: [fileEntry("server.mjs", serverBytes)],
      },
      privateKey
    );
    const runtimeArchive = await createArchive(root, "runtime", {
      "server.mjs": serverBytes,
      "manifest.json": `${JSON.stringify(runtimeManifest, null, 2)}\n`,
    });

    const responses = new Map<string, Response>([
      ["https://releases.example/engine.manifest.json", Response.json(engineManifest)],
      ["https://releases.example/runtime.manifest.json", Response.json(runtimeManifest)],
      ["https://releases.example/engine.tgz", new Response(engineArchive)],
      ["https://releases.example/runtime.tgz", new Response(runtimeArchive)],
    ]);
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const response = responses.get(String(input));
      if (!response) return new Response(null, { status: 404 });
      return response.clone();
    });
    const fetchImpl = fetchMock as unknown as typeof fetch;
    const runner = vi.fn<WslCommandRunner>(async (_args, _input) => ({
      stdout: Buffer.alloc(0),
      stderr: Buffer.alloc(0),
      exitCode: 0,
    }));
    const progress = vi.fn();

    const installer = new WslInstaller({
      publicKeyPem: publicKey.export({ type: "spki", format: "pem" }).toString(),
      shellVersion: "0.1.0",
      nodeVersion: "24.19.0",
      runtimeVersion: "0.5.6",
      engineManifestUrl: () => "https://releases.example/engine.manifest.json",
      runtimeManifestUrl: () => "https://releases.example/runtime.manifest.json",
      fetch: fetchImpl,
      runner,
      onProgress: progress,
    });

    const installed = await installer.prepare(createProbe());
    expect(installed).toMatchObject({
      engineRoot: "/home/alice/.local/share/coder-studio-desktop/engine/versions/1",
      manifest: { runtimeVersion: "0.5.6" },
    });
    expect(installed.manifest).not.toHaveProperty("webRoot");
    expect(runner).toHaveBeenCalledTimes(2);
    expect(runner.mock.calls[0]?.[0]).toContain("/bin/sh");
    expect(runner.mock.calls[0]?.[1]).toBeInstanceOf(Buffer);
    expect(runner.mock.calls[1]?.[0]).toContain("runtime-store");
    expect(progress).toHaveBeenLastCalledWith({
      phase: "verifying",
      message: "WSL environment is ready.",
      percent: 100,
    });

    runner.mockClear();
    fetchMock.mockClear();
    await installer.prepare({ ...createProbe(), engineInstalled: true });
    expect(fetchMock).not.toHaveBeenCalledWith(
      "https://releases.example/engine.manifest.json",
      expect.anything()
    );
    expect(runner).toHaveBeenCalledTimes(1);
    expect(runner.mock.calls[0]?.[0]).toContain("runtime-store");
  });
});
