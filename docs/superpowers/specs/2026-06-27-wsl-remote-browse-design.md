# WSL Remote Browse Design

## Summary

Add end-to-end WSL directory browsing support with a split execution model:

- Before `workspace.open`, the launch flow uses host-mediated WSL browse commands executed from Windows through `wsl.exe`.
- After `workspace.open`, all WSL file browsing and directory creation flows run through the bound workspace runtime, so WSL workspaces use the WSL runtime rather than the Windows host filesystem.

This keeps launch-time path selection possible without a running workspace runtime while ensuring opened WSL workspaces use runtime-native filesystem semantics.

## Goals

- Allow the workspace launch modal to browse and create directories inside a selected WSL distro instead of requiring manual path entry.
- Ensure opened WSL workspaces use runtime-backed browse and directory creation behavior rather than host-mediated filesystem access.
- Reuse one browse result shape across native launch browse, WSL launch browse, and runtime browse.
- Preserve the existing native workspace launch flow without regression.

## Non-Goals

- Do not introduce a generic remote browse abstraction for non-WSL runtimes in this change.
- Do not require a temporary runtime before `workspace.open`.
- Do not replace the existing in-workspace `file.readTree` explorer flow with a different browse protocol.
- Do not add support for entering Windows UNC paths such as `\\\\wsl$\\Ubuntu\\...` as WSL browse inputs.

## Current State

### Launch-Time Browse

`workspace.browse` and `workspace.mkdir` currently execute on the server process and directly use host filesystem APIs. The launch modal always calls these host-native commands. On Windows, this means:

- native launch browse works against the Windows host filesystem
- WSL launch mode can select a distro, but the path field is manual input only
- there is no WSL-aware browse or create-directory path before `workspace.open`

### Opened Workspace File Operations

Most opened-workspace file operations already use runtime routing:

- `file.readTree`
- `file.read`
- `file.search`
- `file.searchContent`

For WSL workspaces, those commands route to the bound WSL runtime. That is the correct long-term execution model for post-open filesystem behavior. The remaining gap is browse-style directory navigation and directory creation flows that are either missing or still host-oriented.

## Chosen Approach

Use a two-layer model:

1. Pre-open WSL browse is host-mediated.
2. Post-open WSL browse is runtime-backed.

This is preferred over an all-host model because opened WSL workspaces should use WSL-native path, permission, and symlink semantics. It is preferred over an all-runtime model because launch-time browsing happens before a workspace runtime exists.

## Design

### Shared Browse Result Shape

Use one result shape for all directory-picker style browse commands:

```ts
interface DirectoryInfo {
  name: string;
  path: string;
  itemCount?: number;
}

interface BrowseResult {
  currentPath: string;
  parentPath: string | null;
  directories: DirectoryInfo[];
  rootPaths?: string[];
}
```

This matches the existing launch modal contract and avoids frontend-specific result normalization.

### Pre-Open WSL Browse Commands

Add host commands:

- `workspace.wsl.listDistros`
  - keep existing behavior
- `workspace.wsl.browse`
  - input: `{ distro: string, path?: string }`
  - output: `BrowseResult`
- `workspace.wsl.mkdir`
  - input: `{ distro: string, path: string }`
  - output: `{ ok: true }`

These commands are only for the pre-open launch flow.

#### Execution Model

The Windows host server runs `wsl.exe -d <distro> -- ...` and executes a small deterministic helper script inside the selected distro. The helper returns JSON for browse results and explicit failure categories for error mapping.

The helper must:

- resolve `path` to a canonical absolute WSL path
- treat empty input or `~` as the distro home directory
- list directories and symlinks that resolve to directories
- compute `parentPath`
- return stable `rootPaths`

The helper should not rely on locale-sensitive human-readable command output. JSON must be generated inside WSL and parsed on the host side.

#### Path Rules

Pre-open WSL browse accepts and returns Linux-style WSL paths only:

- `/home/spencer/project`
- `/mnt/c/...`

It does not accept Windows drive-letter paths or UNC WSL paths. Invalid or non-absolute inputs should return `invalid_path`, except for the explicit home shorthands `""`, `~`, and `~/...`.

#### Root Path Behavior

`rootPaths` for WSL browse should include:

- `/`
- the canonical home directory for the current distro

If the current path is under another first-level root such as `/mnt`, that root may also be included to preserve the existing chip model that highlights useful top-level anchors.

### Post-Open Runtime-Backed Browse

