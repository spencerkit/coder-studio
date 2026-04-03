use crate::*;

pub(crate) fn trim_branch_name(raw: &str) -> String {
    raw.trim()
        .trim_start_matches("refs/heads/")
        .trim_start_matches("branch ")
        .to_string()
}

pub(crate) fn summarize_status(path: &str, target: &ExecTarget) -> String {
    let status = run_cmd(target, path, &["git", "status", "--short"]).unwrap_or_default();
    let changes = status
        .lines()
        .filter(|line| !line.trim().is_empty())
        .count();
    if changes == 0 {
        "Clean".to_string()
    } else if changes == 1 {
        "1 changed file".to_string()
    } else {
        format!("{} changed files", changes)
    }
}

pub(crate) fn shell_escape(value: &str) -> String {
    if value
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || "-_./:@".contains(c))
    {
        value.to_string()
    } else {
        format!("'{}'", value.replace('\'', "'\"'\"'"))
    }
}

pub(crate) fn shell_escape_windows(value: &str) -> String {
    if value.is_empty() {
        "\"\"".to_string()
    } else {
        format!("\"{}\"", value.replace('"', "\"\""))
    }
}

#[cfg(target_os = "windows")]
fn apply_windows_no_window(cmd: &mut Command) {
    use std::os::windows::process::CommandExt;

    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    cmd.creation_flags(CREATE_NO_WINDOW);
}

#[cfg(not(target_os = "windows"))]
fn apply_windows_no_window(_cmd: &mut Command) {}

#[cfg(unix)]
fn signal_unix_process_tree(
    process_group_leader: Option<i32>,
    process_id: Option<u32>,
    signal: libc::c_int,
) -> Result<(), String> {
    if let Some(group_leader) = process_group_leader.filter(|value| *value > 0) {
        let result = unsafe { libc::killpg(group_leader, signal) };
        if result == 0 {
            return Ok(());
        }
        let error = std::io::Error::last_os_error();
        if error.raw_os_error() != Some(libc::ESRCH) {
            return Err(error.to_string());
        }
    }

    if let Some(pid) = process_id {
        let result = unsafe { libc::kill(pid as i32, signal) };
        if result == 0 {
            return Ok(());
        }
        let error = std::io::Error::last_os_error();
        if error.raw_os_error() != Some(libc::ESRCH) {
            return Err(error.to_string());
        }
    }

    Ok(())
}

#[cfg(unix)]
fn unix_process_exists(process_id: u32) -> bool {
    let result = unsafe { libc::kill(process_id as i32, 0) };
    if result == 0 {
        return true;
    }
    matches!(
        std::io::Error::last_os_error().raw_os_error(),
        Some(libc::EPERM)
    )
}

#[cfg(unix)]
pub(crate) fn terminate_process_tree(
    killer: &mut (dyn portable_pty::ChildKiller + Send + Sync),
    process_id: Option<u32>,
    process_group_leader: Option<i32>,
) -> Result<(), String> {
    signal_unix_process_tree(process_group_leader, process_id, libc::SIGTERM)?;
    std::thread::sleep(std::time::Duration::from_millis(150));
    if process_id.is_some_and(unix_process_exists) {
        signal_unix_process_tree(process_group_leader, process_id, libc::SIGKILL)?;
    }
    let _ = killer.kill();
    Ok(())
}

#[cfg(windows)]
pub(crate) fn terminate_process_tree(
    killer: &mut (dyn portable_pty::ChildKiller + Send + Sync),
    process_id: Option<u32>,
    _process_group_leader: Option<i32>,
) -> Result<(), String> {
    if let Some(pid) = process_id {
        let output = std::process::Command::new("taskkill")
            .args(["/PID", &pid.to_string(), "/T", "/F"])
            .stderr(std::process::Stdio::piped())
            .stdout(std::process::Stdio::piped())
            .output();

        if let Ok(output) = output {
            if output.status.success() {
                return Ok(());
            }
        }
    }

    let _ = killer.kill();
    Ok(())
}

