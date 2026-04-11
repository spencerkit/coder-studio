use crate::app::TerminalIo;
use crate::services::utf8_stream::Utf8StreamDecoder;
use crate::*;
use std::collections::BTreeMap;

const DEFAULT_PTY_COLS: u16 = 120;
const DEFAULT_PTY_ROWS: u16 = 30;
const TERMINAL_RUNTIME_OUTPUT_LIMIT: usize = 2 * 1024 * 1024;

fn initial_pty_size(cols: Option<u16>, rows: Option<u16>) -> PtySize {
    PtySize {
        rows: rows.filter(|value| *value > 0).unwrap_or(DEFAULT_PTY_ROWS),
        cols: cols.filter(|value| *value > 0).unwrap_or(DEFAULT_PTY_COLS),
        pixel_width: 0,
        pixel_height: 0,
    }
}

fn terminate_terminal_runtime(runtime: Arc<TerminalRuntime>) {
    // Kill the child process first. This closes the PTY slave and causes
    // the reader thread to receive EOF naturally, preventing it from
    // blocking indefinitely on reader.read().
    if let Some(killer) = &runtime.killer {
        if let Ok(mut killer) = killer.lock() {
            let _ = terminate_process_tree(
                &mut **killer,
                runtime.process_id,
                runtime.process_group_leader,
            );
        }
    }
    // Then close the writer end so no further input can be sent.
    match &runtime.io {
        TerminalIo::Pty { writer, .. } | TerminalIo::TmuxAttached { writer, .. } => {
            if let Ok(mut writer) = writer.lock() {
                writer.take();
            }
        }
        #[cfg(test)]
        TerminalIo::Mock => {}
        #[cfg(not(test))]
        _ => {}
    }
}

pub(crate) enum TerminalLaunchCommand {
    DefaultShell,
    Custom { program: String, args: Vec<String> },
}

#[derive(Clone)]
pub(crate) enum TerminalBridgeTarget {
    Pty {
        cwd: String,
        target: ExecTarget,
        cols: Option<u16>,
        rows: Option<u16>,
    },
    Tmux {
        session_name: String,
        pane_id: String,
        cols: Option<u16>,
        rows: Option<u16>,
    },
}

pub(crate) struct TerminalCreateOptions {
    pub persist_workspace_terminal: bool,
    pub env: BTreeMap<String, String>,
    pub launch_command: TerminalLaunchCommand,
    pub bridge_target: TerminalBridgeTarget,
}

fn next_terminal_id(state: State<'_, AppState>) -> Result<u64, String> {
    let mut next = state.next_terminal_id.lock().map_err(|e| e.to_string())?;
    let value = *next;
    *next += 1;
    Ok(value)
}

fn truncate_terminal_output(buffer: &mut String) {
    if buffer.len() <= TERMINAL_RUNTIME_OUTPUT_LIMIT {
        return;
    }
    let keep_from = buffer.len().saturating_sub(TERMINAL_RUNTIME_OUTPUT_LIMIT);
    // Truncate at a valid UTF-8 character boundary to avoid corrupting
    // multi-byte characters or leaving dangling ANSI escape sequences.
    let safe_from = buffer.floor_char_boundary(keep_from);
    buffer.drain(..safe_from);
}

fn append_runtime_output(runtime: &Arc<TerminalRuntime>, text: &str) {
    if text.is_empty() {
        return;
    }
    if let Ok(mut output) = runtime.output.lock() {
        output.push_str(text);
        truncate_terminal_output(&mut output);
    }
}

fn persist_runtime_output_if_needed(
    runtime: &Arc<TerminalRuntime>,
    state: State<'_, AppState>,
    workspace_id: &str,
    terminal_id: u64,
    text: &str,
) {
    if runtime.persist_workspace_terminal {
        let _ = append_workspace_terminal_output(state, workspace_id, terminal_id, text);
    }
}

