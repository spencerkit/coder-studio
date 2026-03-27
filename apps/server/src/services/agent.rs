use crate::*;

const DEFAULT_PTY_COLS: u16 = 120;
const DEFAULT_PTY_ROWS: u16 = 30;

fn initial_pty_size(cols: Option<u16>, rows: Option<u16>) -> PtySize {
    PtySize {
        rows: rows.filter(|value| *value > 0).unwrap_or(DEFAULT_PTY_ROWS),
        cols: cols.filter(|value| *value > 0).unwrap_or(DEFAULT_PTY_COLS),
        pixel_width: 0,
        pixel_height: 0,
    }
}

fn terminate_agent_runtime(runtime: Arc<AgentRuntime>) {
    if let Ok(mut writer) = runtime.writer.lock() {
        *writer = None;
    }
    if let Ok(mut killer) = runtime.killer.lock() {
        let _ = terminate_process_tree(
            &mut **killer,
            runtime.process_id,
            runtime.process_group_leader,
        );
    }
}

pub(crate) struct AgentStartParams {
    pub(crate) workspace_id: String,
    pub(crate) session_id: String,
    pub(crate) provider: String,
    pub(crate) command: String,
    pub(crate) cols: Option<u16>,
    pub(crate) rows: Option<u16>,
}

