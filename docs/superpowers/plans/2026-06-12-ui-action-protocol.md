# UI Action Protocol Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build phase 1 of the UI Action protocol: shared action types, server dispatch/broadcast, frontend execution subscription, and CLI commands, without registering or materializing a built-in skill.

**Architecture:** `packages/core` owns the protocol, descriptors, validation helpers, and workspace-scoped topic. `packages/server` validates incoming `uiAction.dispatch` requests and broadcasts accepted events; `packages/web` subscribes to those events and maps action intents to existing UI state/action hooks; `packages/cli` gives agents a provider-neutral `coder-studio ui ...` bridge. The server accepts and routes, while completion remains frontend-owned and asynchronous.

**Tech Stack:** TypeScript, pnpm workspaces, Vitest, zod, React, Jotai, WebSocket topics.

---

## Scope

Included in this plan:

- UI Action protocol types and descriptors.
- UI-specific automation permissions exposed through capabilities.
- Workspace UI action topic.
- Server commands `uiAction.capabilities` and `uiAction.dispatch`.
- CLI commands under `coder-studio ui`.
- Frontend registry and workspace subscription for executing MVP actions.

Explicitly excluded:

- Built-in skill registration or `SKILL.md` materialization.
- General DOM automation, screenshots, arbitrary browser automation, destructive UI actions.
- Replacing all Command Palette commands with a global command system.
- Completion acknowledgements from frontend back to server.

## File Structure

- Create `packages/core/src/domain/ui-actions.ts`: protocol types, action descriptors, URL/path safety helpers, request normalization, validation.
- Create `packages/core/src/domain/ui-actions.test.ts`: unit coverage for descriptors, workspace routing, path and URL validation, request normalization.
- Modify `packages/core/src/domain/automation.ts`: add UI permissions to default automation permissions and append UI action capabilities to `listAutomationCapabilities`.
- Modify `packages/core/src/domain/automation.test.ts`: verify UI capabilities and permission filtering.
- Modify `packages/core/src/protocol/topics.ts`: add `workspaceUiAction(workspaceId)`.
- Modify `packages/core/src/protocol/messages.test.ts`: verify topic builder and `UiActionEvent` shape.
- Modify `packages/core/src/index.ts`: export `domain/ui-actions`.
- Create `packages/server/src/commands/ui-actions.ts`: zod schema, command handlers, validation, broadcast.
- Create `packages/server/src/__tests__/ui-actions-commands.test.ts`: dispatch command coverage and broadcast safety failures.
- Modify `packages/server/src/commands/index.ts`: import `./ui-actions.js` for registration.
- Modify `packages/server/src/ws/dispatch.ts`: add `uiAction.capabilities` and `uiAction.dispatch` to activation allowlist.
- Modify `packages/server/src/__tests__/dispatch.test.ts`: verify `uiAction.dispatch` is callable without an active browser lease.
- Modify `packages/cli/src/parse-args.ts`: parse `coder-studio ui ...` commands and options.
- Modify `packages/cli/src/cli.ts`: route UI CLI commands through `callCoderStudioCommand`.
- Modify `packages/cli/src/bin.test.ts`: test parsing and command dispatch for UI CLI.
- Create `packages/web/src/features/ui-actions/registry.ts`: pure executor registry helpers and command allowlist.
- Create `packages/web/src/features/ui-actions/registry.test.ts`: pure tests for registry behavior.
- Create `packages/web/src/features/ui-actions/use-ui-action-subscription.ts`: workspace topic subscription hook and action executor wiring.
- Create `packages/web/src/features/ui-actions/use-ui-action-subscription.test.tsx`: hook/component tests with mocked WebSocket client and UI atoms/actions.
- Modify `packages/web/src/features/workspace/views/desktop/workspace-desktop-view.tsx`: mount the subscription for the active workspace.

## Task 1: Core UI Action Protocol

**Files:**
- Create: `packages/core/src/domain/ui-actions.ts`
- Create: `packages/core/src/domain/ui-actions.test.ts`
- Modify: `packages/core/src/index.ts`

- [ ] **Step 1: Write failing protocol tests**

