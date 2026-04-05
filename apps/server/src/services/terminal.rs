use crate::services::utf8_stream::Utf8StreamDecoder;
use crate::*;
use std::collections::BTreeMap;

const DEFAULT_PTY_COLS: u16 = 120;
const DEFAULT_PTY_ROWS: u16 = 30;
const TERMINAL_RUNTIME_OUTPUT_LIMIT: usize = 256 * 1024;

fn initial_pty_size(cols: Option<u16>, rows: Option<u16>) -> PtySize {
    PtySize {
        rows: rows.filter(|value| *value > 0).unwrap_or(DEFAULT_PTY_ROWS),
        cols: cols.filter(|value| *value > 0).unwrap_or(DEFAULT_PTY_COLS),
        pixel_width: 0,
        pixel_height: 0,
    }
}

fn terminate_terminal_runtime(runtime: Arc<TerminalRuntime>) {
    if let Ok(mut writer) = runtime.writer.lock() {
        writer.take();
    }
    if let Ok(mut killer) = runtime.killer.lock() {
        let _ = terminate_process_tree(
            &mut **killer,
            runtime.process_id,
            runtime.process_group_leader,
        );
    }
}

pub(crate) struct TerminalCreateOptions {
    pub persist_workspace_terminal: bool,
    pub env: BTreeMap<String, String>,
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
    buffer.drain(..keep_from);
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
    state: State<'_, AppState>,
) {
    if let Ok(Some((binding_workspace_id, session_id))) =
        crate::services::session_runtime::session_runtime_binding_for_terminal(terminal_id, state)
    {
        if binding_workspace_id != workspace_id {
            return;
        }
        let _ =
            sync_session_runtime_state(state, workspace_id, &session_id, status, runtime_active);
    }
}
pub(crate) fn create_terminal_runtime(
    workspace_id: &str,
    cwd: &str,
    target: &ExecTarget,
    cols: Option<u16>,
    rows: Option<u16>,
    options: TerminalCreateOptions,
    app: &AppHandle,
    state: State<'_, AppState>,
) -> Result<TerminalInfo, String> {
    let terminal_id = next_terminal_id(state)?;
    let pty_system = native_pty_system();
    let pair = pty_system
        .openpty(initial_pty_size(cols, rows))
        .map_err(|e| e.to_string())?;
    let mut cmd = build_terminal_pty_command(target, cwd);
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
        child: Mutex::new(child),
        killer: Mutex::new(killer),
        writer: Mutex::new(Some(writer)),
        master: Mutex::new(pair.master),
        output: Mutex::new(String::new()),
        persist_workspace_terminal: options.persist_workspace_terminal,
        process_id,
        process_group_leader,
    });

    if runtime.persist_workspace_terminal {
        if let Err(error) = persist_workspace_terminal(state, workspace_id, terminal_id, "", true) {
            terminate_terminal_runtime(runtime);
            return Err(error);
        }
    }

    let key = terminal_key(workspace_id, terminal_id);
    {
        let mut terms = state.terminals.lock().map_err(|e| e.to_string())?;
        terms.insert(key.clone(), runtime.clone());
    }

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
                    if !text.is_empty() {
                        append_runtime_output(&runtime_out, &text);
                        emit_terminal(&app_handle, &workspace_id_out, terminal_id, &text);
                        if runtime_out.persist_workspace_terminal {
                            let state: State<AppState> = state_handle.state();
                            let _ = append_workspace_terminal_output(
                                state,
                                &workspace_id_out,
                                terminal_id,
                                &text,
                            );
                        }
                    }
                    break;
                }
                Ok(n) => {
                    let text = decoder.push(&buf[..n]);
                    if text.is_empty() {
                        continue;
                    }
                    append_runtime_output(&runtime_out, &text);
                    emit_terminal(&app_handle, &workspace_id_out, terminal_id, &text);
                    if runtime_out.persist_workspace_terminal {
                        let state: State<AppState> = state_handle.state();
                        let _ = append_workspace_terminal_output(
                            state,
                            &workspace_id_out,
                            terminal_id,
                            &text,
                        );
                    }
                }
                Err(_) => break,
            }
        }
    });

    let app_handle = app.clone();
    let state_handle = app.clone();
    let runtime_out = runtime.clone();
    let workspace_id_out = workspace_id.to_string();
    std::thread::spawn(move || {
        let exit_text = match runtime_out.child.lock() {
            Ok(mut child) => format_terminal_exit_message(child.wait()),
            Err(error) => format!("\n[terminal exited: failed to lock child handle: {error}]\n"),
        };
        append_runtime_output(&runtime_out, &exit_text);
        emit_terminal(&app_handle, &workspace_id_out, terminal_id, &exit_text);
        let state: State<AppState> = state_handle.state();
        if runtime_out.persist_workspace_terminal {
            let _ =
                append_workspace_terminal_output(state, &workspace_id_out, terminal_id, &exit_text);
            let _ =
                set_workspace_terminal_recoverable(state, &workspace_id_out, terminal_id, false);
        }
        sync_bound_terminal_runtime_state(
            &workspace_id_out,
            terminal_id,
            SessionStatus::Interrupted,
            false,
            state,
        );
        if let Ok(mut terms) = state.terminals.lock() {
            terms.remove(&key);
        }
    });

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
        },
        &app,
        state,
    )
}

pub(crate) fn terminal_write(
    workspace_id: String,
    terminal_id: u64,
    input: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let key = terminal_key(&workspace_id, terminal_id);
    let terms = state.terminals.lock().map_err(|e| e.to_string())?;
    let runtime = terms.get(&key).ok_or("terminal_not_found")?.clone();
    let mut writer = runtime.writer.lock().map_err(|e| e.to_string())?;
    if let Some(handle) = writer.as_mut() {
        handle
            .write_all(input.as_bytes())
            .map_err(|e| e.to_string())?;
        handle.flush().map_err(|e| e.to_string())?;
        sync_bound_terminal_runtime_state(
            &workspace_id,
            terminal_id,
            SessionStatus::Running,
            true,
            state,
        );
        Ok(())
    } else {
        Err("terminal_stdin_closed".to_string())
    }
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
        terminate_terminal_runtime(runtime);
    }
    let is_bound_session_terminal =
        crate::services::session_runtime::session_runtime_binding_for_terminal(terminal_id, state)?
            .is_some_and(|(binding_workspace_id, _)| binding_workspace_id == workspace_id);
    sync_bound_terminal_runtime_state(
        &workspace_id,
        terminal_id,
        SessionStatus::Interrupted,
        false,
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
        terminate_terminal_runtime(runtime);
        sync_bound_terminal_runtime_state(
            workspace_id,
            terminal_id,
            SessionStatus::Interrupted,
            false,
            state,
        );
        let _ = delete_workspace_terminal(state, workspace_id, terminal_id);
    }
}

#[cfg(test)]
mod tests {
    use super::format_terminal_exit_message;
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
}
