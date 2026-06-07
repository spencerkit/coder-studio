# Product Requirements Document: Agent Automation Skills

> Last updated: 2026-06-06
> Scope: built-in skills, agent-facing automation discovery, CLI/API access, browser verification, and plugin/status extension surfaces.
> Status: proposed product direction for phased implementation.

## 1. Background

Coder Studio already provides a local browser workspace that combines agent sessions, terminals, files, Git, worktrees, Supervisor, settings, and work analysis. The current product is strong when a human operates the workspace through the UI. It is weaker when an agent or local automation tool needs to discover and use Coder Studio capabilities on its own.

The gap appears in three related areas:

- Agents do not have a stable way to discover Coder Studio commands and current workspace context.
- Agents can modify code, but they do not have a first-class Coder Studio browser verification loop for frontend changes.
- External tools and future plugins do not have a stable status/progress/sidebar contribution surface inside Coder Studio.

This PRD defines a complete product direction that starts with built-in skills and grows into a broader automation platform.

## 2. Product Goal

Make Coder Studio understandable and usable by coding agents without requiring the agent to guess commands, read stale documentation, or rely on manual UI operation.

The intended user experience is:

1. A user starts Claude, Codex, or another provider inside Coder Studio.
2. Coder Studio automatically makes built-in skills available to that provider.
3. The agent detects it is running inside Coder Studio.
4. The agent uses a small stable entrypoint to identify the current workspace/session and discover available commands.
5. The agent calls Coder Studio automation commands for safe operations.
6. Risky operations require approval and are auditable.
7. Later phases add browser verification and plugin/status surfaces on the same automation foundation.

## 3. Non-Goals

This project does not replace the existing Coder Studio UI.

This project does not require implementing a full VS Code-style plugin marketplace in the first release.

This project does not grant agents unrestricted filesystem, terminal, Git, browser, or plugin permissions.

This project does not require every provider to support skills equally. Provider-specific adapters may expose different support levels.

This project does not make browser automation use a user's real browser profile by default.

## 4. Target Users

### 4.1 Developer Running Agents

The developer wants Claude, Codex, or another provider to operate more effectively inside the Coder Studio workspace.

Primary benefit: fewer manual copy/paste steps and better task completion quality.

### 4.2 Power User Automating Local Workflows

The user wants scripts that open workspaces, start sessions, run tests, inspect Git, or launch verification flows.

Primary benefit: Coder Studio becomes scriptable instead of UI-only.

### 4.3 Plugin or Integration Author

The author wants to surface CI, test, review, deployment, issue tracker, or internal workflow status inside Coder Studio.

Primary benefit: integrations can attach to a stable extension surface instead of patching the core UI.

## 5. Core Concepts

### 5.1 Built-in Skill

A built-in skill is a Coder Studio-owned skill packaged with the application and mounted into supported provider skill directories. It teaches the agent when and how to use Coder Studio capabilities.

Built-in skills are versioned, visible in the Skills UI, and can be disabled by the user.

### 5.2 Agent Runtime Context

Agent runtime context is the workspace/session/terminal/provider identity exposed to the running agent through environment variables and a machine-readable command.

The agent should not infer current context from terminal paths or UI labels.

### 5.3 Capabilities Discovery

Capabilities discovery is a machine-readable list of current Coder Studio automation commands, input schemas, examples, permission requirements, and availability.

The capabilities response is the source of truth for agents. Built-in skills should point agents to capabilities discovery instead of hardcoding many command details.

### 5.4 Automation Permission

Automation permissions define what an agent may do through Coder Studio automation commands.

Permissions are separate from normal UI access. An operation can be available to the user in the UI but still require explicit approval when invoked by an agent.

### 5.5 Browser Verification Surface

The browser verification surface is a controlled browser panel that an agent can use to open local development URLs, inspect page state, click, fill forms, capture screenshots, and read console errors.

### 5.6 Plugin/Status Surface

The plugin/status surface is a stable way for external integrations to publish commands, status pills, progress, logs, and sidebar views into Coder Studio.

## 6. Product Requirements

## 6.1 Built-in Skills

Coder Studio must ship with first-party built-in skills.

Initial built-in skills:

| Skill | Default | Purpose |
| --- | --- | --- |
| `coder-studio-automation` | Enabled | Teach agents to identify context and discover automation commands. |
| `coder-studio-browser-verification` | Enabled when browser automation is available | Teach agents to verify frontend/UI changes through Coder Studio browser automation. |
| `coder-studio-review` | Enabled | Teach agents to inspect Git diff, run relevant checks, and summarize verification before finishing. |

Each built-in skill must include:

- `SKILL.md`
- name
- description
- version
- source marker of `builtin`
- supported provider target rules
- user-visible enablement state

Built-in skill content must remain short and stable. It should instruct agents to use:

```bash
coder-studio identify --json
coder-studio capabilities --json
```

Built-in skill content must not duplicate a large command reference that can drift from implementation.

## 6.2 Built-in Skill Distribution

Coder Studio must automatically distribute supported built-in skills to supported provider skill directories.

Distribution rules:

- Auto-mount is enabled by default.
- Auto-mount only targets providers with configured skill mount directories.
- User-disabled mounts must not be re-enabled automatically.
- Built-in skill updates must refresh managed source content.
- Existing user-installed skills must not be overwritten.
- Failed mounts must surface health errors in the Skills UI.
- Custom providers are not auto-mounted by default unless the provider declares compatible skill support or the user enables auto-mount for that provider.

The existing skill management concepts should remain recognizable:

- skill library
- skill mount relation
- provider skill target
- health scan
- repair

## 6.3 Skills UI

The Skills UI must show built-in skills as a distinct section.

Required UI information:

- skill name
- built-in source badge
- version
- enabled/disabled state
- mounted provider list
- last synced time
- health state
- link/action to view skill content
- action to disable or re-enable auto-mount
- action to repair a failed mount

The UI must make clear that disabling a built-in skill affects future agent guidance, not the availability of the underlying Coder Studio UI.

## 6.4 Agent Runtime Environment

When Coder Studio starts an agent session, it must inject runtime context environment variables when supported by the provider launch path.

Minimum variables:

```bash
CODER_STUDIO=1
CODER_STUDIO_WORKSPACE_ID=<workspace-id>
CODER_STUDIO_SESSION_ID=<session-id>
CODER_STUDIO_PROVIDER_ID=<provider-id>
CODER_STUDIO_API_URL=<local-server-url>
```

When a terminal id is known:

```bash
CODER_STUDIO_TERMINAL_ID=<terminal-id>
```

When token-scoped automation is implemented:

```bash
CODER_STUDIO_TOKEN=<scoped-token>
```

Environment injection must not leak long-lived administrative secrets.

## 6.5 Identify Command

Coder Studio must provide a machine-readable identify command:

```bash
coder-studio identify --json
```

The command must return the current runtime context when called from a Coder Studio-managed agent environment.

Expected response shape:

```json
{
  "insideCoderStudio": true,
  "workspaceId": "ws_123",
  "sessionId": "sess_123",
  "terminalId": "term_123",
  "providerId": "codex",
  "cwd": "/path/to/workspace",
  "apiUrl": "http://127.0.0.1:4173",
  "permissions": ["workspace:read", "terminal:read", "git:read"]
}
```

If called outside Coder Studio, the command must return a clear non-context response instead of pretending to know context:

```json
{
  "insideCoderStudio": false
}
```

## 6.6 Capabilities Command

Coder Studio must provide a machine-readable capabilities command:

```bash
coder-studio capabilities --json
```

The command must list automation capabilities available to the caller.

Required fields per capability:

- name
- CLI form
- description
- input schema
- output shape summary
- permissions
- risk level
- examples
- availability state

Example:

```json
{
  "name": "git.status",
  "cli": "coder-studio git status",
  "description": "Read Git status for a workspace.",
  "inputSchema": {
    "workspaceId": "string"
  },
  "permissions": ["git:read"],
  "riskLevel": "read",
  "examples": [
    "coder-studio git status --workspace ws_123 --json"
  ],
  "available": true
}
```

Capabilities must be filterable by current permission scope. An agent should not see privileged examples it cannot invoke.

## 6.7 Initial Automation Command Families

The first automation surface should expose these command families in a JSON-friendly way:

| Family | Examples | Phase |
| --- | --- | --- |
| Context | `identify`, `capabilities` | MVP |
| Workspace | list/current/open metadata | MVP |
| Session | list/current/status | MVP |
| Terminal | list/read/send | MVP |
| Git | status/diff | MVP |
| Events | JSONL event stream | Phase 2 |
| Browser | open/snapshot/screenshot/console/click/fill/wait | Phase 2 |
| Plugin status | set-status/progress/log/list | Phase 3 |
| MCP | expose the same capabilities as MCP tools | Phase 3 |

CLI commands and WebSocket/server commands should share a common command registry or metadata source where practical.

## 6.8 Permissions and Approval

Automation commands must declare risk level:

| Risk | Behavior |
| --- | --- |
| `read` | Allowed when caller has read permission. |
| `write` | Allowed when caller has write permission; command is audited. |
| `dangerous` | Requires explicit user approval before execution. |

