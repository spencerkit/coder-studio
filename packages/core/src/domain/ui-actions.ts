import { Topics } from "../protocol/topics.js";
import type { AutomationPermission } from "./automation.js";

export type UiActionRiskLevel = "read" | "write" | "dangerous";
export type UiPanelId = "terminal" | "explorer" | "search" | "git" | "skills" | "agentInstructions";
export type UiCommandId = "quickOpen.open" | "commandPalette.open";

export type UiActionIntent =
  | {
      type: "editor.openFile";
      workspaceId?: string;
      path: string;
      line?: number;
      column?: number;
      target?: "active" | "newPane" | { paneId: string };
    }
  | {
      type: "editor.closeFile";
      workspaceId?: string;
      path: string;
    }
  | {
      type: "browser.openUrl";
      workspaceId?: string;
      url: string;
      target?: "preview" | "external";
    }
  | {
      type: "browser.closeUrl";
      workspaceId?: string;
      url: string;
    }
  | {
      type: "workspace.focus";
      workspaceId: string;
    }
  | {
      type: "panel.show";
      workspaceId?: string;
      panel: UiPanelId;
    }
  | {
      type: "command.run";
      commandId: UiCommandId;
      args?: Record<string, unknown>;
    };

export interface UiActionDescriptor {
  type: UiActionIntent["type"];
  cli: string;
  description: string;
  inputSchema: Record<string, string>;
  permissions: AutomationPermission[];
  riskLevel: UiActionRiskLevel;
  available: boolean;
  examples: string[];
}

export interface UiActionDispatchRequest {
  intent: UiActionIntent;
  source?: {
    kind: "agent" | "user" | "system";
    sessionId?: string;
    providerId?: string;
  };
  requestId?: string;
}

export interface UiActionDispatchResult {
  accepted: boolean;
  requestId: string;
  topic: string;
}

export interface UiActionEvent {
  requestId: string;
  workspaceId: string;
  intent: UiActionIntent;
  source?: UiActionDispatchRequest["source"];
  dispatchedAt: number;
}

export const ALLOWED_UI_COMMAND_IDS: readonly UiCommandId[] = [
  "quickOpen.open",
  "commandPalette.open",
];

const UI_ACTION_CAPABILITIES: UiActionDescriptor[] = [
  {
    type: "editor.openFile",
    cli: "coder-studio ui open-file --path <workspace-relative-path>",
    description: "Open a workspace-relative file path in the built-in editor.",
    inputSchema: {
      workspaceId: "string optional",
      path: "workspace-relative string",
      line: "positive integer optional",
      column: "positive integer optional",
      target: "active | newPane | pane id optional",
    },
    permissions: ["ui:navigate"],
    riskLevel: "read",
    available: true,
    examples: ["coder-studio ui open-file --path src/index.ts --line 12 --json"],
  },
  {
    type: "editor.closeFile",
    cli: "coder-studio ui close-file --path <workspace-relative-path>",
    description: "Close a matching workspace-relative file tab in the built-in editor.",
    inputSchema: {
      workspaceId: "string optional",
      path: "workspace-relative string",
    },
    permissions: ["ui:navigate"],
    riskLevel: "read",
    available: true,
    examples: ["coder-studio ui close-file --path src/index.ts --json"],
  },
  {
    type: "browser.openUrl",
    cli: "coder-studio ui open-url --url <localhost-url>",
    description: "Open a localhost URL from the Coder Studio UI.",
    inputSchema: {
      workspaceId: "string optional",
      url: "localhost URL",
      target: "preview | external optional",
    },
    permissions: ["ui:navigate"],
    riskLevel: "read",
    available: true,
    examples: ["coder-studio ui open-url --url http://127.0.0.1:5173 --json"],
  },
  {
    type: "browser.closeUrl",
    cli: "coder-studio ui close-url --url <localhost-url>",
    description: "Close the built-in browser tab only when its current URL matches.",
    inputSchema: {
      workspaceId: "string optional",
      url: "localhost URL",
    },
    permissions: ["ui:navigate"],
    riskLevel: "read",
    available: true,
    examples: ["coder-studio ui close-url --url http://127.0.0.1:5173 --json"],
  },
  {
    type: "workspace.focus",
    cli: "coder-studio ui focus-workspace --workspace <workspace-id>",
    description: "Focus a known workspace in the Coder Studio UI.",
    inputSchema: { workspaceId: "string" },
    permissions: ["ui:navigate"],
    riskLevel: "read",
    available: true,
    examples: ["coder-studio ui focus-workspace --workspace ws_123 --json"],
  },
  {
    type: "panel.show",
    cli: "coder-studio ui show-panel --panel <panel-id>",
    description: "Show a common workspace panel.",
    inputSchema: {
      workspaceId: "string optional",
      panel: "terminal | explorer | search | git | skills | agentInstructions",
    },
    permissions: ["ui:navigate"],
    riskLevel: "read",
    available: true,
    examples: ["coder-studio ui show-panel --panel terminal --json"],
  },
  {
    type: "command.run",
    cli: "coder-studio ui run-command --command <command-id>",
    description: "Run a small allowlist of frontend-only commands.",
    inputSchema: {
      commandId: "quickOpen.open | commandPalette.open",
      args: "object optional",
    },
    permissions: ["ui:command"],
    riskLevel: "read",
    available: true,
    examples: ["coder-studio ui run-command --command quickOpen.open --json"],
  },
];

