import { providerRegistry } from "@coder-studio/providers";
import { beforeEach, describe, expect, it } from "vitest";
import type { CommandContext } from "../ws/dispatch.js";
import { dispatch } from "../ws/dispatch.js";
import "../commands/provider.js";

describe("provider.list command", () => {
  let ctx: CommandContext;

  beforeEach(() => {
    ctx = {
      workspaceMgr: {} as never,
      sessionMgr: {} as never,
      terminalMgr: {} as never,
      eventBus: {} as never,
      broadcaster: {} as never,
      db: {} as never,
      providerRegistry,
      fencingMgr: {} as never,
      supervisorMgr: {} as never,
      autoFetch: {} as never,
      activationMgr: {} as never,
    };
  });

  it("returns built-in provider DTOs through dispatch", async () => {
    const result = await dispatch(
      {
        kind: "command",
        id: "provider-list-1",
        op: "provider.list",
        args: {},
      },
      ctx
    );

    expect(result.ok).toBe(true);
    expect(result.data).toEqual(
      expect.arrayContaining([
        {
          id: "claude",
          displayName: "Claude Code",
          badge: "Claude",
          kind: "built_in",
          stability: undefined,
          supportsAgentInstructions: true,
          supportsAgentInstructionsGeneration: true,
          supportsSkillsMount: true,
          capability: "full",
          capabilities: [
            { key: "interactive_session", supported: true, label: "Interactive session" },
            { key: "supervisor_eval", supported: true, label: "Supervisor evaluation" },
            { key: "idle_detection", supported: true, label: "Idle detection" },
            { key: "context_attach", supported: false, label: "Context attach" },
            { key: "review", supported: false, label: "Review" },
          ],
          requiredCommands: ["claude"],
        },
        {
          id: "codex",
          displayName: "Codex",
          badge: "Codex",
          kind: "built_in",
          stability: undefined,
          supportsAgentInstructions: true,
          supportsAgentInstructionsGeneration: true,
          supportsSkillsMount: true,
          capability: "full",
          capabilities: [
            { key: "interactive_session", supported: true, label: "Interactive session" },
            { key: "supervisor_eval", supported: true, label: "Supervisor evaluation" },
            { key: "idle_detection", supported: true, label: "Idle detection" },
            { key: "context_attach", supported: false, label: "Context attach" },
            { key: "review", supported: false, label: "Review" },
          ],
          requiredCommands: ["codex"],
        },
        expect.objectContaining({
          id: "gemini",
          displayName: "Gemini CLI",
          kind: "built_in",
          stability: "stable",
          supportsAgentInstructions: true,
          supportsAgentInstructionsGeneration: true,
          supportsSkillsMount: true,
          capability: "full",
          requiredCommands: ["gemini"],
        }),
        expect.objectContaining({
          id: "cursor",
          displayName: "Cursor Agent",
          kind: "built_in",
          stability: "stable",
          supportsAgentInstructions: true,
          supportsAgentInstructionsGeneration: true,
          supportsSkillsMount: true,
          capability: "full",
          requiredCommands: ["agent"],
        }),
        expect.objectContaining({
          id: "opencode",
          displayName: "OpenCode",
          kind: "built_in",
          stability: "experimental",
          supportsAgentInstructions: true,
          supportsAgentInstructionsGeneration: false,
          supportsSkillsMount: true,
          capability: "limited",
          requiredCommands: ["opencode"],
        }),
      ])
    );
    expect(result.data).toHaveLength(providerRegistry.length);
  });

  it("includes custom providers already present in the command context registry", async () => {
    ctx.providerRegistry = [
      ...providerRegistry,
      {
        id: "review-bot",
        displayName: "Review Bot",
        badge: "Custom",
        kind: "custom",
        capability: "full",
        capabilities: [
          { key: "interactive_session", supported: true, label: "Interactive session" },
          { key: "review", supported: true, label: "Review" },
        ],
        install: {
          prerequisites: [],
          manualGuideKeys: [],
          docUrls: { provider: "", prerequisites: {} },
          strategies: {},
        },
        buildCommand: () => ({ argv: ["review-bot"], cwd: "/tmp", env: {} }),
        configSchema: { parse: (value: unknown) => value } as never,
        defaultConfig: {},
        requiredCommands: ["review-bot"],
      },
    ];

    const result = await dispatch(
      {
        kind: "command",
        id: "provider-list-custom",
        op: "provider.list",
        args: {},
      },
      ctx
    );

    expect(result.ok).toBe(true);
    expect(result.data).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "review-bot",
          kind: "custom",
          supportsAgentInstructionsGeneration: false,
          requiredCommands: ["review-bot"],
        }),
      ])
    );
  });
});
