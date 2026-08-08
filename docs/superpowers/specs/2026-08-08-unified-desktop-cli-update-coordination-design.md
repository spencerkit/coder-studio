# Unified Desktop and CLI Update Coordination Design

## Context

Coder Studio currently has three related but intentionally different update mechanisms:

- Desktop Shell updates use `electron-updater` and replace the installed Electron application.
- Desktop Product Runtime updates use a signed manifest, a staged pending Runtime, startup health
  validation, and rollback.
- Global CLI installations use the Server `UpdateService` and a detached npm worker that installs an
  exact package version and restarts the service.

The Desktop Shell and Product Runtime are currently presented and controlled separately. The Web UI
also infers Desktop behavior from the presence of `window.coderStudioDesktop`, while it always asks
the connected Server for `updates.getState`. That is insufficient when the same Web UI can run in a
Desktop renderer, a normal CLI browser session, a WSL environment managed by Desktop, or an external
browser connected to a Desktop sidecar.

The update architecture must provide one coherent product experience without collapsing the trust,
installation, rollback, or release boundaries of those components. It must also preserve the
existing CLI version check, activity confirmation, detached installation, restart handoff, state
reconciliation, and manual fallback behavior.

## Goals

- Add one Desktop Main-process coordinator that decides whether a Desktop plan updates the Shell,
  Product Runtime, or both.
- Keep Electron's native updater for Shell installation and the signed custom updater for Product
  Runtime installation.
- Route update actions from an explicit runtime context instead of relying only on the preload API.
- Preserve the current global npm CLI update path as an independent, first-class authority.
- Allow Shell and Runtime packages to download in parallel while normally requiring only one user
  confirmation and one restart.
- Keep component versions independent where their release boundaries differ, while showing a clear
  product version to users.
- Display trustworthy release timestamps for the installed and available product versions.
- Persist enough Desktop state to recover a ready or interrupted plan after a process restart.
- Prevent incompatible Shell, Runtime, Engine, protocol, or data-schema combinations from being
  published or installed.
- Establish automated and real-install regression gates for both Desktop and CLI updates.

## Non-goals

- Do not replace `electron-updater` with a custom Shell installer.
- Do not install a Desktop update through npm.
- Do not make the CLI Server delegate installation to Electron.
- Do not provide an in-WSL npm updater for a Runtime managed by the Windows Desktop application.
- Do not introduce a new CDN in this change; GitHub Releases and npm remain the initial origins.
- Do not implement a general-purpose data migration framework. This change blocks incompatible
  schema updates; a future schema migration supplies its own backup and restore design.
- Do not promise automatic rollback of an Electron/NSIS Shell after the installer has successfully
  replaced it. Shell safety is provided by signing, staged acceptance, launch validation, and
  compatibility with the previous Runtime. Product Runtime rollback remains automatic.
- Do not enable production Desktop update feeds on a platform until that platform has a real
  installed-upgrade acceptance lane.

## Approaches Considered

### Replace all updates with Electron updates

This would give Desktop one installer, but it would remove the Product Runtime's faster independent
release boundary and its signed pending/health-check/rollback behavior. It would not solve CLI
updates. This approach is rejected.

### Keep the current managers and coordinate only in the Web UI

This would reduce Main-process changes, but the renderer would own lifecycle decisions that must
survive renderer and application restarts. It would also leave competing dialogs and make it hard to
guarantee one compatible install plan. This approach is rejected.

### Coordinate Desktop updates in Electron Main and adapt by environment in Web

This is the selected approach. Electron Main becomes the sole Desktop update authority and composes
the existing Shell and Runtime mechanisms. The CLI Server remains the sole CLI update authority. A
Web `UpdateController` normalizes their states for shared presentation without merging their
installation protocols.

## Version and Release-Time Model

The version shown as the Coder Studio product version is:

- the Product Runtime version in Desktop; and
- the published npm package version in CLI.

