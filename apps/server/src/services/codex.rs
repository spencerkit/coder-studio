use crate::*;

pub(crate) struct CodexProviderAdapter;

static CODEX_PROVIDER_ADAPTER: CodexProviderAdapter = CodexProviderAdapter;

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
            runtime_env: Default::default(),
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
            runtime_env: Default::default(),
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

fn native_codex_home_root() -> Option<PathBuf> {
    if let Some(root) = std::env::var_os("CODER_STUDIO_CODEX_HOME") {
        return Some(PathBuf::from(root));
    }

    #[cfg(target_os = "windows")]
    {
        std::env::var_os("USERPROFILE")
            .map(PathBuf::from)
            .or_else(|| {
                let drive = std::env::var_os("HOMEDRIVE")?;
                let path = std::env::var_os("HOMEPATH")?;
                Some(PathBuf::from(format!(
                    "{}{}",
                    PathBuf::from(drive).display(),
                    PathBuf::from(path).display()
                )))
            })
    }

    #[cfg(not(target_os = "windows"))]
    {
        std::env::var_os("HOME").map(PathBuf::from)
    }
}

fn upsert_codex_global_feature(root: &mut toml::Table, feature_name: &str) {
    let features_entry = root
        .entry("features".to_string())
        .or_insert_with(|| toml::Value::Table(toml::Table::new()));
    if !features_entry.is_table() {
        *features_entry = toml::Value::Table(toml::Table::new());
    }
    let features = features_entry.as_table_mut().expect("table");
    features.insert(feature_name.to_string(), toml::Value::Boolean(true));
}

fn ensure_codex_global_feature_settings(cwd: &str, target: &ExecTarget) -> Result<(), String> {
    let current = if matches!(target, ExecTarget::Wsl { .. }) {
        run_cmd(
            target,
            cwd,
            &[
                "/bin/sh",
                "-lc",
                "if [ -f ~/.codex/config.toml ]; then cat ~/.codex/config.toml; else printf ''; fi",
            ],
        )
        .unwrap_or_default()
    } else {
        let Some(root) = native_codex_home_root() else {
            return Ok(());
        };
        let config_path = root.join(".codex").join("config.toml");
        if config_path.exists() {
            std::fs::read_to_string(config_path).map_err(|e| e.to_string())?
        } else {
            String::new()
        }
    };

    let mut root = current.parse::<toml::Table>().unwrap_or_default();
    upsert_codex_global_feature(&mut root, "codex_hooks");
    let serialized = toml::to_string_pretty(&root).map_err(|e| e.to_string())?;

    if matches!(target, ExecTarget::Wsl { .. }) {
        let script = format!(
            "mkdir -p ~/.codex && printf %s {} > ~/.codex/config.toml",
            shell_escape(&serialized)
        );
        run_cmd(target, cwd, &["/bin/sh", "-lc", &script]).map(|_| ())
    } else {
        let Some(home_root) = native_codex_home_root() else {
            return Ok(());
        };
        let config_dir = home_root.join(".codex");
        std::fs::create_dir_all(&config_dir).map_err(|e| e.to_string())?;
        std::fs::write(config_dir.join("config.toml"), serialized).map_err(|e| e.to_string())
    }
}