fn emit_runtime_output(
    runtime: &Arc<TerminalRuntime>,
    app: &AppHandle,
    state: State<'_, AppState>,
    workspace_id: &str,
    terminal_id: u64,
    text: &str,
) {
    if text.is_empty() {
        return;
    }
    append_runtime_output(runtime, text);
    // check if this terminal is session-bound before emitting the legacy event
    let is_session_bound =
        crate::services::session_runtime::session_runtime_binding_for_terminal(terminal_id, state)
            .ok()
            .flatten()
            .map(|(binding_workspace_id, _)| binding_workspace_id == workspace_id)
            .unwrap_or(false);

    if !is_session_bound {
        emit_terminal(app, workspace_id, terminal_id, text, None);
    }

    if let Ok(Some((binding_workspace_id, session_id))) =
        crate::services::session_runtime::session_runtime_binding_for_terminal(terminal_id, state)
    {
        if binding_workspace_id == workspace_id {
            if let Ok(registry) = state.terminal_runtimes.lock() {
                if let Some(runtime) = registry.by_session(workspace_id, &session_id) {
                    crate::services::terminal_gateway::emit_terminal_channel_output(
                        app,
                        &runtime.runtime_id,
                        text,
                    );
                }
            }
        }
    }
    persist_runtime_output_if_needed(runtime, state, workspace_id, terminal_id, text);
}

fn format_terminal_exit_message(wait_result: std::io::Result<portable_pty::ExitStatus>) -> String {
    match wait_result {
        Ok(status) => format!("\n[terminal exited: {status}]\n"),
        Err(error) => format!("\n[terminal exited: wait failed: {error}]\n"),
    }
}

fn sync_bound_terminal_runtime_state(
    workspace_id: &str,
    terminal_id: u64,
    status: SessionStatus,
    runtime_active: bool,
    runtime_liveness: Option<SessionRuntimeLiveness>,
    state: State<'_, AppState>,
) {
    if let Ok(Some((binding_workspace_id, session_id))) =
        crate::services::session_runtime::session_runtime_binding_for_terminal(terminal_id, state)
    {
        if binding_workspace_id != workspace_id {
            return;
        }
        let _ = sync_session_runtime_state(
            state,
            workspace_id,
            &session_id,
            status,
            runtime_active,
            runtime_liveness,
        );
    }
}

fn build_terminal_launch_command(
    target: &ExecTarget,
    cwd: &str,
    options: &TerminalCreateOptions,
) -> CommandBuilder {
    match &options.launch_command {
        TerminalLaunchCommand::DefaultShell => build_terminal_pty_command(target, cwd),
        TerminalLaunchCommand::Custom { program, args } => {
            let mut cmd = CommandBuilder::new(program);
            cmd.args(args);
            if !cwd.is_empty() {
                cmd.cwd(cwd);
            }
            #[cfg(not(target_os = "windows"))]
            {
                apply_unix_pty_env_defaults(&mut cmd, None);
            }
            cmd
        }
    }
}

