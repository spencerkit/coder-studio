# Provider Work Log Analysis Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild Work Analysis so it scans each built-in provider's local work logs for the selected workspace/time range instead of reading Coder Studio sessions.

**Architecture:** Add provider-specific log adapters under `packages/server/src/work-analysis/log-sources`, normalize their output into `WorkLogSession[]`, and feed that collection into the existing basic/deep analysis flow. Persist analysis results as last-run records only; explicit runs always rescan provider logs.

**Tech Stack:** TypeScript, Node filesystem APIs, `node:child_process` for injectable `sqlite3` CLI access, Zod, Vitest, React, Jotai, existing WebSocket command architecture

---

## Reference Spec

Read first:

- `docs/superpowers/specs/2026-06-03-provider-work-log-analysis-design.md`

Key behavioral constraints:

- Work analysis must not use `SessionManager` as the source of analyzed work activity.
- All 5 built-in providers are in scope: `claude`, `codex`, `gemini`, `cursor`, `opencode`.
- `work.analysis.get` may show the last saved result.
- `work.analysis.runBasic` and `work.analysis.runDeep` must rescan provider log sources.
- Deep analysis must use bounded sampled provider evidence, not terminal snapshots.

## File Structure

Create these focused server modules:

- `packages/server/src/work-analysis/log-sources/types.ts`
  - Shared provider-log types: `BuiltInProviderId`, `WorkLogSession`, `ProviderWorkLogSource`, `ProviderWorkLogDiscovery`, `WorkLogSourceRef`, status/warning/evidence types.
- `packages/server/src/work-analysis/log-sources/path-encoding.ts`
  - Helpers for home expansion, workspace path encoding, Cursor md5 workspace hash, JSONL iteration, safe timestamp parsing.
- `packages/server/src/work-analysis/log-sources/collector.ts`
  - Runs all provider adapters, sorts sessions, computes `sourceDigest`.
- `packages/server/src/work-analysis/log-sources/codex.ts`
  - Reads `~/.codex/sessions/YYYY/MM/DD/*.jsonl`.
- `packages/server/src/work-analysis/log-sources/claude.ts`
  - Reads `~/.claude/projects/<encoded-workspace>/*.jsonl`.
- `packages/server/src/work-analysis/log-sources/gemini.ts`
  - Reads `~/.gemini/tmp|history/<project>` using `.project_root`.
- `packages/server/src/work-analysis/log-sources/cursor.ts`
  - Reads `~/.cursor/projects/<encoded-workspace>/agent-transcripts`.
- `packages/server/src/work-analysis/log-sources/opencode.ts`
  - Reads `~/.local/share/opencode/opencode.db` through an injectable SQLite query runner.
- `packages/server/src/work-analysis/evidence-sampler.ts`
  - Converts normalized sessions to bounded `WorkAnalysisEvidence`.

Modify these existing modules:

- `packages/server/src/work-analysis/types.ts`
- `packages/server/src/work-analysis/basic-schema.ts`
- `packages/server/src/work-analysis/basic-analyzer.ts`
- `packages/server/src/work-analysis/service.ts`
- `packages/server/src/work-analysis/deep-prompt.ts`
- `packages/server/src/work-analysis/deep-runner.ts`
- `packages/server/src/storage/repositories/work-analysis-repo.ts`
- `packages/server/src/server.ts`
- `packages/web/src/features/work-analysis/types.ts`
- `packages/web/src/features/settings/components/session-analysis-settings.tsx`
- `packages/web/src/locales/en.json`
- `packages/web/src/locales/zh.json`
- `docs/help/work-analysis.md`

Retire these after the new service is wired:

- `packages/server/src/work-analysis/session-selector.ts`
- `packages/server/src/work-analysis/evidence-collector.ts`
- `packages/server/src/__tests__/work-analysis-session-selector.test.ts`
- `packages/server/src/__tests__/work-analysis-evidence-collector.test.ts`

---

### Task 1: Define Provider Log Types And Shared Helpers

**Files:**
- Create: `packages/server/src/work-analysis/log-sources/types.ts`
- Create: `packages/server/src/work-analysis/log-sources/path-encoding.ts`
- Test: `packages/server/src/__tests__/work-analysis-log-source-helpers.test.ts`

- [ ] **Step 1: Write the failing helper tests**

Create `packages/server/src/__tests__/work-analysis-log-source-helpers.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  buildCursorWorkspaceHash,
  encodeProviderWorkspacePath,
  parseOptionalTimestamp,
  safeJsonParse,
} from "../work-analysis/log-sources/path-encoding.js";

describe("work analysis log source helpers", () => {
  it("encodes absolute workspace paths for provider project directories", () => {
    expect(encodeProviderWorkspacePath("/home/spencer/workspace/coder-studio")).toBe(
      "-home-spencer-workspace-coder-studio"
    );
  });

  it("builds the Cursor md5 workspace hash from the absolute workspace path", () => {
    expect(buildCursorWorkspaceHash("/home/spencer/workspace/coder-studio")).toBe(
      "cf4c2089ed329fb5e3bba38e6a05f0bc"
    );
  });

  it("parses ISO and numeric timestamps and rejects invalid input", () => {
    expect(parseOptionalTimestamp("2026-06-03T00:00:00.000Z")).toBe(
      Date.parse("2026-06-03T00:00:00.000Z")
    );
    expect(parseOptionalTimestamp(1_770_000_000_000)).toBe(1_770_000_000_000);
    expect(parseOptionalTimestamp("not-a-date")).toBeUndefined();
  });

  it("parses JSON safely without throwing", () => {
    expect(safeJsonParse<{ ok: boolean }>("{\"ok\":true}")?.ok).toBe(true);
    expect(safeJsonParse("{bad json")).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run the helper test and verify it fails**

Run:

```bash
pnpm --filter @coder-studio/server exec vitest run src/__tests__/work-analysis-log-source-helpers.test.ts
```

Expected: FAIL because `log-sources/path-encoding.ts` does not exist.

- [ ] **Step 3: Add shared provider-log types**

Create `packages/server/src/work-analysis/log-sources/types.ts`:

```ts
import type { ProviderDefinition } from "@coder-studio/core";
import type { ResolvedWorkAnalysisTimeRange } from "../types.js";

export type BuiltInProviderId = ProviderDefinition["id"] & string;

export type WorkLogProviderStatus =
  | "supported"
  | "no_logs"
  | "missing_root"
  | "partial"
  | "unsupported";

export interface WorkLogWarning {
  code: string;
  message: string;
  sourceRef?: string;
}

export interface WorkLogEvidenceExcerpt {
  role: "user" | "assistant" | "tool" | "system" | "unknown";
  at?: number;
  text?: string;
  toolName?: string;
  commandKind?: string;
  filePath?: string;
}

export interface WorkLogEvidence {
  providerId: BuiltInProviderId;
  sessionId: string;
  workspacePath: string;
  title?: string;
  startedAt: number;
  lastActiveAt: number;
  excerpts: WorkLogEvidenceExcerpt[];
}

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

export interface WorkLogSourceRef {
  providerId: BuiltInProviderId;
  kind: "file" | "sqlite";
  path: string;
  mtimeMs?: number;
  sizeBytes?: number;
  maxUpdatedAt?: number;
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

export interface ProviderWorkLogSource {
  providerId: BuiltInProviderId;
  discover(input: ProviderWorkLogDiscoverInput): Promise<ProviderWorkLogDiscovery>;
}

export interface WorkLogCollection {
  sessions: WorkLogSession[];
  providers: ProviderWorkLogDiscovery[];
  sourceDigest: string;
}

export interface WorkLogCollector {
  collect(input: ProviderWorkLogDiscoverInput): Promise<WorkLogCollection>;
}
```

- [ ] **Step 4: Add shared helper functions**

Create `packages/server/src/work-analysis/log-sources/path-encoding.ts`:

```ts
import { createHash } from "node:crypto";
import { homedir } from "node:os";

export function resolveHomePath(path: string, home = homedir()): string {
  return path.startsWith("~/") ? `${home}/${path.slice(2)}` : path;
}

export function encodeProviderWorkspacePath(workspacePath: string): string {
  return workspacePath.replaceAll("/", "-").replaceAll("\\", "-");
}

export function buildCursorWorkspaceHash(workspacePath: string): string {
  return createHash("md5").update(workspacePath).digest("hex");
}

export function parseOptionalTimestamp(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value !== "string" || value.trim().length === 0) {
    return undefined;
  }

  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? undefined : parsed;
}

