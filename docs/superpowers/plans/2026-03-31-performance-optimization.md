# Workspace Performance Optimization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reduce unnecessary WS fan-out, frontend rerender/GC pressure, and repeated git/tree/watch work without changing the visible workspace UX.

**Architecture:** Keep the current user-facing workflow and WS event names, but make transport and refresh paths workspace-aware. The main changes are: route server events only to clients that actually have the workspace attached, split heavy artifact refreshes into smaller refresh classes with short-lived backend caches, and stop rewriting large workbench slices for every stream chunk.

**Tech Stack:** Rust backend, React + TypeScript frontend, Vite, cargo test, node:test, Playwright/manual browser profiling

---

## File Map

### Create

- `apps/server/src/services/transport_router.rs` — centralize transport routing policy, workspace attachment lookups, and optional event coalescing helpers.
- `apps/web/src/features/workspace/workspace-stream-index.ts` — hold indexed pending stream state keyed by workspace/session/terminal so flushes do not scan all tabs.

### Modify

- `apps/server/src/models.rs` — extend internal `TransportEvent` routing metadata so server-side dispatch can filter before JSON serialization.
- `apps/server/src/app.rs` — register any new transport router/cache state.
- `apps/server/src/ws/server.rs` — stop blindly forwarding every transport event to every socket; apply workspace-aware routing.
- `apps/server/src/services/workspace_runtime.rs` — reuse workspace attachment state for socket routing and keep attachment lifecycle correct on attach/detach/reconnect.
- `apps/server/src/services/workspace.rs` — ensure runtime/controller events preserve workspace scope for transport routing.
- `apps/server/src/services/workspace_watch.rs` — emit richer dirty payloads and reduce redundant dirty notifications.
- `apps/server/src/services/filesystem.rs` — cache/reuse workspace tree work for short windows and expose a cheaper path for structural refreshes.
- `apps/server/src/services/git.rs` — cache `git status` / `git changes` / branch metadata for short windows and avoid duplicate commands per refresh burst.
- `apps/server/src/infra/db.rs` — reuse workspace attachment queries if transport routing needs a workspace-id lookup per client.
- `apps/web/src/features/workspace/workspace-sync-hooks.ts` — split artifact refresh classes, debounce dirty refreshes per tab, and replace stream flush scans with indexed updates.
- `apps/web/src/features/workspace/WorkspaceScreen.tsx` — reduce top-level subscription fan-out where stream updates do not need to rerender the entire screen.
- `apps/web/src/features/agents/AgentWorkspaceFeature.tsx` — consume localized stream props/state so non-active panes do not rerender on every chunk.
- `apps/web/src/components/TreeView/TreeView.tsx` — stop recursive sort work on every render.
- `apps/web/src/shared/utils/tree.ts` — memoize or move sort work out of render.
- `apps/web/src/features/workspace/workspace-stream-buffer.ts` — replace repeated large string copies with chunked/ring-buffer appends.
- `apps/web/src/types/app.ts` — extend `ArtifactsDirtyEvent` if the backend starts sending category/workspace metadata.
- `apps/web/src/command/workspace.command.ts` — keep event typing aligned with any dirty-event payload refinement.

### Test

- `apps/server/src/command/http.rs` — add or extend integration tests around workspace attachments / runtime broadcasts.
- `apps/server/src/services/workspace_runtime.rs` — add routing-related unit tests if helpers live here.
- `tests/` targeted browser/runtime tests if needed for regressions in stream rendering or artifact refresh behavior.

## Task 1: Add Workspace-Aware Transport Routing

**Files:**
- Create: `apps/server/src/services/transport_router.rs`
- Modify: `apps/server/src/models.rs`
- Modify: `apps/server/src/app.rs`
- Modify: `apps/server/src/ws/server.rs`
- Modify: `apps/server/src/services/workspace_runtime.rs`
- Modify: `apps/server/src/infra/db.rs`
- Test: `apps/server/src/command/http.rs`

- [ ] **Step 1: Lock routing rules before implementation**

Document and test these rules:
- `agent://event`, `agent://lifecycle`, `terminal://event`, `workspace://controller`, and `workspace://runtime_state` only go to sockets whose `device_id/client_id` are attached to that workspace.
- truly global events, if any remain, still broadcast.
- clients with multiple open workspace tabs still receive events for all attached workspaces.

- [ ] **Step 2: Reuse existing workspace attachment state instead of inventing a second subscription model**