fn create_pty_terminal_runtime(
    terminal_id: u64,
    workspace_id: &str,
    cwd: &str,
    target: &ExecTarget,
    cols: Option<u16>,
    rows: Option<u16>,
    options: TerminalCreateOptions,
    app: &AppHandle,
    _state: State<'_, AppState>,
) -> Result<Arc<TerminalRuntime>, String> {
    let pty_system = native_pty_system();
    let pair = pty_system
        .openpty(initial_pty_size(cols, rows))
        .map_err(|e| e.to_string())?;
    let mut cmd = build_terminal_launch_command(target, cwd, &options);
    for (key, value) in &options.env {
        cmd.env(key, value);
    }
    let child = pair.slave.spawn_command(cmd).map_err(|e| e.to_string())?;
    let process_id = child.process_id();
    #[cfg(unix)]
    let process_group_leader = pair.master.process_group_leader();
    #[cfg(not(unix))]
    let process_group_leader = None;
    let killer = child.clone_killer();
    drop(pair.slave);
    let reader = pair.master.try_clone_reader().map_err(|e| e.to_string())?;
    let writer = pair.master.take_writer().map_err(|e| e.to_string())?;

    let runtime = Arc::new(TerminalRuntime {
        io: TerminalIo::Pty {
            writer: Mutex::new(Some(writer)),
            master: Mutex::new(pair.master),
        },
        output: Mutex::new(String::new()),
        size: Mutex::new((80, 24)),
        persist_workspace_terminal: options.persist_workspace_terminal,
        child: Some(Mutex::new(child)),
        killer: Some(Mutex::new(killer)),
        process_id,
        process_group_leader,
    });

    let app_handle = app.clone();
    let state_handle = app.clone();
    let runtime_out = runtime.clone();
    let workspace_id_out = workspace_id.to_string();
    std::thread::spawn(move || {
        let mut reader = reader;
        let mut buf = [0u8; 4096];
        let mut decoder = Utf8StreamDecoder::new();
        loop {
            match reader.read(&mut buf) {
                Ok(0) => {
                    let text = decoder.finish();
                    let state: State<AppState> = state_handle.state();
                    emit_runtime_output(
                        &runtime_out,
                        &app_handle,
                        state,
                        &workspace_id_out,
                        terminal_id,
                        &text,
                    );
                    break;
                }
                Ok(n) => {
                    let text = decoder.push(&buf[..n]);
                    if text.is_empty() {
                        continue;
                    }
                    let state: State<AppState> = state_handle.state();
                    emit_runtime_output(
                        &runtime_out,
                        &app_handle,
                        state,
                        &workspace_id_out,
                        terminal_id,
                        &text,
                    );
                }
                Err(err) => {
                    let text = decoder.finish();
                    let state: State<AppState> = state_handle.state();
                    if !text.is_empty() {
                        emit_runtime_output(
                            &runtime_out,
                            &app_handle,
                            state,
                            &workspace_id_out,
                            terminal_id,
                            &text,
                        );
                    }
                    let state: State<AppState> = state_handle.state();
                    let error_msg = format!("\n[terminal error: read failed: {err}]\n");
                    emit_runtime_output(
                        &runtime_out,
                        &app_handle,
                        state,
                        &workspace_id_out,
                        terminal_id,
                        &error_msg,
                    );
                    break;
                }
            }
        }
    });

    let app_handle = app.clone();
    let state_handle = app.clone();
    let runtime_out = runtime.clone();
    let workspace_id_out = workspace_id.to_string();
    let key = terminal_key(workspace_id, terminal_id);
    std::thread::spawn(move || {
        let exit_text = match &runtime_out.child {
            Some(child) => match child.lock() {
                Ok(mut child) => format_terminal_exit_message(child.wait()),
                Err(error) => {
                    format!("\n[terminal exited: failed to lock child handle: {error}]\n")
                }
            },
            None => "\n[terminal exited]\n".to_string(),
        };
        let state: State<AppState> = state_handle.state();
        emit_runtime_output(
            &runtime_out,
            &app_handle,
            state,
            &workspace_id_out,
            terminal_id,
            &exit_text,
        );
        let state: State<AppState> = state_handle.state();
        if runtime_out.persist_workspace_terminal {
            let _ =
                set_workspace_terminal_recoverable(state, &workspace_id_out, terminal_id, false);
        }
        sync_bound_terminal_runtime_state(
            &workspace_id_out,
            terminal_id,
            SessionStatus::Interrupted,
            false,
            Some(SessionRuntimeLiveness::ProviderExited),
            state,
        );
        if let Ok(mut terms) = state.terminals.lock() {
            terms.remove(&key);
        }
    });

    Ok(runtime)
}