Initial permission groups:

- `workspace:read`
- `workspace:write`
- `session:read`
- `session:write`
- `terminal:read`
- `terminal:write`
- `git:read`
- `git:write`
- `browser:read`
- `browser:write`
- `plugin:read`
- `plugin:write`
- `events:read`

Risk examples:

| Operation | Risk |
| --- | --- |
| `git status` | `read` |
| `git diff` | `read` |
| read terminal output | `read` |
| send terminal input | `write` |
| browser screenshot | `read` |
| browser click/fill | `write` |
| `git push` | `dangerous` |
| delete files | `dangerous` |
| install plugin | `dangerous` |

When a command requires approval and no approval is available yet, it must fail clearly:

```json
{
  "code": "approval_required",
  "message": "This operation requires user approval.",
  "approval": {
    "operation": "terminal.send",
    "riskLevel": "dangerous"
  }
}
```

Later phases may add an approval queue or Feed-style UI.

## 6.9 Audit Log

Agent-triggered automation commands must be auditable.

Audit records must include:

- timestamp
- workspace id
- session id when available
- provider id when available
- command name
- risk level
- permission decision
- success/failure
- sanitized arguments

Audit logs must not store secret values, full prompts, access tokens, or password field contents.

## 6.10 Browser Verification

Coder Studio should add a browser verification surface for agent-controlled frontend validation.

Required capabilities:

- open URL
- navigate
- wait for text or selector
- capture screenshot
- read accessibility or DOM snapshot
- read console errors
- click
- fill
- press key
- inspect current URL/title

Default security model:

- use isolated browser profile
- do not use the user's personal browser cookies by default
- prefer localhost/workspace development URLs
- require approval for sensitive form filling
- expose screenshots through Coder Studio review UI when possible

Browser verification must integrate with built-in skills. `coder-studio-browser-verification` should tell the agent to use capabilities discovery and then browser commands.

## 6.11 Plugin/Status API

Coder Studio should provide a lightweight extension surface before a full plugin runtime.

Initial plugin/status contributions:

- set status pill
- clear status pill
- set progress
- clear progress
- append log entry
- clear log
- list current extension state
- register Quick Actions command metadata

Example command direction:

```bash
coder-studio status set --workspace ws_123 --key ci --label "CI running" --state running
coder-studio progress set --workspace ws_123 --key tests --value 42 --max 100
coder-studio log append --workspace ws_123 --key ci --message "Unit tests started"
```

The plugin/status API should later support sidebar views, but the first release should not require arbitrary third-party webviews.

## 6.12 MCP Server

Coder Studio should eventually expose its automation capabilities through MCP.

The MCP server must reuse the same underlying capabilities registry and permission checks as the CLI.

Expected command:

```bash
coder-studio mcp
```

MCP is not the MVP path. CLI and internal automation metadata should land first.

## 6.13 Documentation

Documentation must include:

- user-facing overview of built-in skills
- how to disable auto-mount
- how agents discover commands
- CLI reference for `identify` and `capabilities`
- security model and approval behavior
- troubleshooting for failed skill mounts
- examples for agent-friendly browser verification

Docs must avoid implying that unavailable later-phase browser/plugin/MCP capabilities are already shipped.

## 7. Phased Delivery

## 7.1 MVP: Built-in Skills and Discovery Foundation

Goal: agents can discover Coder Studio context and capabilities through built-in skills and machine-readable commands.

Included:

- built-in skill registry
- materialized built-in skill files
- built-in skills appear in skill library
- auto-mount to supported providers
- user disablement respected
- Skills UI built-in section
- session environment variables
- `coder-studio identify --json`
- `coder-studio capabilities --json`
- capabilities metadata for context/workspace/session/terminal/git read commands
- basic audit records for automation commands

Excluded from MVP:

- browser automation
- plugin/sidebar API
- MCP server
- full approval queue UI

MVP acceptance criteria:

- A fresh Coder Studio start shows the built-in skills in Skills UI.
- Codex and Claude receive mounted built-in skills when their skill directories are configured.
- A user can disable a built-in skill and it stays disabled after restart.
- An agent session includes `CODER_STUDIO=1` and workspace/session/provider environment variables.
- Inside the session, `coder-studio identify --json` returns current context.
- Inside the session, `coder-studio capabilities --json` returns available commands and permissions.
- Existing user-installed skills continue to install, mount, unmount, repair, and uninstall.

## 7.2 Phase 2: Browser Verification and Events

Goal: agents can validate browser-visible changes through Coder Studio.

Included:

- browser panel lifecycle
- browser command capabilities
- screenshot capture
- DOM or accessibility snapshot
- console error collection
- click/fill/wait commands
- JSONL event stream for automation-relevant events
- browser verification skill enabled when browser automation is available
- browser command audit records

Acceptance criteria:

- An agent can start a dev server in a terminal and open the local URL through a Coder Studio browser command.
- An agent can capture a screenshot and read console errors.
- An agent can wait for expected text and report success/failure.
- Browser actions are scoped, auditable, and do not use personal browser profile data by default.

## 7.3 Phase 3: Plugin/Status API and Approval UI

Goal: external tools can publish workflow state into Coder Studio, and risky automation has a visible approval flow.

Included:

- status/progress/log command families
- workspace/session scoped status state
- UI surfaces for status, progress, and logs
- Quick Actions contribution metadata
- approval queue UI for dangerous commands
- approval result returned to blocked automation caller where possible

Acceptance criteria:

- A local script can set and clear a workspace status pill.
- A local script can publish progress and append logs visible in the UI.
- A risky agent command can request approval and the user can approve or deny it from Coder Studio.
- Approval decisions are audited.

## 7.4 Phase 4: MCP and Advanced Extension Surfaces

Goal: expose Coder Studio automation to MCP-capable agents and support richer extension views.

Included:

- `coder-studio mcp`
- MCP tools generated from capabilities registry
- same permission and audit model as CLI
- sidebar view contribution model
- extension lifecycle management

Acceptance criteria:

- MCP-capable agents can discover and call Coder Studio tools.
- MCP tools match CLI permissions and risk behavior.
- A trusted extension can render a sidebar view without compromising the core UI.

## 8. Data and State Requirements

## 8.1 Built-in Skill State

Coder Studio must persist:

- built-in skill version
- materialized source path
- enabled state
- per-provider auto-mount state
- user disablement decisions
- last sync timestamp
- last health state

## 8.2 Automation Command Metadata

Coder Studio must maintain metadata for:

- command name
- CLI mapping
- schema
- permission requirements
- risk level
- examples
- availability checks

This metadata should be reusable by:

- CLI help
- `capabilities --json`
- future MCP server
- docs generation where practical

## 8.3 Audit State

Audit records must be local-first and stored under the configured Coder Studio state directory.

The audit store should support bounded retention to avoid unbounded disk growth.

## 9. Security and Privacy Requirements

Agents must not receive unrestricted server control by default.

Automation tokens, when introduced, must be scoped to the running session and permissions.

Sensitive values must be redacted from logs, audit records, and UI.

Dangerous automation commands must require approval.

Browser automation must default to isolated browser state.

Public network exposure does not change the security model. If Coder Studio is reachable through LAN, VPN, tunnel, or public URL, automation permissions still apply.

## 10. Success Metrics

Product success can be evaluated with:

- percentage of agent sessions with built-in skills mounted successfully
- number of successful `identify` and `capabilities` calls from agent sessions
- reduction in user manual copy/paste actions during agent workflows
- browser verification success/failure counts after Phase 2
- plugin/status API adoption after Phase 3
- number of risky operations correctly gated by approval
- support issues related to failed skill mounts or stale skill docs

## 11. Product Decisions for Initial Planning

The first implementation plan should use these defaults:

1. Auto-mount is enabled by default for `coder-studio-automation` and `coder-studio-review`.
2. `coder-studio-browser-verification` is shipped in the built-in library during MVP, but it is only auto-mounted after browser automation is available.
3. Custom providers do not receive built-in skills automatically in MVP. They may be enabled manually through the Skills UI if they expose a skill mount directory.
4. `identify` and `capabilities` should exist as top-level CLI commands and should be backed by server-side metadata that can also serve WebSocket callers.
5. MVP audit logs are stored locally but do not need a full Settings UI. They must still be available for debugging through logs or a future command.
6. Phase 2 browser automation should use an isolated Playwright/Chromium profile unless implementation research proves a better local-first option.
7. Plugin/status commands should wait until Phase 3, after the automation metadata and audit model exist.
8. Approval UI is not required for MVP. MVP dangerous commands should return `approval_required` instead of executing.

## 12. Recommended Implementation Order

The recommended order is:

1. Built-in skill registry and materialization.
2. Built-in skill library integration.
3. Auto-mount sync manager and user disablement persistence.
4. Skills UI built-in section.
5. Session environment injection.
6. `identify --json`.
7. `capabilities --json`.
8. Initial audit log.
9. Browser verification commands and UI.
10. Event stream.
11. Status/progress/log API.
12. Approval UI.
13. MCP server.
14. Rich sidebar extension views.

This order keeps the MVP small while preserving the larger platform direction.
