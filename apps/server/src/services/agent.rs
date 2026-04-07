use crate::services::ansi_stream::AnsiTranscriptSanitizer;
use crate::services::utf8_stream::Utf8StreamDecoder;
use crate::*;

const DEFAULT_PTY_COLS: u16 = 120;
const DEFAULT_PTY_ROWS: u16 = 30;

#[derive(Default)]
struct AgentLifecycleFallbackState {
    emitted_tool_started: bool,
    emitted_turn_completed: bool,
    resume_id: Option<String>,
}

fn initial_pty_size(cols: Option<u16>, rows: Option<u16>) -> PtySize {
    PtySize {
        rows: rows.filter(|value| *value > 0).unwrap_or(DEFAULT_PTY_ROWS),
        cols: cols.filter(|value| *value > 0).unwrap_or(DEFAULT_PTY_COLS),
        pixel_width: 0,
        pixel_height: 0,
    }
}

fn fallback_agent_lifecycle_from_output(
    state: &mut AgentLifecycleFallbackState,
    text: &str,
) -> Option<(&'static str, &'static str, String)> {
    if state.emitted_tool_started || text.trim().is_empty() {
        return None;
    }
    state.emitted_tool_started = true;
    let data = state
        .resume_id
        .as_deref()
        .map(|session_id| {
            json!({
                "source": "agent_process_output",
                "session_id": session_id,
            })
        })
        .unwrap_or_else(|| {
            json!({
                "source": "agent_process_output",
            })
        })
        .to_string();
    Some(("tool_started", "AgentProcessOutput", data))
}

