# UI Action Protocol and Agent Skill Design

Date: 2026-06-12
Status: Draft
Owner: Codex

## Problem

Coder Studio already has two related but separate command surfaces:

- Agent automation commands in `packages/core/src/domain/automation.ts` and
  `packages/server/src/commands/automation.ts`. These currently expose a small
  read-oriented capability list such as workspace, session, terminal, and Git
  reads.
- Frontend UI commands in features like Command Palette, Quick Open, workspace
  panels, and editor actions. These commands are implemented directly in React
  components and hooks, not as a shared protocol.

Because these surfaces are separate, there is no standard way for an agent
session to ask Coder Studio to perform a UI interaction such as opening a file
in the built-in editor, showing the terminal panel, switching workspace focus,
or opening a localhost web page in the internal preview surface.

The requested built-in skill therefore needs more than a `SKILL.md` file. The
skill can teach the agent how to request UI actions, but the product also needs
a stable UI action protocol, a server bridge, and frontend executors that own
the actual UI state changes.

## Goals

- Define a first-class UI action protocol that is shared through `packages/core`.
- Give agent sessions a provider-neutral way to request UI interactions.
- Add an internal server command that validates and broadcasts UI action
  intents to the active frontend.
- Add a frontend executor registry so UI features can register supported actions
  without hard-coding all behavior in one component.
- Implement an MVP built-in skill that documents how agents should call the UI
  action bridge.
- Support opening workspace files, opening localhost URLs, focusing
  workspaces, showing common panels, and running a small allowlist of existing
  frontend commands.
- Keep UI state ownership in the frontend. Server and agents request actions;
  React executors decide how to apply them.
- Make the protocol extensible for later agent-facing UI features.

## Non-Goals

- Do not implement general DOM automation, arbitrary clicks, or form filling.
- Do not give agents unrestricted browser automation or screenshot access.
- Do not allow arbitrary external URL browsing in the MVP.
- Do not make server commands mutate frontend-only atoms directly.
- Do not replace all existing Command Palette behavior in the first
  implementation.
- Do not add dangerous UI actions such as discard changes, delete files, or
  close all sessions in the MVP.
- Do not depend on provider-specific native tool-call APIs.

## Current Context

Relevant current code:

- `packages/core/src/domain/automation.ts` defines the existing agent
  automation capability descriptors.
- `packages/server/src/commands/automation.ts` exposes
  `automation.identify` and `automation.capabilities`.
- `packages/server/src/session/manager.ts` injects session environment such as
  `CODER_STUDIO`, `CODER_STUDIO_WORKSPACE_ID`, `CODER_STUDIO_SESSION_ID`,
  `CODER_STUDIO_PROVIDER_ID`, and optionally `CODER_STUDIO_API_URL`.
- `packages/server/src/skills/builtin/registry.ts` currently has an empty
  `BUILTIN_SKILLS` list.
- `packages/server/src/skills/builtin/materialize.ts` writes each built-in
  skill as `SKILL.md`.
- `packages/web/src/features/code-editor/actions/use-open-location.ts` can open
  a file and navigate to a location.
- `packages/web/src/features/workspace/actions/use-open-workspace-file.ts` wraps
  editor pane and standalone editor targeting.
- `packages/web/src/features/quick-open/components/quick-open.tsx` opens files
  through the existing frontend editor flow.
- `packages/web/src/features/command-palette/components/command-palette.tsx`
  contains local frontend commands but no shared command registry.

## User Decisions Captured

- The built-in skill should let agents open files and web pages through Coder
  Studio's built-in UI.
- The feature should also introduce a standard UI interaction instruction
  protocol, not just a one-off file opener.
- The protocol should make future agent-facing UI features easy to add.
- The first implementation should remain practical and scoped.

## Approaches Considered

### Option A: Skill-only instructions

Add a built-in skill that tells agents to ask the user to open files or paste
URLs manually.

Pros:

- Very small implementation.
- No protocol or server changes.

Cons:

- Does not actually let agents operate the built-in editor or preview surface.
- Does not create an extension point for future UI actions.
- Produces a weak user experience.

Decision: reject.

### Option B: Provider-native tools per agent

Implement native tool-call integrations for each provider and map those tools
to Coder Studio UI actions.

Pros:

- Could feel natural in providers that support tool calls.
- Could return structured results directly to the model.

Cons:

- Provider support is inconsistent.
- Requires separate implementations for Codex, Claude, Gemini, OpenCode, and
  custom providers.
- Increases coupling to provider-specific protocols.

Decision: reject for MVP.

### Option C: Shared UI action protocol with CLI bridge

Define UI action intents in core, expose them through server automation
commands, execute them in frontend subscribers, and teach agents to call a
provider-neutral CLI helper.

Pros:

- Works across providers because agents can run a local command.
- Keeps UI state changes in the frontend.
- Creates a stable extension point for future UI capabilities.
- Fits the existing WebSocket dispatch and topic model.

Cons:

- Requires coordinated changes across core, server, web, CLI, and built-in
  skills.
- First version needs careful security boundaries around URL and command
  execution.

Decision: accept.

## Final Design

### 1. Core Protocol

Add `packages/core/src/domain/ui-actions.ts`.

The MVP protocol defines an intent union:

```ts
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
      panel:
        | "terminal"
        | "explorer"
        | "search"
        | "git"
        | "skills"
        | "agentInstructions";
    }
  | {
      type: "command.run";
      commandId: string;
      args?: Record<string, unknown>;
    };
```

Add companion types:

```ts
export type UiActionRiskLevel = "read" | "write" | "dangerous";

export interface UiActionDescriptor {
  type: UiActionIntent["type"];
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
```

Extend automation permissions with UI-specific entries:

- `ui:read`
- `ui:navigate`
- `ui:command`

MVP actions should use `read` or low-risk navigation semantics. Destructive UI
actions remain out of scope.

### 2. Topic Model

Add a workspace-scoped topic to `packages/core/src/protocol/topics.ts`:

```ts
workspaceUiAction: (workspaceId: string) => `workspace.${workspaceId}.ui.action`
```

The event payload is a normalized `UiActionDispatchRequest` plus server-derived
metadata:

```ts
export interface UiActionEvent {
  requestId: string;
  workspaceId: string;
  intent: UiActionIntent;
  source?: UiActionDispatchRequest["source"];
  dispatchedAt: number;
}
```

The server only accepts and broadcasts the request. The frontend applies it and
may show success or error feedback locally. The server result should not claim
that the UI action completed, only that it was accepted and routed.

### 3. Server Command

Add `packages/server/src/commands/ui-actions.ts` and import it from
`packages/server/src/commands/index.ts`.

Register:

```ts
uiAction.dispatch
uiAction.capabilities
```

`uiAction.dispatch` accepts:

```ts
{
  intent: UiActionIntent;
  source?: {
    kind: "agent" | "user" | "system";
    sessionId?: string;
    providerId?: string;
  };
  requestId?: string;
}
```

Server responsibilities:

- Resolve missing `workspaceId` from `source.sessionId` when possible.
- Validate the workspace exists.
- Validate session ownership when `source.sessionId` is supplied.
- Normalize editor paths to workspace-relative paths.
- Reject absolute paths or paths escaping the workspace.
- Validate line and column are positive integers when supplied.
- Restrict `browser.openUrl` in MVP to:
  - `http://localhost:*`
  - `http://127.0.0.1:*`
  - `http://[::1]:*`
  - existing Coder Studio preview URLs if they are already server-local
- Restrict `command.run` to an explicit allowlist.
- Broadcast the action on `Topics.workspaceUiAction(workspaceId)`.
- Return `UiActionDispatchResult`.

`uiAction.capabilities` returns descriptors for currently enabled UI actions.
It can be used by both CLI and future UI documentation surfaces.

### 4. Agent Automation Capability Integration

Extend `automation.capabilities` so agent-visible capability discovery includes
UI action commands. The existing `AutomationCapability` shape can either:

- include UI action entries directly, or
- add a `uiActions` property to the response.

Prefer adding `uiActions` to avoid overloading command-style capabilities with
intent-style descriptors:

```ts
{
  version: 1,
  commands: AutomationCapability[],
  uiActions: UiActionDescriptor[]
}
```

Existing callers that only read `commands` continue to work.

### 5. CLI Bridge

Extend `packages/cli` with a provider-neutral UI action entrypoint:

