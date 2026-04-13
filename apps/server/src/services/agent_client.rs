use crate::*;
use std::collections::BTreeMap;
use std::io::{Read, Write};
use std::process::{Child, Command, ExitStatus, Output, Stdio};
use std::time::{Duration, Instant};

const ONE_SHOT_PROMPT_MODE_KEY: &str = "CODER_STUDIO_ONE_SHOT_PROMPT_MODE";
const ONE_SHOT_PROMPT_ARG_PLACEHOLDER_KEY: &str = "CODER_STUDIO_ONE_SHOT_PROMPT_ARG_PLACEHOLDER";
const ONE_SHOT_PROMPT_ENV_KEY_KEY: &str = "CODER_STUDIO_ONE_SHOT_PROMPT_ENV_KEY";
const ONE_SHOT_TIMEOUT_MS_KEY: &str = "CODER_STUDIO_ONE_SHOT_TIMEOUT_MS";

const DEFAULT_ONE_SHOT_PROMPT_ARG_PLACEHOLDER: &str = "__CODER_STUDIO_PROMPT__";
const DEFAULT_ONE_SHOT_PROMPT_ENV_KEY: &str = "CODER_STUDIO_ONE_SHOT_PROMPT";
const DEFAULT_ONE_SHOT_TIMEOUT_MS: u64 = 30_000;

const ONE_SHOT_TIMEOUT_ERROR: &str = "one_shot_timeout";
const ONE_SHOT_COMMAND_NOT_FOUND_ERROR: &str = "one_shot_command_not_found";
const ONE_SHOT_NON_ZERO_EXIT_ERROR: &str = "one_shot_non_zero_exit";

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

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum OneShotPromptMode {
    Stdin,
    Arg,
    Env,
}

struct OneShotPromptConfig {
    mode: OneShotPromptMode,
    arg_placeholder: String,
    prompt_env_key: String,
    timeout: Duration,
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

    let prompt_config = resolve_prompt_config(launch_spec, runtime_env);
    match launch_spec {
        AgentLaunchSpec::ShellCommand(command) => {
            let command = match prompt_config.mode {
                OneShotPromptMode::Arg => inject_prompt_into_shell_command(
                    command,
                    prompt,
                    &prompt_config.arg_placeholder,
                ),
                _ => command.to_string(),
            };

            #[cfg(target_os = "windows")]
            {
                let mut cmd = Command::new("cmd");
                cmd.args(["/D", "/S", "/C", &command]);
                execute_one_shot_process(cmd, "cmd", cwd, runtime_env, prompt, &prompt_config)
            }

            #[cfg(not(target_os = "windows"))]
            {
                let mut cmd = Command::new("/bin/sh");
                cmd.args(["-lc", &command]);
                execute_one_shot_process(cmd, "/bin/sh", cwd, runtime_env, prompt, &prompt_config)
            }
        }
        AgentLaunchSpec::Direct { program, args, .. } => {
            let args = match prompt_config.mode {
                OneShotPromptMode::Arg => {
                    inject_prompt_into_direct_args(args, prompt, &prompt_config.arg_placeholder)
                }
                _ => args.clone(),
            };
            let mut cmd = Command::new(program);
            cmd.args(args);
            execute_one_shot_process(cmd, program, cwd, runtime_env, prompt, &prompt_config)
        }
    }
}

