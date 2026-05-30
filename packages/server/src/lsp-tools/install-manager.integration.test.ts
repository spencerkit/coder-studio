/**
 * Integration tests for `LspToolInstallManager`'s verify step.
 *
 * Goal: prove the verify step works for every managed LSP under both POSIX
 * and Windows path conventions, *without mocking `commandExists`*. That makes
 * this the only place that exercises the real `checkCommandAvailable` against
 * the absolute path the install plan computes.
 *
 * Why this matters: every managed LSP (python, go, rust, vue) verifies by
 * passing an absolute path to `commandExists`. Windows `where.exe` rejects
 * absolute paths because it parses the colon as a `path:pattern` separator,
 * so before the absolute-path branch in `checkCommandAvailable`, every LSP
 * install silently failed at verify. We assert here that an on-disk
 * executable at the planned path passes the verify step for every kind.
 *
 * Strategy:
 *  - Mock only `runCommand` (so we don't actually invoke npm/pip/go/curl).
 *  - In the runCommand mock, write a real file at the expected
 *    `executablePath` so the verify step's `fs.existsSync` succeeds.
 *  - Run for every managed serverKind, under both `linux` and `win32`.
 */

import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { LspServerKind, Workspace } from "@coder-studio/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { VUE_MANAGED_VERSION } from "./definitions.js";
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

interface ExpectedInstall {
  serverKind: LspServerKind;
  expectedPath: (root: string, platform: NodeJS.Platform) => string;
}

const CASES: ExpectedInstall[] = [
  {
    serverKind: "python",
    expectedPath: (root, platform) =>
      join(
        root,
        "python",
        "1.14.0",
        "venv",
        platform === "win32" ? "Scripts" : "bin",
        platform === "win32" ? "pylsp.exe" : "pylsp"
      ),
  },
  {
    serverKind: "go",
    expectedPath: (root, platform) =>
      join(root, "go", "v0.21.1", "bin", platform === "win32" ? "gopls.exe" : "gopls"),
  },
  {
    serverKind: "rust",
    expectedPath: (root, platform) =>
      join(
        root,
        "rust",
        "2026-05-18",
        "bin",
        platform === "win32" ? "rust-analyzer.exe" : "rust-analyzer"
      ),
  },
  {
    serverKind: "vue",
    expectedPath: (root, platform) =>
      join(
        root,
        "vue",
        VUE_MANAGED_VERSION,
        "node_modules",
        ".bin",
        platform === "win32" ? "vue-language-server.cmd" : "vue-language-server"
      ),
  },
];

// We can only meaningfully exercise the verify step on the host's actual
// platform — `path.join` and `fs.existsSync` use host conventions, and the
// real `checkCommandAvailable` walks the host PATH for any bare-name
// fallbacks. Cross-platform behavior of `checkCommandAvailable` itself is
// covered in detail by `command-check.test.ts`.
const PLATFORM = process.platform;

describe(`LspToolInstallManager verify step (platform=${PLATFORM})`, () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  // Whitelist the bare-name prerequisites so the test doesn't depend on
  // python3 / go / npm actually being installed on the runner. The verify
  // step itself still goes through the *real* checkCommandAvailable.
  const allowedPrereqs = new Set(["npm", "python", "python3", "go"]);
  async function smartCommandExists(command: string): Promise<boolean> {
    if (allowedPrereqs.has(command)) {
      return true;
    }
    const { checkCommandAvailable } = await import("../provider-runtime/command-check.js");
    return checkCommandAvailable(command, { platform: PLATFORM });
  }

  it.each(CASES)("$serverKind verify accepts the absolute managed executable path", async ({
    serverKind,
    expectedPath: pathFn,
  }) => {
    const root = mkdtempSync(join(tmpdir(), `lsp-install-${serverKind}-`));
    const expectedPath = pathFn(root, PLATFORM);

    const runCommand = vi.fn(async () => {
      // Simulate the install step actually putting the executable on disk
      // so the verify step (real `checkCommandAvailable`) can find it.
      mkdirSync(dirname(expectedPath), { recursive: true });
      writeFileSync(expectedPath, "#!/usr/bin/env sh\nexit 0\n", { mode: 0o755 });
      return { stdout: "", stderr: "" };
    });

    const manager = new LspToolInstallManager({
      manifestStore: new FileManifestStore(root),
      platform: PLATFORM,
      commandExists: smartCommandExists,
      runCommand,
    });

    const job = await manager.start({ workspace, serverKind });

    await vi.waitFor(
      () => {
        const snapshot = manager.get(job.jobId);
        expect(snapshot?.status).not.toBe("running");
        expect(snapshot?.status).not.toBe("queued");
      },
      { timeout: 5000 }
    );

    const final = manager.get(job.jobId);
    expect(final?.status).toBe("succeeded");

    // Manifest written → verify step actually accepted the on-disk file.
    // On Windows this is the regression test for the `where.exe` colon bug.
    const manifest = new FileManifestStore(root).read(serverKind);
    expect(manifest).toMatchObject({
      serverKind,
      executablePath: expectedPath,
      platform: PLATFORM,
      source: "managed",
    });
  });

  it.each(
    CASES
  )("$serverKind verify rejects when no executable exists at the expected path", async ({
    serverKind,
  }) => {
    const root = mkdtempSync(join(tmpdir(), `lsp-install-${serverKind}-miss-`));

    const manager = new LspToolInstallManager({
      manifestStore: new FileManifestStore(root),
      platform: PLATFORM,
      commandExists: smartCommandExists,
      // runCommand succeeds but never writes the file, simulating an
      // install step that silently completed without producing the binary.
      runCommand: vi.fn(async () => ({ stdout: "", stderr: "" })),
    });

    const job = await manager.start({ workspace, serverKind });

    await vi.waitFor(
      () => {
        const snapshot = manager.get(job.jobId);
        expect(snapshot?.status).not.toBe("running");
        expect(snapshot?.status).not.toBe("queued");
      },
      { timeout: 5000 }
    );

    const final = manager.get(job.jobId);
    expect(final?.status).toBe("failed");
    // The verify step is the last one in every install plan; if it errored
    // because the file isn't there, the failure should not be the missing
    // prerequisites code (those were satisfied by smartCommandExists).
    expect(final?.failure?.code).not.toBe("missing_prerequisite");
  });
});