The CLI package and Product Runtime are assembled from the same Server/Web product release and use
the same product version for a given release. They remain different distribution components and are
never installed by the same updater. The Desktop Shell has its own semantic version because it has a
different release cadence. The Engine retains an independent ABI integer and is not presented as a
normal product version.

New Runtime update manifests use a new schema revision with a required ISO 8601 `publishedAt` field.
The field is part of the canonical Ed25519 signing payload. Legacy installed schema-v1 manifests
remain readable for startup and rollback, but their release time is reported as unknown; new network
updates must use the new schema.

Packaged Shells contain `resources/build-info.json` with at least the Shell version, build time,
release time, Engine ABI, Node version, Runtime Host API version, and API protocol version. Release
builds require a valid release time. Development builds and legacy installations may report it as
unknown.

The normal UI displays the current product version and its release time. Shell version, Shell build
or release time, Engine ABI, and component-specific details appear only in an expanded diagnostics
section. Times are stored in UTC ISO 8601 form and rendered in the user's local time zone. A missing
value is displayed as "release time unknown" and is never replaced with a check time or filesystem
modification time.

For CLI, the version lookup retrieves npm metadata rather than only a version string. It obtains the
selected dist-tag and the registry `time` entry for the current and target versions, then caches the
last known timestamps. An offline check may reuse a cached timestamp but must still report the check
failure.

## Update Authority and Environment Routing

Shared contracts define an explicit context:

```ts
type UpdateAuthority = "desktop" | "cli" | "none";

interface UpdateRuntimeContext {
  environment:
    | "desktop-native"
    | "desktop-wsl"
    | "cli-global-npm"
    | "cli-unsupported"
    | "desktop-managed";
  authority: UpdateAuthority;
  supported: boolean;
  unsupportedReason: string | null;
}
```

Routing is deterministic. The table's authority is the effective executor available to the current
UI:

| Runtime context | Authority | Behavior |
| --- | --- | --- |
| Desktop renderer using the Local Windows Runtime | Desktop Main | Coordinate Shell and Windows Runtime updates through IPC |
| Desktop renderer using a WSL Runtime | Desktop Main | Stage the signed Linux Runtime through the Windows-hosted WSL installer; never invoke npm in WSL |
| Global npm CLI Server | Server `UpdateService` | Preserve the existing WebSocket and detached npm worker path |
| Unsupported CLI installation | None | Show the reason and a manual command when one is available |
| External browser connected to a Desktop-managed sidecar | None in that page | Report `desktop-managed` and direct the user to the Desktop client |

Desktop-launched Windows and WSL Servers are explicitly configured as `desktop-managed`. Their npm
updater remains disabled as a defense boundary. The Server update view includes the runtime context
additively, including when installation is unsupported. Existing CLI update commands and their
response semantics remain compatible.

A Desktop-managed Server reports `{ environment: "desktop-managed", authority: "desktop",
supported: true }`, meaning that a Desktop authority exists outside the Server. The Desktop IPC
reports the resolved `desktop-native` or `desktop-wsl` context. The Web enables the Desktop adapter
only when the Server declaration and bridge corroborate each other. Without the bridge, it retains
the declared Desktop authority for display but sets its effective executor to read-only. A global
CLI Server reports `cli-global-npm` and `cli`; an unsupported CLI reports `cli-unsupported` and
`none`.

The Web does not fall back from one authority to another. A `desktop-managed` Server without a
Desktop bridge becomes read-only; it does not become a CLI session. A Desktop bridge paired with a
global npm CLI context is also treated as a context mismatch and does not install anything.

## Component Architecture

### Desktop Update Coordinator

`DesktopUpdateCoordinator` lives in Electron Main and is the only owner of Desktop checking,
planning, download, installation handoff, restart, settings, journal reconciliation, and state
broadcasting. It depends on focused adapters:

- a Shell adapter around `electron-updater`;
- Product Runtime adapters around the existing signed Windows Runtime manager/store and the
  Windows-hosted WSL installer;
