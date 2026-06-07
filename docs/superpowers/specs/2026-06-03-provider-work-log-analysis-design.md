# Provider Work Log Analysis Design

Date: 2026-06-03
Status: Draft
Owner: spencer

## Problem

`工作分析` 当前把 Coder Studio 自己管理的 session 当成分析数据源。这和用户期望不一致：工作分析应该分析选中 workspace 在各个 agent/provider 自己历史日志中的实际工作记录，而不是当前打开或曾由 Coder Studio 管理的会话。

当前实现直接依赖 Coder Studio session：

- [`packages/server/src/work-analysis/session-selector.ts`](../../../packages/server/src/work-analysis/session-selector.ts) 调用 `sessionMgr.getAll()`。
- [`packages/server/src/work-analysis/evidence-collector.ts`](../../../packages/server/src/work-analysis/evidence-collector.ts) 从 Coder Studio session 读取 terminal snapshot 和 latest user input。
- [`packages/server/src/work-analysis/service.ts`](../../../packages/server/src/work-analysis/service.ts) 会复用已成功的分析结果，导致 preset 时间范围和新增 provider 日志可能不刷新。

这会导致两个明显错误：

- 已关闭或不在 Coder Studio 中打开的 provider 历史不会被统计。
- `最近 7 天` 等查询可能显示少量 session，实际 provider 日志中已有更多记录。

## Goals

- 工作分析的数据源改为 provider 自己的本地日志、缓存或数据库。
- 覆盖所有 5 个内置 provider：`claude`、`codex`、`gemini`、`cursor`、`opencode`。
- 按用户选中的 workspace path 和时间范围筛选 provider 历史。
- 将不同 provider 的记录归一化为统一的 `WorkLogSession`。
- 基础分析只聚合归一化 summary，保持快速、稳定。
- 深入分析只使用受限、抽样、脱敏倾向的 evidence，不把整份日志交给 headless agent。
- UI 明确展示每个 provider 的数据源状态和数据质量。
- 保留分析结果记录用于展示上次结果，但用户重新运行分析时必须重新扫描 provider 数据源。

## Non-Goals

- 不让 Coder Studio 修改或迁移 provider 的原始日志。
- 不把 provider 历史导入为 Coder Studio session。
- 不在 v1 中实现长期索引服务或后台定时扫描。
- 不保证不同 provider 的所有指标完全对称。
- 不把全部对话正文作为默认分析输入。
- 不扩展到自定义 provider；自定义 provider 可以后续通过同一接口接入。

## User Decisions Captured

- 工作分析和 Coder Studio session 没有业务关系。
- 应该去具体 agent 的日志缓存中找和选中 workspace 相关的日志。
- 不同 agent 有不同的会话日志缓存，先找到日志，再做提取、聚合、呈现。
- 内置 provider 是 5 个，方案不能只覆盖 Codex 和 Claude。
- 缓存指分析结果记录，不是 provider 原始日志；分析结果可以保留，但不能阻止重新分析。

## Current State

### Provider Registry

内置 provider 在 [`packages/providers/src/registry.ts`](../../../packages/providers/src/registry.ts) 中固定声明：

- `claude`
- `codex`
- `gemini`
- `cursor`
- `opencode`

因此工作分析应从 registry 派生内置 provider 范围，不能硬编码只处理部分 provider。

### Work Analysis Service

当前 `WorkAnalysisService` 依赖两类 session-based 输入：

- `sessionSelector`: 选择 Coder Studio session summary。
- `evidenceCollector`: 读取 Coder Studio session 的 terminal snapshot、latest input 和 workspace path。

这两个依赖都需要替换为 provider-log based 输入。

### Result Persistence

`WorkAnalysisRepo` 保存的是 `WorkAnalysisRecord`，也就是分析结果记录。它不是 provider 日志缓存。

当前 `runBasic` 如果发现同 query digest 的记录已经 `succeeded`，会直接返回旧记录。这对手动重新分析不合适，因为 provider 日志可能已经变化，preset 时间范围也会随时间滑动。

## Provider Log Findings

### Codex

