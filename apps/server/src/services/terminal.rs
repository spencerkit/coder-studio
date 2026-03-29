use crate::*;
use crate::services::utf8_stream::Utf8StreamDecoder;

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

pub(crate) fn terminal_create(
    workspace_id: String,
    cwd: String,
    target: ExecTarget,
    cols: Option<u16>,
    rows: Option<u16>,
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<TerminalInfo, String> {
    let terminal_id = {
        let mut next = state.next_terminal_id.lock().map_err(|e| e.to_string())?;
        let value = *next;
        *next += 1;
        value
    };

    let pty_system = native_pty_system();
    let pair = pty_system
        .openpty(initial_pty_size(cols, rows))
        .map_err(|e| e.to_string())?;
    let cmd = build_terminal_pty_command(&target, &cwd);
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
        process_id,
        process_group_leader,
    });

    if let Err(error) = persist_workspace_terminal(state, &workspace_id, terminal_id, "", true) {
        terminate_terminal_runtime(runtime);
        return Err(error);
    }

    let key = terminal_key(&workspace_id, terminal_id);
    {
        let mut terms = state.terminals.lock().map_err(|e| e.to_string())?;
        terms.insert(key.clone(), runtime.clone());
    }

    let app_handle = app.clone();
    let state_handle = app.clone();
    let workspace_id_out = workspace_id.clone();
    std::thread::spawn(move || {
        let mut reader = reader;
        let mut buf = [0u8; 4096];
        let mut decoder = Utf8StreamDecoder::new();
        loop {
            match reader.read(&mut buf) {
                Ok(0) => {
                    let text = decoder.finish();
                    if !text.is_empty() {
                        emit_terminal(&app_handle, &workspace_id_out, terminal_id, &text);
                        let state: State<AppState> = state_handle.state();
                        let _ = append_workspace_terminal_output(
                            state,
                            &workspace_id_out,
                            terminal_id,
                            &text,
                        );
                    }
                    break;
                }
                Ok(n) => {
                    let text = decoder.push(&buf[..n]);
                    if text.is_empty() {
                        continue;
                    }
                    emit_terminal(&app_handle, &workspace_id_out, terminal_id, &text);
                    let state: State<AppState> = state_handle.state();
                    let _ = append_workspace_terminal_output(
                        state,
                        &workspace_id_out,
                        terminal_id,
                        &text,
                    );
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
        emit_terminal(
            &app_handle,
            &workspace_id,
            terminal_id,
            "\n[terminal exited]\n",
        );
        let state: State<AppState> = state_handle.state();
        let _ = append_workspace_terminal_output(
            state,
            &workspace_id,
            terminal_id,
            "\n[terminal exited]\n",
        );
        let _ = set_workspace_terminal_recoverable(state, &workspace_id, terminal_id, false);
        if let Ok(mut terms) = state.terminals.lock() {
            terms.remove(&key);
        };
    });

    Ok(TerminalInfo {
        id: terminal_id,
        output: String::new(),
        recoverable: true,
    })
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
    let _ = delete_workspace_terminal(state, &workspace_id, terminal_id);

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
        let _ = delete_workspace_terminal(state, workspace_id, terminal_id);
    }
}
