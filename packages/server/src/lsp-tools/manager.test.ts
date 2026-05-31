import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { Workspace } from "@coder-studio/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { VUE_MANAGED_VERSION } from "./definitions.js";
import { LspToolManager } from "./manager.js";
import { FileManifestStore } from "./manifest-store.js";

const workspace: Workspace = {
  id: "ws-1",
  path: "/repo",
  targetRuntime: "native",
  openedAt: 1,
  lastActiveAt: 1,
  uiState: { leftPanelWidth: 240, bottomPanelHeight: 180, focusMode: false },
};

describe("LspToolManager.resolve", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("prefers an env override over managed, bundled, and system sources", async () => {
    const root = mkdtempSync(join(tmpdir(), "lsp-tools-"));
    const manager = new LspToolManager({
      manifestStore: new FileManifestStore(root),
      commandExists: vi.fn(async () => true),
      resolveBundledCommand: vi.fn(() => ({
        command: "/bundled/tsls",
        args: ["--stdio"],
      })),
    });

    const result = await manager.resolve({
      workspace,
      serverKind: "typescript",
      env: {
        CODER_STUDIO_LSP_TYPESCRIPT_COMMAND: "node",
        CODER_STUDIO_LSP_TYPESCRIPT_ARGS_JSON: '["scripts/fake-tsls.mjs"]',
      },
    });

    expect(result).toMatchObject({
      kind: "ready",
      source: "override",
      command: "node",
      args: ["scripts/fake-tsls.mjs"],
    });
  });

  it("prefers a managed install over bundled and system sources", async () => {
    const root = mkdtempSync(join(tmpdir(), "lsp-tools-"));
    const executablePath = join(root, "python", "1.14.0", "bin", "pylsp");
    mkdirSync(dirname(executablePath), { recursive: true });
    writeFileSync(executablePath, "#!/bin/sh\nexit 0\n", { mode: 0o755 });
    writeFileSync(
      join(root, "python", "manifest.json"),
      JSON.stringify({
        serverKind: "python",
        version: "1.14.0",
        executablePath,
        installedAt: 1,
        source: "managed",
        platform: process.platform,
      })
    );

    const manager = new LspToolManager({
      manifestStore: new FileManifestStore(root),
      commandExists: vi.fn(async () => true),
      resolveBundledCommand: vi.fn(() => null),
    });

    const result = await manager.resolve({
      workspace,
      serverKind: "python",
      env: {},
    });

    expect(result).toMatchObject({
      kind: "ready",
      source: "managed",
      command: executablePath,
      args: [],
    });
  });

  it("ignores a managed manifest when the JSON is corrupted", async () => {
    const root = mkdtempSync(join(tmpdir(), "lsp-tools-"));
    mkdirSync(join(root, "python"), { recursive: true });
    writeFileSync(join(root, "python", "manifest.json"), "{invalid json", "utf8");

    const manager = new LspToolManager({
      manifestStore: new FileManifestStore(root),
      // Pin platform so the win32-only Microsoft Store stub probe doesn't
      // reach for the real `python --version` on the host.
      platform: "linux",
      commandExists: vi.fn(async (command: string) => command === "python3"),
      resolveBundledCommand: vi.fn(() => null),
    });

    const result = await manager.resolve({
      workspace,
      serverKind: "python",
      env: {},
    });

    expect(result).toMatchObject({
      kind: "tool_missing",
      serverKind: "python",
      errorCode: "lsp_tool_missing",
    });
  });

  it("ignores a managed manifest when the stored version no longer matches the definition", async () => {
    const root = mkdtempSync(join(tmpdir(), "lsp-tools-"));
    const executablePath = join(root, "python", "old", "bin", "pylsp");
    mkdirSync(dirname(executablePath), { recursive: true });
    writeFileSync(executablePath, "#!/bin/sh\nexit 0\n", { mode: 0o755 });
    writeFileSync(
      join(root, "python", "manifest.json"),
      JSON.stringify({
        serverKind: "python",
        version: "0.0.1",
        executablePath,
        installedAt: 1,
        source: "managed",
        platform: process.platform,
      })
    );

    const manager = new LspToolManager({
      manifestStore: new FileManifestStore(root),
      platform: "linux",
      commandExists: vi.fn(async (command: string) => command === "python3"),
      resolveBundledCommand: vi.fn(() => null),
    });

    const result = await manager.resolve({
      workspace,
      serverKind: "python",
      env: {},
    });

    expect(result).toMatchObject({
      kind: "tool_missing",
      serverKind: "python",
      errorCode: "lsp_tool_missing",
    });
  });

  it("uses the bundled TypeScript language server before system PATH", async () => {
    const root = mkdtempSync(join(tmpdir(), "lsp-tools-"));
    const manager = new LspToolManager({
      manifestStore: new FileManifestStore(root),
      commandExists: vi.fn(async () => true),
      resolveBundledCommand: vi.fn(() => ({
        command: "/app/node_modules/typescript-language-server/lib/cli.mjs",
        args: ["--stdio"],
      })),
    });

    const result = await manager.resolve({
      workspace,
      serverKind: "typescript",
      env: {},
    });

    expect(result).toMatchObject({
      kind: "ready",
      source: "bundled",
      command: "/app/node_modules/typescript-language-server/lib/cli.mjs",
      args: ["--stdio"],
    });
  });

  it("wraps bundled TypeScript language server with the current node executable", async () => {
    const root = mkdtempSync(join(tmpdir(), "lsp-tools-"));
    const manager = new LspToolManager({
      manifestStore: new FileManifestStore(root),
      commandExists: vi.fn(async () => false),
    });

    const result = await manager.resolve({
      workspace,
      serverKind: "typescript",
      env: {},
    });

    expect(result.kind).toBe("ready");
    expect(result).toMatchObject({
      source: "bundled",
      command: process.execPath,
    });
    if (result.kind !== "ready") {
      throw new Error("expected bundled TypeScript language server to resolve");
    }
    expect(result.args[0]).toMatch(/typescript-language-server[\\/]+lib[\\/]cli\.mjs$/);
    expect(result.args.slice(1)).toEqual(["--stdio"]);
  });

  it("rejects a Windows system PATH command whose `--version` prints nothing (e.g. broken rustup shim)", async () => {
    // Regression test: `~/.cargo/bin/rust-analyzer.exe` exists on PATH as a
    // rustup proxy even when the `rust-analyzer` component is not installed.
    // Running it prints "Unknown binary 'rust-analyzer.exe' in official
    // toolchain" to stderr and exits — the manager must fall through to the
    // managed install path instead of pretending the system has a working
    // rust-analyzer (which causes opaque LSP initialize timeouts).
    const root = mkdtempSync(join(tmpdir(), "lsp-tools-"));
    const manager = new LspToolManager({
      manifestStore: new FileManifestStore(root),
      platform: "win32",
      commandExists: vi.fn(async () => true),
      runCommand: vi.fn(async () => {
        // Simulate the rustup proxy: throws because of the non-zero exit.
        const err = Object.assign(new Error("Command failed with exit code 1"), {
          exitCode: 1,
          stdout: "",
          stderr: "",
        });
        throw err;
      }),
      resolveBundledCommand: vi.fn(() => null),
    });

    const result = await manager.resolve({
      workspace,
      serverKind: "rust",
      env: {},
    });

    expect(result).toMatchObject({
      kind: "tool_missing",
      serverKind: "rust",
      autoInstallSupported: true,
    });
  });

  it("accepts a Windows system command whose `--version` produces output", async () => {
    const root = mkdtempSync(join(tmpdir(), "lsp-tools-"));
    const manager = new LspToolManager({
      manifestStore: new FileManifestStore(root),
      platform: "win32",
      commandExists: vi.fn(async () => true),
      runCommand: vi.fn(async () => ({
        stdout: "rust-analyzer 1.92.0 (ded5c06c 2025-12-08)\n",
        stderr: "",
      })),
      resolveBundledCommand: vi.fn(() => null),
    });

    const result = await manager.resolve({
      workspace,
      serverKind: "rust",
      env: {},
    });

    expect(result).toMatchObject({
      kind: "ready",
      source: "system",
      command: "rust-analyzer",
    });
  });

  it("skips the `--version` probe on POSIX hosts because broken proxies are uncommon there", async () => {
    const root = mkdtempSync(join(tmpdir(), "lsp-tools-"));
    const runCommand = vi.fn();
    const manager = new LspToolManager({
      manifestStore: new FileManifestStore(root),
      platform: "linux",
      commandExists: vi.fn(async () => true),
      runCommand,
      resolveBundledCommand: vi.fn(() => null),
    });

    const result = await manager.resolve({
      workspace,
      serverKind: "rust",
      env: {},
    });

    expect(result).toMatchObject({
      kind: "ready",
      source: "system",
    });
    // POSIX must NOT incur the extra `--version` spawn for every LSP we
    // resolve — it adds startup latency without any meaningful protection.
    expect(runCommand).not.toHaveBeenCalled();
  });

  it("returns tool_missing when no source is available", async () => {
    const root = mkdtempSync(join(tmpdir(), "lsp-tools-"));
    const manager = new LspToolManager({
      manifestStore: new FileManifestStore(root),
      platform: "linux",
      commandExists: vi.fn(async (command: string) => command === "python3"),
      resolveBundledCommand: vi.fn(() => null),
    });

    const result = await manager.resolve({
      workspace,
      serverKind: "python",
      env: {},
    });

    expect(result).toMatchObject({
      kind: "tool_missing",
      serverKind: "python",
      errorCode: "lsp_tool_missing",
      autoInstallSupported: true,
      missingCommands: ["pylsp"],
      missingPrerequisites: [],
    });
  });

  it("marks native managed install unsupported for WSL workspaces", async () => {
    const root = mkdtempSync(join(tmpdir(), "lsp-tools-"));
    const manager = new LspToolManager({
      manifestStore: new FileManifestStore(root),
      commandExists: vi.fn(async () => false),
      resolveBundledCommand: vi.fn(() => null),
    });

    const result = await manager.resolve({
      workspace: { ...workspace, targetRuntime: "wsl", wslDistro: "Ubuntu" },
      serverKind: "rust",
      env: {},
    });

    expect(result).toMatchObject({
      kind: "tool_missing",
      serverKind: "rust",
      autoInstallSupported: false,
      installReadiness: "unsupported_platform",
      missingCommands: ["rust-analyzer"],
    });
  });

  it("prefers a managed vue install over system PATH", async () => {
    const root = mkdtempSync(join(tmpdir(), "lsp-tools-"));
    const executablePath = join(
      root,
      "vue",
      VUE_MANAGED_VERSION,
      "node_modules",
      ".bin",
      process.platform === "win32" ? "vue-language-server.cmd" : "vue-language-server"
    );
    mkdirSync(dirname(executablePath), { recursive: true });
    writeFileSync(executablePath, "#!/bin/sh\nexit 0\n", { mode: 0o755 });
    writeFileSync(
      join(root, "vue", "manifest.json"),
      JSON.stringify({
        serverKind: "vue",
        version: VUE_MANAGED_VERSION,
        executablePath,
        installedAt: 1,
        source: "managed",
        platform: process.platform,
      })
    );

    const manager = new LspToolManager({
      manifestStore: new FileManifestStore(root),
      commandExists: vi.fn(async () => true),
      resolveBundledCommand: vi.fn(() => null),
    });

    const result = await manager.resolve({
      workspace,
      serverKind: "vue",
      env: {},
    });

    expect(result).toMatchObject({
      kind: "ready",
      source: "managed",
      command: executablePath,
      args: ["--stdio"],
    });
  });
});
