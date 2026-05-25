import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Workspace } from "@coder-studio/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  VUE_LANGUAGE_SERVER_VERSION,
  VUE_MANAGED_VERSION,
  VUE_TYPESCRIPT_VERSION,
} from "./definitions.js";
import { LspToolInstallManager } from "./install-manager.js";
import { FileManifestStore } from "./manifest-store.js";

const workspace: Workspace = {
  id: "ws-1",
  path: "/repo",
  targetRuntime: "native",
  openedAt: 1,
  lastActiveAt: 1,
  uiState: { leftPanelWidth: 240, bottomPanelHeight: 180, focusMode: false },
};

describe("LspToolInstallManager", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("returns missing_prerequisite when python3 is unavailable", async () => {
    const manager = new LspToolInstallManager({
      manifestStore: new FileManifestStore(mkdtempSync(join(tmpdir(), "lsp-tools-"))),
      commandExists: vi.fn(async () => false),
      runCommand: vi.fn(async () => ({ stdout: "", stderr: "" })),
    });

    const job = await manager.start({
      workspace,
      serverKind: "python",
    });

    expect(job.status).toBe("failed");
    expect(job.failure).toMatchObject({
      code: "missing_prerequisite",
      missingCommands: ["python3"],
    });
  });

  it("allows managed Python install on Windows when python is available but python3 is not", async () => {
    const root = mkdtempSync(join(tmpdir(), "lsp-tools-"));
    let installed = false;
    const venvRoot = join(root, "python", "1.14.0", "venv");
    const pipPath = join(venvRoot, "Scripts", "pip.exe");
    const executablePath = join(venvRoot, "Scripts", "pylsp.exe");

    const manager = new LspToolInstallManager({
      manifestStore: new FileManifestStore(root),
      platform: "win32",
      commandExists: vi.fn(async (command: string) => {
        if (command === "python3") {
          return false;
        }
        if (command === "python") {
          return true;
        }
        if (command === executablePath) {
          return installed;
        }
        return false;
      }),
      runCommand: vi.fn(async (file: string, args: string[]) => {
        if (file === "python" && args[0] === "-m" && args[1] === "venv") {
          return { stdout: "created venv", stderr: "" };
        }

        if (file === pipPath) {
          installed = true;
          return { stdout: "installed pylsp", stderr: "" };
        }

        throw new Error(`unexpected command: ${file}`);
      }),
    });

    const started = await manager.start({
      workspace,
      serverKind: "python",
    });

    await vi.waitFor(() => {
      expect(manager.get(started.jobId)?.status).toBe("succeeded");
    });

    expect(manager.get(started.jobId)?.steps).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "create-python-venv",
          command: "python",
        }),
      ])
    );
  });

  it("returns unsupported_platform for WSL workspaces", async () => {
    const manager = new LspToolInstallManager({
      manifestStore: new FileManifestStore(mkdtempSync(join(tmpdir(), "lsp-tools-"))),
      commandExists: vi.fn(async () => true),
      runCommand: vi.fn(async () => ({ stdout: "", stderr: "" })),
    });

    const job = await manager.start({
      workspace: { ...workspace, targetRuntime: "wsl", wslDistro: "Ubuntu" },
      serverKind: "rust",
    });

    expect(job.status).toBe("failed");
    expect(job.failure?.code).toBe("unsupported_platform");
  });

  it("runs a Go install plan, verifies it, and writes a manifest", async () => {
    const root = mkdtempSync(join(tmpdir(), "lsp-tools-"));
    let installed = false;
    const gobin = join(root, "go", "v0.21.1", "bin");
    const executablePath = join(gobin, process.platform === "win32" ? "gopls.exe" : "gopls");

    const manager = new LspToolInstallManager({
      manifestStore: new FileManifestStore(root),
      commandExists: vi.fn(async (command: string) => {
        if (command === "go") {
          return true;
        }

        if (command === executablePath) {
          return installed;
        }

        return false;
      }),
      runCommand: vi.fn(async (file: string) => {
        if (file === "go") {
          installed = true;
          return { stdout: "installed", stderr: "" };
        }

        throw new Error(`unexpected command: ${file}`);
      }),
    });

    const started = await manager.start({
      workspace,
      serverKind: "go",
    });

    await vi.waitFor(() => {
      expect(manager.get(started.jobId)?.status).toBe("succeeded");
    });

    const manifest = new FileManifestStore(root).read("go");
    expect(manifest).toMatchObject({
      serverKind: "go",
      executablePath,
      source: "managed",
    });
  });

  it("installs the vue language server into the managed tool directory and writes a manifest", async () => {
    const root = mkdtempSync(join(tmpdir(), "lsp-tools-"));
    let installed = false;
    const executablePath = join(
      root,
      "vue",
      VUE_MANAGED_VERSION,
      "node_modules",
      ".bin",
      process.platform === "win32" ? "vue-language-server.cmd" : "vue-language-server"
    );
    const runCommand = vi.fn(async (file: string) => {
      if (file === "npm") {
        installed = true;
        return { stdout: "installed vue-language-server", stderr: "" };
      }

      throw new Error(`unexpected command: ${file}`);
    });

    const manager = new LspToolInstallManager({
      manifestStore: new FileManifestStore(root),
      commandExists: vi.fn(async (command: string) => {
        if (command === "npm") {
          return true;
        }

        if (command === executablePath) {
          return installed;
        }

        return false;
      }),
      runCommand,
    });

    const started = await manager.start({
      workspace,
      serverKind: "vue",
    });

    await vi.waitFor(() => {
      expect(manager.get(started.jobId)?.status).toBe("succeeded");
    });

    expect(new FileManifestStore(root).read("vue")).toMatchObject({
      serverKind: "vue",
      version: VUE_MANAGED_VERSION,
      executablePath,
      source: "managed",
    });
    expect(runCommand).toHaveBeenCalledWith(
      "npm",
      [
        "install",
        "--no-save",
        `@vue/language-server@${VUE_LANGUAGE_SERVER_VERSION}`,
        `typescript@${VUE_TYPESCRIPT_VERSION}`,
      ],
      expect.objectContaining({
        cwd: join(root, "vue", VUE_MANAGED_VERSION),
      })
    );
  });

  it("classifies install-step ENOENT failures as command_not_found", async () => {
    const installError = Object.assign(new Error("spawn python3 ENOENT"), {
      code: "ENOENT",
      stderr: "python3: command not found",
      stdout: "",
    });
    const manager = new LspToolInstallManager({
      manifestStore: new FileManifestStore(mkdtempSync(join(tmpdir(), "lsp-tools-"))),
      commandExists: vi.fn(async () => true),
      runCommand: vi.fn(async () => {
        throw installError;
      }),
    });

    const started = await manager.start({
      workspace,
      serverKind: "python",
    });

    await vi.waitFor(() => {
      expect(manager.get(started.jobId)?.status).toBe("failed");
    });

    expect(manager.get(started.jobId)?.failure).toMatchObject({
      code: "command_not_found",
    });
  });

  it("creates a Python virtualenv, installs pylsp into it, and writes a manifest", async () => {
    const root = mkdtempSync(join(tmpdir(), "lsp-tools-"));
    let installed = false;
    const venvRoot = join(root, "python", "1.14.0", "venv");
    const pipPath = join(
      venvRoot,
      process.platform === "win32" ? "Scripts" : "bin",
      process.platform === "win32" ? "pip.exe" : "pip"
    );
    const executablePath = join(
      venvRoot,
      process.platform === "win32" ? "Scripts" : "bin",
      process.platform === "win32" ? "pylsp.exe" : "pylsp"
    );

    const manager = new LspToolInstallManager({
      manifestStore: new FileManifestStore(root),
      commandExists: vi.fn(async (command: string) => {
        if (command === "python3") {
          return true;
        }

        if (command === executablePath) {
          return installed;
        }

        return false;
      }),
      runCommand: vi.fn(async (file: string, args: string[]) => {
        if (file === "python3" && args[0] === "-m" && args[1] === "venv") {
          return { stdout: "created venv", stderr: "" };
        }

        if (file === pipPath) {
          installed = true;
          return { stdout: "installed pylsp", stderr: "" };
        }

        throw new Error(`unexpected command: ${file}`);
      }),
    });

    const started = await manager.start({
      workspace,
      serverKind: "python",
    });

    await vi.waitFor(() => {
      expect(manager.get(started.jobId)?.status).toBe("succeeded");
    });

    expect(manager.get(started.jobId)?.steps).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "create-python-venv",
          command: "python3",
        }),
        expect.objectContaining({
          id: "install-python-lsp",
          command: pipPath,
        }),
      ])
    );

    const manifest = new FileManifestStore(root).read("python");
    expect(manifest).toMatchObject({
      serverKind: "python",
      executablePath,
      source: "managed",
    });
  });

  it("downloads rust-analyzer into the managed tool directory and writes a manifest", async () => {
    const root = mkdtempSync(join(tmpdir(), "lsp-tools-"));
    let installed = false;
    const executablePath = join(root, "rust", "2026-05-18", "bin", "rust-analyzer");

    const manager = new LspToolInstallManager({
      manifestStore: new FileManifestStore(root),
      commandExists: vi.fn(async (command: string) => {
        if (command === executablePath) {
          return installed;
        }

        return false;
      }),
      runCommand: vi.fn(async (file: string, args: string[]) => {
        if (file === process.execPath && args[0] === "-e") {
          installed = true;
          return { stdout: "downloaded rust-analyzer", stderr: "" };
        }

        throw new Error(`unexpected command: ${file}`);
      }),
    });

    const started = await manager.start({
      workspace,
      serverKind: "rust",
    });

    await vi.waitFor(() => {
      expect(manager.get(started.jobId)?.status).toBe("succeeded");
    });

    expect(manager.get(started.jobId)?.steps).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "install-rust-lsp",
          command: process.execPath,
        }),
      ])
    );

    const manifest = new FileManifestStore(root).read("rust");
    expect(manifest).toMatchObject({
      serverKind: "rust",
      executablePath,
      source: "managed",
    });
  });
});