- a signed Desktop channel client;
- an atomic settings repository;
- an atomic update-plan journal;
- a restart/install handoff abstraction.

The coordinator owns product-level policy, while adapters retain component-specific download,
verification, and install behavior. It exposes one versioned IPC surface for getting state, checking,
downloading, preparing a restart, restarting/installing, reading settings, updating settings, and
subscribing to state changes.

The existing Runtime-specific Desktop IPC is retained as a compatibility shim during the migration.
This is required because the Web UI is carried by Product Runtime and can temporarily run against a
Shell from an adjacent release. The shim delegates to the coordinator and can be removed only after
the minimum supported Shell version guarantees the unified IPC contract.

### CLI Update Service

The Server `UpdateService` remains the CLI update authority. The following behavior is preserved:

- `updates.getState`, `updates.check`, `updates.prepareInstall`, and `updates.startInstall`;
- npm dist-tag lookup and semantic version comparison;
- active terminal, session, and Supervisor summaries;
- exact `npm install -g <package>@<target>` invocation in a detached worker;
- state-file persistence and startup reconciliation;
- restart handoff through `coder-studio serve --restart`;
- permission failures becoming `manual_required` with copyable commands;
- ordinary install or restart failures becoming diagnosable failed states.

The CLI state view gains additive `runtimeContext`, `currentPublishedAt`, and `latestPublishedAt`
fields, but its existing state and worker snapshot fields do not change meaning. Persisted update
state readers accept both the existing schema-v1 snapshot and a new schema-v2 snapshot containing
those optional timestamps. Migration from v1 is lossless, and the detached worker preserves v2
metadata when it writes installation and restart states. The Desktop journal is never used by CLI.

### Web Update Controller

The Web feature gains a controller with three adapters:

- `DesktopUpdateAdapter` calls the unified Desktop IPC;
- `CliUpdateAdapter` calls the existing WebSocket commands;
- `ReadOnlyUpdateAdapter` exposes context, state, and guidance without mutating actions.

The controller resolves the adapter once the Server context and optional Desktop bridge are known.
It normalizes them into a presentation model without mapping Desktop Runtime state into the CLI
`UpdateStateView`. Component plans use the explicit kinds `shell`, `runtime`, and `cli`. Runtime
entries also identify their `win32-x64` or `linux-x64` target. A Desktop plan contains the Shell and
the Runtime target required by the active environment; a CLI plan contains only a CLI entry. When a
user later activates another Desktop environment, the Windows host checks and stages that target's
signed Runtime before launch.

The connected Server remains the source of active-work counts. Desktop uses the Server's read-only
prepare/activity result before asking Main to restart, but the Server does not perform the Desktop
installation.

## Desktop State and Settings

The normalized presentation status is:

`idle`, `checking`, `available`, `downloading`, `ready`, `restarting`, `succeeded`, `failed`,
`manual_required`, or `unsupported`.

Each component retains its own phase, current version, target version, progress, release time, and
error. The plan also contains an aggregate status, a unique plan ID, compatibility result, creation
and update times, and whether a restart is required. Aggregate status never discards a
component-specific failure.

Desktop automatic-check preferences are stored in
`<userData>/desktop-update-settings.json`. They include automatic-check enablement and the supported
check interval. Writes use a temporary file plus atomic replacement. Missing or malformed settings
fall back to automatic checks enabled at a six-hour interval and produce a diagnostic warning.
Desktop accepts the existing one-, six-, twelve-, and twenty-four-hour interval choices. CLI
settings continue to use the Server settings repository and retain the current one-hour default.

Automatic checks do not install or download without a user action. A packaged Desktop waits briefly
after startup, then checks when enabled and repeats at the configured interval. Manual checks remain
available regardless of the automatic-check preference.

The Desktop journal is stored at `<userData>/desktop-update-plan.json`, contains no credentials, and
is written atomically. It records the plan ID, phase, current and target component versions,
verified/downloaded flags, timestamps, restart intent, and the last component error. Runtime pending
and failed pointers remain owned by `RuntimeStore`; the journal references and reconciles them
rather than replacing them.