export function safeJsonParse<T = unknown>(text: string): T | undefined {
  try {
    return JSON.parse(text) as T;
  } catch {
    return undefined;
  }
}

export function isWithinRange(startedAt: number, lastActiveAt: number, range: {
  startAt: number;
  endAt: number;
}): boolean {
  return lastActiveAt >= range.startAt && startedAt <= range.endAt;
}
```

- [ ] **Step 5: Re-run the helper test and verify it passes**

Run:

```bash
pnpm --filter @coder-studio/server exec vitest run src/__tests__/work-analysis-log-source-helpers.test.ts
```

Expected: PASS

- [ ] **Step 6: Commit Task 1**

Run:

```bash
git add packages/server/src/work-analysis/log-sources/types.ts packages/server/src/work-analysis/log-sources/path-encoding.ts packages/server/src/__tests__/work-analysis-log-source-helpers.test.ts
git commit -m "feat: add work analysis log source types"
```

---

### Task 2: Implement Codex, Claude, Gemini, And Cursor File Adapters

**Files:**
- Create: `packages/server/src/work-analysis/log-sources/codex.ts`
- Create: `packages/server/src/work-analysis/log-sources/claude.ts`
- Create: `packages/server/src/work-analysis/log-sources/gemini.ts`
- Create: `packages/server/src/work-analysis/log-sources/cursor.ts`
- Test: `packages/server/src/__tests__/work-analysis-log-sources-file-adapters.test.ts`

- [ ] **Step 1: Write fixture-building tests for file adapters**

Create `packages/server/src/__tests__/work-analysis-log-sources-file-adapters.test.ts` with temp-home fixtures:

```ts
import { mkdirSync, writeFileSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createClaudeWorkLogSource } from "../work-analysis/log-sources/claude.js";
import { createCodexWorkLogSource } from "../work-analysis/log-sources/codex.js";
import { createCursorWorkLogSource } from "../work-analysis/log-sources/cursor.js";
import { createGeminiWorkLogSource } from "../work-analysis/log-sources/gemini.js";

async function makeHome() {
  return await mkdtemp(join(tmpdir(), "work-log-home-"));
}

describe("file provider work log sources", () => {
  it("reads Codex sessions by metadata cwd and time range", async () => {
    const home = await makeHome();
    const dir = join(home, ".codex/sessions/2026/06/03");
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, "session.jsonl"),
      [
        JSON.stringify({
          timestamp: "2026-06-03T01:00:00.000Z",
          type: "session_meta",
          payload: {
            id: "codex-session-1",
            cwd: "/repo/app",
            model_provider: "openai",
            git: { branch: "main", commit_hash: "abc123" },
          },
        }),
        JSON.stringify({ type: "user_message", payload: { text: "fix tests" } }),
        JSON.stringify({ type: "agent_message", payload: { text: "done" } }),
        JSON.stringify({ type: "tool_call", payload: { name: "shell" } }),
      ].join("\n")
    );

    const result = await createCodexWorkLogSource({ home }).discover({
      workspacePaths: ["/repo/app"],
      timeRange: {
        startAt: Date.parse("2026-06-03T00:00:00.000Z"),
        endAt: Date.parse("2026-06-04T00:00:00.000Z"),
        label: "custom",
      },
    });

    expect(result.status).toBe("supported");
    expect(result.sessions).toHaveLength(1);
    expect(result.sessions[0]).toMatchObject({
      providerId: "codex",
      sessionId: "codex-session-1",
      workspacePath: "/repo/app",
      userTurnCount: 1,
      assistantTurnCount: 1,
      toolUseCount: 1,
      gitBranch: "main",
      gitCommit: "abc123",
    });
  });

  it("reads Claude sessions from encoded workspace project logs", async () => {
    const home = await makeHome();
    const dir = join(home, ".claude/projects/-repo-app");
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, "claude.jsonl"),
      [
        JSON.stringify({
          type: "user",
          timestamp: "2026-06-03T02:00:00.000Z",
          sessionId: "claude-session-1",
          cwd: "/repo/app",
          gitBranch: "feature",
        }),
        JSON.stringify({
          type: "assistant",
          timestamp: "2026-06-03T02:05:00.000Z",
          sessionId: "claude-session-1",
          cwd: "/repo/app",
        }),
      ].join("\n")
    );

    const result = await createClaudeWorkLogSource({ home }).discover({
      workspacePaths: ["/repo/app"],
      timeRange: {
        startAt: Date.parse("2026-06-03T00:00:00.000Z"),
        endAt: Date.parse("2026-06-04T00:00:00.000Z"),
        label: "custom",
      },
    });

    expect(result.sessions[0]).toMatchObject({
      providerId: "claude",
      sessionId: "claude-session-1",
      workspacePath: "/repo/app",
      userTurnCount: 1,
      assistantTurnCount: 1,
      gitBranch: "feature",
    });
  });

  it("reads Gemini chats by .project_root", async () => {
    const home = await makeHome();
    const dir = join(home, ".gemini/tmp/app");
    mkdirSync(join(dir, "chats"), { recursive: true });
    writeFileSync(join(dir, ".project_root"), "/repo/app");
    writeFileSync(
      join(dir, "chats/session-2026-06-03T01-00-abcd.json"),
      JSON.stringify({
        kind: "chat",
        sessionId: "gemini-session-1",
        startTime: "2026-06-03T03:00:00.000Z",
        lastUpdated: "2026-06-03T03:10:00.000Z",
        summary: "Fix tests",
        messages: [
          { type: "user", timestamp: "2026-06-03T03:00:00.000Z", content: [{ text: "fix" }] },
          {
            type: "assistant",
            timestamp: "2026-06-03T03:10:00.000Z",
            content: [{ text: "done" }],
          },
        ],
      })
    );

    const result = await createGeminiWorkLogSource({ home }).discover({
      workspacePaths: ["/repo/app"],
      timeRange: {
        startAt: Date.parse("2026-06-03T00:00:00.000Z"),
        endAt: Date.parse("2026-06-04T00:00:00.000Z"),
        label: "custom",
      },
    });

    expect(result.sessions[0]).toMatchObject({
      providerId: "gemini",
      sessionId: "gemini-session-1",
      title: "Fix tests",
      userTurnCount: 1,
      assistantTurnCount: 1,
    });
  });

  it("reads Cursor transcripts by encoded workspace and reports mtime timestamp quality", async () => {
    const home = await makeHome();
    const dir = join(
      home,
      ".cursor/projects/-repo-app/agent-transcripts/cursor-session-1"
    );
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, "cursor-session-1.jsonl"),
      [
        JSON.stringify({ role: "user", message: { content: [{ type: "text", text: "fix" }] } }),
        JSON.stringify({
          role: "assistant",
          message: { content: [{ type: "tool_call", name: "shell" }] },
        }),
      ].join("\n")
    );

    const result = await createCursorWorkLogSource({ home }).discover({
      workspacePaths: ["/repo/app"],
      timeRange: { startAt: 0, endAt: Date.now() + 60_000, label: "custom" },
    });

    expect(result.sessions[0]).toMatchObject({
      providerId: "cursor",
      sessionId: "cursor-session-1",
      workspacePath: "/repo/app",
      timestampQuality: "file_mtime",
      userTurnCount: 1,
      assistantTurnCount: 1,
      toolUseCount: 1,
    });
  });
});
```

- [ ] **Step 2: Run the file adapter tests and verify they fail**

Run:

```bash
pnpm --filter @coder-studio/server exec vitest run src/__tests__/work-analysis-log-sources-file-adapters.test.ts
```

Expected: FAIL because the adapter modules do not exist.

- [ ] **Step 3: Implement the Codex adapter**

Create `packages/server/src/work-analysis/log-sources/codex.ts` with this API:

```ts
export function createCodexWorkLogSource(options: { home?: string } = {}): ProviderWorkLogSource
```

Implementation requirements:

- Scan `join(home, ".codex/sessions")` recursively for `.jsonl`.
- If the root is missing, return `missing_root`.
- Parse first valid JSON line for metadata.
- Match `payload.cwd` or `cwd` against `workspacePaths`.
- Count user records when `type` or role includes `user`.
- Count assistant records when `type` or role includes `assistant` or `agent_message`.
- Count tool records when `type` or payload contains a tool-like event.
- Use explicit timestamp when available; otherwise file mtime.
- Return `partial` when any matched file has parse errors.

- [ ] **Step 4: Implement the Claude adapter**

Create `packages/server/src/work-analysis/log-sources/claude.ts` with this API:

```ts
export function createClaudeWorkLogSource(options: { home?: string } = {}): ProviderWorkLogSource
```

Implementation requirements:

- For each workspace path, scan `~/.claude/projects/${encodeProviderWorkspacePath(path)}`.
- Match records whose `cwd` equals the workspace path when `cwd` is present.
- Group lines by `sessionId`; if no `sessionId`, use the file basename.
- Use min/max explicit timestamps for start/end.
- Count roles from `type`, `role`, and `message.role`.
- Treat records with `toolUse` or attachment/tool fields as tool activity.

- [ ] **Step 5: Implement the Gemini adapter**

Create `packages/server/src/work-analysis/log-sources/gemini.ts` with this API:

```ts
export function createGeminiWorkLogSource(options: { home?: string } = {}): ProviderWorkLogSource
```

Implementation requirements:

- Scan both `~/.gemini/tmp` and `~/.gemini/history`.
- Only read project directories whose `.project_root` exactly matches a selected workspace path.
- Read `chats/*.json`.
- Use `sessionId`, `startTime`, `lastUpdated`, `summary`, and `messages`.
- Count `messages[].type` values.
- Include short evidence excerpts from `messages[].content[].text` when present.

- [ ] **Step 6: Implement the Cursor adapter**

Create `packages/server/src/work-analysis/log-sources/cursor.ts` with this API:

```ts
export function createCursorWorkLogSource(options: { home?: string } = {}): ProviderWorkLogSource
```

Implementation requirements:

- For each workspace path, scan `~/.cursor/projects/${encodeProviderWorkspacePath(path)}/agent-transcripts`.
- Read `*/<uuid>.jsonl`.
- Use transcript directory/file name as `sessionId`.
- Use file mtime for `startedAt` and `lastActiveAt`.
- Set `timestampQuality: "file_mtime"`.
- Count `role === "user"` and `role === "assistant"`.
- Count tool usage when content type/name includes `tool`, `command`, or `function`.

- [ ] **Step 7: Re-run the file adapter tests and verify they pass**

Run:

```bash
pnpm --filter @coder-studio/server exec vitest run src/__tests__/work-analysis-log-sources-file-adapters.test.ts
```

Expected: PASS

- [ ] **Step 8: Commit Task 2**

Run:

```bash
git add packages/server/src/work-analysis/log-sources/codex.ts packages/server/src/work-analysis/log-sources/claude.ts packages/server/src/work-analysis/log-sources/gemini.ts packages/server/src/work-analysis/log-sources/cursor.ts packages/server/src/__tests__/work-analysis-log-sources-file-adapters.test.ts
git commit -m "feat: read provider work logs from file sources"
```

---

### Task 3: Implement The OpenCode SQLite Adapter

**Files:**
- Create: `packages/server/src/work-analysis/log-sources/opencode.ts`
- Test: `packages/server/src/__tests__/work-analysis-log-source-opencode.test.ts`

- [ ] **Step 1: Write the failing OpenCode adapter test**

Create `packages/server/src/__tests__/work-analysis-log-source-opencode.test.ts`:

```ts
import { execFileSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createOpenCodeWorkLogSource } from "../work-analysis/log-sources/opencode.js";

