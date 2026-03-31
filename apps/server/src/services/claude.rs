use crate::*;

#[derive(Deserialize)]
struct ClaudeHookEnvelope {
    workspace_id: String,
    session_id: String,
    payload: Value,
}

pub(crate) fn parse_http_endpoint(endpoint: &str) -> Option<(String, u16, String)> {
    let trimmed = endpoint.trim();
    let without_scheme = trimmed.strip_prefix("http://")?;
    let (host_port, path) = without_scheme
        .split_once('/')
        .unwrap_or((without_scheme, ""));
    let (host, port_raw) = host_port.rsplit_once(':')?;
    let port = port_raw.parse::<u16>().ok()?;
    Some((host.to_string(), port, format!("/{}", path)))
}

fn respond_http(mut stream: TcpStream, status: &str, body: &str) {
    let response = format!(
        "HTTP/1.1 {status}\r\nContent-Type: text/plain; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
        body.len()
    );
    let _ = stream.write_all(response.as_bytes());
    let _ = stream.flush();
}

pub(crate) fn resolve_claude_runtime_profile(
    settings: &AppSettingsPayload,
    _target: &ExecTarget,
) -> ClaudeRuntimeProfile {
    settings.claude.global.clone()
}

pub(crate) fn build_claude_start_command(
    target: &ExecTarget,
    profile: &ClaudeRuntimeProfile,
) -> String {
    let (program, args) = build_claude_start_invocation(profile);
    let mut parts = Vec::with_capacity(1 + args.len());
    parts.push(crate::services::agent_client::escape_agent_command_part(
        target, &program,
    ));
    parts.extend(
        args.iter()
            .map(|arg| crate::services::agent_client::escape_agent_command_part(target, arg)),
    );
    parts.join(" ")
}

pub(crate) fn build_claude_start_invocation(
    profile: &ClaudeRuntimeProfile,
) -> (String, Vec<String>) {
    let executable = profile.executable.trim();
    let program = if executable.is_empty() {
        "claude".to_string()
    } else {
        executable.to_string()
    };
    let args = profile
        .startup_args
        .iter()
        .map(|arg| arg.trim())
        .filter(|arg| !arg.is_empty())
        .map(ToString::to_string)
        .collect();
    (program, args)
}

pub(crate) fn build_claude_resume_invocation(
    profile: &ClaudeRuntimeProfile,
    resume_id: &str,
) -> (String, Vec<String>) {
    let (program, mut args) = build_claude_start_invocation(profile);
    let trimmed_resume_id = resume_id.trim();
    if !trimmed_resume_id.is_empty() {
        args.push("--resume".to_string());
        args.push(trimmed_resume_id.to_string());
    }
    (program, args)
}

pub(crate) fn build_claude_resume_launch_command(
    target: &ExecTarget,
    profile: &ClaudeRuntimeProfile,
    resume_id: &str,
) -> String {
    let (program, args) = build_claude_resume_invocation(profile, resume_id);
    let mut parts = Vec::with_capacity(1 + args.len());
    parts.push(crate::services::agent_client::escape_agent_command_part(
        target, &program,
    ));
    parts.extend(
        args.iter()
            .map(|arg| crate::services::agent_client::escape_agent_command_part(target, arg)),
    );
    parts.join(" ")
}

fn parse_http_json(stream: &TcpStream) -> Result<Value, String> {
    let cloned = stream.try_clone().map_err(|e| e.to_string())?;
    let mut reader = BufReader::new(cloned);

    let mut request_line = String::new();
    reader
        .read_line(&mut request_line)
        .map_err(|e| e.to_string())?;
    if !request_line.starts_with("POST ") {
        return Err("method_not_allowed".to_string());
    }

    let mut content_length = 0usize;
    loop {
        let mut line = String::new();
        reader.read_line(&mut line).map_err(|e| e.to_string())?;
        if line == "\r\n" || line.is_empty() {
            break;
        }
        if let Some((name, value)) = line.split_once(':') {
            if name.trim().eq_ignore_ascii_case("content-length") {
                content_length = value.trim().parse::<usize>().unwrap_or(0);
            }
        }
    }

    let mut body = vec![0u8; content_length];
    reader.read_exact(&mut body).map_err(|e| e.to_string())?;
    serde_json::from_slice::<Value>(&body).map_err(|e| e.to_string())
}