fn execute_one_shot_process(
    mut cmd: Command,
    command_label: &str,
    cwd: &str,
    runtime_env: &BTreeMap<String, String>,
    prompt: &str,
    prompt_config: &OneShotPromptConfig,
) -> Result<String, String> {
    if !cwd.is_empty() {
        cmd.current_dir(cwd);
    }
    for (key, value) in runtime_env {
        cmd.env(key, value);
    }
    if matches!(prompt_config.mode, OneShotPromptMode::Env) {
        cmd.env(&prompt_config.prompt_env_key, prompt);
    }
    cmd.stdin(Stdio::piped());
    cmd.stdout(Stdio::piped());
    cmd.stderr(Stdio::piped());

    let path_env = std::env::var("PATH").unwrap_or_default();
    eprintln!("[supervisor] run_one_shot: program={} args={:?} cwd={} PATH={}", 
        command_label, cmd.get_args().collect::<Vec<_>>(), cwd, path_env);
    eprintln!("[supervisor] run_one_shot: testing which codex...");
    let test_out = std::process::Command::new("/bin/sh")
        .args(["-lc", "which codex 2>&1"])
        .env("PATH", &path_env)
        .output();
    if let Ok(out) = test_out {
        eprintln!("[supervisor] which codex via sh: stdout={} stderr={}", 
            String::from_utf8_lossy(&out.stdout), String::from_utf8_lossy(&out.stderr));
    } else {
        eprintln!("[supervisor] which codex via sh failed: {:?}", test_out.err());
    }
    let mut child = cmd
        .spawn()
        .map_err(|error| classify_spawn_error(command_label, error))?;
    let stdout_reader = spawn_pipe_reader(child.stdout.take());
    let stderr_reader = spawn_pipe_reader(child.stderr.take());
    if matches!(prompt_config.mode, OneShotPromptMode::Stdin) {
        if let Some(mut stdin) = child.stdin.take() {
            stdin
                .write_all(prompt.as_bytes())
                .map_err(|error| format!("one_shot_stdin_write_failed:{error}"))?;
        }
    } else {
        drop(child.stdin.take());
    }

    let output =
        wait_with_hard_timeout(child, prompt_config.timeout, stdout_reader, stderr_reader)?;
    format_process_result(output)
}

fn wait_with_hard_timeout(
    mut child: Child,
    timeout: Duration,
    stdout_reader: std::thread::JoinHandle<Vec<u8>>,
    stderr_reader: std::thread::JoinHandle<Vec<u8>>,
) -> Result<Output, String> {
    let started_at = Instant::now();
    loop {
        match child.try_wait() {
            Ok(Some(status)) => {
                return Ok(Output {
                    status,
                    stdout: join_pipe_reader(stdout_reader)?,
                    stderr: join_pipe_reader(stderr_reader)?,
                });
            }
            Ok(None) => {
                if started_at.elapsed() >= timeout {
                    if let Ok(Some(status)) = child.try_wait() {
                        return Ok(Output {
                            status,
                            stdout: join_pipe_reader(stdout_reader)?,
                            stderr: join_pipe_reader(stderr_reader)?,
                        });
                    }
                    let _ = child.kill();
                    let _ = child.wait();
                    let _ = join_pipe_reader(stdout_reader);
                    let _ = join_pipe_reader(stderr_reader);
                    return Err(ONE_SHOT_TIMEOUT_ERROR.to_string());
                }
                std::thread::sleep(Duration::from_millis(20));
            }
            Err(error) => {
                let _ = join_pipe_reader(stdout_reader);
                let _ = join_pipe_reader(stderr_reader);
                return Err(format!("one_shot_wait_failed:{error}"));
            }
        }
    }
}

fn spawn_pipe_reader(pipe: Option<impl Read + Send + 'static>) -> std::thread::JoinHandle<Vec<u8>> {
    std::thread::spawn(move || {
        let Some(mut pipe) = pipe else {
            return Vec::new();
        };
        let mut buf = Vec::new();
        let _ = pipe.read_to_end(&mut buf);
        buf
    })
}

fn join_pipe_reader(handle: std::thread::JoinHandle<Vec<u8>>) -> Result<Vec<u8>, String> {
    handle
        .join()
        .map_err(|_| "one_shot_pipe_join_failed".to_string())
}

fn format_process_result(output: Output) -> Result<String, String> {
    if output.status.success() {
        Ok(trim_process_output(&output.stdout))
    } else {
        Err(classify_non_zero_exit(output.status, &output.stderr))
    }
}

fn classify_spawn_error(command_label: &str, error: std::io::Error) -> String {
    if error.kind() == std::io::ErrorKind::NotFound {
        format!("{ONE_SHOT_COMMAND_NOT_FOUND_ERROR}:{command_label}")
    } else {
        format!("one_shot_spawn_failed:{error}")
    }
}

