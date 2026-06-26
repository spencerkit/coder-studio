# Agent Instructions

## Project Overview

Coder Studio is a monorepo that ships a single CLI npm package containing two internal assembled artifacts: a web frontend UI (`packages/web`) and a Node.js backend runtime (`packages/server`). Provider integrations and shared utilities live in dedicated packages. The project uses pnpm and supports Node-based development and production builds.

## Architecture Map

### Web (frontend_ui)
- Primary entrypoint for user-facing UI
- UI/workspace actions: `packages/web/src/features/workspace/actions/` → `packages/server/src/ws/dispatch.ts` → `packages/server/src/commands/*.ts`
- Agent instructions generation: `packages/web/src/features/workspace/actions/use-agent-instructions-actions.ts` → `packages/server/src/commands/agent-instructions.ts` → `packages/server/src/agent-instructions/agent-generator.ts` → `packages/server/src/agent-instructions/prompt.ts` → `packages/server/src/workspace/intelligence.ts`
- **Start here** for UI changes, feature hooks, and frontend component work

### Server (backend_runtime)
- Owns WebSocket dispatch and command execution
- Command routing: `packages/server/src/ws/dispatch.ts` → `packages/server/src/commands/*.ts`
- Agent generator: `packages/server/src/agent-instructions/agent-generator.ts` → `prompt.ts` → `workspace/intelligence.ts`
- **Start here** for server/runtime changes, command handlers, and workspace intelligence

### Providers (provider_integrations)
- External model/runtime adapters with definition + headless/supervisor builders
- Execution path: `packages/providers/src/*/definition.ts` + provider-specific headless/supervisor builders → `packages/server/src/provider-runtime/command-runner.ts`
- **Start here** for provider changes and runtime adapter work

### Core (shared_contracts)
- Domain types and provider interfaces shared across all packages
- Key files: `packages/core/src/domain/types.ts`, `packages/core/src/provider/definition.ts`
- **Inspect first** for type/contract changes that cross package boundaries

### CLI (cli_entrypoint)
- Command-line launcher and entrypoint behavior
- **Start here** for CLI behavior and launcher configuration

### Utils (shared_utilities)
- Reusable utilities consumed by multiple packages
- Shared helpers and cross-cutting concerns

## Key Directories

- `packages/web` — Primary frontend UI package for user-facing behavior
- `packages/server` — Backend runtime that owns WebSocket dispatch and command execution
- `packages/providers` — Provider integration package for external model/runtime adapters
- `packages/core` — Shared contracts and types used across packages
- `packages/cli` — Command-line entrypoint and launcher behavior
- `packages/utils` — Shared utility package reused by multiple packages

## Development Commands

- **Dev server**: `pnpm dev` — Start the development environment
- **Build all packages**: `pnpm build` — Run production builds for all packages
- **Lint all packages**: `pnpm lint` — Run linting across the monorepo
- **CI verification**: `pnpm ci:verify` — Repository-level validation before handoff
- **Full test suite**: `pnpm ci:test` — Repository-level test validation before handoff
- **E2E UI tests**: `pnpm e2e-ui` — End-to-end UI validation before handoff

## Workflow Expectations

- Keep changes focused on the requested task.
- Do not revert user changes unless explicitly asked.
- Do not use squash merge or delete branches during PR/merge workflows unless the user explicitly asks for squash merging or branch deletion.
- Prefer the project's existing patterns.
- Run the relevant verification command before reporting completion.

## File Constraints

- Respect package boundaries and keep changes scoped to the package you are touching unless cross-package edits are required.
- Avoid unrelated refactors across packages while solving a targeted task.
- Keep frontend changes in `packages/web` and backend runtime changes in `packages/server` unless the task explicitly crosses layers.
- Provider logic stays in `packages/providers`. Shared contracts and types live in `packages/core`. CLI entrypoint logic lives in `packages/cli`.
- Use repository-level verification commands before claiming completion.

## Review Checklist

- Summarize changed files.
- Report verification commands and results.
- Call out risks, skipped tests, and assumptions.

## Provider Notes

- Claude Code: use the project rules above.
- Codex: use the project rules above.
