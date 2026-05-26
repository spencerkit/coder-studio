# Agentic Workspace Phase 7 AI Change Review Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **Spec:** `docs/superpowers/specs/2026-05-17-agentic-workspace-platform-design.md`

**Goal:** Add a review flow that shows changed files and diffs for an agent session using the session Git baseline.

**Architecture:** Use Git baseline metadata as the review anchor. Server commands compute changed files and diffs against baseline; frontend rendering is explicitly deferred in the current execution scope.

**Tech Stack:** TypeScript, Git CLI helpers, Zod, Vitest, React Testing Library.

---

## Scope

Includes:

- Review summary command.
- Per-file diff command for session baseline.

Excludes:

- Session review panel and verification UI. Deferred to a later UX phase.
- Automatic causal attribution.
- Automatic accept/discard hunk UI.
- LLM-generated review summary.
- Cross-agent review action; that comes in Context Attach.

## Files

- Modify: `packages/core/src/domain/types.ts`
- Create: `packages/server/src/session-review/review.ts`
- Create: `packages/server/src/__tests__/session-review/review.test.ts`
- Create: `packages/server/src/commands/session-review.ts`
- Modify: `packages/server/src/commands/index.ts`
- Create: `packages/server/src/__tests__/session-review-command.test.ts`

## Data Model

Add:

```ts
export interface SessionReviewSummary {
  sessionId: string;
  workspaceId: string;
  baselineGitHead?: string;
  changedFiles: GitFileChange[];
  verificationRuns: AgentSessionVerificationRun[];
  warnings: Array<{
    code: "missing_baseline" | "not_git_repo" | "dirty_before_session";
    message: string;
  }>;
}
```

## Commands

Add:

- `sessionReview.summary`
- `sessionReview.diff`

## Tasks

- [x] Implement changed file detection from `baselineGitHead` to working tree.
- [x] Return a warning when baseline is missing.
- [x] Return a warning when workspace is not a Git repo.
- [x] Implement per-file diff against baseline.
- [x] Register session review commands.
- [x] Add tests for clean session, changed session, missing baseline, and non-Git workspace.

## Acceptance Criteria

- Users can inspect what changed since a session started.
- Review panel does not claim perfect agent attribution.
- Verification state is visible next to diff state.
- Non-Git workspaces degrade gracefully.

## Verification

```bash
pnpm exec vitest run \
  packages/server/src/__tests__/session-review/review.test.ts \
  packages/server/src/__tests__/session-review-command.test.ts
```

Expected: all tests pass.

## Suggested Commit

```bash
git add packages/core packages/server
git commit -m "feat: add agent session change review"
```