async function createDbFixture() {
  const home = await mkdtemp(join(tmpdir(), "opencode-home-"));
  const dir = join(home, ".local/share/opencode");
  mkdirSync(dir, { recursive: true });
  const dbPath = join(dir, "opencode.db");
  execFileSync("sqlite3", [
    dbPath,
    `
    create table project (
      id text primary key,
      worktree text not null,
      time_created integer not null,
      time_updated integer not null
    );
    create table session (
      id text primary key,
      project_id text not null,
      directory text not null,
      title text not null,
      version text not null,
      summary_files integer,
      summary_additions integer,
      summary_deletions integer,
      time_created integer not null,
      time_updated integer not null
    );
    create table message (
      id text primary key,
      session_id text not null,
      time_created integer not null,
      time_updated integer not null,
      data text not null
    );
    create table part (
      id text primary key,
      message_id text not null,
      session_id text not null,
      time_created integer not null,
      time_updated integer not null,
      data text not null
    );
    insert into project values ('proj-1', '/repo/app', 1000, 3000);
    insert into session values ('ses-1', 'proj-1', '/repo/app', 'Fix tests', '1.2.15', 2, 10, 1, 1000, 3000);
    insert into message values ('msg-1', 'ses-1', 1000, 1000, '{"role":"user","text":"fix"}');
    insert into message values ('msg-2', 'ses-1', 2000, 3000, '{"role":"assistant","text":"done"}');
    insert into part values ('part-1', 'msg-2', 'ses-1', 2500, 2500, '{"type":"tool","tool":"bash"}');
    `,
  ]);
  return home;
}

describe("OpenCode work log source", () => {
  it("reads sessions from the OpenCode SQLite database by workspace path", async () => {
    const home = await createDbFixture();

    const result = await createOpenCodeWorkLogSource({ home }).discover({
      workspacePaths: ["/repo/app"],
      timeRange: { startAt: 0, endAt: 5_000, label: "custom" },
    });

    expect(result.status).toBe("supported");
    expect(result.sessions).toHaveLength(1);
    expect(result.sessions[0]).toMatchObject({
      providerId: "opencode",
      sessionId: "ses-1",
      workspacePath: "/repo/app",
      title: "Fix tests",
      userTurnCount: 1,
      assistantTurnCount: 1,
      toolUseCount: 1,
      timestampQuality: "explicit",
    });
    expect(result.sourceRefs[0]).toMatchObject({
      providerId: "opencode",
      kind: "sqlite",
    });
  });
});
```

- [ ] **Step 2: Run the OpenCode test and verify it fails**

Run:

```bash
pnpm --filter @coder-studio/server exec vitest run src/__tests__/work-analysis-log-source-opencode.test.ts
```

Expected: FAIL because `opencode.ts` does not exist.

- [ ] **Step 3: Implement an injectable SQLite query runner**

Create `packages/server/src/work-analysis/log-sources/opencode.ts` with:

```ts
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export type OpenCodeSqliteRunner = (dbPath: string, sql: string) => Promise<string>;

export async function runSqliteJsonQuery(dbPath: string, sql: string): Promise<string> {
  const { stdout } = await execFileAsync("sqlite3", ["-json", dbPath, sql], {
    windowsHide: true,
    maxBuffer: 10 * 1024 * 1024,
  });
  return stdout;
}
```

Testing/runtime notes:

- In adapter tests, gate the real `sqlite3` fixture with `if (!hasSqlite3())` and `it.skip(...)` when the CLI is unavailable.
- Add a small `hasSqlite3()` helper that probes `execFileSync("sqlite3", ["-version"])`.
- In production code, catch `ENOENT` from `sqlite3` launch and return provider status `unsupported` with a warning that the SQLite CLI is unavailable.

- [ ] **Step 4: Implement `createOpenCodeWorkLogSource`**

Implementation requirements:

- Accept options `{ home?: string; sqliteRunner?: OpenCodeSqliteRunner }`.
- Look for `~/.local/share/opencode/opencode.db`.
- Return `missing_root` when the DB does not exist.
- Query sessions joined to projects:

```sql
select
  s.id as sessionId,
  p.worktree as worktree,
  s.directory as directory,
  s.title as title,
  s.version as version,
  s.summary_files as summaryFiles,
  s.summary_additions as summaryAdditions,
  s.summary_deletions as summaryDeletions,
  s.time_created as startedAt,
  s.time_updated as lastActiveAt,
  (
    select count(*) from message m
    where m.session_id = s.id and lower(m.data) like '%"role":"user"%'
  ) as userTurnCount,
  (
    select count(*) from message m
    where m.session_id = s.id and lower(m.data) like '%"role":"assistant"%'
  ) as assistantTurnCount,
  (
    select count(*) from part p2
    where p2.session_id = s.id and lower(p2.data) like '%tool%'
  ) as toolUseCount