fn fallback_agent_lifecycle_from_exit(
    state: &mut AgentLifecycleFallbackState,
) -> Option<(&'static str, &'static str, String)> {
    if state.emitted_turn_completed || !state.emitted_tool_started {
        return None;
    }
    state.emitted_turn_completed = true;
    Some((
        "turn_completed",
        "AgentProcessExit",
        r#"{"source":"agent_process_exit"}"#.to_string(),
    ))
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

fn dispatch_agent_output(
    app: &AppHandle,
    workspace_id: &str,
    session_id: &str,
    lifecycle_state_out: &Mutex<AgentLifecycleFallbackState>,
    raw_text: &str,
    transcript_text: &str,
) {
    if raw_text.is_empty() && transcript_text.is_empty() {
        return;
    }

    if let Ok(mut lifecycle_state) = lifecycle_state_out.lock() {
        if let Some((kind, source_event, data)) =
            fallback_agent_lifecycle_from_output(&mut lifecycle_state, transcript_text)
        {
            emit_agent_lifecycle(app, workspace_id, session_id, kind, source_event, &data);
        }
    }

    emit_agent(
        app,
        workspace_id,
        session_id,
        "stdout",
        transcript_text,
        Some(raw_text),
    );
}

fn write_agent_input(
    writer: &mut dyn Write,
    input: &str,
    append_newline: bool,
) -> Result<(), String> {
    writer
        .write_all(input.as_bytes())
        .map_err(|e| e.to_string())?;

    if append_newline {
        writer.write_all(b"\r").map_err(|e| e.to_string())?;
    }

    writer.flush().map_err(|e| e.to_string())
}

fn take_agent_runtime(
    workspace_id: &str,
    session_id: &str,
    state: State<'_, AppState>,
) -> Result<Option<Arc<AgentRuntime>>, String> {
    let key = agent_key(workspace_id, session_id);
    let mut agents = state.agents.lock().map_err(|e| e.to_string())?;
    Ok(agents.remove(&key))
}

pub(crate) fn stop_agent_runtime_without_status_update(
    workspace_id: &str,
    session_id: &str,
    state: State<'_, AppState>,
) -> Result<(), String> {
    if let Some(runtime) = take_agent_runtime(workspace_id, session_id, state)? {
        terminate_agent_runtime(runtime);
    }
    Ok(())
}

pub(crate) struct AgentStartParams {
    pub(crate) workspace_id: String,
    pub(crate) session_id: String,
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

    let (workspace_cwd, workspace_target) = workspace_access_context(state, &workspace_id)?;
    let stored_session =
        crate::services::workspace::resolve_session_for_slot(state, &workspace_id, &session_id)?;
    let effective_resume_id = stored_session.resume_id.clone();
    let settings = load_or_default_app_settings(state)?;
    let agent_target = ExecTarget::Native;
    let agent_cwd = resolve_agent_runtime_cwd(&workspace_cwd, &workspace_target, &agent_target)?;
    let adapter = crate::services::provider_registry::resolve_provider_adapter(
        stored_session.provider.as_str(),
    )
    .ok_or_else(|| format!("unknown_provider:{}", stored_session.provider.as_str()))?;
    let launch = match effective_resume_id.as_deref() {
        Some(resume_id) => adapter.build_resume(&settings, &agent_target, resume_id)?,
        None => adapter.build_start(&settings, &agent_target)?,
    };
    let launch_spec = launch.launch_spec;

    let (command, program, args) = match launch_spec {
        crate::services::agent_client::AgentLaunchSpec::ShellCommand(command) => {
            let (program, args) = build_agent_pty_command(&agent_target, &agent_cwd, &command);
            (command, program, args)
        }
        crate::services::agent_client::AgentLaunchSpec::Direct {
            program,
            args,
            display_command,
        } => (display_command, program, args),
    };
    #[cfg(not(target_os = "windows"))]
    let shell_env = matches!(agent_target, ExecTarget::Native).then(|| program.clone());
    let pty_system = native_pty_system();
    let pair = pty_system
        .openpty(initial_pty_size(cols, rows))
        .map_err(|e| e.to_string())?;
    let mut cmd = CommandBuilder::new(program);
    for arg in args {
        cmd.arg(arg);
    }

    #[cfg(target_os = "windows")]
    if matches!(agent_target, ExecTarget::Native) && !agent_cwd.is_empty() {
        cmd.cwd(&agent_cwd);
    }

    #[cfg(not(target_os = "windows"))]
    if matches!(agent_target, ExecTarget::Native) {
        crate::infra::runtime::apply_unix_pty_env_defaults(&mut cmd, shell_env.as_deref());
    }

    for (key, value) in launch.runtime_env {
        cmd.env(key, value);
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
    let _ =
        sync_session_runtime_state(state, &workspace_id, &session_id, SessionStatus::Idle, true);

    emit_agent(
        &app,
        &workspace_id,
        &session_id,
        "system",
        "Agent started / 智能体已启动",
        None,
    );

    let workspace_id_out = workspace_id.clone();
    let session_out = session_id.clone();
    let lifecycle_fallback_state = Arc::new(Mutex::new(AgentLifecycleFallbackState {
        resume_id: effective_resume_id.clone(),
        ..Default::default()
    }));
    let app_handle = app.clone();
    let lifecycle_fallback_state_out = lifecycle_fallback_state.clone();
    std::thread::spawn(move || {
        let mut reader = reader;
        let mut buf = [0u8; 4096];
        let mut decoder = Utf8StreamDecoder::new();
        let mut sanitizer = AnsiTranscriptSanitizer::new();
        loop {
            match reader.read(&mut buf) {
                Ok(0) => {
                    let mut transcript = sanitizer.push(&decoder.finish());
                    transcript.push_str(&sanitizer.finish());
                    dispatch_agent_output(
                        &app_handle,
                        &workspace_id_out,
                        &session_out,
                        &lifecycle_fallback_state_out,
                        "",
                        &transcript,
                    );
                    break;
                }
                Ok(n) => {
                    let raw = decoder.push(&buf[..n]);
                    if raw.is_empty() {
                        continue;
                    }
                    let transcript = sanitizer.push(&raw);
                    dispatch_agent_output(
                        &app_handle,
                        &workspace_id_out,
                        &session_out,
                        &lifecycle_fallback_state_out,
                        &raw,
                        &transcript,
                    );
                }
                Err(_) => break,
            }
        }
    });

    let app_handle = app.clone();
    let state_handle = app.clone();
    let lifecycle_fallback_state_out = lifecycle_fallback_state.clone();
    std::thread::spawn(move || {
        if let Ok(mut child) = runtime.child.lock() {
            let _ = child.wait();
        }
        if let Ok(mut lifecycle_state) = lifecycle_fallback_state_out.lock() {
            if let Some((kind, source_event, data)) =
                fallback_agent_lifecycle_from_exit(&mut lifecycle_state)
            {
                emit_agent_lifecycle(
                    &app_handle,
                    &workspace_id,
                    &session_id,
                    kind,
                    source_event,
                    &data,
                );
            }
        }
        emit_agent(
            &app_handle,
            &workspace_id,
            &session_id,
            "exit",
            "exited",
            None,
        );
        let state: State<AppState> = state_handle.state();
        let should_mark_interrupted = if let Ok(mut agents) = state.agents.lock() {
            agents.remove(&key).is_some()
        } else {
            false
        };
        if should_mark_interrupted {
            let _ = sync_session_runtime_state(
                state,
                &workspace_id,
                &session_id,
                SessionStatus::Interrupted,
                false,
            );
        }
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
        write_agent_input(&mut **handle, &input, append_newline.unwrap_or(true))?;
        let _ = sync_session_runtime_state(
            state,
            &workspace_id,
            &session_id,
            SessionStatus::Running,
            true,
        );
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
    stop_agent_runtime_without_status_update(&workspace_id, &session_id, state)?;
    let _ = sync_session_runtime_state(
        state,
        &workspace_id,
        &session_id,
        SessionStatus::Interrupted,
        false,
    );
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
        let _ = sync_session_runtime_state(
            state,
            workspace_id,
            &session_id,
            SessionStatus::Interrupted,
            false,
        );
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

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{self, Write};
    use std::sync::{Arc, Mutex};

    #[derive(Clone, Default)]
    struct RecordingWriter {
        ops: Arc<Mutex<Vec<String>>>,
    }

    impl RecordingWriter {
        fn operations(&self) -> Vec<String> {
            self.ops.lock().unwrap().clone()
        }
    }

    impl Write for RecordingWriter {
        fn write(&mut self, buf: &[u8]) -> io::Result<usize> {
            let op = match buf {
                b"\r" => "write:<CR>".to_string(),
                other => format!("write:{}", String::from_utf8_lossy(other)),
            };
            self.ops.lock().unwrap().push(op);
            Ok(buf.len())
        }

        fn flush(&mut self) -> io::Result<()> {
            self.ops.lock().unwrap().push("flush".to_string());
            Ok(())
        }
    }

    #[test]
    fn first_submit_writes_enter_without_provider_specific_delay() {
        let mut writer = RecordingWriter::default();
        write_agent_input(&mut writer, "hello", true).unwrap();

        assert_eq!(
            writer.operations(),
            vec![
                "write:hello".to_string(),
                "write:<CR>".to_string(),
                "flush".to_string(),
            ]
        );
    }

    #[test]
    fn follow_up_enter_submits_buffered_prompt_without_extra_delay() {
        let mut writer = RecordingWriter::default();
        write_agent_input(&mut writer, "", true).unwrap();

        assert_eq!(
            writer.operations(),
            vec!["write:<CR>".to_string(), "flush".to_string()]
        );
    }

    #[test]
    fn fallback_agent_lifecycle_marks_first_output_as_tool_started_once() {
        let mut state = AgentLifecycleFallbackState::default();

        assert_eq!(
            fallback_agent_lifecycle_from_output(&mut state, "fixture-running\n"),
            Some((
                "tool_started",
                "AgentProcessOutput",
                r#"{"source":"agent_process_output"}"#.to_string(),
            )),
        );
        assert_eq!(
            fallback_agent_lifecycle_from_output(&mut state, "fixture-still-running\n"),
            None
        );
    }

    #[test]
    fn fallback_agent_lifecycle_carries_known_resume_id() {
        let mut state = AgentLifecycleFallbackState {
            resume_id: Some("claude-resume-known".to_string()),
            ..Default::default()
        };

        assert_eq!(
            fallback_agent_lifecycle_from_output(&mut state, "fixture-running\n"),
            Some((
                "tool_started",
                "AgentProcessOutput",
                r#"{"session_id":"claude-resume-known","source":"agent_process_output"}"#
                    .to_string(),
            )),
        );
    }

    #[test]
    fn fallback_agent_lifecycle_only_emits_completion_after_output_started() {
        let mut state = AgentLifecycleFallbackState::default();
        assert_eq!(fallback_agent_lifecycle_from_exit(&mut state), None);

        let _ = fallback_agent_lifecycle_from_output(&mut state, "fixture-running\n");
        assert_eq!(
            fallback_agent_lifecycle_from_exit(&mut state),
            Some((
                "turn_completed",
                "AgentProcessExit",
                r#"{"source":"agent_process_exit"}"#.to_string(),
            )),
        );
        assert_eq!(fallback_agent_lifecycle_from_exit(&mut state), None);
    }
}
