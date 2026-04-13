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

pub(crate) fn build_claude_supervisor_invocation(
    profile: &ClaudeRuntimeProfile,
) -> (String, Vec<String>) {
    let (program, mut args) = build_claude_start_invocation(profile);
    if !args
        .iter()
        .any(|arg| matches!(arg.as_str(), "-p" | "--print"))
    {
        args.push("--print".to_string());
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

pub(crate) fn build_claude_supervisor_launch_command(
    target: &ExecTarget,
    profile: &ClaudeRuntimeProfile,
) -> String {
    let (program, args) = build_claude_supervisor_invocation(profile);
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
        "Stop" => "turn_completed",
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

    fn list_workspace_sessions(
        &self,
        workspace_path: &str,
    ) -> Result<Vec<ProviderWorkspaceSession>, String> {
        list_claude_workspace_sessions(workspace_path)
    }

    fn session_exists(&self, workspace_path: &str, resume_id: &str) -> Result<bool, String> {
        Ok(claude_transcript_path(workspace_path, resume_id)
            .map(|path| path.exists())
            .unwrap_or(false))
    }

    fn delete_workspace_session(
        &self,
        workspace_path: &str,
        resume_id: &str,
    ) -> Result<(), String> {
        delete_claude_workspace_session(workspace_path, resume_id)
    }

    fn build_start(
        &self,
        settings: &AppSettingsPayload,
        target: &ExecTarget,
    ) -> Result<crate::services::provider_registry::ProviderLaunchConfig, String> {
        let profile = resolve_claude_runtime_profile(settings, target);
        let (program, args) = build_claude_start_invocation(&profile);
        let launch_spec = crate::services::agent_client::AgentLaunchSpec::Direct {
            program,
            args,
            display_command: build_claude_start_command(target, &profile),
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
        let (program, args) = build_claude_resume_invocation(&profile, resume_id);
        let launch_spec = crate::services::agent_client::AgentLaunchSpec::Direct {
            program,
            args,
            display_command: build_claude_resume_launch_command(target, &profile, resume_id),
        };
        Ok(crate::services::provider_registry::ProviderLaunchConfig {
            launch_spec,
            runtime_env: profile.env,
        })
    }

    fn build_supervisor_invoke(
        &self,
        settings: &AppSettingsPayload,
        target: &ExecTarget,
    ) -> Result<crate::services::provider_registry::ProviderLaunchConfig, String> {
        let profile = resolve_claude_runtime_profile(settings, target);
        let (program, args) = build_claude_supervisor_invocation(&profile);
        let launch_spec = crate::services::agent_client::AgentLaunchSpec::Direct {
            program,
            args,
            display_command: build_claude_supervisor_launch_command(target, &profile),
        };
        Ok(crate::services::provider_registry::ProviderLaunchConfig {
            launch_spec,
            runtime_env: profile.env,
        })
    }

    fn hooks_installed(&self) -> bool {
        current_claude_home_root()
            .and_then(|home_root| {
                std::fs::read_to_string(home_root.join(".claude").join("settings.json")).ok()
            })
            .and_then(|raw| serde_json::from_str::<Value>(&raw).ok())
            .is_some_and(|root| claude_hooks_installed(&root))
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

fn build_claude_hook_command() -> String {
    crate::services::provider_hooks::build_shared_hook_command_for_current_env()
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

fn claude_hooks_installed(root: &Value) -> bool {
    let Some(hooks) = root.get("hooks").and_then(Value::as_object) else {
        return false;
    };

    ["SessionStart", "Stop"].into_iter().all(|event| {
        hooks
            .get(event)
            .and_then(Value::as_array)
            .map(|groups| groups.iter().any(is_coder_studio_hook_group))
            .unwrap_or(false)
    })
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

fn cleanup_legacy_claude_workspace_hook_settings(cwd: &str) -> Result<(), String> {
    let settings_dir = PathBuf::from(cwd).join(".claude");
    let settings_path = settings_dir.join("settings.local.json");
    if !settings_path.exists() {
        return Ok(());
    }

    let raw = std::fs::read_to_string(&settings_path).map_err(|e| e.to_string())?;
    let mut root = match serde_json::from_str::<Value>(&raw) {
        Ok(Value::Object(map)) => map,
        _ => return Ok(()),
    };

    if let Some(hooks_value) = root.get_mut("hooks") {
        if let Some(hooks_obj) = hooks_value.as_object_mut() {
            for groups_value in hooks_obj.values_mut() {
                if let Some(groups) = groups_value.as_array_mut() {
                    groups.retain(|group| !is_coder_studio_hook_group(group));
                }
            }
            hooks_obj.retain(|_, groups_value| {
                groups_value
                    .as_array()
                    .map(|groups| !groups.is_empty())
                    .unwrap_or(true)
            });
        }
    }

    let remove_hooks = root
        .get("hooks")
        .and_then(Value::as_object)
        .map(|hooks| hooks.is_empty())
        .unwrap_or(false);
    if remove_hooks {
        root.remove("hooks");
    }

    if root.is_empty() {
        let _ = std::fs::remove_file(&settings_path);
        let _ = std::fs::remove_dir(&settings_dir);
        return Ok(());
    }

    let serialized =
        serde_json::to_string_pretty(&Value::Object(root)).map_err(|e| e.to_string())?;
    std::fs::write(settings_path, serialized).map_err(|e| e.to_string())
}

fn current_claude_home_root() -> Option<PathBuf> {
    if let Some(root) = std::env::var_os("CODER_STUDIO_CLAUDE_HOME") {
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

fn claude_data_root() -> Option<PathBuf> {
    current_claude_home_root().map(|home_root| home_root.join(".claude"))
}

fn claude_workspace_path(workspace_path: &str) -> Option<String> {
    let trimmed = workspace_path.trim();
    if trimmed.is_empty() {
        return None;
    }
    Some(trimmed.to_string())
}

fn claude_project_slug(workspace_path: &str) -> Option<String> {
    claude_workspace_path(workspace_path).map(|path| path.replace(['/', '\\', ':'], "-"))
}

fn claude_project_dir(workspace_path: &str) -> Option<PathBuf> {
    Some(
        claude_data_root()?
            .join("projects")
            .join(claude_project_slug(workspace_path)?),
    )
}

fn claude_transcript_path(workspace_path: &str, resume_id: &str) -> Option<PathBuf> {
    let trimmed_resume_id = resume_id.trim();
    if trimmed_resume_id.is_empty() {
        return None;
    }
    Some(claude_project_dir(workspace_path)?.join(format!("{trimmed_resume_id}.jsonl")))
}

fn system_time_to_timestamp_ms(time: std::time::SystemTime) -> Option<i64> {
    let duration = time.duration_since(std::time::UNIX_EPOCH).ok()?;
    i64::try_from(duration.as_millis()).ok()
}

fn fallback_file_bounds(path: &Path) -> Option<(i64, i64)> {
    let metadata = std::fs::metadata(path).ok()?;
    let created_at = metadata
        .created()
        .ok()
        .and_then(system_time_to_timestamp_ms);
    let modified_at = metadata
        .modified()
        .ok()
        .and_then(system_time_to_timestamp_ms);
    match (created_at, modified_at) {
        (Some(created_at), Some(modified_at)) => {
            Some((created_at.min(modified_at), created_at.max(modified_at)))
        }
        (Some(timestamp), None) | (None, Some(timestamp)) => Some((timestamp, timestamp)),
        (None, None) => None,
    }
}

struct ClaudeTranscriptMetadata {
    bounds: Option<(i64, i64)>,
    is_sidechain: bool,
}

fn inspect_claude_transcript(path: &Path) -> Result<ClaudeTranscriptMetadata, String> {
    let file = std::fs::File::open(path).map_err(|e| e.to_string())?;
    let reader = BufReader::new(file);
    let mut created_at = None;
    let mut last_active_at = None;
    let mut is_sidechain = false;

    for line in reader.lines() {
        let line = line.map_err(|e| e.to_string())?;
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        let Ok(payload) = serde_json::from_str::<Value>(trimmed) else {
            continue;
        };
        is_sidechain =
            is_sidechain || payload.get("isSidechain").and_then(Value::as_bool) == Some(true);
        let Some(timestamp) = payload
            .get("timestamp")
            .and_then(Value::as_str)
            .and_then(|value| chrono::DateTime::parse_from_rfc3339(value).ok())
            .map(|value| value.timestamp_millis())
        else {
            continue;
        };
        created_at = Some(created_at.map_or(timestamp, |current: i64| current.min(timestamp)));
        last_active_at =
            Some(last_active_at.map_or(timestamp, |current: i64| current.max(timestamp)));
    }

    Ok(ClaudeTranscriptMetadata {
        bounds: created_at.zip(last_active_at),
        is_sidechain,
    })
}

fn read_claude_history_title(workspace_path: &str, resume_id: &str) -> Result<String, String> {
    let Some(workspace_path) = claude_workspace_path(workspace_path) else {
        return Ok(resume_id.trim().to_string());
    };
    let Some(history_path) = claude_data_root().map(|root| root.join("history.jsonl")) else {
        return Ok(resume_id.trim().to_string());
    };
    if !history_path.exists() {
        return Ok(resume_id.trim().to_string());
    }

    let file = std::fs::File::open(history_path).map_err(|e| e.to_string())?;
    let reader = BufReader::new(file);
    let mut latest_title = None;

    for line in reader.lines() {
        let line = line.map_err(|e| e.to_string())?;
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        let Ok(payload) = serde_json::from_str::<Value>(trimmed) else {
            continue;
        };
        let matches_session = payload
            .get("sessionId")
            .and_then(Value::as_str)
            .map(str::trim)
            == Some(resume_id.trim());
        let matches_project = payload
            .get("project")
            .and_then(Value::as_str)
            .map(str::trim)
            == Some(workspace_path.as_str());
        if !matches_session || !matches_project {
            continue;
        }
        if let Some(display) = payload
            .get("display")
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())
        {
            latest_title = Some(display.to_string());
        }
    }

    Ok(latest_title.unwrap_or_else(|| resume_id.trim().to_string()))
}

fn rewrite_claude_history_without_session(
    workspace_path: &str,
    resume_id: &str,
) -> Result<(), String> {
    let Some(workspace_path) = claude_workspace_path(workspace_path) else {
        return Ok(());
    };
    let Some(history_path) = claude_data_root().map(|root| root.join("history.jsonl")) else {
        return Ok(());
    };
    if !history_path.exists() {
        return Ok(());
    }

    let file = std::fs::File::open(&history_path).map_err(|e| e.to_string())?;
    let reader = BufReader::new(file);
    let mut retained = Vec::new();

    for line in reader.lines() {
        let line = line.map_err(|e| e.to_string())?;
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        let should_drop = serde_json::from_str::<Value>(trimmed)
            .ok()
            .map(|payload| {
                payload
                    .get("sessionId")
                    .and_then(Value::as_str)
                    .map(str::trim)
                    == Some(resume_id.trim())
                    && payload
                        .get("project")
                        .and_then(Value::as_str)
                        .map(str::trim)
                        == Some(workspace_path.as_str())
            })
            .unwrap_or(false);
        if !should_drop {
            retained.push(line);
        }
    }

    let rewritten = if retained.is_empty() {
        String::new()
    } else {
        format!("{}\n", retained.join("\n"))
    };
    std::fs::write(history_path, rewritten).map_err(|e| e.to_string())
}

fn list_claude_workspace_sessions(
    workspace_path: &str,
) -> Result<Vec<ProviderWorkspaceSession>, String> {
    let Some(project_dir) = claude_project_dir(workspace_path) else {
        return Ok(Vec::new());
    };
    if !project_dir.exists() {
        return Ok(Vec::new());
    }

    let mut sessions = Vec::new();
    for entry in std::fs::read_dir(project_dir).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let path = entry.path();
        if !entry.file_type().map_err(|e| e.to_string())?.is_file() {
            continue;
        }
        if path.extension().and_then(|value| value.to_str()) != Some("jsonl") {
            continue;
        }
        let Some(resume_id) = path
            .file_stem()
            .and_then(|value| value.to_str())
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(ToString::to_string)
        else {
            continue;
        };

        let transcript = inspect_claude_transcript(&path)?;
        if transcript.is_sidechain {
            continue;
        }
        let (created_at, last_active_at) = transcript
            .bounds
            .or_else(|| fallback_file_bounds(&path))
            .unwrap_or((0, 0));
        sessions.push(ProviderWorkspaceSession {
            provider: AgentProvider::claude(),
            resume_id: resume_id.clone(),
            title: read_claude_history_title(workspace_path, &resume_id)?,
            created_at,
            last_active_at,
        });
    }

    sessions.sort_by(|left, right| {
        right
            .last_active_at
            .cmp(&left.last_active_at)
            .then_with(|| right.created_at.cmp(&left.created_at))
            .then_with(|| left.resume_id.cmp(&right.resume_id))
    });
    Ok(sessions)
}

fn delete_claude_workspace_session(workspace_path: &str, resume_id: &str) -> Result<(), String> {
    let trimmed_resume_id = resume_id.trim();
    if trimmed_resume_id.is_empty() {
        return Ok(());
    }

    if let Some(transcript_path) = claude_transcript_path(workspace_path, trimmed_resume_id) {
        match std::fs::remove_file(&transcript_path) {
            Ok(()) => {}
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(error) => return Err(error.to_string()),
        }
    }

    if let Some(project_dir) = claude_project_dir(workspace_path) {
        let session_dir = project_dir.join(trimmed_resume_id);
        match std::fs::remove_dir_all(&session_dir) {
            Ok(()) => {}
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(error) => return Err(error.to_string()),
        }
        if session_dir.exists() {
            match std::fs::remove_dir(&session_dir) {
                Ok(()) => {}
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
                Err(error) => return Err(error.to_string()),
            }
        }
    }

    rewrite_claude_history_without_session(workspace_path, trimmed_resume_id)
}

pub(crate) fn ensure_claude_hook_settings(cwd: &str, _target: &ExecTarget) -> Result<(), String> {
    let Some(home_root) = current_claude_home_root() else {
        return Ok(());
    };
    let settings_path = home_root.join(".claude").join("settings.json");
    let current = if settings_path.exists() {
        std::fs::read_to_string(&settings_path).map_err(|e| e.to_string())?
    } else {
        "{}".to_string()
    };

    let mut root =
        serde_json::from_str::<Value>(&current).unwrap_or_else(|_| Value::Object(Map::new()));
    if !root.is_object() {
        root = Value::Object(Map::new());
    }

    // If hooks are already correctly installed, skip writing to avoid
    // unnecessary file modifications and preserve user-customized settings.
    if claude_hooks_installed(&root) {
        return Ok(());
    }

    let root_obj = root.as_object_mut().expect("object");
    let hooks_value = root_obj
        .entry("hooks".to_string())
        .or_insert_with(|| Value::Object(Map::new()));
    if !hooks_value.is_object() {
        *hooks_value = Value::Object(Map::new());
    }
    let hooks_obj = hooks_value.as_object_mut().expect("object");
    let command = build_claude_hook_command();

    upsert_hook_groups(hooks_obj, "SessionStart", Some(".*"), &command);
    upsert_hook_groups(hooks_obj, "Stop", None, &command);

    let serialized = serde_json::to_string_pretty(&root).map_err(|e| e.to_string())?;
    let settings_dir = home_root.join(".claude");
    std::fs::create_dir_all(&settings_dir).map_err(|e| e.to_string())?;
    std::fs::write(settings_dir.join("settings.json"), serialized).map_err(|e| e.to_string())?;
    let _ = cleanup_legacy_claude_workspace_hook_settings(cwd);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::BTreeMap;
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

    fn with_claude_home<T>(home_root: &Path, run: impl FnOnce() -> T) -> T {
        let _guard = crate::services::provider_registry::provider_env_test_lock()
            .lock()
            .unwrap();
        let previous = std::env::var_os("CODER_STUDIO_CLAUDE_HOME");
        std::env::set_var("CODER_STUDIO_CLAUDE_HOME", home_root);
        let result = run();
        if let Some(value) = previous {
            std::env::set_var("CODER_STUDIO_CLAUDE_HOME", value);
        } else {
            std::env::remove_var("CODER_STUDIO_CLAUDE_HOME");
        }
        result
    }

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

    #[test]
    fn claude_supervisor_invoke_uses_print_mode() {
        let mut settings = AppSettingsPayload::default();
        let mut env = BTreeMap::new();
        env.insert("ANTHROPIC_API_KEY".to_string(), "test-key".to_string());
        settings
            .set_provider_profile(
                "claude",
                &ClaudeRuntimeProfile {
                    executable: "claude".into(),
                    startup_args: vec!["--model".into(), "claude-sonnet-4-5".into()],
                    env: env.clone(),
                    settings_json: Value::Object(Map::new()),
                },
            )
            .unwrap();

        let launch = adapter()
            .build_supervisor_invoke(&settings, &ExecTarget::Native)
            .expect("supervisor launch");
        let start = adapter()
            .build_start(&settings, &ExecTarget::Native)
            .expect("start launch");

        match &launch.launch_spec {
            crate::services::agent_client::AgentLaunchSpec::Direct { program, args, .. } => {
                assert_eq!(program, "claude");
                assert_eq!(
                    args.as_slice(),
                    [
                        "--model".to_string(),
                        "claude-sonnet-4-5".to_string(),
                        "--print".to_string(),
                    ]
                );
            }
            crate::services::agent_client::AgentLaunchSpec::ShellCommand(command) => {
                panic!("expected direct launch, got shell command: {command}");
            }
        }
        assert_eq!(launch.runtime_env, env);
        assert_ne!(
            crate::services::session_runtime::launch_spec_display_command(&launch.launch_spec),
            crate::services::session_runtime::launch_spec_display_command(&start.launch_spec),
        );
    }

    #[test]
    fn claude_adapter_only_normalizes_session_start_and_stop() {
        let session_start = normalize_claude_lifecycle_event(&json!({
            "hook_event_name": "SessionStart",
            "session_id": "claude-session-1"
        }))
        .expect("session start should normalize");
        assert_eq!(session_start.kind, "session_started");
        assert_eq!(session_start.source_event, "SessionStart");

        let stop = normalize_claude_lifecycle_event(&json!({
            "hook_event_name": "Stop"
        }))
        .expect("stop should normalize");
        assert_eq!(stop.kind, "turn_completed");
        assert_eq!(stop.source_event, "Stop");

        for removed_hook in [
            "UserPromptSubmit",
            "PreToolUse",
            "PostToolUse",
            "PostToolUseFailure",
            "Notification",
            "SessionEnd",
        ] {
            assert!(
                normalize_claude_lifecycle_event(&json!({
                    "hook_event_name": removed_hook
                }))
                .is_none(),
                "{removed_hook} should no longer normalize"
            );
        }
    }

    #[test]
    fn claude_hook_detection_requires_session_start_and_stop() {
        let config = json!({
            "hooks": {
                "SessionStart": [{
                    "hooks": [{
                        "type": "command",
                        "command": "coder-studio --coder-studio-agent-hook"
                    }]
                }],
                "Stop": [{
                    "hooks": [{
                        "type": "command",
                        "command": "coder-studio --coder-studio-agent-hook"
                    }]
                }],
                "Notification": [{
                    "hooks": [{
                        "type": "command",
                        "command": "coder-studio --coder-studio-agent-hook"
                    }]
                }]
            }
        });

        assert!(claude_hooks_installed(&config));
        assert!(!claude_hooks_installed(&json!({
            "hooks": {
                "SessionStart": [{
                    "hooks": [{
                        "type": "command",
                        "command": "coder-studio --coder-studio-agent-hook"
                    }]
                }]
            }
        })));
        assert!(!claude_hooks_installed(&json!({
            "hooks": {
                "Stop": [{
                    "hooks": [{
                        "type": "command",
                        "command": "coder-studio --coder-studio-agent-hook"
                    }]
                }]
            }
        })));
        assert!(!claude_hooks_installed(&json!({
            "hooks": {
                "SessionStart": [{
                    "hooks": [{
                        "type": "command",
                        "command": "echo not-coder-studio"
                    }]
                }],
                "Stop": [{
                    "hooks": [{
                        "type": "command",
                        "command": "coder-studio --coder-studio-agent-hook"
                    }]
                }]
            }
        })));
    }

    #[test]
    fn ensure_claude_hook_settings_write_global_settings_without_workspace_file() {
        let workspace_root = unique_temp_dir("claude-workspace");
        let claude_home = unique_temp_dir("claude-home");
        let claude_dir = claude_home.join(".claude");
        fs::create_dir_all(&claude_dir).unwrap();
        fs::write(
            claude_dir.join("settings.json"),
            serde_json::to_string_pretty(&json!({
                "permissions": {
                    "allow": ["Read"]
                }
            }))
            .unwrap(),
        )
        .unwrap();

        with_claude_home(&claude_home, || {
            ensure_claude_hook_settings(workspace_root.to_str().unwrap(), &ExecTarget::Native)
        })
        .unwrap();

        assert!(!workspace_root
            .join(".claude")
            .join("settings.local.json")
            .exists());

        let raw = fs::read_to_string(claude_dir.join("settings.json")).unwrap();
        let parsed: Value = serde_json::from_str(&raw).unwrap();
        assert_eq!(parsed["permissions"]["allow"], json!(["Read"]));
        assert_eq!(
            parsed["hooks"]["SessionStart"][0]["hooks"][0]["type"],
            Value::String("command".into())
        );
        assert!(parsed["hooks"]["SessionStart"][0]["hooks"][0]["command"]
            .as_str()
            .unwrap()
            .contains("--coder-studio-agent-hook"));
        assert_eq!(
            parsed["hooks"]["Stop"][0]["hooks"][0]["type"],
            Value::String("command".into())
        );
        assert!(parsed["hooks"].get("UserPromptSubmit").is_none());
        assert!(parsed["hooks"].get("PreToolUse").is_none());
        assert!(parsed["hooks"].get("PostToolUse").is_none());
        assert!(parsed["hooks"].get("Notification").is_none());
        assert!(parsed["hooks"].get("SessionEnd").is_none());

        let _ = fs::remove_dir_all(workspace_root);
        let _ = fs::remove_dir_all(claude_home);
    }

    #[test]
    fn ensure_claude_hook_settings_remove_legacy_workspace_hook_file() {
        let workspace_root = unique_temp_dir("claude-workspace");
        let claude_home = unique_temp_dir("claude-home");
        let workspace_claude_dir = workspace_root.join(".claude");
        fs::create_dir_all(&workspace_claude_dir).unwrap();
        fs::write(
            workspace_claude_dir.join("settings.local.json"),
            serde_json::to_string_pretty(&json!({
                "hooks": {
                    "SessionStart": [
                        {
                            "hooks": [
                                {
                                    "type": "command",
                                    "command": "/bin/sh -lc 'coder-studio --coder-studio-agent-hook'"
                                }
                            ]
                        }
                    ]
                }
            }))
            .unwrap(),
        )
        .unwrap();

        with_claude_home(&claude_home, || {
            ensure_claude_hook_settings(workspace_root.to_str().unwrap(), &ExecTarget::Native)
        })
        .unwrap();

        assert!(!workspace_claude_dir.join("settings.local.json").exists());

        let _ = fs::remove_dir_all(workspace_root);
        let _ = fs::remove_dir_all(claude_home);
    }

    #[test]
    fn claude_adapter_lists_workspace_sessions_with_latest_matching_history_title() {
        let workspace_root = unique_temp_dir("claude-provider-workspace");
        let claude_home = unique_temp_dir("claude-provider-home");
        let claude_dir = claude_home.join(".claude");
        let project_slug = workspace_root
            .to_string_lossy()
            .replace(['/', '\\', ':'], "-");
        let project_dir = claude_dir.join("projects").join(project_slug);
        fs::create_dir_all(&project_dir).unwrap();
        fs::create_dir_all(&claude_dir).unwrap();
        fs::write(
            project_dir.join("session-a.jsonl"),
            concat!(
                "{\"timestamp\":\"2026-04-05T10:00:00.000Z\"}\n",
                "{\"timestamp\":\"2026-04-05T11:30:00.000Z\"}\n"
            ),
        )
        .unwrap();
        fs::write(
            claude_dir.join("history.jsonl"),
            format!(
                concat!(
                    "{{\"display\":\"older title\",\"timestamp\":1,\"project\":\"{workspace}\",\"sessionId\":\"session-a\"}}\n",
                    "{{\"display\":\"wrong project\",\"timestamp\":9,\"project\":\"/tmp/other\",\"sessionId\":\"session-a\"}}\n",
                    "{{\"display\":\"latest title\",\"timestamp\":2,\"project\":\"{workspace}\",\"sessionId\":\"session-a\"}}\n"
                ),
                workspace = workspace_root.to_string_lossy(),
            ),
        )
        .unwrap();

        let sessions = with_claude_home(&claude_home, || {
            adapter().list_workspace_sessions(workspace_root.to_str().unwrap())
        })
        .expect("claude workspace sessions");

        assert_eq!(sessions.len(), 1);
        assert_eq!(sessions[0].provider, AgentProvider::claude());
        assert_eq!(sessions[0].resume_id, "session-a");
        assert_eq!(sessions[0].title, "latest title");
        assert_eq!(sessions[0].created_at, 1775383200000);
        assert_eq!(sessions[0].last_active_at, 1775388600000);

        let _ = fs::remove_dir_all(workspace_root);
        let _ = fs::remove_dir_all(claude_home);
    }

    #[test]
    fn claude_adapter_ignores_sidechain_workspace_sessions() {
        let workspace_root = unique_temp_dir("claude-provider-workspace");
        let claude_home = unique_temp_dir("claude-provider-home");
        let claude_dir = claude_home.join(".claude");
        let project_slug = workspace_root
            .to_string_lossy()
            .replace(['/', '\\', ':'], "-");
        let project_dir = claude_dir.join("projects").join(project_slug);
        fs::create_dir_all(&project_dir).unwrap();
        fs::create_dir_all(&claude_dir).unwrap();
        fs::write(
            project_dir.join("session-parent.jsonl"),
            concat!(
                "{\"timestamp\":\"2026-04-05T10:00:00.000Z\",\"isSidechain\":false}\n",
                "{\"timestamp\":\"2026-04-05T11:00:00.000Z\"}\n"
            ),
        )
        .unwrap();
        fs::write(
            project_dir.join("session-sidechain.jsonl"),
            concat!(
                "{\"timestamp\":\"2026-04-05T10:05:00.000Z\",\"isSidechain\":true,\"parentUuid\":\"session-parent\"}\n",
                "{\"timestamp\":\"2026-04-05T10:10:00.000Z\",\"isSidechain\":true,\"parentUuid\":\"session-parent\"}\n"
            ),
        )
        .unwrap();
        fs::write(
            claude_dir.join("history.jsonl"),
            format!(
                concat!(
                    "{{\"display\":\"Parent Session\",\"timestamp\":1,\"project\":\"{workspace}\",\"sessionId\":\"session-parent\"}}\n",
                    "{{\"display\":\"Sidechain Session\",\"timestamp\":2,\"project\":\"{workspace}\",\"sessionId\":\"session-sidechain\"}}\n"
                ),
                workspace = workspace_root.to_string_lossy(),
            ),
        )
        .unwrap();

        let sessions = with_claude_home(&claude_home, || {
            adapter().list_workspace_sessions(workspace_root.to_str().unwrap())
        })
        .expect("claude workspace sessions");

        assert_eq!(sessions.len(), 1);
        assert_eq!(sessions[0].resume_id, "session-parent");
        assert_eq!(sessions[0].title, "Parent Session");

        let _ = fs::remove_dir_all(workspace_root);
        let _ = fs::remove_dir_all(claude_home);
    }

    #[test]
    fn claude_adapter_checks_existence_and_deletes_real_storage() {
        let workspace_root = unique_temp_dir("claude-provider-workspace");
        let claude_home = unique_temp_dir("claude-provider-home");
        let claude_dir = claude_home.join(".claude");
        let project_slug = workspace_root
            .to_string_lossy()
            .replace(['/', '\\', ':'], "-");
        let project_dir = claude_dir.join("projects").join(project_slug);
        let session_dir = project_dir.join("session-a");
        fs::create_dir_all(&session_dir).unwrap();
        fs::create_dir_all(&claude_dir).unwrap();
        fs::write(
            project_dir.join("session-a.jsonl"),
            "{\"timestamp\":\"2026-04-05T10:00:00.000Z\"}\n",
        )
        .unwrap();
        fs::write(
            project_dir.join("session-b.jsonl"),
            "{\"timestamp\":\"2026-04-05T10:05:00.000Z\"}\n",
        )
        .unwrap();
        fs::write(
            claude_dir.join("history.jsonl"),
            format!(
                concat!(
                    "{{\"display\":\"delete me\",\"timestamp\":1,\"project\":\"{workspace}\",\"sessionId\":\"session-a\"}}\n",
                    "{{\"display\":\"keep other session\",\"timestamp\":2,\"project\":\"{workspace}\",\"sessionId\":\"session-b\"}}\n",
                    "{{\"display\":\"keep other project\",\"timestamp\":3,\"project\":\"/tmp/other\",\"sessionId\":\"session-a\"}}\n"
                ),
                workspace = workspace_root.to_string_lossy(),
            ),
        )
        .unwrap();

        with_claude_home(&claude_home, || {
            assert!(adapter()
                .session_exists(workspace_root.to_str().unwrap(), "session-a")
                .unwrap());
            adapter()
                .delete_workspace_session(workspace_root.to_str().unwrap(), "session-a")
                .unwrap();
            assert!(!adapter()
                .session_exists(workspace_root.to_str().unwrap(), "session-a")
                .unwrap());
        });

        assert!(!project_dir.join("session-a.jsonl").exists());
        assert!(!session_dir.exists());
        assert!(project_dir.join("session-b.jsonl").exists());
        let history = fs::read_to_string(claude_dir.join("history.jsonl")).unwrap();
        assert!(!history.contains("delete me"));
        assert!(history.contains("keep other session"));
        assert!(history.contains("keep other project"));

        let _ = fs::remove_dir_all(workspace_root);
        let _ = fs::remove_dir_all(claude_home);
    }
}
