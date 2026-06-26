import {
  type AutomationPermission,
  DEFAULT_AGENT_AUTOMATION_PERMISSIONS,
  SCOPED_SESSION_AUTOMATION_PERMISSIONS,
} from "@coder-studio/core";
import { describe, expect, it } from "vitest";
import type { CommandContext } from "../../ws/dispatch.js";
import { dispatch } from "../../ws/dispatch.js";
import "../../commands/automation.js";

function createBaseContext(overrides: Partial<CommandContext> = {}): CommandContext {
  return {
    workspaceMgr: {} as never,
    sessionMgr: {} as never,
    terminalMgr: {} as never,
    eventBus: {} as never,
    broadcaster: {} as never,
    settingsRepo: {} as never,
    providerConfigRepo: {} as never,
    providerRegistry: [],
    fencingMgr: {} as never,
    supervisorMgr: {} as never,
    autoFetch: {} as never,
    activationMgr: { getLease: () => undefined } as never,
    lspMgr: {} as never,
    ...overrides,
  } as CommandContext;
}

describe("automation commands", () => {
  it("returns identify data from supplied env", async () => {
    const result = await dispatch(
      {
        kind: "command",
        id: "automation-identify-1",
        op: "automation.identify",
        args: {
          env: {
            CODER_STUDIO: "1",
            CODER_STUDIO_WORKSPACE_ID: "ws-1",
            CODER_STUDIO_SESSION_ID: "sess-1",
            CODER_STUDIO_PROVIDER_ID: "codex",
            CODER_STUDIO_API_URL: "http://127.0.0.1:4173",
          },
          cwd: "/repo",
        },
      },
      createBaseContext()
    );

    expect(result.ok).toBe(true);
    expect(result.data).toMatchObject({
      insideCoderStudio: true,
      workspaceId: "ws-1",
      sessionId: "sess-1",
      providerId: "codex",
      cwd: "/repo",
    });
  });

  it("returns filtered capabilities", async () => {
    const permissions: AutomationPermission[] = ["workspace:read"];
    const result = await dispatch(
      {
        kind: "command",
        id: "automation-capabilities-1",
        op: "automation.capabilities",
        args: { permissions },
      },
      createBaseContext()
    );

    expect(result.ok).toBe(true);
    expect(result.data).toMatchObject({ version: 1 });
    expect((result.data as { commands: Array<{ name: string }> }).commands).toEqual([
      expect.objectContaining({ name: "workspace.list" }),
    ]);
  });

  it("uses default agent permissions when none are supplied", async () => {
    const result = await dispatch(
      {
        kind: "command",
        id: "automation-capabilities-default-1",
        op: "automation.capabilities",
        args: {},
      },
      createBaseContext()
    );

    expect(result.ok).toBe(true);
    expect((result.data as { commands: Array<{ name: string }> }).commands).toEqual(
      expect.arrayContaining([expect.objectContaining({ name: "git.status" })])
    );
    expect(DEFAULT_AGENT_AUTOMATION_PERMISSIONS).toContain("git:read");
  });

  it("uses scoped token permissions from websocket auth context when no permissions are supplied", async () => {
    const result = await dispatch(
      {
        kind: "command",
        id: "automation-capabilities-token-default-1",
        op: "automation.capabilities",
        args: {},
      },
      createBaseContext({
        broadcaster: {
          getRequestMetadata: () =>
            ({
              coderStudioAuthContext: {
                mode: "session_token",
                token: "tok-1",
                sessionId: "sess-1",
                workspaceId: "ws-1",
                providerId: "codex",
                permissions: SCOPED_SESSION_AUTOMATION_PERMISSIONS,
                createdAt: 1,
              },
            }) as never,
        } as never,
      }),
      "ws-token"
    );

    expect(result.ok).toBe(true);
    const commands = (result.data as { commands: Array<{ name: string }> }).commands;
    expect(commands).toEqual(
      expect.arrayContaining([expect.objectContaining({ name: "git.status" })])
    );
    expect(commands).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ name: "workspace.list" })])
    );
  });
});
