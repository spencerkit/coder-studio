# Terminal Profiles — Design

> Status: Draft for user review
> Date: 2026-06-24
> Scope: `packages/core`, `packages/server`, `packages/web`, terminal settings/tests

## Problem

Coder Studio's shell terminal flow currently has no terminal profile model.

The current behavior is hardcoded in the server:

- shell terminal creation resolves a single default shell in [`packages/server/src/commands/terminal.ts`](../../../packages/server/src/commands/terminal.ts)
- on Windows that default is `ComSpec` / `cmd.exe`
- the web terminal toolbar only exposes a single "new terminal" action in [`packages/web/src/features/terminal-panel/views/shared/terminal-panel.tsx`](../../../packages/web/src/features/terminal-panel/views/shared/terminal-panel.tsx)
- the terminal create action does not accept a profile identifier in [`packages/web/src/features/terminal-panel/actions/use-create-shell-terminal.ts`](../../../packages/web/src/features/terminal-panel/actions/use-create-shell-terminal.ts)

That leaves three product gaps:

1. Windows users are pushed into `cmd.exe` even when they prefer PowerShell, Git Bash, or WSL.
2. There is no VS Code style split between "open default terminal quickly" and "pick a different terminal when needed".
3. There is no stable settings model for a default terminal profile or user-defined profiles.

The user wants VS Code style behavior:

- one configured default profile
- one-click open for the default profile
- a chooser for opening another profile each time
- auto-detected profiles plus user-defined custom profiles
- one cross-platform model, with Windows and WSL handled well in v1

## Goals

- Introduce a unified terminal profile model for Windows, macOS, and Linux.
- Make the server the single source of truth for detected, custom, and resolved default profiles.
- Add a VS Code style split-button entry for new terminals on desktop.
- Add a mobile-friendly chooser flow that preserves the same default-plus-picker mental model.
- Allow users to configure a global default terminal profile.
- Allow users to create, edit, and delete custom profiles.
- Support detected WSL distro profiles on Windows.
- Keep terminal creation server-validated instead of letting the client construct arbitrary shell invocations.

## Non-Goals

- Do not redesign the full workspace runtime model in this phase.
- Do not make terminal profiles workspace-specific in v1.
- Do not implement split terminal, debug terminal, or task-profile integrations in v1.
- Do not import or mirror the user's local VS Code terminal settings automatically.
- Do not expose profile-level environment variable editing in v1.
- Do not rebuild the settings navigation structure around a new top-level terminal section.
- Do not silently substitute a different shell when the user explicitly selected an unavailable profile.

## Current Context

Relevant current behavior:

- `terminal.create` resolves one shell directly on the server and does not accept profile selection.
- the terminal toolbar has one create action but no profile dropdown.
- terminal settings today cover renderer, copy-on-select, and font size, but no profile settings.
- the settings command schema already supports nested top-level groups, so a new `terminal.*` namespace is feasible in [`packages/server/src/commands/settings.ts`](../../../packages/server/src/commands/settings.ts)
- workspace metadata already includes `targetRuntime` and `wslDistro` in [`packages/core/src/domain/types.ts`](../../../packages/core/src/domain/types.ts), but the current workspace open flow still defaults to native runtime in [`packages/server/src/commands/workspace.ts`](../../../packages/server/src/commands/workspace.ts)
- runtime binding also does not currently distinguish WSL in [`packages/server/src/server.ts`](../../../packages/server/src/server.ts)

Relevant files:

- `packages/core/src/domain/types.ts`
- `packages/server/src/commands/terminal.ts`
- `packages/server/src/commands/settings.ts`
- `packages/server/src/provider-runtime/command-check.ts`
- `packages/server/src/workspace/runtime-check.ts`
- `packages/web/src/features/terminal-panel/views/shared/terminal-panel.tsx`
- `packages/web/src/features/terminal-panel/actions/use-create-shell-terminal.ts`
- `packages/web/src/features/terminal-panel/actions/use-terminal-actions.ts`
- `packages/web/src/features/settings/components/settings-page.tsx`

## User Decisions Captured

- Match the VS Code model: keep a default profile and also let the user choose another profile when opening a terminal.
- Build one cross-platform terminal profile model instead of a Windows-only one.
- Prioritize Windows behavior first.
- Use auto-detected profiles plus user-defined custom profiles.
- Treat WSL as part of the terminal profile system for this phase.
- Prefer the server-owned architecture over a client-owned shell-command model.
- Keep the current settings page structure and add terminal profile controls into the existing general terminal settings area.

## Approaches Considered

### Option A: Client-owned profiles and shell command construction

The web client would detect profiles, store profile metadata, and send raw shell commands to the server when creating a terminal.

Pros:

- quick to prototype
- minimal server-side surface expansion

Cons:

- duplicates platform-specific detection logic in the client
- pushes Windows, Git Bash, and WSL path handling into the browser layer
- weakens server-side validation
- makes tests and future desktop/mobile parity harder

Decision: reject.

### Option B: Server-owned terminal profile registry with client chooser support

The server detects built-in profiles, merges them with custom profiles, resolves a default profile, and creates terminals from a `profileId`. The client renders the picker and settings UI.