fn normalize_claude_lifecycle(payload: &Value) -> Option<(&'static str, String)> {
    let hook_event = payload.get("hook_event_name")?.as_str()?;
    let normalized = match hook_event {
        "SessionStart" => "session_started",
        "UserPromptSubmit" => "turn_waiting",
        "PreToolUse" => "tool_started",
        "PostToolUse" | "PostToolUseFailure" => "tool_finished",
        "Notification" => "approval_required",
        "Stop" => "turn_completed",
        "SessionEnd" => "session_ended",
        _ => return None,
    };
    Some((normalized, hook_event.to_string()))
}

fn handle_claude_hook_payload(app: &AppHandle, envelope: ClaudeHookEnvelope) {
    if let Some(claude_session_id) = envelope
        .payload
        .get("session_id")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(|value| value.to_string())
    {
        let state: State<AppState> = app.state();
        if let Ok(internal_session_id) = envelope.session_id.parse::<u64>() {
            let _ = set_session_resume_id(
                state,
                &envelope.workspace_id,
                internal_session_id,
                claude_session_id,
            );
        }
    }

    if let Some((kind, source_event)) = normalize_claude_lifecycle(&envelope.payload) {
        let data = serde_json::to_string(&envelope.payload).unwrap_or_default();
        emit_agent_lifecycle(
            app,
            &envelope.workspace_id,
            &envelope.session_id,
            kind,
            &source_event,
            &data,
        );
    }
}

pub(crate) fn start_claude_hook_receiver(app: &AppHandle) -> Result<(), String> {
    let listener = TcpListener::bind("127.0.0.1:0").map_err(|e| e.to_string())?;
    let endpoint = format!(
        "http://127.0.0.1:{}/claude-hook",
        listener.local_addr().map_err(|e| e.to_string())?.port()
    );

    {
        let state: State<AppState> = app.state();
        let mut guard = state.hook_endpoint.lock().map_err(|e| e.to_string())?;
        *guard = Some(endpoint);
    }

    let app_handle = app.clone();
    std::thread::spawn(move || {
        for incoming in listener.incoming() {
            let stream = match incoming {
                Ok(stream) => stream,
                Err(_) => continue,
            };
            let payload = parse_http_json(&stream);
            match payload {
                Ok(body) => {
                    if let Ok(envelope) = serde_json::from_value::<ClaudeHookEnvelope>(body) {
                        handle_claude_hook_payload(&app_handle, envelope);
                        respond_http(stream, "200 OK", "ok");
                    } else {
                        respond_http(stream, "400 Bad Request", "invalid_payload");
                    }
                }
                Err(err) if err == "method_not_allowed" => {
                    respond_http(stream, "405 Method Not Allowed", "method_not_allowed");
                }
                Err(_) => {
                    respond_http(stream, "400 Bad Request", "invalid_request");
                }
            }
        }
    });

    Ok(())
}

pub(crate) fn current_hook_endpoint(app: &AppHandle) -> Result<String, String> {
    let state: State<AppState> = app.state();
    let guard = state.hook_endpoint.lock().map_err(|e| e.to_string())?;
    guard.clone().ok_or("hook_endpoint_not_ready".to_string())
}

fn build_claude_hook_command(target: &ExecTarget) -> String {
    if matches!(target, ExecTarget::Wsl { .. }) {
        "\"$CODER_STUDIO_APP_BIN\" --coder-studio-claude-hook".to_string()
    } else {
        #[cfg(target_os = "windows")]
        {
            "\"%CODER_STUDIO_APP_BIN%\" --coder-studio-claude-hook".to_string()
        }
        #[cfg(not(target_os = "windows"))]
        {
            "\"$CODER_STUDIO_APP_BIN\" --coder-studio-claude-hook".to_string()
        }
    }
}

fn is_coder_studio_hook_group(group: &Value) -> bool {
    group
        .get("hooks")
        .and_then(Value::as_array)
        .map(|hooks| {
            hooks.iter().any(|hook| {
                hook.get("type").and_then(Value::as_str) == Some("command")
                    && hook
                        .get("command")
                        .and_then(Value::as_str)
                        .map(|command| command.contains("--coder-studio-claude-hook"))
                        .unwrap_or(false)
            })
        })
        .unwrap_or(false)
}

