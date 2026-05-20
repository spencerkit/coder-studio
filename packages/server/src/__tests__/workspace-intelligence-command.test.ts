import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { openDatabase } from "../storage/db.js";
import type { CommandContext } from "../ws/dispatch.js";
import { dispatch } from "../ws/dispatch.js";
import "../commands/workspace.js";

describe("workspace.intelligence command", () => {
  const tempDirs: string[] = [];

  afterEach(async () => {
    await Promise.all(
      tempDirs.map(async (dir) => {
        try {
          await import("node:fs/promises").then(({ rm }) =>
            rm(dir, { recursive: true, force: true })
          );
        } catch {
          // Ignore temp cleanup failures in tests.
        }
      })
    );
  });

  it("returns a typed workspace summary through dispatch", async () => {
    const rootPath = await mkdtemp(join(tmpdir(), "workspace-intelligence-command-"));
    tempDirs.push(rootPath);

    await mkdir(join(rootPath, ".git"), { recursive: true });
    await writeFile(join(rootPath, ".git", "HEAD"), "ref: refs/heads/main\n");
    await writeFile(
      join(rootPath, "package.json"),
      JSON.stringify({
        scripts: {
          dev: "vite",
        },
        devDependencies: {
          vite: "^7.0.0",
        },
      })
    );
    await writeFile(join(rootPath, "README.md"), "# Repo\n");

    const db = openDatabase(":memory:");
    const ctx = {
      workspaceMgr: {
        get(id: string) {
          if (id !== "ws-1") {
            return undefined;
          }

          return {
            id,
            path: rootPath,
            targetRuntime: "native",
            openedAt: Date.now(),
            lastActiveAt: Date.now(),
            uiState: {
              leftPanelWidth: 320,
              bottomPanelHeight: 240,
              focusMode: false,
            },
          };
        },
      },
      sessionMgr: {} as never,
      terminalMgr: {} as never,
      eventBus: {} as never,
      broadcaster: {} as never,
      db,
      providerRegistry: [],
      fencingMgr: {} as never,
      supervisorMgr: {} as never,
      autoFetch: {} as never,
      activationMgr: {
        getLease: () => ({ wsClientId: "test-client" }),
      },
    } as unknown as CommandContext;

    const result = await dispatch(
      {
        kind: "command",
        id: "workspace-intelligence-1",
        op: "workspace.intelligence",
        args: {
          workspaceId: "ws-1",
        },
      },
      ctx
    );

    expect(result.ok).toBe(true);
    expect(result.data).toEqual({
      workspaceId: "ws-1",
      rootPath,
      git: {
        isRepo: true,
        branch: "main",
      },
      packageManager: "npm",
      frameworks: ["Vite", "Node"],
      scripts: {
        dev: "vite",
        test: undefined,
        build: undefined,
        lint: undefined,
      },
      recommendedCommands: [{ key: "dev", command: "npm run dev", source: "package_json" }],
      docs: [{ path: "README.md", kind: "readme" }],
      agentInstructions: {
        exists: false,
        path: "AGENTS.md",
      },
    });
  });
});
