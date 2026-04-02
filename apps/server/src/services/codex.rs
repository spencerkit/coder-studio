use crate::*;

const CODEX_FIRST_SUBMIT_NEWLINE_DELAY_MS: u64 = 120;

pub(crate) struct CodexProviderAdapter;

static CODEX_PROVIDER_ADAPTER: CodexProviderAdapter = CodexProviderAdapter;

fn push_codex_config_override(parts: &mut Vec<String>, key: &str, value: &str) {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return;
    }
    parts.push("--config".to_string());
    parts.push(format!(
        "{key}={}",
        toml::Value::String(trimmed.to_string())
    ));
}

fn build_codex_config_override_args(profile: &CodexRuntimeProfile) -> Vec<String> {
    let mut parts = Vec::new();
    push_codex_config_override(&mut parts, "model", &profile.model);
    push_codex_config_override(&mut parts, "approval_policy", &profile.approval_policy);
    push_codex_config_override(&mut parts, "sandbox_mode", &profile.sandbox_mode);
    push_codex_config_override(&mut parts, "web_search", &profile.web_search);
    push_codex_config_override(
        &mut parts,
        "model_reasoning_effort",
        &profile.model_reasoning_effort,
    );
    parts
}

fn build_codex_feature_args() -> Vec<String> {
    Vec::new()
}

pub(crate) fn resolve_codex_runtime_profile(
    settings: &AppSettingsPayload,
    _target: &ExecTarget,
) -> CodexRuntimeProfile {
    settings
        .providers
        .get("codex")
        .and_then(|payload| {
            serde_json::from_value::<CodexRuntimeProfile>(payload.global.clone()).ok()
        })
        .unwrap_or_default()
}

pub(crate) fn adapter() -> &'static dyn crate::services::provider_registry::ProviderAdapter {
    &CODEX_PROVIDER_ADAPTER
}

pub(crate) fn build_codex_start_command(
    target: &ExecTarget,
    profile: &CodexRuntimeProfile,
) -> String {
    let (program, args) = build_codex_start_invocation(profile);
    let mut parts = vec![crate::services::agent_client::escape_agent_command_part(
        target, &program,
    )];
    parts.extend(
        args.iter()
            .map(|arg| crate::services::agent_client::escape_agent_command_part(target, arg)),
    );
    parts.join(" ")
}

pub(crate) fn build_codex_start_invocation(profile: &CodexRuntimeProfile) -> (String, Vec<String>) {
    let executable = profile.executable.trim();
    let program = if executable.is_empty() {
        "codex".to_string()
    } else {
        executable.to_string()
    };
    let mut args = profile
        .extra_args
        .iter()
        .map(|arg| arg.trim())
        .filter(|arg| !arg.is_empty())
        .map(ToString::to_string)
        .collect::<Vec<_>>();
    args.extend(build_codex_config_override_args(profile));
    args.extend(build_codex_feature_args());
    (program, args)
}

pub(crate) fn build_codex_resume_command(
    target: &ExecTarget,
    profile: &CodexRuntimeProfile,
    resume_id: &str,
) -> String {
    let (program, args) = build_codex_resume_invocation(profile, resume_id);
    let mut parts = vec![crate::services::agent_client::escape_agent_command_part(
        target, &program,
    )];
    parts.extend(
        args.iter()
            .map(|arg| crate::services::agent_client::escape_agent_command_part(target, arg)),
    );
    parts.join(" ")
}

pub(crate) fn build_codex_resume_invocation(
    profile: &CodexRuntimeProfile,
    resume_id: &str,
) -> (String, Vec<String>) {
    let executable = profile.executable.trim();
    let program = if executable.is_empty() {
        "codex".to_string()
    } else {
        executable.to_string()
    };
    let mut args = Vec::new();
    let trimmed_resume_id = resume_id.trim();
    if !trimmed_resume_id.is_empty() {
        args.push("resume".to_string());
        args.push(trimmed_resume_id.to_string());
    }
    args.extend(
        profile
            .extra_args
            .iter()
            .map(|arg| arg.trim())
            .filter(|arg| !arg.is_empty())
            .map(ToString::to_string),
    );
    args.extend(build_codex_config_override_args(profile));
    args.extend(build_codex_feature_args());
    (program, args)
}