pub(crate) fn run_cmd(target: &ExecTarget, cwd: &str, args: &[&str]) -> Result<String, String> {
    let mut cmd = if let ExecTarget::Wsl { distro } = target {
        let mut c = Command::new("wsl.exe");
        apply_windows_no_window(&mut c);
        if let Some(d) = distro {
            c.args(["-d", d]);
        }
        let mut shell_cmd = String::new();
        if !cwd.is_empty() {
            shell_cmd.push_str("cd ");
            shell_cmd.push_str(&shell_escape(cwd));
            shell_cmd.push_str(" && ");
        }
        for (i, a) in args.iter().enumerate() {
            if i > 0 {
                shell_cmd.push(' ');
            }
            shell_cmd.push_str(&shell_escape(a));
        }
        c.args(["--", "/bin/sh", "-lc", &shell_cmd]);
        c
    } else {
        let mut c = std::process::Command::new(args[0]);
        apply_windows_no_window(&mut c);
        c.args(&args[1..]);
        if !cwd.is_empty() {
            c.current_dir(cwd);
        }
        c
    };

    let out = cmd
        .stderr(Stdio::piped())
        .stdout(Stdio::piped())
        .output()
        .map_err(|e| e.to_string())?;
    if out.status.success() {
        Ok(String::from_utf8_lossy(&out.stdout)
            .trim_end_matches(['\r', '\n'])
            .to_string())
    } else {
        Err(String::from_utf8_lossy(&out.stderr)
            .trim_end_matches(['\r', '\n'])
            .to_string())
    }
}

pub(crate) fn run_command_output(mut cmd: Command) -> Result<String, String> {
    let out = cmd
        .stderr(Stdio::piped())
        .stdout(Stdio::piped())
        .output()
        .map_err(|e| e.to_string())?;
    if out.status.success() {
        Ok(String::from_utf8_lossy(&out.stdout)
            .trim_end_matches(['\r', '\n'])
            .to_string())
    } else {
        Err(String::from_utf8_lossy(&out.stderr)
            .trim_end_matches(['\r', '\n'])
            .to_string())
    }
}

#[cfg(not(target_os = "windows"))]
pub(crate) fn run_native_shell_command(cwd: &str, script: &str) -> Result<String, String> {
    let (shell, flag) = resolve_unix_agent_shell();
    let mut cmd = Command::new(shell);
    cmd.arg(flag).arg(script);
    if !cwd.is_empty() {
        cmd.current_dir(cwd);
    }
    run_command_output(cmd)
}

pub(crate) fn run_wsl_shell_command(
    target: &ExecTarget,
    cwd: &str,
    script: &str,
) -> Result<String, String> {
    let mut cmd = Command::new("wsl.exe");
    apply_windows_no_window(&mut cmd);
    if let ExecTarget::Wsl {
        distro: Some(distro),
    } = target
    {
        cmd.args(["-d", distro]);
    }
    let shell_cmd = if cwd.is_empty() {
        script.to_string()
    } else {
        format!("cd {} && {}", shell_escape(cwd), script)
    };
    cmd.args(["--", "/bin/sh", "-lc", &shell_cmd]);
    run_command_output(cmd)
}

pub(crate) fn parse_command_binary(command: &str) -> Option<String> {
    let trimmed = command.trim();
    if trimmed.is_empty() {
        return None;
    }

    let mut token = String::new();
    let mut in_single = false;
    let mut in_double = false;
    let mut escaped = false;

    for ch in trimmed.chars() {
        if escaped {
            token.push(ch);
            escaped = false;
            continue;
        }

        match ch {
            '\\' if !in_single => {
                escaped = true;
            }
            '\'' if !in_double => {
                in_single = !in_single;
            }
            '"' if !in_single => {
                in_double = !in_double;
            }
            ch if ch.is_whitespace() && !in_single && !in_double => {
                if !token.is_empty() {
                    break;
                }
            }
            _ => token.push(ch),
        }
    }

    let normalized = token.trim();
    if normalized.is_empty() {
        None
    } else {
        Some(normalized.to_string())
    }
}

