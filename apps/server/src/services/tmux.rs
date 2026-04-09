use crate::*;
use portable_pty::{native_pty_system, Child, ChildKiller, CommandBuilder, PtyPair, PtySize};
use std::collections::BTreeMap;
use std::sync::Mutex;

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
    create_tmux_runtime_with(workspace_id, session_id, cwd, target, env, create_tmux_session)
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
    let mut command = CommandBuilder::new("tmux");
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
    let output = Command::new("tmux")
        .args(["send-keys", "-t", session_name, input, "Enter"])
        .output()
        .map_err(|error| error.to_string())?;
    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).trim().to_string());
    }
    Ok(())
}

pub(crate) fn send_tmux_raw_input(session_name: &str, input: &str) -> Result<(), String> {
    let mut literal = String::new();
    for ch in input.chars() {
        if ch == '\r' || ch == '\n' {
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
    let output = Command::new("tmux")
        .args(["set-buffer", "--", input])
        .output()
        .map_err(|error| error.to_string())?;
    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).trim().to_string());
    }
    let output = Command::new("tmux")
        .args(["paste-buffer", "-d", "-t", session_name])
        .output()
        .map_err(|error| error.to_string())?;
    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).trim().to_string());
    }
    Ok(())
}

fn send_tmux_enter(session_name: &str) -> Result<(), String> {
    let output = Command::new("tmux")
        .args(["send-keys", "-t", session_name, "Enter"])
        .output()
        .map_err(|error| error.to_string())?;
    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).trim().to_string());
    }
    Ok(())
}

pub(crate) fn capture_tmux_pane(_session_name: &str, pane_id: &str) -> Result<String, String> {
    let output = Command::new("tmux")
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
    let output = Command::new("tmux")
        .args(["resize-pane", "-x", &cols.to_string(), "-y", &rows.to_string(), "-t", pane_id])
        .output()
        .map_err(|error| error.to_string())?;
    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).trim().to_string());
    }
    Ok(())
}

pub(crate) fn tmux_session_exists(session_name: &str) -> bool {
    Command::new("tmux")
        .args(["has-session", "-t", session_name])
        .output()
        .map(|output| output.status.success())
        .unwrap_or(false)
}

pub(crate) fn kill_tmux_session(session_name: &str) -> Result<(), String> {
    let output = Command::new("tmux")
        .args(["kill-session", "-t", session_name])
        .output()
        .map_err(|error| error.to_string())?;
    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).trim().to_string());
    }
    Ok(())
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
    let mut command = Command::new("tmux");
    command.args([
        "new-session",
        "-d",
        "-P",
        "-c",
        cwd,
        "-s",
        session_name,
    ]);
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
}