```bash
coder-studio ui editor.openFile --path src/app.ts --line 42 --column 5
coder-studio ui browser.openUrl --url http://localhost:5173
coder-studio ui panel.show --panel terminal
coder-studio ui workspace.focus --workspace ws_123
coder-studio ui command.run --command quickOpen.open
```

CLI behavior:

- Read `CODER_STUDIO_API_URL`, `CODER_STUDIO_WORKSPACE_ID`,
  `CODER_STUDIO_SESSION_ID`, and `CODER_STUDIO_PROVIDER_ID` from the
  environment.
- Allow explicit flags to override workspace or session when needed.
- Call the server endpoint or command bridge that maps to `uiAction.dispatch`.
- Print compact JSON on `--json`.
- Print a short human-readable success or failure message by default.

The CLI should not talk directly to WebSocket topics. It should call a server
command-facing HTTP endpoint or existing automation client path so validation is
centralized in the server.

### 6. Built-In Skill

Add a built-in skill in `packages/server/src/skills/builtin/registry.ts`:

- `slug`: `coder-studio-ui`
- `displayName`: `Coder Studio UI`
- `description`: `Open files, URLs, panels, and supported UI commands in Coder Studio.`
- `defaultEnabled`: `true`
- `autoMountInMvp`: `true`

The skill body should be concise. It should teach agents:

- Use `coder-studio ui ...` when running inside Coder Studio.
- Prefer `editor.openFile` when referencing code or asking the user to inspect a
  specific location.
- Prefer `browser.openUrl` for localhost development servers and generated
  previews.
- Prefer `panel.show` to surface relevant built-in panels.
- Check command output and report failures.
- Do not attempt arbitrary browser automation with this skill.

Example skill snippet:

````markdown
---
name: coder-studio-ui
description: Use Coder Studio's built-in UI to open files, localhost URLs, panels, and supported commands for the user.
---

# Coder Studio UI

When you are running inside Coder Studio and need the user to inspect a file,
web page, or panel, call the `coder-studio ui` command.

Examples:

```bash
coder-studio ui editor.openFile --path packages/server/src/commands/file.ts --line 94
coder-studio ui browser.openUrl --url http://localhost:5173
coder-studio ui panel.show --panel terminal
```

Only use supported UI actions. Treat command failures as real failures and
explain them briefly to the user.
````

### 7. Frontend Executor Registry

Add a web-side executor registry, for example:

- `packages/web/src/features/ui-actions/types.ts`
- `packages/web/src/features/ui-actions/registry.ts`
- `packages/web/src/features/ui-actions/use-ui-action-subscription.ts`

Executor interface:

```ts
export interface UiActionExecutor<TIntent extends UiActionIntent = UiActionIntent> {
  type: TIntent["type"];
  execute(intent: TIntent, context: UiActionExecutionContext): Promise<void> | void;
}
```

Execution context includes:

- current workspace list and active workspace setters
- navigation helpers
- toast/notification helpers
- dispatch command helper if needed
- editor helpers where available

The first implementation can keep executors in one feature folder and call
existing hooks. Later, each feature can own its executor registration.

### 8. MVP Executors

#### `editor.openFile`

Behavior:

- Resolve `workspaceId` from the intent or current active workspace.
- Switch to the workspace route when needed.
- Use `useOpenWorkspaceFile`.
- Pass `line` and `column` as pending editor navigation.
- Respect `target: "active"` by default.
- Support `{ paneId }` when supplied and valid.
- Treat `"newPane"` as a later enhancement unless an existing pane creation
  flow is straightforward to reuse.

#### `browser.openUrl`

Behavior:

- Open approved localhost URLs in the built-in preview/browser surface.
- If the current app already has a preview pane component suitable for arbitrary
  localhost URLs, reuse it.
- If not, MVP may open a controlled iframe preview panel first and leave richer
  browser controls for later.
- Reject unsupported URL targets with a toast.

#### `panel.show`

Behavior:

- `terminal`: show bottom terminal panel and ensure non-zero height.
- `explorer`, `search`, `git`, `skills`, `agentInstructions`: select the
  corresponding workspace sidebar section.
- Switch to the workspace route if needed.

#### `workspace.focus`

Behavior:

- Reuse `useSelectWorkspaceTarget`.
- Navigate to `/workspace`.

#### `command.run`

Behavior:

