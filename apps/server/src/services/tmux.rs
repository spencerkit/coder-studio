use crate::*;
use portable_pty::{native_pty_system, Child, ChildKiller, CommandBuilder, PtyPair, PtySize};
use std::collections::BTreeMap;
use std::path::PathBuf;
use std::sync::{Mutex, OnceLock};
use std::time::Duration;

const CODER_STUDIO_TMUX_SESSION_PREFIX: &str = "coder-studio-";
const CODER_STUDIO_SESSION_ENV_KEYS: [&str; 2] =
    ["CODER_STUDIO_WORKSPACE_ID", "CODER_STUDIO_SESSION_ID"];
pub(crate) const CODER_STUDIO_RUNTIME_PID_ENV_KEY: &str = "CODER_STUDIO_RUNTIME_PID";
const CODER_STUDIO_TMUX_SOCKET_FILE: &str = "tmux.sock";
const CODER_STUDIO_TMUX_JANITOR_INTERVAL_MS_DEFAULT: u64 = 45_000;
const CODER_STUDIO_TMUX_JANITOR_INTERVAL_MS_MIN: u64 = 5_000;
const CODER_STUDIO_TMUX_JANITOR_INTERVAL_MS_MAX: u64 = 300_000;
pub(crate) const CODER_STUDIO_TMUX_JANITOR_INTERVAL_MS_ENV_KEY: &str =
    "CODER_STUDIO_TMUX_JANITOR_INTERVAL_MS";

static TMUX_SOCKET_PATH_OVERRIDE: OnceLock<Mutex<Option<PathBuf>>> = OnceLock::new();

fn tmux_socket_path_override() -> &'static Mutex<Option<PathBuf>> {
    TMUX_SOCKET_PATH_OVERRIDE.get_or_init(|| Mutex::new(None))
}

pub(crate) fn configure_tmux_socket_path(path: PathBuf) {
    if let Ok(mut guard) = tmux_socket_path_override().lock() {
        *guard = Some(path);
    }
}

fn derive_tmux_socket_path(
    coder_studio_home: Option<PathBuf>,
    coder_studio_data_dir: Option<PathBuf>,
) -> Option<PathBuf> {
    if let Some(home) = coder_studio_home {
        return Some(home.join(CODER_STUDIO_TMUX_SOCKET_FILE));
    }
    coder_studio_data_dir.and_then(|data_dir| {
        data_dir
            .parent()
            .map(|parent| parent.join(CODER_STUDIO_TMUX_SOCKET_FILE))
    })
}

fn resolve_tmux_socket_path() -> PathBuf {
    if let Ok(guard) = tmux_socket_path_override().lock() {
        if let Some(path) = guard.as_ref() {
            return path.clone();
        }
    }

    let env_home = std::env::var_os("CODER_STUDIO_HOME").map(PathBuf::from);
    let env_data_dir = std::env::var_os("CODER_STUDIO_DATA_DIR").map(PathBuf::from);
    if let Some(path) = derive_tmux_socket_path(env_home, env_data_dir) {
        return path;
    }

    std::env::temp_dir()
        .join("coder-studio")
        .join(CODER_STUDIO_TMUX_SOCKET_FILE)
}

fn ensure_tmux_socket_parent(socket_path: &PathBuf) {
    if let Some(parent) = socket_path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
}

fn tmux_command() -> Command {
    let mut command = Command::new("tmux");
    let socket = resolve_tmux_socket_path();
    ensure_tmux_socket_parent(&socket);
    let socket = socket.to_string_lossy().into_owned();
    command.args(tmux_socket_args(&socket, &[]));
    command
}

fn tmux_command_builder() -> CommandBuilder {
    let mut command = CommandBuilder::new("tmux");
    let socket = resolve_tmux_socket_path();
    ensure_tmux_socket_parent(&socket);
    let socket = socket.to_string_lossy().into_owned();
    command.args(tmux_socket_args(&socket, &[]));
    command
}