fn create_tmux_terminal_runtime(
    terminal_id: u64,
    workspace_id: &str,
    session_name: &str,
    pane_id: &str,
    cols: Option<u16>,
    rows: Option<u16>,
    options: TerminalCreateOptions,
    app: &AppHandle,
    _state: State<'_, AppState>,
) -> Result<Arc<TerminalRuntime>, String> {
    let attach_runtime = crate::services::tmux::attach_tmux_session(session_name, cols, rows)?;
    let reader = attach_runtime
        .pair
        .master
        .try_clone_reader()
        .map_err(|e| e.to_string())?;
    let writer = attach_runtime
        .pair
        .master
        .take_writer()
        .map_err(|e| e.to_string())?;

    let runtime = Arc::new(TerminalRuntime {
        io: TerminalIo::TmuxAttached {
            session_name: session_name.to_string(),
            pane_id: pane_id.to_string(),
            writer: Mutex::new(Some(writer)),
            master: Mutex::new(attach_runtime.pair.master),
        },
        output: Mutex::new(String::new()),
        size: Mutex::new((80, 24)),
        persist_workspace_terminal: options.persist_workspace_terminal,
        child: Some(attach_runtime.child),
        killer: Some(attach_runtime.killer),
        process_id: None,
        process_group_leader: None,
    });

    let app_handle = app.clone();
    let state_handle = app.clone();
    let runtime_out = runtime.clone();
    let workspace_id_out = workspace_id.to_string();
    std::thread::spawn(move || {
        let mut reader = reader;
        let mut buf = [0u8; 4096];
        let mut decoder = Utf8StreamDecoder::new();
        loop {
            match reader.read(&mut buf) {
                Ok(0) => {
                    let text = decoder.finish();
                    let state: State<AppState> = state_handle.state();
                    emit_runtime_output(
                        &runtime_out,
                        &app_handle,
                        state,
                        &workspace_id_out,
                        terminal_id,
                        &text,
                    );
                    break;
                }
                Ok(n) => {
                    let text = decoder.push(&buf[..n]);
                    if text.is_empty() {
                        continue;
                    }
                    let state: State<AppState> = state_handle.state();
                    emit_runtime_output(
                        &runtime_out,
                        &app_handle,
                        state,
                        &workspace_id_out,
                        terminal_id,
                        &text,
                    );
                }
                Err(err) => {
                    let text = decoder.finish();
                    let state: State<AppState> = state_handle.state();
                    if !text.is_empty() {
                        emit_runtime_output(
                            &runtime_out,
                            &app_handle,
                            state,
                            &workspace_id_out,
                            terminal_id,
                            &text,
                        );
                    }
                    let state: State<AppState> = state_handle.state();
                    let error_msg = format!("\n[terminal error: read failed: {err}]\n");
                    emit_runtime_output(
                        &runtime_out,
                        &app_handle,
                        state,
                        &workspace_id_out,
                        terminal_id,
                        &error_msg,
                    );
                    break;
                }
            }
        }
    });

    let app_handle = app.clone();
    let state_handle = app.clone();
    let runtime_out = runtime.clone();
    let workspace_id_out = workspace_id.to_string();
    let key = terminal_key(workspace_id, terminal_id);
    std::thread::spawn(move || {
        let exit_text = match &runtime_out.child {
            Some(child) => match child.lock() {
                Ok(mut child) => format_terminal_exit_message(child.wait()),
                Err(error) => {
                    format!("\n[terminal exited: failed to lock child handle: {error}]\n")
                }
            },
            None => "\n[terminal exited]\n".to_string(),
        };
        let state: State<AppState> = state_handle.state();
        emit_runtime_output(
            &runtime_out,
            &app_handle,
            state,
            &workspace_id_out,
            terminal_id,
            &exit_text,
        );
        let state: State<AppState> = state_handle.state();
        if let Ok(Some((binding_workspace_id, session_id))) =
            crate::services::session_runtime::session_runtime_binding_for_terminal(
                terminal_id,
                state,
            )
        {
            if binding_workspace_id == workspace_id_out {
                let _ = crate::services::session_runtime::remove_terminal_runtime_registration(
                    &workspace_id_out,
                    &session_id,
                    state,
                );
            }
        }
        if runtime_out.persist_workspace_terminal {
            let _ =
                set_workspace_terminal_recoverable(state, &workspace_id_out, terminal_id, false);
        }
        sync_bound_terminal_runtime_state(
            &workspace_id_out,
            terminal_id,
            SessionStatus::Interrupted,
            false,
            Some(SessionRuntimeLiveness::ProviderExited),
            state,
        );
        if let Ok(mut terms) = state.terminals.lock() {
            terms.remove(&key);
        }
    });

    Ok(runtime)
}

