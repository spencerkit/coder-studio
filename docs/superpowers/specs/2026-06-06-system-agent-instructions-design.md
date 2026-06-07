# System Agent Instructions Management Design

Date: 2026-06-06
Status: Draft
Owner: Codex

## Problem

当前 Agent 面板已经能管理项目级 `.coder-studio/agent.md`。这份文件是 Coder Studio 的 workspace-local 项目说明，保存后会同步到各 provider 在当前项目里实际读取的文件，例如 `AGENTS.md`、`GEMINI.md`、`.claude/CLAUDE.md`。

用户还希望在同一个 Agent 面板里管理每个 Agent 工具自己的用户级全局说明文件。这个文件不属于当前 workspace，通常位于用户 home 目录下，例如 Codex 的 `~/.codex/AGENTS.md` 和 Claude Code 的 `~/.claude/CLAUDE.md`。现有 `file.read` / `file.write` 明确限制在 workspace root 内，不能直接用于这些系统文件。

因此本功能需要在保留 workspace 文件安全边界的前提下，为少量已知 Agent 全局说明文件提供受控编辑入口。

## Goals

- 将现有 Agent 面板中的 `agent.md` 命名调整为 `项目 Agent.md`。
- 新增 `系统 Agent.md` 分组，列出当前内置 provider 中支持用户级全局说明文件的 Agent。
- 点击系统 Agent 条目的编辑按钮后，在现有主编辑器中打开对应文件。
- 文件不存在时创建简短 scaffold 后打开。
- 保存时支持 baseHash 冲突检测。
- 后端只允许编辑服务端定义的 provider allowlist 路径，不接受前端传任意绝对路径。
- 对没有稳定 Markdown 全局说明文件的 provider，展示不可编辑状态，而不是伪造路径。
- 桌面端和移动端都能看到同一组项目/系统 Agent.md 管理入口。

## Non-Goals

- 不把 `$HOME` 目录挂进文件树。
- 不支持任意系统文件读写。
- 不把系统 Agent 文件加入 Git diff、文件搜索、文件树、LSP 或图片预览。
- 不修改各 Agent CLI 的真实加载规则。
- 不为 Cursor User Rules 逆向或猜测本地存储路径。
- 不在一期支持自定义 provider 的全局说明文件配置。
- 不迁移或合并现有 `.coder-studio/agent.md` 内容到系统文件。

## User Decisions Captured

- “系统 agent.md” 指每个 Agent 工具自己的用户级全局说明文件。
- 现有项目级 agent.md 继续存在，但 UI 名称改为 `项目 Agent.md`。
- 新增系统级分组，用户可以直接编辑保存支持的 Agent 全局说明文件。
- Cursor Agent 如果没有稳定文件入口，可以先显示为不支持直接文件编辑。

## Research Notes

- Codex 官方文档说明全局说明文件位于 Codex home 目录，默认读取 `~/.codex/AGENTS.override.md`，否则读取 `~/.codex/AGENTS.md`。本功能一期编辑稳定基础文件 `~/.codex/AGENTS.md`，不主动创建 override 文件。
- Claude Code 官方 memory 文档列出用户级 memory 文件为 `~/.claude/CLAUDE.md`。
- Gemini CLI 文档说明 `/memory add` 会追加到全局 `~/.gemini/GEMINI.md`。
- OpenCode 官方 rules 文档说明全局规则文件为 `~/.config/opencode/AGENTS.md`。
- Cursor 官方 rules 文档说明 User Rules 是全局规则，但定义在 Cursor Settings > Rules 中，不是公开稳定的 Markdown 文件路径。

Sources:

- OpenAI Codex AGENTS.md guide: https://developers.openai.com/codex/guides/agents-md
- Claude Code memory docs: https://docs.claude.com/en/docs/claude-code/memory
- Gemini CLI context files docs: https://google-gemini.github.io/gemini-cli/docs/cli/gemini-md.html
- OpenCode rules docs: https://dev.opencode.ai/docs/rules/
- Cursor rules docs: https://docs.cursor.com/context/rules