Create `packages/core/src/domain/ui-actions.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  createUiActionEvent,
  listUiActionCapabilities,
  normalizeUiActionDispatchRequest,
  validateUiActionIntent,
  type UiActionDispatchRequest,
} from "./ui-actions.js";

describe("ui action domain", () => {
  it("lists MVP UI action capabilities with CLI examples", () => {
    const capabilities = listUiActionCapabilities({ permissions: ["ui:navigate", "ui:command"] });

    expect(capabilities.map((capability) => capability.type)).toEqual([
      "editor.openFile",
      "browser.openUrl",
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
  });

  it("filters UI action capabilities by permissions", () => {
    expect(
      listUiActionCapabilities({ permissions: ["ui:navigate"] }).map((capability) => capability.type)
    ).toEqual(["editor.openFile", "browser.openUrl", "workspace.focus", "panel.show"]);

    expect(
      listUiActionCapabilities({ permissions: ["ui:command"] }).map((capability) => capability.type)
    ).toEqual(["command.run"]);
  });

  it("rejects unsafe workspace paths", () => {
    expect(() =>
      validateUiActionIntent({ type: "editor.openFile", path: "/etc/passwd" })
    ).toThrow("workspace-relative");
    expect(() =>
      validateUiActionIntent({ type: "editor.openFile", path: "../secret.txt" })
    ).toThrow("workspace-relative");
    expect(() =>
      validateUiActionIntent({ type: "editor.openFile", path: "src/app.ts", line: 0 })
    ).toThrow("positive integer");
  });

  it("accepts localhost URLs and rejects external URLs", () => {
    expect(validateUiActionIntent({ type: "browser.openUrl", url: "http://127.0.0.1:5173" })).toEqual({
      type: "browser.openUrl",
      url: "http://127.0.0.1:5173/",
    });

    expect(() =>
      validateUiActionIntent({ type: "browser.openUrl", url: "https://example.com" })
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
```

- [ ] **Step 2: Run the core protocol test and verify RED**

Run:

```bash
pnpm --filter @coder-studio/core exec vitest run src/domain/ui-actions.test.ts
```

Expected: FAIL because `./ui-actions.js` does not exist.

- [ ] **Step 3: Implement minimal core protocol**

Create `packages/core/src/domain/ui-actions.ts`:

```ts
import type { AutomationPermission } from "./automation.js";
import { Topics } from "../protocol/topics.js";

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
      type: "browser.openUrl";
      workspaceId?: string;
      url: string;
      target?: "preview" | "external";
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

  const segments = path.replaceAll("\\", "/").split("/");
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
    case "browser.openUrl":
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
  const workspaceId =
    "workspaceId" in request.intent ? request.intent.workspaceId : undefined;
  const resolved = workspaceId ?? fallbackWorkspaceId;
  if (!resolved) {
    throw new Error("workspaceId is required for this UI action");
  }
  return resolved;
}

export function createUiActionEvent(input: {
  request: UiActionDispatchRequest;
  workspaceId: string;
  dispatchedAt: number;
}): UiActionEvent {
  return {
    requestId: input.request.requestId ?? crypto.randomUUID(),
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
```

Modify `packages/core/src/index.ts`:

```ts
export * from "./domain/ui-actions";
```

- [ ] **Step 4: Run core protocol test and verify GREEN**

Run:

```bash
pnpm --filter @coder-studio/core exec vitest run src/domain/ui-actions.test.ts
```

Expected: PASS.

## Task 2: Automation Capabilities and Topic Export

**Files:**
- Modify: `packages/core/src/domain/automation.ts`
- Modify: `packages/core/src/domain/automation.test.ts`
- Modify: `packages/core/src/protocol/topics.ts`
- Modify: `packages/core/src/protocol/messages.test.ts`

- [ ] **Step 1: Write failing tests for UI permissions, capabilities, and topic**

Extend `packages/core/src/domain/automation.test.ts`:

```ts
  it("includes low-risk UI action permissions in the default agent permissions", () => {
    expect(DEFAULT_AGENT_AUTOMATION_PERMISSIONS).toEqual(
      expect.arrayContaining(["ui:read", "ui:navigate", "ui:command"])
    );
  });

  it("lists UI action capabilities through automation capabilities", () => {
    const capabilities = listAutomationCapabilities({
      permissions: DEFAULT_AGENT_AUTOMATION_PERMISSIONS,
    });

    expect(capabilities).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "ui.editor.openFile",
          cli: "coder-studio ui open-file --path <workspace-relative-path>",
          permissions: ["ui:navigate"],
        }),
        expect.objectContaining({
          name: "ui.command.run",
          cli: "coder-studio ui run-command --command <command-id>",
          permissions: ["ui:command"],
        }),
      ])
    );
  });
```

Extend `packages/core/src/protocol/messages.test.ts`:

```ts
describe("ui action protocol events", () => {
  it("exports a workspace UI action topic builder", () => {
    expect(Topics.workspaceUiAction("ws-1")).toBe("workspace.ws-1.ui.action");
  });
});
```

- [ ] **Step 2: Run tests and verify RED**

Run:

```bash
pnpm --filter @coder-studio/core exec vitest run src/domain/automation.test.ts src/protocol/messages.test.ts
```

Expected: FAIL because UI permissions/capabilities and topic are missing.

- [ ] **Step 3: Add permissions, bridge capabilities, and topic**

Modify `packages/core/src/domain/automation.ts`:

```ts
import { listUiActionCapabilities } from "./ui-actions.js";

export const DEFAULT_AGENT_AUTOMATION_PERMISSIONS = [
  "workspace:read",
  "session:read",
  "terminal:read",
  "git:read",
  "ui:read",
  "ui:navigate",
  "ui:command",
] as const;
```

Append UI descriptors in `listAutomationCapabilities`:

```ts
const uiCapabilities: AutomationCapability[] = listUiActionCapabilities({
  permissions: input.permissions,
}).map((capability) => ({
  name: `ui.${capability.type}`,
  cli: capability.cli,
  description: capability.description,
  inputSchema: capability.inputSchema,
  output: "Accepted dispatch metadata as JSON. The frontend executes UI actions asynchronously.",
  permissions: capability.permissions,
  riskLevel: capability.riskLevel,
  examples: capability.examples,
  available: capability.available,
}));

return [...MVP_CAPABILITIES, ...uiCapabilities].filter((capability) =>
  capability.permissions.every((permission) => allowed.has(permission))
);
```

Modify `packages/core/src/protocol/topics.ts`:

```ts
workspaceUiAction: (workspaceId: string) => `workspace.${workspaceId}.ui.action`,
```

- [ ] **Step 4: Run tests and verify GREEN**

Run:

```bash
pnpm --filter @coder-studio/core exec vitest run src/domain/ui-actions.test.ts src/domain/automation.test.ts src/protocol/messages.test.ts
```

Expected: PASS.

## Task 3: Server UI Action Commands

**Files:**
- Create: `packages/server/src/commands/ui-actions.ts`
- Create: `packages/server/src/__tests__/ui-actions-commands.test.ts`
- Modify: `packages/server/src/commands/index.ts`

- [ ] **Step 1: Write failing server command tests**

Create `packages/server/src/__tests__/ui-actions-commands.test.ts`:

```ts
import { Topics } from "@coder-studio/core";
import { describe, expect, it, vi } from "vitest";
import type { CommandContext } from "../ws/dispatch.js";
import { dispatch } from "../ws/dispatch.js";
import "../commands/ui-actions.js";

function createContext(overrides: Partial<CommandContext> = {}): CommandContext {
  return {
    workspaceMgr: {} as never,
    sessionMgr: {} as never,
    terminalMgr: {} as never,
    taskMgr: {} as never,
    eventBus: {} as never,
    broadcaster: {
      publish: vi.fn(),
    } as never,
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

describe("ui action commands", () => {
  it("returns UI action capabilities", async () => {
    const result = await dispatch(
      {
        kind: "command",
        id: "ui-capabilities-1",
        op: "uiAction.capabilities",
        args: { permissions: ["ui:navigate"] },
      },
      createContext()
    );

    expect(result.ok).toBe(true);
    expect(result.data).toMatchObject({
      version: 1,
      actions: [expect.objectContaining({ type: "editor.openFile" })],
    });
  });

  it("validates, broadcasts, and returns accepted dispatch metadata", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1234);
    const ctx = createContext();

    const result = await dispatch(
      {
        kind: "command",
        id: "ui-dispatch-1",
        op: "uiAction.dispatch",
        args: {
          intent: { type: "editor.openFile", workspaceId: "ws-1", path: "src/index.ts" },
          requestId: "req-1",
          source: { kind: "agent", sessionId: "sess-1", providerId: "codex" },
        },
      },
      ctx
    );

    expect(result.ok).toBe(true);
    expect(result.data).toEqual({
      accepted: true,
      requestId: "req-1",
      topic: Topics.workspaceUiAction("ws-1"),
    });
    expect(ctx.broadcaster.publish).toHaveBeenCalledWith(Topics.workspaceUiAction("ws-1"), {
      requestId: "req-1",
      workspaceId: "ws-1",
      intent: { type: "editor.openFile", workspaceId: "ws-1", path: "src/index.ts" },
      source: { kind: "agent", sessionId: "sess-1", providerId: "codex" },
      dispatchedAt: 1234,
    });
  });

  it("uses fallback workspaceId when the intent does not include one", async () => {
    const ctx = createContext();

    const result = await dispatch(
      {
        kind: "command",
        id: "ui-dispatch-2",
        op: "uiAction.dispatch",
        args: {
          workspaceId: "ws-fallback",
          intent: { type: "panel.show", panel: "terminal" },
          requestId: "req-2",
        },
      },
      ctx
    );

    expect(result.ok).toBe(true);
    expect(result.data).toMatchObject({ topic: Topics.workspaceUiAction("ws-fallback") });
  });

  it("rejects unsafe UI action intents before broadcasting", async () => {
    const ctx = createContext();

    const result = await dispatch(
      {
        kind: "command",
        id: "ui-dispatch-unsafe-1",
        op: "uiAction.dispatch",
        args: {
          workspaceId: "ws-1",
          intent: { type: "browser.openUrl", url: "https://example.com" },
        },
      },
      ctx
    );

    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("internal_error");
    expect(ctx.broadcaster.publish).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run server command test and verify RED**

Run:

```bash
pnpm --filter @coder-studio/server exec vitest run src/__tests__/ui-actions-commands.test.ts
```

Expected: FAIL because `../commands/ui-actions.js` does not exist.

- [ ] **Step 3: Implement server commands**

Create `packages/server/src/commands/ui-actions.ts`:

```ts
import {
  createUiActionDispatchResult,
  createUiActionEvent,
  DEFAULT_AGENT_AUTOMATION_PERMISSIONS,
  listUiActionCapabilities,
  normalizeUiActionDispatchRequest,
  resolveUiActionWorkspaceId,
  Topics,
} from "@coder-studio/core";
import { z } from "zod";
import { registerCommand } from "../ws/dispatch.js";

const uiActionIntentSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("editor.openFile"),
    workspaceId: z.string().optional(),
    path: z.string(),
    line: z.number().int().optional(),
    column: z.number().int().optional(),
    target: z.union([z.literal("active"), z.literal("newPane"), z.object({ paneId: z.string() })]).optional(),
  }),
  z.object({
    type: z.literal("browser.openUrl"),
    workspaceId: z.string().optional(),
    url: z.string(),
    target: z.union([z.literal("preview"), z.literal("external")]).optional(),
  }),
  z.object({
    type: z.literal("workspace.focus"),
    workspaceId: z.string(),
  }),
  z.object({
    type: z.literal("panel.show"),
    workspaceId: z.string().optional(),
    panel: z.enum(["terminal", "explorer", "search", "git", "skills", "agentInstructions"]),
  }),
  z.object({
    type: z.literal("command.run"),
    commandId: z.enum(["quickOpen.open", "commandPalette.open"]),
    args: z.record(z.string(), z.unknown()).optional(),
  }),
]);

const uiActionDispatchSchema = z.object({
  workspaceId: z.string().optional(),
  intent: uiActionIntentSchema,
  requestId: z.string().optional(),
  source: z
    .object({
      kind: z.enum(["agent", "user", "system"]),
      sessionId: z.string().optional(),
      providerId: z.string().optional(),
    })
    .optional(),
});

registerCommand(
  "uiAction.capabilities",
  z.object({
    permissions: z.array(z.string()).optional(),
  }),
  async (args) => ({
    version: 1,
    actions: listUiActionCapabilities({
      permissions: args.permissions ?? DEFAULT_AGENT_AUTOMATION_PERMISSIONS,
    }),
  })
);

registerCommand("uiAction.dispatch", uiActionDispatchSchema, async (args, ctx) => {
  const request = normalizeUiActionDispatchRequest({
    intent: args.intent,
    requestId: args.requestId,
    source: args.source,
  });
  const workspaceId = resolveUiActionWorkspaceId(request, args.workspaceId);
  const event = createUiActionEvent({
    request,
    workspaceId,
    dispatchedAt: Date.now(),
  });
  const topic = Topics.workspaceUiAction(workspaceId);

  ctx.broadcaster.publish(topic, event);

  return createUiActionDispatchResult(event);
});
```

Modify `packages/server/src/commands/index.ts`:

```ts
import "./ui-actions.js";
```

- [ ] **Step 4: Run server command test and verify GREEN**

Run:

```bash
pnpm --filter @coder-studio/server exec vitest run src/__tests__/ui-actions-commands.test.ts
```

Expected: PASS.

## Task 4: Server Activation Allowlist

**Files:**
- Modify: `packages/server/src/ws/dispatch.ts`
- Modify: `packages/server/src/__tests__/dispatch.test.ts`

- [ ] **Step 1: Write failing allowlist test**

Extend `packages/server/src/__tests__/dispatch.test.ts`:

```ts
    it("allows UI action dispatch from command clients without an active browser lease", async () => {
      const publish = vi.fn();
      ctx = {
        ...ctx,
        broadcaster: {
          publish,
          getRequestMetadata: () => ({ url: "/ws" }),
        } as never,
        activationMgr: { getLease: () => undefined } as never,
      };

      const result = await dispatch(
        {
          kind: "command",
          id: "ui-action-allowlist-1",
          op: "uiAction.dispatch",
          args: {
            workspaceId: "ws-1",
            requestId: "req-1",
            intent: { type: "panel.show", panel: "terminal" },
          },
        },
        ctx,
        "cli-client"
      );

      expect(result.ok).toBe(true);
      expect(publish).toHaveBeenCalled();
    });
```

Also import `../commands/ui-actions.js` in the test file.

- [ ] **Step 2: Run dispatch test and verify RED**

Run:

```bash
pnpm --filter @coder-studio/server exec vitest run src/__tests__/dispatch.test.ts
```

Expected: FAIL with `activation_required` for `uiAction.dispatch`.

- [ ] **Step 3: Add UI action commands to activation allowlist**

Modify `packages/server/src/ws/dispatch.ts`:

```ts
  "uiAction.capabilities",
  "uiAction.dispatch",