Pros:

- one authority for profile detection and resolution
- preserves server-side validation and platform-specific logic
- keeps the client thin
- fits the existing `settings.get/settings.update` pattern
- makes WSL and Windows path handling testable on the server

Cons:

- requires new command surfaces and DTOs
- requires a small amount of settings model expansion

Decision: accept.

### Option C: Full VS Code parity in one phase

This would include split terminal, debug terminal, task terminal profile routing, per-workspace defaults, profile icons and ordering semantics, and deep runtime integration.

Pros:

- most complete long-term model

Cons:

- much larger than the user request
- entangles terminal profile work with unrelated terminal subsystems
- increases regression risk significantly

Decision: reject for this phase.

## Final Choice

Adopt Option B.

This phase introduces a server-owned terminal profile registry and resolution flow, with the web client consuming that model for terminal creation and settings management. The product outcome matches the requested VS Code behavior without coupling the work to a wider runtime redesign.

## Final Design

### 1. Core DTOs

Add a new terminal profile DTO to `@coder-studio/core`.

Recommended shape:

```ts
export type TerminalProfileSource = "detected" | "custom";
export type TerminalProfileRuntime = "native" | "wsl";

export interface TerminalProfile {
  id: string;
  label: string;
  source: TerminalProfileSource;
  runtime: TerminalProfileRuntime;
  icon: string;
}

export interface TerminalProfilesListResult {
  profiles: TerminalProfile[];
  configuredDefaultProfileId?: string;
  resolvedDefaultProfileId: string | null;
}
```

Notes:

- `id` must be stable and opaque to the client.
- `icon` is a semantic token or small identifier, not a raw asset path.
- the DTO intentionally excludes launch-time internals such as `command`, `args`, or `env`.

### 2. Settings Model

Introduce a new top-level `terminal` settings namespace instead of putting profile selection under `appearance`.

Recommended persisted shape:

```ts
terminal: {
  defaultProfileId?: string;
  profiles?: Array<{
    id: string;
    label: string;
    command: string;
    args?: string[];
    icon?: string;
  }>;
}
```

Rules:

- `terminal.defaultProfileId` stores the user's preferred profile id.
- `terminal.profiles` stores only custom profiles.
- detected profiles are not persisted into settings.
- custom profile ids are generated once and stay stable across label edits.

Validation rules:

- `label` is required and non-empty.
- `command` is required and non-empty.
- `args`, if present, must be a string array.
- duplicate custom ids are rejected.

Why top-level `terminal`:

- profile selection is a runtime launch concern, not a visual appearance preference
- keeping it out of `appearance.*` avoids semantic drift as the feature grows

### 3. Stable Profile Id Rules

Detected profiles should use stable generated ids:

- `detected:win:pwsh`
- `detected:win:powershell`
- `detected:win:cmd`
- `detected:win:git-bash`
- `detected:win:wsl:Ubuntu-24.04`
- `detected:posix:zsh`
- `detected:posix:bash`

Custom profiles should use:

- `custom:<generated-id>`

This keeps `defaultProfileId` stable even when labels are renamed for display.

### 4. Server Profile Registry

Add a dedicated server module for terminal profiles, for example:

- `packages/server/src/terminal-profiles/index.ts`
- `packages/server/src/terminal-profiles/detect.ts`
- `packages/server/src/terminal-profiles/resolve.ts`

Responsibilities:

- detect built-in and system-available profiles for the current host platform
- read custom profiles from settings
- merge detected and custom profiles
- resolve the active default profile
- translate `profileId` into a concrete terminal spawn spec

The registry should be the only place that knows:

- how a profile is detected
- how a profile is launched
- how Windows and WSL cwd mapping works

### 5. Detection Strategy

Detection uses the existing command availability infrastructure in [`packages/server/src/provider-runtime/command-check.ts`](../../../packages/server/src/provider-runtime/command-check.ts).

#### Windows

Detect in this order:

- `pwsh`
- `powershell`
- `cmd` / `ComSpec`
- Git Bash via `bash` or known Git install paths
- `wsl`

If `wsl` is available:

- run `wsl -l -q`
- trim empty lines
- emit one detected profile per distro, such as `Ubuntu-24.04 (WSL)`

Recommended default resolution order on Windows:

1. `pwsh`
2. `powershell`
3. `cmd`
4. first detected Git Bash
5. first detected WSL distro

#### macOS and Linux

Detect:

- current `$SHELL`
- `zsh`
- `bash`
- `fish`
- `pwsh`

Then de-duplicate by launch identity and keep the current shell first if available.

Recommended default resolution order on POSIX:

1. current `$SHELL`
2. `zsh`
3. `bash`
4. `fish`
5. `pwsh`

### 6. New and Updated Commands

#### `terminal.profiles.list`

Add a new runtime command:

```ts
terminal.profiles.list({ workspaceId })
```

Response:

- `profiles`
- `configuredDefaultProfileId`
- `resolvedDefaultProfileId`

Behavior:

- profile availability is computed at request time
- if a configured default is unavailable, keep reporting it in `configuredDefaultProfileId`
- `resolvedDefaultProfileId` must point to a real available profile or `null`

#### `terminal.create`

Extend the existing `terminal.create` input with:

```ts
profileId?: string
```

Behavior:

- if `profileId` is omitted, create using `resolvedDefaultProfileId`
- if `profileId` is present but unavailable, return an explicit error
- do not silently fall back when the user explicitly selected a profile
- preserve the current `cwdPath`, `cols`, `rows`, and `themeBackground` handling

### 7. Launch Resolution

The profile registry resolves `profileId` into a launch spec used by the terminal manager.

Examples:

- `PowerShell`: `["pwsh"]` or `["powershell.exe"]`
- `Command Prompt`: `[resolvedComSpec]`
- `Git Bash`: `[resolvedPathToBash]`
- `WSL distro`: `["wsl.exe", "-d", "<distro>", "--cd", "<mapped-cwd>"]`
- custom profile: `[command, ...args]`

The terminal title should prefer the profile label rather than a basename-derived shell name. This lets tabs show `PowerShell`, `Git Bash`, or `Ubuntu-24.04 (WSL)` clearly.

### 8. WSL Behavior

For this phase, WSL is treated as a terminal profile family, not as a full workspace runtime integration.

#### CWD mapping

When opening a WSL profile from a Windows-hosted workspace path:

- map `C:\repo\app` to `/mnt/c/repo/app`
- map drive letters case-insensitively
- normalize backslashes to slashes

If mapping fails safely:

- fall back to the distro default home directory
- do not fail terminal creation solely because cwd mapping was impossible

#### Why not bind this to workspace runtime now

The current workspace runtime path is not consistently WSL-aware yet:

- workspace open still defaults to native runtime
- runtime bindings do not select a distinct WSL runtime id

Bundling that redesign into terminal profiles would make the phase too large. The profile system should therefore stand on its own in v1.

### 9. Client UI

#### Desktop terminal toolbar

Replace the single new-terminal trigger with a VS Code style split button:

- primary button: open the resolved default profile
- chevron button: open the terminal profile chooser

Chooser content:

- highlighted default item at the top
- grouped `Detected` and `Custom` sections
- item click creates a terminal with the selected profile
- footer action: `Configure Terminal Profiles…`

#### Mobile terminal toolbar

Do not force a desktop-style split button into the constrained mobile header.

Instead:

- the existing create trigger opens a mobile sheet
- the first item is `Open Default: <profile>`
- remaining items list the other available profiles

This keeps the same model without overloading the mobile header layout.

### 10. Settings UI

Do not add a new top-level settings section.

Place terminal profile controls into the existing terminal-related area of `GeneralSettings` in [`packages/web/src/features/settings/components/settings-page.tsx`](../../../packages/web/src/features/settings/components/settings-page.tsx).

Add:

- `Default Profile` select
- `Detected Profiles` read-only list
- `Custom Profiles` editable list
- `Add Profile` action

Custom profile editor fields in v1:

- `label`
- `command`
- `args`

Do not expose:

- environment variables
- workspace-scoped overrides
- icon editing

### 11. Default Resolution and Failure Modes

#### Default resolution

If the configured default profile exists and is available:

- use it

If the configured default profile is missing:

- keep reporting it as `configuredDefaultProfileId`
- compute a fallback `resolvedDefaultProfileId`
- let the UI surface a soft warning that the configured default is unavailable

#### Explicit profile creation failure

If the user explicitly chose a profile and it is unavailable or spawn fails:

- return an error
- show a toast in the UI
- do not silently switch to another profile

This preserves predictability.

### 12. Architecture

```text
settings.get / settings.update
          |
          v
server terminal profile registry
  |- detect built-in/system profiles
  |- load custom profiles
  |- resolve default profile
  |- map profileId -> launch spec
          |
          +--> terminal.profiles.list
          |
          +--> terminal.create(profileId?)
                      |
                      v
                 TerminalManager.create()
```

### 13. Testing

#### Server tests

- detected Windows profile list generation
- `wsl -l -q` parsing
- default profile resolution when configured default is missing
- `terminal.create` profile selection and explicit error behavior
- WSL cwd mapping from Windows paths
- custom profile settings validation

#### Web tests

- desktop split button primary action opens the resolved default profile
- desktop chooser renders detected and custom groups
- mobile create flow shows default-first sheet
- settings page updates `terminal.defaultProfileId`
- custom profile create/edit/delete flows
- explicit profile launch failure shows toast

### 14. Rollout Notes

- adding the new command and DTO surface is backward-compatible with existing terminals as long as `terminal.create` keeps `profileId` optional
- the toolbar UI can ship once `terminal.profiles.list` is available
- existing users with no terminal settings should continue to get a resolved default automatically
- users on Windows should immediately stop being forced into `cmd.exe` when a better default exists

### 15. Future Work

- per-workspace default terminal profiles
- custom profile environment variables
- task terminal profile routing
- split terminal and debug terminal integration
- deeper workspace runtime and WSL alignment
- optional import or compatibility mapping from VS Code terminal profile settings