export function listUiActionCapabilities(input: {
  permissions: readonly string[];
}): UiActionDescriptor[] {
  const allowed = new Set(input.permissions);
  return UI_ACTION_CAPABILITIES.filter((capability) =>
    capability.permissions.every((permission) => allowed.has(permission))
  );
}

function assertPositiveInteger(value: number | undefined, field: string): void {
  if (value === undefined) {
    return;
  }

  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error(`${field} must be a positive integer`);
  }
}

export function isSafeWorkspaceRelativePath(path: string): boolean {
  if (!path || path.startsWith("/") || path.startsWith("\\") || path.includes("\0")) {
    return false;
  }

  const segments = path.replace(/\\/g, "/").split("/");
  return segments.every((segment) => segment !== "" && segment !== "." && segment !== "..");
}

export function normalizeLocalhostUrl(url: string): string {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error("url must be a valid URL");
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("url must use http or https");
  }

  const hostname = parsed.hostname.toLowerCase();
  const isLocalhost =
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "::1" ||
    hostname.endsWith(".localhost");
  if (!isLocalhost) {
    throw new Error("browser.openUrl only supports localhost URLs");
  }

  return parsed.toString();
}

export function validateUiActionIntent(intent: UiActionIntent): UiActionIntent {
  switch (intent.type) {
    case "editor.openFile": {
      if (!isSafeWorkspaceRelativePath(intent.path)) {
        throw new Error("editor.openFile path must be workspace-relative");
      }
      assertPositiveInteger(intent.line, "line");
      assertPositiveInteger(intent.column, "column");
      return { ...intent };
    }
    case "editor.closeFile": {
      if (!isSafeWorkspaceRelativePath(intent.path)) {
        throw new Error("editor.closeFile path must be workspace-relative");
      }
      return { ...intent };
    }
    case "browser.openUrl":
      return { ...intent, url: normalizeLocalhostUrl(intent.url) };
    case "browser.closeUrl":
      return { ...intent, url: normalizeLocalhostUrl(intent.url) };
    case "workspace.focus":
      if (!intent.workspaceId) {
        throw new Error("workspace.focus requires workspaceId");
      }
      return { ...intent };
    case "panel.show":
      return { ...intent };
    case "command.run":
      if (!ALLOWED_UI_COMMAND_IDS.includes(intent.commandId)) {
        throw new Error(`UI command is not allowed: ${intent.commandId}`);
      }
      return { ...intent };
  }
}

export function normalizeUiActionDispatchRequest(
  request: UiActionDispatchRequest
): UiActionDispatchRequest {
  return {
    ...request,
    intent: validateUiActionIntent(request.intent),
  };
}

export function resolveUiActionWorkspaceId(
  request: UiActionDispatchRequest,
  fallbackWorkspaceId?: string
): string {
  const workspaceId = "workspaceId" in request.intent ? request.intent.workspaceId : undefined;
  const resolved = workspaceId ?? fallbackWorkspaceId;
  if (!resolved) {
    throw new Error("workspaceId is required for this UI action");
  }
  return resolved;
}

function createRequestId(): string {
  if (typeof globalThis.crypto?.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }

  return `ui_action_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

export function createUiActionEvent(input: {
  request: UiActionDispatchRequest;
  workspaceId: string;
  dispatchedAt: number;
}): UiActionEvent {
  return {
    requestId: input.request.requestId ?? createRequestId(),
    workspaceId: input.workspaceId,
    intent: input.request.intent,
    source: input.request.source,
    dispatchedAt: input.dispatchedAt,
  };
}

export function createUiActionDispatchResult(event: UiActionEvent): UiActionDispatchResult {
  return {
    accepted: true,
    requestId: event.requestId,
    topic: Topics.workspaceUiAction(event.workspaceId),
  };
}
