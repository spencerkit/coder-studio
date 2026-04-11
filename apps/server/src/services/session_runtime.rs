use std::collections::BTreeMap;

use crate::infra::time::now_ts_ms;
use crate::services::agent_client::AgentLaunchSpec;
use crate::services::terminal::{
    create_terminal_runtime, terminal_close, TerminalBridgeTarget, TerminalCreateOptions,
    TerminalLaunchCommand,
};
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
    SessionStatus::Idle
}

pub(crate) fn launch_spec_display_command(spec: &AgentLaunchSpec) -> String {
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
        let stale_terminal_key = terminal_key(workspace_id, existing_terminal_id);
        let stale_terminal_is_live = state
            .terminals
            .lock()
            .map_err(|e| e.to_string())?
            .contains_key(&stale_terminal_key);
        if !stale_terminal_is_live {
            let _ = crate::delete_workspace_terminal(state, workspace_id, existing_terminal_id);
        }
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

pub(crate) fn session_runtime_binding_by_session(
    workspace_id: &str,
    session_id: &str,
    state: State<'_, AppState>,
) -> Result<Option<u64>, String> {
    let key = session_runtime_key(workspace_id, session_id);
    let binding = state
        .session_runtime_bindings
        .lock()
        .map_err(|e| e.to_string())?
        .get(&key)
        .copied();
    Ok(binding)
}

pub(crate) fn collect_workspace_session_runtime_bindings(
    workspace_id: &str,
    state: State<'_, AppState>,
) -> Result<Vec<SessionRuntimeBindingInfo>, String> {
    let prefix = format!("{workspace_id}:");
    let runtime_registry = state.terminal_runtimes.lock().map_err(|e| e.to_string())?;
    let bindings = state
        .session_runtime_bindings
        .lock()
        .map_err(|e| e.to_string())?
        .iter()
        .filter_map(|(key, terminal_id)| {
            let session_id = key.strip_prefix(&prefix)?;
            let runtime_info = runtime_registry.by_session(workspace_id, session_id);
            Some(SessionRuntimeBindingInfo {
                session_id: session_id.to_string(),
                terminal_id: runtime_info
                    .map(|runtime| runtime.terminal_id.to_string())
                    .unwrap_or_else(|| terminal_id.to_string()),
                terminal_runtime_id: runtime_info.map(|runtime| runtime.runtime_id.clone()),
                workspace_terminal_id: Some(terminal_id.to_string()),
            })
        })
        .collect();
    Ok(bindings)
}

fn collect_workspace_runtime_terminal(
    workspace_id: &str,
    binding: &SessionRuntimeBindingInfo,
    runtimes: &std::collections::HashMap<String, Arc<crate::app::TerminalRuntime>>,
) -> Option<TerminalInfo> {
    let workspace_terminal_id = binding.workspace_terminal_id.as_ref()?;
    let terminal_id = workspace_terminal_id.parse::<u64>().ok()?;
    let runtime = runtimes
        .get(&terminal_key(workspace_id, terminal_id))?
        .clone();
    let output = runtime.output.lock().ok()?.clone();
    Some(TerminalInfo {
        id: terminal_id,
        output,
        recoverable: true,
    })
}

pub(crate) fn collect_workspace_runtime_terminals(
    workspace_id: &str,
    state: State<'_, AppState>,
) -> Result<Vec<TerminalInfo>, String> {
    let bindings = collect_workspace_session_runtime_bindings(workspace_id, state)?;
    let runtimes = state.terminals.lock().map_err(|e| e.to_string())?;
    let terminals = bindings
        .into_iter()
        .filter_map(|binding| collect_workspace_runtime_terminal(workspace_id, &binding, &runtimes))
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

fn runtime_terminal_launch_command(launch_spec: &AgentLaunchSpec) -> TerminalLaunchCommand {
    match launch_spec {
        AgentLaunchSpec::ShellCommand(command) => {
            #[cfg(target_os = "windows")]
            {
                TerminalLaunchCommand::Custom {
                    program: "cmd".to_string(),
                    args: vec![
                        "/D".to_string(),
                        "/S".to_string(),
                        "/C".to_string(),
                        command.clone(),
                    ],
                }
            }
            #[cfg(not(target_os = "windows"))]
            {
                let (shell, flag) = resolve_unix_agent_shell();
                TerminalLaunchCommand::Custom {
                    program: shell,
                    args: vec![flag, command.clone()],
                }
            }
        }
        AgentLaunchSpec::Direct { program, args, .. } => TerminalLaunchCommand::Custom {
            program: program.clone(),
            args: args.clone(),
        },
    }
}

fn remove_failed_terminal_runtime(
    workspace_id: &str,
    terminal_id: u64,
    state: State<'_, AppState>,
) {
    let _ = terminal_close(workspace_id.to_string(), terminal_id, state);
}

pub(crate) fn remove_terminal_runtime_registration(
    workspace_id: &str,
    session_id: &str,
    state: State<'_, AppState>,
) -> Result<Option<crate::services::terminal_gateway::TerminalRuntime>, String> {
    Ok(state
        .terminal_runtimes
        .lock()
        .map_err(|e| e.to_string())?
        .remove(workspace_id, session_id))
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

    let (workspace_cwd, workspace_target) = workspace_access_context(state, &params.workspace_id)?;
    let session = crate::services::workspace::resolve_session_for_slot(
        state,
        &params.workspace_id,
        &params.session_id,
    )
    .or_else(|error| {
        if params.session_id != "slot-primary" || error != "session_not_found" {
            return Err(error);
        }
        let fallback_provider = load_or_default_app_settings(state)?.agent_defaults.provider;
        let fallback_binding = WorkspaceSessionBinding {
            session_id: params.session_id.clone(),
            provider: fallback_provider,
            mode: SessionMode::Branch,
            resume_id: None,
            title_snapshot: format!("Session {}", params.session_id),
            last_seen_at: now_ts_ms(),
        };
        upsert_workspace_session_binding(state, &params.workspace_id, fallback_binding)?;
        crate::services::workspace::resolve_session_for_slot(
            state,
            &params.workspace_id,
            &params.session_id,
        )
    })?;
    let settings = load_or_default_app_settings(state)?;
    let existing_runtime = state
        .terminal_runtimes
        .lock()
        .map_err(|e| e.to_string())?
        .by_session(&params.workspace_id, &params.session_id)
        .cloned();

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
                terminal_runtime_id: existing_runtime.map(|runtime| runtime.runtime_id),
            });
        }
        let _ = unbind_session_runtime_by_terminal(existing_terminal_id, state);
    }

    let adapter =
        crate::services::provider_registry::resolve_provider_adapter(session.provider.as_str())
            .ok_or_else(|| format!("unknown_provider:{}", session.provider.as_str()))?;

    adapter.ensure_workspace_integration(&workspace_cwd, &workspace_target)?;
    let launch = match session.resume_id.as_deref() {
        Some(resume_id) => adapter.build_resume(&settings, &workspace_target, resume_id)?,
        None => adapter.build_start(&settings, &workspace_target)?,
    };
    let shell_env = resolve_session_shell_env(
        &app,
        &params.workspace_id,
        &params.session_id,
        &workspace_target,
        launch.runtime_env.clone(),
    )?;
    let terminal = match create_terminal_runtime(
        &params.workspace_id,
        &workspace_cwd,
        &workspace_target,
        params.cols,
        params.rows,
        TerminalCreateOptions {
            persist_workspace_terminal: true,
            env: shell_env.clone(),
            launch_command: TerminalLaunchCommand::DefaultShell,
            bridge_target: TerminalBridgeTarget::Pty {
                cwd: workspace_cwd.clone(),
                target: workspace_target.clone(),
                cols: params.cols,
                rows: params.rows,
            },
        },
        &app,
        state,
    ) {
        Ok(terminal) => terminal,
        Err(error) => return Err(error),
    };

    let runtime_id = format!("runtime:{}:{}", params.workspace_id, params.session_id);
    let runtime = crate::services::terminal_gateway::TerminalRuntime::new(
        runtime_id.clone(),
        params.workspace_id.clone(),
        params.session_id.clone(),
        session.provider.as_str().to_string(),
        terminal.id,
    );
    state
        .terminal_runtimes
        .lock()
        .map_err(|e| e.to_string())?
        .insert(runtime);

    let boot_command = match crate::services::provider_registry::provider_boot_command(
        &settings,
        &session.provider,
        &workspace_target,
        session.resume_id.as_deref(),
    ) {
        Ok(command) => command,
        Err(error) => {
            let _ = remove_terminal_runtime_registration(
                &params.workspace_id,
                &params.session_id,
                state,
            );
            remove_failed_terminal_runtime(&params.workspace_id, terminal.id, state);
            return Err(error);
        }
    };

    if let Err(error) = crate::services::terminal::terminal_write(
        params.workspace_id.clone(),
        terminal.id,
        format!("{}\r", boot_command),
        crate::TerminalWriteOrigin::User,
        state,
    ) {
        let _ =
            remove_terminal_runtime_registration(&params.workspace_id, &params.session_id, state);
        remove_failed_terminal_runtime(&params.workspace_id, terminal.id, state);
        return Err(error);
    }

    if let Err(error) =
        bind_session_runtime(&params.workspace_id, &params.session_id, terminal.id, state)
    {
        let _ =
            remove_terminal_runtime_registration(&params.workspace_id, &params.session_id, state);
        remove_failed_terminal_runtime(&params.workspace_id, terminal.id, state);
        return Err(error);
    }
    let updated = sync_session_runtime_state(
        state,
        &params.workspace_id,
        &params.session_id,
        session_status_on_runtime_start(),
        true,
        Some(SessionRuntimeLiveness::Attached),
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
        terminal_runtime_id: Some(runtime_id),
    })
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
    fn choose_boot_command_prefers_resume_when_resume_id_exists() {
        let command = choose_boot_command(
            Some("resume-42"),
            "codex --model gpt-5.4".to_string(),
            "codex resume resume-42 --model gpt-5.4".to_string(),
        );

        assert_eq!(command, "codex resume resume-42 --model gpt-5.4");
    }

    #[test]
    fn remove_terminal_runtime_registration_clears_runtime_binding() {
        let app = test_app();
        let mut registry = app.state().terminal_runtimes.lock().unwrap();
        registry.insert(crate::services::terminal_gateway::TerminalRuntime::new(
            "runtime:ws-1:session-1".to_string(),
            "ws-1".to_string(),
            "session-1".to_string(),
            "claude".to_string(),
            0,
        ));
        drop(registry);

        let removed = remove_terminal_runtime_registration("ws-1", "session-1", app.state())
            .expect("removal should succeed");

        assert!(removed.is_some());
        assert!(app
            .state()
            .terminal_runtimes
            .lock()
            .unwrap()
            .by_session("ws-1", "session-1")
            .is_none());
    }

    #[test]
    fn runtime_terminal_launch_command_uses_provider_launch_spec() {
        let shell_launch = runtime_terminal_launch_command(&AgentLaunchSpec::ShellCommand(
            "claude --print".to_string(),
        ));
        #[cfg(not(target_os = "windows"))]
        assert!(matches!(
            shell_launch,
            TerminalLaunchCommand::Custom { args, .. } if args == vec!["-ic".to_string(), "claude --print".to_string()]
                || args == vec!["-lc".to_string(), "claude --print".to_string()]
        ));
        #[cfg(target_os = "windows")]
        assert!(matches!(
            shell_launch,
            TerminalLaunchCommand::Custom { program, args } if program == "cmd"
                && args == vec!["/D".to_string(), "/S".to_string(), "/C".to_string(), "claude --print".to_string()]
        ));

        let direct_launch = runtime_terminal_launch_command(&AgentLaunchSpec::Direct {
            program: "claude".to_string(),
            args: vec!["--resume".to_string(), "abc123".to_string()],
            display_command: "claude --resume abc123".to_string(),
        });
        assert!(matches!(
            direct_launch,
            TerminalLaunchCommand::Custom { program, args }
                if program == "claude" && args == vec!["--resume".to_string(), "abc123".to_string()]
        ));
    }

    #[test]
    fn session_runtime_start_routes_bound_terminal_output_from_pty_runtime() {
        let app = test_app();
        let workspace_id = launch_test_workspace(&app, "/tmp/runtime-backend-terminal-launch");
        let session = create_session(
            workspace_id.clone(),
            SessionMode::Branch,
            ProviderId::claude(),
            app.state(),
        )
        .unwrap();
        *app.state().hook_endpoint.lock().unwrap() = Some("http://127.0.0.1:1/claude-hook".into());

        app_settings_update(
            serde_json::json!({
                "providers": {
                    "claude": {
                        "global": {
                            "executable": "/bin/sh",
                            "startupArgs": [
                                "-lc",
                                "printf 'TMUX-OUTPUT:%s\n' \"$CODER_STUDIO_SESSION_ID\"; sleep 1"
                            ]
                        }
                    }
                }
            }),
            app.state(),
        )
        .expect("settings update should succeed");

        let result = session_runtime_start(
            SessionRuntimeStartParams {
                workspace_id: workspace_id.clone(),
                session_id: session.id.clone(),
                cols: Some(120),
                rows: Some(30),
            },
            app.clone(),
            app.state(),
        )
        .expect("session runtime should start");

        assert!(result.started);
        let binding_key = session_runtime_key(&workspace_id, &session.id);
        assert_eq!(
            app.state()
                .session_runtime_bindings
                .lock()
                .unwrap()
                .get(&binding_key)
                .copied(),
            Some(result.terminal_id)
        );

        let expected = format!("TMUX-OUTPUT:{}", session.id);
        let mut terminal_output = String::new();
        for _ in 0..40 {
            terminal_output = load_workspace_snapshot(app.state(), &workspace_id)
                .expect("workspace snapshot should load")
                .terminals
                .into_iter()
                .find(|terminal| terminal.id == result.terminal_id)
                .map(|terminal| terminal.output)
                .unwrap_or_default();
            if terminal_output.contains(&expected) {
                break;
            }
            std::thread::sleep(std::time::Duration::from_millis(50));
        }
        assert!(
            terminal_output.contains(&expected),
            "bound terminal should show PTY runtime output, got: {terminal_output:?}"
        );
    }

    #[test]
    fn session_runtime_start_creates_runtime_and_returns_terminal_runtime_id() {
        let app = test_app();
        let workspace_id = launch_test_workspace(&app, "/tmp/runtime-backend-boot");
        let session = create_session(
            workspace_id.clone(),
            SessionMode::Branch,
            ProviderId::claude(),
            app.state(),
        )
        .unwrap();
        *app.state().hook_endpoint.lock().unwrap() = Some("http://127.0.0.1:1/claude-hook".into());

        let result = session_runtime_start(
            SessionRuntimeStartParams {
                workspace_id: workspace_id.clone(),
                session_id: session.id.clone(),
                cols: Some(120),
                rows: Some(30),
            },
            app.clone(),
            app.state(),
        )
        .expect("session runtime should start");

        assert!(result.started);
        assert!(result.terminal_runtime_id.is_some());
        let terminal_runtime = app
            .state()
            .terminal_runtimes
            .lock()
            .unwrap()
            .by_session(&workspace_id, &session.id)
            .cloned()
            .expect("terminal runtime should be registered");
        assert_eq!(
            result.terminal_runtime_id,
            Some(terminal_runtime.runtime_id)
        );
    }

    #[test]
    fn session_runtime_start_boots_provider_without_frontend_terminal_write() {
        let app = test_app();
        let workspace_id =
            launch_test_workspace(&app, "/tmp/runtime-backend-boot-without-frontend-write");
        let session = create_session(
            workspace_id.clone(),
            SessionMode::Branch,
            ProviderId::codex(),
            app.state(),
        )
        .unwrap();
        *app.state().hook_endpoint.lock().unwrap() = Some("http://127.0.0.1:1/codex-hook".into());

        app_settings_update(
            serde_json::json!({
                "providers": {
                    "codex": {
                        "global": {
                            "executable": "/bin/sh",
                            "extraArgs": [
                                "-lc",
                                "printf 'BOOTED:%s\n' \"$CODER_STUDIO_SESSION_ID\"; sleep 1"
                            ]
                        }
                    }
                }
            }),
            app.state(),
        )
        .expect("settings update should succeed");

        let result = session_runtime_start(
            SessionRuntimeStartParams {
                workspace_id: workspace_id.clone(),
                session_id: session.id.clone(),
                cols: Some(120),
                rows: Some(30),
            },
            app.clone(),
            app.state(),
        )
        .expect("runtime should start");

        assert!(result.started);
        assert!(result.terminal_runtime_id.is_some());

        let expected = format!("BOOTED:{}", session.id);
        let mut terminal_output = String::new();
        for _ in 0..40 {
            terminal_output = load_workspace_snapshot(app.state(), &workspace_id)
                .expect("workspace snapshot should load")
                .terminals
                .into_iter()
                .find(|terminal| terminal.id == result.terminal_id)
                .map(|terminal| terminal.output)
                .unwrap_or_default();
            if terminal_output.contains(&expected) {
                break;
            }
            std::thread::sleep(std::time::Duration::from_millis(50));
        }

        assert!(
            terminal_output.contains(&expected),
            "backend boot should reach PTY-backed terminal without frontend boot input write, got: {terminal_output:?}"
        );
    }

    #[test]
    fn collect_workspace_session_runtime_bindings_uses_runtime_terminal_id_as_canonical_terminal_id(
    ) {
        let app = test_app();
        let workspace_id =
            launch_test_workspace(&app, "/tmp/runtime-canonical-binding-terminal-id");
        let session = create_session(
            workspace_id.clone(),
            SessionMode::Branch,
            ProviderId::claude(),
            app.state(),
        )
        .unwrap();
        *app.state().hook_endpoint.lock().unwrap() = Some("http://127.0.0.1:1/claude-hook".into());

        let result = session_runtime_start(
            SessionRuntimeStartParams {
                workspace_id: workspace_id.clone(),
                session_id: session.id.clone(),
                cols: Some(120),
                rows: Some(30),
            },
            app.clone(),
            app.state(),
        )
        .expect("session runtime should start");

        let bindings = collect_workspace_session_runtime_bindings(&workspace_id, app.state())
            .expect("session runtime bindings should load");

        assert_eq!(bindings.len(), 1);
        assert_eq!(bindings[0].session_id, session.id);
        assert_eq!(bindings[0].terminal_runtime_id, result.terminal_runtime_id);
        assert_eq!(
            bindings[0].terminal_id,
            result.terminal_id.to_string()
        );
    }

    #[test]
    fn collect_workspace_runtime_terminals_skips_session_terminals_without_live_runtime_output() {
        let app = test_app();
        let workspace_id = launch_test_workspace(&app, "/tmp/runtime-terminal-live-output-only");
        let session = create_session(
            workspace_id.clone(),
            SessionMode::Branch,
            ProviderId::claude(),
            app.state(),
        )
        .unwrap();
        *app.state().hook_endpoint.lock().unwrap() = Some("http://127.0.0.1:1/claude-hook".into());

        let started = session_runtime_start(
            SessionRuntimeStartParams {
                workspace_id: workspace_id.clone(),
                session_id: session.id.clone(),
                cols: Some(120),
                rows: Some(30),
            },
            app.clone(),
            app.state(),
        )
        .expect("session runtime should start");

        crate::services::terminal::terminal_close(
            workspace_id.clone(),
            started.terminal_id,
            app.state(),
        )
        .expect("terminal close should succeed");

        let terminals = collect_workspace_runtime_terminals(&workspace_id, app.state())
            .expect("runtime terminals should load");

        assert!(terminals.is_empty());
    }

    #[test]
    fn collect_workspace_session_runtime_bindings_includes_terminal_runtime_id() {
        let app = test_app();
        let workspace_id = launch_test_workspace(&app, "/tmp/runtime-backend-bindings-runtime-id");
        let session = create_session(
            workspace_id.clone(),
            SessionMode::Branch,
            ProviderId::claude(),
            app.state(),
        )
        .unwrap();
        *app.state().hook_endpoint.lock().unwrap() = Some("http://127.0.0.1:1/claude-hook".into());

        let result = session_runtime_start(
            SessionRuntimeStartParams {
                workspace_id: workspace_id.clone(),
                session_id: session.id.clone(),
                cols: Some(120),
                rows: Some(30),
            },
            app.clone(),
            app.state(),
        )
        .expect("session runtime should start");

        let bindings = collect_workspace_session_runtime_bindings(&workspace_id, app.state())
            .expect("session runtime bindings should load");

        assert_eq!(bindings.len(), 1);
        assert_eq!(bindings[0].session_id, session.id);
        assert_eq!(
            bindings[0].terminal_id,
            result.terminal_id.to_string()
        );
        assert_eq!(bindings[0].terminal_runtime_id, result.terminal_runtime_id);
        assert_eq!(
            bindings[0].workspace_terminal_id,
            Some(result.terminal_id.to_string())
        );
    }

    #[test]
    fn terminal_write_routes_bound_terminal_input_to_pty_runtime_env() {
        let app = test_app();
        let workspace_id = launch_test_workspace(&app, "/tmp/runtime-terminal-write-bridge");
        let session = create_session(
            workspace_id.clone(),
            SessionMode::Branch,
            ProviderId::claude(),
            app.state(),
        )
        .unwrap();
        *app.state().hook_endpoint.lock().unwrap() = Some("http://127.0.0.1:1/claude-hook".into());

        let env_file = format!("/tmp/runtime-terminal-write-{}.txt", session.id);

        app_settings_update(
            serde_json::json!({
                "providers": {
                    "claude": {
                        "global": {
                            "executable": "/bin/sh",
                            "startupArgs": [
                                "-lc",
                                format!("echo $CODER_STUDIO_SESSION_ID > {}", env_file)
                            ]
                        }
                    }
                }
            }),
            app.state(),
        )
        .expect("settings update should succeed");

        session_runtime_start(
            SessionRuntimeStartParams {
                workspace_id: workspace_id.clone(),
                session_id: session.id.clone(),
                cols: Some(120),
                rows: Some(30),
            },
            app.clone(),
            app.state(),
        )
        .expect("session runtime should start");

        // Wait for the boot command to execute and write the env var to the file.
        let expected_content = session.id.clone();
        let mut found = false;
        for _ in 0..40 {
            if let Ok(content) = std::fs::read_to_string(&env_file) {
                if content.trim() == expected_content {
                    found = true;
                    break;
                }
            }
            std::thread::sleep(std::time::Duration::from_millis(50));
        }

        assert!(
            found,
            "boot command should write Coder_Studio_SESSION_ID to file, file contents: {:?}",
            std::fs::read_to_string(&env_file).ok()
        );

        std::fs::remove_file(&env_file).ok();
    }
}