## Desktop Check, Download, and Install Flow

### Check and plan

1. The coordinator fetches and verifies the selected Desktop channel index.
2. It asks the Shell and Runtime adapters for the versions described by that index.
3. It rejects a source whose returned version does not match the signed plan metadata.
4. It compares installed and available versions and validates the proposed component combination.
5. It publishes one available plan containing only the components that need an update.

### Download

After the user selects "Download update," Shell and Runtime downloads run in parallel. Neither
download modifies the active installation. Each adapter verifies its own artifact before the
component becomes ready. A successful artifact is retained if the other component fails, and retry
targets only the failed component.

The default install action remains blocked until every required component is ready and the complete
plan is compatible. A Shell-only subset is allowed only when the target Shell supports the current
Runtime. A Runtime-only subset is allowed only when the current Shell, Engine, Node, and protocol
capabilities satisfy the target Runtime. All other partial plans remain blocked. Download
cancellation is allowed; installation and atomic Runtime activation are not cancellable.

### Confirm and restart

Once all required artifacts are ready, the Web requests the active-work summary and displays one
confirmation. On confirmation, Main durably records restart intent.

If a Shell update is present, Electron performs the Shell install and launches the new Shell. If only
Runtime is present, the application relaunches normally. On the next launch, Main reconciles the
actual Shell version before selecting the pending Runtime. The Runtime store performs its existing
atomic selection, starts the sidecar, and marks the Runtime successful only after the health
handshake. A ready update deferred by the user remains available. The coordinator retains
Electron's install-on-quit behavior only for that verified, journaled Shell plan, so a later normal
application quit completes the same plan on the next launch.

## Failure, Rollback, and Recovery

- A download or verification failure does not modify the active installation.
- Runtime signature, hash, archive-path, file-set, and compatibility checks remain mandatory.
- Runtime activation failure quarantines the target and automatically selects the previous trusted
  Runtime or Factory Runtime.
- A Runtime is applied after a Shell attempt only if it is compatible with the actual installed
  Shell, not merely the planned Shell.
- A newly installed Shell must be compatible with the previous Runtime so that Runtime rollback can
  still start the product.
- If the Shell did not reach its target and the Runtime requires that Shell, the Runtime remains
  pending and the previous Runtime starts.
- After an unexpected exit, startup compares the journal, Electron updater state, Runtime pointers,
  and actual installed versions. It repairs stale state instead of trusting a persisted phase.
- A fully downloaded plan returns to `ready`; a component already installed is marked complete; an
  indeterminate or incompatible component becomes failed with a recovery action.
- Shell installer failure is reported with logs and a manual installer path or download link when
  available. It does not claim automatic Shell rollback.

The normal UI exposes concise retry, restart-later, or rollback results. Diagnostics expose the
authority, environment, plan ID, failed component and phase, error summary, actual and planned
versions, log locations, and available manual recovery action.

## User Experience

The About view shows Coder Studio's current product version, product release time, last check time,
aggregate update state, and one primary action. The footer update rail uses the same controller and
only appears for actionable available, ready, failed, or manual-required states.

Desktop follows this interaction:

`check -> available -> download -> ready -> restart and update`.

Shell and Runtime download concurrently, but the user sees one plan, one active-work confirmation,
and one restart. Component rows and their independent versions are visible in diagnostics rather
than presented as competing product updates.

CLI follows its established interaction:

`check npm -> available -> prepare activity -> update and restart`.

It does not display Shell or Runtime component actions. Unsupported CLI installations show a reason
and manual command. Desktop WSL reports that updates are managed by the Local Windows application.
An external browser connected to a Desktop sidecar directs the user to that Desktop application and
does not render an install action.

## Release Channel and Artifact Contract

GitHub Releases remain the Desktop origin. npm remains the CLI origin. A Desktop release contains a
signed `desktop-channel.json` that is the coordinator's plan index. It contains:

