# Agentic Workspace Phase 6 Session Metadata Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **Spec:** `docs/superpowers/specs/2026-05-17-agentic-workspace-platform-design.md`

**Goal:** Extend session records with metadata needed for review, verification, and multi-agent workflows.

**Architecture:** Add a companion session metadata store keyed by `sessionId` so the existing session lifecycle can stay stable. Capture Git baseline on session creation when possible and allow verification records to be added later.

**Tech Stack:** TypeScript, SQLite repository pattern, Git CLI helpers, Vitest.

---

## Scope

Includes:

- Session metadata table.
- Git baseline capture.
- Session objective field.
- Verification record storage.
- `session.metadata.get` and `session.verification.add` commands.

Excludes:

- Full review UI.
- Perfect attribution of file changes to a session.
- Automatic test command execution.

## Files

- Modify: `packages/core/src/domain/types.ts`
- Modify: `packages/server/src/storage/migrations/001_init.sql`
- Create: `packages/server/src/storage/repositories/session-metadata-repo.ts`
- Create: `packages/server/src/__tests__/session-metadata-repo.test.ts`
- Modify: `packages/server/src/session/manager.ts`
- Create: `packages/server/src/commands/session-metadata.ts`
- Modify: `packages/server/src/commands/index.ts`
- Create: `packages/server/src/__tests__/session-metadata-command.test.ts`
- Modify: `packages/web/src/features/agent-panes/components/session-card.tsx`
- Modify: `packages/web/src/features/agent-panes/components/session-card.test.tsx`

## Data Model

Add:

```ts
export interface AgentSessionMetadata {
  sessionId: string;
  workspaceId: string;
  providerId: string;
  objective?: string;
  baselineGitHead?: string;
  baselineCapturedAt?: number;
  verificationRuns: AgentSessionVerificationRun[];
}

export interface AgentSessionVerificationRun {
  id: string;
  command: string;
  status: "passed" | "failed" | "unknown";
  exitCode?: number;
  summary?: string;
  createdAt: number;
}
```

## Tasks

- [ ] Add metadata and verification types.
- [ ] Add SQLite tables for session metadata and verification runs.
- [ ] Implement metadata repository.
- [ ] Capture baseline Git HEAD during session creation when workspace is a Git repo.
- [ ] Store initial objective from session draft when available.
- [ ] Register `session.metadata.get`.
- [ ] Register `session.verification.add`.
- [ ] Add tests for non-Git workspaces, Git workspaces, and verification append.
- [ ] Update session card to show objective and baseline state when available.

## Acceptance Criteria

- Existing sessions still load.
- New sessions have metadata records.
- Git baseline capture failure does not block session creation.
- Verification runs can be stored without running commands automatically.

## Verification

```bash
pnpm exec vitest run \
  packages/server/src/__tests__/session-metadata-repo.test.ts \
  packages/server/src/__tests__/session-metadata-command.test.ts \
  packages/server/src/__tests__/session-commands.test.ts \
  packages/web/src/features/agent-panes/components/session-card.test.tsx
```

Expected: all tests pass.

## Suggested Commit

```bash
git add packages/core packages/server packages/web/src/features/agent-panes
git commit -m "feat: add agent session metadata"
```

