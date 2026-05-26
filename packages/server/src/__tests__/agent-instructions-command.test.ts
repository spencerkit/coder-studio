import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { EventBus } from "../bus/event-bus.js";
import { openDatabase } from "../storage/db.js";
import type { CommandContext } from "../ws/dispatch.js";
import { dispatch } from "../ws/dispatch.js";
import "../commands/workspace.js";
import "../commands/agent-instructions.js";

describe("agentInstructions commands", () => {
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

  function createContext(rootPath: string | null): CommandContext {
    return {
      workspaceMgr: {
        get(id: string) {
          if (id !== "ws-1" || !rootPath) {
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
      eventBus: new EventBus(),
      broadcaster: {} as never,
      db: openDatabase(":memory:"),
      providerRegistry: [],
      fencingMgr: {} as never,
      supervisorMgr: {} as never,
      autoFetch: {} as never,
      activationMgr: {
        getLease: () => ({ wsClientId: "test-client" }),
      },
    } as unknown as CommandContext;
  }

  it("returns workspace_not_found for missing workspaces", async () => {
    const result = await dispatch(
      {
        kind: "command",
        id: "agent-instructions-missing-workspace",
        op: "agentInstructions.read",
        args: {
          workspaceId: "missing",
        },
      },
      createContext(null)
    );

    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("workspace_not_found");
  });

  it("reads a missing AGENTS.md without inventing content", async () => {
    const rootPath = await mkdtemp(join(tmpdir(), "agent-instructions-read-"));
    tempDirs.push(rootPath);

    const result = await dispatch(
      {
        kind: "command",
        id: "agent-instructions-read-missing",
        op: "agentInstructions.read",
        args: {
          workspaceId: "ws-1",
        },
      },
      createContext(rootPath)
    );

    expect(result.ok).toBe(true);
    expect(result.data).toMatchObject({
      path: "AGENTS.md",
      exists: false,
      content: "",
    });
  });

  it("generates content from workspace intelligence and omits absent commands", async () => {
    const rootPath = await mkdtemp(join(tmpdir(), "agent-instructions-generate-"));
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
    await writeFile(join(rootPath, "pnpm-lock.yaml"), "lockfileVersion: 9.0\n");
    await writeFile(join(rootPath, "README.md"), "# Repo\n");

    const result = await dispatch(
      {
        kind: "command",
        id: "agent-instructions-generate-1",
        op: "agentInstructions.generate",
        args: {
          workspaceId: "ws-1",
        },
      },
      createContext(rootPath)
    );

    expect(result.ok).toBe(true);
    expect((result.data as { content: string }).content).toContain("## Project Overview");
    expect((result.data as { content: string }).content).toContain("- Dev: `pnpm dev`");
    expect((result.data as { content: string }).content).not.toContain("- Test:");
    expect((result.data as { content: string }).content).not.toContain("- Build:");
    expect((result.data as { content: string }).content).not.toContain("- Lint:");
  });

  it("writes and reads AGENTS.md roundtrip", async () => {
    const rootPath = await mkdtemp(join(tmpdir(), "agent-instructions-write-"));
    tempDirs.push(rootPath);

    const content = [
      "# Agent Instructions",
      "",
      "## Project Overview",
      "",
      "- Git branch: main",
      "",
      "## Development Commands",
      "",
      "- Dev: `pnpm dev`",
      "",
      "## Working Rules",
      "",
      "- Keep changes focused on the requested task.",
      "- Do not revert user changes unless explicitly asked.",
      "- Prefer the project's existing patterns.",
      "- Run the relevant verification command before reporting completion.",
      "",
      "## Review Expectations",
      "",
      "- Summarize changed files.",
      "- Report verification commands and results.",
      "- Call out risks, skipped tests, and assumptions.",
      "",
      "## Provider Notes",
      "",
      "- Claude Code: use the project rules above.",
      "- Codex: use the project rules above.",
      "",
    ].join("\n");

    const writeResult = await dispatch(
      {
        kind: "command",
        id: "agent-instructions-write-1",
        op: "agentInstructions.write",
        args: {
          workspaceId: "ws-1",
          content,
        },
      },
      createContext(rootPath)
    );

    expect(writeResult.ok).toBe(true);

    const readResult = await dispatch(
      {
        kind: "command",
        id: "agent-instructions-read-1",
        op: "agentInstructions.read",
        args: {
          workspaceId: "ws-1",
        },
      },
      createContext(rootPath)
    );

    expect(readResult.ok).toBe(true);
    expect(readResult.data).toMatchObject({
      path: "AGENTS.md",
      exists: true,
      content,
    });
  });

  it("reports health for incomplete AGENTS.md content", async () => {
    const rootPath = await mkdtemp(join(tmpdir(), "agent-instructions-health-"));
    tempDirs.push(rootPath);

    await writeFile(
      join(rootPath, "AGENTS.md"),
      [
        "# Agent Instructions",
        "",
        "## Project Overview",
        "",
        "- Git branch: main",
        "",
        "## Development Commands",
        "",
        "- Dev: `pnpm dev`",
        "",
        "## Working Rules",
        "",
        "- Keep changes focused on the requested task.",
        "",
        "## Provider Notes",
        "",
        "- Claude Code: use the project rules above.",
        "",
      ].join("\n")
    );

    const result = await dispatch(
      {
        kind: "command",
        id: "agent-instructions-health-1",
        op: "agentInstructions.health",
        args: {
          workspaceId: "ws-1",
        },
      },
      createContext(rootPath)
    );

    expect(result.ok).toBe(true);
    expect((result.data as { status: string }).status).toBe("warning");
  });
});
