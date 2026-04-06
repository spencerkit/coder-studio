# Intelligent Session Supervisor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add turn-scoped supervisor mode for a workspace business session so each completed business turn can trigger a one-shot supervisor invocation that generates the next message to inject back into the business terminal.

**Architecture:** Persist supervisor mode as workspace-level state attached to a session slot, not as a long-lived runtime. Detect completed business turns from existing agent lifecycle events, build a bounded supervisor prompt from the active objective plus recent turn context, invoke Claude/Codex through a dedicated supervisor adapter, then inject the returned reply into the bound business terminal with visible supervisor-origin metadata.

**Tech Stack:** Rust server, SQLite workspace state, Claude/Codex provider adapters, TypeScript/React frontend, node:test, Playwright

---

## File Map

### Server state and RPC surface
- Modify: `apps/server/src/models.rs`
  - Add supervisor binding, cycle record, status, objective version, and terminal write origin types.
- Modify: `apps/server/src/app.rs`
  - Add in-memory supervisor cycle guards and pending objective update state if needed.
- Modify: `apps/server/src/command/http.rs`
  - Add enable/update/pause/resume/disable/retry supervisor RPCs and tests.
- Modify: `apps/server/src/ws/protocol.rs`
  - Extend terminal write envelopes to carry write origin metadata.
- Modify: `apps/server/src/ws/server.rs`
  - Pass terminal write origin through websocket writes.

### Server persistence and orchestration
- Modify: `apps/server/src/infra/db.rs`
  - Persist supervisor bindings/cycles inside workspace view state or companion workspace records.
  - Add load/save helpers, cycle append helpers, and snapshot hydration.
- Modify: `apps/server/src/services/workspace.rs`
  - Expose supervisor state on workspace snapshot and clear it when workspace/session closes.
- Modify: `apps/server/src/services/workspace_runtime.rs`
  - Hook completed-turn events into supervisor orchestration.
- Modify: `apps/server/src/services/agent.rs`
  - Reuse lifecycle fallback/turn completion events as the trigger source.
- Modify: `apps/server/src/services/terminal.rs`
  - Accept supervisor-origin terminal writes and emit visible markers.
- Modify: `apps/server/src/services/provider_registry.rs`
  - Add one-shot supervisor invocation interface.
- Modify: `apps/server/src/services/claude.rs`
  - Build Claude supervisor one-shot invocation command.
- Modify: `apps/server/src/services/codex.rs`
  - Build Codex supervisor one-shot invocation command.
- Modify: `apps/server/src/services/mod.rs`
  - Export new supervisor service module.
- Create: `apps/server/src/services/supervisor.rs`
  - Centralize supervisor mode state transitions, objective prompt composition, turn-scoped invocation, cycle recording, and injection.

### Frontend types and UX
- Modify: `apps/web/src/types/app.ts`
  - Add supervisor binding/cycle types, terminal write origin metadata, and workspace snapshot surface.
- Modify: `apps/web/src/state/workbench-core.ts`
  - Add supervisor mode state to `Session` or `Tab`-attached workspace session data.
- Modify: `apps/web/src/services/http/workspace.service.ts`
  - Add supervisor RPC wrappers.
- Modify: `apps/web/src/services/http/terminal.service.ts`
  - Add optional write origin metadata plumbing.
- Modify: `apps/web/src/ws/protocol.ts`
  - Type websocket terminal write origin and supervisor state events.
- Modify: `apps/web/src/features/workspace/WorkspaceScreen.tsx`
  - Add supervisor tab, objective edit flow, pause/resume/disable/retry actions, and cycle display.
- Modify: `apps/web/src/features/workspace/session-actions.ts`
  - Wire enable/disable lifecycle and cleanup behavior.
- Modify: `apps/web/src/features/workspace/terminal-actions.ts`
  - Support programmatic supervisor-origin terminal writes in UI state.
- Modify: `apps/web/src/shared/utils/session.ts`
  - Add supervisor-origin message marker formatting helpers.
- Modify: `apps/web/src/shared/utils/workspace.ts`
  - Map backend supervisor state into frontend tabs/sessions.
- Modify: `apps/web/src/i18n.ts`
  - Add supervisor labels and error copy.
- Create: `apps/web/src/features/workspace/supervisor-objective.ts`
  - Objective text normalization and preview helpers.
- Create: `apps/web/src/components/workspace/WorkspaceSupervisorPanel.tsx`
  - Focused management panel component.
- Create: `apps/web/src/components/workspace/WorkspaceSupervisorDialog.tsx`
  - Single-input enable/edit dialog.