fn build_hook_group(command: &str, matcher: Option<&str>) -> Value {
    let mut group = Map::new();
    if let Some(value) = matcher {
        group.insert("matcher".to_string(), Value::String(value.to_string()));
    }
    group.insert(
        "hooks".to_string(),
        Value::Array(vec![json!({
            "type": "command",
            "command": command
        })]),
    );
    Value::Object(group)
}

fn upsert_hook_groups(
    hooks_root: &mut Map<String, Value>,
    event_name: &str,
    matcher: Option<&str>,
    command: &str,
) {
    let entry = hooks_root
        .entry(event_name.to_string())
        .or_insert_with(|| Value::Array(Vec::new()));
    if !entry.is_array() {
        *entry = Value::Array(Vec::new());
    }
    let groups = entry.as_array_mut().expect("array");
    groups.retain(|group| !is_coder_studio_hook_group(group));
    groups.push(build_hook_group(command, matcher));
}

pub(crate) fn ensure_claude_hook_settings(cwd: &str, target: &ExecTarget) -> Result<(), String> {
    let current = if matches!(target, ExecTarget::Wsl { .. }) {
        run_cmd(
            target,
            cwd,
            &[
                "/bin/sh",
                "-lc",
                "if [ -f .claude/settings.local.json ]; then cat .claude/settings.local.json; else printf '{}'; fi",
            ],
        )
        .unwrap_or_else(|_| "{}".to_string())
    } else {
        let settings_path = PathBuf::from(cwd)
            .join(".claude")
            .join("settings.local.json");
        if settings_path.exists() {
            std::fs::read_to_string(&settings_path).map_err(|e| e.to_string())?
        } else {
            "{}".to_string()
        }
    };

    let mut root =
        serde_json::from_str::<Value>(&current).unwrap_or_else(|_| Value::Object(Map::new()));
    if !root.is_object() {
        root = Value::Object(Map::new());
    }
    let root_obj = root.as_object_mut().expect("object");
    let hooks_value = root_obj
        .entry("hooks".to_string())
        .or_insert_with(|| Value::Object(Map::new()));
    if !hooks_value.is_object() {
        *hooks_value = Value::Object(Map::new());
    }
    let hooks_obj = hooks_value.as_object_mut().expect("object");
    let command = build_claude_hook_command(target);

    upsert_hook_groups(hooks_obj, "SessionStart", Some(".*"), &command);
    upsert_hook_groups(hooks_obj, "UserPromptSubmit", None, &command);
    upsert_hook_groups(hooks_obj, "PreToolUse", Some(".*"), &command);
    upsert_hook_groups(hooks_obj, "PostToolUse", Some(".*"), &command);
    upsert_hook_groups(
        hooks_obj,
        "Notification",
        Some("permission_prompt"),
        &command,
    );
    upsert_hook_groups(hooks_obj, "Stop", None, &command);
    upsert_hook_groups(hooks_obj, "SessionEnd", Some(".*"), &command);

    let serialized = serde_json::to_string_pretty(&root).map_err(|e| e.to_string())?;
    if matches!(target, ExecTarget::Wsl { .. }) {
        let script = format!(
            "mkdir -p .claude && printf %s {} > .claude/settings.local.json",
            shell_escape(&serialized)
        );
        run_cmd(target, cwd, &["/bin/sh", "-lc", &script]).map(|_| ())
    } else {
        let settings_dir = PathBuf::from(cwd).join(".claude");
        std::fs::create_dir_all(&settings_dir).map_err(|e| e.to_string())?;
        let settings_path = settings_dir.join("settings.local.json");
        std::fs::write(settings_path, serialized).map_err(|e| e.to_string())
    }
}

pub(crate) fn current_app_bin_for_target(target: &ExecTarget) -> Result<String, String> {
    let current = std::env::current_exe().map_err(|e| e.to_string())?;
    let raw = current.to_string_lossy().to_string();
    resolve_target_path(&raw, target)
}

