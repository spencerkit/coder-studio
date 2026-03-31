# Provider Standardization Design

## Goal

Standardize agent-provider integration so the product no longer hardcodes Claude and Codex behavior across the UI, settings, session model, and runtime startup flow.

After this redesign:

- the UI loads available providers from built-in TypeScript manifests
- provider settings render from manifest-defined field schemas
- sessions use one standard provider-agnostic model
- the server resolves provider-specific runtime behavior through adapters
- adding a new built-in provider requires only a new manifest plus a new server adapter

This design intentionally does not include external plugin loading. Providers remain built into the repo, but the built-in integration path becomes declarative and repeatable.

## Decision

Adopt a two-part provider architecture:

1. a built-in manifest registry in TypeScript for product/UI/settings concerns
2. a built-in adapter registry in Rust for runtime/start/resume/hook concerns

The interface between these two layers is a stable string provider ID such as `claude`, `codex`, or `mock`.

This replaces the current model where provider-specific behavior is scattered across:

- hardcoded union types and enums
- special-case settings structures
- settings-page conditional rendering
- draft session provider toggles
- startup timing heuristics
- provider-specific hook receiver assumptions

## Non-Goals

This design does not attempt to solve:

- runtime loading of third-party providers from disk
- arbitrary custom React components injected by provider configs
- non-CLI or non-PTY providers
- changing the existing `agent_start / agent_send / agent_stop / agent_resize` RPC contract
- introducing a second session protocol per provider

These are separate out-of-scope concerns. The purpose of this design is to standardize the current built-in CLI provider model first.

## Current Pain Points

Today the codebase duplicates provider knowledge in multiple layers:

- the frontend session type hardcodes `claude | codex`
- app settings hardcode `claude.global` and `codex.global`
- the settings page renders provider selection and provider-specific settings with hand-written branches
- draft session selection branches on Claude versus Codex labels
- runtime validation and startup timing logic contain provider-specific conditions
- the server adapter layer exists, but still depends on a fixed provider enum and provider-specific hook plumbing

This means adding a third provider requires touching many unrelated files, even when the new provider follows the same high-level runtime contract.

## Design Overview

The redesigned architecture is split into five layers.

### 1. Provider Manifest Layer

Each built-in provider has a TypeScript manifest that declares product-level metadata and settings-form schema.

Suggested file structure:

- `apps/web/src/features/providers/manifests/claude.ts`
- `apps/web/src/features/providers/manifests/codex.ts`
- `apps/web/src/features/providers/manifests/mock.ts`
- `apps/web/src/features/providers/registry.ts`
- `apps/web/src/features/providers/types.ts`

Each manifest is pure data. It should not contain provider-specific imperative code.

Each manifest defines:

- `id`
- `label`
- `description`
- `badgeLabel`
- `capabilities`
- `settingsSections`
- `settingsDefaults`
- `runtimeValidation`
- `startupBehavior`

The manifest is the sole source of truth for how the provider appears in the product.

### 2. Generic Settings Layer

Provider settings move from hardcoded top-level keys to a generic provider map.

Current shape:

```ts
type AppSettingsPayload = {
  agentDefaults: { provider: "claude" | "codex" };
  claude: { global: ClaudeRuntimeProfile };
  codex: { global: CodexRuntimeProfile };
}
```

Target shape:

```ts
type AppSettingsPayload = {
  general: { ... };
  agentDefaults: {
    provider: string;
  };
  providers: Record<string, {
    global: Record<string, unknown>;
  }>;
}
```

This gives every provider the same storage layout:

- provider ID chooses the namespace
- provider manifest chooses the form schema
- provider adapter chooses how to parse and use that stored profile

The frontend may keep compatibility helpers for one release so legacy settings can still be read and normalized into the new shape.

### 3. Standard Session Layer

Sessions remain provider-agnostic from the product perspective.

Target session model:

- `id`
- `title`
- `status`
- `mode`
- `providerId: string`
- `resumeId?: string`
- `messages`
- `stream`
- `queue`
- `lastActiveAt`

The UI should treat provider choice as metadata, not as a branching point for transport or session semantics.

This keeps:

- one draft-session flow
- one runtime event model
- one history model
- one restore model