Add runtime commands:

- `file.browse`
  - input: `{ workspaceId: string, path?: string }`
  - output: `BrowseResult`
- `file.mkdirAbsolute`
  - input: `{ workspaceId: string, path: string }`
  - output: `{ ok: true }`

These commands are public runtime commands and resolve to `{ kind: "workspace", workspaceId }`.

#### Execution Model

The runtime directly uses its own filesystem view to resolve, enumerate, and create directories. This applies to both native and WSL workspaces:

- native workspace runtime returns host-native filesystem results
- WSL workspace runtime returns WSL-native filesystem results

This keeps browse behavior aligned with the same environment already serving `file.readTree` and `file.read`.

#### Why `file.*`

Opened-workspace filesystem operations already live under `file.*`. Adding browse and absolute mkdir there keeps command ownership consistent:

- `workspace.*` remains workspace lifecycle and launch oriented
- `file.*` remains opened-workspace filesystem oriented

### Frontend Changes

#### Launch Modal

Keep the current folder picker UI for both runtime targets.

When `targetRuntime === "native"`:

- continue to call `workspace.browse`
- continue to call `workspace.mkdir`

When `targetRuntime === "wsl"`:

- call `workspace.wsl.browse`
- call `workspace.wsl.mkdir`
- reload browse state when the selected distro changes
- keep the current directory chips, go-up action, create-folder flow, and selection model

The WSL path field should remain editable, but it should no longer be the only way to choose a path.

#### Opened Workspace Flows

Any opened-workspace directory-picker or absolute-path directory creation flow introduced or updated in this area should use:

- `file.browse`
- `file.mkdirAbsolute`

The existing explorer tree does not need to switch away from `file.readTree`.

### Error Handling

Use stable error codes so the frontend can preserve generic UX today and add finer-grained handling later.

Expected codes:

- `wsl_unavailable`
- `wsl_distro_not_found`
- `invalid_path`
- `not_found`
- `not_directory`
- `permission_denied`
- `browse_failed`
- `mkdir_failed`

#### Host WSL Browse Error Mapping

Map common host-mediated failures as follows:

- `wsl.exe` missing on Windows host -> `wsl_unavailable`
- distro not found or not runnable -> `wsl_distro_not_found`
- target path missing -> `not_found`
- target exists but is not a directory -> `not_directory`
- permission denied while enumerating or creating -> `permission_denied`
- invalid WSL path syntax -> `invalid_path`
- unexpected helper failure -> `browse_failed` or `mkdir_failed`

#### Runtime Browse Error Mapping

Map runtime-side filesystem errors into the same codes where possible so the frontend can treat host-mediated pre-open browse and runtime-backed post-open browse uniformly.

### Testing

#### Server Tests

Add coverage for:

- `workspace.wsl.browse`
  - resolves home correctly
  - lists directories
  - includes symlinked directories
  - computes parent path and root paths
  - handles missing distro
  - handles missing path
  - handles non-directory path
- `workspace.wsl.mkdir`
  - creates a directory successfully
  - rejects empty or invalid names
  - maps already-exists and permission failures correctly
- `file.browse`
  - returns expected browse data for a workspace
  - routes through runtime command dispatch for WSL workspaces
  - includes symlinked directories consistently
- `file.mkdirAbsolute`
  - creates a directory at an absolute path
  - rejects invalid paths and non-directory targets correctly

Host-side WSL tests should mock command execution rather than depend on a real Windows + WSL environment.

#### Frontend Tests

Add coverage for:

- launch modal in WSL mode renders a browseable directory list instead of path-entry-only behavior
- changing distro triggers a new browse load
- WSL create-folder refreshes the listing and selects the new directory
- native launch browse still uses the native command path

### Rollout Notes

- The change is additive at the command layer.
- Existing native launch behavior should remain unchanged.
- Existing opened-workspace explorer behavior should remain unchanged unless a specific directory-picker flow is migrated to `file.browse`.

## Implementation Checklist

- add host-side WSL browse and mkdir command handlers
- add helper utilities for WSL browse path normalization and JSON command execution
- update launch modal actions to branch between native and WSL browse commands
- add runtime `file.browse` and `file.mkdirAbsolute`
- add server and frontend regression tests

## Open Questions Resolved

- Launch-time WSL browse should not require a pre-started runtime.
- Opened-workspace WSL browse should use runtime-backed execution.
- The launch modal should support both manual path entry and interactive folder selection for WSL.