fn normalize_codex_lifecycle(payload: &Value) -> Option<(&'static str, String)> {
    let hook_event = payload.get("hook_event_name")?.as_str()?;
    let normalized = match hook_event {
        "SessionStart" => "session_started",
        "UserPromptSubmit" => "turn_waiting",
        "PreToolUse" => "tool_started",
        "PostToolUse" | "PostToolUseFailure" => "tool_finished",
        "Stop" => "turn_completed",
        _ => return None,
    };
    Some((normalized, hook_event.to_string()))
}

fn normalize_codex_lifecycle_event(payload: &Value) -> Option<AgentLifecycleEvent> {
    let (kind, source_event) = normalize_codex_lifecycle(payload)?;
    Some(AgentLifecycleEvent {
        workspace_id: String::new(),
        session_id: String::new(),
        kind: kind.to_string(),
        source_event,
        data: payload.to_string(),
    })
}

impl crate::services::provider_registry::ProviderAdapter for CodexProviderAdapter {
    fn id(&self) -> &'static str {
        "codex"
    }

    fn build_start(
        &self,
        settings: &AppSettingsPayload,
        target: &ExecTarget,
    ) -> Result<crate::services::provider_registry::ProviderLaunchConfig, String> {
        let profile = resolve_codex_runtime_profile(settings, target);
        let launch_spec = {
            #[cfg(target_os = "windows")]
            if matches!(target, ExecTarget::Native) {
                let (program, args) = build_codex_start_invocation(&profile);
                crate::services::agent_client::AgentLaunchSpec::Direct {
                    program,
                    args,
                    display_command: build_codex_start_command(target, &profile),
                }
            } else {
                crate::services::agent_client::AgentLaunchSpec::ShellCommand(
                    build_codex_start_command(target, &profile),
                )
            }

            #[cfg(not(target_os = "windows"))]
            {
                crate::services::agent_client::AgentLaunchSpec::ShellCommand(
                    build_codex_start_command(target, &profile),
                )
            }
        };
        Ok(crate::services::provider_registry::ProviderLaunchConfig {
            launch_spec,
            runtime_env: profile.env,
            input_policy: crate::services::provider_registry::ProviderInputPolicy {
                first_submit_strategy:
                    crate::services::provider_registry::FirstSubmitStrategy::FlushThenDelayedNewline {
                        delay_ms: CODEX_FIRST_SUBMIT_NEWLINE_DELAY_MS,
                    },
            },
        })
    }

    fn build_resume(
        &self,
        settings: &AppSettingsPayload,
        target: &ExecTarget,
        resume_id: &str,
    ) -> Result<crate::services::provider_registry::ProviderLaunchConfig, String> {
        let profile = resolve_codex_runtime_profile(settings, target);
        let launch_spec = {
            #[cfg(target_os = "windows")]
            if matches!(target, ExecTarget::Native) {
                let (program, args) = build_codex_resume_invocation(&profile, resume_id);
                crate::services::agent_client::AgentLaunchSpec::Direct {
                    program,
                    args,
                    display_command: build_codex_resume_command(target, &profile, resume_id),
                }
            } else {
                crate::services::agent_client::AgentLaunchSpec::ShellCommand(
                    build_codex_resume_command(target, &profile, resume_id),
                )
            }

            #[cfg(not(target_os = "windows"))]
            {
                crate::services::agent_client::AgentLaunchSpec::ShellCommand(
                    build_codex_resume_command(target, &profile, resume_id),
                )
            }
        };
        Ok(crate::services::provider_registry::ProviderLaunchConfig {
            launch_spec,
            runtime_env: profile.env,
            input_policy: crate::services::provider_registry::ProviderInputPolicy {
                first_submit_strategy:
                    crate::services::provider_registry::FirstSubmitStrategy::FlushThenDelayedNewline {
                        delay_ms: CODEX_FIRST_SUBMIT_NEWLINE_DELAY_MS,
                    },
            },
        })
    }

    fn ensure_workspace_integration(&self, cwd: &str, target: &ExecTarget) -> Result<(), String> {
        ensure_codex_hook_settings(cwd, target)
    }

    fn normalize_hook_payload(&self, payload: &Value) -> Option<AgentLifecycleEvent> {
        normalize_codex_lifecycle_event(payload)
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

fn build_codex_hook_command(target: &ExecTarget) -> String {
    crate::services::provider_hooks::build_shared_hook_command(target)
}

fn is_coder_studio_codex_group(group: &Value) -> bool {
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
                                || command.contains("--coder-studio-codex-hook")
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
    groups.retain(|group| !is_coder_studio_codex_group(group));
    groups.push(build_hook_group(command, matcher));
}

pub(crate) fn ensure_codex_hook_settings(cwd: &str, target: &ExecTarget) -> Result<(), String> {
    let current = if matches!(target, ExecTarget::Wsl { .. }) {
        run_cmd(
            target,
            cwd,
            &[
                "/bin/sh",
                "-lc",
                "if [ -f .codex/hooks.json ]; then cat .codex/hooks.json; else printf '{}'; fi",
            ],
        )
        .unwrap_or_else(|_| "{}".to_string())
    } else {
        let hooks_path = PathBuf::from(cwd).join(".codex").join("hooks.json");
        if hooks_path.exists() {
            std::fs::read_to_string(&hooks_path).map_err(|e| e.to_string())?
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
    let command = build_codex_hook_command(target);

    upsert_hook_groups(hooks_obj, "SessionStart", Some("startup|resume"), &command);
    upsert_hook_groups(hooks_obj, "UserPromptSubmit", None, &command);
    upsert_hook_groups(hooks_obj, "PreToolUse", Some("Bash"), &command);
    upsert_hook_groups(hooks_obj, "PostToolUse", Some("Bash"), &command);
    upsert_hook_groups(hooks_obj, "Stop", None, &command);

    let serialized = serde_json::to_string_pretty(&root).map_err(|e| e.to_string())?;
    if matches!(target, ExecTarget::Wsl { .. }) {
        let script = format!(
            "mkdir -p .codex && printf %s {} > .codex/hooks.json",
            shell_escape(&serialized)
        );
        run_cmd(target, cwd, &["/bin/sh", "-lc", &script]).map(|_| ())
    } else {
        let hooks_dir = PathBuf::from(cwd).join(".codex");
        std::fs::create_dir_all(&hooks_dir).map_err(|e| e.to_string())?;
        let hooks_path = hooks_dir.join("hooks.json");
        std::fs::write(hooks_path, serialized).map_err(|e| e.to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::BTreeMap;

    #[test]
    fn resolve_codex_runtime_profile_ignores_workspace_target() {
        let mut settings = AppSettingsPayload::default();
        settings
            .set_provider_profile(
                "codex",
                &CodexRuntimeProfile {
                    executable: "codex-current".into(),
                    extra_args: vec!["--full-auto".into()],
                    model: "gpt-5.4".into(),
                    approval_policy: "on-request".into(),
                    sandbox_mode: "workspace-write".into(),
                    web_search: "live".into(),
                    model_reasoning_effort: "high".into(),
                    env: BTreeMap::from([("OPENAI_API_KEY".into(), "secret".into())]),
                },
            )
            .unwrap();

        let native = resolve_codex_runtime_profile(&settings, &ExecTarget::Native);
        let wsl = resolve_codex_runtime_profile(
            &settings,
            &ExecTarget::Wsl {
                distro: Some("Ubuntu".into()),
            },
        );

        assert_eq!(native, wsl);
        assert_eq!(native.executable, "codex-current");
        assert_eq!(native.extra_args, vec!["--full-auto"]);
        assert_eq!(native.model, "gpt-5.4");
        assert_eq!(native.approval_policy, "on-request");
        assert_eq!(native.sandbox_mode, "workspace-write");
        assert_eq!(native.web_search, "live");
        assert_eq!(native.model_reasoning_effort, "high");
        assert_eq!(
            native.env.get("OPENAI_API_KEY").map(String::as_str),
            Some("secret")
        );
    }

    #[test]
    fn build_codex_commands_split_start_and_resume() {
        let profile = CodexRuntimeProfile {
            executable: "codex".into(),
            extra_args: vec!["--full-auto".into()],
            model: String::new(),
            approval_policy: String::new(),
            sandbox_mode: String::new(),
            web_search: String::new(),
            model_reasoning_effort: String::new(),
            env: BTreeMap::new(),
        };

        assert_eq!(
            build_codex_start_command(&ExecTarget::Native, &profile),
            "codex --full-auto --enable codex_hooks"
        );
        assert_eq!(
            build_codex_resume_command(&ExecTarget::Native, &profile, "resume-123"),
            "codex resume resume-123 --full-auto --enable codex_hooks"
        );
    }

    fn expected_config_args(target: &ExecTarget, values: &[(&str, &str)]) -> String {
        values
            .iter()
            .flat_map(|(key, value)| {
                [
                    crate::services::agent_client::escape_agent_command_part(target, "--config"),
                    crate::services::agent_client::escape_agent_command_part(
                        target,
                        &format!("{key}={}", toml::Value::String((*value).to_string())),
                    ),
                ]
            })
            .collect::<Vec<_>>()
            .join(" ")
    }

    #[test]
    fn build_codex_commands_append_structured_config_overrides() {
        let target = ExecTarget::Native;
        let profile = CodexRuntimeProfile {
            executable: "codex".into(),
            extra_args: vec!["--full-auto".into()],
            model: "gpt-5.4".into(),
            approval_policy: "on-request".into(),
            sandbox_mode: "workspace-write".into(),
            web_search: "live".into(),
            model_reasoning_effort: "high".into(),
            env: BTreeMap::new(),
        };
        let expected_config = expected_config_args(
            &target,
            &[
                ("model", "gpt-5.4"),
                ("approval_policy", "on-request"),
                ("sandbox_mode", "workspace-write"),
                ("web_search", "live"),
                ("model_reasoning_effort", "high"),
            ],
        );

        assert_eq!(
            build_codex_start_command(&target, &profile),
            format!("codex --full-auto {expected_config} --enable codex_hooks")
        );
        assert_eq!(
            build_codex_resume_command(&target, &profile, "resume-123"),
            format!("codex resume resume-123 --full-auto {expected_config} --enable codex_hooks")
        );
    }

    #[test]
    fn build_codex_invocations_split_program_and_args() {
        let profile = CodexRuntimeProfile {
            executable: "codex".into(),
            extra_args: vec!["--full-auto".into()],
            model: "gpt-5.4".into(),
            approval_policy: "on-request".into(),
            sandbox_mode: "workspace-write".into(),
            web_search: "live".into(),
            model_reasoning_effort: "high".into(),
            env: BTreeMap::new(),
        };

        assert_eq!(
            build_codex_start_invocation(&profile),
            (
                "codex".to_string(),
                vec![
                    "--full-auto".to_string(),
                    "--config".to_string(),
                    "model=\"gpt-5.4\"".to_string(),
                    "--config".to_string(),
                    "approval_policy=\"on-request\"".to_string(),
                    "--config".to_string(),
                    "sandbox_mode=\"workspace-write\"".to_string(),
                    "--config".to_string(),
                    "web_search=\"live\"".to_string(),
                    "--config".to_string(),
                    "model_reasoning_effort=\"high\"".to_string(),
                    "--enable".to_string(),
                    "codex_hooks".to_string(),
                ],
            )
        );
        assert_eq!(
            build_codex_resume_invocation(&profile, "resume-123"),
            (
                "codex".to_string(),
                vec![
                    "resume".to_string(),
                    "resume-123".to_string(),
                    "--full-auto".to_string(),
                    "--config".to_string(),
                    "model=\"gpt-5.4\"".to_string(),
                    "--config".to_string(),
                    "approval_policy=\"on-request\"".to_string(),
                    "--config".to_string(),
                    "sandbox_mode=\"workspace-write\"".to_string(),
                    "--config".to_string(),
                    "web_search=\"live\"".to_string(),
                    "--config".to_string(),
                    "model_reasoning_effort=\"high\"".to_string(),
                    "--enable".to_string(),
                    "codex_hooks".to_string(),
                ],
            )
        );
    }
}