### 4. Server Adapter Registry

Each provider has a server adapter responsible for runtime-specific behavior.

Suggested structure:

- `apps/server/src/services/providers/mod.rs`
- `apps/server/src/services/providers/registry.rs`
- `apps/server/src/services/providers/types.rs`
- `apps/server/src/services/providers/claude.rs`
- `apps/server/src/services/providers/codex.rs`
- `apps/server/src/services/providers/mock.rs`

Each adapter owns:

- profile parsing and defaults
- start command or direct launch spec
- resume command or direct launch spec
- runtime environment variables
- workspace integration requirements
- hook payload normalization
- resume ID extraction
- input policy

The generic runtime layer should not know Claude or Codex by name.

### 5. Generic Runtime And Hook Ingress

The runtime control plane remains unchanged:

- `agent_start`
- `agent_send`
- `agent_stop`
- `agent_resize`

The server resolves provider behavior by:

1. loading the session
2. reading `session.provider_id`
3. looking up the adapter by ID
4. parsing that provider's settings profile
5. delegating start/resume/input/hook behavior to the adapter

Hooks also become generic:

- one shared hook receiver endpoint
- one shared helper command
- provider-specific adapters only define how workspace hook files are written and how incoming payloads are normalized

## Provider Manifest Schema

The manifest should be expressive enough for the current Claude and Codex settings panels without allowing arbitrary provider-specific React components.

Suggested shape:

```ts
type ProviderManifest = {
  id: string;
  label: string;
  description: string;
  badgeLabel: string;
  capabilities: {
    supportsResume: boolean;
    supportsHooks: "required" | "optional" | "none";
    emitsApprovalEvents: boolean;
  };
  startupBehavior: {
    startupQuietMs: number;
    startupDiscoveryMs: number;
    firstSubmitStrategy: "immediate_newline" | "flush_then_newline";
  };
  runtimeValidation: {
    commandFieldPath: string[];
    deferredHintKey?: string;
    requiredCommands: Array<{ id: string; command: string }>;
  };
  settingsSections: ProviderSettingsSection[];
  settingsDefaults: Record<string, unknown>;
}

type ProviderSettingsSection = {
  id: string;
  titleKey: string;
  descriptionKey?: string;
  fields: ProviderSettingsField[];
}

type ProviderSettingsField =
  | { kind: "command"; path: string[]; labelKey: string; hintKey?: string }
  | { kind: "string_list"; path: string[]; labelKey: string; hintKey?: string }
  | { kind: "env_map"; path: string[]; labelKey: string; hintKey?: string }
  | { kind: "json"; path: string[]; labelKey: string; hintKey?: string }
  | { kind: "select"; path: string[]; labelKey: string; options: Array<{ value: string; labelKey: string }> }
  | { kind: "text"; path: string[]; labelKey: string; hintKey?: string };
```

Important boundary:

- manifest controls field layout and rendering style
- manifest does not define executable business logic
- provider-specific parsing remains in the server adapter

This is enough to render current built-in settings while keeping the settings page standardized.

## Adapter Contract

The server adapter contract should centralize provider-specific runtime behavior.

Suggested responsibilities:

```rust
pub(crate) trait ProviderAdapter {
    fn id(&self) -> &'static str;
    fn parse_profile(&self, settings: &AppSettingsPayload) -> Result<ResolvedProviderProfile, String>;
    fn build_start_spec(&self, target: &ExecTarget, profile: &ResolvedProviderProfile) -> Result<AgentLaunchSpec, String>;
    fn build_resume_spec(&self, target: &ExecTarget, profile: &ResolvedProviderProfile, resume_id: &str) -> Result<AgentLaunchSpec, String>;
    fn runtime_env(&self, profile: &ResolvedProviderProfile) -> BTreeMap<String, String>;
    fn input_policy(&self) -> ProviderInputPolicy;
    fn ensure_workspace_integration(&self, cwd: &str, target: &ExecTarget) -> Result<(), String>;
    fn normalize_hook_payload(&self, payload: &Value) -> Option<NormalizedLifecycleEvent>;
    fn extract_resume_id(&self, payload: &Value) -> Option<String>;
}
```

The registry resolves adapters by string ID:

```rust
fn resolve_provider_adapter(provider_id: &str) -> Option<&'static dyn ProviderAdapter>
```

This removes the need for a fixed `match AgentProvider::{Claude,Codex}` branch from the main runtime flow.

## Data Model Changes

### Frontend

Replace provider unions with plain string IDs:

- `AgentProvider = string`
- `Session.provider` becomes `providerId`
- `AppSettings.agentDefaults.provider` becomes `string`

The frontend registry determines whether a provider is known and how it should be displayed.

Unknown provider IDs must not crash the UI. Unknown providers should render with a generic fallback label such as `Unknown (provider_id)`.

### Server

Replace the provider enum with a stored string ID for session and settings state.

Target examples:

- `SessionInfo.provider_id: String`
- `SessionHistoryRecord.provider_id: String`
- `AgentDefaultsPayload.provider: String`

The database likely does not need a schema migration for session providers because the existing column already stores serialized string labels. The application model changes, but the on-disk representation remains compatible.

### Resume ID

`resume_id` remains a standard optional session field independent of provider.

Adapters decide:

- whether resume is supported
- how resume commands are formed
- how a resume ID is extracted from hook payloads

## Settings Migration Strategy

The new settings layer must preserve existing user settings.

On load:

1. read existing stored settings
2. if legacy `claude.global` exists, copy it into `providers.claude.global`
3. if legacy `codex.global` exists, copy it into `providers.codex.global`
4. if `agentDefaults.provider` is missing, default to `claude`
5. if the selected default provider does not exist in the registry, fall back to the first registered built-in provider

On write:

- always persist the new generic `providers` shape
- do not write new top-level `claude` or `codex` sections

This allows a one-way normalization path without breaking existing settings files.

## UI Rendering Model

The settings page becomes a generic renderer over manifest sections and fields.

Target behavior:

- provider choice pills are generated from the manifest registry
- selecting a provider switches the visible form schema
- fields render through standardized controls
- labels and hints come from shared i18n keys or manifest-owned text keys

The draft-session launcher also renders provider choices from the registry instead of hand-written Claude/Codex tabs.

History badges, session headers, and provider labels should use manifest metadata:

- `badgeLabel`
- `label`
- generic unknown-provider fallback

This removes product-level branching on provider IDs.

## Runtime Validation Model

Runtime validation becomes manifest-driven.

Each manifest defines:

- which field contains the launch command
- which command label ID should appear in the runtime requirement list
- whether the provider command is deferred when it uses a workspace-relative path
- any provider-specific hint text

The UI runtime validator should consume manifest metadata instead of branching on provider names.

## Input Policy Standardization

Input still flows through the standard transport API, but provider-specific write quirks move behind a provider input policy.

Target policy shape:

```rust
pub(crate) struct ProviderInputPolicy {
    pub first_submit_strategy: FirstSubmitStrategy,
}

pub(crate) enum FirstSubmitStrategy {
    ImmediateNewline,
    FlushThenDelayedNewline { delay_ms: u64 },
}
```

This moves the existing Codex-specific first-submit behavior out of the generic runtime core and into adapter-owned policy.

On the frontend, startup gating timings also move out of provider name checks and into manifest `startupBehavior`.

## Hook Architecture

### Current problem

The current server starts a Claude-named hook receiver and other providers implicitly reuse that shared endpoint. This is correct enough for two built-ins but makes the architecture misleading and harder to extend.

### Target design

Introduce a generic hook ingress service, for example:

- `apps/server/src/services/providers/hooks.rs`

Responsibilities:

- start one local HTTP listener
- store the listener endpoint in app state
- expose one shared helper command such as `--coder-studio-agent-hook`
- accept hook payloads from any provider
- identify the session from `workspace_id` and `session_id`
- load the session to find `provider_id`
- delegate payload normalization and resume-ID extraction to the matching adapter
- emit standard lifecycle events

Each provider adapter remains responsible for writing workspace integration files, for example:

- `.claude/settings.local.json`
- `.codex/hooks.json`
- future provider-specific hook configuration files

The hook receiver is shared. Hook-file authoring remains provider-specific.

## Standard Runtime Event Contract

The event contract remains stable and provider-independent.

Stream events:

- `agent://event`
  - `stdout`
  - `stderr`
  - `system`
  - `exit`

Lifecycle events:

- `session_started`
- `turn_waiting`
- `tool_started`
- `tool_finished`
- `approval_required`
- `turn_completed`
- `session_ended`

Adapters normalize provider-native hook payloads into these standard lifecycle kinds.

The frontend should continue to consume only these standard events.

## Fallback Behavior

Providers without complete hook support must still be able to run.

Keep the existing runtime fallback semantics:

- first non-empty output implies `tool_started`
- process exit implies `turn_completed`

This keeps provider onboarding incremental:

- minimal provider can launch, stream output, and finish
- richer provider can add hook integration in a subsequent enhancement for full lifecycle fidelity

## Built-In Mock Provider

This redesign should ship with a third built-in provider named `mock`.

Purpose:

- prove the new architecture supports provider onboarding without re-touching product logic
- give tests a deterministic provider that does not require external vendor tooling
- act as a reference implementation for future built-in providers

The mock provider should:

- use the same generic settings and session model
- have a simple manifest with minimal fields
- launch a deterministic local command or fixture script
- optionally emit predictable lifecycle payloads for integration tests

The mock provider is a validation artifact for the architecture, not a user-facing strategic provider.

## Error Handling

### Unknown provider ID

If a session or settings payload references an unknown provider:

- do not crash
- render a generic fallback label in the UI
- prevent provider start with a clear error such as `unknown_provider:<id>`
- preserve the raw stored settings data so future versions can still recover it

### Invalid provider profile

If a provider's stored settings profile fails adapter parsing:

- runtime start should fail with a targeted validation error
- the settings page should still show the manifest fields and allow correction

### Missing adapter for known manifest

If the UI manifest exists but the server adapter is missing, start must fail clearly. This should also be covered by startup tests so the mismatch is caught in development.

## Testing Strategy

Add tests at four levels.

### 1. Frontend registry and settings tests

- registry returns all built-in provider manifests
- settings renderer builds forms from manifest sections and fields
- default provider selection is registry-driven
- legacy settings normalize into `providers.<id>.global`
- draft session selector renders providers from registry

### 2. Server adapter tests

- registry resolves built-in adapters by string ID
- each adapter builds correct start and resume launch specs
- each adapter parses its profile defaults correctly
- unknown adapter lookup fails clearly
- each adapter's hook normalization maps raw payloads into standard lifecycle events

### 3. Runtime and integration tests

- `agent_start` resolves provider from stored session instead of frontend launch payload
- hook ingress resolves provider by session and emits normalized lifecycle events
- fallback lifecycle remains functional when hooks are absent
- resume ID updates still persist through the standard session patch path

### 4. End-to-end tests

- Claude still launches and streams correctly
- Codex still launches and streams correctly
- mock provider launches through the same generic session/runtime path
- history and restore continue to show provider labels correctly

## Migration Plan

The implementation should happen in phases:

1. introduce provider registries and manifest types without changing behavior
2. migrate frontend UI consumers to manifest-driven provider rendering
3. convert settings storage to generic `providers` map with backward-compatible normalization
4. migrate server runtime resolution from enum matches to string adapter registry
5. replace provider-specific hook receiver naming with generic hook ingress
6. add mock provider
7. delete obsolete Claude/Codex special-case branches

This sequencing keeps the system functional while reducing risk.

## Scope Boundaries

Included:

- built-in manifest registry
- built-in server adapter registry
- generic provider settings map
- generic settings form renderer
- generic hook ingress
- mock provider sample
- migration of current Claude and Codex integrations onto the new architecture

Not included:

- external provider discovery from arbitrary directories
- marketplace or remote installation of providers
- provider-specific custom React components
- replacing the PTY runtime with a non-CLI orchestration model

## Rationale

This design standardizes the current architecture without overreaching into plugin infrastructure.

It gives the product a repeatable provider onboarding path:

- UI is data-driven by manifest
- sessions remain uniform
- runtime stays generic
- provider-specific behavior is isolated in adapters

That produces a clear rule for future built-ins:

add one manifest, add one adapter, pass the standard tests.

This is the smallest architectural change that meaningfully removes Claude/Codex hardcoding while still proving the design with a third provider.
