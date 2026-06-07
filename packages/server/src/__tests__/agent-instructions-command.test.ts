import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ProviderDefinition } from "@coder-studio/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { EventBus } from "../bus/event-bus.js";
import { runCommandAsString } from "../provider-runtime/command-runner.js";
import { SessionMetadataRepo } from "../storage/repositories/session-metadata-repo.js";
import { WorkspaceRepo } from "../storage/repositories/workspace-repo.js";
import {
  AGENT_INSTRUCTIONS_CUSTOM_RELATIVE_PATH,
  AGENT_INSTRUCTIONS_RELATIVE_PATH,
  WORKSPACE_STATE_DIR,
} from "../workspace/workspace-state.js";
import type { CommandContext } from "../ws/dispatch.js";
import { dispatch } from "../ws/dispatch.js";
import "../commands/workspace.js";
import "../commands/agent-instructions.js";

vi.mock("../provider-runtime/command-runner.js", () => ({
  runCommandAsString: vi.fn(),
}));

describe("agentInstructions commands", () => {
  const tempDirs: string[] = [];
  const runCommandAsStringMock = vi.mocked(runCommandAsString);
  const originalHome = process.env.HOME;

  afterEach(async () => {
    vi.resetAllMocks();
    if (originalHome === undefined) {
      delete process.env.HOME;
    } else {
      process.env.HOME = originalHome;
    }
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

  function createContext(
    rootPath: string | null,
    overrides: Partial<CommandContext> = {}
  ): CommandContext {
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
              activeSessionId: "sess-1",
            },
          };
        },
      },
      sessionMgr: {
        get: vi.fn(() => undefined),
        sendInput: vi.fn(),
      } as never,
      terminalMgr: {} as never,
      eventBus: new EventBus(),
      broadcaster: {} as never,
      db: {} as never,
      providerRegistry: [],
      fencingMgr: {} as never,
      supervisorMgr: {} as never,
      autoFetch: {} as never,
      activationMgr: {
        getLease: () => ({ wsClientId: "test-client" }),
      },
      ...overrides,
    } as unknown as CommandContext;
  }

  function createSessionMetadataRepo(rootPath: string): SessionMetadataRepo {
    const workspaceRepo = new WorkspaceRepo({
      filePath: join(rootPath, ".test-workspaces.json"),
    });
    workspaceRepo.create({
      id: "ws-1",
      path: rootPath,
      targetRuntime: "native",
      openedAt: 1,
      lastActiveAt: 1,
      uiState: {
        leftPanelWidth: 320,
        bottomPanelHeight: 240,
        focusMode: false,
        activeSessionId: "sess-1",
      },
    });

    return new SessionMetadataRepo({
      workspaceRepo,
    });
  }

  function createAgentGenerationProvider(options?: {
    id?: string;
    commandBuilder?: NonNullable<ProviderDefinition["headless"]>["buildCommand"];
  }): ProviderDefinition {
    const providerId = options?.id ?? "codex";

    return {
      id: providerId,
      displayName: providerId,
      badge: providerId,
      kind: "built_in",
      capability: "full",
      capabilities: [],
      install: {
        prerequisites: [],
        manualGuideKeys: [],
        docUrls: {},
        strategies: {},
      },
      buildCommand() {
        return {
          argv: [],
          env: {},
          cwd: "/workspace",
        };
      },
      configSchema: z.object({}).passthrough(),
      defaultConfig: {},
      requiredCommands: [],
      headless: {
        supportedScenarios: ["agent_instructions_generate"],
        buildCommand:
          options?.commandBuilder ??
          ((_config, _scenario, _req) => ({
            argv: [providerId, "exec"],
          })),
      },
    } as ProviderDefinition;
  }

  function codexJsonlPayload(text: string): string {
    return [
      JSON.stringify({ type: "thread.started", thread_id: "t1" }),
      JSON.stringify({ type: "turn.started" }),
      JSON.stringify({
        type: "item.completed",
        item: { id: "i1", type: "agent_message", text },
      }),
      JSON.stringify({ type: "turn.completed", usage: { output_tokens: 20 } }),
    ].join("\n");
  }

  function generationPayload(markdown: string): string {
    return JSON.stringify({
      ok: true,
      content: markdown,
    });
  }

  function generationFailurePayload(message: string): string {
    return JSON.stringify({
      ok: false,
      error: message,
    });
  }

  async function createTestHome(prefix: string): Promise<string> {
    const homePath = await mkdtemp(join(tmpdir(), prefix));
    tempDirs.push(homePath);
    process.env.HOME = homePath;
    return homePath;
  }

  function resultEnvelope(text: string): string {
    return JSON.stringify({
      type: "result",
      subtype: "success",
      is_error: false,
      result: text,
    });
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

  it("reads a missing agent.md without inventing content", async () => {
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
      path: AGENT_INSTRUCTIONS_RELATIVE_PATH,
      exists: false,
      content: "",
    });
  });

  it("reports system instruction status for supported providers only", async () => {
    const rootPath = await mkdtemp(join(tmpdir(), "agent-instructions-system-status-"));
    tempDirs.push(rootPath);
    const homePath = await createTestHome("agent-instructions-home-status-");
    await mkdir(join(homePath, ".codex"), { recursive: true });
    await writeFile(join(homePath, ".codex", "AGENTS.md"), "# Codex\n");

    const result = await dispatch(
      {
        kind: "command",
        id: "agent-instructions-system-status",
        op: "agentInstructions.system.status",
        args: {
          workspaceId: "ws-1",
        },
      },
      createContext(rootPath)
    );

    expect(result.ok).toBe(true);
    expect(result.data).toEqual([
      {
        providerId: "codex",
        displayName: "Codex",
        path: ".codex/AGENTS.md",
        displayPath: "~/.codex/AGENTS.md",
        exists: true,
        editable: true,
        status: "ready",
      },
      {
        providerId: "claude",
        displayName: "Claude Code",
        path: ".claude/CLAUDE.md",
        displayPath: "~/.claude/CLAUDE.md",
        exists: false,
        editable: true,
        status: "missing",
      },
      {
        providerId: "gemini",
        displayName: "Gemini CLI",
        path: ".gemini/GEMINI.md",
        displayPath: "~/.gemini/GEMINI.md",
        exists: false,
        editable: true,
        status: "missing",
      },
      {
        providerId: "opencode",
        displayName: "OpenCode",
        path: ".config/opencode/AGENTS.md",
        displayPath: "~/.config/opencode/AGENTS.md",
        exists: false,
        editable: true,
        status: "missing",
      },
    ]);
  });

  it("reads a missing system agent file as empty content with a display path", async () => {
    const rootPath = await mkdtemp(join(tmpdir(), "agent-instructions-system-read-"));
    tempDirs.push(rootPath);
    await createTestHome("agent-instructions-home-read-");

    const result = await dispatch(
      {
        kind: "command",
        id: "agent-instructions-system-read",
        op: "agentInstructions.system.read",
        args: {
          workspaceId: "ws-1",
          providerId: "codex",
        },
      },
      createContext(rootPath)
    );

    expect(result.ok).toBe(true);
    expect(result.data).toMatchObject({
      providerId: "codex",
      path: ".codex/AGENTS.md",
      displayPath: "~/.codex/AGENTS.md",
      exists: false,
      content: "",
    });
  });

  it("creates a missing system agent file through the write command", async () => {
    const rootPath = await mkdtemp(join(tmpdir(), "agent-instructions-system-write-"));
    tempDirs.push(rootPath);
    const homePath = await createTestHome("agent-instructions-home-write-");
    const eventBus = new EventBus();
    const emitSpy = vi.spyOn(eventBus, "emit");

    const result = await dispatch(
      {
        kind: "command",
        id: "agent-instructions-system-write",
        op: "agentInstructions.system.write",
        args: {
          workspaceId: "ws-1",
          providerId: "claude",
          content: "# Agent Instructions\n\n## Personal Defaults\n- Be concise.\n",
        },
      },
      createContext(rootPath, { eventBus })
    );

    expect(result.ok).toBe(true);
    expect(result.data).toMatchObject({
      providerId: "claude",
      path: ".claude/CLAUDE.md",
      displayPath: "~/.claude/CLAUDE.md",
      exists: true,
      content: "# Agent Instructions\n\n## Personal Defaults\n- Be concise.\n",
    });
    expect((result.data as { baseHash?: string }).baseHash).toEqual(expect.any(String));
    await expect(readFile(join(homePath, ".claude", "CLAUDE.md"), "utf8")).resolves.toBe(
      "# Agent Instructions\n\n## Personal Defaults\n- Be concise.\n"
    );
    expect(emitSpy).not.toHaveBeenCalledWith(
      expect.objectContaining({
        type: "fs.dirty",
      })
    );
  });

  it("rejects stale baseHash writes for system agent files", async () => {
    const rootPath = await mkdtemp(join(tmpdir(), "agent-instructions-system-conflict-"));
    tempDirs.push(rootPath);
    const homePath = await createTestHome("agent-instructions-home-conflict-");
    const filePath = join(homePath, ".codex", "AGENTS.md");

    const writeResult = await dispatch(
      {
        kind: "command",
        id: "agent-instructions-system-write-initial",
        op: "agentInstructions.system.write",
        args: {
          workspaceId: "ws-1",
          providerId: "codex",
          content: "initial\n",
        },
      },
      createContext(rootPath)
    );
    expect(writeResult.ok).toBe(true);

    const baseHash = (writeResult.data as { baseHash: string }).baseHash;
    await writeFile(filePath, "external edit\n");

    const result = await dispatch(
      {
        kind: "command",
        id: "agent-instructions-system-write-conflict",
        op: "agentInstructions.system.write",
        args: {
          workspaceId: "ws-1",
          providerId: "codex",
          content: "next\n",
          baseHash,
        },
      },
      createContext(rootPath)
    );

    expect(result.ok).toBe(false);
    expect(result.error).toMatchObject({
      code: "conflict",
    });
  });

  it("rejects unsupported system providers instead of inventing a path", async () => {
    const rootPath = await mkdtemp(join(tmpdir(), "agent-instructions-system-unsupported-"));
    tempDirs.push(rootPath);
    await createTestHome("agent-instructions-home-unsupported-");

    const readResult = await dispatch(
      {
        kind: "command",
        id: "agent-instructions-system-read-unsupported",
        op: "agentInstructions.system.read",
        args: {
          workspaceId: "ws-1",
          providerId: "cursor",
        },
      },
      createContext(rootPath)
    );
    const writeResult = await dispatch(
      {
        kind: "command",
        id: "agent-instructions-system-write-unsupported",
        op: "agentInstructions.system.write",
        args: {
          workspaceId: "ws-1",
          providerId: "cursor",
          content: "# Cursor\n",
        },
      },
      createContext(rootPath)
    );

    expect(readResult.ok).toBe(false);
    expect(readResult.error).toMatchObject({
      code: "agent_system_instructions_unsupported",
    });
    expect(writeResult.ok).toBe(false);
    expect(writeResult.error).toMatchObject({
      code: "agent_system_instructions_unsupported",
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

  it("generates agent instructions through the agent provider command", async () => {
    const rootPath = await mkdtemp(join(tmpdir(), "agent-instructions-generate-agent-"));
    tempDirs.push(rootPath);
    runCommandAsStringMock.mockResolvedValue({
      stdout: codexJsonlPayload(generationPayload("# Agent Instructions\n\nGenerated for tests\n")),
      stderr: "",
    });

    const result = await dispatch(
      {
        kind: "command",
        id: "agent-instructions-generate-by-agent",
        op: "agentInstructions.generateByAgent",
        args: {
          workspaceId: "ws-1",
          providerId: "codex",
          model: "o3",
        },
      },
      createContext(rootPath, {
        providerRegistry: [createAgentGenerationProvider()],
      })
    );

    expect(result.ok).toBe(true);
    expect(result.data).toEqual({
      content: "# Agent Instructions\n\nGenerated for tests\n",
      meta: {
        providerId: "codex",
        model: "o3",
      },
    });
  });

  it("supports non-codex providers when they expose agent-instructions generation headless mode", async () => {
    const rootPath = await mkdtemp(join(tmpdir(), "agent-instructions-generate-agent-gemini-"));
    tempDirs.push(rootPath);
    runCommandAsStringMock.mockResolvedValue({
      stdout: resultEnvelope(generationPayload("# Agent Instructions\n\nGenerated by gemini\n")),
      stderr: "",
    });
    const commandBuilder = vi.fn(() => ({
      argv: ["gemini", "exec"],
    }));

    const result = await dispatch(
      {
        kind: "command",
        id: "agent-instructions-generate-by-agent-gemini",
        op: "agentInstructions.generateByAgent",
        args: {
          workspaceId: "ws-1",
          providerId: "gemini",
          model: "",
        },
      },
      createContext(rootPath, {
        providerRegistry: [
          createAgentGenerationProvider({ id: "codex" }),
          createAgentGenerationProvider({
            id: "gemini",
            commandBuilder,
          }),
        ],
      })
    );

    expect(result.ok).toBe(true);
    expect(result.data).toEqual({
      content: "# Agent Instructions\n\nGenerated by gemini\n",
      meta: {
        providerId: "gemini",
      },
    });
    expect(commandBuilder).toHaveBeenCalledWith(
      {},
      "agent_instructions_generate",
      expect.objectContaining({
        model: undefined,
      })
    );
  });

  it("generates and writes agent instructions through the existing write flow", async () => {
    const rootPath = await mkdtemp(join(tmpdir(), "agent-instructions-generate-write-agent-"));
    tempDirs.push(rootPath);
    runCommandAsStringMock.mockResolvedValue({
      stdout: codexJsonlPayload(generationPayload("# Agent Instructions\n\nGenerated for write\n")),
      stderr: "",
    });

    const eventBus = new EventBus();
    const emitSpy = vi.spyOn(eventBus, "emit");
    const result = await dispatch(
      {
        kind: "command",
        id: "agent-instructions-generate-write-by-agent",
        op: "agentInstructions.generateAndWriteByAgent",
        args: {
          workspaceId: "ws-1",
          providerId: "codex",
          model: "o3-mini",
        },
      },
      createContext(rootPath, {
        eventBus,
        providerRegistry: [createAgentGenerationProvider()],
      })
    );

    expect(result.ok).toBe(true);
    expect(result.data).toMatchObject({
      document: {
        path: AGENT_INSTRUCTIONS_CUSTOM_RELATIVE_PATH,
        exists: true,
        content: "# Agent Instructions\n\nGenerated for write\n",
      },
      meta: {
        providerId: "codex",
        model: "o3-mini",
      },
    });

    const readResult = await dispatch(
      {
        kind: "command",
        id: "agent-instructions-read-after-generate-write-by-agent",
        op: "agentInstructions.read",
        args: {
          workspaceId: "ws-1",
        },
      },
      createContext(rootPath)
    );

    expect(readResult.ok).toBe(true);
    expect(readResult.data).toMatchObject({
      path: AGENT_INSTRUCTIONS_RELATIVE_PATH,
      exists: true,
      content: "# Agent Instructions\n\nGenerated for write\n",
    });
    expect(emitSpy).toHaveBeenCalledWith({
      type: "fs.dirty",
      workspaceId: "ws-1",
      reason: "file_content",
    });
  });

  it("returns an unsupported-provider error when no provider can generate agent instructions", async () => {
    const rootPath = await mkdtemp(
      join(tmpdir(), "agent-instructions-generate-agent-unsupported-")
    );
    tempDirs.push(rootPath);

    const result = await dispatch(
      {
        kind: "command",
        id: "agent-instructions-generate-by-agent-unsupported",
        op: "agentInstructions.generateByAgent",
        args: {
          workspaceId: "ws-1",
        },
      },
      createContext(rootPath)
    );

    expect(result.ok).toBe(false);
    expect(result.error).toMatchObject({
      code: "agent_instructions_provider_unsupported",
    });
  });

  it("returns a clear unsupported-provider error when the selected provider cannot generate agent instructions", async () => {
    const rootPath = await mkdtemp(
      join(tmpdir(), "agent-instructions-generate-agent-selected-unsupported-")
    );
    tempDirs.push(rootPath);

    const result = await dispatch(
      {
        kind: "command",
        id: "agent-instructions-generate-by-agent-selected-unsupported",
        op: "agentInstructions.generateByAgent",
        args: {
          workspaceId: "ws-1",
          providerId: "claude",
        },
      },
      createContext(rootPath, {
        providerRegistry: [
          createAgentGenerationProvider({ id: "codex" }),
          {
            ...createAgentGenerationProvider({ id: "claude" }),
            headless: {
              supportedScenarios: ["supervisor_eval"],
              buildCommand: vi.fn(() => null),
            },
          },
        ],
      })
    );

    expect(result.ok).toBe(false);
    expect(result.error).toMatchObject({
      code: "agent_instructions_provider_unsupported",
      message: "Provider does not support agent-instructions generation: claude",
    });
  });

  it("normalizes subprocess failures from agent-backed generation", async () => {
    const rootPath = await mkdtemp(join(tmpdir(), "agent-instructions-generate-agent-failure-"));
    tempDirs.push(rootPath);
    runCommandAsStringMock.mockRejectedValue(
      Object.assign(new Error("Command failed with exit code 1"), {
        exitCode: 1,
        stderr: "provider failed",
      })
    );

    const result = await dispatch(
      {
        kind: "command",
        id: "agent-instructions-generate-by-agent-failure",
        op: "agentInstructions.generateByAgent",
        args: {
          workspaceId: "ws-1",
        },
      },
      createContext(rootPath, {
        providerRegistry: [createAgentGenerationProvider()],
      })
    );

    expect(result.ok).toBe(false);
    expect(result.error).toMatchObject({
      code: "agent_instructions_generation_failed",
    });
  });

  it("returns a typed timeout error when agent-backed generation exceeds the subprocess timeout", async () => {
    const rootPath = await mkdtemp(join(tmpdir(), "agent-instructions-generate-agent-timeout-"));
    tempDirs.push(rootPath);
    runCommandAsStringMock.mockRejectedValue({
      code: "command_timeout",
      message: "Command timed out after 120000ms",
      timeoutMs: 120000,
      stdout: "",
      stderr: "",
    });

    const result = await dispatch(
      {
        kind: "command",
        id: "agent-instructions-generate-by-agent-timeout",
        op: "agentInstructions.generateByAgent",
        args: {
          workspaceId: "ws-1",
        },
      },
      createContext(rootPath, {
        providerRegistry: [createAgentGenerationProvider()],
      })
    );

    expect(result.ok).toBe(false);
    expect(result.error).toMatchObject({
      code: "agent_instructions_generation_timeout",
    });
  });

  it("returns a typed no-output error when agent-backed generation exits without usable output", async () => {
    const rootPath = await mkdtemp(join(tmpdir(), "agent-instructions-generate-agent-empty-"));
    tempDirs.push(rootPath);
    runCommandAsStringMock.mockResolvedValue({
      stdout: "   \n",
      stderr: "",
    });

    const result = await dispatch(
      {
        kind: "command",
        id: "agent-instructions-generate-by-agent-empty",
        op: "agentInstructions.generateByAgent",
        args: {
          workspaceId: "ws-1",
        },
      },
      createContext(rootPath, {
        providerRegistry: [createAgentGenerationProvider()],
      })
    );

    expect(result.ok).toBe(false);
    expect(result.error).toMatchObject({
      code: "agent_instructions_generation_no_output",
    });
  });

  it("propagates typed parse failures from agent-backed generation", async () => {
    const rootPath = await mkdtemp(join(tmpdir(), "agent-instructions-generate-agent-parse-"));
    tempDirs.push(rootPath);
    runCommandAsStringMock.mockResolvedValue({
      stdout: codexJsonlPayload(generationPayload("no heading")),
      stderr: "",
    });

    const result = await dispatch(
      {
        kind: "command",
        id: "agent-instructions-generate-by-agent-parse",
        op: "agentInstructions.generateByAgent",
        args: {
          workspaceId: "ws-1",
        },
      },
      createContext(rootPath, {
        providerRegistry: [createAgentGenerationProvider()],
      })
    );

    expect(result.ok).toBe(false);
    expect(result.error).toMatchObject({
      code: "agent_instructions_parse_failed",
    });
  });

  it("propagates typed generation payload failures from agent-backed generation", async () => {
    const rootPath = await mkdtemp(
      join(tmpdir(), "agent-instructions-generate-agent-payload-failure-")
    );
    tempDirs.push(rootPath);
    runCommandAsStringMock.mockResolvedValue({
      stdout: resultEnvelope(generationFailurePayload("provider refused")),
      stderr: "",
    });

    const result = await dispatch(
      {
        kind: "command",
        id: "agent-instructions-generate-by-agent-payload-failure",
        op: "agentInstructions.generateByAgent",
        args: {
          workspaceId: "ws-1",
          providerId: "claude",
        },
      },
      createContext(rootPath, {
        providerRegistry: [createAgentGenerationProvider({ id: "claude" })],
      })
    );

    expect(result.ok).toBe(false);
    expect(result.error).toMatchObject({
      code: "agent_instructions_parse_failed",
      message: "provider refused",
    });
  });

  it("writes and reads agent.md roundtrip", async () => {
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
      "## Workflow Expectations",
      "",
      "- Keep changes focused on the requested task.",
      "- Do not revert user changes unless explicitly asked.",
      "- Prefer the project's existing patterns.",
      "- Run the relevant verification command before reporting completion.",
      "",
      "## Review Checklist",
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
      path: AGENT_INSTRUCTIONS_RELATIVE_PATH,
      exists: true,
      content,
    });
  });

  it("reports health for incomplete AGENTS.md content", async () => {
    const rootPath = await mkdtemp(join(tmpdir(), "agent-instructions-health-"));
    tempDirs.push(rootPath);

    await mkdir(join(rootPath, WORKSPACE_STATE_DIR), { recursive: true });
    await writeFile(
      join(rootPath, AGENT_INSTRUCTIONS_RELATIVE_PATH),
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
        "## Workflow Expectations",
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

  it("reports status for empty workspaces", async () => {
    const rootPath = await mkdtemp(join(tmpdir(), "agent-instructions-status-empty-"));
    tempDirs.push(rootPath);

    const result = await dispatch(
      {
        kind: "command",
        id: "agent-instructions-status-empty",
        op: "agentInstructions.status",
        args: {
          workspaceId: "ws-1",
        },
      },
      createContext(rootPath)
    );

    expect(result.ok).toBe(true);
    expect(result.data).toEqual({
      project: {
        exists: false,
        path: AGENT_INSTRUCTIONS_CUSTOM_RELATIVE_PATH,
        displayPath: "项目 Agent.md",
        stale: false,
      },
      system: expect.any(Array),
      document: {
        exists: false,
        path: AGENT_INSTRUCTIONS_CUSTOM_RELATIVE_PATH,
        displayPath: "项目 Agent.md",
        stale: false,
      },
    });
  });

  it("regenerates agent.md by overwriting the single source file", async () => {
    const rootPath = await mkdtemp(join(tmpdir(), "agent-instructions-regenerate-"));
    tempDirs.push(rootPath);

    await mkdir(join(rootPath, ".git"), { recursive: true });
    await writeFile(join(rootPath, ".git", "HEAD"), "ref: refs/heads/main\n");
    await writeFile(
      join(rootPath, "package.json"),
      JSON.stringify({
        scripts: {
          dev: "vite",
          test: "vitest run",
        },
        devDependencies: {
          vite: "^7.0.0",
        },
      })
    );
    await writeFile(join(rootPath, "pnpm-lock.yaml"), "lockfileVersion: 9.0\n");
    await writeFile(join(rootPath, "README.md"), "# Repo\n");
    await mkdir(join(rootPath, WORKSPACE_STATE_DIR), { recursive: true });
    await writeFile(join(rootPath, AGENT_INSTRUCTIONS_CUSTOM_RELATIVE_PATH), "# Manual\n");

    const generateResult = await dispatch(
      {
        kind: "command",
        id: "agent-instructions-regenerate",
        op: "agentInstructions.regenerate",
        args: {
          workspaceId: "ws-1",
        },
      },
      createContext(rootPath)
    );

    expect(generateResult.ok).toBe(true);
    expect(generateResult.data).toMatchObject({
      path: AGENT_INSTRUCTIONS_CUSTOM_RELATIVE_PATH,
      exists: true,
    });

    const statusResult = await dispatch(
      {
        kind: "command",
        id: "agent-instructions-status-after-regenerate",
        op: "agentInstructions.status",
        args: {
          workspaceId: "ws-1",
        },
      },
      createContext(rootPath)
    );

    expect(statusResult.ok).toBe(true);
    expect(statusResult.data).toEqual({
      project: {
        exists: true,
        stale: false,
        path: AGENT_INSTRUCTIONS_CUSTOM_RELATIVE_PATH,
        displayPath: "项目 Agent.md",
      },
      system: expect.any(Array),
      document: {
        exists: true,
        stale: false,
        path: AGENT_INSTRUCTIONS_CUSTOM_RELATIVE_PATH,
        displayPath: "项目 Agent.md",
      },
    });

    const readResult = await dispatch(
      {
        kind: "command",
        id: "agent-instructions-read-after-regenerate",
        op: "agentInstructions.read",
        args: {
          workspaceId: "ws-1",
        },
      },
      createContext(rootPath)
    );

    expect(readResult.ok).toBe(true);
    expect((readResult.data as { content: string }).content).toContain("## Project Overview");
    expect((readResult.data as { content: string }).content).not.toContain("# Manual");
  });

  it("reports saved instructions as not stale even when they differ from generation", async () => {
    const rootPath = await mkdtemp(join(tmpdir(), "agent-instructions-status-stale-"));
    tempDirs.push(rootPath);

    await mkdir(join(rootPath, ".git"), { recursive: true });
    await mkdir(join(rootPath, WORKSPACE_STATE_DIR), { recursive: true });
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
    await writeFile(join(rootPath, AGENT_INSTRUCTIONS_CUSTOM_RELATIVE_PATH), "stale effective\n");

    const result = await dispatch(
      {
        kind: "command",
        id: "agent-instructions-status-stale",
        op: "agentInstructions.status",
        args: {
          workspaceId: "ws-1",
        },
      },
      createContext(rootPath)
    );

    expect(result.ok).toBe(true);
    expect(result.data).toEqual({
      project: {
        exists: true,
        stale: false,
        path: AGENT_INSTRUCTIONS_CUSTOM_RELATIVE_PATH,
        displayPath: "项目 Agent.md",
      },
      system: expect.any(Array),
      document: {
        exists: true,
        stale: false,
        path: AGENT_INSTRUCTIONS_CUSTOM_RELATIVE_PATH,
        displayPath: "项目 Agent.md",
      },
    });
  });

  it("returns session_not_found when attach target session is unavailable", async () => {
    const rootPath = await mkdtemp(join(tmpdir(), "agent-instructions-attach-missing-session-"));
    tempDirs.push(rootPath);
    const sessionMetadataRepo = createSessionMetadataRepo(rootPath);

    const result = await dispatch(
      {
        kind: "command",
        id: "agent-instructions-attach-missing-session",
        op: "agentInstructions.attachToSession",
        args: {
          workspaceId: "ws-1",
          sessionId: "sess-1",
        },
      },
      createContext(rootPath, {
        sessionMetadataRepo,
      })
    );

    expect(result.ok).toBe(false);
    expect(result.error).toMatchObject({
      code: "session_not_found",
    });
  });

  it("returns inject_target_unavailable when attach target session is not injectable", async () => {
    const rootPath = await mkdtemp(join(tmpdir(), "agent-instructions-attach-noninjectable-"));
    tempDirs.push(rootPath);
    const sessionMetadataRepo = createSessionMetadataRepo(rootPath);

    const result = await dispatch(
      {
        kind: "command",
        id: "agent-instructions-attach-noninjectable",
        op: "agentInstructions.attachToSession",
        args: {
          workspaceId: "ws-1",
          sessionId: "sess-1",
        },
      },
      createContext(rootPath, {
        sessionMetadataRepo,
        sessionMgr: {
          get: vi.fn(() => ({
            id: "sess-1",
            terminalId: "term-1",
            state: "starting",
            workspaceId: "ws-1",
            providerId: "codex",
            capability: "full",
            startedAt: 1,
            lastActiveAt: 1,
          })),
          sendInput: vi.fn(),
        } as never,
      })
    );

    expect(result.ok).toBe(false);
    expect(result.error).toMatchObject({
      code: "inject_target_unavailable",
    });
  });

  it("returns agent_instructions_missing when attach target has no agent instructions", async () => {
    const rootPath = await mkdtemp(join(tmpdir(), "agent-instructions-attach-missing-effective-"));
    tempDirs.push(rootPath);
    const sessionMetadataRepo = createSessionMetadataRepo(rootPath);

    const result = await dispatch(
      {
        kind: "command",
        id: "agent-instructions-attach-missing-effective",
        op: "agentInstructions.attachToSession",
        args: {
          workspaceId: "ws-1",
          sessionId: "sess-1",
        },
      },
      createContext(rootPath, {
        sessionMetadataRepo,
        sessionMgr: {
          get: vi.fn(() => ({
            id: "sess-1",
            terminalId: "term-1",
            state: "idle",
            workspaceId: "ws-1",
            providerId: "codex",
            capability: "full",
            startedAt: 1,
            lastActiveAt: 1,
          })),
          sendInput: vi.fn(),
        } as never,
      })
    );

    expect(result.ok).toBe(false);
    expect(result.error).toMatchObject({
      code: "agent_instructions_missing",
    });
  });

  it("injects agent instructions into the target session and records metadata", async () => {
    const rootPath = await mkdtemp(join(tmpdir(), "agent-instructions-attach-success-"));
    tempDirs.push(rootPath);
    const sessionMetadataRepo = createSessionMetadataRepo(rootPath);
    await mkdir(join(rootPath, WORKSPACE_STATE_DIR), { recursive: true });
    await writeFile(
      join(rootPath, AGENT_INSTRUCTIONS_CUSTOM_RELATIVE_PATH),
      ["# Agent Instructions", "", "- Custom rule.", ""].join("\n")
    );

    sessionMetadataRepo.upsert({
      sessionId: "sess-1",
      workspaceId: "ws-1",
      providerId: "codex",
      verificationRuns: [],
    });

    const sendInput = vi.fn();
    const result = await dispatch(
      {
        kind: "command",
        id: "agent-instructions-attach-success",
        op: "agentInstructions.attachToSession",
        args: {
          workspaceId: "ws-1",
          sessionId: "sess-1",
        },
      },
      createContext(rootPath, {
        sessionMetadataRepo,
        sessionMgr: {
          get: vi.fn(() => ({
            id: "sess-1",
            terminalId: "term-1",
            state: "idle",
            workspaceId: "ws-1",
            providerId: "codex",
            capability: "full",
            startedAt: 1,
            lastActiveAt: 1,
          })),
          sendInput,
        } as never,
      })
    );

    expect(result.ok).toBe(true);
    expect(result.data).toMatchObject({
      injected: true,
      sessionId: "sess-1",
      mode: "manual",
      effectiveHash: expect.any(String),
    });
    expect(sendInput).toHaveBeenCalledWith("sess-1", expect.any(Buffer), "internal_submit");

    const payload = (sendInput.mock.calls[0]?.[1] as Buffer).toString("utf8");
    expect(payload.startsWith("\x1b[200~")).toBe(true);
    expect(payload.endsWith("\x1b[201~\r")).toBe(true);
    expect(payload).toContain("# Agent Instructions");
    expect(payload).toContain("- Custom rule.");

    expect(sessionMetadataRepo.get("sess-1")).toMatchObject({
      attachedAgentInstructions: {
        effectiveHash: (result.data as { effectiveHash: string }).effectiveHash,
        mode: "manual",
        attachedAt: expect.any(Number),
      },
    });
  });
});