Implement routing lookups on top of the current workspace attachment records already maintained by:
- `upsert_workspace_attachment(...)`
- `list_workspace_ids_for_workspace_client(...)`
- `mark_workspace_client_detached(...)`

Do not add a parallel in-memory “subscribed workspace ids” source of truth unless the existing DB-backed attachment model proves too slow under measurement.

- [ ] **Step 3: Add internal routing metadata to `TransportEvent`**

Implement an internal scope field, for example:
- `workspace_id: Option<String>` for workspace-scoped events
- `scope: global | workspace`

Keep the external WS payload format unchanged so the frontend command layer does not need a protocol migration for this task.

- [ ] **Step 4: Filter before serialization in `ws_session`**

Move the decision ahead of `serde_json::to_string(...)`:
- if a socket is not attached to the event workspace, skip it before JSON encoding and `socket.send(...)`
- cache or precompute the socket’s attached workspace set so a single hot stream does not force a DB read per chunk

- [ ] **Step 5: Run targeted backend verification**

Run:

```bash
cargo test --manifest-path apps/server/Cargo.toml workspace_runtime ws_server command::http -- --nocapture
```

Expected:
- attached clients receive their own workspace stream/controller/runtime events
- unrelated clients do not receive them
- disconnect still releases controller state correctly

## Task 2: Split Artifact Refreshes And Add Short-Lived Backend Caches

**Files:**
- Modify: `apps/server/src/app.rs`
- Modify: `apps/server/src/services/workspace_watch.rs`
- Modify: `apps/server/src/services/filesystem.rs`
- Modify: `apps/server/src/services/git.rs`
- Modify: `apps/web/src/types/app.ts`
- Modify: `apps/web/src/command/workspace.command.ts`
- Modify: `apps/web/src/features/workspace/workspace-sync-hooks.ts`

- [ ] **Step 1: Refine dirty events so the frontend can choose a cheaper refresh path**

Extend `workspace://artifacts_dirty` payloads to include enough information to decide what to refresh:
- `workspace_id` when available
- a coarse category such as `git_status`, `tree_structure`, `worktree_meta`, or `mixed`
- keep existing `path`, `target`, and `reason`

If path-level classification is too noisy in the first pass, default to `mixed` and keep the old full refresh behavior as the fallback.

- [ ] **Step 2: Replace the current “always refresh all four endpoints” path**

In `useWorkspaceArtifactsSync(...)`, split refreshes into:
- git summary refresh: `getGitStatus` + `getGitChanges`
- tree refresh: `getWorkspaceTree`
- worktree refresh: `getWorktreeList`

Use the dirty category, active sidebar view, and active tab to decide which refreshes to run. Keep a fallback full refresh on reconnect or when classification is missing.

- [ ] **Step 3: Add short-lived server caches for bursty refresh traffic**

Cache for a very short TTL per repo/target pair:
- `git_status(...)`
- `git_changes(...)`
- `workspace_tree(...)`
- worktree listing if it exists in the same service layer

The target is to collapse duplicate refresh bursts from watcher events and visibility polling, not to introduce eventual-consistency lag. A 250ms-1000ms TTL is the right order of magnitude for the first pass.

- [ ] **Step 4: Debounce per-workspace artifact refresh requests on the frontend**

Keep only one in-flight refresh per workspace, but also debounce queued dirty refreshes so ten quick file events do not trigger ten sequential full refreshes after the first request finishes.

- [ ] **Step 5: Run focused verification**

Run:

```bash
pnpm build:web
```

Manual verification:
1. Edit tracked files repeatedly and confirm git counts update without reloading worktree/tree every time.
2. Add/remove files and confirm the file tree still updates.
3. Switch visibility offline/online and confirm fallback polling still recovers stale UI.

## Task 3: Localize Stream State And Stop Rewriting Large Workbench Slices

**Files:**
- Create: `apps/web/src/features/workspace/workspace-stream-index.ts`
- Modify: `apps/web/src/features/workspace/workspace-sync-hooks.ts`
- Modify: `apps/web/src/features/workspace/WorkspaceScreen.tsx`
- Modify: `apps/web/src/features/agents/AgentWorkspaceFeature.tsx`
- Modify: `apps/web/src/features/workspace/workspace-stream-buffer.ts`

- [ ] **Step 1: Replace array scans with indexed pending-stream maps**

Keep pending agent/terminal streams keyed by:
- `workspace_id + session_id`
- `workspace_id + terminal_id`

