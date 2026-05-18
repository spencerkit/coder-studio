# Agentic Workspace Phase 5 Custom Agent MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **Spec:** `docs/superpowers/specs/2026-05-17-agentic-workspace-platform-design.md`

**Goal:** Allow users to define a command-based custom coding agent and launch it like a built-in provider.

**Architecture:** Add persistent custom provider configs that are converted into runtime `ProviderDefinition` objects on the server. Keep the MVP limited to command-based PTY sessions and one-shot command sessions.

**Tech Stack:** TypeScript, SQLite repository pattern, Zod, Vitest, existing PTY session manager.

---

## Scope

Includes:

- Custom provider storage.
- Command-based custom provider definition builder.
- Settings UI for custom providers.
- Launch support through existing `session.create`.
- Basic command validation.

Excludes:

- Marketplace.
- Community provider import/export.
- OAuth/auth setup.
- Vendor-specific install diagnosis.
- Complex output parsing.

## Files

- Modify: `packages/core/src/provider/definition.ts`
- Modify: `packages/core/src/domain/types.ts`
- Modify: `packages/server/src/storage/migrations/001_init.sql`
- Create: `packages/server/src/storage/repositories/custom-provider-repo.ts`
- Create: `packages/server/src/__tests__/custom-provider-repo.test.ts`
- Create: `packages/server/src/provider-runtime/custom-provider.ts`
- Create: `packages/server/src/__tests__/provider-runtime/custom-provider.test.ts`
- Create: `packages/server/src/commands/custom-provider.ts`
- Modify: `packages/server/src/commands/index.ts`
- Modify: `packages/server/src/server.ts`
- Create: `packages/server/src/__tests__/custom-provider-command.test.ts`
- Create: `packages/web/src/features/agent-providers/components/custom-provider-form.tsx`
- Create: `packages/web/src/features/agent-providers/components/custom-provider-form.test.tsx`
- Modify: `packages/web/src/features/settings/components/provider-settings.tsx`

## Data Model

Add:

```ts
export type CustomProviderSessionMode = "interactive" | "one_shot";

export interface CustomProviderConfig {
  id: string;
  displayName: string;
  command: string;
  args: string[];
  env: Record<string, string>;
  cwdMode: "workspace_root";
  sessionMode: CustomProviderSessionMode;
  startupPrompt?: string;
  capabilities: ProviderCapabilityDescriptor[];
  createdAt: number;
  updatedAt: number;
}
```

## Commands

Add:

- `customProvider.list`
- `customProvider.create`
- `customProvider.update`
- `customProvider.delete`

## Tasks

- [ ] Add custom provider types and validation rules.
- [ ] Add SQLite table:

```sql
CREATE TABLE IF NOT EXISTS custom_providers (
  id TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  config TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
```

- [ ] Implement repository list/get/set/delete.
- [ ] Implement custom provider builder that returns a `ProviderDefinition`.
- [ ] Make `requiredCommands` use the first command token.
- [ ] Make `buildCommand` resolve cwd to workspace root.
- [ ] Merge built-in registry and custom provider definitions in server command context.
- [ ] Add command tests for create/update/delete/list.
- [ ] Add settings UI form with fields:
  - display name
  - command
  - args
  - env vars
  - session mode
  - startup prompt
  - capabilities
- [ ] Add launch test proving a custom provider can be selected and passed to `session.create`.

## Acceptance Criteria

- Users can create a custom provider without editing repo files.
- Custom providers appear in provider list as `kind: "custom"`.
- Custom interactive providers can launch through the existing session flow.
- Invalid empty command is rejected.
- Custom provider deletion does not delete historical sessions.

## Verification

```bash
pnpm exec vitest run \
  packages/server/src/__tests__/custom-provider-repo.test.ts \
  packages/server/src/__tests__/provider-runtime/custom-provider.test.ts \
  packages/server/src/__tests__/custom-provider-command.test.ts \
  packages/web/src/features/agent-providers/components/custom-provider-form.test.tsx
```

Expected: all tests pass.

## Suggested Commit

```bash
git add packages/core packages/server packages/web/src/features/agent-providers packages/web/src/features/settings/components/provider-settings.tsx
git commit -m "feat: add command-based custom agents"
```