fn tmux_socket_args(socket: &str, args: &[&str]) -> Vec<String> {
    let mut resolved = Vec::with_capacity(args.len() + 2);
    resolved.push("-S".to_string());
    resolved.push(socket.to_string());
    resolved.extend(args.iter().map(|value| value.to_string()));
    resolved
}

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub(crate) struct TmuxCleanupReport {
    pub(crate) scanned_sessions: usize,
    pub(crate) cleaned_sessions: usize,
    pub(crate) skipped_non_prefix: usize,
    pub(crate) skipped_missing_markers: usize,
    pub(crate) skipped_missing_owner_pid: usize,
    pub(crate) skipped_owner_alive: usize,
    pub(crate) skipped_owner_mismatch: usize,
    pub(crate) ignored_race_errors: usize,
}

impl TmuxCleanupReport {
    pub(crate) fn summary_line(&self) -> String {
        format!(
            "scanned={} cleaned={} skipped_non_prefix={} skipped_missing_markers={} skipped_missing_owner_pid={} skipped_owner_alive={} skipped_owner_mismatch={} ignored_race_errors={}",
            self.scanned_sessions,
            self.cleaned_sessions,
            self.skipped_non_prefix,
            self.skipped_missing_markers,
            self.skipped_missing_owner_pid,
            self.skipped_owner_alive,
            self.skipped_owner_mismatch,
            self.ignored_race_errors
        )
    }
}

fn parse_tmux_janitor_interval_ms(value: Option<&str>) -> Option<u64> {
    value
        .map(str::trim)
        .filter(|raw| !raw.is_empty())
        .and_then(|raw| raw.parse::<u64>().ok())
}

pub(crate) fn tmux_janitor_interval() -> Duration {
    let interval = parse_tmux_janitor_interval_ms(
        std::env::var(CODER_STUDIO_TMUX_JANITOR_INTERVAL_MS_ENV_KEY)
            .ok()
            .as_deref(),
    )
    .map(|value| {
        value.clamp(
            CODER_STUDIO_TMUX_JANITOR_INTERVAL_MS_MIN,
            CODER_STUDIO_TMUX_JANITOR_INTERVAL_MS_MAX,
        )
    })
    .unwrap_or(CODER_STUDIO_TMUX_JANITOR_INTERVAL_MS_DEFAULT);
    Duration::from_millis(interval)
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct TmuxRuntime {
    pub(crate) session_name: String,
    pub(crate) pane_id: String,
}

pub(crate) struct TmuxAttachRuntime {
    pub(crate) pair: PtyPair,
    pub(crate) child: Mutex<Box<dyn Child + Send>>,
    pub(crate) killer: Mutex<Box<dyn ChildKiller + Send + Sync>>,
}

pub(crate) fn create_tmux_runtime(
    workspace_id: &str,
    session_id: &str,
    cwd: &str,
    target: &ExecTarget,
    env: &BTreeMap<String, String>,
) -> Result<TmuxRuntime, String> {
    create_tmux_runtime_with(
        workspace_id,
        session_id,
        cwd,
        target,
        env,
        create_tmux_session,
    )
}

pub(crate) fn attach_tmux_session(
    session_name: &str,
    cols: Option<u16>,
    rows: Option<u16>,
) -> Result<TmuxAttachRuntime, String> {
    let pty_system = native_pty_system();
    let pair = pty_system
        .openpty(PtySize {
            rows: rows.filter(|value| *value > 0).unwrap_or(30),
            cols: cols.filter(|value| *value > 0).unwrap_or(120),
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|error| error.to_string())?;
    let mut command = tmux_command_builder();
    command.args(["attach-session", "-t", session_name]);
    let child = pair
        .slave
        .spawn_command(command)
        .map_err(|error| error.to_string())?;
    let killer = child.clone_killer();
    Ok(TmuxAttachRuntime {
        pair,
        child: Mutex::new(child),
        killer: Mutex::new(killer),
    })
}

pub(crate) fn send_tmux_input(session_name: &str, input: &str) -> Result<(), String> {
    let output = tmux_command()
        .args(["send-keys", "-t", session_name, input, "Enter"])
        .output()
        .map_err(|error| error.to_string())?;
    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).trim().to_string());
    }
    Ok(())
}

