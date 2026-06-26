import { Topics } from "../protocol/topics.js";
import type { AutomationPermission } from "./automation.js";
import { CanvasArtifactKind } from "./canvas.js";

export type UiActionRiskLevel = "read" | "write" | "dangerous";
export type UiPanelId = "terminal" | "explorer" | "search" | "git" | "skills" | "agentInstructions";
export type UiCommandId = "quickOpen.open" | "commandPalette.open";

type EditorOpenFileUiActionIntent = {
  type: "editor.openFile";
  workspaceId?: string;
  path: string;
  line?: number;
  column?: number;
  target?: "active" | "newPane" | { paneId: string };
};

type EditorCloseFileUiActionIntent = {
  type: "editor.closeFile";
  workspaceId?: string;
  path: string;
};

type BrowserOpenUrlUiActionIntent = {
  type: "browser.openUrl";
  workspaceId?: string;
  url: string;
  target?: "preview" | "external";
};

type BrowserCloseUrlUiActionIntent = {
  type: "browser.closeUrl";
  workspaceId?: string;
  url: string;
};

export type CanvasOpenUiActionIntent = {
  type: "canvas.open";
  workspaceId?: string;
  title: string;
  artifactType: CanvasArtifactKind;
  sourcePath: string;
  canvasId?: string;
};

export type CanvasOpenUiActionDispatchIntent = {
  type: "canvas.open";
  workspaceId?: string;
  canvasId?: string;
  title?: string;
  artifactType?: CanvasArtifactKind;
  sourcePath?: string;
};

type WorkspaceFocusUiActionIntent = {
  type: "workspace.focus";
  workspaceId: string;
};

type PanelShowUiActionIntent = {
  type: "panel.show";
  workspaceId?: string;
  panel: UiPanelId;
};

type CommandRunUiActionIntent = {
  type: "command.run";
  commandId: UiCommandId;
  args?: Record<string, unknown>;
};

export type UiActionIntent =
  | EditorOpenFileUiActionIntent
  | EditorCloseFileUiActionIntent
  | BrowserOpenUrlUiActionIntent
  | BrowserCloseUrlUiActionIntent
  | CanvasOpenUiActionIntent
  | WorkspaceFocusUiActionIntent
  | PanelShowUiActionIntent
  | CommandRunUiActionIntent;

export type UiActionDispatchIntent =
  | EditorOpenFileUiActionIntent
  | EditorCloseFileUiActionIntent
  | BrowserOpenUrlUiActionIntent
  | BrowserCloseUrlUiActionIntent
  | CanvasOpenUiActionDispatchIntent
  | WorkspaceFocusUiActionIntent
  | PanelShowUiActionIntent
  | CommandRunUiActionIntent;

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
  intent: UiActionDispatchIntent;
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

export interface UiActionEventRequest extends Omit<UiActionDispatchRequest, "intent"> {
  intent: UiActionIntent;
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
    type: "canvas.open",
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
    examples: [
      '{"type":"canvas.open","workspaceId":"ws_123","title":"Runtime Flow","artifactType":"architecture_canvas","sourcePath":".coder-studio/canvases/runtime-flow.csc"}',
      "coder-studio ui open-canvas --workspace ws_123 --canvas canvas_123 --json",
    ],
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
    hostname === "[::1]" ||
    hostname.endsWith(".localhost");
  if (!isLocalhost) {
    throw new Error("browser.openUrl only supports localhost URLs");
  }

  return parsed.toString();
}

export function validateUiActionIntent(intent: UiActionDispatchIntent): UiActionDispatchIntent {
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
    case "canvas.open": {
      const { canvasId: _rawCanvasId, ...restIntent } = intent;
      const canvasId = intent.canvasId?.trim() || undefined;

      const hasAnyMetadata =
        intent.title !== undefined ||
        intent.artifactType !== undefined ||
        intent.sourcePath !== undefined;
      const hasAllMetadata =
        intent.title !== undefined &&
        intent.artifactType !== undefined &&
        intent.sourcePath !== undefined;
      if (hasAnyMetadata && !hasAllMetadata) {
        throw new Error(
          "canvas.open requires title, artifactType, and sourcePath when metadata is provided"
        );
      }

      if (!canvasId && !hasAllMetadata) {
        throw new Error("canvas.open requires canvasId or sourcePath metadata");
      }

      if (!hasAllMetadata) {
        return {
          ...restIntent,
          ...(canvasId ? { canvasId } : {}),
        };
      }

      const sourcePathInput = intent.sourcePath;
      const titleInput = intent.title;
      const artifactType = intent.artifactType;
      if (sourcePathInput === undefined || titleInput === undefined || artifactType === undefined) {
        throw new Error(
          "canvas.open requires title, artifactType, and sourcePath when metadata is provided"
        );
      }

      const sourcePath = sourcePathInput.trim();
      if (!isSafeWorkspaceRelativePath(sourcePath)) {
        throw new Error("canvas.open sourcePath must be workspace-relative");
      }

      const title = titleInput.trim();
      if (!title) {
        throw new Error("canvas.open title must not be empty");
      }

      if (!CanvasArtifactKind.safeParse(artifactType).success) {
        throw new Error("canvas.open artifactType must be architecture_canvas or report_canvas");
      }

      return {
        ...restIntent,
        ...(canvasId ? { canvasId } : {}),
        artifactType,
        title,
        sourcePath,
      };
    }
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

export function normalizeUiActionDispatchRequest<T extends UiActionDispatchRequest>(request: T): T {
  return {
    ...request,
    intent: validateUiActionIntent(request.intent),
  } as T;
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
  request: UiActionEventRequest;
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
