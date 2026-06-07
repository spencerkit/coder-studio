import { describe, expect, it } from "vitest";
import {
  buildIdentifyResult,
  DEFAULT_AGENT_AUTOMATION_PERMISSIONS,
  listAutomationCapabilities,
} from "./automation.js";

describe("automation domain", () => {
  it("returns outside-Coder-Studio when env marker is absent", () => {
    expect(buildIdentifyResult({ env: {} })).toEqual({ insideCoderStudio: false });
  });

  it("returns runtime context from Coder Studio env", () => {
    expect(
      buildIdentifyResult({
        env: {
          CODER_STUDIO: "1",
          CODER_STUDIO_WORKSPACE_ID: "ws-1",
          CODER_STUDIO_SESSION_ID: "sess-1",
          CODER_STUDIO_TERMINAL_ID: "term-1",
          CODER_STUDIO_PROVIDER_ID: "codex",
          CODER_STUDIO_API_URL: "http://127.0.0.1:4173",
        },
        cwd: "/repo",
      })
    ).toEqual({
      insideCoderStudio: true,
      workspaceId: "ws-1",
      sessionId: "sess-1",
      terminalId: "term-1",
      providerId: "codex",
      cwd: "/repo",
      apiUrl: "http://127.0.0.1:4173",
      permissions: DEFAULT_AGENT_AUTOMATION_PERMISSIONS,
    });
  });

  it("lists capabilities allowed by caller permissions", () => {
    const capabilities = listAutomationCapabilities({
      permissions: DEFAULT_AGENT_AUTOMATION_PERMISSIONS,
    });

    expect(capabilities.map((capability) => capability.name)).toContain("git.status");
    expect(capabilities.find((capability) => capability.name === "git.status")).toMatchObject({
      cli: "coder-studio git status",
      permissions: ["git:read"],
      riskLevel: "read",
      available: true,
    });
    expect(capabilities.find((capability) => capability.name === "session.list")).toMatchObject({
      inputSchema: { workspaceId: "string" },
      examples: ["coder-studio session list --workspace ws_123 --json"],
    });
    expect(capabilities.find((capability) => capability.name === "git.diff")).toMatchObject({
      inputSchema: { workspaceId: "string", path: "string", staged: "boolean optional" },
      examples: ["coder-studio git diff --workspace ws_123 --path src/a.ts --json"],
    });
  });

  it("filters capabilities by permissions", () => {
    const capabilities = listAutomationCapabilities({
      permissions: ["workspace:read"],
    });

    expect(capabilities.map((capability) => capability.name)).toContain("workspace.list");
    expect(capabilities.map((capability) => capability.name)).not.toContain("git.status");
  });
});