fn classify_non_zero_exit(status: ExitStatus, stderr: &[u8]) -> String {
    let stderr = trim_process_output(stderr);
    if is_command_not_found_exit(&status, &stderr) {
        if stderr.is_empty() {
            ONE_SHOT_COMMAND_NOT_FOUND_ERROR.to_string()
        } else {
            format!("{ONE_SHOT_COMMAND_NOT_FOUND_ERROR}:{stderr}")
        }
    } else {
        let code = status
            .code()
            .map(|value| value.to_string())
            .unwrap_or_else(|| "signal".to_string());
        if stderr.is_empty() {
            format!("{ONE_SHOT_NON_ZERO_EXIT_ERROR}:{code}")
        } else {
            format!("{ONE_SHOT_NON_ZERO_EXIT_ERROR}:{code}:{stderr}")
        }
    }
}

fn is_command_not_found_exit(status: &ExitStatus, stderr: &str) -> bool {
    if matches!(status.code(), Some(127) | Some(9009)) {
        return true;
    }
    let stderr_lower = stderr.to_ascii_lowercase();
    stderr_lower.contains("command not found")
        || stderr_lower.contains("not recognized as an internal or external command")
}

fn trim_process_output(bytes: &[u8]) -> String {
    String::from_utf8_lossy(bytes)
        .trim_end_matches(['\r', '\n'])
        .to_string()
}

fn resolve_prompt_config(
    launch_spec: &AgentLaunchSpec,
    runtime_env: &BTreeMap<String, String>,
) -> OneShotPromptConfig {
    let arg_placeholder = read_control_value(runtime_env, ONE_SHOT_PROMPT_ARG_PLACEHOLDER_KEY)
        .unwrap_or_else(|| DEFAULT_ONE_SHOT_PROMPT_ARG_PLACEHOLDER.to_string());
    let prompt_env_key = read_control_value(runtime_env, ONE_SHOT_PROMPT_ENV_KEY_KEY)
        .unwrap_or_else(|| DEFAULT_ONE_SHOT_PROMPT_ENV_KEY.to_string());
    let mode = resolve_prompt_mode(launch_spec, runtime_env, &arg_placeholder);
    let timeout = resolve_timeout(runtime_env);
    OneShotPromptConfig {
        mode,
        arg_placeholder,
        prompt_env_key,
        timeout,
    }
}

fn resolve_prompt_mode(
    launch_spec: &AgentLaunchSpec,
    runtime_env: &BTreeMap<String, String>,
    arg_placeholder: &str,
) -> OneShotPromptMode {
    if let Some(raw_mode) = read_control_value(runtime_env, ONE_SHOT_PROMPT_MODE_KEY) {
        return match raw_mode.to_ascii_lowercase().as_str() {
            "arg" | "args" => OneShotPromptMode::Arg,
            "env" => OneShotPromptMode::Env,
            _ => OneShotPromptMode::Stdin,
        };
    }
    if launch_spec_contains_placeholder(launch_spec, arg_placeholder) {
        OneShotPromptMode::Arg
    } else {
        OneShotPromptMode::Stdin
    }
}

fn resolve_timeout(runtime_env: &BTreeMap<String, String>) -> Duration {
    let timeout_ms = read_control_value(runtime_env, ONE_SHOT_TIMEOUT_MS_KEY)
        .and_then(|raw| raw.parse::<u64>().ok())
        .filter(|ms| *ms > 0)
        .unwrap_or(DEFAULT_ONE_SHOT_TIMEOUT_MS);
    Duration::from_millis(timeout_ms)
}

fn read_control_value(runtime_env: &BTreeMap<String, String>, key: &str) -> Option<String> {
    runtime_env
        .get(key)
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
}

fn launch_spec_contains_placeholder(launch_spec: &AgentLaunchSpec, placeholder: &str) -> bool {
    match launch_spec {
        AgentLaunchSpec::ShellCommand(command) => command.contains(placeholder),
        AgentLaunchSpec::Direct { args, .. } => {
            args.iter().any(|value| value.contains(placeholder))
        }
    }
}

fn inject_prompt_into_direct_args(args: &[String], prompt: &str, placeholder: &str) -> Vec<String> {
    let mut replaced = false;
    let mut injected = args
        .iter()
        .map(|value| {
            if value.contains(placeholder) {
                replaced = true;
                value.replace(placeholder, prompt)
            } else {
                value.clone()
            }
        })
        .collect::<Vec<_>>();
    if !replaced {
        injected.push(prompt.to_string());
    }
    injected
}