- schema version, stable or prerelease channel, release tag, and generation time;
- Shell version, Shell release time, and the Electron updater metadata identity;
- Shell Engine ABI, Node version, Runtime Host API, API protocol, and data-schema capabilities;
- per-platform Runtime version, release time, and signed manifest location;
- an Ed25519 signature over the canonical index payload.

Runtime and Engine artifact locations are relative to the channel index and cannot change origin.
The Electron updater feed remains the packaged, trusted GitHub provider; the index identifies its
release tag and metadata file rather than supplying an arbitrary feed URL. The coordinator still
lets `electron-updater` perform the Shell download and installation, and the updater's returned
Shell version must match the index.

Runtime-only releases carry forward the previous immutable Shell installer, `latest.yml`, Shell
metadata, and Engine artifacts. The carried Shell keeps its original version and release time. The
new Runtime receives a new signed release time. Full releases may update all components.

Release jobs produce immutable artifacts first, validate and attest the complete bundle, and only
then expose the GitHub release as the stable or prerelease channel entry. A staged prerelease is
promoted by changing channel visibility or pointers to those same bytes; artifacts are not rebuilt
between acceptance and promotion. A future CDN may mirror the same index and immutable artifacts
without changing coordinator policy or signature formats.

CLI releases are published to a staging dist-tag for acceptance and promoted by moving the dist-tag
to the already published package version. The registry's publication time is the CLI release time.

## Compatibility and Publication Gates

The complete release validator rejects a bundle when:

- Runtime `minShellVersion` is higher than the planned Shell version;
- required Engine ABI, Node version, Runtime Host API, API protocol, platform, or architecture does
  not match the planned host;
- the target Shell cannot run the update's previous Runtime;
- Windows and WSL Runtime artifacts for the product release disagree on product version or required
  shared protocol metadata;
- a Runtime-only release changes Engine ABI or introduces an incompatible data-schema revision;
- a new manifest or channel index lacks a valid release time or signature;
- an index references a missing artifact or an artifact whose signed/hash metadata does not match;
- Electron updater metadata does not describe the Shell version in the channel index.

Runtime-only releases must not perform an irreversible data migration. This implementation rejects
an incompatible data-schema change. A future full Desktop release that needs such a change must
arrive with its own pre-migration backup, explicit migration logic, and tested restore path. The
installed application checks compatibility again before activation even when publication
validation passed.

## Migration and Backward Compatibility

The first release of this architecture is a full Desktop release. It ships the coordinator, unified
IPC, compatibility shims, new channel parser, and a Factory Runtime that understands the normalized
UI state. The old Runtime-specific IPC continues to function through the coordinator.

Network Runtime manifests move to the new schema only after the corresponding minimum Shell version
is available. Older Shells either install the full Electron update first or reject a Runtime whose
minimum Shell/API requirements they cannot satisfy. Legacy installed Runtime manifests remain valid
launch and rollback candidates, with an unknown release time.

Server update contracts change additively. Old Web clients continue receiving the fields they
expect. Existing CLI schema-v1 state files remain readable and are upgraded to schema v2 on the next
state write; missing release times remain `null` until a registry metadata check supplies them. No
migration writes Desktop journal data into the CLI state directory or vice versa.

## Test and Regression Strategy

### Contract and unit tests

- Runtime context detection and authority resolution for every routing row.
- Channel and Runtime manifest parsing, canonical signatures, release times, URL constraints, and
  compatibility failures.
- Coordinator plans for no update, Shell-only, Runtime-only, combined, partial failure, incompatible
  targets, concurrent requests, cancellation, and journal recovery.
- Atomic settings and journal persistence, including malformed-file fallback.
- Existing and new CLI Runtime detection, `UpdateService`, WebSocket command, detached worker, state
  repository, and startup reconciliation behavior.

### Integration and UI tests

- A mocked `electron-updater` plus local HTTP Runtime feed verifies parallel download and one plan.
- One confirmation results in one restart/install handoff.
- Interrupted downloads, invalid signatures, activation failure, quarantine, and Runtime rollback
  produce the expected durable and visible states.
