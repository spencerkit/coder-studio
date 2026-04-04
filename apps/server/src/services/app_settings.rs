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
    let Value::Object(source) = raw else {
        return Ok(default_app_settings());
    };

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
}

type CodexTomlSource = toml::Table;

#[derive(Default)]
struct CodexConfigSources {
    config_toml: Option<CodexTomlSource>,
    auth_json: Option<Map<String, Value>>,
}

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
    }
}

fn load_native_codex_config_sources(root: &Path) -> CodexConfigSources {
    CodexConfigSources {
        config_toml: read_toml_table_file(&root.join(".codex/config.toml")),
        auth_json: read_json_object_file(&root.join(".codex/auth.json")),
    }
}

fn strip_claude_profile_for_storage(profile: &ClaudeRuntimeProfile) -> ClaudeRuntimeProfile {
    ClaudeRuntimeProfile {
        executable: profile.executable.clone(),
        startup_args: profile.startup_args.clone(),
        ..ClaudeRuntimeProfile::default()
    }
}

fn strip_codex_profile_for_storage(profile: &CodexRuntimeProfile) -> CodexRuntimeProfile {
    CodexRuntimeProfile {
        executable: profile.executable.clone(),
        extra_args: profile.extra_args.clone(),
        ..CodexRuntimeProfile::default()
    }
}

fn strip_provider_owned_fields_for_storage(settings: &AppSettingsPayload) -> AppSettingsPayload {
    let mut stripped = settings.clone();

    let claude = settings
        .provider_profile::<ClaudeRuntimeProfile>("claude")
        .unwrap_or_default();
    let _ = stripped.set_provider_profile("claude", &strip_claude_profile_for_storage(&claude));

    let codex = settings
        .provider_profile::<CodexRuntimeProfile>("codex")
        .unwrap_or_default();
    let _ = stripped.set_provider_profile("codex", &strip_codex_profile_for_storage(&codex));

    stripped
}

fn value_object_or_empty(value: &Value) -> Map<String, Value> {
    match value {
        Value::Object(map) => map.clone(),
        _ => Map::new(),
    }
}

fn json_object_to_env_map(
    source: &Map<String, Value>,
) -> std::collections::BTreeMap<String, String> {
    source
        .iter()
        .filter_map(|(key, value)| {
            value
                .as_str()
                .map(str::trim)
                .filter(|text| !text.is_empty())
                .map(|text| (key.clone(), text.to_string()))
        })
        .collect()
}

fn env_map_to_json_object(env: &std::collections::BTreeMap<String, String>) -> Map<String, Value> {
    env.iter()
        .filter_map(|(key, value)| {
            let trimmed = value.trim();
            if trimmed.is_empty() {
                None
            } else {
                Some((key.clone(), Value::String(trimmed.to_string())))
            }
        })
        .collect()
}

fn trimmed_string(value: Option<&str>) -> String {
    value
        .map(str::trim)
        .filter(|text| !text.is_empty())
        .unwrap_or_default()
        .to_string()
}

fn codex_active_provider_id(source: &CodexTomlSource) -> Option<String> {
    source
        .get("model_provider")
        .and_then(toml::Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToString::to_string)
}

fn codex_provider_table<'a>(
    source: &'a CodexTomlSource,
    provider_id: &str,
) -> Option<&'a toml::Table> {
    source
        .get("model_providers")
        .and_then(toml::Value::as_table)
        .and_then(|providers| providers.get(provider_id))
        .and_then(toml::Value::as_table)
}

fn codex_active_provider_uses_openai_auth(source: &CodexTomlSource) -> bool {
    match codex_active_provider_id(source).as_deref() {
        Some("openai") | None => true,
        Some(provider_id) => codex_provider_table(source, provider_id)
            .and_then(|provider| provider.get("requires_openai_auth"))
            .and_then(toml::Value::as_bool)
            .unwrap_or(true),
    }
}

fn codex_active_provider_env_key(source: &CodexTomlSource) -> Option<String> {
    match codex_active_provider_id(source).as_deref() {
        Some("openai") | None => None,
        Some(provider_id) => codex_provider_table(source, provider_id)
            .and_then(|provider| provider.get("env_key"))
            .and_then(toml::Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(ToString::to_string),
    }
}

fn codex_api_key_write_error(source: &CodexTomlSource) -> Option<String> {
    if codex_active_provider_uses_openai_auth(source) {
        return None;
    }

    Some(match codex_active_provider_env_key(source) {
        Some(env_key) => format!(
            "codex active provider uses env_key={env_key}; API key sync only supports OpenAI auth providers"
        ),
        None => "codex active provider does not use OpenAI auth; API key sync is unavailable"
            .to_string(),
    })
}

fn codex_provider_table_mut<'a>(
    source: &'a mut CodexTomlSource,
    provider_id: &str,
) -> &'a mut toml::Table {
    let providers_entry = source
        .entry("model_providers".to_string())
        .or_insert_with(|| toml::Value::Table(toml::Table::new()));
    if !providers_entry.is_table() {
        *providers_entry = toml::Value::Table(toml::Table::new());
    }
    let providers = providers_entry.as_table_mut().expect("table");
    let provider_entry = providers
        .entry(provider_id.to_string())
        .or_insert_with(|| toml::Value::Table(toml::Table::new()));
    if !provider_entry.is_table() {
        *provider_entry = toml::Value::Table(toml::Table::new());
    }
    provider_entry.as_table_mut().expect("table")
}