pub(crate) fn send_tmux_raw_input(session_name: &str, input: &str) -> Result<(), String> {
    // Split on \r only. \n is a valid shell character (e.g., inside quoted
    // format strings like 'hello\n') and must not be treated as a command separator.
    // send_tmux_literal handles \n correctly via split_lines_outside_quotes.
    let mut literal = String::new();
    for ch in input.chars() {
        if ch == '\r' {
            if !literal.is_empty() {
                send_tmux_literal(session_name, &literal)?;
                literal.clear();
            }
            send_tmux_enter(session_name)?;
        } else {
            literal.push(ch);
        }
    }
    if !literal.is_empty() {
        send_tmux_literal(session_name, &literal)?;
    }
    Ok(())
}

fn send_tmux_literal(session_name: &str, input: &str) -> Result<(), String> {
    // Split on newlines that appear outside quoted regions. This prevents \n inside
    // quoted format strings (e.g. 'hello\n') from being mistaken for command separators.
    // Then tokenize each line and send it as a single tmux send-keys argument,
    // preserving the original spacing so the shell receives the correct command.
    for line in split_lines_outside_quotes(input) {
        let line = line.trim_end_matches('\r');
        if line.is_empty() {
            continue;
        }
        let output = tmux_command()
            .args(["send-keys", "-t", session_name, &line])
            .output()
            .map_err(|e| e.to_string())?;
        if !output.status.success() {
            return Err(String::from_utf8_lossy(&output.stderr).trim().to_string());
        }
    }
    Ok(())
}

/// Split input on '\n' (backslash-n) only when outside single/double quotes.
fn split_lines_outside_quotes(input: &str) -> Vec<&str> {
    let mut lines = Vec::new();
    let mut in_single = false;
    let mut in_double = false;
    let mut escaped = false;
    let mut last_start = 0;
    let mut i = 0;

    while i < input.len() {
        let ch = input[i..].chars().next().unwrap();
        if escaped {
            escaped = false;
            i += ch.len_utf8();
            continue;
        }
        match ch {
            '\\' => {
                escaped = true;
                i += 1;
                continue;
            }
            '\'' if !in_double => {
                in_single = !in_single;
            }
            '"' if !in_single => {
                in_double = !in_double;
            }
            '\n' if !in_single && !in_double => {
                lines.push(&input[last_start..i]);
                last_start = i + 1;
            }
            _ => {}
        }
        i += ch.len_utf8();
    }
    if last_start < input.len() {
        lines.push(&input[last_start..]);
    }
    lines
}

fn send_tmux_enter(session_name: &str) -> Result<(), String> {
    let output = tmux_command()
        .args(["send-keys", "-t", session_name, "Enter"])
        .output()
        .map_err(|error| error.to_string())?;
    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).trim().to_string());
    }
    Ok(())
}

pub(crate) fn capture_tmux_pane(_session_name: &str, pane_id: &str) -> Result<String, String> {
    let output = tmux_command()
        .args(["capture-pane", "-p", "-J", "-t", pane_id])
        .output()
        .map_err(|error| error.to_string())?;
    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).trim().to_string());
    }
    Ok(String::from_utf8_lossy(&output.stdout).to_string())
}

pub(crate) fn resize_tmux_pane(
    _session_name: &str,
    pane_id: &str,
    cols: u16,
    rows: u16,
) -> Result<(), String> {
    let output = tmux_command()
        .args([
            "resize-pane",
            "-x",
            &cols.to_string(),
            "-y",
            &rows.to_string(),
            "-t",
            pane_id,
        ])
        .output()
        .map_err(|error| error.to_string())?;
    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).trim().to_string());
    }
    Ok(())
}

pub(crate) fn tmux_session_exists(session_name: &str) -> bool {
    tmux_command()
        .args(["has-session", "-t", session_name])
        .output()
        .map(|output| output.status.success())
        .unwrap_or(false)
}

pub(crate) fn kill_tmux_session(session_name: &str) -> Result<(), String> {
    let output = tmux_command()
        .args(["kill-session", "-t", session_name])
        .output()
        .map_err(|error| error.to_string())?;
    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).trim().to_string());
    }
    Ok(())
}

