use std::collections::BTreeMap;

use crate::services::agent_client::AgentLaunchSpec;
use crate::services::terminal::{create_terminal_runtime, TerminalCreateOptions};
use crate::*;

pub(crate) fn session_runtime_key(workspace_id: &str, session_id: &str) -> String {
    format!("{workspace_id}:{session_id}")
}

fn resume_debug_enabled() -> bool {
    std::env::var("CODER_STUDIO_DEBUG_RESUME")
        .map(|value| {
            let normalized = value.trim().to_ascii_lowercase();
            !normalized.is_empty() && normalized != "0" && normalized != "false"
        })
        .unwrap_or(false)
}

fn resume_debug_log(message: impl AsRef<str>) {
    if resume_debug_enabled() {
        eprintln!("[resume-debug] {}", message.as_ref());
    }
}

pub(crate) fn choose_boot_command(
    resume_id: Option<&str>,
    start_command: String,
    resume_command: String,
) -> String {
    if resume_id.is_some() {
        resume_command
    } else {
        start_command
    }
}

fn session_status_on_runtime_start() -> SessionStatus {
    SessionStatus::Running
}

fn launch_spec_display_command(spec: &AgentLaunchSpec) -> String {
    match spec {
        AgentLaunchSpec::ShellCommand(command) => command.clone(),
        AgentLaunchSpec::Direct {
            display_command, ..
        } => display_command.clone(),
    }
}

pub(crate) fn bind_session_runtime(
    workspace_id: &str,
    session_id: &str,
    terminal_id: u64,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let key = session_runtime_key(workspace_id, session_id);
    let mut terminal_bindings = state
        .terminal_runtime_bindings
        .lock()
        .map_err(|e| e.to_string())?;
    let mut session_bindings = state
        .session_runtime_bindings
        .lock()
        .map_err(|e| e.to_string())?;

    if let Some(existing_terminal_id) = session_bindings.get(&key).copied() {
        terminal_bindings.remove(&existing_terminal_id);
    }
    if let Some(existing_key) = terminal_bindings.get(&terminal_id).cloned() {
        session_bindings.remove(&existing_key);
    }

    session_bindings.insert(key.clone(), terminal_id);
    terminal_bindings.insert(terminal_id, key);
    Ok(())
}

pub(crate) fn unbind_session_runtime_by_terminal(
    terminal_id: u64,
    state: State<'_, AppState>,
) -> Result<Option<String>, String> {
    let session_key = state
        .terminal_runtime_bindings
        .lock()
        .map_err(|e| e.to_string())?
        .remove(&terminal_id);
    if let Some(ref key) = session_key {
        state
            .session_runtime_bindings
            .lock()
            .map_err(|e| e.to_string())?
            .remove(key);
    }
    Ok(session_key)
}

pub(crate) fn session_runtime_binding_for_terminal(
    terminal_id: u64,
    state: State<'_, AppState>,
) -> Result<Option<(String, String)>, String> {
    let key = state
        .terminal_runtime_bindings
        .lock()
        .map_err(|e| e.to_string())?
        .get(&terminal_id)
        .cloned();
    let Some(key) = key else {
        return Ok(None);
    };
    let Some((workspace_id, session_id)) = key.split_once(':') else {
        return Err("invalid_session_runtime_key".to_string());
    };
    Ok(Some((workspace_id.to_string(), session_id.to_string())))
}

pub(crate) fn collect_workspace_session_runtime_bindings(
    workspace_id: &str,
    state: State<'_, AppState>,
) -> Result<Vec<SessionRuntimeBindingInfo>, String> {
    let prefix = format!("{workspace_id}:");
    let bindings = state
        .session_runtime_bindings
        .lock()
        .map_err(|e| e.to_string())?
        .iter()
        .filter_map(|(key, terminal_id)| {
            let session_id = key.strip_prefix(&prefix)?;
            Some(SessionRuntimeBindingInfo {
                session_id: session_id.to_string(),
                terminal_id: terminal_id.to_string(),
            })
        })
        .collect();
    Ok(bindings)
}

pub(crate) fn collect_workspace_runtime_terminals(
    workspace_id: &str,
    state: State<'_, AppState>,
) -> Result<Vec<TerminalInfo>, String> {
    let bindings = collect_workspace_session_runtime_bindings(workspace_id, state)?;
    let runtimes = state.terminals.lock().map_err(|e| e.to_string())?;
    let terminals = bindings
        .into_iter()
        .filter_map(|binding| {
            let terminal_id = binding.terminal_id.parse::<u64>().ok()?;
            let runtime = runtimes.get(&terminal_key(workspace_id, terminal_id))?.clone();
            let output = runtime.output.lock().ok()?.clone();
            Some(TerminalInfo {
                id: terminal_id,
                output,
                recoverable: true,
            })
        })
        .collect();
    Ok(terminals)
}