from session s
join project p on p.id = s.project_id
where
  (p.worktree in (__WORKSPACES__) or s.directory in (__WORKSPACES__))
  and s.time_updated >= __START__
  and s.time_created <= __END__
order by s.time_updated asc;
```

- Build the workspace `in (...)` list by SQL-escaping single quotes.
- Parse `sqlite3 -json` output with `JSON.parse`.
- Use explicit session timestamps.
- Return `partial` with a warning if the query fails.

- [ ] **Step 5: Re-run the OpenCode test and verify it passes**

Run:

```bash
pnpm --filter @coder-studio/server exec vitest run src/__tests__/work-analysis-log-source-opencode.test.ts
```

Expected: PASS

- [ ] **Step 6: Commit Task 3**

Run:

```bash
git add packages/server/src/work-analysis/log-sources/opencode.ts packages/server/src/__tests__/work-analysis-log-source-opencode.test.ts
git commit -m "feat: read opencode work logs from sqlite"
```

---

### Task 4: Add The Work Log Collector And Source Digest

**Files:**
- Create: `packages/server/src/work-analysis/log-sources/collector.ts`
- Test: `packages/server/src/__tests__/work-analysis-log-collector.test.ts`

- [ ] **Step 1: Write the failing collector tests**

Create `packages/server/src/__tests__/work-analysis-log-collector.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { createWorkLogCollector } from "../work-analysis/log-sources/collector.js";
import type { ProviderWorkLogSource } from "../work-analysis/log-sources/types.js";

function source(input: Awaited<ReturnType<ProviderWorkLogSource["discover"]>>): ProviderWorkLogSource {
  return {
    providerId: input.providerId,
    discover: async () => input,
  };
}

describe("WorkLogCollector", () => {
  it("runs sources, sorts sessions, and reports provider statuses", async () => {
    const collector = createWorkLogCollector({
      sources: [
        source({
          providerId: "codex",
          status: "supported",
          parseErrorCount: 0,
          warnings: [],
          sourceRefs: [{ providerId: "codex", kind: "file", path: "/b", mtimeMs: 2, sizeBytes: 20 }],
          sessions: [
            {
              providerId: "codex",
              sessionId: "b",
              workspacePath: "/repo",
              startedAt: 20,
              lastActiveAt: 30,
              sourceRef: "/b",
              userTurnCount: 0,
              assistantTurnCount: 0,
              toolUseCount: 0,
              parseErrorCount: 0,
              timestampQuality: "explicit",
            },
          ],
        }),
        source({
          providerId: "claude",
          status: "no_logs",
          parseErrorCount: 0,
          warnings: [],
          sourceRefs: [],
          sessions: [],
        }),
      ],
    });

    const result = await collector.collect({
      workspacePaths: ["/repo"],
      timeRange: { startAt: 0, endAt: 100, label: "custom" },
    });

    expect(result.sessions.map((session) => session.sessionId)).toEqual(["b"]);
    expect(result.providers.map((provider) => provider.providerId)).toEqual(["codex", "claude"]);
    expect(result.sourceDigest).toMatch(/^[a-f0-9]{64}$/);
  });

  it("changes sourceDigest when source refs change", async () => {
    const left = await createWorkLogCollector({
      sources: [
        source({
          providerId: "codex",
          status: "supported",
          parseErrorCount: 0,
          warnings: [],
          sourceRefs: [{ providerId: "codex", kind: "file", path: "/a", mtimeMs: 1, sizeBytes: 10 }],
          sessions: [],
        }),
      ],
    }).collect({ workspacePaths: ["/repo"], timeRange: { startAt: 0, endAt: 1, label: "x" } });

    const right = await createWorkLogCollector({
      sources: [
        source({
          providerId: "codex",
          status: "supported",
          parseErrorCount: 0,
          warnings: [],
          sourceRefs: [{ providerId: "codex", kind: "file", path: "/a", mtimeMs: 2, sizeBytes: 10 }],
          sessions: [],
        }),
      ],
    }).collect({ workspacePaths: ["/repo"], timeRange: { startAt: 0, endAt: 1, label: "x" } });

    expect(left.sourceDigest).not.toBe(right.sourceDigest);
  });
});
```

- [ ] **Step 2: Run the collector tests and verify they fail**

Run:

```bash
pnpm --filter @coder-studio/server exec vitest run src/__tests__/work-analysis-log-collector.test.ts
```

Expected: FAIL because `collector.ts` does not exist.

- [ ] **Step 3: Implement the collector**

Create `packages/server/src/work-analysis/log-sources/collector.ts`:

```ts
import { createHash } from "node:crypto";
import type {
  ProviderWorkLogSource,
  WorkLogCollection,
  WorkLogCollector,
  WorkLogSourceRef,
} from "./types.js";

function buildSourceDigest(input: {
  sourceRefs: WorkLogSourceRef[];
  sessionIds: string[];
}): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        sourceRefs: [...input.sourceRefs].sort((left, right) =>
          `${left.providerId}:${left.path}`.localeCompare(`${right.providerId}:${right.path}`)
        ),
        sessionIds: [...input.sessionIds].sort(),
      })
    )
    .digest("hex");
}