- Root: `~/.codex/sessions/YYYY/MM/DD/*.jsonl`
- Workspace match: first metadata record `payload.cwd`
- Session id: `payload.id`
- Time: `timestamp` or `payload.timestamp`, with file mtime as fallback
- Useful fields:
  - `payload.model_provider`
  - `payload.git.branch`
  - `payload.git.commit_hash`
  - `payload.git.repository_url`
  - message/event records for turn and tool counts
- Risk: low. JSONL metadata has direct workspace path.

### Claude

- Root: `~/.claude/projects/<encoded-workspace-path>/*.jsonl`
- Workspace match: encoded project directory plus record `cwd`
- Session id: `sessionId`
- Time: record `timestamp`
- Useful fields:
  - `cwd`
  - `gitBranch`
  - message roles
  - tool/hook attachment metadata
- Risk: low. Workspace path and timestamps are present in records.

### Gemini

- Roots:
  - `~/.gemini/tmp/<project>/chats/session-*.json`
  - `~/.gemini/history/<project>` for historical compatibility when available
- Workspace match: `~/.gemini/tmp/<project>/.project_root` and matching history `.project_root`
- Session id: chat JSON `sessionId`
- Time: `startTime`, `lastUpdated`
- Useful fields:
  - `kind`
  - `projectHash`
  - `summary`
  - `messages[].type`
  - `messages[].timestamp`
  - message content type
- Risk: medium. Project directory names are not enough; `.project_root` must be authoritative.

### Cursor

- Primary root: `~/.cursor/projects/<encoded-workspace-path>/agent-transcripts/<uuid>/*.jsonl`
- Secondary root for future enhancement: `~/.cursor/chats/<md5(workspace-path)>/<uuid>/store.db`
- Workspace match:
  - primary: encoded workspace project directory
  - secondary: md5 of absolute workspace path
- Session id: transcript uuid
- Time:
  - v1: transcript file mtime fallback
  - future: DB metadata if stable fields are confirmed
- Useful fields:
  - JSONL `role`
  - `message.content[].type`
  - tool-like content entries
  - `~/.cursor/ai-tracking/ai-code-tracking.db` can support future code contribution signals
- Risk: medium-high. Agent transcript JSONL may not include explicit timestamps, so v1 must report mtime fallback data quality.

### OpenCode

- Root: `~/.local/share/opencode/opencode.db`
- Workspace match:
  - `project.worktree`
  - `session.directory`
- Session id: `session.id`
- Time:
  - `session.time_created`
  - `session.time_updated`
  - message and part timestamps for detail
- Useful tables:
  - `project`
  - `session`
  - `message`
  - `part`
  - `todo`
  - `session_diff`
- Useful fields:
  - `session.title`
  - `session.version`
  - `summary_files`
  - `summary_additions`
  - `summary_deletions`
  - message and part counts
- Risk: medium. SQLite schema is strong locally, but provider is marked experimental in Coder Studio.

## Approaches Considered

### Option A: Patch Current Session Selector

Keep `WorkAnalysisService` mostly unchanged and teach `session-selector.ts` to merge Coder Studio session records with provider logs.

Pros:

- Smallest diff.
- Existing basic analyzer changes little.

Cons:

- Keeps the wrong mental model: provider logs are not Coder Studio sessions.
- Makes evidence collection ambiguous.
- UI would still imply current/open sessions.
- Hard to represent provider data quality.

### Option B: Provider Log Adapters + Normalized Collector (Recommended)

Replace session selection and evidence collection with provider-specific adapters that return normalized work log sessions.

Pros:

- Matches the required product semantics.
- Keeps provider-specific parsing isolated.
- Makes all 5 built-in providers first-class.
- Enables clear data quality status per provider.
- Allows basic and deep analysis to share one normalized source.

Cons:

- Requires new adapters and fixtures.
- Some providers have weaker timestamp guarantees.
- Existing tests around session selector/evidence collector must be replaced.

### Option C: Persistent Work Log Index

Build a background indexing service that continuously scans provider logs and stores a normalized local index.

Pros:

- Fast queries after indexing.
- Enables historical trends and freshness detection.

Cons:

- Too large for this correction.
- Adds background scanning and invalidation complexity.
- Raises more privacy and storage questions.

## Final Choice

Use Option B.

Implement a provider-log based collector with one adapter per built-in provider. The collector scans on demand when the user runs analysis. Results are normalized into `WorkLogSession[]`, then passed to basic aggregation and deep evidence sampling.

