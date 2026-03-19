use crate::*;

#[tauri::command]
pub(crate) fn agent_start(
    tab_id: String,
    session_id: String,
    provider: String,
    command: String,
    claude_session_id: Option<String>,
    cwd: String,
    target: ExecTarget,
    app: tauri::AppHandle,
    state: State<'_, AppState>,
) -> Result<AgentStartResult, String> {
    let key = agent_key(&tab_id, &session_id);
    {
        let agents = state.agents.lock().map_err(|e| e.to_string())?;
        if agents.contains_key(&key) {
            return Ok(AgentStartResult { started: false });
        }
    }

    let stored_claude_session_id = {
        let tabs = state.tabs.lock().map_err(|e| e.to_string())?;
        tabs.get(&tab_id).and_then(|tab| {
            session_id.parse::<u64>().ok().and_then(|session_id_num| {
                tab.sessions
                    .iter()
                    .find(|session| session.id == session_id_num)
                    .and_then(|session| session.claude_session_id.clone())
            })
        })
    };

    let effective_claude_session_id = claude_session_id.or(stored_claude_session_id);

    let command = if provider == "claude" {
        build_claude_resume_command(&command, effective_claude_session_id.as_deref())
    } else {
        command
    };

    let (program, args) = build_agent_pty_command(&target, &cwd, &command);
    let pty_system = native_pty_system();
    let pair = pty_system
        .openpty(PtySize {
            rows: 30,
            cols: 120,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| e.to_string())?;
    let mut cmd = CommandBuilder::new(program);
    for arg in args {
        cmd.arg(arg);
    }

    if provider == "claude" {
        ensure_claude_hook_settings(&cwd, &target)?;
        let app_bin = current_app_bin_for_target(&target)?;
        let hook_endpoint = current_hook_endpoint(&app)?;
        cmd.env("CODER_STUDIO_APP_BIN", app_bin);
        cmd.env("CODER_STUDIO_HOOK_ENDPOINT", hook_endpoint);
        cmd.env("CODER_STUDIO_TAB_ID", tab_id.clone());
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
    drop(pair.slave);
    let reader = pair.master.try_clone_reader().map_err(|e| e.to_string())?;
    let writer = pair.master.take_writer().map_err(|e| e.to_string())?;

    let runtime = Arc::new(AgentRuntime {
        child: Mutex::new(child),
        writer: Mutex::new(Some(writer)),
        master: Mutex::new(pair.master),
    });

    {
        let mut agents = state.agents.lock().map_err(|e| e.to_string())?;
        agents.insert(key.clone(), runtime.clone());
    }

    emit_agent(
        &app,
        &tab_id,
        &session_id,
        "system",
        "Agent started / 智能体已启动",
    );

    let tab_id_out = tab_id.clone();
    let session_out = session_id.clone();
    let app_handle = app.clone();
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
                    emit_agent(&app_handle, &tab_id_out, &session_out, "stdout", &text);
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
        emit_agent(&app_handle, &tab_id, &session_id, "exit", "exited");
        let state: State<AppState> = state_handle.state();
        if let Ok(mut agents) = state.agents.lock() {
            agents.remove(&key);
        };
    });

    Ok(AgentStartResult { started: true })
}

#[tauri::command]
pub(crate) fn agent_send(
    tab_id: String,
    session_id: String,
    input: String,
    append_newline: Option<bool>,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let key = agent_key(&tab_id, &session_id);
    let agents = state.agents.lock().map_err(|e| e.to_string())?;
    let runtime = agents.get(&key).ok_or("agent_not_running")?.clone();
    let mut writer = runtime.writer.lock().map_err(|e| e.to_string())?;
    if let Some(handle) = writer.as_mut() {
        handle
            .write_all(input.as_bytes())
            .map_err(|e| e.to_string())?;
        if append_newline.unwrap_or(true) {
            handle.write_all(b"\r").map_err(|e| e.to_string())?;
        }
        handle.flush().map_err(|e| e.to_string())?;
        Ok(())
    } else {
        Err("agent_stdin_closed".to_string())
    }
}

#[tauri::command]
pub(crate) fn agent_stop(
    tab_id: String,
    session_id: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let key = agent_key(&tab_id, &session_id);
    let mut agents = state.agents.lock().map_err(|e| e.to_string())?;
    if let Some(runtime) = agents.remove(&key) {
        if let Ok(mut child) = runtime.child.lock() {
            let _ = child.kill();
            let _ = child.wait();
        }
        if let Ok(mut writer) = runtime.writer.lock() {
            *writer = None;
        }
    }
    Ok(())
}

#[tauri::command]
pub(crate) fn agent_resize(
    tab_id: String,
    session_id: String,
    cols: u16,
    rows: u16,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let key = agent_key(&tab_id, &session_id);
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
