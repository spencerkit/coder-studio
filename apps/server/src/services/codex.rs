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

pub(crate) fn build_codex_supervisor_invocation(
    profile: &CodexRuntimeProfile,
) -> (String, Vec<String>) {
    let executable = profile.executable.trim();
    let program = if executable.is_empty() {
        "codex".to_string()
    } else {
        executable.to_string()
    };
    let mut args = vec!["exec".to_string()];
    let trimmed_model = profile.model.trim();
    if !trimmed_model.is_empty() {
        args.push("--model".to_string());
        args.push(trimmed_model.to_string());
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
    // Force prompt input from stdin so supervisor can stream one-shot context.
    args.push("-".to_string());
    (program, args)
}

pub(crate) fn build_codex_supervisor_command(
    target: &ExecTarget,
    profile: &CodexRuntimeProfile,
) -> String {
    let (program, args) = build_codex_supervisor_invocation(profile);
    let mut parts = vec![crate::services::agent_client::escape_agent_command_part(
        target, &program,
    )];
    parts.extend(
        args.iter()
            .map(|arg| crate::services::agent_client::escape_agent_command_part(target, arg)),
    );
    parts.join(" ")
}

fn normalize_codex_lifecycle(payload: &Value) -> Option<(&'static str, String)> {
    let hook_event = payload.get("hook_event_name")?.as_str()?;
    let normalized = match hook_event {
        "SessionStart" => "session_started",
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

    fn list_workspace_sessions(
        &self,
        workspace_path: &str,
    ) -> Result<Vec<ProviderWorkspaceSession>, String> {
        list_codex_workspace_sessions(workspace_path)
    }

    fn session_exists(&self, workspace_path: &str, resume_id: &str) -> Result<bool, String> {
        codex_session_exists(workspace_path, resume_id)
    }

    fn delete_workspace_session(
        &self,
        workspace_path: &str,
        resume_id: &str,
    ) -> Result<(), String> {
        delete_codex_workspace_session(workspace_path, resume_id)
    }

    fn build_start(
        &self,
        settings: &AppSettingsPayload,
        target: &ExecTarget,
    ) -> Result<crate::services::provider_registry::ProviderLaunchConfig, String> {
        let profile = resolve_codex_runtime_profile(settings, target);
        let (program, args) = build_codex_start_invocation(&profile);
        let launch_spec = crate::services::agent_client::AgentLaunchSpec::Direct {
            program,
            args,
            display_command: build_codex_start_command(target, &profile),
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
        let (program, args) = build_codex_resume_invocation(&profile, resume_id);
        let launch_spec = crate::services::agent_client::AgentLaunchSpec::Direct {
            program,
            args,
            display_command: build_codex_resume_command(target, &profile, resume_id),
        };
        Ok(crate::services::provider_registry::ProviderLaunchConfig {
            launch_spec,
            runtime_env: Default::default(),
        })
    }

    fn build_supervisor_invoke(
        &self,
        settings: &AppSettingsPayload,
        target: &ExecTarget,
    ) -> Result<crate::services::provider_registry::ProviderLaunchConfig, String> {
        let profile = resolve_codex_runtime_profile(settings, target);
        let (program, args) = build_codex_supervisor_invocation(&profile);
        let launch_spec = crate::services::agent_client::AgentLaunchSpec::Direct {
            program,
            args,
            display_command: build_codex_supervisor_command(target, &profile),
        };
        Ok(crate::services::provider_registry::ProviderLaunchConfig {
            launch_spec,
            runtime_env: Default::default(),
        })
    }

    fn hooks_installed(&self) -> bool {
        let Some(home_root) = native_codex_home_root() else {
            return false;
        };

        let hooks_installed = std::fs::read_to_string(home_root.join(".codex").join("hooks.json"))
            .ok()
            .and_then(|raw| serde_json::from_str::<Value>(&raw).ok())
            .is_some_and(|root| codex_hooks_installed(&root));
        if !hooks_installed {
            return false;
        }

        std::fs::read_to_string(home_root.join(".codex").join("config.toml"))
            .ok()
            .and_then(|raw| raw.parse::<toml::Table>().ok())
            .is_some_and(|root| codex_hook_feature_enabled(&root))
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

fn build_codex_hook_command() -> String {
    crate::services::provider_hooks::build_shared_hook_command_for_current_env()
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

fn codex_hooks_installed(root: &Value) -> bool {
    let Some(hooks) = root.get("hooks").and_then(Value::as_object) else {
        return false;
    };

    ["SessionStart", "Stop"].into_iter().all(|event| {
        hooks
            .get(event)
            .and_then(Value::as_array)
            .map(|groups| groups.iter().any(is_coder_studio_codex_group))
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
    groups.retain(|group| !is_coder_studio_codex_group(group));
    groups.push(build_hook_group(command, matcher));
}

fn cleanup_legacy_codex_workspace_hook_settings(cwd: &str) -> Result<(), String> {
    let hooks_dir = PathBuf::from(cwd).join(".codex");
    let hooks_path = hooks_dir.join("hooks.json");
    if !hooks_path.exists() {
        return Ok(());
    }

    let raw = std::fs::read_to_string(&hooks_path).map_err(|e| e.to_string())?;
    let mut root = match serde_json::from_str::<Value>(&raw) {
        Ok(Value::Object(map)) => map,
        _ => return Ok(()),
    };

    if let Some(hooks_value) = root.get_mut("hooks") {
        if let Some(hooks_obj) = hooks_value.as_object_mut() {
            for groups_value in hooks_obj.values_mut() {
                if let Some(groups) = groups_value.as_array_mut() {
                    groups.retain(|group| !is_coder_studio_codex_group(group));
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
        let _ = std::fs::remove_file(&hooks_path);
        let _ = std::fs::remove_dir(&hooks_dir);
        return Ok(());
    }

    let serialized =
        serde_json::to_string_pretty(&Value::Object(root)).map_err(|e| e.to_string())?;
    std::fs::write(hooks_path, serialized).map_err(|e| e.to_string())
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

fn codex_data_root() -> Option<PathBuf> {
    native_codex_home_root().map(|home_root| home_root.join(".codex"))
}

fn codex_workspace_path(workspace_path: &str) -> Option<String> {
    let trimmed = workspace_path.trim();
    if trimmed.is_empty() {
        return None;
    }
    Some(trimmed.to_string())
}

fn codex_state_db_path() -> Option<PathBuf> {
    Some(codex_data_root()?.join("state_5.sqlite"))
}

fn normalize_provider_timestamp_ms(value: i64) -> i64 {
    if value.abs() >= 1_000_000_000_000 {
        value
    } else {
        value.saturating_mul(1000)
    }
}

fn codex_thread_source_is_subagent(source: &str) -> bool {
    serde_json::from_str::<Value>(source)
        .ok()
        .and_then(|payload| payload.get("subagent").cloned())
        .is_some()
}

fn list_codex_workspace_sessions(
    workspace_path: &str,
) -> Result<Vec<ProviderWorkspaceSession>, String> {
    let Some(workspace_path) = codex_workspace_path(workspace_path) else {
        return Ok(Vec::new());
    };
    let Some(db_path) = codex_state_db_path() else {
        return Ok(Vec::new());
    };
    if !db_path.exists() {
        return Ok(Vec::new());
    }

    let conn = Connection::open(db_path).map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare(
            "SELECT id, rollout_path, title, created_at, updated_at, source
             FROM threads
             WHERE cwd = ?1
               AND COALESCE(TRIM(agent_nickname), '') = ''
               AND COALESCE(TRIM(agent_role), '') = ''",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(params![workspace_path], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, i64>(3)?,
                row.get::<_, i64>(4)?,
                row.get::<_, String>(5)?,
            ))
        })
        .map_err(|e| e.to_string())?;

    let mut sessions = Vec::new();
    for row in rows {
        let (resume_id, rollout_path, title, created_at, last_active_at, source) =
            row.map_err(|e| e.to_string())?;
        if codex_thread_source_is_subagent(&source) {
            continue;
        }
        if !Path::new(&rollout_path).exists() {
            continue;
        }
        sessions.push(ProviderWorkspaceSession {
            provider: AgentProvider::codex(),
            resume_id,
            title,
            created_at: normalize_provider_timestamp_ms(created_at),
            last_active_at: normalize_provider_timestamp_ms(last_active_at),
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

fn codex_session_exists(workspace_path: &str, resume_id: &str) -> Result<bool, String> {
    use rusqlite::OptionalExtension;

    let Some(workspace_path) = codex_workspace_path(workspace_path) else {
        return Ok(false);
    };
    let trimmed_resume_id = resume_id.trim();
    if trimmed_resume_id.is_empty() {
        return Ok(false);
    }
    let Some(db_path) = codex_state_db_path() else {
        return Ok(false);
    };
    if !db_path.exists() {
        return Ok(false);
    }

    let conn = Connection::open(db_path).map_err(|e| e.to_string())?;
    let rollout_path = conn
        .query_row(
            "SELECT rollout_path FROM threads WHERE id = ?1 AND cwd = ?2 LIMIT 1",
            params![trimmed_resume_id, workspace_path],
            |row| row.get::<_, String>(0),
        )
        .optional()
        .map_err(|e| e.to_string())?;
    Ok(rollout_path
        .map(|path| Path::new(&path).exists())
        .unwrap_or(false))
}

fn rewrite_codex_history_without_session(resume_id: &str) -> Result<(), String> {
    let Some(history_path) = codex_data_root().map(|root| root.join("history.jsonl")) else {
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
                    .get("session_id")
                    .and_then(Value::as_str)
                    .map(str::trim)
                    == Some(resume_id)
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

fn delete_codex_shell_snapshots(resume_id: &str) -> Result<(), String> {
    let Some(snapshot_dir) = codex_data_root().map(|root| root.join("shell_snapshots")) else {
        return Ok(());
    };
    if !snapshot_dir.exists() {
        return Ok(());
    }

    let prefix = format!("{resume_id}.");
    for entry in std::fs::read_dir(snapshot_dir).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let file_name = entry.file_name();
        let file_name = file_name.to_string_lossy();
        if file_name != resume_id && !file_name.starts_with(&prefix) {
            continue;
        }
        let path = entry.path();
        if entry.file_type().map_err(|e| e.to_string())?.is_dir() {
            std::fs::remove_dir_all(path).map_err(|e| e.to_string())?;
        } else {
            std::fs::remove_file(path).map_err(|e| e.to_string())?;
        }
    }

    Ok(())
}

fn delete_codex_workspace_session(workspace_path: &str, resume_id: &str) -> Result<(), String> {
    use rusqlite::OptionalExtension;

    let Some(workspace_path) = codex_workspace_path(workspace_path) else {
        return Ok(());
    };
    let trimmed_resume_id = resume_id.trim();
    if trimmed_resume_id.is_empty() {
        return Ok(());
    }

    if let Some(db_path) = codex_state_db_path() {
        if db_path.exists() {
            let conn = Connection::open(db_path).map_err(|e| e.to_string())?;
            let rollout_path = conn
                .query_row(
                    "SELECT rollout_path FROM threads WHERE id = ?1 AND cwd = ?2 LIMIT 1",
                    params![trimmed_resume_id, workspace_path],
                    |row| row.get::<_, String>(0),
                )
                .optional()
                .map_err(|e| e.to_string())?;
            if let Some(rollout_path) = rollout_path {
                match std::fs::remove_file(&rollout_path) {
                    Ok(()) => {}
                    Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
                    Err(error) => return Err(error.to_string()),
                }
            }
            conn.execute(
                "DELETE FROM logs WHERE thread_id = ?1",
                params![trimmed_resume_id],
            )
            .map_err(|e| e.to_string())?;
            conn.execute(
                "DELETE FROM thread_spawn_edges WHERE parent_thread_id = ?1 OR child_thread_id = ?1",
                params![trimmed_resume_id],
            )
            .map_err(|e| e.to_string())?;
            conn.execute(
                "DELETE FROM threads WHERE id = ?1 AND cwd = ?2",
                params![trimmed_resume_id, workspace_path],
            )
            .map_err(|e| e.to_string())?;
        }
    }

    rewrite_codex_history_without_session(trimmed_resume_id)?;
    delete_codex_shell_snapshots(trimmed_resume_id)
}

fn codex_hook_feature_enabled(root: &toml::Table) -> bool {
    root.get("features")
        .and_then(toml::Value::as_table)
        .and_then(|features| features.get("codex_hooks"))
        .and_then(toml::Value::as_bool)
        == Some(true)
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

fn ensure_codex_global_feature_settings(_cwd: &str, _target: &ExecTarget) -> Result<(), String> {
    let Some(home_root) = native_codex_home_root() else {
        return Ok(());
    };
    let config_path = home_root.join(".codex").join("config.toml");
    let current = if config_path.exists() {
        std::fs::read_to_string(&config_path).map_err(|e| e.to_string())?
    } else {
        String::new()
    };

    let mut config = current.parse::<toml::Table>().unwrap_or_default();
    upsert_codex_global_feature(&mut config, "codex_hooks");
    let serialized = toml::to_string_pretty(&config).map_err(|e| e.to_string())?;

    let config_dir = home_root.join(".codex");
    std::fs::create_dir_all(&config_dir).map_err(|e| e.to_string())?;
    std::fs::write(config_dir.join("config.toml"), serialized).map_err(|e| e.to_string())
}

pub(crate) fn ensure_codex_hook_settings(cwd: &str, target: &ExecTarget) -> Result<(), String> {
    ensure_codex_global_feature_settings(cwd, target)?;

    let Some(home_root) = native_codex_home_root() else {
        return Ok(());
    };
    let hooks_path = home_root.join(".codex").join("hooks.json");
    let current = if hooks_path.exists() {
        std::fs::read_to_string(&hooks_path).map_err(|e| e.to_string())?
    } else {
        "{}".to_string()
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
    let command = build_codex_hook_command();

    upsert_hook_groups(hooks_obj, "SessionStart", Some("startup|resume"), &command);
    upsert_hook_groups(hooks_obj, "Stop", None, &command);

    let serialized = serde_json::to_string_pretty(&root).map_err(|e| e.to_string())?;
    let hooks_dir = home_root.join(".codex");
    std::fs::create_dir_all(&hooks_dir).map_err(|e| e.to_string())?;
    std::fs::write(hooks_dir.join("hooks.json"), serialized).map_err(|e| e.to_string())?;
    let _ = cleanup_legacy_codex_workspace_hook_settings(cwd);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use rusqlite::Connection;
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

    fn with_codex_home<T>(home_root: &Path, run: impl FnOnce() -> T) -> T {
        let _guard = crate::services::provider_registry::provider_env_test_lock()
            .lock()
            .unwrap();
        let previous = std::env::var_os("CODER_STUDIO_CODEX_HOME");
        std::env::set_var("CODER_STUDIO_CODEX_HOME", home_root);
        let result = run();
        if let Some(value) = previous {
            std::env::set_var("CODER_STUDIO_CODEX_HOME", value);
        } else {
            std::env::remove_var("CODER_STUDIO_CODEX_HOME");
        }
        result
    }

    fn init_codex_state_db(path: &Path) {
        let conn = Connection::open(path).unwrap();
        conn.execute_batch(
            r#"
            CREATE TABLE threads (
                id TEXT PRIMARY KEY,
                rollout_path TEXT NOT NULL,
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL,
                source TEXT NOT NULL,
                model_provider TEXT NOT NULL,
                cwd TEXT NOT NULL,
                title TEXT NOT NULL,
                sandbox_policy TEXT NOT NULL,
                approval_mode TEXT NOT NULL,
                tokens_used INTEGER NOT NULL DEFAULT 0,
                has_user_event INTEGER NOT NULL DEFAULT 0,
                archived INTEGER NOT NULL DEFAULT 0,
                archived_at INTEGER,
                git_sha TEXT,
                git_branch TEXT,
                git_origin_url TEXT,
                cli_version TEXT NOT NULL DEFAULT '',
                first_user_message TEXT NOT NULL DEFAULT '',
                agent_nickname TEXT,
                agent_role TEXT,
                memory_mode TEXT NOT NULL DEFAULT 'enabled',
                model TEXT,
                reasoning_effort TEXT,
                agent_path TEXT
            );
            CREATE TABLE logs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                ts INTEGER NOT NULL,
                ts_nanos INTEGER NOT NULL,
                level TEXT NOT NULL,
                target TEXT NOT NULL,
                message TEXT,
                module_path TEXT,
                file TEXT,
                line INTEGER,
                thread_id TEXT,
                process_uuid TEXT,
                estimated_bytes INTEGER NOT NULL DEFAULT 0
            );
            CREATE TABLE thread_spawn_edges (
                parent_thread_id TEXT NOT NULL,
                child_thread_id TEXT NOT NULL PRIMARY KEY,
                status TEXT NOT NULL
            );
            "#,
        )
        .unwrap();
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
    fn codex_hook_detection_requires_session_start_and_stop() {
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

        assert!(codex_hooks_installed(&config));
        assert!(!codex_hooks_installed(&json!({
            "hooks": {
                "SessionStart": [{
                    "hooks": [{
                        "type": "command",
                        "command": "coder-studio --coder-studio-agent-hook"
                    }]
                }]
            }
        })));
        assert!(!codex_hooks_installed(&json!({
            "hooks": {
                "Stop": [{
                    "hooks": [{
                        "type": "command",
                        "command": "coder-studio --coder-studio-agent-hook"
                    }]
                }]
            }
        })));
        assert!(!codex_hooks_installed(&json!({
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
    fn codex_adapter_requires_global_feature_flag_and_hooks_file_for_installed_state() {
        let codex_home = unique_temp_dir("codex-home");
        let config_dir = codex_home.join(".codex");
        fs::create_dir_all(&config_dir).unwrap();
        fs::write(
            config_dir.join("hooks.json"),
            serde_json::to_string_pretty(&json!({
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
                    }]
                }
            }))
            .unwrap(),
        )
        .unwrap();

        with_codex_home(&codex_home, || {
            assert!(!adapter().hooks_installed());

            fs::write(
                config_dir.join("config.toml"),
                "[features]\ncodex_hooks = true\n",
            )
            .unwrap();
            assert!(adapter().hooks_installed());

            fs::write(
                config_dir.join("config.toml"),
                "[features]\ncodex_hooks = false\n",
            )
            .unwrap();
            assert!(!adapter().hooks_installed());
        });

        let _ = fs::remove_dir_all(codex_home);
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

        with_codex_home(&codex_home, || {
            ensure_codex_hook_settings(workspace_root.to_str().unwrap(), &ExecTarget::Native)
        })
        .unwrap();

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
    fn codex_adapter_only_normalizes_session_start_and_stop() {
        let session_start = normalize_codex_lifecycle_event(&json!({
            "hook_event_name": "SessionStart",
            "session_id": "codex-session-1"
        }))
        .expect("session start should normalize");
        assert_eq!(session_start.kind, "session_started");
        assert_eq!(session_start.source_event, "SessionStart");

        let stop = normalize_codex_lifecycle_event(&json!({
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
        ] {
            assert!(
                normalize_codex_lifecycle_event(&json!({
                    "hook_event_name": removed_hook
                }))
                .is_none(),
                "{removed_hook} should no longer normalize"
            );
        }
    }

    #[test]
    fn ensure_codex_hook_settings_write_global_hooks_without_workspace_file() {
        let workspace_root = unique_temp_dir("codex-workspace");
        let codex_home = unique_temp_dir("codex-home");
        let config_dir = codex_home.join(".codex");
        fs::create_dir_all(&config_dir).unwrap();
        fs::write(
            config_dir.join("hooks.json"),
            serde_json::to_string_pretty(&json!({
                "hooks": {
                    "Notification": [
                        {
                            "hooks": [
                                {
                                    "type": "command",
                                    "command": "echo existing"
                                }
                            ]
                        }
                    ]
                }
            }))
            .unwrap(),
        )
        .unwrap();

        with_codex_home(&codex_home, || {
            ensure_codex_hook_settings(workspace_root.to_str().unwrap(), &ExecTarget::Native)
        })
        .unwrap();

        assert!(!workspace_root.join(".codex").join("hooks.json").exists());

        let raw = fs::read_to_string(config_dir.join("hooks.json")).unwrap();
        let parsed: Value = serde_json::from_str(&raw).unwrap();
        assert_eq!(
            parsed["hooks"]["Notification"][0]["hooks"][0]["command"],
            Value::String("echo existing".into())
        );
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

        let _ = fs::remove_dir_all(workspace_root);
        let _ = fs::remove_dir_all(codex_home);
    }

    #[test]
    fn ensure_codex_hook_settings_remove_legacy_workspace_hook_file() {
        let workspace_root = unique_temp_dir("codex-workspace");
        let codex_home = unique_temp_dir("codex-home");
        let workspace_codex_dir = workspace_root.join(".codex");
        fs::create_dir_all(&workspace_codex_dir).unwrap();
        fs::write(
            workspace_codex_dir.join("hooks.json"),
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

        with_codex_home(&codex_home, || {
            ensure_codex_hook_settings(workspace_root.to_str().unwrap(), &ExecTarget::Native)
        })
        .unwrap();

        assert!(!workspace_codex_dir.join("hooks.json").exists());

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

    #[test]
    fn codex_supervisor_invoke_uses_exec_stdin_mode() {
        let mut settings = AppSettingsPayload::default();
        settings
            .set_provider_profile(
                "codex",
                &CodexRuntimeProfile {
                    executable: "codex".into(),
                    extra_args: vec!["--full-auto".into()],
                    model: "gpt-5.4".into(),
                    api_key: "codex-key".into(),
                    base_url: "https://codex.example/v1".into(),
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
                assert_eq!(program, "codex");
                assert_eq!(
                    args.as_slice(),
                    [
                        "exec".to_string(),
                        "--model".to_string(),
                        "gpt-5.4".to_string(),
                        "--full-auto".to_string(),
                        "-".to_string(),
                    ]
                );
            }
            crate::services::agent_client::AgentLaunchSpec::ShellCommand(command) => {
                panic!("expected direct launch, got shell command: {command}");
            }
        }
        assert!(launch.runtime_env.is_empty());
        assert_ne!(
            crate::services::session_runtime::launch_spec_display_command(&launch.launch_spec),
            crate::services::session_runtime::launch_spec_display_command(&start.launch_spec),
        );
    }

    #[test]
    fn codex_adapter_lists_workspace_sessions_from_threads_table() {
        let workspace_root = unique_temp_dir("codex-provider-workspace");
        let codex_home = unique_temp_dir("codex-provider-home");
        let codex_dir = codex_home.join(".codex");
        fs::create_dir_all(&codex_dir).unwrap();
        init_codex_state_db(&codex_dir.join("state_5.sqlite"));
        let rollout_path = codex_home.join("rollout-a.jsonl");
        fs::write(&rollout_path, "{\"kind\":\"user\"}\n").unwrap();
        let conn = Connection::open(codex_dir.join("state_5.sqlite")).unwrap();
        conn.execute(
            "INSERT INTO threads (id, rollout_path, created_at, updated_at, source, model_provider, cwd, title, sandbox_policy, approval_mode)
             VALUES (?1, ?2, ?3, ?4, 'codex', 'openai', ?5, ?6, 'workspace-write', 'never')",
            rusqlite::params![
                "thread-a",
                rollout_path.to_string_lossy().to_string(),
                1775383200_i64,
                1775388600_i64,
                workspace_root.to_string_lossy().to_string(),
                "Codex native title"
            ],
        ).unwrap();
        conn.execute(
            "INSERT INTO threads (id, rollout_path, created_at, updated_at, source, model_provider, cwd, title, sandbox_policy, approval_mode)
             VALUES (?1, ?2, ?3, ?4, 'codex', 'openai', '/tmp/other', ?5, 'workspace-write', 'never')",
            rusqlite::params![
                "thread-b",
                rollout_path.to_string_lossy().to_string(),
                1_i64,
                2_i64,
                "Wrong workspace"
            ],
        ).unwrap();

        let sessions = with_codex_home(&codex_home, || {
            adapter().list_workspace_sessions(workspace_root.to_str().unwrap())
        })
        .expect("codex workspace sessions");

        assert_eq!(sessions.len(), 1);
        assert_eq!(sessions[0].provider, AgentProvider::codex());
        assert_eq!(sessions[0].resume_id, "thread-a");
        assert_eq!(sessions[0].title, "Codex native title");
        assert_eq!(sessions[0].created_at, 1775383200000);
        assert_eq!(sessions[0].last_active_at, 1775388600000);

        let _ = fs::remove_dir_all(workspace_root);
        let _ = fs::remove_dir_all(codex_home);
    }

    #[test]
    fn codex_adapter_ignores_subagent_threads_in_workspace_sessions() {
        let workspace_root = unique_temp_dir("codex-provider-workspace");
        let codex_home = unique_temp_dir("codex-provider-home");
        let codex_dir = codex_home.join(".codex");
        fs::create_dir_all(&codex_dir).unwrap();
        init_codex_state_db(&codex_dir.join("state_5.sqlite"));
        let top_rollout_path = codex_home.join("rollout-top.jsonl");
        let subagent_rollout_path = codex_home.join("rollout-subagent.jsonl");
        fs::write(&top_rollout_path, "{\"kind\":\"user\"}\n").unwrap();
        fs::write(&subagent_rollout_path, "{\"kind\":\"user\"}\n").unwrap();
        let conn = Connection::open(codex_dir.join("state_5.sqlite")).unwrap();
        conn.execute(
            "INSERT INTO threads (id, rollout_path, created_at, updated_at, source, model_provider, cwd, title, sandbox_policy, approval_mode)
             VALUES (?1, ?2, ?3, ?4, 'cli', 'openai', ?5, ?6, 'workspace-write', 'never')",
            rusqlite::params![
                "thread-top",
                top_rollout_path.to_string_lossy().to_string(),
                1775383200_i64,
                1775388600_i64,
                workspace_root.to_string_lossy().to_string(),
                "Top Level Session"
            ],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO threads (id, rollout_path, created_at, updated_at, source, model_provider, cwd, title, sandbox_policy, approval_mode, agent_nickname, agent_role)
             VALUES (?1, ?2, ?3, ?4, ?5, 'openai', ?6, ?7, 'workspace-write', 'never', ?8, ?9)",
            rusqlite::params![
                "thread-subagent",
                subagent_rollout_path.to_string_lossy().to_string(),
                1775383300_i64,
                1775388700_i64,
                "{\"subagent\":{\"thread_spawn\":{\"parent_thread_id\":\"thread-top\",\"depth\":1,\"agent_nickname\":\"Hilbert\",\"agent_role\":\"worker\"}}}",
                workspace_root.to_string_lossy().to_string(),
                "Subagent Session",
                "Hilbert",
                "worker"
            ],
        )
        .unwrap();

        let sessions = with_codex_home(&codex_home, || {
            adapter().list_workspace_sessions(workspace_root.to_str().unwrap())
        })
        .expect("codex workspace sessions");

        assert_eq!(sessions.len(), 1);
        assert_eq!(sessions[0].resume_id, "thread-top");
        assert_eq!(sessions[0].title, "Top Level Session");

        let _ = fs::remove_dir_all(workspace_root);
        let _ = fs::remove_dir_all(codex_home);
    }

    #[test]
    fn codex_adapter_checks_rollout_existence_and_deletes_real_storage() {
        let workspace_root = unique_temp_dir("codex-provider-workspace");
        let codex_home = unique_temp_dir("codex-provider-home");
        let codex_dir = codex_home.join(".codex");
        fs::create_dir_all(&codex_dir).unwrap();
        fs::create_dir_all(codex_dir.join("shell_snapshots")).unwrap();
        init_codex_state_db(&codex_dir.join("state_5.sqlite"));
        let rollout_path = codex_home.join("rollout-a.jsonl");
        fs::write(&rollout_path, "{\"kind\":\"user\"}\n").unwrap();
        fs::write(
            codex_dir.join("history.jsonl"),
            concat!(
                "{\"session_id\":\"thread-a\",\"ts\":1,\"text\":\"delete me\"}\n",
                "{\"session_id\":\"thread-b\",\"ts\":2,\"text\":\"keep me\"}\n"
            ),
        )
        .unwrap();
        fs::write(
            codex_dir.join("shell_snapshots").join("thread-a.123.sh"),
            "#!/bin/sh\necho snapshot\n",
        )
        .unwrap();
        let conn = Connection::open(codex_dir.join("state_5.sqlite")).unwrap();
        conn.execute(
            "INSERT INTO threads (id, rollout_path, created_at, updated_at, source, model_provider, cwd, title, sandbox_policy, approval_mode)
             VALUES (?1, ?2, ?3, ?4, 'codex', 'openai', ?5, ?6, 'workspace-write', 'never')",
            rusqlite::params![
                "thread-a",
                rollout_path.to_string_lossy().to_string(),
                1775383200_i64,
                1775388600_i64,
                workspace_root.to_string_lossy().to_string(),
                "Codex native title"
            ],
        ).unwrap();
        conn.execute(
            "INSERT INTO logs (ts, ts_nanos, level, target, message, thread_id) VALUES (1, 0, 'INFO', 'test', 'log', 'thread-a')",
            [],
        ).unwrap();
        conn.execute(
            "INSERT INTO thread_spawn_edges (parent_thread_id, child_thread_id, status) VALUES ('thread-a', 'thread-child', 'running')",
            [],
        ).unwrap();

        with_codex_home(&codex_home, || {
            assert!(adapter()
                .session_exists(workspace_root.to_str().unwrap(), "thread-a")
                .unwrap());
            fs::remove_file(&rollout_path).unwrap();
            assert!(!adapter()
                .session_exists(workspace_root.to_str().unwrap(), "thread-a")
                .unwrap());
            fs::write(&rollout_path, "{\"kind\":\"user\"}\n").unwrap();
            adapter()
                .delete_workspace_session(workspace_root.to_str().unwrap(), "thread-a")
                .unwrap();
        });

        let remaining_threads: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM threads WHERE id = 'thread-a'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        let remaining_logs: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM logs WHERE thread_id = 'thread-a'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        let remaining_edges: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM thread_spawn_edges WHERE parent_thread_id = 'thread-a' OR child_thread_id = 'thread-a'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(remaining_threads, 0);
        assert_eq!(remaining_logs, 0);
        assert_eq!(remaining_edges, 0);
        assert!(!rollout_path.exists());
        assert!(!codex_dir
            .join("shell_snapshots")
            .join("thread-a.123.sh")
            .exists());
        let history = fs::read_to_string(codex_dir.join("history.jsonl")).unwrap();
        assert!(!history.contains("delete me"));
        assert!(history.contains("keep me"));

        let _ = fs::remove_dir_all(workspace_root);
        let _ = fs::remove_dir_all(codex_home);
    }
}