```

- [ ] **Step 4: Run dispatch test and verify GREEN**

Run:

```bash
pnpm --filter @coder-studio/server exec vitest run src/__tests__/dispatch.test.ts src/__tests__/ui-actions-commands.test.ts
```

Expected: PASS.

## Task 5: CLI UI Commands

**Files:**
- Modify: `packages/cli/src/parse-args.ts`
- Modify: `packages/cli/src/cli.ts`
- Modify: `packages/cli/src/bin.test.ts`

- [ ] **Step 1: Write failing CLI tests**

Extend `packages/cli/src/bin.test.ts`:

```ts
  it("prints UI open-file dispatch output through the Coder Studio command API", async () => {
    callCoderStudioCommand.mockResolvedValueOnce({
      accepted: true,
      requestId: "req-1",
      topic: "workspace.ws-1.ui.action",
    });
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await main([
      "ui",
      "open-file",
      "--workspace",
      "ws-1",
      "--path",
      "src/index.ts",
      "--line",
      "12",
      "--column",
      "3",
      "--json",
    ]);

    expect(callCoderStudioCommand).toHaveBeenCalledWith({
      apiUrl: undefined,
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
    expect(JSON.parse(logSpy.mock.calls[0]?.[0] as string)).toEqual({
      accepted: true,
      requestId: "req-1",
      topic: "workspace.ws-1.ui.action",
    });
  });

  it("prints UI open-url dispatch output through the Coder Studio command API", async () => {
    callCoderStudioCommand.mockResolvedValueOnce({
      accepted: true,
      requestId: "req-2",
      topic: "workspace.ws-1.ui.action",
    });
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await main(["ui", "open-url", "--workspace", "ws-1", "--url", "http://127.0.0.1:5173", "--json"]);

    expect(callCoderStudioCommand).toHaveBeenCalledWith({
      apiUrl: undefined,
      op: "uiAction.dispatch",
      args: {
        workspaceId: "ws-1",
        intent: {
          type: "browser.openUrl",
          workspaceId: "ws-1",
          url: "http://127.0.0.1:5173",
        },
        source: { kind: "agent" },
      },
    });
    expect(JSON.parse(logSpy.mock.calls[0]?.[0] as string)).toEqual({
      accepted: true,
      requestId: "req-2",
      topic: "workspace.ws-1.ui.action",
    });
  });
```

Add parse tests:

```ts
  it("parses UI open-file command", () => {
    expect(
      parseArgs([
        "ui",
        "open-file",
        "--workspace",
        "ws-1",
        "--path",
        "src/index.ts",
        "--line",
        "12",
        "--column",
        "3",
        "--json",
      ])
    ).toEqual({
      command: "ui",
      uiCommand: "open-file",
      workspaceId: "ws-1",
      path: "src/index.ts",
      line: 12,
      column: 3,
      json: true,
    });
  });

  it("parses UI show-panel and run-command commands", () => {
    expect(parseArgs(["ui", "show-panel", "--panel", "terminal"])).toEqual({
      command: "ui",
      uiCommand: "show-panel",
      panel: "terminal",
    });

    expect(parseArgs(["ui", "run-command", "--command", "quickOpen.open"])).toEqual({
      command: "ui",
      uiCommand: "run-command",
      uiCommandId: "quickOpen.open",
    });
  });
```

- [ ] **Step 2: Run CLI tests and verify RED**

Run:

```bash
pnpm --filter @spencer-kit/coder-studio exec vitest run src/bin.test.ts
```

Expected: FAIL because `ui` command and options are unknown.

- [ ] **Step 3: Implement CLI parser and dispatch routing**

Modify `packages/cli/src/parse-args.ts`:

```ts
type CliCommand = ... | "ui";
type UiCommand = "open-file" | "open-url" | "show-panel" | "focus-workspace" | "run-command";

export interface CliArgs {
  uiCommand?: UiCommand;
  url?: string;
  panel?: string;
  uiCommandId?: string;
  line?: number;
  column?: number;
}
```

Update command clearing so automation args include `ui`. Accept:

- `ui` as top-level command.
- `open-file`, `open-url`, `show-panel`, `focus-workspace`, `run-command` as UI subcommands.
- `--workspace` for UI commands.
- `--path` only for `ui open-file`.
- `--url` only for `ui open-url`.
- `--panel` only for `ui show-panel`.
- `--command` only for `ui run-command`.
- `--line` and `--column` as positive integers only for `ui open-file`.
- `--api-url` and `--json` for `ui`.

Modify `packages/cli/src/cli.ts`:

```ts
  if (args.command === "ui") {
    const intent =
      args.uiCommand === "open-file"
        ? {
            type: "editor.openFile" as const,
            ...(args.workspaceId !== undefined ? { workspaceId: args.workspaceId } : {}),
            path: args.path!,
            ...(args.line !== undefined ? { line: args.line } : {}),
            ...(args.column !== undefined ? { column: args.column } : {}),
          }
        : args.uiCommand === "open-url"
          ? {
              type: "browser.openUrl" as const,
              ...(args.workspaceId !== undefined ? { workspaceId: args.workspaceId } : {}),
              url: args.url!,
            }
          : args.uiCommand === "show-panel"
            ? {
                type: "panel.show" as const,
                ...(args.workspaceId !== undefined ? { workspaceId: args.workspaceId } : {}),
                panel: args.panel!,
              }
            : args.uiCommand === "focus-workspace"
              ? { type: "workspace.focus" as const, workspaceId: args.workspaceId! }
              : { type: "command.run" as const, commandId: args.uiCommandId! };

    printCommandResult(
      await callCoderStudioCommand({
        apiUrl: args.apiUrl,
        op: "uiAction.dispatch",
        args: {
          ...(args.workspaceId !== undefined ? { workspaceId: args.workspaceId } : {}),
          intent,
          source: { kind: "agent" },
        },
      }),
      { json: args.json }
    );
    return;
  }
```

- [ ] **Step 4: Run CLI tests and verify GREEN**

Run:

```bash
pnpm --filter @spencer-kit/coder-studio exec vitest run src/bin.test.ts
```

Expected: PASS.

## Task 6: Frontend UI Action Registry

**Files:**
- Create: `packages/web/src/features/ui-actions/registry.ts`
- Create: `packages/web/src/features/ui-actions/registry.test.ts`

- [ ] **Step 1: Write failing registry tests**

Create `packages/web/src/features/ui-actions/registry.test.ts`:

```ts
import type { UiActionEvent } from "@coder-studio/core";
import { describe, expect, it, vi } from "vitest";
import { createUiActionRegistry, isAllowedFrontendUiCommand } from "./registry";

describe("ui action registry", () => {
  it("routes events to the registered executor by intent type", async () => {
    const run = vi.fn().mockResolvedValue(undefined);
    const registry = createUiActionRegistry();
    registry.register("panel.show", run);

    const event: UiActionEvent = {
      requestId: "req-1",
      workspaceId: "ws-1",
      intent: { type: "panel.show", panel: "terminal" },
      dispatchedAt: 1,
    };

    await registry.execute(event);

    expect(run).toHaveBeenCalledWith(event);
  });

  it("throws when no executor is registered", async () => {
    const registry = createUiActionRegistry();

    await expect(
      registry.execute({
        requestId: "req-1",
        workspaceId: "ws-1",
        intent: { type: "panel.show", panel: "terminal" },
        dispatchedAt: 1,
      })
    ).rejects.toThrow("No UI action executor registered");
  });

  it("keeps the frontend command allowlist explicit", () => {
    expect(isAllowedFrontendUiCommand("quickOpen.open")).toBe(true);
    expect(isAllowedFrontendUiCommand("workspace.deleteAll")).toBe(false);
  });
});
```

- [ ] **Step 2: Run registry test and verify RED**

Run:

```bash
pnpm --filter @coder-studio/web exec vitest run src/features/ui-actions/registry.test.ts
```

Expected: FAIL because `./registry` does not exist.

- [ ] **Step 3: Implement registry**

Create `packages/web/src/features/ui-actions/registry.ts`:

```ts
import type { UiActionEvent, UiActionIntent } from "@coder-studio/core";

export type UiActionExecutor = (event: UiActionEvent) => Promise<void> | void;

export interface UiActionRegistry {
  execute(event: UiActionEvent): Promise<void>;
  register(type: UiActionIntent["type"], executor: UiActionExecutor): () => void;
}

const ALLOWED_FRONTEND_COMMANDS = new Set(["quickOpen.open", "commandPalette.open"]);

export function isAllowedFrontendUiCommand(commandId: string): boolean {
  return ALLOWED_FRONTEND_COMMANDS.has(commandId);
}

export function createUiActionRegistry(): UiActionRegistry {
  const executors = new Map<UiActionIntent["type"], UiActionExecutor>();

  return {
    register(type, executor) {
      executors.set(type, executor);
      return () => {
        if (executors.get(type) === executor) {
          executors.delete(type);
        }
      };
    },
    async execute(event) {
      const executor = executors.get(event.intent.type);
      if (!executor) {
        throw new Error(`No UI action executor registered for ${event.intent.type}`);
      }
      await executor(event);
    },
  };
}
```

- [ ] **Step 4: Run registry test and verify GREEN**

Run:

```bash
pnpm --filter @coder-studio/web exec vitest run src/features/ui-actions/registry.test.ts
```

Expected: PASS.

## Task 7: Frontend Subscription and Executors

**Files:**
- Create: `packages/web/src/features/ui-actions/use-ui-action-subscription.ts`
- Create: `packages/web/src/features/ui-actions/use-ui-action-subscription.test.tsx`
- Modify: `packages/web/src/features/workspace/views/desktop/workspace-desktop-view.tsx`

- [ ] **Step 1: Write failing frontend subscription tests**

Create `packages/web/src/features/ui-actions/use-ui-action-subscription.test.tsx` with tests that mount a small harness under a Jotai provider, set a fake `wsClientAtom.subscribe`, emit `Topics.workspaceUiAction("ws-1")` payloads, and assert:

```ts
expect(subscribe).toHaveBeenCalledWith([Topics.workspaceUiAction("ws-1")], expect.any(Function));
```

For execution behavior, assert:

- `panel.show` with `terminal` sets `terminalPanelVisibleAtomFamily("ws-1")` to `true`.
- `panel.show` with `git` sets `desktopSidebarViewAtomFamily("ws-1")` to `"source-control"` and `sidebarCollapsedAtomFamily("ws-1")` to `false`.
- `command.run` with `quickOpen.open` sets `quickOpenOpenAtom` to `true`.
- `command.run` with `commandPalette.open` sets `commandPaletteOpenAtom` to `true`.
- invalid payloads do not throw and push an error toast through `pushToastAtom`.

Use this harness shape:

```tsx
function Harness({ workspaceId }: { workspaceId: string }) {
  useUiActionSubscription(workspaceId);
  return null;
}
```

- [ ] **Step 2: Run subscription tests and verify RED**

Run:

```bash
pnpm --filter @coder-studio/web exec vitest run src/features/ui-actions/use-ui-action-subscription.test.tsx
```

Expected: FAIL because the subscription hook does not exist.

- [ ] **Step 3: Implement subscription and executors**

Create `packages/web/src/features/ui-actions/use-ui-action-subscription.ts`:

```ts
import { type UiActionEvent, Topics } from "@coder-studio/core";
import { useAtomValue, useSetAtom } from "jotai";
import { useEffect, useMemo } from "react";
import { commandPaletteOpenAtom, quickOpenOpenAtom } from "../../atoms/app-ui";
import { wsClientAtom } from "../../atoms/connection";
import { pushToastAtom } from "../notifications/atoms";
import { useSelectWorkspaceTarget } from "../workspace/actions/use-select-workspace-target";
import { useOpenWorkspaceFile } from "../workspace/actions/use-open-workspace-file";
import {
  desktopSidebarViewAtomFamily,
  sidebarCollapsedAtomFamily,
  terminalPanelVisibleAtomFamily,
} from "../workspace/atoms";
import { createUiActionRegistry, isAllowedFrontendUiCommand } from "./registry";

function isUiActionEvent(value: unknown): value is UiActionEvent {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as UiActionEvent).requestId === "string" &&
    typeof (value as UiActionEvent).workspaceId === "string" &&
    typeof (value as UiActionEvent).dispatchedAt === "number" &&
    typeof (value as UiActionEvent).intent === "object" &&
    (value as UiActionEvent).intent !== null &&
    typeof (value as UiActionEvent).intent.type === "string"
  );
}