fn is_tmux_no_server_error(stderr: &str) -> bool {
    let lower = stderr.to_ascii_lowercase();
    lower.contains("no server running") || lower.contains("failed to connect to server")
}

fn is_tmux_race_error(stderr: &str) -> bool {
    let lower = stderr.to_ascii_lowercase();
    lower.contains("can't find session")
        || lower.contains("no server running")
        || lower.contains("failed to connect to server")
}

fn parse_tmux_sessions(stdout: &str) -> Vec<String> {
    stdout
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .map(ToOwned::to_owned)
        .collect()
}

fn parse_tmux_environment(stdout: &str) -> BTreeMap<String, String> {
    let mut env = BTreeMap::new();
    for line in stdout
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
    {
        if let Some((key, value)) = line.split_once('=') {
            if !key.is_empty() {
                env.insert(key.to_string(), value.to_string());
            }
        }
    }
    env
}

fn is_coder_studio_tmux_session_name(session_name: &str) -> bool {
    session_name.starts_with(CODER_STUDIO_TMUX_SESSION_PREFIX)
}

fn has_coder_studio_tmux_markers(env: &BTreeMap<String, String>) -> bool {
    CODER_STUDIO_SESSION_ENV_KEYS
        .iter()
        .all(|key| env.get(*key).is_some_and(|value| !value.is_empty()))
}

fn parse_runtime_owner_pid(env: &BTreeMap<String, String>) -> Option<u32> {
    env.get(CODER_STUDIO_RUNTIME_PID_ENV_KEY)
        .and_then(|value| value.parse::<u32>().ok())
        .filter(|pid| *pid > 0)
}

fn is_process_running(pid: u32) -> bool {
    #[cfg(unix)]
    {
        let pid = pid as i32;
        // SAFETY: libc::kill with signal 0 only checks process existence.
        let result = unsafe { libc::kill(pid, 0) };
        if result == 0 {
            return true;
        }
        let errno = std::io::Error::last_os_error()
            .raw_os_error()
            .unwrap_or_default();
        errno == libc::EPERM
    }

    #[cfg(not(unix))]
    {
        let _ = pid;
        true
    }
}

fn list_tmux_sessions() -> Result<Vec<String>, String> {
    let output = match tmux_command()
        .args(["list-sessions", "-F", "#{session_name}"])
        .output()
    {
        Ok(output) => output,
        Err(error) => {
            if error.kind() == std::io::ErrorKind::NotFound {
                return Ok(Vec::new());
            }
            return Err(error.to_string());
        }
    };
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        if is_tmux_no_server_error(&stderr) {
            return Ok(Vec::new());
        }
        return Err(stderr);
    }
    Ok(parse_tmux_sessions(&String::from_utf8_lossy(
        &output.stdout,
    )))
}

fn read_tmux_session_environment(session_name: &str) -> Result<BTreeMap<String, String>, String> {
    let output = tmux_command()
        .args(["show-environment", "-t", session_name])
        .output()
        .map_err(|error| error.to_string())?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(stderr);
    }
    Ok(parse_tmux_environment(&String::from_utf8_lossy(
        &output.stdout,
    )))
}