### Tests
- Modify: `apps/server/src/command/http.rs`
- Modify: `apps/server/src/infra/db.rs`
- Modify: `apps/server/src/services/workspace.rs`
- Modify: `apps/server/src/services/workspace_runtime.rs`
- Modify: `apps/server/src/services/terminal.rs`
- Modify: `apps/server/src/services/claude.rs`
- Modify: `apps/server/src/services/codex.rs`
- Create: `apps/server/src/services/supervisor.rs` tests in-module
- Modify: `tests/session-actions.test.ts`
- Modify: `tests/workspace-session-actions.test.ts`
- Modify: `tests/workspace-runtime-controller.test.ts`
- Modify: `tests/workspace-recovery.test.ts`
- Modify: `tests/xterm-output-sync.test.ts`
- Modify: `tests/e2e/e2e.spec.ts`
- Modify: `tests/e2e/transport.spec.ts`

---

### Task 1: Add supervisor mode models and persistence

**Files:**
- Modify: `apps/server/src/models.rs:355-449`
- Modify: `apps/server/src/infra/db.rs`
- Modify: `apps/server/src/app.rs:80-121`
- Modify: `apps/web/src/types/app.ts:120-220`
- Modify: `apps/web/src/shared/utils/workspace.ts`
- Test: `apps/server/src/infra/db.rs`

- [ ] **Step 1: Write the failing server persistence test**

```rust
#[test]
fn workspace_view_state_round_trips_supervisor_binding_and_cycles() {
    let conn = Connection::open_in_memory().unwrap();
    init_db(&conn).unwrap();

    let workspace_id = "ws-supervisor";
    create_workspace_record_for_test(&conn, workspace_id, "/tmp/ws-supervisor");

    let patch = WorkspaceViewPatch {
        supervisor: Some(WorkspaceSupervisorViewState {
            bindings: vec![WorkspaceSupervisorBinding {
                session_id: "slot-primary".to_string(),
                provider: AgentProvider::claude(),
                objective_text: "Ship v1 supervisor mode using xterm only".to_string(),
                objective_prompt: "supervisor prompt body".to_string(),
                objective_version: 1,
                status: WorkspaceSupervisorStatus::Idle,
                auto_inject_enabled: true,
                pending_objective_text: None,
                pending_objective_prompt: None,
                pending_objective_version: None,
                updated_at: 1,
                created_at: 1,
            }],
            cycles: vec![WorkspaceSupervisorCycle {
                cycle_id: "cycle-1".to_string(),
                session_id: "slot-primary".to_string(),
                source_turn_id: "turn-1".to_string(),
                objective_version: 1,
                supervisor_input: "prompt".to_string(),
                supervisor_reply: Some("next message".to_string()),
                injection_message_id: Some("inject-1".to_string()),
                status: WorkspaceSupervisorCycleStatus::Injected,
                error: None,
                started_at: 1,
                finished_at: Some(2),
            }],
        }),
        ..WorkspaceViewPatch::default()
    };

    patch_workspace_view_state_for_test(&conn, workspace_id, patch).unwrap();
    let stored = load_view_state_from_conn(&conn, workspace_id).unwrap();

    assert_eq!(stored.supervisor.bindings.len(), 1);
    assert_eq!(stored.supervisor.cycles.len(), 1);
    assert_eq!(stored.supervisor.bindings[0].objective_version, 1);
    assert_eq!(stored.supervisor.cycles[0].supervisor_reply.as_deref(), Some("next message"));
}
```

- [ ] **Step 2: Run test to verify it fails**

Discover the exact Rust test path first:
`cargo test --manifest-path apps/server/Cargo.toml -- --list | grep "workspace_view_state_round_trips_supervisor_binding_and_cycles"`

Run:
`cargo test --manifest-path apps/server/Cargo.toml infra::db::tests::workspace_view_state_round_trips_supervisor_binding_and_cycles -- --exact`
Expected: FAIL because supervisor fields do not exist on workspace view state.

- [ ] **Step 3: Add backend supervisor types and workspace view state fields**

```rust
#[derive(Clone, Serialize, Deserialize, Debug, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum WorkspaceSupervisorStatus {
    Inactive,
    Idle,
    Evaluating,
    Injecting,
    Paused,
    Error,
}

#[derive(Clone, Serialize, Deserialize, Debug, PartialEq, Eq)]
pub struct WorkspaceSupervisorBinding {
    pub session_id: String,
    pub provider: AgentProvider,
    pub objective_text: String,
    pub objective_prompt: String,
    pub objective_version: i64,
    pub status: WorkspaceSupervisorStatus,
    pub auto_inject_enabled: bool,
    pub pending_objective_text: Option<String>,
    pub pending_objective_prompt: Option<String>,
    pub pending_objective_version: Option<i64>,
    pub created_at: i64,
    pub updated_at: i64,
}
```

