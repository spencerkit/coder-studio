use crate::*;

fn load_supervisor_view_state(
    state: State<'_, AppState>,
    workspace_id: &str,
) -> Result<WorkspaceSupervisorViewState, String> {
    Ok(load_workspace_snapshot(state, workspace_id)?.view_state.supervisor)
}

fn save_supervisor_view_state(
    state: State<'_, AppState>,
    workspace_id: &str,
    supervisor: WorkspaceSupervisorViewState,
) -> Result<WorkspaceViewState, String> {
    crate::services::workspace::workspace_view_update(
        workspace_id.to_string(),
        WorkspaceViewPatch {
            supervisor: Some(supervisor),
            ..WorkspaceViewPatch::default()
        },
        state,
    )
}

fn replace_binding(
    supervisor: &WorkspaceSupervisorViewState,
    binding: WorkspaceSupervisorBinding,
) -> WorkspaceSupervisorViewState {
    let mut bindings = supervisor.bindings.clone();
    if let Some(index) = bindings.iter().position(|item| item.session_id == binding.session_id) {
        bindings[index] = binding;
    } else {
        bindings.push(binding);
    }
    WorkspaceSupervisorViewState {
        bindings,
        cycles: supervisor.cycles.clone(),
    }
}

fn remove_binding_for_session(
    supervisor: &WorkspaceSupervisorViewState,
    session_id: &str,
) -> WorkspaceSupervisorViewState {
    WorkspaceSupervisorViewState {
        bindings: supervisor
            .bindings
            .iter()
            .filter(|binding| binding.session_id != session_id)
            .cloned()
            .collect(),
        cycles: supervisor.cycles.clone(),
    }
}

fn latest_cycle_for_session<'a>(
    supervisor: &'a WorkspaceSupervisorViewState,
    session_id: &str,
) -> Option<&'a WorkspaceSupervisorCycle> {
    supervisor
        .cycles
        .iter()
        .filter(|cycle| cycle.session_id == session_id)
        .max_by_key(|cycle| cycle.started_at)
}

fn replace_cycle(
    supervisor: &WorkspaceSupervisorViewState,
    cycle: WorkspaceSupervisorCycle,
) -> WorkspaceSupervisorViewState {
    let mut cycles = supervisor.cycles.clone();
    if let Some(index) = cycles.iter().position(|item| item.cycle_id == cycle.cycle_id) {
        cycles[index] = cycle;
    } else {
        cycles.push(cycle);
    }
    WorkspaceSupervisorViewState {
        bindings: supervisor.bindings.clone(),
        cycles,
    }
}

fn binding_for_session(
    supervisor: &WorkspaceSupervisorViewState,
    session_id: &str,
) -> Result<WorkspaceSupervisorBinding, String> {
    supervisor
        .bindings
        .iter()
        .find(|binding| binding.session_id == session_id)
        .cloned()
        .ok_or_else(|| "supervisor_binding_not_found".to_string())
}

fn apply_pending_or_active_objective(
    binding: &WorkspaceSupervisorBinding,
    objective_text: &str,
    objective_prompt: String,
    now: i64,
) -> WorkspaceSupervisorBinding {
    let is_cycle_running = matches!(binding.status, WorkspaceSupervisorStatus::Evaluating | WorkspaceSupervisorStatus::Injecting)
        || matches!(
            binding.pending_objective_version,
            Some(version) if version > binding.objective_version
        );

    if is_cycle_running {
        WorkspaceSupervisorBinding {
            pending_objective_text: Some(objective_text.trim().to_string()),
            pending_objective_prompt: Some(objective_prompt),
            pending_objective_version: Some(binding.objective_version + 1),
            updated_at: now,
            ..binding.clone()
        }
    } else {
        WorkspaceSupervisorBinding {
            objective_text: objective_text.trim().to_string(),
            objective_prompt,
            objective_version: binding.objective_version + 1,
            pending_objective_text: None,
            pending_objective_prompt: None,
            pending_objective_version: None,
            updated_at: now,
            ..binding.clone()
        }
    }
}

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