fn codex_base_url_from_sources(source: &CodexTomlSource) -> String {
    match codex_active_provider_id(source).as_deref() {
        Some("openai") | None => {
            trimmed_string(source.get("openai_base_url").and_then(toml::Value::as_str))
        }
        Some(provider_id) => trimmed_string(
            codex_provider_table(source, provider_id)
                .and_then(|provider| provider.get("base_url"))
                .and_then(toml::Value::as_str),
        ),
    }
}

fn hydrate_runtime_profile_from_claude_sources(
    profile: &ClaudeRuntimeProfile,
    sources: &ClaudeJsonSources,
) -> ClaudeRuntimeProfile {
    let mut hydrated = strip_claude_profile_for_storage(profile);

    if let Some(mut settings_json) = sources.settings_json.clone() {
        hydrated.env = match settings_json.remove("env") {
            Some(Value::Object(env_map)) => json_object_to_env_map(&env_map),
            _ => Default::default(),
        };
        hydrated.settings_json = Value::Object(settings_json);
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
    if sources.settings_json.is_none() {
        return settings.clone();
    }

    hydrate_settings_from_claude_sources(settings, Some(&sources))
}

fn hydrate_runtime_profile_from_codex_sources(
    profile: &CodexRuntimeProfile,
    sources: &CodexConfigSources,
) -> CodexRuntimeProfile {
    let mut hydrated = strip_codex_profile_for_storage(profile);
    let uses_openai_auth = sources
        .config_toml
        .as_ref()
        .map(codex_active_provider_uses_openai_auth)
        .unwrap_or(true);

    if let Some(config_toml) = &sources.config_toml {
        hydrated.model = trimmed_string(config_toml.get("model").and_then(toml::Value::as_str));
        hydrated.base_url = codex_base_url_from_sources(config_toml);
    }

    if uses_openai_auth {
        if let Some(auth_json) = &sources.auth_json {
            hydrated.api_key =
                trimmed_string(auth_json.get("OPENAI_API_KEY").and_then(Value::as_str));
        }
    }

    hydrated
}

fn hydrate_settings_from_codex_sources(
    settings: &AppSettingsPayload,
    source: Option<&CodexConfigSources>,
) -> AppSettingsPayload {
    let mut hydrated = settings.clone();

    if let Some(source) = source {
        let profile = settings
            .provider_profile::<CodexRuntimeProfile>("codex")
            .unwrap_or_default();
        let hydrated_profile = hydrate_runtime_profile_from_codex_sources(&profile, source);
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

    let sources = load_native_codex_config_sources(&root);
    if sources.config_toml.is_none() && sources.auth_json.is_none() {
        return settings.clone();
    }

    hydrate_settings_from_codex_sources(settings, Some(&sources))
}

fn load_or_default_app_settings_from_conn_hydrated_with_roots(
    conn: &Connection,
    claude_root_override: Option<&Path>,
    codex_root_override: Option<&Path>,
) -> Result<AppSettingsPayload, String> {
    let settings =
        strip_provider_owned_fields_for_storage(&load_or_default_app_settings_from_conn(conn)?);
    let settings = hydrate_settings_from_claude_home(&settings, claude_root_override);
    let settings = hydrate_settings_from_codex_home(&settings, codex_root_override);
    Ok(settings)
}

fn load_or_default_app_settings_from_conn_hydrated(
    conn: &Connection,
) -> Result<AppSettingsPayload, String> {
    load_or_default_app_settings_from_conn_hydrated_with_roots(conn, None, None)
}

fn write_text_file_atomic(path: &Path, contents: &str) -> Result<(), String> {
    let Some(parent) = path.parent() else {
        return Err(format!("invalid path: {}", path.display()));
    };

    fs::create_dir_all(parent)
        .map_err(|error| format!("failed to create {}: {error}", parent.display()))?;

    let file_name = path
        .file_name()
        .map(|name| name.to_string_lossy().to_string())
        .unwrap_or_else(|| "config".to_string());
    let temp_path = parent.join(format!(".{file_name}.{}.tmp", std::process::id()));

    fs::write(&temp_path, contents)
        .map_err(|error| format!("failed to write {}: {error}", temp_path.display()))?;
    fs::rename(&temp_path, path).map_err(|error| {
        let _ = fs::remove_file(&temp_path);
        format!("failed to replace {}: {error}", path.display())
    })
}

fn write_json_object_file(path: &Path, object: &Map<String, Value>) -> Result<(), String> {
    let serialized =
        serde_json::to_string_pretty(&Value::Object(object.clone())).map_err(|e| e.to_string())?;
    write_text_file_atomic(path, &serialized)
}

fn apply_json_value_diff(target: &mut Value, before: &Value, after: &Value) {
    if before == after {
        return;
    }

    if let (Value::Object(before_map), Value::Object(after_map)) = (before, after) {
        if let Value::Object(target_map) = target {
            let mut keys = std::collections::BTreeSet::new();
            keys.extend(before_map.keys().cloned());
            keys.extend(after_map.keys().cloned());

            for key in keys {
                match (before_map.get(&key), after_map.get(&key)) {
                    (Some(previous), Some(next)) if previous == next => {}
                    (Some(_), None) => {
                        target_map.remove(&key);
                    }
                    (None, Some(next)) => {
                        target_map.insert(key, next.clone());
                    }
                    (Some(previous), Some(next)) => {
                        if let Some(existing) = target_map.get_mut(&key) {
                            apply_json_value_diff(existing, previous, next);
                        } else {
                            target_map.insert(key, next.clone());
                        }
                    }
                    (None, None) => {}
                }
            }
            return;
        }
    }

    *target = after.clone();
}

fn apply_json_object_diff(
    target: &mut Map<String, Value>,
    before: &Map<String, Value>,
    after: &Map<String, Value>,
) {
    let mut target_value = Value::Object(target.clone());
    apply_json_value_diff(
        &mut target_value,
        &Value::Object(before.clone()),
        &Value::Object(after.clone()),
    );
    *target = match target_value {
        Value::Object(map) => map,
        _ => Map::new(),
    };
}

fn update_toml_string_field(table: &mut toml::Table, key: &str, value: &str) {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        table.remove(key);
    } else {
        table.insert(key.to_string(), toml::Value::String(trimmed.to_string()));
    }
}

fn write_claude_provider_settings(
    current_profile: &ClaudeRuntimeProfile,
    next_profile: &ClaudeRuntimeProfile,
    root_override: Option<&Path>,
) -> Result<(), String> {
    let Some(root) = resolve_claude_home_root(root_override) else {
        return Ok(());
    };

    let current_env = env_map_to_json_object(&current_profile.env);
    let next_env = env_map_to_json_object(&next_profile.env);
    let current_settings_json = value_object_or_empty(&current_profile.settings_json);
    let next_settings_json = value_object_or_empty(&next_profile.settings_json);

    if current_env == next_env && current_settings_json == next_settings_json {
        return Ok(());
    }

    let settings_path = root.join(".claude/settings.json");
    let mut latest_settings = read_json_object_file(&settings_path).unwrap_or_default();

    if current_settings_json != next_settings_json {
        apply_json_object_diff(
            &mut latest_settings,
            &current_settings_json,
            &next_settings_json,
        );
    }

    if current_env != next_env {
        let mut latest_env = latest_settings
            .remove("env")
            .and_then(|value| match value {
                Value::Object(map) => Some(map),
                _ => None,
            })
            .unwrap_or_default();
        apply_json_object_diff(&mut latest_env, &current_env, &next_env);
        if latest_env.is_empty() {
            latest_settings.remove("env");
        } else {
            latest_settings.insert("env".to_string(), Value::Object(latest_env));
        }
    }

    write_json_object_file(&settings_path, &latest_settings)?;
    Ok(())
}

fn write_codex_provider_settings(
    current_profile: &CodexRuntimeProfile,
    next_profile: &CodexRuntimeProfile,
    root_override: Option<&Path>,
) -> Result<(), String> {
    let Some(root) = resolve_codex_home_root(root_override) else {
        return Ok(());
    };

    let current_model = current_profile.model.trim();
    let next_model = next_profile.model.trim();
    let current_base_url = current_profile.base_url.trim();
    let next_base_url = next_profile.base_url.trim();
    let current_api_key = current_profile.api_key.trim();
    let next_api_key = next_profile.api_key.trim();

    let model_changed = current_model != next_model;
    let base_url_changed = current_base_url != next_base_url;
    let api_key_changed = current_api_key != next_api_key;

    if !model_changed && !base_url_changed && !api_key_changed {
        return Ok(());
    }

    let config_path = root.join(".codex/config.toml");
    let auth_path = root.join(".codex/auth.json");
    let existing_config = read_toml_table_file(&config_path);
    let existing_auth = read_json_object_file(&auth_path);
    let had_existing_auth = existing_auth.is_some();

    let mut config = existing_config.clone().unwrap_or_default();
    if api_key_changed && !next_api_key.is_empty() {
        if let Some(error) = codex_api_key_write_error(&config) {
            return Err(error);
        }
    }

    let mut config_changed = false;
    if model_changed {
        update_toml_string_field(&mut config, "model", next_model);
        config_changed = true;
    }

    if base_url_changed {
        match codex_active_provider_id(&config).as_deref() {
            Some("openai") | None => update_toml_string_field(&mut config, "openai_base_url", next_base_url),
            Some(provider_id) => {
                let provider = codex_provider_table_mut(&mut config, provider_id);
                update_toml_string_field(provider, "base_url", next_base_url);
            }
        }
        config_changed = true;
    }

    if api_key_changed && !next_api_key.is_empty() {
        match codex_active_provider_id(&config).as_deref() {
            Some("openai") | None => {}
            Some(provider_id) => {
                let provider = codex_provider_table_mut(&mut config, provider_id);
                provider.insert(
                    "requires_openai_auth".to_string(),
                    toml::Value::Boolean(true),
                );
                config_changed = true;
            }
        }
    }

    if codex_active_provider_uses_openai_auth(&config) && api_key_changed && (!next_api_key.is_empty() || had_existing_auth) {
        let needs_file_store = config
            .get("cli_auth_credentials_store")
            .and_then(toml::Value::as_str)
            != Some("file");
        if needs_file_store {
            config.insert(
                "cli_auth_credentials_store".to_string(),
                toml::Value::String("file".to_string()),
            );
            config_changed = true;
        }
    }

    if config_changed {
        let serialized = toml::to_string_pretty(&config).map_err(|e| e.to_string())?;
        write_text_file_atomic(&config_path, &serialized)?;
    }

    let mut auth_json = existing_auth.unwrap_or_default();
    let uses_openai_auth = codex_active_provider_uses_openai_auth(&config);
    if uses_openai_auth && api_key_changed {
        if next_api_key.is_empty() {
            auth_json.remove("OPENAI_API_KEY");
        } else {
            auth_json.insert(
                "OPENAI_API_KEY".to_string(),
                Value::String(next_api_key.to_string()),
            );
        }

        if had_existing_auth || !next_api_key.is_empty() {
            write_json_object_file(&auth_path, &auth_json)?;
        }
    }

    Ok(())
}

fn write_provider_settings_to_real_files_with_roots(
    current_settings: &AppSettingsPayload,
    next_settings: &AppSettingsPayload,
    claude_root_override: Option<&Path>,
    codex_root_override: Option<&Path>,
) -> Result<(), String> {
    let current_claude = current_settings
        .provider_profile::<ClaudeRuntimeProfile>("claude")
        .unwrap_or_default();
    let next_claude = next_settings
        .provider_profile::<ClaudeRuntimeProfile>("claude")
        .unwrap_or_default();
    write_claude_provider_settings(&current_claude, &next_claude, claude_root_override)?;

    let current_codex = current_settings
        .provider_profile::<CodexRuntimeProfile>("codex")
        .unwrap_or_default();
    let next_codex = next_settings
        .provider_profile::<CodexRuntimeProfile>("codex")
        .unwrap_or_default();
    write_codex_provider_settings(&current_codex, &next_codex, codex_root_override)?;

    Ok(())
}

fn write_provider_settings_to_real_files(
    current_settings: &AppSettingsPayload,
    next_settings: &AppSettingsPayload,
) -> Result<(), String> {
    write_provider_settings_to_real_files_with_roots(current_settings, next_settings, None, None)
}

fn save_app_settings_to_conn(
    conn: &Connection,
    settings: &AppSettingsPayload,
) -> Result<AppSettingsPayload, String> {
    ensure_app_settings_row(conn)?;
    let normalized =
        normalize_app_settings_payload(serde_json::to_value(settings).map_err(|e| e.to_string())?)?;
    let stored = strip_provider_owned_fields_for_storage(&normalized);
    conn.execute(
        "INSERT INTO app_settings (id, payload, updated_at)
         VALUES (?1, ?2, ?3)
         ON CONFLICT(id) DO UPDATE SET payload = excluded.payload, updated_at = excluded.updated_at",
        params![
            APP_SETTINGS_ROW_ID,
            serde_json::to_string(&stored).map_err(|e| e.to_string())?,
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
        ["providers", "claude", "global", "env"]
            | ["providers", "claude", "global", "settings_json"]
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
        ["providers", "claude", "global"] => match key {
            "startupArgs" => "startup_args".to_string(),
            "settingsJson" => "settings_json".to_string(),
            _ => key.to_string(),
        },
        ["providers", "codex", "global"] => match key {
            "extraArgs" => "extra_args".to_string(),
            "apiKey" => "api_key".to_string(),
            "baseUrl" => "base_url".to_string(),
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

fn app_settings_update_in_conn(
    conn: &Connection,
    patch: Value,
    before_save: impl FnOnce() -> Result<(), String>,
) -> Result<AppSettingsPayload, String> {
    let normalized_patch = normalize_settings_patch_value(patch, &Vec::<String>::new());
    let current_settings = load_or_default_app_settings_from_conn_hydrated(conn)?;
    let mut current = serde_json::to_value(current_settings.clone())
        .map_err(|e| e.to_string())?;
    merge_settings_value(&mut current, normalized_patch, &[]);
    before_save()?;
    let merged = normalize_app_settings_payload(current)?;
    write_provider_settings_to_real_files(&current_settings, &merged)?;
    save_app_settings_to_conn(conn, &merged)
}

fn app_settings_update_in_conn_with_roots(
    conn: &Connection,
    patch: Value,
    before_save: impl FnOnce() -> Result<(), String>,
    claude_root_override: Option<&Path>,
    codex_root_override: Option<&Path>,
) -> Result<AppSettingsPayload, String> {
    let normalized_patch = normalize_settings_patch_value(patch, &Vec::<String>::new());
    let current_settings = load_or_default_app_settings_from_conn_hydrated_with_roots(
        conn,
        claude_root_override,
        codex_root_override,
    )?;
    let mut current = serde_json::to_value(current_settings.clone()).map_err(|e| e.to_string())?;
    merge_settings_value(&mut current, normalized_patch, &[]);
    before_save()?;
    let merged = normalize_app_settings_payload(current)?;
    write_provider_settings_to_real_files_with_roots(
        &current_settings,
        &merged,
        claude_root_override,
        codex_root_override,
    )?;
    save_app_settings_to_conn(conn, &merged)
}

fn app_settings_update_with_before_save_hook(
    patch: Value,
    state: State<'_, AppState>,
    before_save: impl FnOnce() -> Result<(), String>,
) -> Result<AppSettingsPayload, String> {
    with_db(state, |conn| {
        app_settings_update_in_conn(conn, patch, before_save)
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
                    "ANTHROPIC_API_KEY": "primary-api-key-12345",
                    "ANTHROPIC_AUTH_TOKEN": "auth-token-12345",
                    "ANTHROPIC_BASE_URL": "https://anthropic.example"
                },
                "model": "sonnet",
                "permissionMode": "auto"
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

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn hydrate_settings_from_claude_home_uses_file_values_as_canonical_provider_settings() {
        let root = unique_temp_dir("claude-settings-precedence");

        write_json(
            &root.join(".claude/settings.json"),
            json!({
                "env": {
                    "ANTHROPIC_API_KEY": "api-key-from-file",
                    "ANTHROPIC_AUTH_TOKEN": "auth-token-from-file",
                    "ANTHROPIC_BASE_URL": "https://file.example"
                },
                "model": "file-model"
            }),
        );

        let mut settings = AppSettingsPayload::default();
        let mut profile = claude_profile(&settings);
        profile.executable = "claude-nightly".into();
        profile.startup_args = vec!["--verbose".into()];
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

        assert_eq!(claude.executable, "claude-nightly");
        assert_eq!(claude.startup_args, vec!["--verbose"]);
        assert_eq!(
            claude.env.get("ANTHROPIC_API_KEY").map(String::as_str),
            Some("api-key-from-file")
        );
        assert_eq!(
            claude.env.get("ANTHROPIC_AUTH_TOKEN").map(String::as_str),
            Some("auth-token-from-file")
        );
        assert_eq!(claude.settings_json["model"], "file-model");

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn hydrate_settings_from_claude_home_does_not_promote_primary_api_key_into_env() {
        let root = unique_temp_dir("claude-settings-ignore-primary-api-key");

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
                "primaryApiKey": "any"
            }),
        );

        let hydrated =
            hydrate_settings_from_claude_home(&AppSettingsPayload::default(), Some(root.as_path()));
        let claude = claude_profile(&hydrated);

        assert_eq!(
            claude.env.get("ANTHROPIC_API_KEY").map(String::as_str),
            None
        );
        assert_eq!(
            claude.env.get("ANTHROPIC_AUTH_TOKEN").map(String::as_str),
            Some("auth-token-from-file")
        );

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
                            "ANTHROPIC_API_KEY": "wsl-primary-api-key",
                            "ANTHROPIC_AUTH_TOKEN": "wsl-auth-token",
                            "ANTHROPIC_BASE_URL": "https://wsl.example"
                        },
                        "model": "wsl-sonnet"
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
                "model_provider = \"custom\"",
                "cli_auth_credentials_store = \"file\"",
                "",
                "[model_providers.custom]",
                "name = \"custom\"",
                "base_url = \"https://codex.example/v1\"",
                "requires_openai_auth = true",
                "wire_api = \"responses\"",
            ]
            .join("\n"),
        )
        .unwrap();
        write_json(
            &root.join(".codex/auth.json"),
            json!({
                "OPENAI_API_KEY": "codex-key-12345"
            }),
        );

        let hydrated =
            hydrate_settings_from_codex_home(&AppSettingsPayload::default(), Some(root.as_path()));
        let codex = codex_profile(&hydrated);

        assert_eq!(codex.model, "gpt-5.4");
        assert_eq!(codex.base_url, "https://codex.example/v1");
        assert_eq!(codex.api_key, "codex-key-12345");

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn load_or_default_hydrates_codex_home_alongside_claude_home() {
        let root = unique_temp_dir("codex-settings-load-path");
        let codex_dir = root.join(".codex");
        fs::create_dir_all(&codex_dir).unwrap();
        fs::write(
            codex_dir.join("config.toml"),
            "model = \"gpt-5.4\"\nopenai_base_url = \"https://api.openai.example/v1\"\n",
        )
        .unwrap();
        write_json(
            &codex_dir.join("auth.json"),
            json!({
                "OPENAI_API_KEY": "codex-key-12345"
            }),
        );

        let conn = Connection::open_in_memory().unwrap();
        init_db(&conn).unwrap();
        let loaded = load_or_default_app_settings_from_conn_hydrated_with_roots(
            &conn,
            None,
            Some(root.as_path()),
        )
        .unwrap();
        let codex = codex_profile(&loaded);

        assert_eq!(codex.model, "gpt-5.4");
        assert_eq!(codex.base_url, "https://api.openai.example/v1");
        assert_eq!(codex.api_key, "codex-key-12345");
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn hydrate_settings_from_codex_home_uses_file_values_as_canonical_provider_settings() {
        let root = unique_temp_dir("codex-settings-precedence");

        if let Some(parent) = root.join(".codex/config.toml").parent() {
            fs::create_dir_all(parent).unwrap();
        }
        fs::write(
            root.join(".codex/config.toml"),
            [
                "model = \"gpt-5.4\"",
                "openai_base_url = \"https://file.example/v1\"",
            ]
            .join("\n"),
        )
        .unwrap();
        write_json(
            &root.join(".codex/auth.json"),
            json!({
                "OPENAI_API_KEY": "api-key-from-file"
            }),
        );

        let mut settings = AppSettingsPayload::default();
        let mut profile = codex_profile(&settings);
        profile.executable = "codex-nightly".into();
        profile.extra_args = vec!["--full-auto".into()];
        profile.model = "gpt-5.5".into();
        profile.base_url = "https://backend.example/v1".into();
        profile.api_key = "api-key-from-backend".into();
        settings.set_provider_profile("codex", &profile).unwrap();

        let hydrated = hydrate_settings_from_codex_home(&settings, Some(root.as_path()));
        let codex = codex_profile(&hydrated);

        assert_eq!(codex.executable, "codex-nightly");
        assert_eq!(codex.extra_args, vec!["--full-auto"]);
        assert_eq!(codex.model, "gpt-5.4");
        assert_eq!(codex.base_url, "https://file.example/v1");
        assert_eq!(codex.api_key, "api-key-from-file");

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn hydrate_settings_from_codex_home_ignores_openai_api_key_for_env_key_provider() {
        let root = unique_temp_dir("codex-settings-env-key-auth");

        if let Some(parent) = root.join(".codex/config.toml").parent() {
            fs::create_dir_all(parent).unwrap();
        }
        fs::write(
            root.join(".codex/config.toml"),
            [
                "model = \"gpt-5.4\"",
                "model_provider = \"custom\"",
                "",
                "[model_providers.custom]",
                "name = \"custom\"",
                "base_url = \"https://codex.example/v1\"",
                "requires_openai_auth = false",
                "env_key = \"CUSTOM_API_KEY\"",
                "wire_api = \"responses\"",
            ]
            .join("\n"),
        )
        .unwrap();
        write_json(
            &root.join(".codex/auth.json"),
            json!({
                "OPENAI_API_KEY": "codex-key-12345"
            }),
        );

        let hydrated =
            hydrate_settings_from_codex_home(&AppSettingsPayload::default(), Some(root.as_path()));
        let codex = codex_profile(&hydrated);

        assert_eq!(codex.model, "gpt-5.4");
        assert_eq!(codex.base_url, "https://codex.example/v1");
        assert_eq!(codex.api_key, "");

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn hydrate_settings_from_codex_sources_imports_current_runtime_values_into_global_profile() {
        let hydrated = hydrate_settings_from_codex_sources(
            &AppSettingsPayload::default(),
            Some(&CodexConfigSources {
                config_toml: Some(toml::Table::from_iter([
                    ("model".to_string(), toml::Value::String("gpt-5.4".into())),
                    (
                        "openai_base_url".to_string(),
                        toml::Value::String("https://api.openai.example/v1".into()),
                    ),
                ])),
                auth_json: Some(
                    serde_json::from_value(json!({
                        "OPENAI_API_KEY": "codex-key-12345"
                    }))
                    .unwrap(),
                ),
            }),
        );
        let codex = codex_profile(&hydrated);

        assert_eq!(codex.model, "gpt-5.4");
        assert_eq!(codex.base_url, "https://api.openai.example/v1");
        assert_eq!(codex.api_key, "codex-key-12345");
    }

    #[test]
    fn normalize_app_settings_payload_ignores_root_legacy_provider_sections() {
        let normalized = normalize_app_settings_payload(json!({
            "claude": {
                "global": {
                    "executable": "claude-nightly",
                    "startup_args": ["--verbose"]
                }
            },
            "codex": {
                "global": {
                    "model": "gpt-5.4",
                    "approval_policy": "on-request"
                }
            }
        }))
        .unwrap();

        let claude = claude_profile(&normalized);
        let codex = codex_profile(&normalized);
        assert_eq!(claude.executable, "claude");
        assert!(claude.startup_args.is_empty());
        assert_eq!(codex.model, "");
        assert_eq!(codex.api_key, "");
    }

    #[test]
    fn save_app_settings_to_conn_strips_provider_owned_fields_from_db_storage() {
        let conn = Connection::open_in_memory().unwrap();
        init_db(&conn).unwrap();

        let mut settings = AppSettingsPayload::default();
        let mut claude = claude_profile(&settings);
        claude.executable = "claude-nightly".into();
        claude.startup_args = vec!["--verbose".into()];
        claude
            .env
            .insert("ANTHROPIC_API_KEY".into(), "claude-key".into());
        claude.settings_json = json!({ "model": "sonnet" });
        settings.set_provider_profile("claude", &claude).unwrap();

        let mut codex = codex_profile(&settings);
        codex.executable = "codex-nightly".into();
        codex.extra_args = vec!["--full-auto".into()];
        codex.model = "gpt-5.4".into();
        codex.api_key = "codex-key".into();
        codex.base_url = "https://codex.example/v1".into();
        settings.set_provider_profile("codex", &codex).unwrap();

        save_app_settings_to_conn(&conn, &settings).unwrap();

        let stored = load_or_default_app_settings_from_conn(&conn).unwrap();
        let stored_claude = claude_profile(&stored);
        let stored_codex = codex_profile(&stored);

        assert_eq!(stored_claude.executable, "claude-nightly");
        assert_eq!(stored_claude.startup_args, vec!["--verbose"]);
        assert!(stored_claude.env.is_empty());
        assert_eq!(stored_claude.settings_json, json!({}));

        assert_eq!(stored_codex.executable, "codex-nightly");
        assert_eq!(stored_codex.extra_args, vec!["--full-auto"]);
        assert_eq!(stored_codex.model, "");
        assert_eq!(stored_codex.api_key, "");
        assert_eq!(stored_codex.base_url, "");
    }

    #[test]
    fn app_settings_update_writes_real_provider_files_and_keeps_db_for_startup_fields_only() {
        let app = test_app();
        let root = unique_temp_dir("provider-write-through");
        let db_guard = app.state().db.lock().unwrap();
        let updated = app_settings_update_in_conn_with_roots(
            db_guard.as_ref().unwrap(),
            json!({
                "providers": {
                    "claude": {
                        "global": {
                            "executable": "claude-nightly",
                            "startup_args": ["--verbose"],
                            "env": {
                                "ANTHROPIC_API_KEY": "claude-key",
                                "ANTHROPIC_BASE_URL": "https://anthropic.example"
                            },
                            "settings_json": {
                                "model": "sonnet"
                            }
                        }
                    },
                    "codex": {
                        "global": {
                            "executable": "codex-nightly",
                            "extra_args": ["--full-auto"],
                            "model": "gpt-5.4",
                            "api_key": "codex-key",
                            "base_url": "https://codex.example/v1"
                        }
                    }
                }
            }),
            || Ok(()),
            Some(root.as_path()),
            Some(root.as_path()),
        )
        .unwrap();
        drop(db_guard);

        let claude = claude_profile(&updated);
        let codex = codex_profile(&updated);
        assert_eq!(claude.executable, "claude-nightly");
        assert_eq!(codex.executable, "codex-nightly");
        assert_eq!(codex.api_key, "codex-key");
        assert_eq!(codex.base_url, "https://codex.example/v1");

        let claude_settings = read_json_object_file(&root.join(".claude/settings.json")).unwrap();
        assert_eq!(
            claude_settings
                .get("env")
                .and_then(Value::as_object)
                .and_then(|env| env.get("ANTHROPIC_API_KEY"))
                .and_then(Value::as_str),
            Some("claude-key")
        );
        assert_eq!(
            claude_settings.get("model").and_then(Value::as_str),
            Some("sonnet")
        );

        assert!(!root.join(".claude.json").exists());

        let codex_config = read_toml_table_file(&root.join(".codex/config.toml")).unwrap();
        assert_eq!(
            codex_config.get("model").and_then(toml::Value::as_str),
            Some("gpt-5.4")
        );
        assert_eq!(
            codex_config
                .get("openai_base_url")
                .and_then(toml::Value::as_str),
            Some("https://codex.example/v1")
        );
        assert_eq!(
            codex_config
                .get("cli_auth_credentials_store")
                .and_then(toml::Value::as_str),
            Some("file")
        );

        let codex_auth = read_json_object_file(&root.join(".codex/auth.json")).unwrap();
        assert_eq!(
            codex_auth.get("OPENAI_API_KEY").and_then(Value::as_str),
            Some("codex-key")
        );

        let db_guard = app.state().db.lock().unwrap();
        let stored = load_or_default_app_settings_from_conn(db_guard.as_ref().unwrap()).unwrap();
        let stored_claude = claude_profile(&stored);
        let stored_codex = codex_profile(&stored);
        assert_eq!(stored_claude.executable, "claude-nightly");
        assert!(stored_claude.env.is_empty());
        assert_eq!(stored_codex.executable, "codex-nightly");
        assert!(stored_codex.model.is_empty());
        assert!(stored_codex.api_key.is_empty());
        assert!(stored_codex.base_url.is_empty());

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn write_claude_provider_settings_reloads_latest_file_and_patches_only_changed_fields() {
        let root = unique_temp_dir("claude-settings-patch-latest");

        write_json(
            &root.join(".claude/settings.json"),
            json!({
                "env": {
                    "ANTHROPIC_BASE_URL": "https://old.example",
                    "UNCHANGED_ENV": "keep"
                },
                "model": "old-model",
                "permissionMode": "plan"
            }),
        );

        let current = ClaudeRuntimeProfile {
            executable: "claude".into(),
            startup_args: Vec::new(),
            env: std::collections::BTreeMap::from([
                ("ANTHROPIC_BASE_URL".into(), "https://old.example".into()),
                ("UNCHANGED_ENV".into(), "keep".into()),
            ]),
            settings_json: json!({
                "model": "old-model",
                "permissionMode": "plan"
            }),
        };

        write_json(
            &root.join(".claude/settings.json"),
            json!({
                "env": {
                    "ANTHROPIC_BASE_URL": "https://old.example",
                    "UNCHANGED_ENV": "keep",
                    "LATEST_ONLY_ENV": "preserve"
                },
                "model": "old-model",
                "permissionMode": "plan",
                "cleanupPeriodDays": 30
            }),
        );

        let mut next = current.clone();
        next.settings_json = json!({
            "model": "new-model",
            "permissionMode": "plan"
        });

        write_claude_provider_settings(&current, &next, Some(root.as_path())).unwrap();

        let saved = read_json_object_file(&root.join(".claude/settings.json")).unwrap();
        assert_eq!(saved.get("model").and_then(Value::as_str), Some("new-model"));
        assert_eq!(
            saved.get("permissionMode").and_then(Value::as_str),
            Some("plan")
        );
        assert_eq!(
            saved.get("cleanupPeriodDays").and_then(Value::as_i64),
            Some(30)
        );
        assert_eq!(
            saved.get("env")
                .and_then(Value::as_object)
                .and_then(|env| env.get("UNCHANGED_ENV"))
                .and_then(Value::as_str),
            Some("keep")
        );
        assert_eq!(
            saved.get("env")
                .and_then(Value::as_object)
                .and_then(|env| env.get("LATEST_ONLY_ENV"))
                .and_then(Value::as_str),
            Some("preserve")
        );

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn write_codex_provider_settings_reloads_latest_files_and_patches_only_changed_fields() {
        let root = unique_temp_dir("codex-settings-patch-latest");
        if let Some(parent) = root.join(".codex/config.toml").parent() {
            fs::create_dir_all(parent).unwrap();
        }

        fs::write(
            root.join(".codex/config.toml"),
            r#"
model = "old-model"
openai_base_url = "https://old.example/v1"
service_tier = "fast"
"#,
        )
        .unwrap();
        write_json(
            &root.join(".codex/auth.json"),
            json!({
                "OPENAI_API_KEY": "old-key"
            }),
        );

        let current = CodexRuntimeProfile {
            executable: "codex".into(),
            extra_args: Vec::new(),
            model: "old-model".into(),
            api_key: "old-key".into(),
            base_url: "https://old.example/v1".into(),
        };

        fs::write(
            root.join(".codex/config.toml"),
            r#"
model = "old-model"
openai_base_url = "https://old.example/v1"
service_tier = "fast"
disable_response_storage = true
"#,
        )
        .unwrap();
        write_json(
            &root.join(".codex/auth.json"),
            json!({
                "OPENAI_API_KEY": "old-key",
                "LATEST_ONLY": "preserve"
            }),
        );

        let mut next = current.clone();
        next.model = "new-model".into();

        write_codex_provider_settings(&current, &next, Some(root.as_path())).unwrap();

        let saved_config = read_toml_table_file(&root.join(".codex/config.toml")).unwrap();
        assert_eq!(
            saved_config.get("model").and_then(toml::Value::as_str),
            Some("new-model")
        );
        assert_eq!(
            saved_config
                .get("openai_base_url")
                .and_then(toml::Value::as_str),
            Some("https://old.example/v1")
        );
        assert_eq!(
            saved_config.get("service_tier").and_then(toml::Value::as_str),
            Some("fast")
        );
        assert_eq!(
            saved_config
                .get("disable_response_storage")
                .and_then(toml::Value::as_bool),
            Some(true)
        );

        let saved_auth = read_json_object_file(&root.join(".codex/auth.json")).unwrap();
        assert_eq!(
            saved_auth.get("OPENAI_API_KEY").and_then(Value::as_str),
            Some("old-key")
        );
        assert_eq!(
            saved_auth.get("LATEST_ONLY").and_then(Value::as_str),
            Some("preserve")
        );

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn app_settings_update_surfaces_provider_write_errors_without_persisting_db_changes() {
        let app = test_app();
        let broken_root = unique_temp_dir("provider-write-error");
        fs::write(&broken_root, "not-a-directory").unwrap();
        let db_guard = app.state().db.lock().unwrap();
        let result = app_settings_update_in_conn_with_roots(
            db_guard.as_ref().unwrap(),
            json!({
                "providers": {
                    "codex": {
                        "global": {
                            "executable": "codex-nightly",
                            "extra_args": ["--full-auto"],
                            "model": "gpt-5.4",
                            "api_key": "codex-key",
                            "base_url": "https://codex.example/v1"
                        }
                    }
                }
            }),
            || Ok(()),
            None,
            Some(broken_root.as_path()),
        );
        drop(db_guard);

        let error = result.expect_err("provider write failure should bubble up");
        assert!(error.contains("Not a directory") || error.contains("not a directory"));

        let stored = load_or_default_app_settings(app.state()).unwrap();
        let codex = codex_profile(&stored);
        assert_eq!(codex.executable, "codex");
        assert!(codex.extra_args.is_empty());

        let _ = fs::remove_file(broken_root);
    }

    #[test]
    fn app_settings_update_rejects_codex_api_key_for_env_key_provider() {
        let app = test_app();
        let root = unique_temp_dir("codex-settings-write-env-key-auth");
        if let Some(parent) = root.join(".codex/config.toml").parent() {
            fs::create_dir_all(parent).unwrap();
        }
        fs::write(
            root.join(".codex/config.toml"),
            [
                "model = \"gpt-5.4\"",
                "model_provider = \"custom\"",
                "",
                "[model_providers.custom]",
                "name = \"custom\"",
                "base_url = \"https://codex.example/v1\"",
                "requires_openai_auth = false",
                "env_key = \"CUSTOM_API_KEY\"",
                "wire_api = \"responses\"",
            ]
            .join("\n"),
        )
        .unwrap();

        let db_guard = app.state().db.lock().unwrap();
        let result = app_settings_update_in_conn_with_roots(
            db_guard.as_ref().unwrap(),
            json!({
                "providers": {
                    "codex": {
                        "global": {
                            "model": "gpt-5.4",
                            "api_key": "codex-key",
                            "base_url": "https://codex.example/v1"
                        }
                    }
                }
            }),
            || Ok(()),
            None,
            Some(root.as_path()),
        );
        drop(db_guard);

        let error =
            result.expect_err("env_key providers should reject auth.json OPENAI_API_KEY writes");
        assert!(error.contains("env_key"));

        let loaded = read_json_object_file(&root.join(".codex/auth.json"));
        assert!(loaded.is_none());

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn app_settings_update_keeps_partial_updates_atomic() {
        let app = test_app();
        let interleaved = Arc::new(AtomicBool::new(false));
        let env_patch = json!({
            "providers": {
                "claude": {
                    "global": {
                        "startup_args": ["--dangerously-skip-permissions"]
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
        assert_eq!(claude.startup_args, vec!["--dangerously-skip-permissions"]);
    }
}