```rust
#[derive(Clone, Serialize, Deserialize, Debug, PartialEq, Eq)]
pub struct WorkspaceSupervisorCycle {
    pub cycle_id: String,
    pub session_id: String,
    pub source_turn_id: String,
    pub objective_version: i64,
    pub supervisor_input: String,
    pub supervisor_reply: Option<String>,
    pub injection_message_id: Option<String>,
    pub status: WorkspaceSupervisorCycleStatus,
    pub error: Option<String>,
    pub started_at: i64,
    pub finished_at: Option<i64>,
}
```

```rust
#[derive(Clone, Serialize, Deserialize, Debug, Default, PartialEq, Eq)]
pub struct WorkspaceSupervisorViewState {
    #[serde(default)]
    pub bindings: Vec<WorkspaceSupervisorBinding>,
    #[serde(default)]
    pub cycles: Vec<WorkspaceSupervisorCycle>,
}
```

```rust
#[derive(Clone, Serialize, Deserialize, Debug, PartialEq, Eq)]
pub struct WorkspaceViewState {
    pub active_session_id: String,
    pub active_pane_id: String,
    pub active_terminal_id: String,
    pub pane_layout: Value,
    pub file_preview: FilePreview,
    #[serde(default)]
    pub session_bindings: Vec<WorkspaceSessionBinding>,
    #[serde(default)]
    pub supervisor: WorkspaceSupervisorViewState,
}
```

- [ ] **Step 4: Add matching frontend transport types**

```ts
export type SupervisorStatus = 'inactive' | 'idle' | 'evaluating' | 'injecting' | 'paused' | 'error'

export interface BackendWorkspaceSupervisorBinding {
  session_id: string
  provider: AgentProvider
  objective_text: string
  objective_prompt: string
  objective_version: number
  status: SupervisorStatus
  auto_inject_enabled: boolean
  pending_objective_text?: string | null
  pending_objective_prompt?: string | null
  pending_objective_version?: number | null
  created_at: number
  updated_at: number
}
```

```ts
export interface BackendWorkspaceSupervisorCycle {
  cycle_id: string
  session_id: string
  source_turn_id: string
  objective_version: number
  supervisor_input: string
  supervisor_reply?: string | null
  injection_message_id?: string | null
  status: 'queued' | 'evaluating' | 'completed' | 'injected' | 'failed'
  error?: string | null
  started_at: number
  finished_at?: number | null
}
```

- [ ] **Step 5: Run focused tests**

Discover the exact Rust test path if needed:
`cargo test --manifest-path apps/server/Cargo.toml -- --list | grep "workspace_view_state_round_trips_supervisor_binding_and_cycles"`

