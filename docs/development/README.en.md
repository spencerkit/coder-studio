# Development Docs

[中文](README.md)

This directory documents how the current implementation works. The goal is to help contributors understand the code as it exists today, not to describe future plans.

## Suggested Reading Order

1. `architecture.en.md`: overall layering, runtime structure, and major data flows
2. `frontend-state.en.md`: frontend entities and state transitions
3. `tauri-commands.en.md`: Tauri command inventory, transport layer, and event channels

## Local Development

Install dependencies:

```bash
pnpm install
```

Desktop development mode:

```bash
pnpm tauri dev
```

Split debugging mode:

```bash
pnpm dev
pnpm dev:backend
```

Current development ports:

- frontend: `127.0.0.1:5174`
- backend transport service: `127.0.0.1:41033`

## Key Code Locations

- main frontend view: `src/App.tsx`
- frontend global state: `src/state/workbench.ts`
- frontend shared types: `src/types/app.ts`
- HTTP RPC wrappers: `src/services/http/`
- WebSocket event layer: `src/ws/`
- Tauri entry point: `src-tauri/src/main.rs`
- Tauri HTTP transport layer: `src-tauri/src/command/http.rs`
- Rust services: `src-tauri/src/services/`

## Document Index

- Architecture: `docs/development/architecture.en.md`
- Frontend state: `docs/development/frontend-state.en.md`
- Tauri commands: `docs/development/tauri-commands.en.md`

Chinese versions:

- `docs/development/README.md`
- `docs/development/architecture.md`
- `docs/development/frontend-state.md`
- `docs/development/tauri-commands.md`

## Related Docs

- User guide: `README.en.md`
- Chinese user guide: `README.md`
- Chinese deployment guide: `docs/deployment/README.md`
- English deployment guide: `docs/deployment/README.en.md`
- Chinese PRD: `docs/PRD.md`
- English PRD: `docs/PRD.en.md`

## Documentation Rules

- document only currently implemented behavior
- distinguish between backend capability and fully surfaced UI capability
- keep end-user usage in `README` and implementation detail in this directory
- keep terminology aligned with code: `workspace`, `session`, `pane`, `terminal`, `archive`, `worktree`
