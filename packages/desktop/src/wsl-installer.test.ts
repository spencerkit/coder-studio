import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import { createHash, generateKeyPairSync, type KeyObject, sign } from "node:crypto";
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { create } from "tar";
import { afterEach, describe, expect, it, vi } from "vitest";
import { type EngineManifest, getEngineManifestSigningPayload } from "./engine-manifest.js";
import {
  DESKTOP_ENGINE_VERSION,
  getRuntimeManifestSigningPayload,
  type RuntimeManifest,
} from "./runtime-manifest.js";
import type { WslCommandRunner } from "./wsl-command.js";
import type { WslDistroProbe } from "./wsl-discovery.js";
import { WSL_INSTALL_SCRIPT, WslInstaller } from "./wsl-installer.js";

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

async function waitForPath(path: string): Promise<void> {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    try {
      await access(path);
      return;
    } catch {
      await new Promise((resolveWait) => setTimeout(resolveWait, 10));
    }
  }
  throw new Error(`Timed out waiting for ${path}`);
}

function finishInstall(child: ChildProcessWithoutNullStreams, archive: Buffer): Promise<number> {
  child.stdout.resume();
  child.stderr.resume();
  child.stdin.on("error", () => undefined);
  child.stdin.end(archive);
  return new Promise((resolveExit, rejectExit) => {
    child.once("error", rejectExit);
    child.once("exit", (code) => resolveExit(code ?? -1));
  });
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
  it.runIf(process.platform !== "win32")(
    "publishes complete lock ownership before rejecting a concurrent installer",
    async () => {
      const root = await mkdtemp(resolve(tmpdir(), "coder-studio-wsl-lock-test-"));
      cleanupRoots.push(root);
      const archive = await createArchive(root, "lock-runtime", {
        "server.mjs": "console.log('lock')",
      });
      const dataRoot = resolve(root, "data");
      const args = [
        "-c",
        WSL_INSTALL_SCRIPT,
        "coder-studio-install",
        dataRoot,
        "runtime-store",
        "0.5.6",
        "a".repeat(24),
      ];
      const first = spawn("/bin/sh", args, { stdio: ["pipe", "pipe", "pipe"] });
      let second: ChildProcessWithoutNullStreams | null = null;
      try {
        await waitForPath(resolve(dataRoot, "install.lock"));
        await expect(readFile(resolve(dataRoot, "install.lock"), "utf8")).resolves.toMatch(
          /^pid=\d+\nstarted=\d+\nowner=.+\n$/
        );

        second = spawn("/bin/sh", args, { stdio: ["pipe", "pipe", "pipe"] });
        await expect(finishInstall(second, archive)).resolves.toBe(73);
        await expect(finishInstall(first, archive)).resolves.toBe(0);
      } finally {
        if (first.exitCode === null) first.kill("SIGKILL");
        if (second?.exitCode === null) second.kill("SIGKILL");
      }
    },
    15_000
  );

  it("verifies signed Engine and Server Runtime packages before streaming them to WSL", async () => {
    const root = await mkdtemp(resolve(tmpdir(), "coder-studio-wsl-installer-test-"));
    cleanupRoots.push(root);
    const { privateKey, publicKey } = generateKeyPairSync("ed25519");

    const nodeBytes = Buffer.from("linux-node");
    const engineArchive = await createArchive(root, "engine", { "bin/node": nodeBytes });
    const engineManifest = signEngine(
      {
        schemaVersion: 1,
        engineVersion: DESKTOP_ENGINE_VERSION,
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
        schemaVersion: 2,
        publishedAt: "2026-08-08T01:02:03.000Z",
        runtimeVersion: "0.5.6",
        minShellVersion: "0.1.0",
        requiredEngineVersion: DESKTOP_ENGINE_VERSION,
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
    const runtimeManifestBody = JSON.stringify(runtimeManifest);

    const responses = new Map<string, Response>([
      ["https://releases.example/engine.manifest.json", Response.json(engineManifest)],
      ["https://releases.example/runtime.manifest.json", Response.json(runtimeManifest)],
      ["https://immutable.example/engine.manifest.json", Response.json(engineManifest)],
      ["https://immutable.example/runtime.manifest.json", Response.json(runtimeManifest)],
      [
        "https://github.com/spencerkit/coder-studio/releases/download/v0.5.6/runtime.manifest.json",
        new Response(runtimeManifestBody),
      ],
      ["https://releases.example/engine.tgz", new Response(engineArchive)],
      ["https://releases.example/runtime.tgz", new Response(runtimeArchive)],
      ["https://immutable.example/engine.tgz", new Response(engineArchive)],
      ["https://immutable.example/runtime.tgz", new Response(runtimeArchive)],
      [
        "https://github.com/spencerkit/coder-studio/releases/download/v0.5.6/runtime.tgz",
        new Response(runtimeArchive),
      ],
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
      productChannelUrl:
        "https://github.com/spencerkit/coder-studio/releases/download/product-stable/product-channel.json",
      factoryEngineManifestUrl: () => "https://immutable.example/engine.manifest.json",
      factoryRuntimeManifestUrl: () => "https://immutable.example/runtime.manifest.json",
      fetch: fetchImpl,
      runner,
      onProgress: progress,
    });

    const metadata = await installer.checkRuntime(
      createProbe(),
      {
        version: "0.5.6",
        publishedAt: "2026-08-08T01:02:03.000Z",
        manifest: "runtime.manifest.json",
        manifestSha256: createHash("sha256").update(runtimeManifestBody).digest("hex"),
      },
      "0.1.0",
      "v0.5.6"
    );
    expect(metadata).toMatchObject({
      componentId: "runtime:linux-x64",
      version: "0.5.6",
      publishedAt: "2026-08-08T01:02:03.000Z",
      manifestUrl:
        "https://github.com/spencerkit/coder-studio/releases/download/v0.5.6/runtime.manifest.json",
      engineManifestUrl: "https://releases.example/engine.manifest.json",
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(runner).not.toHaveBeenCalled();
    fetchMock.mockClear();

    const installed = await installer.downloadAndStageRuntime(metadata, {
      signal: new AbortController().signal,
      onProgress: () => {},
      explicitRetry: false,
    });
    expect(installed).toMatchObject({
      engineRoot: `/home/alice/.local/share/coder-studio-desktop/engine/versions/${DESKTOP_ENGINE_VERSION}`,
      manifest: { runtimeVersion: "0.5.6" },
    });
    expect(installed.manifest).not.toHaveProperty("webRoot");
    expect(runner).toHaveBeenCalledTimes(2);
    expect(runner.mock.calls[0]?.[0]).toContain("/bin/sh");
    expect(runner.mock.calls[0]?.[1]).toBeInstanceOf(Buffer);
    const installArgs = runner.mock.calls[0]?.[0] ?? [];
    const installScript = installArgs[installArgs.indexOf("-c") + 1] ?? "";
    expect(installScript.indexOf('mkdir -p "$root"')).toBeGreaterThanOrEqual(0);
    expect(installScript.indexOf('> "$owner_file"')).toBeLessThan(
      installScript.indexOf('ln "$owner_file" "$lock"')
    );
    expect(installScript).not.toContain('mkdir "$lock"');
    expect(installScript).toContain('current_started="$(cut -d " " -f 22');
    expect(installScript).toContain('mv "$lock" "$stale"');
    expect(installScript).toContain('if test -d "$lock"');
    expect(installScript).toContain("sleep 1");
    expect(runner.mock.calls[1]?.[0]).toContain("runtime-store");
    expect(progress).toHaveBeenLastCalledWith({
      phase: "verifying",
      message: "WSL environment is ready.",
      percent: 100,
    });

    runner.mockClear();
    fetchMock.mockClear();
    await installer.prepare(createProbe());
    expect(fetchMock).toHaveBeenCalledWith(
      "https://immutable.example/engine.manifest.json",
      expect.anything()
    );
    expect(fetchMock).toHaveBeenCalledWith(
      "https://immutable.example/runtime.manifest.json",
      expect.anything()
    );
    expect(fetchMock).toHaveBeenCalledWith(
      "https://immutable.example/engine.tgz",
      expect.anything()
    );
    expect(fetchMock).toHaveBeenCalledWith(
      "https://immutable.example/runtime.tgz",
      expect.anything()
    );
    expect(fetchMock).not.toHaveBeenCalledWith(
      "https://releases.example/engine.manifest.json",
      expect.anything()
    );
    expect(fetchMock).not.toHaveBeenCalledWith(
      "https://releases.example/runtime.manifest.json",
      expect.anything()
    );
    expect(runner).toHaveBeenCalledTimes(2);
    expect(runner.mock.calls[1]?.[0]).toContain("runtime-store");
    expect(runner.mock.calls.flat().join(" ")).not.toMatch(/npm|pnpm|yarn/);
  });
});