pub(crate) fn ensure_codex_hook_settings(cwd: &str, target: &ExecTarget) -> Result<(), String> {
    ensure_codex_global_feature_settings(cwd, target)?;

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
    use std::fs;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn unique_temp_dir(prefix: &str) -> PathBuf {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("clock should move forward")
            .as_nanos();
        let path = std::env::temp_dir().join(format!(
            "coder-studio-{prefix}-{}-{nanos}",
            std::process::id()
        ));
        fs::create_dir_all(&path).expect("temp dir should be created");
        path
    }

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
                    api_key: "codex-key".into(),
                    base_url: "https://codex.example/v1".into(),
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
        assert_eq!(native.api_key, "codex-key");
        assert_eq!(native.base_url, "https://codex.example/v1");
    }

    #[test]
    fn codex_adapter_uses_immediate_newline_for_first_submit() {
        let launch = adapter()
            .build_start(&AppSettingsPayload::default(), &ExecTarget::Native)
            .expect("codex launch config");

        let display_command =
            crate::services::session_runtime::launch_spec_display_command(&launch.launch_spec);

        assert_eq!(display_command, "codex");
    }

    #[test]
    fn ensure_codex_hook_settings_enables_codex_hooks_globally() {
        let workspace_root = unique_temp_dir("codex-workspace");
        let codex_home = unique_temp_dir("codex-home");
        let config_dir = codex_home.join(".codex");
        fs::create_dir_all(&config_dir).unwrap();
        fs::write(
            config_dir.join("config.toml"),
            format!(
                "[projects.\"{}\"]\ntrust_level = \"trusted\"\n",
                workspace_root.display()
            ),
        )
        .unwrap();

        let previous = std::env::var_os("CODER_STUDIO_CODEX_HOME");
        std::env::set_var("CODER_STUDIO_CODEX_HOME", &codex_home);

        let result =
            ensure_codex_hook_settings(workspace_root.to_str().unwrap(), &ExecTarget::Native);

        if let Some(value) = previous {
            std::env::set_var("CODER_STUDIO_CODEX_HOME", value);
        } else {
            std::env::remove_var("CODER_STUDIO_CODEX_HOME");
        }

        result.unwrap();

        let raw = fs::read_to_string(config_dir.join("config.toml")).unwrap();
        let parsed = raw.parse::<toml::Table>().unwrap();
        assert_eq!(
            parsed
                .get("projects")
                .and_then(toml::Value::as_table)
                .and_then(|projects| projects.get(&workspace_root.display().to_string()))
                .and_then(toml::Value::as_table)
                .and_then(|project| project.get("trust_level"))
                .and_then(toml::Value::as_str),
            Some("trusted")
        );
        assert_eq!(
            parsed
                .get("features")
                .and_then(toml::Value::as_table)
                .and_then(|features| features.get("codex_hooks"))
                .and_then(toml::Value::as_bool),
            Some(true)
        );
        assert_eq!(
            parsed
                .get("projects")
                .and_then(toml::Value::as_table)
                .and_then(|projects| projects.get(&workspace_root.display().to_string()))
                .and_then(toml::Value::as_table)
                .and_then(|project| project.get("features")),
            None
        );

        let _ = fs::remove_dir_all(workspace_root);
        let _ = fs::remove_dir_all(codex_home);
    }

    #[test]
    fn build_codex_commands_split_start_and_resume() {
        let profile = CodexRuntimeProfile {
            executable: "codex".into(),
            extra_args: vec!["--full-auto".into()],
            model: String::new(),
            api_key: String::new(),
            base_url: String::new(),
        };

        assert_eq!(
            build_codex_start_command(&ExecTarget::Native, &profile),
            "codex --full-auto"
        );
        assert_eq!(
            build_codex_resume_command(&ExecTarget::Native, &profile, "resume-123"),
            "codex resume resume-123 --full-auto"
        );
    }

    #[test]
    fn build_codex_invocations_only_include_startup_args() {
        let profile = CodexRuntimeProfile {
            executable: "codex".into(),
            extra_args: vec!["--full-auto".into()],
            model: "gpt-5.4".into(),
            api_key: "codex-key".into(),
            base_url: "https://codex.example/v1".into(),
        };

        assert_eq!(
            build_codex_start_invocation(&profile),
            ("codex".to_string(), vec!["--full-auto".to_string()])
        );
        assert_eq!(
            build_codex_resume_invocation(&profile, "resume-123"),
            (
                "codex".to_string(),
                vec![
                    "resume".to_string(),
                    "resume-123".to_string(),
                    "--full-auto".to_string(),
                ],
            )
        );
    }
}