pub(crate) fn agent_start(
    params: AgentStartParams,
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<AgentStartResult, String> {
    let AgentStartParams {
        workspace_id,
        session_id,
        provider,
        command,
        cols,
        rows,
    } = params;
    let key = agent_key(&workspace_id, &session_id);
    {
        let agents = state.agents.lock().map_err(|e| e.to_string())?;
        if agents.contains_key(&key) {
            return Ok(AgentStartResult { started: false });
        }
    }

    let session_id_num = session_id
        .parse::<u64>()
        .map_err(|_| "invalid_session_id".to_string())?;
    let (cwd, target) = workspace_access_context(state, &workspace_id)?;
    let stored_session = load_session(state, &workspace_id, session_id_num)?;
    let effective_claude_session_id = stored_session.claude_session_id.clone();
    let command = if provider == "claude" {
        build_claude_resume_command(&command, effective_claude_session_id.as_deref())
    } else {
        command
    };

    let (program, args) = build_agent_pty_command(&target, &cwd, &command);
    #[cfg(not(target_os = "windows"))]
    let shell_env = matches!(target, ExecTarget::Native).then(|| program.clone());
    let pty_system = native_pty_system();
    let pair = pty_system
        .openpty(initial_pty_size(cols, rows))
        .map_err(|e| e.to_string())?;
    let mut cmd = CommandBuilder::new(program);
    for arg in args {
        cmd.arg(arg);
    }

    #[cfg(target_os = "windows")]
    if matches!(target, ExecTarget::Native) && !cwd.is_empty() {
        cmd.cwd(&cwd);
    }

    #[cfg(not(target_os = "windows"))]
    if matches!(target, ExecTarget::Native) {
        crate::infra::runtime::apply_unix_pty_env_defaults(&mut cmd, shell_env.as_deref());
    }

    if provider == "claude" {
        ensure_claude_hook_settings(&cwd, &target)?;
        let app_bin = current_app_bin_for_target(&target)?;
        let hook_endpoint = current_hook_endpoint(&app)?;
        cmd.env("CODER_STUDIO_APP_BIN", app_bin);
        cmd.env("CODER_STUDIO_HOOK_ENDPOINT", hook_endpoint);
        cmd.env("CODER_STUDIO_WORKSPACE_ID", workspace_id.clone());
        cmd.env("CODER_STUDIO_SESSION_ID", session_id.clone());
    }

    let child = pair.slave.spawn_command(cmd).map_err(|e| {
        let raw = e.to_string();
        if raw.to_ascii_lowercase().contains("no such file") {
            return format!(
                "failed to start agent command: {} (command: `{}`; check PATH or set full binary path in settings)",
                raw, command
            );
        }
        format!("failed to start agent command: {} (command: `{}`)", raw, command)
    })?;
    let process_id = child.process_id();
    #[cfg(unix)]
    let process_group_leader = pair.master.process_group_leader();
    #[cfg(not(unix))]
    let process_group_leader = None;
    let killer = child.clone_killer();
    drop(pair.slave);
    let reader = pair.master.try_clone_reader().map_err(|e| e.to_string())?;
    let writer = pair.master.take_writer().map_err(|e| e.to_string())?;

    let runtime = Arc::new(AgentRuntime {
        child: Mutex::new(child),
        killer: Mutex::new(killer),
        writer: Mutex::new(Some(writer)),
        master: Mutex::new(pair.master),
        process_id,
        process_group_leader,
    });

    {
        let mut agents = state.agents.lock().map_err(|e| e.to_string())?;
        agents.insert(key.clone(), runtime.clone());
    }

    emit_agent(
        &app,
        &workspace_id,
        &session_id,
        "system",
        "Agent started / 智能体已启动",
    );

    let workspace_id_out = workspace_id.clone();
    let session_out = session_id.clone();
    let session_out_num = session_id_num;
    let app_handle = app.clone();
    let state_handle = app.clone();
    std::thread::spawn(move || {
        let mut reader = reader;
        let mut buf = [0u8; 4096];
        loop {
            match reader.read(&mut buf) {
                Ok(0) => break,
                Ok(n) => {
                    let text = String::from_utf8_lossy(&buf[..n]).to_string();
                    if text.is_empty() {
                        continue;
                    }
                    emit_agent(
                        &app_handle,
                        &workspace_id_out,
                        &session_out,
                        "stdout",
                        &text,
                    );
                    let state: State<AppState> = state_handle.state();
                    let _ = append_session_stream(state, &workspace_id_out, session_out_num, &text);
                }
                Err(_) => break,
            }
        }
    });

    let app_handle = app.clone();
    let state_handle = app.clone();
    std::thread::spawn(move || {
        if let Ok(mut child) = runtime.child.lock() {
            let _ = child.wait();
        }
        emit_agent(&app_handle, &workspace_id, &session_id, "exit", "exited");
        let state: State<AppState> = state_handle.state();
        let _ = set_session_status(state, &workspace_id, session_id_num, SessionStatus::Idle);
        if let Ok(mut agents) = state.agents.lock() {
            agents.remove(&key);
        };
    });

    Ok(AgentStartResult { started: true })
}

pub(crate) fn agent_send(
    workspace_id: String,
    session_id: String,
    input: String,
    append_newline: Option<bool>,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let key = agent_key(&workspace_id, &session_id);
    let agents = state.agents.lock().map_err(|e| e.to_string())?;
    let runtime = agents.get(&key).ok_or("agent_not_running")?.clone();
    drop(agents);
    let mut writer = runtime.writer.lock().map_err(|e| e.to_string())?;
    if let Some(handle) = writer.as_mut() {
        handle
            .write_all(input.as_bytes())
            .map_err(|e| e.to_string())?;
        if append_newline.unwrap_or(true) {
            handle.write_all(b"\r").map_err(|e| e.to_string())?;
        }
        handle.flush().map_err(|e| e.to_string())?;
        if let Ok(session_id_num) = session_id.parse::<u64>() {
            let _ = update_workspace_session(
                state,
                &workspace_id,
                session_id_num,
                SessionPatch {
                    title: None,
                    status: Some(SessionStatus::Waiting),
                    mode: None,
                    auto_feed: None,
                    queue: None,
                    messages: None,
                    stream: None,
                    unread: None,
                    last_active_at: Some(now_ts()),
                    claude_session_id: None,
                },
            );
        }
        Ok(())
    } else {
        Err("agent_stdin_closed".to_string())
    }
}

pub(crate) fn agent_stop(
    workspace_id: String,
    session_id: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let key = agent_key(&workspace_id, &session_id);
    let runtime = {
        let mut agents = state.agents.lock().map_err(|e| e.to_string())?;
        agents.remove(&key)
    };
    if let Some(runtime) = runtime {
        terminate_agent_runtime(runtime);
    }
    if let Ok(session_id_num) = session_id.parse::<u64>() {
        let _ = set_session_status(
            state,
            &workspace_id,
            session_id_num,
            SessionStatus::Interrupted,
        );
    }
    Ok(())
}

pub(crate) fn stop_workspace_agents(workspace_id: &str, state: State<'_, AppState>) {
    let prefix = format!("{workspace_id}:");
    let runtimes = {
        let Ok(mut agents) = state.agents.lock() else {
            return;
        };
        let keys = agents
            .keys()
            .filter(|key| key.starts_with(&prefix))
            .cloned()
            .collect::<Vec<_>>();
        keys.into_iter()
            .filter_map(|key| {
                let session_id = key.strip_prefix(&prefix)?.to_string();
                let runtime = agents.remove(&key)?;
                Some((session_id, runtime))
            })
            .collect::<Vec<_>>()
    };

    for (session_id, runtime) in runtimes {
        terminate_agent_runtime(runtime);
        if let Ok(session_id_num) = session_id.parse::<u64>() {
            let _ = set_session_status(
                state,
                workspace_id,
                session_id_num,
                SessionStatus::Interrupted,
            );
        }
    }
}

pub(crate) fn agent_resize(
    workspace_id: String,
    session_id: String,
    cols: u16,
    rows: u16,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let key = agent_key(&workspace_id, &session_id);
    let agents = state.agents.lock().map_err(|e| e.to_string())?;
    let runtime = agents.get(&key).ok_or("agent_not_running")?.clone();
    let master = runtime.master.lock().map_err(|e| e.to_string())?;
    master
        .resize(PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| e.to_string())
}
