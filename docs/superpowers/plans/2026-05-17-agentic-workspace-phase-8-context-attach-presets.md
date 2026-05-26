# Agentic Workspace Phase 8 Context Attach And Presets Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **Spec:** `docs/superpowers/specs/2026-05-17-agentic-workspace-platform-design.md`

**Goal:** Add deterministic workspace-context package builders and a lightweight preset foundation for future providers.

**Architecture:** Build a provider-agnostic context package format. In the current execution scope, server commands create deterministic text payloads from files, diffs, project summary, or session review. Frontend send actions are explicitly deferred.

**Tech Stack:** TypeScript, React, existing terminal/session input actions, Vitest, React Testing Library.

---

## Scope

Includes:

- Context package data model.
- Server helpers for file/diff/project/session context.
- Preset provider metadata format, without installing presets by default.

Excludes:

- Frontend "Send to agent" menus and routing UI. Deferred to a later UX phase.
- Automatic session input submission from generated context packages.
- Real marketplace.
- Remote registry downloads.
- OAuth.
- Background cloud agents.
- Automatic prompt engineering beyond deterministic wrappers.

## Files

- Modify: `packages/core/src/domain/types.ts`
- Create: `packages/server/src/agent-context/context-package.ts`
- Create: `packages/server/src/__tests__/agent-context/context-package.test.ts`
- Create: `packages/server/src/commands/agent-context.ts`
- Modify: `packages/server/src/commands/index.ts`
- Create: `packages/server/src/__tests__/agent-context-command.test.ts`
- Create: `packages/providers/src/presets.ts`
- Create: `packages/providers/src/presets.test.ts`

## Data Model

Add:

```ts
export type AgentContextKind =
  | "file"
  | "selection"
  | "git_diff"
  | "terminal_output"
  | "project_summary"
  | "session_review";

export interface AgentContextPackage {
  id: string;
  kind: AgentContextKind;
  title: string;
  body: string;
  source: {
    workspaceId: string;
    path?: string;
    sessionId?: string;
    terminalId?: string;
  };
  createdAt: number;
}
```

## Commands

Add:

- `agentContext.fromFile`
- `agentContext.fromDiff`
- `agentContext.fromProjectSummary`
- `agentContext.fromSessionReview`

## Tasks

- [x] Add context package types.
- [x] Implement deterministic wrappers:

```text
Context: [title]
Source: [source]

[body]
```

- [x] Implement context builders for file, diff, project summary, and session review.
- [x] Add command coverage for deterministic context package generation only.
- [x] Add first preset metadata for future providers without exposing them as enabled providers:
  - Gemini CLI
  - Aider
  - OpenCode
- [x] Add tests for context body shape and preset metadata shape.

## Acceptance Criteria

- Context attach actions are provider-agnostic.
- A user can ask one agent to review another agent's diff.
- Presets are stored as metadata only and do not appear as active providers until a later enable flow exists.
- Context package output is deterministic and testable.

## Verification

```bash
pnpm exec vitest run \
  packages/server/src/__tests__/agent-context/context-package.test.ts \
  packages/server/src/__tests__/agent-context-command.test.ts \
  packages/providers/src/presets.test.ts
```

Expected: all tests pass.

## Suggested Commit

```bash
git add packages/core packages/server packages/providers
git commit -m "feat: attach workspace context to agents"
```