pub(crate) fn command_uses_explicit_path(command: &str) -> bool {
    command.contains(std::path::MAIN_SEPARATOR)
        || command.contains('/')
        || command.contains('\\')
        || command.starts_with('.')
}

#[cfg(target_os = "windows")]
pub(crate) fn probe_native_command(
    command_name: &str,
    cwd: Option<&str>,
) -> Result<String, String> {
    if command_uses_explicit_path(command_name) {
        let candidate = PathBuf::from(command_name);
        let resolved = if candidate.is_absolute() {
            candidate
        } else if let Some(base) = cwd.filter(|value| !value.is_empty()) {
            PathBuf::from(base).join(candidate)
        } else {
            std::env::current_dir()
                .map_err(|e| e.to_string())?
                .join(candidate)
        };
        if resolved.exists() {
            return Ok(resolved.to_string_lossy().to_string());
        }
        return Err(format!("`{command_name}` was not found"));
    }

    let mut cmd = Command::new("cmd");
    apply_windows_no_window(&mut cmd);
    cmd.args(["/C", "where", command_name]);
    if let Some(base) = cwd.filter(|value| !value.is_empty()) {
        cmd.current_dir(base);
    }
    let output = run_command_output(cmd)?;
    output
        .lines()
        .find(|line| !line.trim().is_empty())
        .map(|line| line.trim().to_string())
        .ok_or_else(|| format!("`{command_name}` was not found in PATH"))
}

#[cfg(not(target_os = "windows"))]
pub(crate) fn probe_native_command(
    command_name: &str,
    cwd: Option<&str>,
) -> Result<String, String> {
    if command_uses_explicit_path(command_name) {
        let candidate = PathBuf::from(command_name);
        let resolved = if candidate.is_absolute() {
            candidate
        } else if let Some(base) = cwd.filter(|value| !value.is_empty()) {
            PathBuf::from(base).join(candidate)
        } else {
            std::env::current_dir()
                .map_err(|e| e.to_string())?
                .join(candidate)
        };
        if resolved.exists() {
            return Ok(resolved.to_string_lossy().to_string());
        }
        return Err(format!("`{command_name}` was not found"));
    }

    run_native_shell_command(
        cwd.unwrap_or_default(),
        &format!("command -v {}", shell_escape(command_name)),
    )
}

pub(crate) fn probe_wsl_command(
    command_name: &str,
    target: &ExecTarget,
    cwd: Option<&str>,
) -> Result<String, String> {
    if command_uses_explicit_path(command_name) {
        let script = format!(
            "base_dir={cwd}; candidate={candidate}; if [ -e \"$candidate\" ]; then printf '%s' \"$candidate\"; elif [ -n \"$base_dir\" ] && [ -e \"$base_dir/$candidate\" ]; then printf '%s' \"$base_dir/$candidate\"; else exit 1; fi",
            candidate = shell_escape(command_name),
            cwd = shell_escape(cwd.unwrap_or_default())
        );
        return run_wsl_shell_command(target, "", &script);
    }

    run_wsl_shell_command(
        target,
        cwd.unwrap_or_default(),
        &format!("command -v {}", shell_escape(command_name)),
    )
}

pub(crate) fn build_agent_shell_command(cwd: &str, command: &str, windows: bool) -> String {
    if cwd.is_empty() {
        return command.to_string();
    }
    if windows {
        format!("cd /d {} && {}", shell_escape_windows(cwd), command)
    } else {
        format!("cd {} && {}", shell_escape(cwd), command)
    }
}

#[cfg(not(target_os = "windows"))]
fn locale_uses_utf8(value: &str) -> bool {
    let normalized = value.trim().to_ascii_lowercase();
    normalized.contains("utf-8") || normalized.contains("utf8")
}

#[cfg(not(target_os = "windows"))]
fn platform_utf8_locale_fallback() -> Option<&'static str> {
    #[cfg(target_os = "linux")]
    {
        return Some("C.UTF-8");
    }

    #[cfg(target_os = "macos")]
    {
        return Some("en_US.UTF-8");
    }

    #[allow(unreachable_code)]
    None
}