pub(crate) fn create_terminal_runtime(
    workspace_id: &str,
    _cwd: &str,
    _target: &ExecTarget,
    _cols: Option<u16>,
    _rows: Option<u16>,
    options: TerminalCreateOptions,
    app: &AppHandle,
    state: State<'_, AppState>,
) -> Result<TerminalInfo, String> {
    let terminal_id = next_terminal_id(state)?;
    let bridge_target = options.bridge_target.clone();
    let runtime = match bridge_target {
        TerminalBridgeTarget::Pty {
            cwd,
            target,
            cols,
            rows,
        } => create_pty_terminal_runtime(
            terminal_id,
            workspace_id,
            &cwd,
            &target,
            cols,
            rows,
            options,
            app,
            state,
        )?,
        TerminalBridgeTarget::Tmux {
            session_name,
            pane_id,
            cols,
            rows,
        } => create_tmux_terminal_runtime(
            terminal_id,
            workspace_id,
            &session_name,
            &pane_id,
            cols,
            rows,
            options,
            app,
            state,
        )?,
    };

    if runtime.persist_workspace_terminal {
        if let Err(error) = persist_workspace_terminal(state, workspace_id, terminal_id, "", true) {
            terminate_terminal_runtime(runtime);
            return Err(error);
        }
    }

    let key = terminal_key(workspace_id, terminal_id);
    state
        .terminals
        .lock()
        .map_err(|e| e.to_string())?
        .insert(key, runtime);

    Ok(TerminalInfo {
        id: terminal_id,
        output: String::new(),
        recoverable: true,
    })
}

