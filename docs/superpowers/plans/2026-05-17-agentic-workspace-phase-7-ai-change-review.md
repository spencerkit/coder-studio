# Agentic Workspace Phase 7 AI Change Review Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **Spec:** `docs/superpowers/specs/2026-05-17-agentic-workspace-platform-design.md`

**Goal:** Add a review flow that shows changed files and diffs for an agent session using the session Git baseline.

**Architecture:** Use Git baseline metadata as the review anchor. Server commands compute changed files and diffs against baseline; web UI renders a session review panel beside the agent session.

**Tech Stack:** TypeScript, Git CLI helpers, Zod, Vitest, React Testing Library.

---

## Scope

Includes:

- Review summary command.
- Per-file diff command for session baseline.
- Session review panel.
- Verification checklist display.
- Manual "mark verification" action.

Excludes:

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
- Create: `packages/web/src/features/session-review/actions/use-session-review.ts`
- Create: `packages/web/src/features/session-review/components/session-review-panel.tsx`
- Create: `packages/web/src/features/session-review/components/session-review-panel.test.tsx`
- Modify: `packages/web/src/features/agent-panes/views/shared/session-card.tsx`

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

- [ ] Implement changed file detection from `baselineGitHead` to working tree.
- [ ] Return a warning when baseline is missing.
- [ ] Return a warning when workspace is not a Git repo.
- [ ] Implement per-file diff against baseline.
- [ ] Register session review commands.
- [ ] Add UI panel showing:
  - changed files
  - selected diff
  - verification runs
  - baseline warnings
- [ ] Add action to manually add verification result using `session.verification.add`.
- [ ] Add tests for clean session, changed session, missing baseline, and non-Git workspace.

## Acceptance Criteria

- Users can inspect what changed since a session started.
- Review panel does not claim perfect agent attribution.
- Verification state is visible next to diff state.
- Non-Git workspaces degrade gracefully.

## Verification

```bash
pnpm exec vitest run \
  packages/server/src/__tests__/session-review/review.test.ts \
  packages/server/src/__tests__/session-review-command.test.ts \
  packages/web/src/features/session-review/components/session-review-panel.test.tsx
```

Expected: all tests pass.

## Suggested Commit

```bash
git add packages/core packages/server packages/web/src/features/session-review packages/web/src/features/agent-panes
git commit -m "feat: add agent session change review"
```

