import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ProviderDefinition } from "@coder-studio/core";
import { afterEach, describe, expect, it } from "vitest";
import { AgentInstructionsPublisher } from "../agent-instructions/publisher.js";
import type { CommandAvailabilityCheck } from "../provider-runtime/command-check.js";

describe("AgentInstructionsPublisher", () => {
  const tempDirs: string[] = [];

  afterEach(async () => {
    await Promise.all(
      tempDirs.map(async (dir) => {
        try {
          await rm(dir, { recursive: true, force: true });
        } catch {
          // Ignore cleanup failures in tests.
        }
      })
    );
  });

  function createProvider(
    id: string,
    path?: string,
    requiredCommands: string[] = []
  ): ProviderDefinition {
    return {
      id,
      displayName: id,
      badge: id,
      kind: "built_in",
      capability: "full",
      capabilities: [],
      install: {
        prerequisites: [],
        manualGuideKeys: [],
        docUrls: {
          provider: "",
          prerequisites: {},
        },
        strategies: {},
      },
      buildCommand() {
        return { argv: [], env: {}, cwd: "/" };
      },
      configSchema: {} as ProviderDefinition["configSchema"],
      defaultConfig: {},
      requiredCommands,
      agentInstructions: path
        ? {
            publishTarget: {
              path,
            },
          }
        : undefined,
    };
  }

  function createPublisher(
    rootPath: string,
    providers: ProviderDefinition[],
    commandExists?: CommandAvailabilityCheck
  ) {
    return new AgentInstructionsPublisher({
      workspaceMgr: {
        get(workspaceId: string) {
          if (workspaceId !== "ws-1") {
            return undefined;
          }

          return {
            id: workspaceId,
            path: rootPath,
            targetRuntime: "native" as const,
            openedAt: Date.now(),
            lastActiveAt: Date.now(),
            uiState: {
              leftPanelWidth: 320,
              bottomPanelHeight: 240,
              focusMode: false,
            },
          };
        },
        list() {
          return [
            {
              id: "ws-1",
              path: rootPath,
              targetRuntime: "native" as const,
              openedAt: Date.now(),
              lastActiveAt: Date.now(),
              uiState: {
                leftPanelWidth: 320,
                bottomPanelHeight: 240,
                focusMode: false,
              },
            },
          ];
        },
      },
      getProviderRegistry: () => providers,
      commandExists,
    });
  }

  it("publishes only the targets declared by the active provider registry", async () => {
    const rootPath = await mkdtemp(join(tmpdir(), "agent-instructions-publisher-"));
    tempDirs.push(rootPath);

    await mkdir(join(rootPath, ".coder-studio"), { recursive: true });
    await writeFile(
      join(rootPath, ".coder-studio", "agent.md"),
      "# Agent Instructions\n\n- Custom rule.\n"
    );

    const publisher = createPublisher(rootPath, [createProvider("codex", "AGENTS.md")]);
    const result = await publisher.syncWorkspace("ws-1");

    expect(result.targets).toEqual([
      expect.objectContaining({
        providerIds: ["codex"],
        path: "AGENTS.md",
        action: "written",
      }),
    ]);

    const codex = await readFile(join(rootPath, "AGENTS.md"), "utf8");
    expect(codex).toContain("# Agent Instructions");
    await expect(stat(join(rootPath, ".claude", "CLAUDE.md"))).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("ignores providers without an agent instructions publish target", async () => {
    const rootPath = await mkdtemp(join(tmpdir(), "agent-instructions-publisher-ignore-"));
    tempDirs.push(rootPath);

    await mkdir(join(rootPath, ".coder-studio"), { recursive: true });
    await writeFile(
      join(rootPath, ".coder-studio", "agent.md"),
      "# Agent Instructions\n\n- Custom rule.\n"
    );

    const publisher = createPublisher(rootPath, [
      createProvider("codex", "AGENTS.md"),
      createProvider("local-custom"),
    ]);
    const result = await publisher.syncWorkspace("ws-1");

    expect(result.targets).toEqual([
      expect.objectContaining({
        providerIds: ["codex"],
        path: "AGENTS.md",
        action: "written",
      }),
    ]);
  });

  it("publishes multiple provider-specific targets when multiple providers declare them", async () => {
    const rootPath = await mkdtemp(join(tmpdir(), "agent-instructions-publisher-multi-"));
    tempDirs.push(rootPath);

    await mkdir(join(rootPath, ".coder-studio"), { recursive: true });
    await writeFile(
      join(rootPath, ".coder-studio", "agent.md"),
      "# Agent Instructions\n\n- Custom rule.\n"
    );

    const publisher = createPublisher(rootPath, [
      createProvider("codex", "AGENTS.md"),
      createProvider("claude", ".claude/CLAUDE.md"),
    ]);
    const result = await publisher.syncWorkspace("ws-1");

    expect(result.targets).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          providerIds: ["codex"],
          path: "AGENTS.md",
          action: "written",
        }),
        expect.objectContaining({
          providerIds: ["claude"],
          path: ".claude/CLAUDE.md",
          action: "written",
        }),
      ])
    );
  });

  it("publishes one shared AGENTS.md target for providers that use the same official file", async () => {
    const rootPath = await mkdtemp(join(tmpdir(), "agent-instructions-publisher-shared-"));
    tempDirs.push(rootPath);

    await mkdir(join(rootPath, ".coder-studio"), { recursive: true });
    await writeFile(
      join(rootPath, ".coder-studio", "agent.md"),
      "# Agent Instructions\n\n- Custom rule.\n"
    );

    const publisher = createPublisher(rootPath, [
      createProvider("codex", "AGENTS.md"),
      createProvider("cursor", "AGENTS.md"),
      createProvider("opencode", "AGENTS.md"),
    ]);
    const result = await publisher.syncWorkspace("ws-1");

    expect(result.targets).toEqual([
      expect.objectContaining({
        providerIds: ["codex", "cursor", "opencode"],
        path: "AGENTS.md",
        action: "written",
      }),
    ]);
  });

  it("defaults to publishing declared targets when install status is unavailable", async () => {
    const rootPath = await mkdtemp(join(tmpdir(), "agent-instructions-publisher-default-"));
    tempDirs.push(rootPath);

    await mkdir(join(rootPath, ".coder-studio"), { recursive: true });
    await writeFile(
      join(rootPath, ".coder-studio", "agent.md"),
      "# Agent Instructions\n\n- Custom rule.\n"
    );

    const publisher = createPublisher(rootPath, [createProvider("codex", "AGENTS.md", ["codex"])]);
    const result = await publisher.syncWorkspace("ws-1");

    expect(result.targets).toEqual([
      expect.objectContaining({
        providerIds: ["codex"],
        path: "AGENTS.md",
        action: "written",
      }),
    ]);
  });

  it("publishes only targets for installed providers", async () => {
    const rootPath = await mkdtemp(join(tmpdir(), "agent-instructions-publisher-installed-"));
    tempDirs.push(rootPath);

    await mkdir(join(rootPath, ".coder-studio"), { recursive: true });
    await writeFile(
      join(rootPath, ".coder-studio", "agent.md"),
      "# Agent Instructions\n\n- Custom rule.\n"
    );

    const publisher = createPublisher(
      rootPath,
      [
        createProvider("codex", "AGENTS.md", ["codex"]),
        createProvider("claude", ".claude/CLAUDE.md", ["claude"]),
      ],
      async (command) => command === "codex"
    );
    const result = await publisher.syncWorkspace("ws-1");

    expect(result.targets).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          providerIds: ["codex"],
          path: "AGENTS.md",
          action: "written",
        }),
        expect.objectContaining({
          providerIds: ["claude"],
          path: ".claude/CLAUDE.md",
          action: "unchanged",
        }),
      ])
    );

    const codex = await readFile(join(rootPath, "AGENTS.md"), "utf8");
    expect(codex).toContain("# Agent Instructions");
    await expect(stat(join(rootPath, ".claude", "CLAUDE.md"))).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("deletes stale target files when the provider is no longer installed", async () => {
    const rootPath = await mkdtemp(join(tmpdir(), "agent-instructions-publisher-stale-"));
    tempDirs.push(rootPath);

    await mkdir(join(rootPath, ".coder-studio"), { recursive: true });
    await writeFile(
      join(rootPath, ".coder-studio", "agent.md"),
      "# Agent Instructions\n\n- Custom rule.\n"
    );
    await mkdir(join(rootPath, ".claude"), { recursive: true });
    await writeFile(join(rootPath, ".claude", "CLAUDE.md"), "stale claude content\n");

    const publisher = createPublisher(
      rootPath,
      [createProvider("claude", ".claude/CLAUDE.md", ["claude"])],
      async () => false
    );
    const result = await publisher.syncWorkspace("ws-1");

    expect(result.targets).toEqual([
      expect.objectContaining({
        providerIds: ["claude"],
        path: ".claude/CLAUDE.md",
        action: "deleted",
      }),
    ]);
    await expect(stat(join(rootPath, ".claude", "CLAUDE.md"))).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("deletes managed targets when no agent instructions exist", async () => {
    const rootPath = await mkdtemp(join(tmpdir(), "agent-instructions-publisher-empty-"));
    tempDirs.push(rootPath);

    await writeFile(join(rootPath, "AGENTS.md"), "stale shared content\n");
    await mkdir(join(rootPath, ".claude"), { recursive: true });
    await writeFile(join(rootPath, ".claude", "CLAUDE.md"), "stale claude content\n");

    const publisher = createPublisher(rootPath, [
      createProvider("codex", "AGENTS.md"),
      createProvider("cursor", "AGENTS.md"),
      createProvider("opencode", "AGENTS.md"),
      createProvider("claude", ".claude/CLAUDE.md"),
    ]);
    const result = await publisher.syncWorkspace("ws-1");

    expect(result.targets).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          providerIds: ["codex", "cursor", "opencode"],
          path: "AGENTS.md",
          action: "deleted",
        }),
        expect.objectContaining({
          providerIds: ["claude"],
          path: ".claude/CLAUDE.md",
          action: "deleted",
        }),
      ])
    );
    await expect(stat(join(rootPath, "AGENTS.md"))).rejects.toMatchObject({
      code: "ENOENT",
    });
    await expect(stat(join(rootPath, ".claude", "CLAUDE.md"))).rejects.toMatchObject({
      code: "ENOENT",
    });
  });
});
