# Agentic Workspace Phase 4 Agent Instructions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **Spec:** `docs/superpowers/specs/2026-05-17-agentic-workspace-platform-design.md`

**Goal:** Let users create, inspect, and edit universal project-level agent instructions through `AGENTS.md`.

**Architecture:** Build on Workspace Intelligence. The server generates deterministic `AGENTS.md` content from project facts and exposes read/write/health commands. No separate workspace intelligence panel or dedicated frontend editor is part of this phase.

**Tech Stack:** TypeScript, Node filesystem APIs, Zod, Vitest, React Testing Library.

---

## Scope

Includes:

- `AGENTS.md` generation from workspace intelligence.
- Server commands to read, generate, write, and inspect instructions.
- Provider-specific notes section.
- Instruction health checks.

Excludes:

- Large template marketplace.
- Automatic provider prompt injection.
- Non-`AGENTS.md` instruction file formats.
- Complex natural-language rewriting.

## Files

- Modify: `packages/core/src/domain/types.ts`
- Create: `packages/server/src/agent-instructions/generator.ts`
- Create: `packages/server/src/agent-instructions/health.ts`
- Create: `packages/server/src/__tests__/agent-instructions/generator.test.ts`
- Create: `packages/server/src/__tests__/agent-instructions/health.test.ts`
- Create: `packages/server/src/commands/agent-instructions.ts`
- Modify: `packages/server/src/commands/index.ts`
- Create: `packages/server/src/__tests__/agent-instructions-command.test.ts`

## Commands

Add:

- `agentInstructions.read`
- `agentInstructions.generate`
- `agentInstructions.write`
- `agentInstructions.health`

## Generated File Shape

Generated `AGENTS.md` should use this structure:

```markdown
# Agent Instructions

## Project Overview

[Generated summary from workspace intelligence.]

## Development Commands

- Dev: `[command]`
- Test: `[command]`
- Build: `[command]`
- Lint: `[command]`

## Working Rules

- Keep changes focused on the requested task.
- Do not revert user changes unless explicitly asked.
- Prefer the project's existing patterns.
- Run the relevant verification command before reporting completion.

## Review Expectations

- Summarize changed files.
- Report verification commands and results.
- Call out risks, skipped tests, and assumptions.

## Provider Notes

- Claude Code: use the project rules above.
- Codex: use the project rules above.
```

Omit command lines that are unknown rather than inserting placeholders.

## Tasks

- [ ] Add `AgentInstructionsHealth` and `AgentInstructionsDocument` core types.
- [ ] Implement deterministic markdown generation.
- [ ] Implement health checks:
  - has project overview
  - has command section
  - has review expectations
  - has safety rules
- [ ] Implement server commands using safe workspace path resolution.
- [ ] Add command tests for missing workspace, missing file, generated content, write roundtrip, and health output.
- [ ] Add command-only workspace tests for create, edit, and health states.

## Acceptance Criteria

- Users can create `AGENTS.md` without leaving Coder Studio.
- Generated content includes commands only when detected.
- Feature language is provider-agnostic.
- Existing `AGENTS.md` is never overwritten without explicit user action.

## Verification

```bash
pnpm exec vitest run \
  packages/server/src/__tests__/agent-instructions/generator.test.ts \
  packages/server/src/__tests__/agent-instructions/health.test.ts \
  packages/server/src/__tests__/agent-instructions-command.test.ts
```

Expected: all tests pass.

## Suggested Commit

```bash
git add packages/core packages/server docs/superpowers/plans/2026-05-17-agentic-workspace-phase-4-agent-instructions.md
git commit -m "feat: add universal agent instructions"
```