export function createWorkLogCollector(deps: { sources: ProviderWorkLogSource[] }): WorkLogCollector {
  return {
    async collect(input: Parameters<ProviderWorkLogSource["discover"]>[0]): Promise<WorkLogCollection> {
      const providers = await Promise.all(deps.sources.map((source) => source.discover(input)));
      const sessions = providers
        .flatMap((provider) => provider.sessions)
        .sort(
          (left, right) =>
            left.lastActiveAt - right.lastActiveAt ||
            left.providerId.localeCompare(right.providerId) ||
            left.sessionId.localeCompare(right.sessionId)
        );

      return {
        sessions,
        providers,
        sourceDigest: buildSourceDigest({
          sourceRefs: providers.flatMap((provider) => provider.sourceRefs),
          sessionIds: sessions.map((session) => `${session.providerId}:${session.sessionId}`),
        }),
      };
    },
  };
}
```

- [ ] **Step 4: Re-run the collector tests and verify they pass**

Run:

```bash
pnpm --filter @coder-studio/server exec vitest run src/__tests__/work-analysis-log-collector.test.ts
```

Expected: PASS

- [ ] **Step 5: Commit Task 4**

Run:

```bash
git add packages/server/src/work-analysis/log-sources/collector.ts packages/server/src/__tests__/work-analysis-log-collector.test.ts
git commit -m "feat: collect provider work log sessions"
```

---

### Task 5: Extend Analysis Types, Schema, Repo, And Basic Aggregation

**Files:**
- Modify: `packages/server/src/work-analysis/types.ts`
- Modify: `packages/server/src/work-analysis/basic-schema.ts`
- Modify: `packages/server/src/work-analysis/basic-analyzer.ts`
- Modify: `packages/server/src/storage/repositories/work-analysis-repo.ts`
- Modify: `packages/web/src/features/work-analysis/types.ts`
- Test: `packages/server/src/__tests__/work-analysis-basic-analyzer.test.ts`
- Test: `packages/server/src/__tests__/work-analysis-repo.test.ts`

- [ ] **Step 1: Update the failing basic analyzer tests**

Modify `packages/server/src/__tests__/work-analysis-basic-analyzer.test.ts` so sessions include provider-log metrics:

```ts
{
  sessionId: "sess-1",
  workspacePath: "/repo/app",
  providerId: "codex",
  startedAt: Date.UTC(2026, 0, 1, 18, 0, 0),
  lastActiveAt: Date.UTC(2026, 0, 1, 18, 30, 0),
  userTurnCount: 2,
  assistantTurnCount: 2,
  toolUseCount: 1,
  parseErrorCount: 0,
  timestampQuality: "explicit" as const,
}
```

Add provider source status input:

```ts
dataSources: {
  providers: [
    {
      providerId: "codex",
      status: "supported",
      sessionCount: 2,
      parseErrorCount: 0,
      warningCount: 0,
    },
    {
      providerId: "cursor",
      status: "no_logs",
      sessionCount: 0,
      parseErrorCount: 0,
      warningCount: 0,
    },
  ],
}
```

Add assertions:

```ts
expect(result.executionSignals).toEqual({
  sessionsWithActivity: 3,
  userTurnCount: 5,
  assistantTurnCount: 4,
  toolUseCount: 2,
  fileMtimeTimestampCount: 1,
});
expect(result.dataSources.providers).toEqual([
  {
    providerId: "codex",
    status: "supported",
    sessionCount: 2,
    parseErrorCount: 0,
    warningCount: 0,
  },
  {
    providerId: "cursor",
    status: "no_logs",
    sessionCount: 0,
    parseErrorCount: 0,
    warningCount: 0,
  },
]);
```

- [ ] **Step 2: Add repo persistence tests for source snapshots**

Modify `packages/server/src/__tests__/work-analysis-repo.test.ts` to persist and reload:

```ts
sourceSnapshot: {
  sourceDigest: "digest-source",
  collectedAt: 1_234,
  providerStatuses: [
    { providerId: "codex", status: "supported", sessionCount: 1, parseErrorCount: 0 },
  ],
},
```

Assert the reloaded record includes `sourceSnapshot`.

- [ ] **Step 3: Run targeted tests and verify they fail**

Run:

```bash
pnpm --filter @coder-studio/server exec vitest run src/__tests__/work-analysis-basic-analyzer.test.ts src/__tests__/work-analysis-repo.test.ts
```

Expected: FAIL because schemas and types do not include the new fields.

- [ ] **Step 4: Extend server analysis result types**

Modify `packages/server/src/work-analysis/types.ts`:

- Add `WorkAnalysisSourceSnapshot`.
- Add `sourceSnapshot?: WorkAnalysisSourceSnapshot` to `WorkAnalysisRecord`.
- Add `dataSources` and expanded `executionSignals` to `WorkBasicAnalysisResult`.
- Change basic analysis session input shape indirectly through `basic-analyzer.ts`; do not expose Coder Studio `workspaceId` as session identity.

Representative additions:

```ts
export interface WorkAnalysisSourceSnapshot {
  sourceDigest: string;
  providerStatuses: Array<{
    providerId: string;
    status: string;
    sessionCount: number;
    parseErrorCount: number;
  }>;
  collectedAt: number;
}
```

- [ ] **Step 5: Extend the Zod schema**

Modify `packages/server/src/work-analysis/basic-schema.ts`:

```ts
dataSources: z.object({
  providers: z.array(
    z.object({
      providerId: z.string(),
      status: z.enum(["supported", "no_logs", "missing_root", "partial", "unsupported"]),
      sessionCount: nonNegativeIntegerSchema,
      parseErrorCount: nonNegativeIntegerSchema,
      warningCount: nonNegativeIntegerSchema,
    })
  ),
}),
executionSignals: z.object({
  sessionsWithActivity: nonNegativeIntegerSchema,
  userTurnCount: nonNegativeIntegerSchema,
  assistantTurnCount: nonNegativeIntegerSchema,
  toolUseCount: nonNegativeIntegerSchema,
  fileMtimeTimestampCount: nonNegativeIntegerSchema,
}),
```

- [ ] **Step 6: Update `analyzeWorkBasic`**

Modify `packages/server/src/work-analysis/basic-analyzer.ts` so the input session type uses:

```ts
type BasicAnalyzerSession = {
  sessionId: string;
  workspacePath: string;
  providerId: string;
  startedAt: number;
  lastActiveAt: number;
  userTurnCount: number;
  assistantTurnCount: number;
  toolUseCount: number;
  parseErrorCount: number;
  timestampQuality: "explicit" | "file_mtime" | "mixed";
};
```

Update output calculation:

```ts
const userTurnCount = input.sessions.reduce((sum, session) => sum + session.userTurnCount, 0);
const assistantTurnCount = input.sessions.reduce(
  (sum, session) => sum + session.assistantTurnCount,
  0
);
const toolUseCount = input.sessions.reduce((sum, session) => sum + session.toolUseCount, 0);
const fileMtimeTimestampCount = input.sessions.filter(
  (session) => session.timestampQuality === "file_mtime"
).length;
```

Pass `input.dataSources` through to the parsed result.

- [ ] **Step 7: Update repo normalization**

Modify `packages/server/src/storage/repositories/work-analysis-repo.ts`:

- Accept optional `sourceSnapshot` in `isWorkAnalysisRecord`.
- Preserve it in `normalizeRecord`.

Representative check:

```ts
function isSourceSnapshot(value: unknown): value is WorkAnalysisRecord["sourceSnapshot"] {
  if (!isRecord(value)) return false;
  return (
    typeof value.sourceDigest === "string" &&
    typeof value.collectedAt === "number" &&
    Array.isArray(value.providerStatuses)
  );
}
```

- [ ] **Step 8: Update frontend work-analysis types**

Modify `packages/web/src/features/work-analysis/types.ts` with the same new fields:

- `sourceSnapshot?: { sourceDigest: string; collectedAt: number; providerStatuses: Array<{ providerId: string; status: string; sessionCount: number; parseErrorCount: number }> }`
- `basicResult.dataSources.providers`
- expanded `executionSignals`

- [ ] **Step 9: Re-run targeted tests and typecheck server**

Run:

```bash
pnpm --filter @coder-studio/server exec vitest run src/__tests__/work-analysis-basic-analyzer.test.ts src/__tests__/work-analysis-repo.test.ts
pnpm --filter @coder-studio/server exec tsc -p tsconfig.json --noEmit
```

Expected: PASS

- [ ] **Step 10: Commit Task 5**

Run:

```bash
git add packages/server/src/work-analysis/types.ts packages/server/src/work-analysis/basic-schema.ts packages/server/src/work-analysis/basic-analyzer.ts packages/server/src/storage/repositories/work-analysis-repo.ts packages/web/src/features/work-analysis/types.ts packages/server/src/__tests__/work-analysis-basic-analyzer.test.ts packages/server/src/__tests__/work-analysis-repo.test.ts
git commit -m "feat: aggregate provider work log metrics"
```

---

### Task 6: Replace Session-Based WorkAnalysisService With Log Collection

**Files:**
- Modify: `packages/server/src/work-analysis/service.ts`
- Modify: `packages/server/src/server.ts`
- Test: `packages/server/src/__tests__/work-analysis-service.test.ts`

- [ ] **Step 1: Rewrite service tests around `workLogCollector`**

Modify `packages/server/src/__tests__/work-analysis-service.test.ts`.

Replace the old cache test with:

```ts
it("rescans provider logs when running basic analysis even if a previous result succeeded", async () => {
  const upsert = vi.fn((record) => record);
  const collect = vi.fn(async () => ({
    sourceDigest: "source-1",
    providers: [
      {
        providerId: "codex",
        status: "supported",
        sessions: [],
        sourceRefs: [],
        parseErrorCount: 0,
        warnings: [],
      },
    ],
    sessions: [],
  }));

  const service = new WorkAnalysisService({
    repo: {
      findByQueryDigest: vi.fn(() => ({
        id: "analysis-1",
        queryDigest: "digest-1",
        workspaceIds: ["ws-1"],
        timeRange: { preset: "7d" as const },
        basicStatus: "succeeded" as const,
        deepStatus: "idle" as const,
      })),
      upsert,
    },
    workspaceMgr: { get: vi.fn(() => ({ id: "ws-1", path: "/repo/app" })) },
    workLogCollector: { collect },
    skillLibraryRepo: { list: vi.fn(() => []) },
    skillMountRepo: { list: vi.fn(() => []) },
    deepRunner: { run: vi.fn() },
    now: () => 1_000,
  });

  await service.runBasic({ workspaceIds: ["ws-1"], timeRange: { preset: "7d" } });

  expect(collect).toHaveBeenCalledWith({
    workspacePaths: ["/repo/app"],
    timeRange: expect.any(Object),
  });
  expect(upsert).toHaveBeenCalled();
});
```

Update deep tests so `workLogCollector.collect` returns a session with `evidence`, and `deepRunner.run` receives sampled provider evidence instead of terminal snapshots.

- [ ] **Step 2: Run service tests and verify they fail**

Run:

```bash
pnpm --filter @coder-studio/server exec vitest run src/__tests__/work-analysis-service.test.ts
```

Expected: FAIL because `WorkAnalysisService` still expects `sessionSelector` and `evidenceCollector`.

- [ ] **Step 3: Change `WorkAnalysisServiceDeps`**

Modify `packages/server/src/work-analysis/service.ts` dependency shape:

```ts
export interface WorkAnalysisServiceDeps {
  repo: {
    findByQueryDigest(queryDigest: string): WorkAnalysisRecord | undefined;
    upsert(record: WorkAnalysisRecord): WorkAnalysisRecord;
  };
  workspaceMgr: Pick<WorkspaceManager, "get">;
  workLogCollector: Pick<WorkLogCollector, "collect">;
  skillLibraryRepo: Pick<SkillLibraryRepo, "list">;
  skillMountRepo: Pick<SkillMountRepo, "list">;
  basicAnalyzer?: typeof analyzeWorkBasic;
  deepRunner: Pick<WorkDeepAnalysisRunner, "run">;
  now?: () => number;
}
```

Do not import `session-selector.ts` or `evidence-collector.ts`.

- [ ] **Step 4: Resolve workspace IDs to paths**

Add a helper inside `service.ts`:

```ts
private resolveWorkspacePaths(workspaceIds: string[]): {
  workspacePaths: string[];
  missingWorkspaceIds: string[];
} {
  const workspacePaths: string[] = [];
  const missingWorkspaceIds: string[] = [];

  for (const workspaceId of workspaceIds) {
    const path = this.deps.workspaceMgr.get(workspaceId)?.path;
    if (typeof path === "string" && path.length > 0) {
      workspacePaths.push(path);
    } else {
      missingWorkspaceIds.push(workspaceId);
    }
  }

  return { workspacePaths, missingWorkspaceIds };
}
```

If any selected workspace id cannot be resolved, fail the run instead of silently dropping it. Throw:

```ts
{
  code: "work_analysis_workspace_unavailable",
  message: `Some selected workspaces were unavailable for work analysis: ${missingWorkspaceIds.join(", ")}`,
}
```

- [ ] **Step 5: Add a private collection helper and rework `runBasic`**

Add a private helper that both `runBasic` and `runDeep` can call:

```ts
private async collectForQuery(input: {
  normalized: WorkAnalysisQuery;
  timeRange: ResolvedWorkAnalysisTimeRange;
}) {
  const { workspacePaths, missingWorkspaceIds } = this.resolveWorkspacePaths(
    input.normalized.workspaceIds
  );
  if (missingWorkspaceIds.length > 0) {
    throw {
      code: "work_analysis_workspace_unavailable",
      message: `Some selected workspaces were unavailable for work analysis: ${missingWorkspaceIds.join(", ")}`,
    };
  }

  const collection = await this.deps.workLogCollector.collect({
    workspacePaths,
    timeRange: input.timeRange,
  });
  const skillInventory = {
    installedSkills: this.deps.skillLibraryRepo.list(),
    mounts: this.deps.skillMountRepo.list(),
  };

  return { workspacePaths, collection, skillInventory };
}
```

Behavior:

- Always create/update a running record.
- Always call `collectForQuery(...)`.
- Pass normalized sessions to `basicAnalyzer`.
- Save `sourceSnapshot`.
- Do not return early for existing `basicStatus === "succeeded"`.

Provider status mapping:

```ts
const dataSources = {
  providers: collection.providers.map((provider) => ({
    providerId: provider.providerId,
    status: provider.status,
    sessionCount: provider.sessions.length,
    parseErrorCount: provider.parseErrorCount,
    warningCount: provider.warnings.length,
  })),
};
```

- [ ] **Step 6: Rework `runDeep`**

Behavior:

- Do not call `runBasic(query)` and then scan again.
- Use a private `runBasicWithCollection(query)` helper that returns `{ record, collection, skillInventory, workspacePaths }`.
- Public `runBasic(query)` should call `runBasicWithCollection(query)` and return `record`.
- Public `runDeep(query)` should call `runBasicWithCollection(query)` once, then use that same `collection` for evidence sampling.
- Add a private `buildEvidenceFromWorkLogSessions(...)` helper in `service.ts` for this task:

```ts
private buildEvidenceFromWorkLogSessions(input: {
  sessions: WorkLogSession[];
  skillInventory: WorkAnalysisEvidence["skillInventory"];
}): WorkAnalysisEvidence {
  return {
    sessions: input.sessions.slice(0, 12).map((session) => {
      const evidence = session.evidence?.[0];
      return {
        providerId: session.providerId,
        sessionId: session.sessionId,
        workspacePath: session.workspacePath,
        title: session.title,
        startedAt: session.startedAt,
        lastActiveAt: session.lastActiveAt,
        excerpts: (evidence?.excerpts ?? []).slice(0, 8),
      };
    }),
    skillInventory: input.skillInventory,
  };
}
```

- Do not add a session-count-based `resolveDeepProviderId(...)` helper in `service.ts`. Deep execution provider selection belongs in `deep-runner.ts`, where the runner can prefer a provider inferred from sampled evidence but safely fall back to any configured provider that supports `session_analysis`.

- [ ] **Step 7: Wire the new collector in `server.ts`**

Modify imports:

```ts
import { createWorkLogCollector } from "./work-analysis/log-sources/collector.js";
import { createClaudeWorkLogSource } from "./work-analysis/log-sources/claude.js";
import { createCodexWorkLogSource } from "./work-analysis/log-sources/codex.js";
import { createCursorWorkLogSource } from "./work-analysis/log-sources/cursor.js";
import { createGeminiWorkLogSource } from "./work-analysis/log-sources/gemini.js";
import { createOpenCodeWorkLogSource } from "./work-analysis/log-sources/opencode.js";
```

Construct:

```ts
const builtInProviderIds = new Set(providerRegistry.map((provider) => provider.id));