#[cfg(not(target_os = "windows"))]
fn resolve_utf8_locale() -> Option<String> {
    for key in ["LC_ALL", "LC_CTYPE", "LANG"] {
        if let Ok(value) = std::env::var(key) {
            let trimmed = value.trim();
            if !trimmed.is_empty() && locale_uses_utf8(trimmed) {
                return Some(trimmed.to_string());
            }
        }
    }

    platform_utf8_locale_fallback().map(str::to_string)
}

#[cfg(not(target_os = "windows"))]
fn resolve_unix_shell_path() -> String {
    if let Ok(shell) = std::env::var("SHELL") {
        let trimmed = shell.trim();
        if !trimmed.is_empty() {
            return trimmed.to_string();
        }
    }

    let bash = Path::new("/bin/bash");
    if bash.exists() {
        return bash.to_string_lossy().to_string();
    }

    "/bin/sh".to_string()
}

#[cfg(not(target_os = "windows"))]
pub(crate) fn apply_unix_pty_env_defaults(cmd: &mut CommandBuilder, shell_path: Option<&str>) {
    cmd.env("TERM", "xterm-256color");
    cmd.env("COLORTERM", "truecolor");

    if let Some(locale) = resolve_utf8_locale() {
        cmd.env("LC_CTYPE", locale.clone());

        let lang = std::env::var("LANG").unwrap_or_default();
        if lang.trim().is_empty() || !locale_uses_utf8(&lang) {
            cmd.env("LANG", locale);
        }
    }

    if let Some(shell) = shell_path.map(str::trim).filter(|value| !value.is_empty()) {
        cmd.env("SHELL", shell);
    }
}

#[cfg(not(target_os = "windows"))]
pub(crate) fn resolve_unix_agent_shell() -> (String, String) {
    let shell = resolve_unix_shell_path();
    let shell_name = Path::new(&shell)
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("sh")
        .to_ascii_lowercase();
    let flag = if shell_name == "sh" || shell_name == "dash" {
        "-lc".to_string()
    } else {
        "-ic".to_string()
    };
    (shell, flag)
}

#[cfg_attr(not(target_os = "windows"), allow(dead_code))]
pub(crate) fn build_windows_native_agent_shell_invocation(command: &str) -> (String, Vec<String>) {
    (
        "cmd".to_string(),
        vec![
            "/D".to_string(),
            "/S".to_string(),
            "/C".to_string(),
            command.to_string(),
        ],
    )
}

pub(crate) fn build_agent_pty_command(
    target: &ExecTarget,
    cwd: &str,
    command: &str,
) -> (String, Vec<String>) {
    if let ExecTarget::Wsl { distro } = target {
        let mut args = Vec::new();
        if let Some(d) = distro {
            args.push("-d".to_string());
            args.push(d.clone());
        }
        let shell_cmd = build_agent_shell_command(cwd, command, false);
        args.push("--".to_string());
        args.push("/bin/sh".to_string());
        args.push("-lc".to_string());
        args.push(shell_cmd);
        ("wsl.exe".to_string(), args)
    } else {
        #[cfg(target_os = "windows")]
        {
            let _ = cwd;
            build_windows_native_agent_shell_invocation(command)
        }
        #[cfg(not(target_os = "windows"))]
        {
            let shell_cmd = build_agent_shell_command(cwd, command, false);
            let (shell, flag) = resolve_unix_agent_shell();
            (shell, vec![flag, shell_cmd])
        }
    }
}