export function useUiActionSubscription(workspaceId: string): void {
  const wsClient = useAtomValue(wsClientAtom);
  const setQuickOpenOpen = useSetAtom(quickOpenOpenAtom);
  const setCommandPaletteOpen = useSetAtom(commandPaletteOpenAtom);
  const setTerminalVisible = useSetAtom(terminalPanelVisibleAtomFamily(workspaceId));
  const setDesktopSidebarView = useSetAtom(desktopSidebarViewAtomFamily(workspaceId));
  const setSidebarCollapsed = useSetAtom(sidebarCollapsedAtomFamily(workspaceId));
  const pushToast = useSetAtom(pushToastAtom);
  const selectWorkspaceTarget = useSelectWorkspaceTarget();
  const { openWorkspaceFile } = useOpenWorkspaceFile(workspaceId);

  const registry = useMemo(() => {
    const nextRegistry = createUiActionRegistry();

    nextRegistry.register("editor.openFile", async (event) => {
      if (event.intent.type !== "editor.openFile") return;
      await openWorkspaceFile({
        workspaceId: event.intent.workspaceId ?? event.workspaceId,
        path: event.intent.path,
        line: event.intent.line,
        column: event.intent.column,
        source: "ui-action",
      });
    });

    nextRegistry.register("browser.openUrl", (event) => {
      if (event.intent.type !== "browser.openUrl") return;
      window.open(event.intent.url, event.intent.target === "external" ? "_blank" : "_blank", "noopener,noreferrer");
    });

    nextRegistry.register("workspace.focus", async (event) => {
      if (event.intent.type !== "workspace.focus") return;
      await selectWorkspaceTarget(event.intent.workspaceId);
    });

    nextRegistry.register("panel.show", (event) => {
      if (event.intent.type !== "panel.show") return;
      if (event.intent.panel === "terminal") {
        setTerminalVisible(true);
        return;
      }

      const panelMap = {
        explorer: "explorer",
        search: "search",
        git: "source-control",
        skills: "skills",
        agentInstructions: "agent-instructions",
      } as const;
      setDesktopSidebarView(panelMap[event.intent.panel]);
      setSidebarCollapsed(false);
    });

    nextRegistry.register("command.run", (event) => {
      if (event.intent.type !== "command.run") return;
      if (!isAllowedFrontendUiCommand(event.intent.commandId)) {
        throw new Error(`Frontend UI command is not allowed: ${event.intent.commandId}`);
      }
      if (event.intent.commandId === "quickOpen.open") {
        setQuickOpenOpen(true);
      } else if (event.intent.commandId === "commandPalette.open") {
        setCommandPaletteOpen(true);
      }
    });

    return nextRegistry;
  }, [
    openWorkspaceFile,
    pushToast,
    selectWorkspaceTarget,
    setCommandPaletteOpen,
    setDesktopSidebarView,
    setQuickOpenOpen,
    setSidebarCollapsed,
    setTerminalVisible,
  ]);

  useEffect(() => {
    if (!wsClient) {
      return;
    }

    return wsClient.subscribe([Topics.workspaceUiAction(workspaceId)], (_topic, payload) => {
      if (!isUiActionEvent(payload)) {
        pushToast({
          kind: "error",
          title: "UI action failed",
          body: "Received an invalid UI action event.",
        });
        return;
      }

      void registry.execute(payload).catch((error) => {
        pushToast({
          kind: "error",
          title: "UI action failed",
          body: error instanceof Error ? error.message : "Unable to execute UI action.",
        });
      });
    });
  }, [pushToast, registry, workspaceId, wsClient]);
}
```

Modify `packages/web/src/features/workspace/views/desktop/workspace-desktop-view.tsx`:

```ts
import { useUiActionSubscription } from "../../../ui-actions/use-ui-action-subscription";
```

Call inside `WorkspaceDesktopView` after resolving `workspace`:

```ts
useUiActionSubscription(workspace.id);
```

- [ ] **Step 4: Run frontend UI action tests and verify GREEN**

Run:

```bash
pnpm --filter @coder-studio/web exec vitest run src/features/ui-actions/registry.test.ts src/features/ui-actions/use-ui-action-subscription.test.tsx
```

Expected: PASS.

## Task 8: Package Typecheck and Focused Verification

**Files:**
- All files touched above.

- [ ] **Step 1: Run focused package tests**

Run:

```bash
pnpm --filter @coder-studio/core exec vitest run src/domain/ui-actions.test.ts src/domain/automation.test.ts src/protocol/messages.test.ts
pnpm --filter @coder-studio/server exec vitest run src/__tests__/ui-actions-commands.test.ts src/__tests__/dispatch.test.ts
pnpm --filter @spencer-kit/coder-studio exec vitest run src/bin.test.ts
pnpm --filter @coder-studio/web exec vitest run src/features/ui-actions/registry.test.ts src/features/ui-actions/use-ui-action-subscription.test.tsx
```

Expected: all PASS.

- [ ] **Step 2: Run typecheck**

Run:

```bash
pnpm ci:typecheck
```

Expected: exit 0.

- [ ] **Step 3: Run repository verification**

Run:

```bash
pnpm ci:verify
```

Expected: exit 0. If this is too slow or exposes unrelated pre-existing failures, capture exact command output and run the narrower package checks from Step 1 plus `pnpm ci:typecheck`.

- [ ] **Step 4: Review scope**

Run:

```bash
git diff --stat
git diff -- packages/server/src/skills packages/server/src/agent-instructions
```

Expected:

- Diff stat only includes core/server/web/cli plus this plan.
- No changes under `packages/server/src/skills` or `packages/server/src/agent-instructions`.

## Self-Review

- Spec coverage: The plan covers shared protocol, topic, server command/broadcast, frontend executor subscription, CLI bridge, safety boundaries, and capabilities. It explicitly excludes built-in skill registration for this phase.
- Placeholder scan: No implementation step contains TBD/TODO/fill-in placeholders. The only intentionally flexible part is the frontend hook test detail, but it lists concrete assertions and harness shape.
- Type consistency: The shared action names are consistently `editor.openFile`, `browser.openUrl`, `workspace.focus`, `panel.show`, and `command.run`; server operation names are consistently `uiAction.capabilities` and `uiAction.dispatch`; CLI subcommands consistently map to those intents.
