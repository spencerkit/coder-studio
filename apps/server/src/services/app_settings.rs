use crate::infra::db::with_db;
use crate::*;
use std::fs;

const APP_SETTINGS_ROW_ID: i64 = 1;

fn default_app_settings() -> AppSettingsPayload {
    AppSettingsPayload::default()
}

fn ensure_app_settings_row(conn: &Connection) -> Result<(), String> {
    conn.execute(
        "INSERT OR IGNORE INTO app_settings (id, payload, updated_at)
         VALUES (?1, ?2, ?3)",
        params![
            APP_SETTINGS_ROW_ID,
            serde_json::to_string(&default_app_settings()).map_err(|e| e.to_string())?,
            now_ts(),
        ],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

fn normalize_app_settings_payload(raw: Value) -> Result<AppSettingsPayload, String> {
    let Value::Object(mut source) = raw else {
        return Ok(default_app_settings());
    };

    let mut providers = source
        .remove("providers")
        .unwrap_or_else(|| Value::Object(Map::new()));
    if !providers.is_object() {
        providers = Value::Object(Map::new());
    }

    if let Some(providers_object) = providers.as_object_mut() {
        for provider_id in ["claude", "codex"] {
            if let Some(global) = source
                .get(provider_id)
                .and_then(Value::as_object)
                .and_then(|provider| provider.get("global"))
            {
                let provider_entry = providers_object
                    .entry(provider_id.to_string())
                    .or_insert_with(|| json!({ "global": {} }));
                if !provider_entry.is_object() {
                    *provider_entry = json!({ "global": {} });
                }
                let provider_object = provider_entry.as_object_mut().expect("object");
                let global_entry = provider_object
                    .entry("global".to_string())
                    .or_insert_with(|| Value::Object(Map::new()));
                merge_settings_value(
                    global_entry,
                    global.clone(),
                    &[
                        "providers".to_string(),
                        provider_id.to_string(),
                        "global".to_string(),
                    ],
                );
            }
        }
    }

    source.insert("providers".to_string(), providers);

    let mut normalized =
        serde_json::from_value::<AppSettingsPayload>(Value::Object(source)).unwrap_or_default();
    normalized.ensure_builtin_provider_defaults();
    if crate::services::provider_registry::resolve_provider_adapter(
        normalized.agent_defaults.provider.as_str(),
    )
    .is_none()
    {
        normalized.agent_defaults.provider = ProviderId::default();
    }
    Ok(normalized)
}

fn load_or_default_app_settings_from_conn(conn: &Connection) -> Result<AppSettingsPayload, String> {
    ensure_app_settings_row(conn)?;
    let raw: String = conn
        .query_row(
            "SELECT payload FROM app_settings WHERE id = ?1",
            params![APP_SETTINGS_ROW_ID],
            |row| row.get(0),
        )
        .map_err(|e| e.to_string())?;
    let parsed = serde_json::from_str(&raw).map_err(|e| e.to_string())?;
    normalize_app_settings_payload(parsed)
}

fn resolve_claude_home_root(root_override: Option<&Path>) -> Option<PathBuf> {
    if let Some(root) = root_override {
        return Some(root.to_path_buf());
    }

    if let Some(root) = std::env::var_os("CODER_STUDIO_CLAUDE_HOME") {
        return Some(PathBuf::from(root));
    }

    #[cfg(test)]
    {
        None
    }

    #[cfg(not(test))]
    {
        home_dir()
    }
}

fn resolve_codex_home_root(root_override: Option<&Path>) -> Option<PathBuf> {
    if let Some(root) = root_override {
        return Some(root.to_path_buf());
    }

    if let Some(root) = std::env::var_os("CODER_STUDIO_CODEX_HOME") {
        return Some(PathBuf::from(root));
    }

    #[cfg(test)]
    {
        None
    }

    #[cfg(not(test))]
    {
        home_dir()
    }
}

#[derive(Default)]
struct ClaudeJsonSources {
    settings_json: Option<Map<String, Value>>,
    config_json: Option<Map<String, Value>>,
    global_config_json: Option<Map<String, Value>>,
}

type CodexTomlSource = toml::Table;

fn parse_json_object_text(raw: &str) -> Option<Map<String, Value>> {
    match serde_json::from_str::<Value>(raw).ok()? {
        Value::Object(value) => Some(value),
        _ => None,
    }
}

fn parse_toml_table_text(raw: &str) -> Option<CodexTomlSource> {
    raw.parse::<CodexTomlSource>().ok()
}

fn read_json_object_file(path: &Path) -> Option<Map<String, Value>> {
    let raw = fs::read_to_string(path).ok()?;
    parse_json_object_text(&raw)
}

fn read_toml_table_file(path: &Path) -> Option<CodexTomlSource> {
    let raw = fs::read_to_string(path).ok()?;
    parse_toml_table_text(&raw)
}

fn load_native_claude_json_sources(root: &Path) -> ClaudeJsonSources {
    ClaudeJsonSources {
        settings_json: read_json_object_file(&root.join(".claude/settings.json")),
        config_json: read_json_object_file(&root.join(".claude/config.json")),
        global_config_json: read_json_object_file(&root.join(".claude.json")),
    }
}

fn load_native_codex_toml_source(root: &Path) -> Option<CodexTomlSource> {
    read_toml_table_file(&root.join(".codex/config.toml"))
}

fn merge_missing_env_value(
    env: &mut std::collections::BTreeMap<String, String>,
    key: &str,
    value: &str,
) {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return;
    }

    match env.get(key) {
        Some(existing) if !existing.trim().is_empty() => {}
        _ => {
            env.insert(key.to_string(), trimmed.to_string());
        }
    }
}

fn merge_missing_env_map(
    env: &mut std::collections::BTreeMap<String, String>,
    source: &Map<String, Value>,
) {
    for (key, value) in source {
        if let Some(text) = value.as_str() {
            merge_missing_env_value(env, key, text);
        }
    }
}

fn merge_missing_string(target: &mut String, source: Option<&str>) {
    if !target.trim().is_empty() {
        return;
    }
    let Some(source) = source else {
        return;
    };
    let trimmed = source.trim();
    if trimmed.is_empty() {
        return;
    }
    *target = trimmed.to_string();
}

fn merge_missing_json(target: &mut Value, source: &Value) {
    match source {
        Value::Object(source_map) => {
            let Value::Object(target_map) = target else {
                if target.is_null() {
                    *target = source.clone();
                }
                return;
            };
            for (key, source_value) in source_map {
                match target_map.get_mut(key) {
                    Some(target_value) => merge_missing_json(target_value, source_value),
                    None => {
                        target_map.insert(key.clone(), source_value.clone());
                    }
                }
            }
        }
        Value::Array(source_values) => {
            if let Value::Array(target_values) = target {
                if target_values.is_empty() {
                    *target_values = source_values.clone();
                }
            } else if target.is_null() {
                *target = source.clone();
            }
        }
        Value::String(source_value) => {
            if let Value::String(target_value) = target {
                if target_value.trim().is_empty() {
                    *target_value = source_value.clone();
                }
            } else if target.is_null() {
                *target = source.clone();
            }
        }
        _ => {
            if target.is_null() {
                *target = source.clone();
            }
        }
    }
}

fn hydrate_runtime_profile_from_claude_sources(
    profile: &ClaudeRuntimeProfile,
    sources: &ClaudeJsonSources,
) -> ClaudeRuntimeProfile {
    let mut hydrated = profile.clone();

    if let Some(mut settings_json) = sources.settings_json.clone() {
        if let Some(Value::Object(env_map)) = settings_json.remove("env") {
            merge_missing_env_map(&mut hydrated.env, &env_map);
        }
        merge_missing_json(&mut hydrated.settings_json, &Value::Object(settings_json));
    }

    if let Some(config_json) = &sources.config_json {
        if let Some(primary_api_key) = config_json.get("primaryApiKey").and_then(Value::as_str) {
            merge_missing_env_value(&mut hydrated.env, "ANTHROPIC_API_KEY", primary_api_key);
        }
    }

    if let Some(global_config_json) = &sources.global_config_json {
        merge_missing_json(
            &mut hydrated.global_config_json,
            &Value::Object(global_config_json.clone()),
        );
    }

    hydrated
}

fn hydrate_settings_from_claude_sources(
    settings: &AppSettingsPayload,
    sources: Option<&ClaudeJsonSources>,
) -> AppSettingsPayload {
    let mut hydrated = settings.clone();

    if let Some(sources) = sources {
        let profile = settings
            .provider_profile::<ClaudeRuntimeProfile>("claude")
            .unwrap_or_default();
        let hydrated_profile = hydrate_runtime_profile_from_claude_sources(&profile, sources);
        let _ = hydrated.set_provider_profile("claude", &hydrated_profile);
    }

    hydrated
}

fn hydrate_settings_from_claude_home(
    settings: &AppSettingsPayload,
    root_override: Option<&Path>,
) -> AppSettingsPayload {
    let Some(root) = resolve_claude_home_root(root_override) else {
        return settings.clone();
    };

    let sources = load_native_claude_json_sources(&root);
    hydrate_settings_from_claude_sources(settings, Some(&sources))
}

fn hydrate_runtime_profile_from_codex_source(
    profile: &CodexRuntimeProfile,
    source: &CodexTomlSource,
) -> CodexRuntimeProfile {
    let mut hydrated = profile.clone();

    merge_missing_string(
        &mut hydrated.model,
        source.get("model").and_then(toml::Value::as_str),
    );
    merge_missing_string(
        &mut hydrated.approval_policy,
        source.get("approval_policy").and_then(toml::Value::as_str),
    );
    merge_missing_string(
        &mut hydrated.sandbox_mode,
        source.get("sandbox_mode").and_then(toml::Value::as_str),
    );
    merge_missing_string(
        &mut hydrated.web_search,
        source.get("web_search").and_then(toml::Value::as_str),
    );
    merge_missing_string(
        &mut hydrated.model_reasoning_effort,
        source
            .get("model_reasoning_effort")
            .and_then(toml::Value::as_str),
    );

    hydrated
}

fn hydrate_settings_from_codex_sources(
    settings: &AppSettingsPayload,
    source: Option<&CodexTomlSource>,
) -> AppSettingsPayload {
    let mut hydrated = settings.clone();

    if let Some(source) = source {
        let profile = settings
            .provider_profile::<CodexRuntimeProfile>("codex")
            .unwrap_or_default();
        let hydrated_profile = hydrate_runtime_profile_from_codex_source(&profile, source);
        let _ = hydrated.set_provider_profile("codex", &hydrated_profile);
    }

    hydrated
}

fn hydrate_settings_from_codex_home(
    settings: &AppSettingsPayload,
    root_override: Option<&Path>,
) -> AppSettingsPayload {
    let Some(root) = resolve_codex_home_root(root_override) else {
        return settings.clone();
    };

    let Some(source) = load_native_codex_toml_source(&root) else {
        return settings.clone();
    };
    hydrate_settings_from_codex_sources(settings, Some(&source))
}

fn load_or_default_app_settings_from_conn_hydrated(
    conn: &Connection,
) -> Result<AppSettingsPayload, String> {
    let settings = load_or_default_app_settings_from_conn(conn)?;
    let settings = hydrate_settings_from_claude_home(&settings, None);
    Ok(hydrate_settings_from_codex_home(&settings, None))
}

fn save_app_settings_to_conn(
    conn: &Connection,
    settings: &AppSettingsPayload,
) -> Result<AppSettingsPayload, String> {
    ensure_app_settings_row(conn)?;
    let normalized =
        normalize_app_settings_payload(serde_json::to_value(settings).map_err(|e| e.to_string())?)?;
    conn.execute(
        "INSERT INTO app_settings (id, payload, updated_at)
         VALUES (?1, ?2, ?3)
         ON CONFLICT(id) DO UPDATE SET payload = excluded.payload, updated_at = excluded.updated_at",
        params![
            APP_SETTINGS_ROW_ID,
            serde_json::to_string(&normalized).map_err(|e| e.to_string())?,
            now_ts(),
        ],
    )
    .map_err(|e| e.to_string())?;
    Ok(normalized)
}

fn should_replace_object_patch(path: &[String]) -> bool {
    let path = path.iter().map(String::as_str).collect::<Vec<_>>();
    matches!(
        path.as_slice(),
        ["claude", "global", "env"]
            | ["claude", "global", "settings_json"]
            | ["claude", "global", "global_config_json"]
            | ["codex", "global", "env"]
            | ["providers", "claude", "global", "env"]
            | ["providers", "claude", "global", "settings_json"]
            | ["providers", "claude", "global", "global_config_json"]
            | ["providers", "codex", "global", "env"]
    )
}

fn merge_settings_value(current: &mut Value, patch: Value, path: &[String]) {
    match patch {
        Value::Object(patch_map) if should_replace_object_patch(path) => {
            *current = Value::Object(patch_map);
        }
        Value::Object(patch_map) => {
            if let Value::Object(current_map) = current {
                for (key, value) in patch_map {
                    let mut next_path = path.to_vec();
                    next_path.push(key.clone());
                    if let Some(existing) = current_map.get_mut(&key) {
                        merge_settings_value(existing, value, &next_path);
                    } else {
                        current_map.insert(key, value);
                    }
                }
            } else {
                *current = Value::Object(patch_map);
            }
        }
        patch => {
            *current = patch;
        }
    }
}

fn normalize_settings_patch_key(path: &[String], key: &str) -> String {
    let path = path.iter().map(String::as_str).collect::<Vec<_>>();
    match path.as_slice() {
        [] => match key {
            "agentDefaults" => "agent_defaults".to_string(),
            _ => key.to_string(),
        },
        ["general"] => match key {
            "terminalCompatibilityMode" => "terminal_compatibility_mode".to_string(),
            "completionNotifications" => "completion_notifications".to_string(),
            "idlePolicy" => "idle_policy".to_string(),
            _ => key.to_string(),
        },
        ["general", "completion_notifications"] => match key {
            "onlyWhenBackground" => "only_when_background".to_string(),
            _ => key.to_string(),
        },
        ["general", "idle_policy"] => match key {
            "idleMinutes" => "idle_minutes".to_string(),
            "maxActive" => "max_active".to_string(),
            _ => key.to_string(),
        },
        ["claude", "global"] => match key {
            "startup_args" => "startup_args".to_string(),
            "startupArgs" => "startup_args".to_string(),
            "settingsJson" => "settings_json".to_string(),
            "globalConfigJson" => "global_config_json".to_string(),
            _ => key.to_string(),
        },
        ["codex", "global"] => match key {
            "extraArgs" => "extra_args".to_string(),
            "approvalPolicy" => "approval_policy".to_string(),
            "sandboxMode" => "sandbox_mode".to_string(),
            "webSearch" => "web_search".to_string(),
            "modelReasoningEffort" => "model_reasoning_effort".to_string(),
            _ => key.to_string(),
        },
        ["providers", "claude", "global"] => match key {
            "startupArgs" => "startup_args".to_string(),
            "settingsJson" => "settings_json".to_string(),
            "globalConfigJson" => "global_config_json".to_string(),
            _ => key.to_string(),
        },
        ["providers", "codex", "global"] => match key {
            "extraArgs" => "extra_args".to_string(),
            "approvalPolicy" => "approval_policy".to_string(),
            "sandboxMode" => "sandbox_mode".to_string(),
            "webSearch" => "web_search".to_string(),
            "modelReasoningEffort" => "model_reasoning_effort".to_string(),
            _ => key.to_string(),
        },
        _ => key.to_string(),
    }
}

fn normalize_settings_patch_value(value: Value, path: &[String]) -> Value {
    match value {
        Value::Object(object) => {
            let normalized = object
                .into_iter()
                .map(|(key, value)| {
                    let normalized_key = normalize_settings_patch_key(path, &key);
                    let mut next_path = path.to_vec();
                    next_path.push(normalized_key.clone());
                    (
                        normalized_key,
                        normalize_settings_patch_value(value, &next_path),
                    )
                })
                .collect();
            Value::Object(normalized)
        }
        other => other,
    }
}

pub(crate) fn load_or_default_app_settings(
    state: State<'_, AppState>,
) -> Result<AppSettingsPayload, String> {
    with_db(state, load_or_default_app_settings_from_conn_hydrated)
}

pub(crate) fn app_settings_get(state: State<'_, AppState>) -> Result<AppSettingsPayload, String> {
    load_or_default_app_settings(state)
}

fn app_settings_update_with_before_save_hook(
    patch: Value,
    state: State<'_, AppState>,
    before_save: impl FnOnce() -> Result<(), String>,
) -> Result<AppSettingsPayload, String> {
    let normalized_patch = normalize_settings_patch_value(patch, &Vec::<String>::new());
    with_db(state, |conn| {
        let mut current =
            serde_json::to_value(load_or_default_app_settings_from_conn_hydrated(conn)?)
                .map_err(|e| e.to_string())?;
        merge_settings_value(&mut current, normalized_patch, &[]);
        before_save()?;
        let merged = normalize_app_settings_payload(current)?;
        save_app_settings_to_conn(conn, &merged)
    })
}

pub(crate) fn app_settings_update(
    patch: Value,
    state: State<'_, AppState>,
) -> Result<AppSettingsPayload, String> {
    app_settings_update_with_before_save_hook(patch, state, || Ok(()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::runtime::RuntimeHandle;
    use std::fs;
    use std::path::Path;
    use std::sync::atomic::{AtomicBool, Ordering};
    use std::sync::Arc;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn test_app() -> AppHandle {
        let (app, _shutdown_rx) = RuntimeHandle::new();
        let conn = Connection::open_in_memory().unwrap();
        init_db(&conn).unwrap();
        *app.state().db.lock().unwrap() = Some(conn);
        app
    }

    fn unique_temp_dir(name: &str) -> PathBuf {
        let ts = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        std::env::temp_dir().join(format!("coder-studio-{name}-{ts}"))
    }

    fn write_json(path: &Path, value: Value) {
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).unwrap();
        }
        fs::write(path, serde_json::to_string_pretty(&value).unwrap()).unwrap();
    }

    fn claude_profile(settings: &AppSettingsPayload) -> ClaudeRuntimeProfile {
        settings.provider_profile("claude").unwrap_or_default()
    }

    fn codex_profile(settings: &AppSettingsPayload) -> CodexRuntimeProfile {
        settings.provider_profile("codex").unwrap_or_default()
    }

    #[test]
    fn hydrate_settings_from_claude_home_imports_auth_and_existing_file_values() {
        let root = unique_temp_dir("claude-settings-import");

        write_json(
            &root.join(".claude/settings.json"),
            json!({
                "env": {
                    "ANTHROPIC_AUTH_TOKEN": "auth-token-12345",
                    "ANTHROPIC_BASE_URL": "https://anthropic.example"
                },
                "model": "sonnet",
                "permissionMode": "auto"
            }),
        );
        write_json(
            &root.join(".claude/config.json"),
            json!({
                "primaryApiKey": "primary-api-key-12345"
            }),
        );
        write_json(
            &root.join(".claude.json"),
            json!({
                "showTurnDuration": true
            }),
        );

        let hydrated =
            hydrate_settings_from_claude_home(&AppSettingsPayload::default(), Some(root.as_path()));
        let claude = claude_profile(&hydrated);

        assert_eq!(
            claude.env.get("ANTHROPIC_API_KEY").map(String::as_str),
            Some("primary-api-key-12345")
        );
        assert_eq!(
            claude.env.get("ANTHROPIC_AUTH_TOKEN").map(String::as_str),
            Some("auth-token-12345")
        );
        assert_eq!(
            claude.env.get("ANTHROPIC_BASE_URL").map(String::as_str),
            Some("https://anthropic.example")
        );
        assert_eq!(claude.settings_json["model"], "sonnet");
        assert_eq!(claude.settings_json["permissionMode"], "auto");
        assert_eq!(claude.global_config_json["showTurnDuration"], true);

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn hydrate_settings_from_claude_home_preserves_backend_values_over_local_files() {
        let root = unique_temp_dir("claude-settings-precedence");

        write_json(
            &root.join(".claude/settings.json"),
            json!({
                "env": {
                    "ANTHROPIC_AUTH_TOKEN": "auth-token-from-file",
                    "ANTHROPIC_BASE_URL": "https://file.example"
                },
                "model": "file-model"
            }),
        );
        write_json(
            &root.join(".claude/config.json"),
            json!({
                "primaryApiKey": "api-key-from-file"
            }),
        );

        let mut settings = AppSettingsPayload::default();
        let mut profile = claude_profile(&settings);
        profile
            .env
            .insert("ANTHROPIC_API_KEY".into(), "api-key-from-backend".into());
        profile.env.insert(
            "ANTHROPIC_AUTH_TOKEN".into(),
            "auth-token-from-backend".into(),
        );
        profile.settings_json = json!({
            "model": "backend-model"
        });
        settings.set_provider_profile("claude", &profile).unwrap();

        let hydrated = hydrate_settings_from_claude_home(&settings, Some(root.as_path()));
        let claude = claude_profile(&hydrated);

        assert_eq!(
            claude.env.get("ANTHROPIC_API_KEY").map(String::as_str),
            Some("api-key-from-backend")
        );
        assert_eq!(
            claude.env.get("ANTHROPIC_AUTH_TOKEN").map(String::as_str),
            Some("auth-token-from-backend")
        );
        assert_eq!(claude.settings_json["model"], "backend-model");

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn hydrate_settings_from_claude_sources_imports_current_runtime_values_into_global_profile() {
        let hydrated = hydrate_settings_from_claude_sources(
            &AppSettingsPayload::default(),
            Some(&ClaudeJsonSources {
                settings_json: Some(
                    serde_json::from_value(json!({
                        "env": {
                            "ANTHROPIC_AUTH_TOKEN": "wsl-auth-token",
                            "ANTHROPIC_BASE_URL": "https://wsl.example"
                        },
                        "model": "wsl-sonnet"
                    }))
                    .unwrap(),
                ),
                config_json: Some(
                    serde_json::from_value(json!({
                        "primaryApiKey": "wsl-primary-api-key"
                    }))
                    .unwrap(),
                ),
                global_config_json: Some(
                    serde_json::from_value(json!({
                        "showTurnDuration": true
                    }))
                    .unwrap(),
                ),
            }),
        );
        let claude = claude_profile(&hydrated);

        assert_eq!(
            claude.env.get("ANTHROPIC_API_KEY").map(String::as_str),
            Some("wsl-primary-api-key")
        );
        assert_eq!(
            claude.env.get("ANTHROPIC_AUTH_TOKEN").map(String::as_str),
            Some("wsl-auth-token")
        );
        assert_eq!(
            claude.env.get("ANTHROPIC_BASE_URL").map(String::as_str),
            Some("https://wsl.example")
        );
        assert_eq!(claude.settings_json["model"], "wsl-sonnet");
        assert_eq!(claude.global_config_json["showTurnDuration"], true);
    }

    #[test]
    fn hydrate_settings_from_codex_home_imports_existing_file_values() {
        let root = unique_temp_dir("codex-settings-import");

        if let Some(parent) = root.join(".codex/config.toml").parent() {
            fs::create_dir_all(parent).unwrap();
        }
        fs::write(
            root.join(".codex/config.toml"),
            [
                "model = \"gpt-5.4\"",
                "approval_policy = \"on-request\"",
                "sandbox_mode = \"workspace-write\"",
                "web_search = \"live\"",
                "model_reasoning_effort = \"high\"",
            ]
            .join("\n"),
        )
        .unwrap();

        let hydrated =
            hydrate_settings_from_codex_home(&AppSettingsPayload::default(), Some(root.as_path()));
        let codex = codex_profile(&hydrated);

        assert_eq!(codex.model, "gpt-5.4");
        assert_eq!(codex.approval_policy, "on-request");
        assert_eq!(codex.sandbox_mode, "workspace-write");
        assert_eq!(codex.web_search, "live");
        assert_eq!(codex.model_reasoning_effort, "high");

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn hydrate_settings_from_codex_home_preserves_backend_values_over_local_files() {
        let root = unique_temp_dir("codex-settings-precedence");

        if let Some(parent) = root.join(".codex/config.toml").parent() {
            fs::create_dir_all(parent).unwrap();
        }
        fs::write(
            root.join(".codex/config.toml"),
            [
                "model = \"gpt-5.4\"",
                "approval_policy = \"never\"",
                "sandbox_mode = \"danger-full-access\"",
            ]
            .join("\n"),
        )
        .unwrap();

        let mut settings = AppSettingsPayload::default();
        let mut profile = codex_profile(&settings);
        profile.model = "gpt-5.5".into();
        profile.approval_policy = "on-request".into();
        profile.sandbox_mode = "workspace-write".into();
        settings.set_provider_profile("codex", &profile).unwrap();

        let hydrated = hydrate_settings_from_codex_home(&settings, Some(root.as_path()));
        let codex = codex_profile(&hydrated);

        assert_eq!(codex.model, "gpt-5.5");
        assert_eq!(codex.approval_policy, "on-request");
        assert_eq!(codex.sandbox_mode, "workspace-write");

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn hydrate_settings_from_codex_sources_imports_current_runtime_values_into_global_profile() {
        let hydrated = hydrate_settings_from_codex_sources(
            &AppSettingsPayload::default(),
            Some(&toml::Table::from_iter([
                ("model".to_string(), toml::Value::String("gpt-5.4".into())),
                (
                    "approval_policy".to_string(),
                    toml::Value::String("on-request".into()),
                ),
                (
                    "sandbox_mode".to_string(),
                    toml::Value::String("workspace-write".into()),
                ),
                (
                    "model_reasoning_effort".to_string(),
                    toml::Value::String("high".into()),
                ),
            ])),
        );
        let codex = codex_profile(&hydrated);

        assert_eq!(codex.model, "gpt-5.4");
        assert_eq!(codex.approval_policy, "on-request");
        assert_eq!(codex.sandbox_mode, "workspace-write");
        assert_eq!(codex.model_reasoning_effort, "high");
    }

    #[test]
    fn app_settings_update_keeps_partial_updates_atomic() {
        let app = test_app();
        let interleaved = Arc::new(AtomicBool::new(false));
        let env_patch = json!({
            "claude": {
                "global": {
                    "env": {
                        "TEST_MARKER": "persisted-value"
                    }
                }
            }
        });

        app_settings_update_with_before_save_hook(
            json!({
                "general": {
                    "locale": "zh"
                }
            }),
            app.state(),
            {
                let app = app.clone();
                let interleaved = interleaved.clone();
                let env_patch = env_patch.clone();
                move || {
                    if let Ok(guard) = app.state().db.try_lock() {
                        drop(guard);
                        interleaved.store(true, Ordering::SeqCst);
                        app_settings_update(env_patch, app.state()).map(|_| ())?;
                    }
                    Ok(())
                }
            },
        )
        .unwrap();

        if !interleaved.load(Ordering::SeqCst) {
            app_settings_update(env_patch, app.state()).unwrap();
        }

        let saved = load_or_default_app_settings(app.state()).unwrap();
        let claude = claude_profile(&saved);
        assert_eq!(saved.general.locale, "zh");
        assert_eq!(
            claude.env.get("TEST_MARKER").map(String::as_str),
            Some("persisted-value")
        );
    }
}
