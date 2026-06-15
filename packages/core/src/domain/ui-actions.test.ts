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

    expect(() =>
      validateUiActionIntent({ type: "browser.openUrl", url: "https://example.com" })
    ).toThrow("localhost URLs");
    expect(() =>
      validateUiActionIntent({ type: "browser.closeUrl", url: "https://example.com" })
    ).toThrow("localhost URLs");
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