pub(crate) fn build_terminal_pty_command(target: &ExecTarget, cwd: &str) -> CommandBuilder {
    if let ExecTarget::Wsl { distro } = target {
        let mut cmd = CommandBuilder::new("wsl.exe");
        if let Some(d) = distro {
            cmd.arg("-d");
            cmd.arg(d);
        }
        let shell = "/bin/sh";
        let mut shell_cmd = String::new();
        if !cwd.is_empty() {
            shell_cmd.push_str("cd ");
            shell_cmd.push_str(&shell_escape(cwd));
            shell_cmd.push_str(" && ");
        }
        shell_cmd.push_str("TERM=xterm-256color exec ");
        shell_cmd.push_str(shell);
        cmd.arg("--");
        cmd.arg("/bin/sh");
        cmd.arg("-lc");
        cmd.arg(shell_cmd);
        cmd
    } else {
        #[cfg(target_os = "windows")]
        {
            let mut cmd = CommandBuilder::new("cmd");
            if !cwd.is_empty() {
                cmd.cwd(cwd);
            }
            cmd
        }
        #[cfg(not(target_os = "windows"))]
        {
            let shell = resolve_unix_shell_path();
            let mut cmd = CommandBuilder::new(shell.clone());
            if !cwd.is_empty() {
                cmd.cwd(cwd);
            }
            apply_unix_pty_env_defaults(&mut cmd, Some(&shell));
            cmd
        }
    }
}

pub(crate) fn resolve_target_path(path: &str, target: &ExecTarget) -> Result<String, String> {
    if matches!(target, ExecTarget::Wsl { .. }) && (path.contains(':') || path.contains('\\')) {
        let output = run_cmd(target, "", &["wslpath", "-a", path])?;
        return Ok(output.trim().to_string());
    }
    Ok(path.to_string())
}

#[cfg(target_os = "windows")]
fn resolve_native_agent_cwd_from_wsl(
    path: &str,
    workspace_target: &ExecTarget,
) -> Result<String, String> {
    let output = run_cmd(workspace_target, "", &["wslpath", "-w", path])?;
    let trimmed = output.trim();
    if trimmed.is_empty() {
        return Err("failed to resolve a Windows path for the WSL workspace".to_string());
    }
    Ok(trimmed.to_string())
}

#[cfg(not(target_os = "windows"))]
fn resolve_native_agent_cwd_from_wsl(
    _path: &str,
    _workspace_target: &ExecTarget,
) -> Result<String, String> {
    Err("current runtime cannot access a WSL workspace path directly".to_string())
}

pub(crate) fn resolve_agent_runtime_cwd(
    path: &str,
    workspace_target: &ExecTarget,
    agent_target: &ExecTarget,
) -> Result<String, String> {
    match (workspace_target, agent_target) {
        (ExecTarget::Wsl { .. }, ExecTarget::Native) => {
            resolve_native_agent_cwd_from_wsl(path, workspace_target)
        }
        _ => resolve_target_path(path, agent_target),
    }
}

pub(crate) fn resolve_git_repo_path(path: &str, target: &ExecTarget) -> Result<String, String> {
    let resolved = resolve_target_path(path, target)?;
    match run_cmd(target, &resolved, &["git", "rev-parse", "--show-toplevel"]) {
        Ok(root) if !root.trim().is_empty() => Ok(root.trim().to_string()),
        _ => Ok(resolved),
    }
}

pub(crate) fn temp_root(target: &ExecTarget) -> Result<String, String> {
    if matches!(target, ExecTarget::Wsl { .. }) {
        Ok("/tmp/coder-studio".to_string())
    } else {
        let root = std::env::temp_dir().join("coder-studio");
        std::fs::create_dir_all(&root).map_err(|e| e.to_string())?;
        Ok(root.to_string_lossy().to_string())
    }
}

pub(crate) fn repo_name_from_url(url: &str) -> String {
    let trimmed = url.trim().trim_end_matches('/');
    let name = trimmed.split('/').next_back().unwrap_or("repo");
    name.trim_end_matches(".git").to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn build_windows_native_agent_shell_invocation_avoids_cd_wrapper() {
        let command = r#"node D:\a\coder-studio\coder-studio\tests\e2e\fixtures\claude-lifecycle-agent.mjs --running-delay-ms 150"#;

        let (program, args) = build_windows_native_agent_shell_invocation(command);

        assert_eq!(program, "cmd");
        assert_eq!(
            args,
            vec![
                "/D".to_string(),
                "/S".to_string(),
                "/C".to_string(),
                command.to_string()
            ]
        );
        assert!(!args[3].contains("cd /d"));
    }
}
