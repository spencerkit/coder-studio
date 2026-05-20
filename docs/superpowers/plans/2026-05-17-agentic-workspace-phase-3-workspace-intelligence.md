# Agentic Workspace Phase 3 Workspace Intelligence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **Spec:** `docs/superpowers/specs/2026-05-17-agentic-workspace-platform-design.md`

**Goal:** Add a project understanding layer that summarizes Git, package manager, framework, commands, docs, and agent instruction state for the active workspace.

**Architecture:** Server-side workspace inspection produces a typed `WorkspaceIntelligenceSummary`. The command stays server-facing and is reused by later agent-instruction and context flows; no dedicated workspace UI panel is kept in this phase.

**Tech Stack:** TypeScript, Node filesystem APIs, Zod, Vitest, React Testing Library.

---

## Scope

Includes:

- Workspace inspection module.
- `workspace.intelligence` command.
- Detection for Git, package managers, package scripts, common frameworks, README/docs, and `AGENTS.md`.

Excludes:

- Code indexing.
- Clone GitHub repo.
- Continue recent workspace flow.
- Provider install diagnosis.
- Automatic command execution.

## Files

- Modify: `packages/core/src/domain/types.ts`
- Create: `packages/server/src/workspace/intelligence.ts`
- Create: `packages/server/src/__tests__/workspace/intelligence.test.ts`
- Modify: `packages/server/src/commands/workspace.ts`
- Create: `packages/server/src/__tests__/workspace-intelligence-command.test.ts`

## Data Model

Add:

```ts
export interface WorkspaceIntelligenceSummary {
  workspaceId: string;
  rootPath: string;
  git: {
    isRepo: boolean;
    branch?: string;
  };
  packageManager?: "npm" | "pnpm" | "yarn" | "bun";
  frameworks: string[];
  scripts: {
    dev?: string;
    test?: string;
    build?: string;
    lint?: string;
  };
  recommendedCommands: Array<{
    key: "dev" | "test" | "build" | "lint";
    command: string;
    source: "package_json" | "makefile" | "detected";
  }>;
  docs: Array<{
    path: string;
    kind: "readme" | "docs";
  }>;
  agentInstructions: {
    exists: boolean;
    path: "AGENTS.md";
  };
}
```

## Tasks

- [ ] Implement package manager detection by lockfile priority: `pnpm-lock.yaml`, `yarn.lock`, `bun.lockb`, `package-lock.json`, then `package.json`.
- [ ] Implement package script extraction from `package.json`.
- [ ] Map common script names to recommended commands:
  - `dev`
  - `test`
  - `build`
  - `lint`
- [ ] Detect frameworks from dependencies and config files:
  - React
  - Vite
  - Next.js
  - Node
  - monorepo via `pnpm-workspace.yaml`, `turbo.json`, or `nx.json`
- [ ] Detect Git repository by checking `.git` file or directory.
- [ ] Detect docs via `README.md` and top-level `docs/`.
- [ ] Detect `AGENTS.md`.
- [ ] Register `workspace.intelligence`.
- [ ] Keep the command server-side and reuse it for later agent-instruction and context features.

## Acceptance Criteria

- Opening a workspace can produce a stable typed summary.
- Summary works for non-Git folders.
- Summary works when `package.json` is missing.
- UI surfaces for `AGENTS.md` are deferred to the agent-instructions phase.
- No provider-specific assumptions are required.

## Verification

```bash
pnpm exec vitest run \
  packages/server/src/__tests__/workspace/intelligence.test.ts \
  packages/server/src/__tests__/workspace-intelligence-command.test.ts
```

Expected: all tests pass.

## Suggested Commit

```bash
git add packages/core packages/server packages/web/src/features/workspace-intelligence packages/web/src/features/workspace/views/desktop/workspace-desktop-view.tsx
git commit -m "feat: add workspace intelligence summary"
```