Persisted `WorkAnalysisRecord` remains useful for showing the last result, but it no longer short-circuits explicit `runBasic` or `runDeep`.

## Architecture

### New Source Interface

Create a provider log source interface in the server work-analysis domain:

```ts
export interface ProviderWorkLogSource {
  providerId: BuiltInProviderId;

  discover(input: ProviderWorkLogDiscoverInput): Promise<ProviderWorkLogDiscovery>;
}

export interface ProviderWorkLogDiscoverInput {
  workspacePaths: string[];
  timeRange: ResolvedWorkAnalysisTimeRange;
}

export interface ProviderWorkLogDiscovery {
  providerId: BuiltInProviderId;
  status: WorkLogProviderStatus;
  sessions: WorkLogSession[];
  sourceRefs: WorkLogSourceRef[];
  parseErrorCount: number;
  warnings: WorkLogWarning[];
}
```

### Normalized Session

```ts
export interface WorkLogSession {
  providerId: BuiltInProviderId;
  sessionId: string;
  workspacePath: string;
  startedAt: number;
  lastActiveAt: number;
  sourceRef: string;
  title?: string;
  modelId?: string;
  gitBranch?: string;
  gitCommit?: string;
  userTurnCount: number;
  assistantTurnCount: number;
  toolUseCount: number;
  parseErrorCount: number;
  timestampQuality: "explicit" | "file_mtime" | "mixed";
  evidence?: WorkLogEvidence[];
}
```

### Source References

```ts
export interface WorkLogSourceRef {
  providerId: BuiltInProviderId;
  kind: "file" | "sqlite";
  path: string;
  mtimeMs?: number;
  sizeBytes?: number;
  maxUpdatedAt?: number;
}
```

`WorkLogSourceRef` supports result freshness diagnostics and future automatic invalidation.

### Provider Status

```ts
export type WorkLogProviderStatus =
  | "supported"
  | "no_logs"
  | "missing_root"
  | "partial"
  | "unsupported";
```

Meaning:

- `supported`: adapter ran and returned zero or more valid sessions without material parse failures.
- `no_logs`: log root exists, but no sessions matched selected workspace/time range.
- `missing_root`: provider log root is not present on disk.
- `partial`: some sessions were parsed, but some files/records failed.
- `unsupported`: built-in provider exists, but this adapter intentionally has no v1 reader.

For this design, all 5 built-in providers should have v1 adapters. `unsupported` remains for forward compatibility and custom providers.

### Collector

Create `WorkLogCollector`:

```ts
export interface WorkLogCollector {
  collect(input: {
    workspacePaths: string[];
    timeRange: ResolvedWorkAnalysisTimeRange;
  }): Promise<WorkLogCollection>;
}

export interface WorkLogCollection {
  sessions: WorkLogSession[];
  providers: ProviderWorkLogDiscovery[];
  sourceDigest: string;
}
```

The collector:

- Runs all built-in provider adapters.
- Sorts sessions by `lastActiveAt`, then `providerId`, then `sessionId`.
- Computes `sourceDigest` from provider id, source ref path, mtime, size, max updated time, and matched session ids.
- Keeps provider warnings for UI display.

## Basic Analysis Design

Basic analysis should consume `WorkLogSession[]` instead of Coder Studio session summaries.

Existing fields can mostly remain:

- `coverage.workspaceCount`
- `coverage.sessionCount`
- `coverage.providerCount`
- `activity.sessionCount`
- `activity.totalDurationMs`
- `activity.averageDurationMs`
- `workHabits.hourBuckets`
- `usage.totalSessions`
- `usage.sessionsByProvider`
- `agentModelMix.providers`
- `dataQuality.clampedDurationCount`
- `dataQuality.emptySessionCount`

Add provider log data quality:

```ts
dataSources: {
  providers: Array<{
    providerId: BuiltInProviderId;
    status: WorkLogProviderStatus;
    sessionCount: number;
    parseErrorCount: number;
    warningCount: number;
  }>;
};
```

Add execution-like signals from logs:

```ts
executionSignals: {
  sessionsWithActivity: number;
  userTurnCount: number;
  assistantTurnCount: number;
  toolUseCount: number;
  fileMtimeTimestampCount: number;
};
```