- MVP allowlist:
  - `quickOpen.open`
  - `commandPalette.open`
  - `settings.open`
  - `focusMode.enable`
  - `focusMode.disable`
  - `terminal.show`
- Do not expose arbitrary command IDs.
- This can become the bridge to a shared Command Palette registry later.

### 9. Command Palette Alignment

The MVP does not need to rewrite Command Palette. However, the design should
avoid making a second long-lived command system.

Follow-up direction:

- Extract `CommandPalette` command definitions into a shared frontend command
  registry.
- Make `command.run` call that registry for allowlisted commands.
- Let Command Palette render from the same descriptors when possible.

This keeps the first implementation small while preserving a path to one
frontend command model.

### 10. Security and Permissions

MVP safety rules:

- Agents can request UI navigation, not arbitrary mutation.
- Server validates workspace/session ownership before broadcasting.
- Paths must stay inside the workspace.
- URLs are limited to localhost and server-owned preview URLs.
- `command.run` is allowlisted.
- Dangerous actions are not included in descriptors.
- The frontend may ignore actions for workspaces not currently loaded.
- Failed actions should show a toast and be logged in testable code paths.

Future expansion should add explicit permission descriptors before adding
write/dangerous actions.

## Data Flow

Agent flow:

1. Built-in skill tells the agent to call `coder-studio ui editor.openFile`.
2. CLI reads Coder Studio environment variables.
3. CLI sends a `uiAction.dispatch` request to the local server.
4. Server validates and normalizes the intent.
5. Server broadcasts `workspace.<id>.ui.action`.
6. Frontend subscription receives the action.
7. The relevant executor updates UI state through existing hooks.
8. The user sees the file, page, panel, or command result in the UI.

Manual or future UI flow:

1. Internal UI code can construct a `UiActionIntent`.
2. The same executor registry can execute it locally or route it through server
   when remote session provenance matters.

## Error Handling

Server errors:

- `workspace_not_found`
- `session_not_found`
- `ui_action_invalid_path`
- `ui_action_invalid_url`
- `ui_action_unsupported`
- `ui_action_command_not_allowed`

Frontend errors:

- Missing executor.
- Workspace not loaded.
- File open failed.
- Preview/browser panel unavailable.
- Unsupported target.

Frontend executor failures should show a concise toast. Server dispatch success
must be worded as "accepted" rather than "completed" because the server cannot
observe React state completion.

## Testing Strategy

Core tests:

- Validate UI action schemas and descriptor construction.
- Verify automation capability response includes `uiActions` without breaking
  existing `commands`.

Server tests:

- `uiAction.dispatch` resolves workspace from session.
- It rejects unknown workspaces and sessions.
- It rejects path traversal and absolute paths.
- It accepts valid workspace-relative paths.
- It rejects non-localhost URLs.
- It accepts localhost URLs.
- It rejects non-allowlisted `command.run`.
- It broadcasts to `Topics.workspaceUiAction(workspaceId)`.

Web tests:

- Subscription receives `editor.openFile` and calls existing open file flow.
- `panel.show terminal` opens the terminal panel.
- `workspace.focus` changes active workspace and route.
- `command.run quickOpen.open` opens Quick Open.
- Unsupported actions show failure feedback without crashing.

CLI tests:

- Parse each MVP subcommand into the expected intent.
- Read default workspace/session/provider from environment.
- Respect `--json`.
- Surface server error messages.

Skill tests:

- Built-in skill materializes into `SKILL.md`.
- Built-in sync auto-mounts it for providers with skill directories.

## Rollout Plan

1. Add core protocol and descriptors.
2. Add server command and topic broadcasting.
3. Add CLI `coder-studio ui` command parsing and dispatch.
4. Add frontend subscription and MVP executors.
5. Add built-in skill registration.
6. Add tests at core, server, web, CLI, and skill sync layers.
7. Run targeted package tests, then repository-level verification.

## Open Follow-Ups

- Whether `browser.openUrl` should open in an existing preview pane, a new
  browser pane, or a minimal iframe surface in the first implementation depends
  on the current preview component boundaries.
- Whether `target: "newPane"` for `editor.openFile` should be implemented in
  MVP depends on how much pane creation logic can be reused cleanly.
- Whether UI action completion acknowledgements are needed later. MVP only
  guarantees server acceptance and frontend best-effort execution.
