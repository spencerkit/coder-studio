# Git History Infinite Scroll Design

> Date: 2026-06-07
> Status: Approved for implementation
> Scope: Git history pagination and bottom-triggered loading

## Goal

The Git panel history section currently loads only the latest 20 commits. Users should be able to scroll to the bottom of the expanded history section and automatically load more commits.

## Current State

- `GitPanel` passes `initialHistoryLimit: 20` to `useGitPanelActions`.
- `useGitPanelActions` calls `git.log` with only `workspaceId` and `limit`.
- The server command `git.log` calls `getGitHistory(workspace.path, limit)`.
- `getGitHistory` runs `git log --max-count=N`, so the client can only reload a larger prefix instead of fetching the next page.

## Chosen Approach

Use cursor pagination based on the last loaded commit SHA.

The first request loads 20 commits. When the bottom sentinel enters the visible history area, the client calls `git.log` again with `afterSha` equal to the last loaded commit SHA and appends the returned entries.

This avoids repeatedly transferring the already loaded commits and keeps the contract simple.

## Server Contract

`git.log` accepts:

- `workspaceId`
- optional `limit`, clamped to the existing range
- optional `afterSha`, validated as a commit revision

It returns:

- `entries: GitCommitSummary[]`
- `hasMore: boolean`

`getGitHistory` requests one extra commit internally. If more than `limit` records are returned, it trims to `limit` and sets `hasMore: true`.

When `afterSha` is provided, Git should start after that commit using a revision range such as `<afterSha>..HEAD` with `--skip=1` semantics or an equivalent safe command shape.

## Web Behavior

- Initial history load remains 20 entries.
- Auto-load only runs while the history section is expanded.
- A bottom sentinel uses `IntersectionObserver` within the existing Git panel scroll container.
- While loading the next page, the existing list stays visible and a compact loading row appears at the bottom.
- If there are no more commits, no further requests are made.
- If loading fails, the existing list remains intact and the next sentinel pass may retry.
- History reload after a new `headSha` resets the list to the first page.

## Testing

Server tests should cover:

- `git.log` returns `entries` and `hasMore`.
- `afterSha` returns commits after the cursor without duplicating the cursor commit.

Web tests should cover:

- initial request still uses `limit: 20`.
- scrolling/intersecting the history bottom requests the next page with `afterSha`.
- appended entries render without replacing the first page.

## Out of Scope

- Commit search or filtering.
- Manual "load more" button.
- Graph or branch topology rendering.
- Persisting loaded history across page reloads.