const workLogCollector = createWorkLogCollector({
  sources: [
    ...(builtInProviderIds.has("claude") ? [createClaudeWorkLogSource()] : []),
    ...(builtInProviderIds.has("codex") ? [createCodexWorkLogSource()] : []),
    ...(builtInProviderIds.has("gemini") ? [createGeminiWorkLogSource()] : []),
    ...(builtInProviderIds.has("cursor") ? [createCursorWorkLogSource()] : []),
    ...(builtInProviderIds.has("opencode") ? [createOpenCodeWorkLogSource()] : []),
  ],
});
```

Pass into service:

```ts
const workAnalysisService = new WorkAnalysisService({
  repo: workAnalysisRepo,
  workspaceMgr: {
    get: (workspaceId) => workspaceMgr.get(workspaceId),
  } as WorkspaceManager,
  workLogCollector,
  skillLibraryRepo,
  skillMountRepo,
  deepRunner: new WorkDeepAnalysisRunner({
    providerRegistry: activeProviderRegistry,
    providerConfigRepo,
  }),
});
```

- [ ] **Step 8: Re-run service tests and server typecheck**

Run:

```bash
pnpm --filter @coder-studio/server exec vitest run src/__tests__/work-analysis-service.test.ts
pnpm --filter @coder-studio/server exec tsc -p tsconfig.json --noEmit
```

Expected: PASS

- [ ] **Step 9: Commit Task 6**

Run:

```bash
git add packages/server/src/work-analysis/service.ts packages/server/src/server.ts packages/server/src/__tests__/work-analysis-service.test.ts
git commit -m "feat: run work analysis from provider logs"
```

---

### Task 7: Add Evidence Sampling And Deep Provider Selection

**Files:**
- Create: `packages/server/src/work-analysis/evidence-sampler.ts`
- Modify: `packages/server/src/work-analysis/types.ts`
- Modify: `packages/server/src/work-analysis/deep-prompt.ts`
- Modify: `packages/server/src/work-analysis/deep-runner.ts`
- Modify: `packages/server/src/work-analysis/service.ts`
- Test: `packages/server/src/__tests__/work-analysis-evidence-sampler.test.ts`
- Test: `packages/server/src/__tests__/work-analysis-deep-runner.test.ts`
- Test: `packages/server/src/__tests__/work-analysis-service.test.ts`

- [ ] **Step 1: Write the failing evidence sampler tests**

Create `packages/server/src/__tests__/work-analysis-evidence-sampler.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { sampleWorkLogEvidence } from "../work-analysis/evidence-sampler.js";
import type { WorkLogSession } from "../work-analysis/log-sources/types.js";