Run:
`cargo test --manifest-path apps/server/Cargo.toml infra::db::tests::workspace_view_state_round_trips_supervisor_binding_and_cycles -- --exact`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add apps/server/src/models.rs apps/server/src/infra/db.rs apps/server/src/app.rs apps/web/src/types/app.ts apps/web/src/shared/utils/workspace.ts
git commit -m "feat: persist workspace supervisor state"
```

### Task 2: Add supervisor RPCs and objective prompt composition

**Files:**
- Create: `apps/server/src/services/supervisor.rs`
- Modify: `apps/server/src/services/mod.rs`
- Modify: `apps/server/src/command/http.rs:1-1600`
- Modify: `apps/server/src/services/workspace.rs`
- Modify: `apps/web/src/services/http/workspace.service.ts`
- Create: `apps/web/src/features/workspace/supervisor-objective.ts`
- Test: `apps/server/src/command/http.rs`
- Test: `apps/server/src/services/supervisor.rs`

- [ ] **Step 1: Write the failing objective enable test**

```rust
#[test]
fn enable_supervisor_mode_composes_prompt_and_sets_idle_status() {
    let app = test_app();
    let workspace_id = launch_test_workspace(&app, "/tmp/supervisor-enable");
    let session_id = "slot-primary";

    let result = dispatch_rpc(
        &app,
        "enable_supervisor_mode",
        json!({
            "workspace_id": workspace_id,
            "session_id": session_id,
            "provider": "claude",
            "objective_text": "Build supervisor mode v1. Use xterm only. Auto inject the reply.",
            "device_id": "device-a",
            "client_id": "client-a",
            "fencing_token": 1,
        }),
        &authorized_user(),
    );

    assert!(result.is_ok());
    let snapshot = workspace_snapshot(app.state(), &workspace_id).unwrap();
    let binding = snapshot.view_state.supervisor.bindings.iter().find(|b| b.session_id == session_id).unwrap();
    assert_eq!(binding.status, WorkspaceSupervisorStatus::Idle);
    assert!(binding.objective_prompt.contains("You are the supervisor"));
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cargo test --manifest-path apps/server/Cargo.toml enable_supervisor_mode_composes_prompt_and_sets_idle_status -- --exact`
Expected: FAIL because RPC and supervisor service do not exist.

- [ ] **Step 3: Implement objective prompt composition and server service methods**

```rust
pub(crate) fn compose_objective_prompt(objective_text: &str) -> Result<String, String> {
    let trimmed = objective_text.trim();
    if trimmed.is_empty() {
        return Err("supervisor_objective_required".to_string());
    }

    Ok(format!(
        "You are the supervisor for a business agent terminal session.\n\
         Your job is to read the active goal, the latest turn context, and produce the next message that should be sent to the business agent.\n\
         Stay aligned with the user's intent. Do not redesign the product scope.\n\n\
         Active objective:\n{}\n",
        trimmed
    ))
}
```

```rust
pub(crate) fn enable_supervisor_mode(
    workspace_id: &str,
    session_id: &str,
    provider: AgentProvider,
    objective_text: &str,
    state: State<'_, AppState>,
) -> Result<WorkspaceSupervisorBinding, String> {
    let objective_prompt = compose_objective_prompt(objective_text)?;
    let now = now_ts_ms();
    let binding = WorkspaceSupervisorBinding {
        session_id: session_id.to_string(),
        provider,
        objective_text: objective_text.trim().to_string(),
        objective_prompt,
        objective_version: 1,
        status: WorkspaceSupervisorStatus::Idle,
        auto_inject_enabled: true,
        pending_objective_text: None,
        pending_objective_prompt: None,
        pending_objective_version: None,
        created_at: now,
        updated_at: now,
    };
    upsert_workspace_supervisor_binding(state, workspace_id, binding.clone())?;
    Ok(binding)
}
```

- [ ] **Step 4: Add RPC handlers and frontend request wrappers**

```rust
#[derive(Deserialize)]
struct EnableSupervisorModeRequest {
    #[serde(flatten)]
    controller: WorkspaceControllerMutationRequest,
    session_id: String,
    provider: AgentProvider,
    objective_text: String,
}
```

```rust
"enable_supervisor_mode" => {
    let req: EnableSupervisorModeRequest = parse_payload(payload).map_err(rpc_bad_request)?;
    require_workspace_controller_mutation(app, &req.controller, authorized)?;
    let binding = crate::services::supervisor::enable_supervisor_mode(
        &req.controller.workspace_id,
        &req.session_id,
        req.provider,
        &req.objective_text,
        app.state(),
    ).map_err(rpc_bad_request)?;
    Ok(serde_json::to_value(binding).map_err(rpc_internal_error)?)
}
```

```ts
export const enableSupervisorMode = (
  workspaceId: string,
  controller: WorkspaceControllerState,
  sessionId: string,
  provider: AgentProvider,
  objectiveText: string,
) => invokeRpc<BackendWorkspaceSupervisorBinding>(
  'enable_supervisor_mode',
  createWorkspaceControllerRpcPayload(workspaceId, controller, {
    sessionId,
    provider,
    objectiveText,
  }),
)
```

- [ ] **Step 5: Add update/pause/resume/disable/retry RPC skeleton tests and minimal handlers**

```rust
#[test]
fn update_supervisor_objective_marks_pending_when_cycle_running() {
    let binding = seed_running_supervisor_binding_for_test(...);
    let updated = update_supervisor_objective(..., "Use Claude only in v1", ...).unwrap();
    assert_eq!(updated.pending_objective_version, Some(binding.objective_version + 1));
}
```

```rust
pub(crate) fn pause_supervisor_mode(...) -> Result<WorkspaceSupervisorBinding, String> { /* set Paused */ }
pub(crate) fn resume_supervisor_mode(...) -> Result<WorkspaceSupervisorBinding, String> { /* set Idle */ }
pub(crate) fn disable_supervisor_mode(...) -> Result<(), String> { /* remove binding and pending cycle guard */ }
pub(crate) fn retry_supervisor_cycle(...) -> Result<WorkspaceSupervisorCycle, String> { /* re-run latest failed cycle */ }
```

- [ ] **Step 6: Run focused server tests**

Run: `cargo test --manifest-path apps/server/Cargo.toml enable_supervisor_mode_composes_prompt_and_sets_idle_status update_supervisor_objective_marks_pending_when_cycle_running -- --exact`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add apps/server/src/services/supervisor.rs apps/server/src/services/mod.rs apps/server/src/command/http.rs apps/server/src/services/workspace.rs apps/web/src/services/http/workspace.service.ts apps/web/src/features/workspace/supervisor-objective.ts
git commit -m "feat: add supervisor mode rpc flows"
```

### Task 3: Invoke supervisor per completed business turn and inject reply into terminal

**Files:**
- Create: `apps/server/src/services/supervisor.rs`
- Modify: `apps/server/src/services/agent.rs:1-260`
- Modify: `apps/server/src/services/workspace_runtime.rs`
- Modify: `apps/server/src/services/provider_registry.rs:1-56`
- Modify: `apps/server/src/services/claude.rs`
- Modify: `apps/server/src/services/codex.rs`
- Modify: `apps/server/src/services/terminal.rs:68-220`
- Modify: `apps/server/src/ws/protocol.rs`
- Modify: `apps/server/src/ws/server.rs`
- Test: `apps/server/src/services/supervisor.rs`
- Test: `apps/server/src/services/terminal.rs`
- Test: `apps/server/src/services/workspace_runtime.rs`

- [ ] **Step 1: Write the failing one-shot invocation test**

```rust
#[test]
fn completed_turn_invokes_supervisor_once_and_injects_reply() {
    let app = test_app();
    let workspace_id = launch_test_workspace(&app, "/tmp/supervisor-cycle");
    seed_supervisor_binding_for_test(app.state(), &workspace_id, "slot-primary", "Keep using xterm");
    bind_terminal_for_session_for_test(app.state(), &workspace_id, "slot-primary", 77);
    install_supervisor_adapter_reply_for_test("claude", "Do not redesign UI. Reuse xterm and implement auto injection.");

    handle_supervisor_turn_completed(
        app.state(),
        &workspace_id,
        "slot-primary",
        "turn-1",
        "user asked for v1 supervisor mode",
        "business agent started redesigning the chat UI",
    ).unwrap();

    let writes = take_terminal_writes_for_test(app.state(), &workspace_id, 77);
    assert_eq!(writes.len(), 1);
    assert!(writes[0].input.contains("Reuse xterm"));
    assert_eq!(writes[0].origin, TerminalWriteOrigin::Supervisor);
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cargo test --manifest-path apps/server/Cargo.toml completed_turn_invokes_supervisor_once_and_injects_reply -- --exact`
Expected: FAIL because supervisor trigger and terminal write origin do not exist.

- [ ] **Step 3: Add one-shot supervisor adapter interface**

```rust
pub(crate) trait ProviderAdapter: Sync {
    fn id(&self) -> &'static str;
    fn invoke_supervisor(
        &self,
        settings: &AppSettingsPayload,
        target: &ExecTarget,
        turn_context: &str,
    ) -> Result<String, String>;
    // existing methods unchanged
}
```

```rust
fn invoke_supervisor(
    &self,
    settings: &AppSettingsPayload,
    target: &ExecTarget,
    turn_context: &str,
) -> Result<String, String> {
    let launch = self.build_start(settings, target)?;
    crate::services::agent_client::run_one_shot_prompt(launch.launch_spec, turn_context)
}
```

- [ ] **Step 4: Build turn-scoped supervisor orchestration**

```rust
pub(crate) fn handle_supervisor_turn_completed(
    state: State<'_, AppState>,
    workspace_id: &str,
    session_id: &str,
    source_turn_id: &str,
    latest_user_input: &str,
    latest_agent_output: &str,
) -> Result<(), String> {
    let binding = load_active_supervisor_binding(state, workspace_id, session_id)?;
    if binding.status != WorkspaceSupervisorStatus::Idle || !binding.auto_inject_enabled {
        return Ok(());
    }

    let cycle = begin_supervisor_cycle(state, workspace_id, session_id, source_turn_id, &binding)?;
    let prompt = build_supervisor_turn_prompt(&binding, latest_user_input, latest_agent_output, latest_cycle_reply(state, workspace_id, session_id)?);
    let reply = invoke_supervisor_for_binding(state, &binding, &prompt)?;
    inject_supervisor_reply(state, workspace_id, session_id, &reply, &cycle.cycle_id)?;
    finish_supervisor_cycle_success(state, workspace_id, &cycle.cycle_id, &reply)?;
    Ok(())
}
```

- [ ] **Step 5: Extend terminal writes with supervisor origin metadata**

```rust
#[derive(Clone, Serialize, Deserialize, Debug, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum TerminalWriteOrigin {
    User,
    Supervisor,
}
```

```rust
pub(crate) fn terminal_write(
    workspace_id: String,
    terminal_id: u64,
    input: String,
    origin: TerminalWriteOrigin,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let decorated_input = match origin {
        TerminalWriteOrigin::User => input,
        TerminalWriteOrigin::Supervisor => format!("# [supervisor]\n{}", input),
    };
    // write decorated_input to PTY and emit origin in terminal transport event
}
```

- [ ] **Step 6: Hook completed-turn lifecycle into supervisor orchestration**

```rust
if kind == "turn_completed" {
    crate::services::supervisor::handle_turn_completed_from_lifecycle(
        app.state(),
        &workspace_id,
        &session_id,
        event_id,
        latest_user_message,
        latest_agent_output,
    )?;
}
```

- [ ] **Step 7: Run focused tests**

Run: `cargo test --manifest-path apps/server/Cargo.toml completed_turn_invokes_supervisor_once_and_injects_reply terminal_write_marks_supervisor_origin workspace_runtime_turn_completed_triggers_supervisor -- --exact`
Expected: PASS

- [ ] **Step 8: Commit**

```bash
git add apps/server/src/services/supervisor.rs apps/server/src/services/agent.rs apps/server/src/services/workspace_runtime.rs apps/server/src/services/provider_registry.rs apps/server/src/services/claude.rs apps/server/src/services/codex.rs apps/server/src/services/terminal.rs apps/server/src/ws/protocol.rs apps/server/src/ws/server.rs
git commit -m "feat: trigger turn-scoped supervisor injections"
```

### Task 4: Surface supervisor mode in workspace snapshot and frontend state

**Files:**
- Modify: `apps/server/src/services/workspace.rs`
- Modify: `apps/web/src/state/workbench-core.ts`
- Modify: `apps/web/src/types/app.ts`
- Modify: `apps/web/src/shared/utils/workspace.ts`
- Modify: `apps/web/src/features/workspace/session-actions.ts`
- Test: `tests/workspace-session-actions.test.ts`
- Test: `tests/workspace-recovery.test.ts`

- [ ] **Step 1: Write the failing frontend mapping test**

```ts
test('workspace snapshot maps supervisor binding onto the active session', () => {
  const tab = createTabFromWorkspaceSnapshot({
    workspace: workspaceSummaryFixture(),
    sessions: [backendSessionFixture({ id: 'slot-primary' })],
    view_state: {
      ...backendViewStateFixture(),
      supervisor: {
        bindings: [backendSupervisorBindingFixture({ session_id: 'slot-primary', status: 'idle' })],
        cycles: [backendSupervisorCycleFixture()],
      },
    },
    terminals: [],
  }, 'en', appSettingsFixture(), undefined)

  expect(tab.sessions[0].supervisor?.status).toBe('idle')
  expect(tab.sessions[0].supervisor?.latestCycle?.supervisorReply).toContain('next message')
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/workspace-session-actions.test.ts --test-name-pattern "maps supervisor binding"`
Expected: FAIL because session state has no supervisor property.

- [ ] **Step 3: Add frontend session supervisor state**

```ts
export type SessionSupervisorState = {
  provider: AgentProvider
  status: SupervisorStatus
  objectiveText: string
  objectivePrompt: string
  objectiveVersion: number
  autoInjectEnabled: boolean
  pendingObjectiveText?: string
  pendingObjectiveVersion?: number
  latestCycle?: WorkspaceSupervisorCycle
}

export type Session = {
  id: string
  title: string
  // existing fields
  supervisor?: SessionSupervisorState
}
```

```ts
const attachSupervisorState = (
  session: Session,
  backendViewState: BackendWorkspaceViewState,
): Session => {
  const binding = backendViewState.supervisor.bindings.find((item) => item.session_id === session.id)
  if (!binding) return session
  const latestCycle = [...backendViewState.supervisor.cycles]
    .filter((cycle) => cycle.session_id === session.id)
    .sort((a, b) => b.started_at - a.started_at)[0]

  return {
    ...session,
    supervisor: {
      provider: binding.provider,
      status: binding.status,
      objectiveText: binding.objective_text,
      objectivePrompt: binding.objective_prompt,
      objectiveVersion: binding.objective_version,
      autoInjectEnabled: binding.auto_inject_enabled,
      pendingObjectiveText: binding.pending_objective_text ?? undefined,
      pendingObjectiveVersion: binding.pending_objective_version ?? undefined,
      latestCycle: latestCycle ? mapBackendSupervisorCycle(latestCycle) : undefined,
    },
  }
}
```

- [ ] **Step 4: Use refreshed snapshot data after supervisor RPCs**

```ts
const refreshSupervisorState = async (tabId: string) => {
  const snapshot = await withServiceFallback(() => getWorkspaceSnapshot(tabId), null)
  if (!snapshot) return
  updateTab(tabId, (tab) => createTabFromWorkspaceSnapshot(snapshot, locale, appSettings, tab))
}
```

- [ ] **Step 5: Run focused frontend tests**

Run: `node --test tests/workspace-session-actions.test.ts tests/workspace-recovery.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add apps/server/src/services/workspace.rs apps/web/src/state/workbench-core.ts apps/web/src/types/app.ts apps/web/src/shared/utils/workspace.ts apps/web/src/features/workspace/session-actions.ts tests/workspace-session-actions.test.ts tests/workspace-recovery.test.ts
git commit -m "feat: expose supervisor state in workspace snapshots"
```

### Task 5: Build the management panel and objective dialog

**Files:**
- Create: `apps/web/src/components/workspace/WorkspaceSupervisorPanel.tsx`
- Create: `apps/web/src/components/workspace/WorkspaceSupervisorDialog.tsx`
- Modify: `apps/web/src/components/workspace/index.ts`
- Modify: `apps/web/src/features/workspace/WorkspaceScreen.tsx`
- Modify: `apps/web/src/i18n.ts`
- Test: `tests/workspace-panel-structure.test.ts`
- Test: `tests/confirm-dialog-layout.test.ts`
- Test: `tests/workspace-panel-controls.test.ts`

- [ ] **Step 1: Write the failing management panel test**

```ts
test('renders supervisor panel for the active session when supervisor mode is enabled', async () => {
  render(<WorkspaceScreen locale="en" appSettings={appSettingsFixture()} onOpenSettings={() => {}} />)
  seedWorkspaceWithSupervisorMode('slot-primary')

  expect(await screen.findByRole('tab', { name: /Management Panel/i })).toBeVisible()
  expect(screen.getByText(/Edit Objective/i)).toBeVisible()
  expect(screen.getByText(/Retry Last Failed Cycle/i)).toBeVisible()
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/workspace-panel-structure.test.ts --test-name-pattern "supervisor panel"`
Expected: FAIL because no supervisor panel exists.

- [ ] **Step 3: Add focused supervisor panel component**

```tsx
export const WorkspaceSupervisorPanel = ({
  session,
  onPause,
  onResume,
  onDisable,
  onRetry,
  onEditObjective,
}: WorkspaceSupervisorPanelProps) => {
  const supervisor = session.supervisor
  if (!supervisor) return null

  return (
    <section className="workspace-supervisor-panel">
      <header>
        <h3>Management Panel</h3>
        <p>{supervisor.status}</p>
      </header>
      <div>
        <strong>Objective</strong>
        <pre>{supervisor.objectiveText}</pre>
      </div>
      <div>
        <strong>Latest reply</strong>
        <pre>{supervisor.latestCycle?.supervisorReply ?? '—'}</pre>
      </div>
      <div>
        <button onClick={onEditObjective}>Edit Objective</button>
        {supervisor.status === 'paused'
          ? <button onClick={onResume}>Resume</button>
          : <button onClick={onPause}>Pause</button>}
        <button onClick={onRetry}>Retry Last Failed Cycle</button>
        <button onClick={onDisable}>Disable</button>
      </div>
    </section>
  )
}
```

- [ ] **Step 4: Add single-input objective dialog**

```tsx
export const WorkspaceSupervisorDialog = ({
  initialValue,
  title,
  onCancel,
  onSubmit,
}: WorkspaceSupervisorDialogProps) => {
  const [value, setValue] = useState(initialValue)
  return (
    <ConfirmDialog
      title={title}
      confirmLabel="Save"
      cancelLabel="Cancel"
      onConfirm={() => onSubmit(value)}
      onCancel={onCancel}
    >
      <textarea
        aria-label="Supervisor objective"
        value={value}
        onChange={(event) => setValue(event.target.value)}
        rows={12}
      />
    </ConfirmDialog>
  )
}
```

- [ ] **Step 5: Mount the panel as the second workspace tab**

```tsx
const supervisorTabVisible = Boolean(activeSession?.supervisor)
const panelTabs = supervisorTabVisible
  ? [
      { id: 'business-terminal', label: t('businessTerminalTab') },
      { id: 'management-panel', label: t('managementPanelTab') },
    ]
  : [{ id: 'business-terminal', label: t('businessTerminalTab') }]
```

- [ ] **Step 6: Run focused frontend tests**

Run: `node --test tests/workspace-panel-structure.test.ts tests/workspace-panel-controls.test.ts tests/confirm-dialog-layout.test.ts`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/components/workspace/WorkspaceSupervisorPanel.tsx apps/web/src/components/workspace/WorkspaceSupervisorDialog.tsx apps/web/src/components/workspace/index.ts apps/web/src/features/workspace/WorkspaceScreen.tsx apps/web/src/i18n.ts tests/workspace-panel-structure.test.ts tests/workspace-panel-controls.test.ts tests/confirm-dialog-layout.test.ts
git commit -m "feat: add workspace supervisor management panel"
```

### Task 6: Wire terminal origin markers and supervisor UI actions end to end

**Files:**
- Modify: `apps/web/src/services/http/terminal.service.ts`
- Modify: `apps/web/src/features/workspace/terminal-actions.ts`
- Modify: `apps/web/src/shared/utils/session.ts`
- Modify: `apps/web/src/features/workspace/WorkspaceScreen.tsx`
- Modify: `apps/web/src/ws/protocol.ts`
- Modify: `tests/xterm-output-sync.test.ts`
- Modify: `tests/session-actions.test.ts`
- Modify: `tests/e2e/e2e.spec.ts`
- Modify: `tests/e2e/transport.spec.ts`

- [ ] **Step 1: Write the failing origin marker test**

```ts
test('supervisor-origin terminal writes render with a visible supervisor marker', () => {
  const output = applyTerminalWriteOriginMarker('Implement the minimal loop', 'supervisor')
  expect(output).toContain('[supervisor]')
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/xterm-output-sync.test.ts --test-name-pattern "supervisor-origin"`
Expected: FAIL because marker helper and origin plumbing do not exist.

- [ ] **Step 3: Add terminal write origin metadata to client transport**

```ts
export type TerminalWriteOrigin = 'user' | 'supervisor'

export const writeTerminal = (
  workspaceId: string,
  controller: WorkspaceControllerState,
  terminalId: number,
  input: string,
  origin: TerminalWriteOrigin = 'user',
) => sendWsMutationWithHttpFallback(
  () => sendWsMessage({
    type: 'terminal_write',
    workspace_id: workspaceId,
    terminal_id: terminalId,
    input,
    origin,
    fencing_token: controller.fencingToken,
  }),
  () => invokeRpc<void>('terminal_write', createWorkspaceControllerRpcPayload(workspaceId, controller, { terminalId, input, origin })),
)
```

- [ ] **Step 4: Add marker helper used by xterm output sync**

```ts
export const applyTerminalWriteOriginMarker = (input: string, origin: TerminalWriteOrigin) => (
  origin === 'supervisor'
    ? `\n[supervisor]\n${input}\n`
    : input
)
```

- [ ] **Step 5: Wire UI actions for enable/edit/pause/resume/disable/retry**

```ts
const onEnableSupervisor = async (tabId: string, sessionId: string, provider: AgentProvider, objectiveText: string) => {
  await enableSupervisorMode(tabId, requireController(tabId), sessionId, provider, objectiveText)
  await refreshTabFromBackend(tabId)
}
```

```ts
const onEditSupervisorObjective = async (tabId: string, sessionId: string, objectiveText: string) => {
  await updateSupervisorObjective(tabId, requireController(tabId), sessionId, objectiveText)
  await refreshTabFromBackend(tabId)
}
```

- [ ] **Step 6: Run targeted web and e2e tests**

Run: `node --test tests/xterm-output-sync.test.ts tests/session-actions.test.ts && pnpm test:e2e --grep "supervisor|terminal origin|management panel"`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/services/http/terminal.service.ts apps/web/src/features/workspace/terminal-actions.ts apps/web/src/shared/utils/session.ts apps/web/src/features/workspace/WorkspaceScreen.tsx apps/web/src/ws/protocol.ts tests/xterm-output-sync.test.ts tests/session-actions.test.ts tests/e2e/e2e.spec.ts tests/e2e/transport.spec.ts
git commit -m "feat: wire supervisor terminal markers and actions"
```

### Task 7: Run full verification and remove drift

**Files:**
- Modify: any remaining references found during cleanup
- Test: server, web, and e2e suites

- [ ] **Step 1: Write the final regression checklist as search targets**

```text
supervisor runtime
start()
sendTurnContext()
readResult()
no dedicated xterm view is required
terminal_write origin
```

- [ ] **Step 2: Run server test suites**

Run: `cargo test --manifest-path apps/server/Cargo.toml services::supervisor:: command::http:: services::terminal:: services::workspace_runtime::`
Expected: PASS

- [ ] **Step 3: Run web unit tests**

Run: `node --test tests/workspace-session-actions.test.ts tests/workspace-recovery.test.ts tests/workspace-panel-structure.test.ts tests/workspace-panel-controls.test.ts tests/xterm-output-sync.test.ts tests/session-actions.test.ts`
Expected: PASS

- [ ] **Step 4: Run end-to-end coverage**

Run: `pnpm test:e2e --grep "supervisor|management panel|terminal origin"`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/server/src apps/web/src tests
git commit -m "test: verify intelligent session supervisor flows"
```

## Self-Review

### Spec coverage
- Single-input objective setup before startup → Task 2 and Task 5
- Objective prompt recomposition and versioning → Task 2
- Turn-scoped supervisor invocation instead of long-lived xterm → Task 3
- No dedicated supervisor xterm, management panel only → Task 5
- Supervisor reply injected back into business terminal → Task 3 and Task 6
- Visible supervisor-origin terminal marker → Task 3 and Task 6
- Pause/resume/disable/retry flows → Task 2, Task 5, Task 6
- Pending objective update while cycle is already running → Task 2 and Task 3
- Refresh/restart durability → Task 1 and Task 4

No spec requirement is left uncovered.

### Placeholder scan
- No `TODO`, `TBD`, or “similar to Task N” placeholders remain.
- Every task includes explicit files, code examples, run commands, and expected outcomes.
- All code-changing tasks include concrete code blocks.

### Type consistency
- Backend persistence uses `WorkspaceSupervisorBinding`, `WorkspaceSupervisorCycle`, and `WorkspaceSupervisorStatus` consistently.
- Frontend state uses `SessionSupervisorState` mapped from backend view-state supervisor payloads.
- Turn-scoped invocation consistently uses `supervisorReply` and `TerminalWriteOrigin::Supervisor` rather than mixing instruction/report terminology.
