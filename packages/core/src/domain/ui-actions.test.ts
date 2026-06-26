import { describe, expect, it } from "vitest";
import {
  createUiActionEvent,
  listUiActionCapabilities,
  normalizeUiActionDispatchRequest,
  type UiActionDispatchRequest,
  validateUiActionIntent,
} from "./ui-actions.js";

describe("ui action domain", () => {
  it("lists MVP UI action capabilities with CLI examples", () => {
    const capabilities = listUiActionCapabilities({ permissions: ["ui:navigate", "ui:command"] });

    expect(capabilities.map((capability) => capability.type)).toEqual([
      "editor.openFile",
      "editor.closeFile",
      "browser.openUrl",
      "browser.closeUrl",
      "canvas.open",
      "workspace.focus",
      "panel.show",
      "command.run",
    ]);
    expect(capabilities.find((capability) => capability.type === "editor.openFile")).toMatchObject({
      cli: "coder-studio ui open-file --path <workspace-relative-path>",
      permissions: ["ui:navigate"],
      riskLevel: "read",
      available: true,
    });
    expect(capabilities.find((capability) => capability.type === "editor.closeFile")).toMatchObject(
      {
        cli: "coder-studio ui close-file --path <workspace-relative-path>",
        permissions: ["ui:navigate"],
        riskLevel: "read",
        available: true,
      }
    );
    expect(capabilities.find((capability) => capability.type === "browser.closeUrl")).toMatchObject(
      {
        cli: "coder-studio ui close-url --url <localhost-url>",
        permissions: ["ui:navigate"],
        riskLevel: "read",
        available: true,
      }
    );
    expect(capabilities.find((capability) => capability.type === "canvas.open")).toMatchObject({
      cli: "coder-studio ui open-canvas --canvas <canvas-id>",
      description:
        "Open a persisted canvas artifact in the built-in editor. Canonical dispatch payloads are sourcePath-first; canvasId remains a compatibility identifier and CLI path.",
      inputSchema: {
        workspaceId: "string optional",
        title: "string required for canonical sourcePath payloads",
        artifactType:
          "architecture_canvas | report_canvas required for canonical sourcePath payloads",
        sourcePath: "workspace-relative string required for canonical sourcePath payloads",
        canvasId: "string optional compatibility identifier",
      },
      permissions: ["ui:navigate"],
      riskLevel: "read",
      available: true,
    });
    expect(capabilities.find((capability) => capability.type === "canvas.open")?.examples).toEqual([
      '{"type":"canvas.open","workspaceId":"ws_123","title":"Runtime Flow","artifactType":"architecture_canvas","sourcePath":".coder-studio/canvases/runtime-flow.csc"}',
      "coder-studio ui open-canvas --workspace ws_123 --canvas canvas_123 --json",
    ]);
  });

  it("filters UI action capabilities by permissions", () => {
    expect(
      listUiActionCapabilities({ permissions: ["ui:navigate"] }).map(
        (capability) => capability.type
      )
    ).toEqual([
      "editor.openFile",
      "editor.closeFile",
      "browser.openUrl",
      "browser.closeUrl",
      "canvas.open",
      "workspace.focus",
      "panel.show",
    ]);

    expect(
      listUiActionCapabilities({ permissions: ["ui:command"] }).map((capability) => capability.type)
    ).toEqual(["command.run"]);
  });

  it("rejects unsafe workspace paths", () => {
    expect(() => validateUiActionIntent({ type: "editor.openFile", path: "/etc/passwd" })).toThrow(
      "workspace-relative"
    );
    expect(() =>
      validateUiActionIntent({ type: "editor.openFile", path: "../secret.txt" })
    ).toThrow("workspace-relative");
    expect(() =>
      validateUiActionIntent({ type: "editor.openFile", path: "src/app.ts", line: 0 })
    ).toThrow("positive integer");

    expect(validateUiActionIntent({ type: "editor.closeFile", path: "src/app.ts" })).toEqual({
      type: "editor.closeFile",
      path: "src/app.ts",
    });
    expect(() =>
      validateUiActionIntent({ type: "editor.closeFile", path: "../secret.txt" })
    ).toThrow("workspace-relative");
  });

  it("accepts localhost URLs and rejects external URLs", () => {
    expect(
      validateUiActionIntent({ type: "browser.openUrl", url: "http://127.0.0.1:5173" })
    ).toEqual({
      type: "browser.openUrl",
      url: "http://127.0.0.1:5173/",
    });
    expect(
      validateUiActionIntent({ type: "browser.closeUrl", url: "http://127.0.0.1:5173" })
    ).toEqual({
      type: "browser.closeUrl",
      url: "http://127.0.0.1:5173/",
    });
    expect(validateUiActionIntent({ type: "browser.openUrl", url: "http://[::1]:5173" })).toEqual({
      type: "browser.openUrl",
      url: "http://[::1]:5173/",
    });

    expect(() =>
      validateUiActionIntent({ type: "browser.openUrl", url: "https://example.com" })
    ).toThrow("localhost URLs");
    expect(() =>
      validateUiActionIntent({ type: "browser.closeUrl", url: "https://example.com" })
    ).toThrow("localhost URLs");
  });

  it("validates and normalizes canvas.open intents", () => {
    expect(
      validateUiActionIntent({
        type: "canvas.open",
        workspaceId: "ws-1",
        title: " Runtime Flow ",
        artifactType: "architecture_canvas",
        sourcePath: ".coder-studio/canvases/runtime-flow.csc",
      })
    ).toEqual({
      type: "canvas.open",
      workspaceId: "ws-1",
      title: "Runtime Flow",
      artifactType: "architecture_canvas",
      sourcePath: ".coder-studio/canvases/runtime-flow.csc",
    });

    expect(
      validateUiActionIntent({
        type: "canvas.open",
        workspaceId: "ws-1",
        canvasId: "   ",
        title: " Runtime Flow ",
        artifactType: "architecture_canvas",
        sourcePath: ".coder-studio/canvases/runtime-flow.csc",
      })
    ).toEqual({
      type: "canvas.open",
      workspaceId: "ws-1",
      title: "Runtime Flow",
      artifactType: "architecture_canvas",
      sourcePath: ".coder-studio/canvases/runtime-flow.csc",
    });

    expect(
      validateUiActionIntent({
        type: "canvas.open",
        workspaceId: "ws-1",
        canvasId: " canvas-1 ",
      })
    ).toEqual({
      type: "canvas.open",
      workspaceId: "ws-1",
      canvasId: "canvas-1",
    });

    expect(() =>
      validateUiActionIntent({
        type: "canvas.open",
        title: "Runtime Flow",
        artifactType: "architecture_canvas",
      })
    ).toThrow("canvas.open requires title, artifactType, and sourcePath when metadata is provided");

    expect(() =>
      validateUiActionIntent({
        type: "canvas.open",
      })
    ).toThrow("canvas.open requires canvasId or sourcePath metadata");

    expect(() =>
      validateUiActionIntent({
        type: "canvas.open",
        title: "   ",
        artifactType: "architecture_canvas",
        sourcePath: ".coder-studio/canvases/runtime-flow.csc",
      })
    ).toThrow("canvas.open title must not be empty");

    expect(() =>
      validateUiActionIntent({
        type: "canvas.open",
        title: "Runtime Flow",
        artifactType: "bogus" as never,
        sourcePath: ".coder-studio/canvases/runtime-flow.csc",
      })
    ).toThrow("canvas.open artifactType must be architecture_canvas or report_canvas");

    expect(() =>
      validateUiActionIntent({
        type: "canvas.open",
        title: "Runtime Flow",
        artifactType: "architecture_canvas",
        sourcePath: "../runtime.canvas.json",
      })
    ).toThrow("workspace-relative");
  });

  it("rejects non-allowlisted command.run ids", () => {
    expect(validateUiActionIntent({ type: "command.run", commandId: "quickOpen.open" })).toEqual({
      type: "command.run",
      commandId: "quickOpen.open",
    });
    expect(() =>
      validateUiActionIntent({ type: "command.run", commandId: "workspace.deleteAll" })
    ).toThrow("not allowed");
  });

  it("normalizes requests and creates workspace-scoped events", () => {
    const request: UiActionDispatchRequest = normalizeUiActionDispatchRequest({
      intent: { type: "editor.openFile", workspaceId: "ws-1", path: "src/index.ts" },
      requestId: "req-1",
      source: { kind: "agent", sessionId: "sess-1", providerId: "codex" },
    });

    expect(request).toEqual({
      intent: { type: "editor.openFile", workspaceId: "ws-1", path: "src/index.ts" },
      requestId: "req-1",
      source: { kind: "agent", sessionId: "sess-1", providerId: "codex" },
    });
    expect(createUiActionEvent({ request, workspaceId: "ws-1", dispatchedAt: 123 })).toEqual({
      requestId: "req-1",
      workspaceId: "ws-1",
      intent: { type: "editor.openFile", workspaceId: "ws-1", path: "src/index.ts" },
      source: { kind: "agent", sessionId: "sess-1", providerId: "codex" },
      dispatchedAt: 123,
    });
  });
});
