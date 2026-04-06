use crate::*;
use std::collections::BTreeMap;
use std::io::Write;
use std::process::{Command, Stdio};

pub(crate) fn escape_agent_command_part(target: &ExecTarget, value: &str) -> String {
    if matches!(target, ExecTarget::Native) {
        #[cfg(target_os = "windows")]
        {
            return shell_escape_windows(value);
        }
    }
    shell_escape(value)
}

#[cfg_attr(not(target_os = "windows"), allow(dead_code))]
pub(crate) enum AgentLaunchSpec {
    ShellCommand(String),
    Direct {
        program: String,
        args: Vec<String>,
        display_command: String,
    },
}

pub(crate) fn run_one_shot_prompt(
    launch_spec: &AgentLaunchSpec,
    cwd: &str,
    runtime_env: &BTreeMap<String, String>,
    prompt: &str,
) -> Result<String, String> {
    #[cfg(test)]
    if let Ok(reply) = std::env::var("CODER_STUDIO_TEST_SUPERVISOR_REPLY") {
        return Ok(reply);
    }

    match launch_spec {
        AgentLaunchSpec::ShellCommand(command) => {
            #[cfg(target_os = "windows")]
            {
                let mut cmd = Command::new("cmd");
                cmd.args(["/D", "/S", "/C", command]);
                if !cwd.is_empty() {
                    cmd.current_dir(cwd);
                }
                for (key, value) in runtime_env {
                    cmd.env(key, value);
                }
                cmd.stdin(Stdio::piped());
                cmd.stdout(Stdio::piped());
                cmd.stderr(Stdio::piped());
                let mut child = cmd.spawn().map_err(|e| e.to_string())?;
                if let Some(mut stdin) = child.stdin.take() {
                    stdin
                        .write_all(prompt.as_bytes())
                        .map_err(|e| e.to_string())?;
                }
                let output = child.wait_with_output().map_err(|e| e.to_string())?;
                if output.status.success() {
                    Ok(String::from_utf8_lossy(&output.stdout)
                        .trim_end_matches(['\r', '\n'])
                        .to_string())
                } else {
                    Err(String::from_utf8_lossy(&output.stderr)
                        .trim_end_matches(['\r', '\n'])
                        .to_string())
                }
            }

            #[cfg(not(target_os = "windows"))]
            {
                let mut cmd = Command::new("/bin/sh");
                cmd.args(["-lc", command]);
                if !cwd.is_empty() {
                    cmd.current_dir(cwd);
                }
                for (key, value) in runtime_env {
                    cmd.env(key, value);
                }
                cmd.stdin(Stdio::piped());
                cmd.stdout(Stdio::piped());
                cmd.stderr(Stdio::piped());
                let mut child = cmd.spawn().map_err(|e| e.to_string())?;
                if let Some(mut stdin) = child.stdin.take() {
                    stdin
                        .write_all(prompt.as_bytes())
                        .map_err(|e| e.to_string())?;
                }
                let output = child.wait_with_output().map_err(|e| e.to_string())?;
                if output.status.success() {
                    Ok(String::from_utf8_lossy(&output.stdout)
                        .trim_end_matches(['\r', '\n'])
                        .to_string())
                } else {
                    Err(String::from_utf8_lossy(&output.stderr)
                        .trim_end_matches(['\r', '\n'])
                        .to_string())
                }
            }
        }
        AgentLaunchSpec::Direct { program, args, .. } => {
            let mut cmd = Command::new(program);
            cmd.args(args);
            if !cwd.is_empty() {
                cmd.current_dir(cwd);
            }
            for (key, value) in runtime_env {
                cmd.env(key, value);
            }
            cmd.stdin(Stdio::piped());
            cmd.stdout(Stdio::piped());
            cmd.stderr(Stdio::piped());
            let mut child = cmd.spawn().map_err(|e| e.to_string())?;
            if let Some(mut stdin) = child.stdin.take() {
                stdin
                    .write_all(prompt.as_bytes())
                    .map_err(|e| e.to_string())?;
            }
            let output = child.wait_with_output().map_err(|e| e.to_string())?;
            if output.status.success() {
                Ok(String::from_utf8_lossy(&output.stdout)
                    .trim_end_matches(['\r', '\n'])
                    .to_string())
            } else {
                Err(String::from_utf8_lossy(&output.stderr)
                    .trim_end_matches(['\r', '\n'])
                    .to_string())
            }
        }
    }
}