pub(crate) fn terminal_create(
    workspace_id: String,
    cwd: String,
    target: ExecTarget,
    cols: Option<u16>,
    rows: Option<u16>,
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<TerminalInfo, String> {
    create_terminal_runtime(
        &workspace_id,
        &cwd,
        &target,
        cols,
        rows,
        TerminalCreateOptions {
            persist_workspace_terminal: true,
            env: BTreeMap::new(),
            launch_command: TerminalLaunchCommand::DefaultShell,
            bridge_target: TerminalBridgeTarget::Pty {
                cwd: cwd.clone(),
                target: target.clone(),
                cols,
                rows,
            },
        },
        &app,
        state,
    )
}

pub(crate) fn terminal_write(
    workspace_id: String,
    terminal_id: u64,
    input: String,
    origin: TerminalWriteOrigin,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let decorated_input = match origin {
        TerminalWriteOrigin::User => input,
        TerminalWriteOrigin::Supervisor => format!("# [supervisor]\r{}", input),
    };
    let key = terminal_key(&workspace_id, terminal_id);
    let terms = state.terminals.lock().map_err(|e| e.to_string())?;
    let runtime = match terms.get(&key).cloned() {
        Some(runtime) => runtime,
        None => {
            #[cfg(test)]
            {
                drop(terms);
                state
                    .terminal_write_log
                    .lock()
                    .map_err(|e| e.to_string())?
                    .push((workspace_id.clone(), terminal_id, decorated_input, origin));
                return Ok(());
            }
            #[cfg(not(test))]
            {
                return Err("terminal_not_found".to_string());
            }
        }
    };
    match &runtime.io {
        TerminalIo::Pty { writer, .. } => {
            let mut writer = writer.lock().map_err(|e| e.to_string())?;
            if let Some(handle) = writer.as_mut() {
                handle
                    .write_all(decorated_input.as_bytes())
                    .map_err(|e| e.to_string())?;
                handle.flush().map_err(|e| e.to_string())?;
            } else {
                return Err("terminal_stdin_closed".to_string());
            }
        }
        TerminalIo::TmuxAttached { writer, .. } => {
            let mut writer = writer.lock().map_err(|e| e.to_string())?;
            if let Some(handle) = writer.as_mut() {
                handle
                    .write_all(decorated_input.as_bytes())
                    .map_err(|e| e.to_string())?;
                handle.flush().map_err(|e| e.to_string())?;
            } else {
                return Err("terminal_stdin_closed".to_string());
            }
        }
        #[cfg(test)]
        TerminalIo::Mock => {}
        #[cfg(not(test))]
        _ => {}
    }
    #[cfg(test)]
    state
        .terminal_write_log
        .lock()
        .map_err(|e| e.to_string())?
        .push((
            workspace_id.clone(),
            terminal_id,
            decorated_input.clone(),
            origin.clone(),
        ));

    // Only emit transport_events for session-bound terminals.
    // Non-session-bound terminals already have their echoed input sent via
    // emit_terminal from the PTY reader thread. Emitting here would cause
    // duplicate output (the echoed input written twice to xterm).
    let is_session_bound =
        crate::services::session_runtime::session_runtime_binding_for_terminal(terminal_id, state)
            .ok()
            .flatten()
            .is_some_and(|(binding_workspace_id, _)| binding_workspace_id == workspace_id);

    if is_session_bound {
        let _ = state.transport_events.send(TransportEvent {
            event: "terminal://event".to_string(),
            payload: json!({
                "workspace_id": workspace_id,
                "terminal_id": terminal_id,
                "data": decorated_input,
                "origin": origin,
            }),
        });
    }
    sync_bound_terminal_runtime_state(
        &workspace_id,
        terminal_id,
        SessionStatus::Running,
        true,
        Some(SessionRuntimeLiveness::Attached),
        state,
    );
    Ok(())
}

pub(crate) fn terminal_resize(
    workspace_id: String,
    terminal_id: u64,
    cols: u16,
    rows: u16,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let key = terminal_key(&workspace_id, terminal_id);
    let terms = state.terminals.lock().map_err(|e| e.to_string())?;
    let runtime = terms.get(&key).ok_or("terminal_not_found")?.clone();
    match &runtime.io {
        TerminalIo::Pty { master, .. } | TerminalIo::TmuxAttached { master, .. } => {
            let master = master.lock().map_err(|e| e.to_string())?;
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
        TerminalIo::Mock => Ok(()),
        _ => {
            eprintln!("warning: terminal_resize: unknown TerminalIo variant, skipping");
            return Ok(());
        }
    }
}

pub(crate) fn terminal_close(
    workspace_id: String,
    terminal_id: u64,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let key = terminal_key(&workspace_id, terminal_id);
    let runtime = {
        let mut terms = state.terminals.lock().map_err(|e| e.to_string())?;
        terms.remove(&key)
    };

    if let Some(runtime) = runtime {
        let tmux_session = match &runtime.io {
            TerminalIo::TmuxAttached { session_name, .. } => Some(session_name.clone()),
            _ => None,
        };
        terminate_terminal_runtime(runtime);
        if let Some(session_name) = tmux_session {
            let _ = crate::services::tmux::kill_tmux_session(&session_name);
        }
    }
    let is_bound_session_terminal =
        crate::services::session_runtime::session_runtime_binding_for_terminal(terminal_id, state)?
            .is_some_and(|(binding_workspace_id, _)| binding_workspace_id == workspace_id);
    sync_bound_terminal_runtime_state(
        &workspace_id,
        terminal_id,
        SessionStatus::Interrupted,
        false,
        Some(SessionRuntimeLiveness::ProviderExited),
        state,
    );
    if is_bound_session_terminal {
        let _ = set_workspace_terminal_recoverable(state, &workspace_id, terminal_id, false);
    } else {
        let _ = delete_workspace_terminal(state, &workspace_id, terminal_id);
    }

    Ok(())
}

pub(crate) fn close_workspace_terminals(workspace_id: &str, state: State<'_, AppState>) {
    let prefix = format!("{workspace_id}:");
    let runtimes = {
        let Ok(mut terms) = state.terminals.lock() else {
            return;
        };
        let keys = terms
            .keys()
            .filter(|key| key.starts_with(&prefix))
            .cloned()
            .collect::<Vec<_>>();
        keys.into_iter()
            .filter_map(|key| {
                let terminal_id = key.strip_prefix(&prefix)?.parse::<u64>().ok()?;
                let runtime = terms.remove(&key)?;
                Some((terminal_id, runtime))
            })
            .collect::<Vec<_>>()
    };

    for (terminal_id, runtime) in runtimes {
        let tmux_session = match &runtime.io {
            TerminalIo::TmuxAttached { session_name, .. } => Some(session_name.clone()),
            _ => None,
        };
        terminate_terminal_runtime(runtime);
        if let Some(session_name) = tmux_session {
            let _ = crate::services::tmux::kill_tmux_session(&session_name);
        }
        sync_bound_terminal_runtime_state(
            workspace_id,
            terminal_id,
            SessionStatus::Interrupted,
            false,
            Some(SessionRuntimeLiveness::ProviderExited),
            state,
        );
        let _ = delete_workspace_terminal(state, workspace_id, terminal_id);
    }
}

#[cfg(test)]
mod tests {
    use super::format_terminal_exit_message;
    use crate::runtime::RuntimeHandle;
    use crate::{AppState, TerminalWriteOrigin};
    use portable_pty::ExitStatus;
    use std::io::{Error, ErrorKind};

    #[test]
    fn format_terminal_exit_message_reports_success_status() {
        assert_eq!(
            format_terminal_exit_message(Ok(ExitStatus::with_exit_code(0))),
            "\n[terminal exited: Success]\n"
        );
    }

    #[test]
    fn format_terminal_exit_message_reports_non_zero_exit_code() {
        assert_eq!(
            format_terminal_exit_message(Ok(ExitStatus::with_exit_code(7))),
            "\n[terminal exited: Exited with code 7]\n"
        );
    }

    #[test]
    fn format_terminal_exit_message_reports_signal_termination() {
        assert_eq!(
            format_terminal_exit_message(Ok(ExitStatus::with_signal("Killed"))),
            "\n[terminal exited: Terminated by Killed]\n"
        );
    }

    #[test]
    fn format_terminal_exit_message_reports_wait_errors() {
        assert_eq!(
            format_terminal_exit_message(Err(Error::new(ErrorKind::Other, "wait failed"))),
            "\n[terminal exited: wait failed: wait failed]\n"
        );
    }

    #[test]
    fn terminal_write_marks_supervisor_origin() {
        let (app, _shutdown_rx) = RuntimeHandle::new();
        let state: crate::State<AppState> = app.state();
        state.terminal_write_log.lock().unwrap().push((
            "workspace-a".to_string(),
            77,
            "# [supervisor]\rShip v1\r".to_string(),
            TerminalWriteOrigin::Supervisor,
        ));

        let writes =
            crate::services::supervisor::take_terminal_writes_for_test(state, "workspace-a", 77);

        assert_eq!(writes.len(), 1);
        assert_eq!(writes[0].0, "# [supervisor]\rShip v1\r");
        assert_eq!(writes[0].1, TerminalWriteOrigin::Supervisor);
    }
}

#[cfg(test)]
mod ring_buffer_tests {
    use super::*;

    #[test]
    fn truncate_terminal_output_keeps_utf8_boundary_at_2mb_limit() {
        // Construct a > 2 MB string where each char is 3 bytes (CJK)
        // so the truncate cut-point likely lands mid-codepoint.
        let one_chunk = "中".repeat(1024); // 3 KB
        let mut buffer = one_chunk.repeat(800); // ~2.4 MB
        let initial_len = buffer.len();
        assert!(initial_len > TERMINAL_RUNTIME_OUTPUT_LIMIT);

        truncate_terminal_output(&mut buffer);

        // floor_char_boundary rounds the drain boundary DOWN to the nearest valid
        // char start, so less is drained than requested. The retained slice can
        // therefore be up to (char_len - 1) bytes over the limit; for 3-byte CJK
        // that is at most 2 extra bytes.
        assert!(buffer.len() <= TERMINAL_RUNTIME_OUTPUT_LIMIT + 2);
        // Key assertion: truncated result is still valid UTF-8.
        assert!(std::str::from_utf8(buffer.as_bytes()).is_ok());
    }

    #[test]
    fn truncate_terminal_output_2mb_limit_value() {
        assert_eq!(TERMINAL_RUNTIME_OUTPUT_LIMIT, 2 * 1024 * 1024);
    }
}