fn resolve_session_shell_env(
    app: &AppHandle,
    workspace_id: &str,
    session_id: &str,
    target: &ExecTarget,
    mut runtime_env: BTreeMap<String, String>,
) -> Result<BTreeMap<String, String>, String> {
    runtime_env.insert(
        "CODER_STUDIO_APP_BIN".to_string(),
        current_app_bin_for_target(target)?,
    );
    runtime_env.insert(
        "CODER_STUDIO_HOOK_ENDPOINT".to_string(),
        current_hook_endpoint(app)?,
    );
    runtime_env.insert(
        "CODER_STUDIO_WORKSPACE_ID".to_string(),
        workspace_id.to_string(),
    );
    runtime_env.insert(
        "CODER_STUDIO_SESSION_ID".to_string(),
        session_id.to_string(),
    );
    Ok(runtime_env)
}

pub(crate) struct SessionRuntimeStartParams {
    pub(crate) workspace_id: String,
    pub(crate) session_id: String,
    pub(crate) cols: Option<u16>,
    pub(crate) rows: Option<u16>,
}

pub(crate) fn session_runtime_start(
    params: SessionRuntimeStartParams,
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<SessionRuntimeStartResult, String> {
    let binding_key = session_runtime_key(&params.workspace_id, &params.session_id);
    let existing_terminal_id = {
        state
            .session_runtime_bindings
            .lock()
            .map_err(|e| e.to_string())?
            .get(&binding_key)
            .copied()
    };
    if let Some(existing_terminal_id) = existing_terminal_id {
        let terminal_key = terminal_key(&params.workspace_id, existing_terminal_id);
        let is_live = state
            .terminals
            .lock()
            .map_err(|e| e.to_string())?
            .contains_key(&terminal_key);
        if is_live {
            resume_debug_log(format!(
                "session_runtime_start reused live terminal workspace_id={} session_id={} terminal_id={}",
                params.workspace_id, params.session_id, existing_terminal_id
            ));
            return Ok(SessionRuntimeStartResult {
                terminal_id: existing_terminal_id,
                started: false,
                boot_input: None,
            });
        }
        let _ = unbind_session_runtime_by_terminal(existing_terminal_id, state);
    }

    let session_id_num = params
        .session_id
        .parse::<u64>()
        .map_err(|_| "invalid_session_id".to_string())?;
    let (workspace_cwd, workspace_target) = workspace_access_context(state, &params.workspace_id)?;
    let session = load_session(state, &params.workspace_id, session_id_num)?;
    let settings = load_or_default_app_settings(state)?;
    let adapter =
        crate::services::provider_registry::resolve_provider_adapter(session.provider.as_str())
            .ok_or_else(|| format!("unknown_provider:{}", session.provider.as_str()))?;

    adapter.ensure_workspace_integration(&workspace_cwd, &workspace_target)?;

    let start_launch = adapter.build_start(&settings, &workspace_target)?;
    let resume_launch = adapter.build_resume(
        &settings,
        &workspace_target,
        session.resume_id.as_deref().unwrap_or_default(),
    )?;
    let boot_command = choose_boot_command(
        session.resume_id.as_deref(),
        launch_spec_display_command(&start_launch.launch_spec),
        launch_spec_display_command(&resume_launch.launch_spec),
    );
    resume_debug_log(format!(
        "session_runtime_start prepared boot workspace_id={} session_id={} launch_mode={} resume_id={} boot_command={}",
        params.workspace_id,
        params.session_id,
        if session.resume_id.is_some() {
            "resume"
        } else {
            "start"
        },
        session.resume_id.as_deref().unwrap_or("-"),
        boot_command
    ));
    let runtime_env = if session.resume_id.is_some() {
        resolve_session_shell_env(
            &app,
            &params.workspace_id,
            &params.session_id,
            &workspace_target,
            resume_launch.runtime_env,
        )?
    } else {
        resolve_session_shell_env(
            &app,
            &params.workspace_id,
            &params.session_id,
            &workspace_target,
            start_launch.runtime_env,
        )?
    };

    let terminal = create_terminal_runtime(
        &params.workspace_id,
        &workspace_cwd,
        &workspace_target,
        params.cols,
        params.rows,
        TerminalCreateOptions {
            persist_workspace_terminal: false,
            env: runtime_env,
        },
        &app,
        state,
    )?;

    bind_session_runtime(&params.workspace_id, &params.session_id, terminal.id, state)?;
    let updated = set_session_status_if_not_archived(
        state,
        &params.workspace_id,
        session_id_num,
        session_status_on_runtime_start(),
    )?;
    resume_debug_log(format!(
        "session_runtime_start bound terminal workspace_id={} session_id={} terminal_id={} status={} updated={}",
        params.workspace_id,
        params.session_id,
        terminal.id,
        status_label(&session_status_on_runtime_start()),
        updated
    ));

    Ok(SessionRuntimeStartResult {
        terminal_id: terminal.id,
        started: true,
        boot_input: Some(format!("{boot_command}\r")),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn choose_boot_command_prefers_resume_when_resume_id_exists() {
        let command = choose_boot_command(
            Some("resume-42"),
            "codex --model gpt-5.4".to_string(),
            "codex resume resume-42 --model gpt-5.4".to_string(),
        );

        assert_eq!(command, "codex resume resume-42 --model gpt-5.4");
    }
}
