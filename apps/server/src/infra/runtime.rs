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

pub(crate) fn run_cmd(target: &ExecTarget, cwd: &str, args: &[&str]) -> Result<String, String> {
    let mut cmd = if let ExecTarget::Wsl { distro } = target {
        let mut c = Command::new("wsl.exe");
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
    if let ExecTarget::Wsl { distro } = target {
        if let Some(d) = distro {
            cmd.args(["-d", d]);
        }
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
pub(crate) fn resolve_unix_agent_shell() -> (String, String) {
    let shell = std::env::var("SHELL")
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| "/bin/sh".to_string());
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

pub(crate) fn build_claude_resume_command(
    command: &str,
    claude_session_id: Option<&str>,
) -> String {
    let Some(claude_session_id) = claude_session_id
        .map(str::trim)
        .filter(|value| !value.is_empty())
    else {
        return command.to_string();
    };

    if command.contains("--resume") || command.contains(" -r ") {
        return command.to_string();
    }

    format!("{command} --resume {claude_session_id}")
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
            let shell_cmd = build_agent_shell_command(cwd, command, true);
            ("cmd".to_string(), vec!["/C".to_string(), shell_cmd])
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
            let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/sh".to_string());
            let mut cmd = CommandBuilder::new(shell);
            if !cwd.is_empty() {
                cmd.cwd(cwd);
            }
            cmd.env("TERM", "xterm-256color");
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
    let name = trimmed.split('/').last().unwrap_or("repo");
    name.trim_end_matches(".git").to_string()
}
