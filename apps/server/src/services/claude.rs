use crate::*;

pub(crate) struct ClaudeProviderAdapter;

static CLAUDE_PROVIDER_ADAPTER: ClaudeProviderAdapter = ClaudeProviderAdapter;

pub(crate) fn resolve_claude_runtime_profile(
    settings: &AppSettingsPayload,
    _target: &ExecTarget,
) -> ClaudeRuntimeProfile {
    settings
        .providers
        .get("claude")
        .and_then(|payload| {
            serde_json::from_value::<ClaudeRuntimeProfile>(payload.global.clone()).ok()
        })
        .unwrap_or_default()
}

pub(crate) fn adapter() -> &'static dyn crate::services::provider_registry::ProviderAdapter {
    &CLAUDE_PROVIDER_ADAPTER
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

fn normalize_claude_lifecycle_event(payload: &Value) -> Option<AgentLifecycleEvent> {
    let (kind, source_event) = normalize_claude_lifecycle(payload)?;
    Some(AgentLifecycleEvent {
        workspace_id: String::new(),
        session_id: String::new(),
        kind: kind.to_string(),
        source_event,
        data: serde_json::to_string(payload).unwrap_or_default(),
    })
}

impl crate::services::provider_registry::ProviderAdapter for ClaudeProviderAdapter {
    fn id(&self) -> &'static str {
        "claude"
    }

    fn build_start(
        &self,
        settings: &AppSettingsPayload,
        target: &ExecTarget,
    ) -> Result<crate::services::provider_registry::ProviderLaunchConfig, String> {
        let profile = resolve_claude_runtime_profile(settings, target);
        let launch_spec = {
            #[cfg(target_os = "windows")]
            if matches!(target, ExecTarget::Native) {
                let (program, args) = build_claude_start_invocation(&profile);
                crate::services::agent_client::AgentLaunchSpec::Direct {
                    program,
                    args,
                    display_command: build_claude_start_command(target, &profile),
                }
            } else {
                crate::services::agent_client::AgentLaunchSpec::ShellCommand(
                    build_claude_start_command(target, &profile),
                )
            }

            #[cfg(not(target_os = "windows"))]
            {
                crate::services::agent_client::AgentLaunchSpec::ShellCommand(
                    build_claude_start_command(target, &profile),
                )
            }
        };
        Ok(crate::services::provider_registry::ProviderLaunchConfig {
            launch_spec,
            runtime_env: profile.env,
        })
    }

    fn build_resume(
        &self,
        settings: &AppSettingsPayload,
        target: &ExecTarget,
        resume_id: &str,
    ) -> Result<crate::services::provider_registry::ProviderLaunchConfig, String> {
        let profile = resolve_claude_runtime_profile(settings, target);
        let launch_spec = {
            #[cfg(target_os = "windows")]
            if matches!(target, ExecTarget::Native) {
                let (program, args) = build_claude_resume_invocation(&profile, resume_id);
                crate::services::agent_client::AgentLaunchSpec::Direct {
                    program,
                    args,
                    display_command: build_claude_resume_launch_command(
                        target, &profile, resume_id,
                    ),
                }
            } else {
                crate::services::agent_client::AgentLaunchSpec::ShellCommand(
                    build_claude_resume_launch_command(target, &profile, resume_id),
                )
            }

            #[cfg(not(target_os = "windows"))]
            {
                crate::services::agent_client::AgentLaunchSpec::ShellCommand(
                    build_claude_resume_launch_command(target, &profile, resume_id),
                )
            }
        };
        Ok(crate::services::provider_registry::ProviderLaunchConfig {
            launch_spec,
            runtime_env: profile.env,
        })
    }

    fn ensure_workspace_integration(&self, cwd: &str, target: &ExecTarget) -> Result<(), String> {
        ensure_claude_hook_settings(cwd, target)
    }

    fn normalize_hook_payload(&self, payload: &Value) -> Option<AgentLifecycleEvent> {
        normalize_claude_lifecycle_event(payload)
    }

    fn extract_resume_id(&self, payload: &Value) -> Option<String> {
        payload
            .get("session_id")
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(ToString::to_string)
    }
}

fn build_claude_hook_command(target: &ExecTarget) -> String {
    crate::services::provider_hooks::build_shared_hook_command(target)
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
                        .map(|command| {
                            command.contains("--coder-studio-agent-hook")
                                || command.contains("--coder-studio-claude-hook")
                        })
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

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::BTreeMap;

    #[test]
    fn resolve_claude_runtime_profile_ignores_workspace_target() {
        let mut settings = AppSettingsPayload::default();
        settings
            .set_provider_profile(
                "claude",
                &ClaudeRuntimeProfile {
                    executable: "claude-current".into(),
                    startup_args: vec!["--verbose".into()],
                    env: BTreeMap::new(),
                    settings_json: json!({ "model": "sonnet" }),
                    global_config_json: json!({}),
                },
            )
            .unwrap();

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
