use crate::app::TerminalIo;
use crate::services::utf8_stream::Utf8StreamDecoder;
use crate::*;
use crossbeam_channel;
use std::collections::BTreeMap;
use std::io::Read;

// Compile-time sanity: PtyWriter::new reads the fd by casting through Box<dyn Write>
// (fat pointer, 16 bytes on 64-bit) -> data word (Box<File> thin pointer, 8 bytes) ->
// *const Box<File> -> dereference to Box<File> -> cast to i32 (fd at offset 0 in File).
// This assertion guards the Box<File> thin-pointer assumption.
const _: [(); 8] = [(); std::mem::size_of::<Box<std::fs::File>>()];

const DEFAULT_PTY_COLS: u16 = 120;
const DEFAULT_PTY_ROWS: u16 = 30;
const TERMINAL_RUNTIME_OUTPUT_LIMIT: usize = 2 * 1024 * 1024;

/// Non-blocking wrapper around a PTY writer file descriptor.
/// Uses direct libc::write calls with O_NONBLOCK to avoid blocking when the
/// PTY buffer is full, preventing deadlocks between writer and reader threads.
struct PtyWriter {
    fd: i32,
}

impl PtyWriter {
    fn new(writer: Box<dyn std::io::Write + Send>) -> std::io::Result<Self> {
        // Extract the raw fd from Box<dyn Write> (which wraps Box<File> on Unix).
        // Box<dyn Write> is a fat pointer: [data_ptr (8 bytes), vtable_ptr (8 bytes)].
        //
        // We use ManuallyDrop to prevent writer from closing the fd when dropped.
        // Instead of reconstructing Box<File> (which requires unsafe pointer gymnastics),
        // we duplicate the fd via F_DUPFD so both the original and duplicate reference
        // the same open file description. The original Box<File> closes its fd when
        // dropped; we close our duplicate in PtyWriter::drop.
        use std::mem::ManuallyDrop;
        let writer = ManuallyDrop::new(writer);

        // Get a raw pointer to the fat pointer representation.
        let writer_ptr: *const Box<dyn std::io::Write + Send> = &*writer;
        let fat_ptr: *const (dyn std::io::Write + Send) = writer_ptr as *const _;
        // fat_ptr points to two consecutive usize values: [data_ptr, vtable_ptr].
        // Read the first word (data_ptr) which is the Box<File> thin pointer.
        let data_ptr: usize = unsafe { *fat_ptr.cast::<usize>() };
        let file_box_ptr = data_ptr as *const Box<std::fs::File>;
        // Read the fd field from Box<File> (the only field, at offset 0).
        let fd: i32 = unsafe { *file_box_ptr.cast::<i32>() };

        // Sanity: fd must be non-negative (valid)
        if fd < 0 {
            return Err(std::io::Error::new(
                std::io::ErrorKind::InvalidInput,
                format!("PtyWriter: invalid fd {} from writer", fd),
            ));
        }

        // Duplicate the fd so both the original Box<File> and PtyWriter own a reference.
        let dup_fd = unsafe { libc::fcntl(fd, libc::F_DUPFD, 0) };
        if dup_fd < 0 {
            return Err(std::io::Error::last_os_error());
        }

        // Set non-blocking mode on the duplicated fd.
        let flags = unsafe { libc::fcntl(dup_fd, libc::F_GETFL) };
        if flags < 0 {
            let err = std::io::Error::last_os_error();
            unsafe { libc::close(dup_fd) };
            return Err(err);
        }
        if unsafe { libc::fcntl(dup_fd, libc::F_SETFL, flags | libc::O_NONBLOCK) } < 0 {
            let err = std::io::Error::last_os_error();
            unsafe { libc::close(dup_fd) };
            return Err(err);
        }
        Ok(Self { fd: dup_fd })
    }
}

impl std::io::Write for PtyWriter {
    fn write(&mut self, buf: &[u8]) -> std::io::Result<usize> {
        // Non-blocking write with timeout-based polling to avoid blocking indefinitely
        // while still allowing the write to complete when the PTY buffer has space.
        const POLL_TIMEOUT_MS: i32 = 100;
        const MAX_RETRIES: usize = 20; // 2 seconds total wait time

        let mut total_written = 0;
        let mut remaining = buf;

        for _ in 0..MAX_RETRIES {
            let n = unsafe {
                libc::write(
                    self.fd,
                    remaining.as_ptr() as *const libc::c_void,
                    remaining.len(),
                )
            };
            if n > 0 {
                total_written += n as usize;
                remaining = &remaining[n as usize..];
                if remaining.is_empty() {
                    return Ok(total_written);
                }
                // Continue to write remaining data
                continue;
            }
            // n <= 0: write failed or would block
            let err = std::io::Error::last_os_error();
            if err.kind() == std::io::ErrorKind::WouldBlock {
                // PTY buffer full: wait briefly then retry
                let mut fds = [libc::pollfd {
                    fd: self.fd,
                    events: libc::POLLOUT,
                    revents: 0,
                }];
                let ret = unsafe { libc::poll(&mut fds as *mut _, 1, POLL_TIMEOUT_MS) };
                if ret < 0 {
                    return Err(std::io::Error::last_os_error());
                }
                if ret == 0 {
                    // Timeout: PTY still not writable. Return WouldBlock so the caller
                    // (write_all) can retry or fail gracefully.
                    if total_written > 0 {
                        return Ok(total_written);
                    }
                    return Err(err);
                }
                // POLLOUT set: fd is writable, retry write
                continue;
            }
            // Non-WouldBlock error: propagate
            return Err(err);
        }
        // Exceeded max retries
        if total_written > 0 {
            Ok(total_written)
        } else {
            Err(std::io::Error::new(
                std::io::ErrorKind::WouldBlock,
                "pty write timeout",
            ))
        }
    }