pub(crate) fn run_claude_hook_helper() {
    let _ = (|| -> Result<(), String> {
        let endpoint = std::env::var("CODER_STUDIO_HOOK_ENDPOINT").map_err(|e| e.to_string())?;
        let workspace_id = std::env::var("CODER_STUDIO_WORKSPACE_ID").map_err(|e| e.to_string())?;
        let session_id = std::env::var("CODER_STUDIO_SESSION_ID").map_err(|e| e.to_string())?;
        let (host, port, path) = parse_http_endpoint(&endpoint).ok_or("invalid_hook_endpoint")?;

        let mut stdin = String::new();
        std::io::stdin()
            .read_to_string(&mut stdin)
            .map_err(|e| e.to_string())?;
        let payload = serde_json::from_str::<Value>(&stdin).map_err(|e| e.to_string())?;
        let body = json!({
            "workspace_id": workspace_id,
            "session_id": session_id,
            "payload": payload
        })
        .to_string();

        let mut stream = TcpStream::connect((host.as_str(), port)).map_err(|e| e.to_string())?;
        let request = format!(
            "POST {path} HTTP/1.1\r\nHost: {host}:{port}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
            body.len()
        );
        stream
            .write_all(request.as_bytes())
            .map_err(|e| e.to_string())?;
        stream.flush().map_err(|e| e.to_string())?;
        Ok(())
    })();
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::BTreeMap;

    #[test]
    fn resolve_claude_runtime_profile_ignores_workspace_target() {
        let settings = AppSettingsPayload {
            general: GeneralSettingsPayload {
                locale: "en".into(),
                terminal_compatibility_mode: "standard".into(),
                completion_notifications: CompletionNotificationSettings {
                    enabled: true,
                    only_when_background: true,
                },
                idle_policy: default_idle_policy(),
            },
            agent_defaults: AgentDefaultsPayload::default(),
            claude: ClaudeSettingsPayload {
                global: ClaudeRuntimeProfile {
                    executable: "claude-current".into(),
                    startup_args: vec!["--verbose".into()],
                    env: BTreeMap::new(),
                    settings_json: json!({ "model": "sonnet" }),
                    global_config_json: json!({}),
                },
            },
            codex: CodexSettingsPayload::default(),
        };

        let native = resolve_claude_runtime_profile(&settings, &ExecTarget::Native);
        let wsl = resolve_claude_runtime_profile(
            &settings,
            &ExecTarget::Wsl {
                distro: Some("Ubuntu".into()),
            },
        );

        assert_eq!(native, wsl);
        assert_eq!(native.executable, "claude-current");
        assert_eq!(native.startup_args, vec!["--verbose"]);
        assert_eq!(native.settings_json["model"], "sonnet");
    }

    #[test]
    fn build_claude_commands_split_start_and_resume() {
        let profile = ClaudeRuntimeProfile {
            executable: "claude".into(),
            startup_args: vec!["--model".into(), "claude-sonnet-4-5".into()],
            env: BTreeMap::new(),
            settings_json: Value::Object(Map::new()),
            global_config_json: Value::Object(Map::new()),
        };

        assert_eq!(
            build_claude_start_command(&ExecTarget::Native, &profile),
            "claude --model claude-sonnet-4-5"
        );
        assert_eq!(
            build_claude_resume_launch_command(&ExecTarget::Native, &profile, "resume-123"),
            "claude --model claude-sonnet-4-5 --resume resume-123"
        );
    }

    #[test]
    fn build_claude_invocations_split_program_and_args() {
        let profile = ClaudeRuntimeProfile {
            executable: "claude".into(),
            startup_args: vec!["--model".into(), "claude-sonnet-4-5".into()],
            env: BTreeMap::new(),
            settings_json: Value::Object(Map::new()),
            global_config_json: Value::Object(Map::new()),
        };

        assert_eq!(
            build_claude_start_invocation(&profile),
            (
                "claude".to_string(),
                vec!["--model".to_string(), "claude-sonnet-4-5".to_string()],
            )
        );
        assert_eq!(
            build_claude_resume_invocation(&profile, "resume-123"),
            (
                "claude".to_string(),
                vec![
                    "--model".to_string(),
                    "claude-sonnet-4-5".to_string(),
                    "--resume".to_string(),
                    "resume-123".to_string(),
                ],
            )
        );
    }
}
