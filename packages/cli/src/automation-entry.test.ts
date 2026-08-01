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

  it("maps canvas.inspect with source-path in session mode", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});

    await main(["canvas.inspect", "--source-path", "docs/report.md", "--json"]);

    expect(callCoderStudioCommand).toHaveBeenCalledWith({
      apiUrl: "http://127.0.0.1:4173",
      resolveStrategy: "session",
      op: "canvas.inspect",
      args: {
        workspaceId: "ws-1",
        sourcePath: "docs/report.md",
      },
    });
  });

  it("maps canvas.preset.list in session mode", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});

    await main(["canvas.preset.list", "--json"]);

    expect(callCoderStudioCommand).toHaveBeenCalledWith({
      apiUrl: "http://127.0.0.1:4173",
      resolveStrategy: "session",
      op: "canvas.preset.list",
      args: {
        workspaceId: "ws-1",
      },
    });
  });

  it("maps canvas.create-from-preset with open flag in session mode", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});

    await main([
      "canvas.create-from-preset",
      "--preset-id",
      "token-consumption-trend",
      "--title",
      "Usage Trend",
      "--open",
      "--json",
    ]);

    expect(callCoderStudioCommand).toHaveBeenCalledWith({
      apiUrl: "http://127.0.0.1:4173",
      resolveStrategy: "session",
      op: "canvas.create-from-preset",
      args: {
        workspaceId: "ws-1",
        presetId: "token-consumption-trend",
        title: "Usage Trend",
        openInEditor: true,
      },
    });
  });

  it("maps canvas.snapshot.create with source-path in session mode", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});

    await main([
      "canvas.snapshot.create",
      "--source-path",
      ".coder-studio/canvases/usage-trend.csc",
      "--json",
    ]);

    expect(callCoderStudioCommand).toHaveBeenCalledWith({
      apiUrl: "http://127.0.0.1:4173",
      resolveStrategy: "session",
      op: "canvas.snapshot.create",
      args: {
        workspaceId: "ws-1",
        sourcePath: ".coder-studio/canvases/usage-trend.csc",
      },
    });
  });

  it("maps canvas.clone from a snapshot in session mode", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});

    await main([
      "canvas.clone",
      "--snapshot-id",
      "snapshot_123",
      "--title",
      "Usage Trend Copy",
      "--open",
      "--json",
    ]);

    expect(callCoderStudioCommand).toHaveBeenCalledWith({
      apiUrl: "http://127.0.0.1:4173",
      resolveStrategy: "session",
      op: "canvas.clone",
      args: {
        workspaceId: "ws-1",
        snapshotId: "snapshot_123",
        title: "Usage Trend Copy",
        openInEditor: true,
      },
    });
  });

  it("rejects unsupported automation ops", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});

    await expect(main(["ui.launch-rocket", "--json"])).rejects.toThrow(
      "Unsupported automation op: ui.launch-rocket"
    );
    expect(callCoderStudioCommand).not.toHaveBeenCalled();
  });
});