fn inject_prompt_into_shell_command(command: &str, prompt: &str, placeholder: &str) -> String {
    let escaped_prompt = host_shell_escape(prompt);
    if command.contains(placeholder) {
        command.replace(placeholder, &escaped_prompt)
    } else {
        format!("{command} {escaped_prompt}")
    }
}

#[cfg(target_os = "windows")]
fn host_shell_escape(value: &str) -> String {
    shell_escape_windows(value)
}

#[cfg(not(target_os = "windows"))]
fn host_shell_escape(value: &str) -> String {
    shell_escape(value)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::BTreeMap;

    fn direct_launch(program: &str, args: &[&str]) -> AgentLaunchSpec {
        AgentLaunchSpec::Direct {
            program: program.to_string(),
            args: args.iter().map(|arg| arg.to_string()).collect(),
            display_command: format!("{program} {}", args.join(" ")),
        }
    }

    fn empty_env() -> BTreeMap<String, String> {
        BTreeMap::new()
    }

    #[test]
    #[cfg(not(target_os = "windows"))]
    fn run_one_shot_prompt_keeps_stdin_mode_by_default() {
        std::env::remove_var("CODER_STUDIO_TEST_SUPERVISOR_REPLY");
        let launch = direct_launch("sh", &["-lc", "read -r line; printf '%s' \"$line\""]);
        let reply = run_one_shot_prompt(&launch, "", &empty_env(), "stdin prompt").unwrap();
        assert_eq!(reply, "stdin prompt");
    }

    #[test]
    #[cfg(not(target_os = "windows"))]
    fn run_one_shot_prompt_auto_injects_prompt_into_direct_args() {
        std::env::remove_var("CODER_STUDIO_TEST_SUPERVISOR_REPLY");
        let launch = direct_launch(
            "sh",
            &["-lc", "printf '%s' \"$1\"", "_", "__CODER_STUDIO_PROMPT__"],
        );
        let reply = run_one_shot_prompt(&launch, "", &empty_env(), "arg prompt").unwrap();
        assert_eq!(reply, "arg prompt");
    }

    #[test]
    #[cfg(not(target_os = "windows"))]
    fn run_one_shot_prompt_auto_injects_prompt_into_shell_command() {
        std::env::remove_var("CODER_STUDIO_TEST_SUPERVISOR_REPLY");
        let launch = AgentLaunchSpec::ShellCommand("printf '%s' __CODER_STUDIO_PROMPT__".into());
        let reply = run_one_shot_prompt(&launch, "", &empty_env(), "shell arg prompt").unwrap();
        assert_eq!(reply, "shell arg prompt");
    }

    #[test]
    #[cfg(not(target_os = "windows"))]
    fn run_one_shot_prompt_returns_timeout_error() {
        std::env::remove_var("CODER_STUDIO_TEST_SUPERVISOR_REPLY");
        let launch = direct_launch("sh", &["-lc", "sleep 2; printf done"]);
        let mut env = empty_env();
        env.insert(
            "CODER_STUDIO_ONE_SHOT_TIMEOUT_MS".to_string(),
            "100".to_string(),
        );
        let error = run_one_shot_prompt(&launch, "", &env, "ignored").expect_err("should timeout");
        assert_eq!(error, "one_shot_timeout");
    }

    #[test]
    fn run_one_shot_prompt_classifies_command_not_found() {
        std::env::remove_var("CODER_STUDIO_TEST_SUPERVISOR_REPLY");
        let launch = direct_launch("coder-studio-missing-binary", &["--version"]);
        let error =
            run_one_shot_prompt(&launch, "", &empty_env(), "ignored").expect_err("should fail");
        assert!(error.starts_with("one_shot_command_not_found:"));
    }

    #[test]
    #[cfg(not(target_os = "windows"))]
    fn run_one_shot_prompt_classifies_non_zero_exit_with_stderr() {
        std::env::remove_var("CODER_STUDIO_TEST_SUPERVISOR_REPLY");
        let launch = direct_launch("sh", &["-lc", "echo boom >&2; exit 7"]);
        let error =
            run_one_shot_prompt(&launch, "", &empty_env(), "ignored").expect_err("should fail");
        assert_eq!(error, "one_shot_non_zero_exit:7:boom");
    }
}