pub(crate) fn enable_supervisor_mode(
    workspace_id: &str,
    session_id: &str,
    objective_text: &str,
    state: State<'_, AppState>,
) -> Result<WorkspaceSupervisorBinding, String> {
    let session = crate::services::workspace::resolve_session_for_slot(state, workspace_id, session_id)?;
    let objective_prompt = compose_objective_prompt(objective_text)?;
    let supervisor = load_supervisor_view_state(state, workspace_id)?;
    if supervisor
        .bindings
        .iter()
        .any(|binding| binding.session_id == session_id)
    {
        return Err("supervisor_binding_already_exists".to_string());
    }
    let now = now_ts();
    let binding = WorkspaceSupervisorBinding {
        session_id: session_id.to_string(),
        provider: session.provider,
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
    let updated = replace_binding(&supervisor, binding.clone());
    save_supervisor_view_state(state, workspace_id, updated)?;
    Ok(binding)
}

pub(crate) fn update_supervisor_objective(
    workspace_id: &str,
    session_id: &str,
    objective_text: &str,
    state: State<'_, AppState>,
) -> Result<WorkspaceSupervisorBinding, String> {
    let objective_prompt = compose_objective_prompt(objective_text)?;
    let supervisor = load_supervisor_view_state(state, workspace_id)?;
    let binding = binding_for_session(&supervisor, session_id)?;
    let updated_binding = apply_pending_or_active_objective(&binding, objective_text, objective_prompt, now_ts());
    let updated = replace_binding(&supervisor, updated_binding.clone());
    save_supervisor_view_state(state, workspace_id, updated)?;
    Ok(updated_binding)
}

pub(crate) fn pause_supervisor_mode(
    workspace_id: &str,
    session_id: &str,
    state: State<'_, AppState>,
) -> Result<WorkspaceSupervisorBinding, String> {
    let supervisor = load_supervisor_view_state(state, workspace_id)?;
    let binding = binding_for_session(&supervisor, session_id)?;
    if matches!(
        binding.status,
        WorkspaceSupervisorStatus::Evaluating | WorkspaceSupervisorStatus::Injecting
    ) {
        return Err("supervisor_cycle_running".to_string());
    }
    if binding.status == WorkspaceSupervisorStatus::Paused {
        return Ok(binding);
    }
    let updated_binding = WorkspaceSupervisorBinding {
        status: WorkspaceSupervisorStatus::Paused,
        updated_at: now_ts(),
        ..binding
    };
    let updated = replace_binding(&supervisor, updated_binding.clone());
    save_supervisor_view_state(state, workspace_id, updated)?;
    Ok(updated_binding)
}

pub(crate) fn resume_supervisor_mode(
    workspace_id: &str,
    session_id: &str,
    state: State<'_, AppState>,
) -> Result<WorkspaceSupervisorBinding, String> {
    let supervisor = load_supervisor_view_state(state, workspace_id)?;
    let binding = binding_for_session(&supervisor, session_id)?;
    if binding.status != WorkspaceSupervisorStatus::Paused {
        return Err("supervisor_not_paused".to_string());
    }
    let updated_binding = WorkspaceSupervisorBinding {
        status: WorkspaceSupervisorStatus::Idle,
        updated_at: now_ts(),
        ..binding
    };
    let updated = replace_binding(&supervisor, updated_binding.clone());
    save_supervisor_view_state(state, workspace_id, updated)?;
    Ok(updated_binding)
}

pub(crate) fn disable_supervisor_mode(
    workspace_id: &str,
    session_id: &str,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let supervisor = load_supervisor_view_state(state, workspace_id)?;
    let binding = binding_for_session(&supervisor, session_id)?;
    if matches!(
        binding.status,
        WorkspaceSupervisorStatus::Evaluating | WorkspaceSupervisorStatus::Injecting
    ) {
        return Err("supervisor_cycle_running".to_string());
    }
    let updated = remove_binding_for_session(&supervisor, session_id);
    save_supervisor_view_state(state, workspace_id, updated)?;
    Ok(())
}

pub(crate) fn retry_supervisor_cycle(
    app: &AppHandle,
    workspace_id: &str,
    session_id: &str,
    state: State<'_, AppState>,
) -> Result<WorkspaceSupervisorCycle, String> {
    let supervisor = load_supervisor_view_state(state, workspace_id)?;
    let binding = binding_for_session(&supervisor, session_id)?;
    if matches!(
        binding.status,
        WorkspaceSupervisorStatus::Evaluating | WorkspaceSupervisorStatus::Injecting
    ) {
        return Err("supervisor_cycle_running".to_string());
    }
    if binding.status == WorkspaceSupervisorStatus::Paused {
        return Err("supervisor_paused".to_string());
    }
    let cycle = latest_cycle_for_session(&supervisor, session_id)
        .cloned()
        .ok_or_else(|| "supervisor_cycle_not_found".to_string())?;

    if cycle.status != WorkspaceSupervisorCycleStatus::Failed {
        return Err("supervisor_cycle_not_failed".to_string());
    }

    let retried_cycle = WorkspaceSupervisorCycle {
        supervisor_reply: None,
        injection_message_id: None,
        status: WorkspaceSupervisorCycleStatus::Queued,
        error: None,
        finished_at: None,
        ..cycle
    };
    let updated_binding = WorkspaceSupervisorBinding {
        status: WorkspaceSupervisorStatus::Idle,
        updated_at: now_ts(),
        ..binding
    };
    let updated = replace_cycle(
        &replace_binding(&supervisor, updated_binding),
        retried_cycle.clone(),
    );
    save_supervisor_view_state(state, workspace_id, updated)?;
    let _ = handle_supervisor_turn_completed(
        app,
        workspace_id,
        session_id,
        &retried_cycle.source_turn_id,
        "",
        &retried_cycle.supervisor_input,
    );
    Ok(retried_cycle)
}

fn session_terminal_id(
    workspace_id: &str,
    session_id: &str,
    state: State<'_, AppState>,
) -> Result<u64, String> {
    state
        .session_runtime_bindings
        .lock()
        .map_err(|e| e.to_string())?
        .get(&crate::services::session_runtime::session_runtime_key(
            workspace_id,
            session_id,
        ))
        .copied()
        .ok_or_else(|| "terminal_not_found".to_string())
}

fn build_supervisor_turn_prompt(
    binding: &WorkspaceSupervisorBinding,
    latest_user_input: &str,
    latest_agent_output: &str,
) -> String {
    format!(
        "{}\nLatest user input:\n{}\n\nLatest business agent output:\n{}\n\nReturn only the next message that should be sent back to the business agent.\n",
        binding.objective_prompt,
        latest_user_input.trim(),
        latest_agent_output.trim(),
    )
}

fn finalize_binding_after_cycle(
    binding: &WorkspaceSupervisorBinding,
    status: WorkspaceSupervisorStatus,
    now: i64,
) -> WorkspaceSupervisorBinding {
    if let (
        Some(pending_objective_text),
        Some(pending_objective_prompt),
        Some(pending_objective_version),
    ) = (
        binding.pending_objective_text.as_ref(),
        binding.pending_objective_prompt.as_ref(),
        binding.pending_objective_version,
    ) {
        WorkspaceSupervisorBinding {
            objective_text: pending_objective_text.clone(),
            objective_prompt: pending_objective_prompt.clone(),
            objective_version: pending_objective_version,
            pending_objective_text: None,
            pending_objective_prompt: None,
            pending_objective_version: None,
            status,
            updated_at: now,
            ..binding.clone()
        }
    } else {
        WorkspaceSupervisorBinding {
            status,
            updated_at: now,
            ..binding.clone()
        }
    }
}

fn persist_failed_cycle(
    state: State<'_, AppState>,
    workspace_id: &str,
    binding: &WorkspaceSupervisorBinding,
    cycle: &WorkspaceSupervisorCycle,
    error: &str,
) -> Result<(), String> {
    let finished_at = now_ts();
    let supervisor = load_supervisor_view_state(state, workspace_id)?;
    let failed_binding = finalize_binding_after_cycle(
        binding,
        WorkspaceSupervisorStatus::Error,
        finished_at,
    );
    let failed_cycle = WorkspaceSupervisorCycle {
        status: WorkspaceSupervisorCycleStatus::Failed,
        error: Some(error.to_string()),
        finished_at: Some(finished_at),
        ..cycle.clone()
    };
    let updated = replace_cycle(
        &replace_binding(&supervisor, failed_binding),
        failed_cycle,
    );
    save_supervisor_view_state(state, workspace_id, updated).map(|_| ())
}

pub(crate) fn handle_supervisor_turn_completed(
    app: &AppHandle,
    workspace_id: &str,
    session_id: &str,
    source_turn_id: &str,
    latest_user_input: &str,
    latest_agent_output: &str,
) -> Result<(), String> {
    let state: State<AppState> = app.state();
    let supervisor = load_supervisor_view_state(state, workspace_id)?;
    let binding = match binding_for_session(&supervisor, session_id) {
        Ok(binding) => binding,
        Err(error) if error == "supervisor_binding_not_found" => return Ok(()),
        Err(error) => return Err(error),
    };

    if binding.status != WorkspaceSupervisorStatus::Idle || !binding.auto_inject_enabled {
        return Ok(());
    }
    if latest_cycle_for_session(&supervisor, session_id)
        .is_some_and(|cycle| cycle.source_turn_id == source_turn_id)
    {
        return Ok(());
    }

    let started_at = now_ts();
    let cycle_id = format!("supervisor-cycle-{started_at}");
    let cycle = WorkspaceSupervisorCycle {
        cycle_id: cycle_id.clone(),
        session_id: session_id.to_string(),
        source_turn_id: source_turn_id.to_string(),
        objective_version: binding.objective_version,
        supervisor_input: build_supervisor_turn_prompt(
            &binding,
            latest_user_input,
            latest_agent_output,
        ),
        supervisor_reply: None,
        injection_message_id: None,
        status: WorkspaceSupervisorCycleStatus::Evaluating,
        error: None,
        started_at,
        finished_at: None,
    };
    let evaluating_binding = WorkspaceSupervisorBinding {
        status: WorkspaceSupervisorStatus::Evaluating,
        updated_at: started_at,
        ..binding.clone()
    };
    let evaluating = replace_cycle(
        &replace_binding(&supervisor, evaluating_binding),
        cycle.clone(),
    );
    save_supervisor_view_state(state, workspace_id, evaluating)?;

    let reply = (|| -> Result<String, String> {
        let (workspace_cwd, workspace_target) = workspace_access_context(state, workspace_id)?;
        let settings = load_or_default_app_settings(state)?;
        let adapter = crate::services::provider_registry::resolve_provider_adapter(binding.provider.as_str())
            .ok_or_else(|| format!("unknown_provider:{}", binding.provider.as_str()))?;
        adapter.ensure_workspace_integration(&workspace_cwd, &workspace_target)?;
        let launch = adapter.build_supervisor_invoke(&settings, &workspace_target)?;
        crate::services::agent_client::run_one_shot_prompt(
            &launch.launch_spec,
            &workspace_cwd,
            &launch.runtime_env,
            &cycle.supervisor_input,
        )
    })();

    let reply = match reply {
        Ok(reply) => reply,
        Err(error) => {
            let _ = persist_failed_cycle(state, workspace_id, &binding, &cycle, &error);
            return Err(error);
        }
    };
    let trimmed_reply = reply.trim();
    if trimmed_reply.is_empty() {
        let error = "supervisor_reply_empty".to_string();
        let _ = persist_failed_cycle(state, workspace_id, &binding, &cycle, &error);
        return Err(error);
    }
    let terminal_id = match session_terminal_id(workspace_id, session_id, state) {
        Ok(terminal_id) => terminal_id,
        Err(error) => {
            let _ = persist_failed_cycle(state, workspace_id, &binding, &cycle, &error);
            return Err(error);
        }
    };
    if let Err(error) = crate::services::terminal::terminal_write(
        workspace_id.to_string(),
        terminal_id,
        format!("{}\r", trimmed_reply),
        TerminalWriteOrigin::Supervisor,
        state,
    ) {
        let _ = persist_failed_cycle(state, workspace_id, &binding, &cycle, &error);
        return Err(error);
    }

    let finished_at = now_ts();
    let supervisor = load_supervisor_view_state(state, workspace_id)?;
    let updated_binding = finalize_binding_after_cycle(
        &binding,
        WorkspaceSupervisorStatus::Idle,
        finished_at,
    );
    let completed_cycle = WorkspaceSupervisorCycle {
        supervisor_reply: Some(trimmed_reply.to_string()),
        injection_message_id: Some(format!("terminal:{terminal_id}")),
        status: WorkspaceSupervisorCycleStatus::Injected,
        finished_at: Some(finished_at),
        ..cycle
    };
    let updated = replace_cycle(
        &replace_binding(&supervisor, updated_binding),
        completed_cycle,
    );
    save_supervisor_view_state(state, workspace_id, updated)?;
    Ok(())
}

#[cfg(test)]
pub(crate) fn handle_turn_completed_from_lifecycle(
    app: &AppHandle,
    workspace_id: &str,
    session_id: &str,
    source_turn_id: &str,
    latest_user_input: &str,
    latest_agent_output: &str,
) -> Result<(), String> {
    handle_supervisor_turn_completed(
        app,
        workspace_id,
        session_id,
        source_turn_id,
        latest_user_input,
        latest_agent_output,
    )
}

#[cfg(test)]
pub(crate) fn bind_terminal_for_session_for_test(
    state: State<'_, AppState>,
    workspace_id: &str,
    session_id: &str,
    terminal_id: u64,
) {
    state
        .session_runtime_bindings
        .lock()
        .unwrap()
        .insert(
            crate::services::session_runtime::session_runtime_key(workspace_id, session_id),
            terminal_id,
        );
    state
        .terminal_runtime_bindings
        .lock()
        .unwrap()
        .insert(terminal_id, format!("{workspace_id}:{session_id}"));
}

#[cfg(test)]
pub(crate) fn seed_supervisor_binding_for_test(
    state: State<'_, AppState>,
    workspace_id: &str,
    session_id: &str,
    objective_text: &str,
) {
    enable_supervisor_mode(
        workspace_id,
        session_id,
        objective_text,
        state,
    )
    .unwrap();
}

#[cfg(test)]
pub(crate) fn take_terminal_writes_for_test(
    state: State<'_, AppState>,
    workspace_id: &str,
    terminal_id: u64,
) -> Vec<(String, TerminalWriteOrigin)> {
    let mut guard = state.terminal_write_log.lock().unwrap();
    let mut kept = Vec::new();
    let mut matched = Vec::new();
    for (logged_workspace_id, logged_terminal_id, input, origin) in guard.drain(..) {
        if logged_workspace_id == workspace_id && logged_terminal_id == terminal_id {
            matched.push((input, origin));
        } else {
            kept.push((logged_workspace_id, logged_terminal_id, input, origin));
        }
    }
    *guard = kept;
    matched
}

#[cfg(test)]
pub(crate) fn install_supervisor_adapter_reply_for_test(reply: &str) {
    std::env::set_var("CODER_STUDIO_TEST_SUPERVISOR_REPLY", reply);
}

#[cfg(test)]
pub(crate) fn clear_supervisor_adapter_reply_for_test() {
    std::env::remove_var("CODER_STUDIO_TEST_SUPERVISOR_REPLY");
}

#[cfg(test)]
pub(crate) fn supervisor_reply_test_lock() -> &'static std::sync::Mutex<()> {
    use std::sync::{Mutex, OnceLock};

    static LOCK: OnceLock<Mutex<()>> = OnceLock::new();
    LOCK.get_or_init(|| Mutex::new(()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::runtime::RuntimeHandle;

    fn test_app() -> AppHandle {
        let (app, _shutdown_rx) = RuntimeHandle::new();
        let conn = Connection::open_in_memory().unwrap();
        init_db(&conn).unwrap();
        *app.state().db.lock().unwrap() = Some(conn);
        app
    }

    fn launch_test_workspace(app: &AppHandle, root: &str) -> String {
        let result = launch_workspace_record(
            app.state(),
            WorkspaceSource {
                kind: WorkspaceSourceKind::Local,
                path_or_url: root.to_string(),
                target: ExecTarget::Native,
            },
            root.to_string(),
            default_idle_policy(),
        )
        .unwrap();
        result.snapshot.workspace.workspace_id
    }

    #[test]
    fn enable_supervisor_mode_rejects_missing_session() {
        let app = test_app();
        let workspace_id = launch_test_workspace(&app, "/tmp/supervisor-missing-session");

        let error = enable_supervisor_mode(
            &workspace_id,
            "slot-missing",
            "Keep using xterm only.",
            app.state(),
        )
        .expect_err("missing session should be rejected");

        assert_eq!(error, "session_not_found");
    }

    #[test]
    fn enable_supervisor_mode_rejects_duplicate_binding() {
        let app = test_app();
        let workspace_id = launch_test_workspace(&app, "/tmp/supervisor-duplicate-binding");
        enable_supervisor_mode(
            &workspace_id,
            "slot-primary",
            "Keep using xterm only.",
            app.state(),
        )
        .unwrap();

        let error = enable_supervisor_mode(
            &workspace_id,
            "slot-primary",
            "Updated objective.",
            app.state(),
        )
        .expect_err("duplicate binding should be rejected");

        assert_eq!(error, "supervisor_binding_already_exists");
    }

    fn seed_supervisor_cycle(
        app: &AppHandle,
        workspace_id: &str,
        binding: &WorkspaceSupervisorBinding,
        cycle_id: &str,
        status: WorkspaceSupervisorCycleStatus,
        started_at: i64,
    ) {
        let snapshot = load_workspace_snapshot(app.state(), workspace_id).unwrap();
        let mut cycles = snapshot.view_state.supervisor.cycles.clone();
        cycles.push(WorkspaceSupervisorCycle {
            cycle_id: cycle_id.to_string(),
            session_id: binding.session_id.clone(),
            source_turn_id: format!("turn-{started_at}"),
            objective_version: binding.objective_version,
            supervisor_input: "prompt".to_string(),
            supervisor_reply: None,
            injection_message_id: None,
            status: status.clone(),
            error: (status == WorkspaceSupervisorCycleStatus::Failed)
                .then(|| "provider_error".to_string()),
            started_at,
            finished_at: Some(started_at + 1),
        });
        patch_workspace_view_state(
            app.state(),
            workspace_id,
            WorkspaceViewPatch {
                supervisor: Some(WorkspaceSupervisorViewState {
                    bindings: snapshot.view_state.supervisor.bindings,
                    cycles,
                }),
                ..WorkspaceViewPatch::default()
            },
        )
        .unwrap();
    }

    #[test]
    fn update_supervisor_objective_marks_pending_when_binding_is_evaluating() {
        let app = test_app();
        let workspace_id = launch_test_workspace(&app, "/tmp/supervisor-pending-evaluating");
        let enabled = enable_supervisor_mode(
            &workspace_id,
            "slot-primary",
            "Keep using xterm only.",
            app.state(),
        )
        .unwrap();
        patch_workspace_view_state(
            app.state(),
            &workspace_id,
            WorkspaceViewPatch {
                supervisor: Some(WorkspaceSupervisorViewState {
                    bindings: vec![WorkspaceSupervisorBinding {
                        status: WorkspaceSupervisorStatus::Evaluating,
                        ..enabled.clone()
                    }],
                    cycles: vec![],
                }),
                ..WorkspaceViewPatch::default()
            },
        )
        .unwrap();

        let updated = update_supervisor_objective(
            &workspace_id,
            "slot-primary",
            "Use Claude only in v1.",
            app.state(),
        )
        .unwrap();

        assert_eq!(updated.objective_text, enabled.objective_text);
        assert_eq!(updated.objective_version, enabled.objective_version);
        assert_eq!(updated.pending_objective_text.as_deref(), Some("Use Claude only in v1."));
        assert!(updated
            .pending_objective_prompt
            .as_deref()
            .is_some_and(|prompt| prompt.contains("Active objective:\nUse Claude only in v1.")));
        assert_eq!(
            updated.pending_objective_version,
            Some(enabled.objective_version + 1)
        );
    }

    #[test]
    fn pause_supervisor_mode_rejects_running_cycle() {
        let app = test_app();
        let workspace_id = launch_test_workspace(&app, "/tmp/supervisor-pause-running");
        let enabled = enable_supervisor_mode(
            &workspace_id,
            "slot-primary",
            "Keep using xterm only.",
            app.state(),
        )
        .unwrap();
        patch_workspace_view_state(
            app.state(),
            &workspace_id,
            WorkspaceViewPatch {
                supervisor: Some(WorkspaceSupervisorViewState {
                    bindings: vec![WorkspaceSupervisorBinding {
                        status: WorkspaceSupervisorStatus::Evaluating,
                        ..enabled
                    }],
                    cycles: vec![],
                }),
                ..WorkspaceViewPatch::default()
            },
        )
        .unwrap();

        let error = pause_supervisor_mode(&workspace_id, "slot-primary", app.state())
            .expect_err("running cycle should block pause");
        assert_eq!(error, "supervisor_cycle_running");
    }

    #[test]
    fn resume_supervisor_mode_rejects_when_not_paused() {
        let app = test_app();
        let workspace_id = launch_test_workspace(&app, "/tmp/supervisor-resume-not-paused");
        enable_supervisor_mode(
            &workspace_id,
            "slot-primary",
            "Keep using xterm only.",
            app.state(),
        )
        .unwrap();

        let error = resume_supervisor_mode(&workspace_id, "slot-primary", app.state())
            .expect_err("resume should require paused status");
        assert_eq!(error, "supervisor_not_paused");
    }

    #[test]
    fn pause_and_resume_supervisor_mode_update_binding_status() {
        let app = test_app();
        let workspace_id = launch_test_workspace(&app, "/tmp/supervisor-pause-resume");
        enable_supervisor_mode(
            &workspace_id,
            "slot-primary",
            "Keep using xterm only.",
            app.state(),
        )
        .unwrap();

        let paused = pause_supervisor_mode(&workspace_id, "slot-primary", app.state()).unwrap();
        assert_eq!(paused.status, WorkspaceSupervisorStatus::Paused);

        let resumed = resume_supervisor_mode(&workspace_id, "slot-primary", app.state()).unwrap();
        assert_eq!(resumed.status, WorkspaceSupervisorStatus::Idle);
    }

    #[test]
    fn disable_supervisor_mode_rejects_running_cycle() {
        let app = test_app();
        let workspace_id = launch_test_workspace(&app, "/tmp/supervisor-disable-running");
        let enabled = enable_supervisor_mode(
            &workspace_id,
            "slot-primary",
            "Keep using xterm only.",
            app.state(),
        )
        .unwrap();
        patch_workspace_view_state(
            app.state(),
            &workspace_id,
            WorkspaceViewPatch {
                supervisor: Some(WorkspaceSupervisorViewState {
                    bindings: vec![WorkspaceSupervisorBinding {
                        status: WorkspaceSupervisorStatus::Injecting,
                        ..enabled
                    }],
                    cycles: vec![],
                }),
                ..WorkspaceViewPatch::default()
            },
        )
        .unwrap();

        let error = disable_supervisor_mode(&workspace_id, "slot-primary", app.state())
            .expect_err("running cycle should block disable");
        assert_eq!(error, "supervisor_cycle_running");
    }

    #[test]
    fn disable_supervisor_mode_removes_binding() {
        let app = test_app();
        let workspace_id = launch_test_workspace(&app, "/tmp/supervisor-disable");
        enable_supervisor_mode(
            &workspace_id,
            "slot-primary",
            "Keep using xterm only.",
            app.state(),
        )
        .unwrap();

        disable_supervisor_mode(&workspace_id, "slot-primary", app.state()).unwrap();
        let snapshot = load_workspace_snapshot(app.state(), &workspace_id).unwrap();
        assert!(snapshot.view_state.supervisor.bindings.is_empty());
    }

    #[test]
    fn retry_supervisor_cycle_queues_latest_failed_cycle() {
        let app = test_app();
        let workspace_id = launch_test_workspace(&app, "/tmp/supervisor-retry-latest-failed");
        let enabled = enable_supervisor_mode(
            &workspace_id,
            "slot-primary",
            "Keep using xterm only.",
            app.state(),
        )
        .unwrap();
        seed_supervisor_cycle(
            &app,
            &workspace_id,
            &enabled,
            "cycle-older-failed",
            WorkspaceSupervisorCycleStatus::Failed,
            2,
        );
        seed_supervisor_cycle(
            &app,
            &workspace_id,
            &enabled,
            "cycle-latest-failed",
            WorkspaceSupervisorCycleStatus::Failed,
            4,
        );

        let retried = retry_supervisor_cycle(&app, &workspace_id, "slot-primary", app.state()).unwrap();
        assert_eq!(retried.cycle_id, "cycle-latest-failed");
        assert_eq!(retried.status, WorkspaceSupervisorCycleStatus::Queued);
        assert_eq!(retried.error, None);
        assert_eq!(retried.finished_at, None);

        let snapshot = load_workspace_snapshot(app.state(), &workspace_id).unwrap();
        let stored = snapshot
            .view_state
            .supervisor
            .cycles
            .iter()
            .find(|cycle| cycle.cycle_id == "cycle-latest-failed")
            .expect("retried cycle should be updated");
        assert_eq!(stored.status, WorkspaceSupervisorCycleStatus::Queued);
        assert_eq!(stored.error, None);
        assert_eq!(stored.finished_at, None);
        assert_eq!(
            snapshot.view_state.supervisor.bindings[0].status,
            WorkspaceSupervisorStatus::Idle
        );
    }

    #[test]
    fn retry_supervisor_cycle_rejects_when_binding_is_running() {
        let app = test_app();
        let workspace_id = launch_test_workspace(&app, "/tmp/supervisor-retry-running");
        let enabled = enable_supervisor_mode(
            &workspace_id,
            "slot-primary",
            "Keep using xterm only.",
            app.state(),
        )
        .unwrap();
        seed_supervisor_cycle(
            &app,
            &workspace_id,
            &enabled,
            "cycle-failed",
            WorkspaceSupervisorCycleStatus::Failed,
            2,
        );
        patch_workspace_view_state(
            app.state(),
            &workspace_id,
            WorkspaceViewPatch {
                supervisor: Some(WorkspaceSupervisorViewState {
                    bindings: vec![WorkspaceSupervisorBinding {
                        status: WorkspaceSupervisorStatus::Evaluating,
                        ..enabled
                    }],
                    cycles: load_workspace_snapshot(app.state(), &workspace_id)
                        .unwrap()
                        .view_state
                        .supervisor
                        .cycles,
                }),
                ..WorkspaceViewPatch::default()
            },
        )
        .unwrap();

        let error = retry_supervisor_cycle(&app, &workspace_id, "slot-primary", app.state())
            .expect_err("running binding should block retry");
        assert_eq!(error, "supervisor_cycle_running");
    }

    #[test]
    fn retry_supervisor_cycle_rejects_when_binding_is_paused() {
        let app = test_app();
        let workspace_id = launch_test_workspace(&app, "/tmp/supervisor-retry-paused");
        let enabled = enable_supervisor_mode(
            &workspace_id,
            "slot-primary",
            "Keep using xterm only.",
            app.state(),
        )
        .unwrap();
        seed_supervisor_cycle(
            &app,
            &workspace_id,
            &enabled,
            "cycle-failed",
            WorkspaceSupervisorCycleStatus::Failed,
            2,
        );
        patch_workspace_view_state(
            app.state(),
            &workspace_id,
            WorkspaceViewPatch {
                supervisor: Some(WorkspaceSupervisorViewState {
                    bindings: vec![WorkspaceSupervisorBinding {
                        status: WorkspaceSupervisorStatus::Paused,
                        ..enabled
                    }],
                    cycles: load_workspace_snapshot(app.state(), &workspace_id)
                        .unwrap()
                        .view_state
                        .supervisor
                        .cycles,
                }),
                ..WorkspaceViewPatch::default()
            },
        )
        .unwrap();

        let error = retry_supervisor_cycle(&app, &workspace_id, "slot-primary", app.state())
            .expect_err("paused binding should block retry");
        assert_eq!(error, "supervisor_paused");
    }

    #[test]
    fn retry_supervisor_cycle_rejects_when_latest_cycle_did_not_fail() {
        let app = test_app();
        let workspace_id = launch_test_workspace(&app, "/tmp/supervisor-retry-nonfailed-latest");
        let enabled = enable_supervisor_mode(
            &workspace_id,
            "slot-primary",
            "Keep using xterm only.",
            app.state(),
        )
        .unwrap();
        seed_supervisor_cycle(
            &app,
            &workspace_id,
            &enabled,
            "cycle-older-failed",
            WorkspaceSupervisorCycleStatus::Failed,
            2,
        );
        seed_supervisor_cycle(
            &app,
            &workspace_id,
            &enabled,
            "cycle-latest-completed",
            WorkspaceSupervisorCycleStatus::Completed,
            4,
        );

        let error = retry_supervisor_cycle(&app, &workspace_id, "slot-primary", app.state())
            .expect_err("latest non-failed cycle should be rejected");
        assert_eq!(error, "supervisor_cycle_not_failed");
    }

    #[test]
    fn completed_turn_promotes_pending_objective_after_success() {
        let _guard = supervisor_reply_test_lock().lock().unwrap();
        let app = test_app();
        let workspace_id = launch_test_workspace(&app, "/tmp/supervisor-promote-pending");
        let enabled = enable_supervisor_mode(
            &workspace_id,
            "slot-primary",
            "Keep using xterm",
            app.state(),
        )
        .unwrap();
        bind_terminal_for_session_for_test(app.state(), &workspace_id, "slot-primary", 79);
        install_supervisor_adapter_reply_for_test("Keep going.");
        patch_workspace_view_state(
            app.state(),
            &workspace_id,
            WorkspaceViewPatch {
                supervisor: Some(WorkspaceSupervisorViewState {
                    bindings: vec![WorkspaceSupervisorBinding {
                        pending_objective_text: Some("Use Claude only in v1.".to_string()),
                        pending_objective_prompt: Some(
                            compose_objective_prompt("Use Claude only in v1.").unwrap(),
                        ),
                        pending_objective_version: Some(enabled.objective_version + 1),
                        ..enabled
                    }],
                    cycles: vec![],
                }),
                ..WorkspaceViewPatch::default()
            },
        )
        .unwrap();

        let result = handle_supervisor_turn_completed(
            &app,
            &workspace_id,
            "slot-primary",
            "turn-promote",
            "user asked to stay focused",
            "agent drifted a bit",
        );
        clear_supervisor_adapter_reply_for_test();
        result.unwrap();

        let snapshot = load_workspace_snapshot(app.state(), &workspace_id).unwrap();
        let binding = &snapshot.view_state.supervisor.bindings[0];
        assert_eq!(binding.status, WorkspaceSupervisorStatus::Idle);
        assert_eq!(binding.objective_text, "Use Claude only in v1.");
        assert_eq!(binding.objective_version, 2);
        assert_eq!(binding.pending_objective_text, None);
        assert_eq!(binding.pending_objective_version, None);
    }

    #[test]
    fn completed_turn_persists_failed_cycle_when_terminal_binding_is_missing() {
        let _guard = supervisor_reply_test_lock().lock().unwrap();
        let app = test_app();
        let workspace_id = launch_test_workspace(&app, "/tmp/supervisor-missing-terminal");
        seed_supervisor_binding_for_test(
            app.state(),
            &workspace_id,
            "slot-primary",
            "Keep using xterm",
        );
        install_supervisor_adapter_reply_for_test("Use xterm only.");

        let error = handle_supervisor_turn_completed(
            &app,
            &workspace_id,
            "slot-primary",
            "turn-missing-terminal",
            "user asked for a concrete next step",
            "agent is waiting for direction",
        )
        .expect_err("missing terminal should fail");
        clear_supervisor_adapter_reply_for_test();

        assert_eq!(error, "terminal_not_found");
        let snapshot = load_workspace_snapshot(app.state(), &workspace_id).unwrap();
        assert_eq!(snapshot.view_state.supervisor.bindings[0].status, WorkspaceSupervisorStatus::Error);
        assert_eq!(snapshot.view_state.supervisor.cycles.len(), 1);
        assert_eq!(snapshot.view_state.supervisor.cycles[0].status, WorkspaceSupervisorCycleStatus::Failed);
        assert_eq!(
            snapshot.view_state.supervisor.cycles[0].error.as_deref(),
            Some("terminal_not_found")
        );
    }

    #[test]
    fn completed_turn_invokes_supervisor_once_and_injects_reply() {
        let _guard = supervisor_reply_test_lock().lock().unwrap();
        let app = test_app();
        let workspace_id = launch_test_workspace(&app, "/tmp/supervisor-cycle");
        seed_supervisor_binding_for_test(
            app.state(),
            &workspace_id,
            "slot-primary",
            "Keep using xterm",
        );
        bind_terminal_for_session_for_test(app.state(), &workspace_id, "slot-primary", 77);
        install_supervisor_adapter_reply_for_test(
            "Do not redesign UI. Reuse xterm and implement auto injection.",
        );

        let result = handle_supervisor_turn_completed(
            &app,
            &workspace_id,
            "slot-primary",
            "turn-1",
            "user asked for v1 supervisor mode",
            "business agent started redesigning the chat UI",
        );
        clear_supervisor_adapter_reply_for_test();
        result.unwrap();

        let writes = take_terminal_writes_for_test(app.state(), &workspace_id, 77);
        assert_eq!(writes.len(), 1);
        assert!(writes[0]
            .0
            .contains("Reuse xterm and implement auto injection."));
        assert_eq!(writes[0].1, TerminalWriteOrigin::Supervisor);

        let snapshot = load_workspace_snapshot(app.state(), &workspace_id).unwrap();
        assert_eq!(snapshot.view_state.supervisor.cycles.len(), 1);
        assert_eq!(
            snapshot.view_state.supervisor.cycles[0].status,
            WorkspaceSupervisorCycleStatus::Injected
        );
        assert_eq!(snapshot.view_state.supervisor.bindings[0].status, WorkspaceSupervisorStatus::Idle);
    }
}