## Approaches Considered

### Option A: Reuse workspace file APIs with relative paths

Treat each system file as if it were a workspace file and pass a path like `../../.codex/AGENTS.md`.

Pros:

- Very small frontend change.

Cons:

- Breaks the existing path safety model.
- Encourages future features to bypass workspace root.
- Would make a security-sensitive exception inside a general-purpose file API.

Decision: reject.

### Option B: Add a general external file manager

Create a general API that can read/write files outside the workspace, then use it for Agent system files.

Pros:

- Flexible for future system-level config editing.

Cons:

- Much larger product and security surface.
- Needs permissions, browsing, path validation, audit UI, and likely OS-specific handling.
- Overbuilds this request.

Decision: reject for this feature.

### Option C: Add provider allowlist system Agent instructions APIs

Create dedicated commands for system Agent instruction files. The frontend passes only `providerId`; the backend maps that provider to a fixed path.

Pros:

- Meets direct edit/save requirement.
- Keeps existing workspace file API strict.
- Simple to test because the path matrix is finite.
- Handles unsupported providers honestly.

Cons:

- Requires editor load/save to understand a small virtual path scheme.
- Custom providers need a later extension point.

Decision: accept.

## Final Design

### 1. Provider Matrix

一期系统 Agent 文件 allowlist:

| Provider | Display | File | Editable |
| --- | --- | --- | --- |
| `codex` | Codex | `~/.codex/AGENTS.md` | yes |
| `claude` | Claude Code | `~/.claude/CLAUDE.md` | yes |
| `gemini` | Gemini CLI | `~/.gemini/GEMINI.md` | yes |
| `opencode` | OpenCode | `~/.config/opencode/AGENTS.md` | yes |
| `cursor` | Cursor Agent | Cursor Settings > Rules | no |

The backend must derive paths with `os.homedir()` and path joining. The frontend never sends these absolute paths for read/write.

### 2. UI Structure

The current `AgentInstructionsSection` becomes a higher-level Agent instructions panel with two groups.

Group 1: `项目 Agent.md`

- Uses the existing `.coder-studio/agent.md` status, generate, regenerate, and edit flow.
- Existing behavior stays intact.
- Copy changes from generic `agent.md` to project-specific wording.

Group 2: `系统 Agent.md`

- Loads provider list/status from a new system status command.
- Renders one row per built-in provider.
- Editable rows show provider display name, resolved user-facing path, existence state, and an edit action.
- Unsupported rows show provider display name, reason, and no edit action.
- Cursor row copy should say it is managed through Cursor Settings > Rules.

Suggested row states:

- `Ready`: file exists and can be edited.
- `Missing`: file does not exist; clicking edit will create scaffold.
- `Unsupported`: provider has no stable file path.
- `Error`: status/read/write failed.

### 3. Editor Integration

System files open in the existing editor with virtual paths:

- `agent-system:codex`
- `agent-system:claude`
- `agent-system:gemini`
- `agent-system:opencode`

The display label should show the real user-facing path, for example `~/.codex/AGENTS.md`, while internal editor state keeps the virtual path as the stable key.

Editor read/write routing:

- If active path starts with `agent-system:`, `useCodeEditorActions.loadFile` calls `agentInstructions.system.read`.
- `handleSave` calls `agentInstructions.system.write`.
- Refresh reconciliation for these paths calls the same system read command.
- Monaco model path can use the virtual path. No LSP should attach to these files.

The returned payload should stay compatible with text file handling:

```ts
type SystemAgentInstructionsReadResult = {
  kind: "text";
  providerId: string;
  path: string;
  displayPath: string;
  exists: boolean;
  content: string;
  baseHash: string;
  encoding: "utf-8";
};
```

The write command returns:

```ts
type SystemAgentInstructionsWriteResult = {
  providerId: string;
  path: string;
  displayPath: string;
  newHash: string;
};
```

### 4. Backend Commands

Add commands under the existing `agentInstructions` namespace:

- `agentInstructions.system.status`
- `agentInstructions.system.read`
- `agentInstructions.system.write`

`status` input:

```ts
{
  workspaceId: string;
}
```

`read` input:

```ts
{
  workspaceId: string;
  providerId: string;
}
```

`write` input:

```ts
{
  workspaceId: string;
  providerId: string;
  content: string;
  baseHash?: string;
}
```

`workspaceId` is kept for command scoping and client consistency, but the file path does not depend on workspace root.

Implementation details:

- Create a small resolver that returns system instruction metadata by provider id.
- Only built-in provider ids in the allowlist can resolve to editable files.
- Unsupported providers return structured metadata from status and throw `agent_system_instructions_unsupported` on read/write.
- `read` returns empty content and `exists: false` when the file is missing.
- `write` creates parent directories and writes the file.
- `write` checks `baseHash` against current file content when provided and throws `conflict` on mismatch.
- Commands should not emit workspace `fs.dirty`, because these files are outside the workspace tree.

### 5. Scaffold Content

When a supported system file is missing and the user clicks edit, the frontend can either call write first with scaffold content or let read return a scaffold candidate. Keep the implementation consistent with the existing project Agent edit flow by writing scaffold first.

Suggested scaffold:

```md
# Agent Instructions

## Personal Defaults
- Add preferences this agent should follow across your projects.

## Working Style
- Add communication, testing, review, or safety expectations.
```

Provider-specific heading can be added later.一期不需要不同 provider 生成不同 scaffold。

### 6. State And Persistence

Reuse existing workspace UI state for the project group expansion.

Add one optional UI state field for system group expansion:

```ts
agentSystemInstructionsExpanded?: boolean;
```

If this feels too wide for一期, keep the system group always expanded. The preferred implementation adds the field because the current panel already persists expansion for project Agent.md.

### 7. Error Handling

Expected errors:

- `workspace_not_found`: command called without an active workspace.
- `agent_system_instructions_unsupported`: provider has no editable global file.
- `agent_system_instructions_unknown_provider`: provider is not in the built-in matrix.
- `conflict`: file changed since it was opened.
- filesystem permission errors: show the OS error message in the panel/editor save error.

The UI should not hide unsupported providers. Listing them makes the support boundary clear.

### 8. Testing

Server tests:

- Status lists editable Codex, Claude, Gemini, OpenCode and unsupported Cursor.
- Read returns `exists: false` for missing editable file.
- Write creates parent directories and file.
- Write returns conflict when baseHash is stale.
- Unsupported provider read/write returns typed error.
- Unknown provider read/write returns typed error.
- Commands do not touch workspace file API or emit workspace dirty events.

Web tests:

- Agent panel title changes to `项目 Agent.md`.
- System group renders provider rows and unsupported Cursor row.
- Clicking edit on a missing system file writes scaffold then opens virtual path.
- Clicking edit on an existing system file opens virtual path without scaffold write.
- Editor loads `agent-system:codex` through system read.
- Saving `agent-system:codex` calls system write with provider id and baseHash.
- Existing project Agent generation/regeneration tests continue passing after copy changes.

Manual verification:

- Open Agent panel in desktop workspace and edit Codex global instructions.
- Save and confirm `~/.codex/AGENTS.md` changes on disk.
- Repeat for missing-file creation using a temporary HOME in tests where possible.
- Check mobile file/explorer surface still renders without layout overflow.

## Rollout Notes

This feature changes a personal global Agent configuration file. It should be clear in UI copy that system Agent.md applies across projects for that local user, unlike project Agent.md.

If a user edits Codex `~/.codex/AGENTS.md`, active Codex sessions may not reload it until a new session starts. The UI should avoid promising live reload behavior.

## Open Questions

- Should custom providers later be able to declare a global instructions file path?一期 leaves this out for safety.
- Should Codex also expose `~/.codex/AGENTS.override.md`?一期 edits only `AGENTS.md` to avoid accidentally creating a higher-precedence override.