pub(crate) fn cleanup_managed_tmux_sessions_stale() -> Result<TmuxCleanupReport, String> {
    let sessions = list_tmux_sessions()?;
    let current_pid = std::process::id();
    let mut report = TmuxCleanupReport::default();
    for session_name in sessions {
        report.scanned_sessions = report.scanned_sessions.saturating_add(1);
        if !is_coder_studio_tmux_session_name(&session_name) {
            report.skipped_non_prefix = report.skipped_non_prefix.saturating_add(1);
            continue;
        }

        let Ok(env) = read_tmux_session_environment(&session_name) else {
            // Session may have disappeared between list and inspection.
            report.ignored_race_errors = report.ignored_race_errors.saturating_add(1);
            continue;
        };
        if !has_coder_studio_tmux_markers(&env) {
            report.skipped_missing_markers = report.skipped_missing_markers.saturating_add(1);
            continue;
        }
        let Some(owner_pid) = parse_runtime_owner_pid(&env) else {
            // Startup stale cleanup only touches sessions that explicitly report
            // owning runtime pid. This avoids killing sessions created by
            // older/other instances that don't expose ownership metadata.
            report.skipped_missing_owner_pid = report.skipped_missing_owner_pid.saturating_add(1);
            continue;
        };
        if owner_pid == current_pid || is_process_running(owner_pid) {
            report.skipped_owner_alive = report.skipped_owner_alive.saturating_add(1);
            continue;
        }

        match kill_tmux_session(&session_name) {
            Ok(()) => report.cleaned_sessions = report.cleaned_sessions.saturating_add(1),
            Err(error) => {
                if !is_tmux_race_error(&error) {
                    return Err(error);
                }
                report.ignored_race_errors = report.ignored_race_errors.saturating_add(1);
            }
        }
    }
    Ok(report)
}

pub(crate) fn cleanup_managed_tmux_sessions_for_current_process() -> Result<TmuxCleanupReport, String> {
    let sessions = list_tmux_sessions()?;
    let current_pid = std::process::id();
    let mut report = TmuxCleanupReport::default();
    for session_name in sessions {
        report.scanned_sessions = report.scanned_sessions.saturating_add(1);
        if !is_coder_studio_tmux_session_name(&session_name) {
            report.skipped_non_prefix = report.skipped_non_prefix.saturating_add(1);
            continue;
        }

        let Ok(env) = read_tmux_session_environment(&session_name) else {
            report.ignored_race_errors = report.ignored_race_errors.saturating_add(1);
            continue;
        };
        if !has_coder_studio_tmux_markers(&env) {
            report.skipped_missing_markers = report.skipped_missing_markers.saturating_add(1);
            continue;
        }
        let Some(owner_pid) = parse_runtime_owner_pid(&env) else {
            report.skipped_missing_owner_pid = report.skipped_missing_owner_pid.saturating_add(1);
            continue;
        };
        if owner_pid != current_pid {
            report.skipped_owner_mismatch = report.skipped_owner_mismatch.saturating_add(1);
            continue;
        }

        match kill_tmux_session(&session_name) {
            Ok(()) => report.cleaned_sessions = report.cleaned_sessions.saturating_add(1),
            Err(error) => {
                if !is_tmux_race_error(&error) {
                    return Err(error);
                }
                report.ignored_race_errors = report.ignored_race_errors.saturating_add(1);
            }
        }
    }
    Ok(report)
}

fn create_tmux_runtime_with<F>(
    workspace_id: &str,
    session_id: &str,
    cwd: &str,
    target: &ExecTarget,
    env: &BTreeMap<String, String>,
    create_session: F,
) -> Result<TmuxRuntime, String>
where
    F: FnOnce(&str, &str, &ExecTarget, &BTreeMap<String, String>) -> Result<String, String>,
{
    let unique_suffix = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(|error| error.to_string())?
        .as_nanos();
    let session_name = format!(
        "coder-studio-{}-{}-{}",
        workspace_id, session_id, unique_suffix
    );
    let pane_id = create_session(&session_name, cwd, target, env)?;
    Ok(TmuxRuntime {
        session_name,
        pane_id,
    })
}