    fn flush(&mut self) -> std::io::Result<()> {
        // No-op for non-blocking writes
        Ok(())
    }
}

impl Drop for PtyWriter {
    fn drop(&mut self) {
        unsafe { libc::close(self.fd) };
    }
}

/// Request sent to the PTY writer thread to write data.
pub(crate) struct PtyWriteRequest {
    pub data: Vec<u8>,
    pub result_tx: crossbeam_channel::Sender<std::io::Result<usize>>,
}

const PTY_WRITE_TIMEOUT_MS: u64 = 2000;

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
    // Writer thread will exit when the channel is closed (sender dropped).
    // No explicit action needed; dropping the runtime closes the channel.
    match &runtime.io {
        TerminalIo::Pty { .. } => {}
        #[cfg(test)]
        TerminalIo::Mock => {}
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
    let pty_writer = PtyWriter::new(writer).map_err(|e| e.to_string())?;

    // Create a channel for the writer thread. The thread owns the PTY writer
    // and handles writes asynchronously, preventing terminal_write from blocking.
    let (write_tx, write_rx): (
        std::sync::mpsc::Sender<PtyWriteRequest>,
        std::sync::mpsc::Receiver<PtyWriteRequest>,
    ) = std::sync::mpsc::channel();

    // Spawn the writer thread. It owns the non-blocking PTY writer and handles
    // write requests. When the channel is dropped, the thread exits.
    std::thread::spawn(move || {
        let mut writer = pty_writer;
        for req in write_rx {
            let result = writer.write_all(&req.data).map(|_| req.data.len());
            let _ = req.result_tx.send(result);
        }
    });

    let runtime = Arc::new(TerminalRuntime {
        io: TerminalIo::Pty {
            writer_tx: write_tx,
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
                Err(err) if err.kind() == std::io::ErrorKind::WouldBlock => {
                    // Non-blocking read with no data available: sleep and retry.
                    std::thread::sleep(std::time::Duration::from_millis(10));
                    continue;
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
    let TerminalBridgeTarget::Pty {
        cwd,
        target,
        cols,
        rows,
    } = bridge_target;
    let runtime = create_pty_terminal_runtime(
        terminal_id,
        workspace_id,
        &cwd,
        &target,
        cols,
        rows,
        options,
        app,
        state,
    )?;

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
        TerminalWriteOrigin::Supervisor => format!("# [supervisor]\n{}", input),
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
        TerminalIo::Pty { writer_tx, .. } => {
            // Send the write request to the writer thread with a timeout.
            // The writer thread owns the PTY writer and handles writes synchronously.
            let (result_tx, result_rx): (
                crossbeam_channel::Sender<std::io::Result<usize>>,
                crossbeam_channel::Receiver<std::io::Result<usize>>,
            ) = crossbeam_channel::bounded(0);
            let req = PtyWriteRequest {
                data: decorated_input.as_bytes().to_vec(),
                result_tx,
            };
            if writer_tx.send(req).is_err() {
                // Writer thread has exited (channel closed)
                return Err("terminal_stdin_closed".to_string());
            }
            match result_rx.recv_timeout(std::time::Duration::from_millis(PTY_WRITE_TIMEOUT_MS)) {
                Ok(Ok(_)) => {}
                Ok(Err(e)) => return Err(e.to_string()),
                Err(crossbeam_channel::RecvTimeoutError::Timeout) => {
                    return Err("terminal_write_timeout".to_string())
                }
                Err(crossbeam_channel::RecvTimeoutError::Disconnected) => {
                    return Err("terminal_stdin_closed".to_string())
                }
            }
        }
        #[cfg(test)]
        TerminalIo::Mock => {}
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
        TerminalIo::Pty { master, .. } => {
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
        #[cfg(not(test))]
        _ => {
            eprintln!("warning: terminal_resize: unknown TerminalIo variant, skipping");
            Ok(())
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
        terminate_terminal_runtime(runtime);
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