The previous `skillInventory` section can stay because it is Coder Studio skill inventory, not provider session data. Its label should make clear it is local Coder Studio skill inventory.

## Deep Analysis Design

Deep analysis should use sampled provider-log evidence, not terminal snapshots.

### Evidence Shape

```ts
export interface WorkLogEvidence {
  providerId: BuiltInProviderId;
  sessionId: string;
  workspacePath: string;
  title?: string;
  startedAt: number;
  lastActiveAt: number;
  excerpts: Array<{
    role: "user" | "assistant" | "tool" | "system" | "unknown";
    at?: number;
    text?: string;
    toolName?: string;
    commandKind?: string;
    filePath?: string;
  }>;
}
```

### Sampling Rules

- Cap total sessions included in deep evidence.
- Cap sessions per provider so one provider cannot dominate.
- Cap excerpts per session.
- Cap excerpt text length.
- Prefer recent sessions, sessions with tool activity, and sessions with explicit timestamps.
- Include provider and session metadata even when textual evidence is sparse.
- Exclude binary blobs, raw DB blobs, OAuth/account files, and provider config secrets.

### Headless Provider Selection

The provider used to run deep analysis should not be selected by "most sessions found". That was only a side effect of the old session-based model.

Use a dedicated selection policy:

1. Prefer the user's configured default analysis provider if it supports `session_analysis` headless and is runtime-available.
2. Otherwise choose the first runtime-available built-in provider that supports `session_analysis`.
3. If no provider is available, basic analysis still succeeds and deep analysis fails with a typed provider-unavailable error.

## Result Record And Cache Behavior

`WorkAnalysisRecord` continues to store analysis results for display. It should also store source freshness metadata:

```ts
export interface WorkAnalysisSourceSnapshot {
  sourceDigest: string;
  providerStatuses: Array<{
    providerId: BuiltInProviderId;
    status: WorkLogProviderStatus;
    sessionCount: number;
    parseErrorCount: number;
  }>;
  collectedAt: number;
}
```

Behavior:

- `work.analysis.get` returns the last saved result for the query.
- `work.analysis.runBasic` always resolves the time range and rescans provider logs.
- `work.analysis.runDeep` always runs against the latest collected basic result and sampled evidence.
- A previous `succeeded` record must not short-circuit explicit runs.
- `sourceDigest` is saved for display and future freshness checks, but v1 does not need automatic background invalidation.

This keeps the useful "last result" behavior while preventing stale analysis from blocking new runs.

## UI Design

The current settings component can remain the entry surface, but labels and result sections need to shift from session wording to provider log wording.

Required UI changes:

- Describe the source as provider local logs/cache, not current sessions.
- Show one row per built-in provider:
  - provider name
  - status
  - matched session count
  - parse warning count
- Show when timestamps are based on file mtime fallback.
- For no data, say the selected provider has no matching local logs for the selected workspace/time range.
- For missing roots, say the provider log root was not found.
- For deep analysis, clarify that only sampled log evidence is used.

The UI should avoid implying that a workspace must have an open Coder Studio session.

## Privacy And Safety

Provider logs may contain user prompts, assistant responses, command outputs, file paths, and sometimes tool results. The implementation must treat them as local sensitive data.

Rules:

- Do not print raw prompts/responses to server logs.
- Do not send whole provider logs to deep analysis.
- Limit evidence size.
- Prefer metadata and short excerpts.
- Never parse credential/config files as analysis evidence.
- Avoid reading provider account files such as OAuth tokens.
- Keep raw provider log content out of persisted `WorkAnalysisRecord` except bounded evidence summaries needed for deep analysis results.

## Error Handling

Adapter errors should not fail the whole basic analysis unless every provider fails due to a shared system problem.

Per-provider outcomes:

- Missing root: report `missing_root`, no sessions.
- Root exists but no matches: report `no_logs`, no sessions.
- Some files fail: report `partial`, include parsed sessions and parse error count.
- SQLite read failure: report `partial` if some data was read, otherwise `missing_root` or `partial` with warning depending on file existence.
- Unknown record shape: skip the record, increment parse error count, keep scanning.

Deep analysis can fail independently without invalidating basic analysis.

## File And Module Plan

Expected new server modules:

- `packages/server/src/work-analysis/log-sources/types.ts`
- `packages/server/src/work-analysis/log-sources/collector.ts`
- `packages/server/src/work-analysis/log-sources/codex.ts`
- `packages/server/src/work-analysis/log-sources/claude.ts`
- `packages/server/src/work-analysis/log-sources/gemini.ts`
- `packages/server/src/work-analysis/log-sources/cursor.ts`
- `packages/server/src/work-analysis/log-sources/opencode.ts`
- `packages/server/src/work-analysis/log-sources/path-encoding.ts`
- `packages/server/src/work-analysis/evidence-sampler.ts`

Expected modified modules:

- `packages/server/src/work-analysis/service.ts`
- `packages/server/src/work-analysis/basic-analyzer.ts`
- `packages/server/src/work-analysis/basic-schema.ts`
- `packages/server/src/work-analysis/types.ts`
- `packages/server/src/work-analysis/deep-prompt.ts`
- `packages/server/src/work-analysis/query.ts`
- `packages/server/src/storage/repositories/work-analysis-repo.ts`
- `packages/server/src/commands/work-analysis.ts`
- `packages/web/src/features/settings/components/session-analysis-settings.tsx`
- `packages/web/src/features/work-analysis/types.ts`
- `docs/help/work-analysis.md`

Expected removed or retired modules:

- `packages/server/src/work-analysis/session-selector.ts`
- `packages/server/src/work-analysis/evidence-collector.ts`

They may remain temporarily during migration only if tests still cover old behavior, but the final behavior must not call Coder Studio session manager for work analysis data.

## Testing

### Adapter Tests

Use fixtures rather than the developer's real home directory.

Codex:

- Select sessions by metadata `payload.cwd`.
- Exclude sessions outside time range.
- Count user, assistant, and tool records.
- Preserve model and git metadata when present.

Claude:

- Select sessions from encoded workspace directory.
- Confirm `cwd` mismatch is excluded or flagged.
- Count messages by role.
- Handle parse errors without failing the whole adapter.

Gemini:

- Match workspace via `.project_root`.
- Read `sessionId`, `startTime`, `lastUpdated`, and messages.
- Include `summary` as optional title/evidence metadata.
- Ignore projects whose `.project_root` does not match.

Cursor:

- Match encoded workspace project directory.
- Use transcript uuid as session id.
- Use file mtime when explicit timestamps are absent.
- Report timestamp quality as `file_mtime`.
- Count role and tool-like content entries.

OpenCode:

- Build a temporary SQLite fixture with `project`, `session`, `message`, and `part`.
- Match by `project.worktree` and `session.directory`.
- Count messages and parts by session.
- Report summary diff fields when present.

### Collector Tests

- Runs all 5 adapters.
- Aggregates provider statuses.
- Sorts sessions deterministically.
- Produces stable `sourceDigest` for unchanged source refs.
- Changes `sourceDigest` when matched source mtime, size, updated time, or session ids change.

### Service Tests

- `runBasic` rescans even when an existing record is `succeeded`.
- `get` returns the last saved record without scanning.
- Basic analysis succeeds when one provider is `partial`.
- Deep analysis uses sampled provider evidence, not terminal snapshots.
- Deep analysis provider selection uses headless availability, not largest session count.

### UI Tests

- Provider status rows render for all 5 built-in providers.
- No-log and missing-root states have distinct messages.
- Session count is labeled as provider local log matches.
- Deep analysis button remains disabled until basic result exists.

### Docs Tests

- Help text no longer says an open agent session is required.
- Help text explains provider local logs and data-source limitations.

## Rollout

1. Introduce types, collector, and fixtures.
2. Implement provider adapters behind tests.
3. Replace service dependencies from session selector/evidence collector to work log collector/evidence sampler.
4. Update schemas and frontend types.
5. Update UI copy and provider status display.
6. Update help docs.
7. Retire old session selector and evidence collector tests.

## Acceptance Criteria

- Running `工作分析` for a selected workspace scans provider local logs for all 5 built-in providers.
- Recently closed or never-opened-in-Coder-Studio provider sessions can appear in analysis if their provider logs match the workspace and time range.
- Explicitly running basic analysis does not return an old successful result without scanning.
- Basic analysis reports provider data-source status.
- Deep analysis uses bounded provider-log evidence.
- The UI no longer implies that Coder Studio sessions are the source of truth.