fn create_tmux_session(
    session_name: &str,
    cwd: &str,
    _target: &ExecTarget,
    env: &BTreeMap<String, String>,
) -> Result<String, String> {
    let mut command = tmux_command();
    command.args(["new-session", "-d", "-P", "-c", cwd, "-s", session_name]);
    for (key, value) in env {
        command.args(["-e", &format!("{key}={value}")]);
    }
    let output = command
        .args(["-F", "#{pane_id}"])
        .output()
        .map_err(|error| error.to_string())?;
    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).trim().to_string());
    }
    Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn create_tmux_runtime_returns_session_identity() {
        let runtime = create_tmux_runtime_with(
            "ws-1",
            "session-1",
            "/tmp/project-a",
            &ExecTarget::Native,
            &BTreeMap::from([("TEST_KEY".to_string(), "value".to_string())]),
            |session_name, cwd, target, env| {
                assert!(session_name.starts_with("coder-studio-ws-1-session-1-"));
                assert_eq!(cwd, "/tmp/project-a");
                assert_eq!(*target, ExecTarget::Native);
                assert_eq!(env.get("TEST_KEY").map(String::as_str), Some("value"));
                Ok("%1".to_string())
            },
        )
        .expect("tmux runtime should be created");

        assert!(runtime.session_name.starts_with("coder-studio-"));
        assert_eq!(runtime.pane_id, "%1");
    }

    #[test]
    fn create_tmux_runtime_propagates_creator_errors() {
        let result = create_tmux_runtime_with(
            "ws-1",
            "session-1",
            "/tmp/project-a",
            &ExecTarget::Native,
            &BTreeMap::new(),
            |_session_name, _cwd, _target, _env| Err("tmux failed to start".to_string()),
        );

        assert_eq!(result, Err("tmux failed to start".to_string()));
    }

    #[test]
    fn derive_tmux_socket_path_prefers_home_over_data_dir() {
        let path = derive_tmux_socket_path(
            Some(PathBuf::from("/tmp/coder-studio-home")),
            Some(PathBuf::from("/tmp/coder-studio-home/data")),
        )
        .expect("socket path should resolve");
        assert_eq!(path, PathBuf::from("/tmp/coder-studio-home/tmux.sock"));
    }

    #[test]
    fn derive_tmux_socket_path_falls_back_to_data_dir_parent() {
        let path = derive_tmux_socket_path(None, Some(PathBuf::from("/tmp/coder-studio/data")))
            .expect("socket path should resolve");
        assert_eq!(path, PathBuf::from("/tmp/coder-studio/tmux.sock"));
    }

    #[test]
    fn tmux_socket_args_prefixes_command_with_socket() {
        let args = tmux_socket_args("/tmp/coder-studio/tmux.sock", &["list-sessions", "-F"]);
        assert_eq!(
            args,
            vec![
                "-S".to_string(),
                "/tmp/coder-studio/tmux.sock".to_string(),
                "list-sessions".to_string(),
                "-F".to_string()
            ]
        );
    }

    #[test]
    fn parse_tmux_sessions_ignores_blank_lines() {
        let parsed = parse_tmux_sessions("\n  alpha\nbeta  \n\n");
        assert_eq!(parsed, vec!["alpha".to_string(), "beta".to_string()]);
    }

    #[test]
    fn parse_tmux_environment_ignores_unset_and_blank_entries() {
        let env = parse_tmux_environment(
            "CODER_STUDIO_WORKSPACE_ID=ws-1\n-CODER_STUDIO_SESSION_ID\nDISPLAY=:0\n\n",
        );
        assert_eq!(
            env.get("CODER_STUDIO_WORKSPACE_ID").map(String::as_str),
            Some("ws-1")
        );
        assert_eq!(env.get("CODER_STUDIO_SESSION_ID"), None);
        assert_eq!(env.get("DISPLAY").map(String::as_str), Some(":0"));
    }

    #[test]
    fn has_coder_studio_tmux_markers_requires_workspace_and_session_ids() {
        let none = BTreeMap::new();
        assert!(!has_coder_studio_tmux_markers(&none));

        let partial =
            BTreeMap::from([("CODER_STUDIO_WORKSPACE_ID".to_string(), "ws-1".to_string())]);
        assert!(!has_coder_studio_tmux_markers(&partial));

        let full = BTreeMap::from([
            ("CODER_STUDIO_WORKSPACE_ID".to_string(), "ws-1".to_string()),
            (
                "CODER_STUDIO_SESSION_ID".to_string(),
                "session-1".to_string(),
            ),
        ]);
        assert!(has_coder_studio_tmux_markers(&full));
    }

    #[test]
    fn parse_runtime_owner_pid_reads_positive_integer() {
        let env = BTreeMap::from([(
            CODER_STUDIO_RUNTIME_PID_ENV_KEY.to_string(),
            "1234".to_string(),
        )]);
        assert_eq!(parse_runtime_owner_pid(&env), Some(1234));

        let empty =
            BTreeMap::from([(CODER_STUDIO_RUNTIME_PID_ENV_KEY.to_string(), "".to_string())]);
        assert_eq!(parse_runtime_owner_pid(&empty), None);
    }

    #[test]
    fn is_coder_studio_tmux_session_name_checks_prefix() {
        assert!(is_coder_studio_tmux_session_name(
            "coder-studio-ws-1-session-1-123"
        ));
        assert!(!is_coder_studio_tmux_session_name("dev"));
    }

    #[test]
    fn is_tmux_no_server_error_matches_tmux_message() {
        assert!(is_tmux_no_server_error(
            "no server running on /tmp/tmux-1000/default"
        ));
        assert!(!is_tmux_no_server_error("can't find session"));
    }

    #[test]
    fn is_tmux_race_error_matches_known_messages() {
        assert!(is_tmux_race_error("can't find session: missing"));
        assert!(is_tmux_race_error(
            "no server running on /tmp/tmux-1000/default"
        ));
        assert!(!is_tmux_race_error("permission denied"));
    }

    #[test]
    fn parse_tmux_janitor_interval_ms_accepts_positive_and_zero_values() {
        assert_eq!(parse_tmux_janitor_interval_ms(Some("0")), Some(0));
        assert_eq!(parse_tmux_janitor_interval_ms(Some("45000")), Some(45_000));
        assert_eq!(parse_tmux_janitor_interval_ms(Some(" 1200 ")), Some(1200));
    }

    #[test]
    fn parse_tmux_janitor_interval_ms_rejects_invalid_values() {
        assert_eq!(parse_tmux_janitor_interval_ms(None), None);
        assert_eq!(parse_tmux_janitor_interval_ms(Some("")), None);
        assert_eq!(parse_tmux_janitor_interval_ms(Some("abc")), None);
        assert_eq!(parse_tmux_janitor_interval_ms(Some("-1")), None);
    }

    #[test]
    fn tmux_janitor_interval_uses_env_override_or_default() {
        let previous = std::env::var(CODER_STUDIO_TMUX_JANITOR_INTERVAL_MS_ENV_KEY).ok();
        std::env::set_var(CODER_STUDIO_TMUX_JANITOR_INTERVAL_MS_ENV_KEY, "1200");
        assert_eq!(
            tmux_janitor_interval(),
            Duration::from_millis(CODER_STUDIO_TMUX_JANITOR_INTERVAL_MS_MIN)
        );
        std::env::set_var(CODER_STUDIO_TMUX_JANITOR_INTERVAL_MS_ENV_KEY, "9999999");
        assert_eq!(
            tmux_janitor_interval(),
            Duration::from_millis(CODER_STUDIO_TMUX_JANITOR_INTERVAL_MS_MAX)
        );
        std::env::remove_var(CODER_STUDIO_TMUX_JANITOR_INTERVAL_MS_ENV_KEY);
        assert_eq!(
            tmux_janitor_interval(),
            Duration::from_millis(CODER_STUDIO_TMUX_JANITOR_INTERVAL_MS_DEFAULT)
        );
        if let Some(value) = previous {
            std::env::set_var(CODER_STUDIO_TMUX_JANITOR_INTERVAL_MS_ENV_KEY, value);
        } else {
            std::env::remove_var(CODER_STUDIO_TMUX_JANITOR_INTERVAL_MS_ENV_KEY);
        }
    }

    #[test]
    fn cleanup_report_summary_includes_key_counts() {
        let report = TmuxCleanupReport {
            scanned_sessions: 10,
            cleaned_sessions: 2,
            skipped_non_prefix: 3,
            skipped_missing_markers: 1,
            skipped_missing_owner_pid: 1,
            skipped_owner_alive: 1,
            skipped_owner_mismatch: 1,
            ignored_race_errors: 1,
        };
        let summary = report.summary_line();
        assert!(summary.contains("scanned=10"));
        assert!(summary.contains("cleaned=2"));
        assert!(summary.contains("ignored_race_errors=1"));
    }
}