function session(id: string, providerId: WorkLogSession["providerId"], lastActiveAt: number): WorkLogSession {
  return {
    providerId,
    sessionId: id,
    workspacePath: "/repo/app",
    startedAt: lastActiveAt - 100,
    lastActiveAt,
    sourceRef: `/logs/${id}`,
    title: id,
    userTurnCount: 1,
    assistantTurnCount: 1,
    toolUseCount: 1,
    parseErrorCount: 0,
    timestampQuality: "explicit",
    evidence: [
      {
        providerId,
        sessionId: id,
        workspacePath: "/repo/app",
        startedAt: lastActiveAt - 100,
        lastActiveAt,
        excerpts: [
          { role: "user", text: "x".repeat(1000) },
          { role: "tool", toolName: "shell", commandKind: "test" },
        ],
      },
    ],
  };
}

describe("sampleWorkLogEvidence", () => {
  it("caps excerpts and truncates long text", () => {
    const result = sampleWorkLogEvidence({
      sessions: [session("s1", "codex", 100)],
      skillInventory: { installedSkills: [], mounts: [] },
      maxSessions: 1,
      maxExcerptsPerSession: 1,
      maxTextChars: 20,
    });

    expect(result.sessions).toHaveLength(1);
    expect(result.sessions[0]?.excerpts).toHaveLength(1);
    expect(result.sessions[0]?.excerpts[0]?.text?.length).toBeLessThanOrEqual(20);
  });

  it("keeps provider diversity before filling remaining slots", () => {
    const result = sampleWorkLogEvidence({
      sessions: [
        session("old-codex", "codex", 10),
        session("new-codex", "codex", 30),
        session("claude", "claude", 20),
      ],
      skillInventory: { installedSkills: [], mounts: [] },
      maxSessions: 2,
      maxExcerptsPerSession: 2,
      maxTextChars: 100,
    });

    expect(new Set(result.sessions.map((entry) => entry.providerId))).toEqual(
      new Set(["codex", "claude"])
    );
  });
});
```

- [ ] **Step 2: Run sampler tests and verify they fail**

Run:

```bash
pnpm --filter @coder-studio/server exec vitest run src/__tests__/work-analysis-evidence-sampler.test.ts
```

Expected: FAIL because `evidence-sampler.ts` does not exist.

- [ ] **Step 3: Update `WorkAnalysisEvidence` type**

Modify `packages/server/src/work-analysis/types.ts`:

```ts
export interface WorkAnalysisSessionEvidence {
  providerId?: string;
  sessionId?: string;
  workspacePath?: string;
  title?: string;
  startedAt: number;
  lastActiveAt: number;
  excerpts?: Array<{
    role: "user" | "assistant" | "tool" | "system" | "unknown";
    at?: number;
    text?: string;
    toolName?: string;
    commandKind?: string;
    filePath?: string;
  }>;
}
```

Remove `latestUserInput` and `terminalSnapshot` from required usage. They can remain optional for backward compatibility if needed, but new code must not set them from Coder Studio sessions.

- [ ] **Step 4: Implement `sampleWorkLogEvidence`**

Create `packages/server/src/work-analysis/evidence-sampler.ts`:

```ts
import type { WorkAnalysisEvidence } from "./types.js";
import type { WorkLogSession } from "./log-sources/types.js";

interface SampleInput {
  sessions: WorkLogSession[];
  skillInventory: WorkAnalysisEvidence["skillInventory"];
  maxSessions?: number;
  maxExcerptsPerSession?: number;
  maxTextChars?: number;
}

function truncateText(text: string, maxChars: number): string {
  return text.length <= maxChars ? text : text.slice(0, maxChars);
}

