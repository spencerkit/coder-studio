import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { callCoderStudioCommand } = vi.hoisted(() => ({
  callCoderStudioCommand: vi.fn(),
}));

vi.mock("./automation-command-client.js", () => ({
  callCoderStudioCommand,
}));

import { main } from "./automation-entry.js";

describe("automation entry", () => {
  beforeEach(() => {
    vi.stubEnv("CODER_STUDIO_API_URL", "http://127.0.0.1:4173");
    vi.stubEnv("CODER_STUDIO_WORKSPACE_ID", "ws-1");
    callCoderStudioCommand.mockResolvedValue({ ok: true });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    vi.clearAllMocks();
  });

  it("maps memory.create to the existing websocket command shape in session mode", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});

    await main([
      "memory.create",
      "--type",
      "issue",
      "--content",
      "Verify memory status forwarding.",
      "--status",
      "pending_verification",
      "--skill",
      "coder-studio-memory",
      "--json",
    ]);

    expect(callCoderStudioCommand).toHaveBeenCalledWith({
      apiUrl: "http://127.0.0.1:4173",
      resolveStrategy: "session",
      op: "memory.create",
      args: {
        workspaceId: "ws-1",
        type: "issue",
        content: "Verify memory status forwarding.",
        status: "pending_verification",
        sourceHint: { skillSlug: "coder-studio-memory" },
      },
    });
  });

  it("maps ui.open-file to uiAction.dispatch in session mode", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});

    await main([
      "ui.open-file",
      "--path",
      "src/index.ts",
      "--line",
      "12",
      "--column",
      "3",
      "--json",
    ]);

    expect(callCoderStudioCommand).toHaveBeenCalledWith({
      apiUrl: "http://127.0.0.1:4173",
      resolveStrategy: "session",
      op: "uiAction.dispatch",
      args: {
        workspaceId: "ws-1",
        intent: {
          type: "editor.openFile",
          workspaceId: "ws-1",
          path: "src/index.ts",
          line: 12,
          column: 3,
        },
        source: { kind: "agent" },
      },
    });
  });

  it("maps ui.open-canvas to a minimal uiAction.dispatch payload in session mode", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});

    await main(["ui.open-canvas", "--canvas", "canvas_123", "--json"]);

    expect(callCoderStudioCommand).toHaveBeenCalledWith({
      apiUrl: "http://127.0.0.1:4173",
      resolveStrategy: "session",
      op: "uiAction.dispatch",
      args: {
        workspaceId: "ws-1",
        intent: {
          type: "canvas.open",
          workspaceId: "ws-1",
          canvasId: "canvas_123",
        },
        source: { kind: "agent" },
      },
    });
  });

  it("rejects missing ui.open-file path values when the next token is another flag", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});

    await expect(main(["ui.open-file", "--path", "--json"])).rejects.toThrow("Missing path value");
    expect(callCoderStudioCommand).not.toHaveBeenCalled();
  });

  it("allows option values that begin with a single dash", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});

    await main(["memory.create", "--type", "note", "--content", "- starts with dash", "--json"]);

    expect(callCoderStudioCommand).toHaveBeenCalledWith({
      apiUrl: "http://127.0.0.1:4173",
      resolveStrategy: "session",
      op: "memory.create",
      args: {
        workspaceId: "ws-1",
        type: "note",
        content: "- starts with dash",
      },
    });
  });

  it("maps ui.close-url to uiAction.dispatch in session mode", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});

    await main(["ui.close-url", "--url", "https://example.com", "--json"]);

    expect(callCoderStudioCommand).toHaveBeenCalledWith({
      apiUrl: "http://127.0.0.1:4173",
      resolveStrategy: "session",
      op: "uiAction.dispatch",
      args: {
        workspaceId: "ws-1",
        intent: {
          type: "browser.closeUrl",
          workspaceId: "ws-1",
          url: "https://example.com",
        },
        source: { kind: "agent" },
      },
    });
  });

  it("maps canvas.render with source-path in session mode", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});

    await main(["canvas.render", "--source-path", "docs/report.md", "--json"]);

    expect(callCoderStudioCommand).toHaveBeenCalledWith({
      apiUrl: "http://127.0.0.1:4173",
      resolveStrategy: "session",
      op: "canvas.render",
      args: {
        workspaceId: "ws-1",
        sourcePath: "docs/report.md",
      },
    });
  });

  it("maps session.activity.record with files to the existing websocket command shape in session mode", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.stubEnv("CODER_STUDIO_SESSION_ID", "session-env-1");

    await main([
      "session.activity.record",
      "--kind",
      "tool",
      "--phase",
      "execution",
      "--title",
      "Run verification",
      "--summary",
      "Executed the targeted vitest command.",
      "--status",
      "completed",
      "--command",
      "pnpm exec vitest run packages/cli/src/automation-entry.test.ts",
      "--files",
      '["packages/cli/src/automation-entry.ts","packages/cli/src/automation-entry.test.ts"]',
      "--payload-json",
      '{"attempt":1}',
      "--json",
    ]);

    expect(callCoderStudioCommand).toHaveBeenCalledWith({
      apiUrl: "http://127.0.0.1:4173",
      resolveStrategy: "session",
      op: "session.activity.record",
      args: {
        sessionId: "session-env-1",
        kind: "tool",
        phase: "execution",
        title: "Run verification",
        summary: "Executed the targeted vitest command.",
        status: "completed",
        command: "pnpm exec vitest run packages/cli/src/automation-entry.test.ts",
        files: [
          "packages/cli/src/automation-entry.ts",
          "packages/cli/src/automation-entry.test.ts",
        ],
        payload: { attempt: 1 },
      },
    });
  });

  it("maps session.activity.list to the existing websocket command shape in session mode", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});

    await main(["session.activity.list", "--session", "session-123", "--json"]);

    expect(callCoderStudioCommand).toHaveBeenCalledWith({
      apiUrl: "http://127.0.0.1:4173",
      resolveStrategy: "session",
      op: "session.activity.list",
      args: {
        sessionId: "session-123",
      },
    });
  });

  it("uses CODER_STUDIO_SESSION_ID when session.activity.list does not provide a session flag", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.stubEnv("CODER_STUDIO_SESSION_ID", "session-from-env");

    await main(["session.activity.list", "--json"]);

    expect(callCoderStudioCommand).toHaveBeenCalledWith({
      apiUrl: "http://127.0.0.1:4173",
      resolveStrategy: "session",
      op: "session.activity.list",
      args: {
        sessionId: "session-from-env",
      },
    });
  });

  it("rejects session.activity.list when no session id is provided by flag or env", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.stubEnv("CODER_STUDIO_SESSION_ID", "");

    await expect(main(["session.activity.list", "--json"])).rejects.toThrow(
      "Missing CODER_STUDIO_SESSION_ID or --session value"
    );
    expect(callCoderStudioCommand).not.toHaveBeenCalled();
  });

  it("rejects unsupported automation ops", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});

    await expect(main(["ui.launch-rocket", "--json"])).rejects.toThrow(
      "Unsupported automation op: ui.launch-rocket"
    );
    expect(callCoderStudioCommand).not.toHaveBeenCalled();
  });
});