- CLI sessions call only WebSocket update commands; Desktop calls only IPC for installation;
  Desktop-managed sidecars never query npm; external sidecar browsers remain read-only.
- About, footer rail, component diagnostics, local-time formatting, missing release times, progress,
  manual fallback, and unsupported states are covered in Web tests and UI E2E tests.

### Artifact tests

- Desktop artifact validation covers the installer, `latest.yml`, Shell build info, channel index,
  Windows Runtime, WSL Runtime, WSL Engine, signatures, hashes, versions, platforms, and timestamps.
- Runtime-only release tests prove that carried Shell/Engine bytes and timestamps remain unchanged.
- Existing packaged Desktop smoke, signed Runtime acceptance, and WSL acceptance remain required.

### Real installed-upgrade acceptance

A clean Windows x64 VM or runner installs the previous stable version and updates to a signed staged
prerelease. The matrix covers Runtime-only, combined Shell and Runtime, an active WSL environment,
Runtime health-check rollback, an exit during the update flow, startup journal recovery, and an
external browser connected to the sidecar. The WSL case explicitly proves that no npm installation
runs inside WSL.

Windows x64 and WSL Linux x64 are the initial production acceptance targets. macOS or Linux Desktop
feeds remain disabled until equivalent installed-upgrade lanes exist for their installer formats.

### CLI non-regression acceptance

CI uses an isolated npm prefix to avoid modifying the runner's global installation. It installs an
older CLI, checks the candidate version, starts the detached exact-version npm install, performs the
restart handoff, and verifies the new running version and reconciled state. It also covers permission
errors, ordinary install errors, restart failures, log output, and generated manual commands.

The CLI lane is a mandatory peer of the Desktop acceptance lane. Desktop coverage cannot replace or
skip it. Repository handoff runs the focused package suites plus `pnpm ci:verify`, `pnpm ci:test`,
and `pnpm e2e-ui`. Stable promotion requires both the Desktop installed-upgrade report and the CLI
non-regression report to pass.

## Acceptance Criteria

- Desktop users receive one compatible plan and no competing Shell/Runtime dialogs.
- Shell uses `electron-updater`; Runtime retains signed staging, health validation, quarantine, and
  rollback.
- A combined plan downloads both components concurrently and normally needs one confirmation and
  one restart.
- The product, Shell, and CLI show the correct versions and release times at their intended level of
  detail.
- Desktop-native, Desktop WSL, global CLI, unsupported CLI, and external-sidecar browser sessions
  resolve to the correct authority without fallback.
- Desktop-managed Servers never run the npm updater.
- The existing CLI check, prepare, install, manual fallback, restart, and reconciliation behavior
  passes both automated tests and isolated packaged acceptance.
- Interrupted Desktop plans reconcile safely, and a failed Runtime activation starts the previous
  trusted Runtime.
- Release validation prevents every incompatible or incomplete combination described above.

## Risks and Mitigations

- **Split-source drift:** the signed channel index pins the expected versions, and adapters must
  return those exact versions before a plan becomes actionable.
- **Web/Shell protocol skew:** retain the old IPC shim, version the unified bridge, and use
  `minShellVersion` plus Runtime Host API checks.
- **Accidental npm installation from Desktop:** pass an explicit `desktop-managed` context to every
  Desktop-launched Server and retain `supported: false` in its npm update configuration.
- **Journal disagreement after a crash:** reconcile persisted intent against actual installed
  versions, Electron state, and Runtime pointers on every startup.
- **Rollback blocked by a newer Shell:** require the target Shell to run the previous Runtime and
  test that pair before publication.
- **Misleading release time:** sign or obtain the timestamp from the authoritative release source,
  cache it with its version, and show unknown when it cannot be established.
- **False confidence from mocks:** require installed Windows/WSL and isolated packaged CLI upgrade
  acceptance before stable promotion.