export function sampleWorkLogEvidence(input: SampleInput): WorkAnalysisEvidence {
  const maxSessions = input.maxSessions ?? 12;
  const maxExcerptsPerSession = input.maxExcerptsPerSession ?? 8;
  const maxTextChars = input.maxTextChars ?? 1_000;

  const newestByProvider = new Map<string, WorkLogSession>();
  for (const session of [...input.sessions].sort((left, right) => right.lastActiveAt - left.lastActiveAt)) {
    if (!newestByProvider.has(session.providerId)) {
      newestByProvider.set(session.providerId, session);
    }
  }

  const selected = [...newestByProvider.values()];
  for (const session of [...input.sessions].sort((left, right) => right.lastActiveAt - left.lastActiveAt)) {
    if (selected.length >= maxSessions) break;
    if (!selected.includes(session)) selected.push(session);
  }

  return {
    sessions: selected.slice(0, maxSessions).map((session) => {
      const evidence = session.evidence?.[0];
      return {
        providerId: session.providerId,
        sessionId: session.sessionId,
        workspacePath: session.workspacePath,
        title: session.title,
        startedAt: session.startedAt,
        lastActiveAt: session.lastActiveAt,
        excerpts: (evidence?.excerpts ?? [])
          .slice(0, maxExcerptsPerSession)
          .map((excerpt) => ({
            ...excerpt,
            text:
              typeof excerpt.text === "string"
                ? truncateText(excerpt.text, maxTextChars)
                : undefined,
          })),
      };
    }),
    skillInventory: input.skillInventory,
  };
}
```

- [ ] **Step 5: Update the deep prompt test**

Modify `packages/server/src/__tests__/work-analysis-deep-runner.test.ts` evidence fixture:

```ts
evidence: {
  sessions: [
    {
      providerId: "codex",
      sessionId: "session-1",
      workspacePath: "/repo/project",
      title: "Session",
      startedAt: 100,
      lastActiveAt: 200,
      excerpts: [{ role: "user", text: "investigate" }],
    },
  ],
  skillInventory: {
    installedSkills: [{ slug: "review" }],
    mounts: [{ skillSlug: "review", enabled: true }],
  },
}
```

Assert prompt contains `"excerpts"` instead of `"snapshot"`.

- [ ] **Step 6: Add deep provider selection to runner**

Modify `packages/server/src/work-analysis/deep-runner.ts`:

- Add method:

```ts
resolveProviderId(preferredProviderId?: string): string
```

Behavior:

- If preferred provider id is present and supports `session_analysis`, return it.
- Otherwise return the first provider in `providerRegistry` whose `headless.supportedScenarios` includes `session_analysis`.
- Throw `work_analysis_provider_unavailable` if none exists.

Use this method for all deep runs. The service may pass a preferred provider id derived from sampled evidence, but the runner owns the final selection and fallback behavior.

- [ ] **Step 7: Update service to use sampler and runner selection**

Modify `packages/server/src/work-analysis/service.ts`:

- Build skill inventory once.
- Pass `sampleWorkLogEvidence({ sessions: collection.sessions, skillInventory })` to `deepRunner.run`.
- Derive an optional preferred provider id from sampled evidence only if at least one sampled session exists.
- Pass that preferred provider id into `deepRunner.resolveProviderId(preferredProviderId)` or an equivalent runner-owned selection path.
- Do not keep or reintroduce the old "provider with most sessions" selection helper in `service.ts`.

- [ ] **Step 8: Re-run deep and service tests**

Run:

```bash
pnpm --filter @coder-studio/server exec vitest run src/__tests__/work-analysis-evidence-sampler.test.ts src/__tests__/work-analysis-deep-runner.test.ts src/__tests__/work-analysis-service.test.ts
```

Expected: PASS

- [ ] **Step 9: Commit Task 7**

Run:

```bash
git add packages/server/src/work-analysis/evidence-sampler.ts packages/server/src/work-analysis/types.ts packages/server/src/work-analysis/deep-prompt.ts packages/server/src/work-analysis/deep-runner.ts packages/server/src/work-analysis/service.ts packages/server/src/__tests__/work-analysis-evidence-sampler.test.ts packages/server/src/__tests__/work-analysis-deep-runner.test.ts packages/server/src/__tests__/work-analysis-service.test.ts
git commit -m "feat: sample provider log evidence for deep analysis"
```

---

### Task 8: Update Work Analysis UI And Localization

**Files:**
- Modify: `packages/web/src/features/settings/components/session-analysis-settings.tsx`
- Modify: `packages/web/src/locales/en.json`
- Modify: `packages/web/src/locales/zh.json`
- Test: `packages/web/src/features/settings/components/settings-page.test.tsx`

- [ ] **Step 1: Extend the existing settings page work-analysis test**

Modify the existing work-analysis coverage in `packages/web/src/features/settings/components/settings-page.test.tsx`. The relevant tests already dispatch `work.analysis.get`, `work.analysis.runBasic`, and `work.analysis.runDeep`; extend the fixture returned by `work.analysis.get` so `basicResult` includes `dataSources.providers` and expanded `executionSignals`.

- [ ] **Step 2: Write failing UI assertions**

Add assertions that a completed analysis with `basicResult.dataSources.providers` renders:

- provider status section
- all provider rows supplied by the result
- provider log wording, not current session wording

Representative expected text:

```ts
expect(screen.getByText(/Provider log sources/i)).toBeInTheDocument();
expect(screen.getByText(/codex/i)).toBeInTheDocument();
expect(screen.getByText(/local log matches/i)).toBeInTheDocument();
```

For Chinese locale updates, ensure keys exist but do not add a separate i18n test unless the repo already has one.

- [ ] **Step 3: Run the UI test and verify it fails**

Run:

```bash
pnpm --filter @coder-studio/web exec vitest run src/features/settings/components/settings-page.test.tsx
```

Expected: FAIL until the component renders provider source status.

- [ ] **Step 4: Add localization keys**

Modify `packages/web/src/locales/en.json` under `settings.analysis`:

```json
"source_hint": "Analysis scans each provider's local logs for the selected workspace and time range.",
"provider_sources": "Provider log sources",
"provider_source_row": "{providerId}: {sessionCount} local log matches, {status}",
"provider_status_supported": "Ready",
"provider_status_no_logs": "No matching logs",
"provider_status_missing_root": "Log root missing",
"provider_status_partial": "Partial data",
"provider_status_unsupported": "Unsupported",
"mtime_fallback_hint": "{count} sessions used file modification time because the provider log did not include explicit timestamps.",
"log_coverage_summary": "Found {sessionCount} provider-local sessions across {workspaceCount} workspaces and {providerCount} providers."
```

Modify `packages/web/src/locales/zh.json` with equivalent Chinese strings:

```json
"source_hint": "分析会扫描各 provider 在本机保存的日志，并按所选工作区和时间范围筛选。",
"provider_sources": "Provider 日志来源",
"provider_source_row": "{providerId}: 命中 {sessionCount} 个本地日志会话，状态 {status}",
"provider_status_supported": "可用",
"provider_status_no_logs": "无匹配日志",
"provider_status_missing_root": "日志目录不存在",
"provider_status_partial": "部分数据",
"provider_status_unsupported": "暂不支持",
"mtime_fallback_hint": "{count} 个会话使用了文件修改时间，因为 provider 日志没有明确时间戳。",
"log_coverage_summary": "在 {workspaceCount} 个工作区、{providerCount} 个 provider 中命中 {sessionCount} 个 provider 本地会话。"
```

- [ ] **Step 5: Update `SessionAnalysisSettings` rendering**

Modify `packages/web/src/features/settings/components/session-analysis-settings.tsx`:

- Add `formatProviderStatusLabel(status, t)`.
- Replace `coverage_summary` display with `log_coverage_summary` when new data exists.
- Render `analysis.basicResult.dataSources.providers` as a compact list under `provider_sources`.
- Render `mtime_fallback_hint` when `executionSignals.fileMtimeTimestampCount > 0`.
- Keep existing provider mix list.

Do not redesign the whole settings page in this task.

- [ ] **Step 6: Re-run UI test and web typecheck**

Run:

```bash
pnpm --filter @coder-studio/web exec vitest run src/features/settings/components/settings-page.test.tsx
pnpm --filter @coder-studio/web exec tsc -p tsconfig.json --noEmit
```

Expected: PASS

- [ ] **Step 7: Commit Task 8**

Run:

```bash
git add packages/web/src/features/settings/components/session-analysis-settings.tsx packages/web/src/locales/en.json packages/web/src/locales/zh.json packages/web/src/features/settings/components/settings-page.test.tsx
git commit -m "feat: show provider log sources in work analysis"
```

---

### Task 9: Retire Session-Based Work Analysis Modules And Update Docs

**Files:**
- Delete: `packages/server/src/work-analysis/session-selector.ts`
- Delete: `packages/server/src/work-analysis/evidence-collector.ts`
- Delete: `packages/server/src/__tests__/work-analysis-session-selector.test.ts`
- Delete: `packages/server/src/__tests__/work-analysis-evidence-collector.test.ts`
- Modify: `docs/help/work-analysis.md`

- [ ] **Step 1: Verify no production imports remain**

Run:

```bash
rg -n "createWorkAnalysisSessionSelector|createWorkAnalysisEvidenceCollector|session-selector|evidence-collector" packages/server/src
```

Expected before deletion: only old modules/tests remain. If production imports remain, finish Task 6/7 wiring first.

- [ ] **Step 2: Delete old modules and tests**

Remove the four files listed above after imports are gone.

- [ ] **Step 3: Update help docs**

Modify `docs/help/work-analysis.md`:

- Remove the prerequisite that a workspace must have an open agent session.
- Explain that data comes from provider local logs/cache.
- Mention all 5 built-in providers.
- Mention that provider data can be missing, partial, or timestamp-fallback.
- Explain that deep analysis uses sampled evidence.

Use this replacement for the "前置条件" section:

```md
## 前置条件

- 至少打开一个工作区，让 Coder Studio 知道要分析哪个 workspace path
- 该 workspace 在所选时间范围内最好有 provider 本地日志
- 不要求当前有打开中的 Coder Studio session
```

- [ ] **Step 4: Run deletion/doc checks**

Run:

```bash
rg -n "createWorkAnalysisSessionSelector|createWorkAnalysisEvidenceCollector|terminalSnapshot|latestUserInput" packages/server/src/work-analysis packages/server/src/__tests__
pnpm --filter @coder-studio/server exec tsc -p tsconfig.json --noEmit
```

Expected:

- `rg` has no matches in work-analysis production code. If tests still mention old evidence field names only as legacy fixtures, update them.
- Typecheck PASS.

- [ ] **Step 5: Commit Task 9**

Run:

```bash
git add -A packages/server/src/work-analysis/session-selector.ts packages/server/src/work-analysis/evidence-collector.ts packages/server/src/__tests__/work-analysis-session-selector.test.ts packages/server/src/__tests__/work-analysis-evidence-collector.test.ts docs/help/work-analysis.md
git commit -m "docs: document provider log work analysis"
```

---

### Task 10: Final Verification

**Files:**
- No planned edits unless verification finds a defect.

- [ ] **Step 1: Run all targeted server work-analysis tests**

Run:

```bash
pnpm --filter @coder-studio/server exec vitest run \
  src/__tests__/work-analysis-log-source-helpers.test.ts \
  src/__tests__/work-analysis-log-sources-file-adapters.test.ts \
  src/__tests__/work-analysis-log-source-opencode.test.ts \
  src/__tests__/work-analysis-log-collector.test.ts \
  src/__tests__/work-analysis-basic-analyzer.test.ts \
  src/__tests__/work-analysis-service.test.ts \
  src/__tests__/work-analysis-deep-runner.test.ts \
  src/__tests__/work-analysis-repo.test.ts \
  src/__tests__/work-analysis-commands.test.ts
```

Expected: PASS

- [ ] **Step 2: Run package typechecks**

Run:

```bash
pnpm --filter @coder-studio/server exec tsc -p tsconfig.json --noEmit
pnpm --filter @coder-studio/web exec tsc -p tsconfig.json --noEmit
```

Expected: PASS

- [ ] **Step 3: Run full workspace tests if time allows**

Run:

```bash
pnpm ci:test:workspace
```

Expected: PASS

- [ ] **Step 4: Run lint/check**

Run:

```bash
pnpm ci:lint
```

Expected: PASS

- [ ] **Step 5: Manual smoke check with local logs**

Start the app:

```bash
pnpm dev
```

Manual check:

- Open Settings > Work Analysis.
- Select `/home/spencer/workspace/coder-studio`.
- Select `Last 7 days`.
- Run Basic Analysis.
- Confirm provider source rows appear for `claude`, `codex`, `gemini`, `cursor`, and `opencode`.
- Confirm Codex reports more than one local log match when local logs exist.
- Confirm no text implies only currently open Coder Studio sessions are analyzed.

- [ ] **Step 6: Commit any verification fixes**

If Step 1-5 required fixes:

```bash
git status --short
git add docs/help/work-analysis.md packages/server/src packages/web/src
git commit -m "fix: stabilize provider work log analysis"
```

If no fixes were required, do not create an empty commit.
