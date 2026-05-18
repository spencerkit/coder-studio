# Agentic Workspace Phase 2 Provider Registry Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **Spec:** `docs/superpowers/specs/2026-05-17-agentic-workspace-platform-design.md`

**Goal:** Productize the existing provider registry so Coder Studio can present itself as an agent-agnostic platform without replacing the current Claude Code and Codex implementation.

**Architecture:** Extend the existing `ProviderDefinition` shape with platform-facing metadata and capabilities. Add a provider listing command that exposes safe provider metadata to the web app without leaking executable internals.

**Tech Stack:** TypeScript, Zod, Vitest, existing websocket command dispatch.

---

## Scope

Includes:

- Capability metadata on `ProviderDefinition`.
- Safe DTO for frontend provider listing.
- `provider.list` server command.
- Tests for Claude/Codex provider metadata.
- Frontend hook to consume provider list.

Excludes:

- Custom provider persistence.
- New provider presets.
- Install diagnosis redesign.
- Provider marketplace.

## Files

- Modify: `packages/core/src/provider/definition.ts`
- Modify: `packages/core/src/domain/types.ts`
- Modify: `packages/providers/src/claude/definition.ts`
- Modify: `packages/providers/src/codex/definition.ts`
- Modify: `packages/providers/src/registry.ts`
- Modify: `packages/providers/src/registry.test.ts`
- Modify: `packages/server/src/commands/provider.ts`
- Create: `packages/server/src/__tests__/provider-list.test.ts`
- Create: `packages/web/src/features/agent-providers/actions/use-agent-providers.ts`
- Create: `packages/web/src/features/agent-providers/actions/use-agent-providers.test.tsx`

## Data Model

Add:

```ts
export type ProviderKind = "built_in" | "preset" | "custom";

export type ProviderCapabilityKey =
  | "interactive_session"
  | "supervisor_eval"
  | "idle_detection"
  | "context_attach"
  | "review";

export interface ProviderCapabilityDescriptor {
  key: ProviderCapabilityKey;
  supported: boolean;
  label: string;
}

export interface ProviderListItem {
  id: string;
  displayName: string;
  badge: string;
  kind: ProviderKind;
  capability: "full" | "limited" | "unsupported";
  capabilities: ProviderCapabilityDescriptor[];
  requiredCommands: string[];
}
```

Extend `ProviderDefinition` with:

```ts
kind: ProviderKind;
capabilities: ProviderCapabilityDescriptor[];
```

## Tasks

- [ ] Add provider platform types to `packages/core/src/provider/definition.ts` or `packages/core/src/domain/types.ts`.
- [ ] Set `kind: "built_in"` for Claude Code and Codex definitions.
- [ ] Add explicit capabilities for Claude Code and Codex:

```ts
[
  { key: "interactive_session", supported: true, label: "Interactive session" },
  { key: "supervisor_eval", supported: true, label: "Supervisor evaluation" },
  { key: "idle_detection", supported: true, label: "Idle detection" },
  { key: "context_attach", supported: false, label: "Context attach" },
  { key: "review", supported: false, label: "Review" },
]
```

- [ ] Add `toProviderListItem(provider)` helper in `packages/providers/src/registry.ts`.
- [ ] Add tests proving Claude and Codex return safe DTOs.
- [ ] Register `provider.list` in `packages/server/src/commands/provider.ts`.
- [ ] Add server command test asserting `provider.list` returns built-in provider DTOs.
- [ ] Create frontend hook `useAgentProviders()` that calls `provider.list`.
- [ ] Add hook test with mocked websocket dispatch.

## Acceptance Criteria

- The frontend has a provider-agnostic list API.
- Provider executable construction remains server-only.
- Claude Code and Codex appear as built-in providers.
- No custom provider functionality is introduced yet.

## Verification

```bash
pnpm exec vitest run \
  packages/providers/src/registry.test.ts \
  packages/server/src/__tests__/provider-list.test.ts \
  packages/web/src/features/agent-providers/actions/use-agent-providers.test.tsx
```

Expected: all tests pass.

## Suggested Commit

```bash
git add packages/core packages/providers packages/server packages/web/src/features/agent-providers
git commit -m "feat: expose agent provider registry"
```