During flush, address the exact workspace/session/terminal directly instead of:
- `tabs.map(...)`
- `filter(...)` per tab
- `find(...)` per session/terminal

- [ ] **Step 2: Reduce render fan-out from `WorkspaceScreen`**

Do not let every stream chunk force a rerender of the entire top-level workbench tree. Move hot stream state to a localized structure that only updates:
- the active agent terminal
- the affected background session metadata (`unread`, `status`) without rebuilding unrelated tabs

- [ ] **Step 3: Replace repeated string concatenation with chunked buffering**

Change `appendBufferedText(...)` from repeated:

```ts
`${current}${chunk}`.slice(-limit)
```

to a chunked/ring-buffer approach that:
- appends in O(1) amortized work
- compacts only when the retained size crosses the cap
- keeps the same visible buffer limit

- [ ] **Step 4: Keep session unread/status behavior identical**

Regression surface for this task is not visual layout, it is behavioral parity:
- background sessions must still increment unread
- active session unread stays at zero
- exit/system events still append messages and update status

- [ ] **Step 5: Verify stream behavior**

Manual verification:
1. Run a long Codex/Claude stream and confirm active output stays smooth.
2. Keep a second session in the background and confirm unread increments.
3. Reconnect the WS and confirm resume/resync still restores the visible stream snapshot.

## Task 4: Reduce Watch Registration And Tree Render Work

**Files:**
- Modify: `apps/server/src/services/workspace_watch.rs`
- Modify: `apps/server/src/services/filesystem.rs`
- Modify: `apps/web/src/components/TreeView/TreeView.tsx`
- Modify: `apps/web/src/shared/utils/tree.ts`

- [ ] **Step 1: Stop watching every visible directory when a smaller watch set is enough**

Prefer:
- one recursive watch rooted at the workspace where platform behavior allows it
- explicit git metadata watches only for `.git` paths that matter

Keep the existing per-directory fallback only where recursive watching is not reliable enough.

- [ ] **Step 2: Remove full-tree sort work from render**

Sort once when ingesting backend data or memoize by:
- tree identity
- locale

Also move `selectedPath` normalization outside the node loop.

- [ ] **Step 3: Keep large-repo fallback options explicit**

If tree rendering is still a hotspot after memoization, add virtualization behind the file tree only. Do not mix this into the first optimization pass unless measurement still shows a tree bottleneck after the cheaper fixes.

- [ ] **Step 4: Verify repo-open and file-tree behavior**

Manual verification:
1. Open a larger repo and confirm watch startup does not stall.
2. Expand/collapse deep trees and confirm selection/highlight behavior is unchanged.
3. Rename files and confirm change badges/tree entries stay correct.

## Task 5: Rollout Order And Regression Sweep

**Files:**
- Modify if needed based on verification fallout.

- [ ] **Step 1: Land backend routing first**

This is the highest backend ROI and does not require a visible UX change. It also reduces the amount of useless frontend work before the frontend optimizations land.

- [ ] **Step 2: Land artifact refresh split/caching second**

This targets the next most expensive repeated work and is easier to measure after WS fan-out is reduced.

- [ ] **Step 3: Land frontend stream localization third**

This is the highest frontend ROI, but it touches the hottest UI behavior and should be implemented after the transport path is already cleaner.

- [ ] **Step 4: Land watcher/tree optimizations last**

These are important for larger repos, but they are lower priority than the hot streaming/refresh loops unless measurement shows repo-open latency is the immediate blocker.

- [ ] **Step 5: Run final verification**

Run:

```bash
pnpm build:web
```

```bash
cargo test --manifest-path apps/server/Cargo.toml
```

Manual sweep:
1. Agent start, stream, exit, resume
2. Terminal output and input
3. File tree refresh after add/delete/rename
4. Git status/diff/worktree panels
5. Multi-workspace tabs on one client
6. Two clients attached to different workspaces

## Impact Notes

- **Lowest-risk/highest-ROI first:** WS routing and artifact refresh splitting. These can preserve protocol and UI behavior while removing the biggest waste.
- **Medium-risk:** frontend stream localization. It improves hot-path rendering, but touches unread counts, active-session status, and resync behavior.
- **Higher-risk but bounded:** watcher strategy changes. They are mostly backend-internal, but platform-specific watch behavior can regress file tree freshness if changed too aggressively.
- **Deliberate non-goal for the first pass:** visual redesign, auth changes, agent protocol changes, or replacing the existing workspace data model.
