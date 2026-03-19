use crate::*;

#[tauri::command]
pub(crate) fn terminal_create(
    tab_id: String,
    cwd: String,
    target: ExecTarget,
    app: tauri::AppHandle,
    state: State<'_, AppState>,
) -> Result<TerminalInfo, String> {
    let mut tabs = state.tabs.lock().map_err(|e| e.to_string())?;
    let tab = ensure_tab(&mut tabs, &tab_id, &target);
    let terminal_id = tab.next_terminal_id;
    tab.next_terminal_id += 1;

    let pty_system = native_pty_system();
    let pair = pty_system
        .openpty(PtySize {
            rows: 30,
            cols: 120,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| e.to_string())?;
    let cmd = build_terminal_pty_command(&target, &cwd);
    let child = pair.slave.spawn_command(cmd).map_err(|e| e.to_string())?;
    drop(pair.slave);
    let reader = pair.master.try_clone_reader().map_err(|e| e.to_string())?;
    let writer = pair.master.take_writer().map_err(|e| e.to_string())?;

    let runtime = Arc::new(TerminalRuntime {
        child: Mutex::new(child),
        writer: Mutex::new(Some(writer)),
        master: Mutex::new(pair.master),
    });

    let key = terminal_key(&tab_id, terminal_id);
    {
        let mut terms = state.terminals.lock().map_err(|e| e.to_string())?;
        terms.insert(key.clone(), runtime.clone());
    }

    tab.terminals.push(TerminalInfo {
        id: terminal_id,
        output: "".to_string(),
    });

    let app_handle = app.clone();
    let tab_id_out = tab_id.clone();
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
                    emit_terminal(&app_handle, &tab_id_out, terminal_id, &text);
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
        emit_terminal(&app_handle, &tab_id, terminal_id, "\n[terminal exited]\n");
        let state: State<AppState> = state_handle.state();
        if let Ok(mut terms) = state.terminals.lock() {
            terms.remove(&key);
        };
    });

    Ok(TerminalInfo {
        id: terminal_id,
        output: "".to_string(),
    })
}

#[tauri::command]
pub(crate) fn terminal_write(
    tab_id: String,
    terminal_id: u64,
    input: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let key = terminal_key(&tab_id, terminal_id);
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

#[tauri::command]
pub(crate) fn terminal_resize(
    tab_id: String,
    terminal_id: u64,
    cols: u16,
    rows: u16,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let key = terminal_key(&tab_id, terminal_id);
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

#[tauri::command]
pub(crate) fn terminal_close(
    tab_id: String,
    terminal_id: u64,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let key = terminal_key(&tab_id, terminal_id);

    let runtime = {
        let mut terms = state.terminals.lock().map_err(|e| e.to_string())?;
        terms.remove(&key)
    };

    if let Some(runtime) = runtime {
        if let Ok(mut writer) = runtime.writer.lock() {
            writer.take();
        }
        if let Ok(mut child) = runtime.child.lock() {
            let _ = child.kill();
        }
    }

    let mut tabs = state.tabs.lock().map_err(|e| e.to_string())?;
    if let Some(tab) = tabs.get_mut(&tab_id) {
        tab.terminals.retain(|terminal| terminal.id != terminal_id);
    }

    Ok(())
}
