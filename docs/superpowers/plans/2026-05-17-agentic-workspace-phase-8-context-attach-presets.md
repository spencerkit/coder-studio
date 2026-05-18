# Agentic Workspace Phase 8 Context Attach And Presets Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **Spec:** `docs/superpowers/specs/2026-05-17-agentic-workspace-platform-design.md`

**Goal:** Let users send workspace context to selected agents and add a lightweight preset foundation for future providers.

**Architecture:** Build a provider-agnostic context package format. UI actions create text payloads from files, diffs, terminal output, project summary, or session review and send them to a selected existing or new session.

**Tech Stack:** TypeScript, React, existing terminal/session input actions, Vitest, React Testing Library.

---

## Scope

Includes:

- Context package data model.
- Server helpers for file/diff/project/session context.
- Frontend "Send to agent" actions.
- Send diff to another agent.
- Preset provider metadata format, without installing presets by default.

Excludes:

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
- Create: `packages/web/src/features/agent-context/actions/use-send-context-to-agent.ts`
- Create: `packages/web/src/features/agent-context/components/send-context-menu.tsx`
- Create: `packages/web/src/features/agent-context/components/send-context-menu.test.tsx`
- Modify: `packages/web/src/features/session-review/components/session-review-panel.tsx`
- Modify: `packages/web/src/features/code-editor/views/shared/code-editor-host.tsx`
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

- [ ] Add context package types.
- [ ] Implement deterministic wrappers:

```text
Context: [title]
Source: [source]

[body]
```

- [ ] Implement context builders for file, diff, project summary, and session review.
- [ ] Add send action that can:
  - append context to an existing session
  - start a new session with context as draft
- [ ] Add UI menu actions:
  - Send file to agent
  - Send diff to agent
  - Send review summary to agent
  - Send project context to agent
- [ ] Add first preset metadata for future providers without exposing them as enabled providers:
  - Gemini CLI
  - Aider
  - OpenCode
- [ ] Add tests for context body shape and selected-agent routing.

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
  packages/web/src/features/agent-context/components/send-context-menu.test.tsx \
  packages/providers/src/presets.test.ts
```

Expected: all tests pass.

## Suggested Commit

```bash
git add packages/core packages/server packages/web/src/features/agent-context packages/web/src/features/session-review packages/web/src/features/code-editor packages/providers
git commit -m "feat: attach workspace context to agents"
```

