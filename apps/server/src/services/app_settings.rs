use crate::infra::db::with_db;
use crate::*;

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

fn merge_settings_value(current: &mut Value, patch: Value) {
    match (current, patch) {
        (Value::Object(current_map), Value::Object(patch_map)) => {
            for (key, value) in patch_map {
                if let Some(existing) = current_map.get_mut(&key) {
                    merge_settings_value(existing, value);
                } else {
                    current_map.insert(key, value);
                }
            }
        }
        (current, patch) => {
            *current = patch;
        }
    }
}

fn normalize_settings_patch_key(path: &[String], key: &str) -> String {
    let path = path.iter().map(String::as_str).collect::<Vec<_>>();
    match path.as_slice() {
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
        ["claude", "global"]
        | ["claude", "overrides", "native", "profile"]
        | ["claude", "overrides", "wsl", "profile"] => match key {
            "startupArgs" => "startup_args".to_string(),
            "settingsJson" => "settings_json".to_string(),
            "globalConfigJson" => "global_config_json".to_string(),
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
                    (normalized_key, normalize_settings_patch_value(value, &next_path))
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
    with_db(state, |conn| {
        ensure_app_settings_row(conn)?;
        let raw: String = conn
            .query_row(
                "SELECT payload FROM app_settings WHERE id = ?1",
                params![APP_SETTINGS_ROW_ID],
                |row| row.get(0),
            )
            .map_err(|e| e.to_string())?;
        serde_json::from_str(&raw).map_err(|e| e.to_string())
    })
}

pub(crate) fn save_app_settings(
    state: State<'_, AppState>,
    settings: &AppSettingsPayload,
) -> Result<AppSettingsPayload, String> {
    with_db(state, |conn| {
        ensure_app_settings_row(conn)?;
        conn.execute(
            "INSERT INTO app_settings (id, payload, updated_at)
             VALUES (?1, ?2, ?3)
             ON CONFLICT(id) DO UPDATE SET payload = excluded.payload, updated_at = excluded.updated_at",
            params![
                APP_SETTINGS_ROW_ID,
                serde_json::to_string(settings).map_err(|e| e.to_string())?,
                now_ts(),
            ],
        )
        .map_err(|e| e.to_string())?;
        Ok(settings.clone())
    })
}

pub(crate) fn app_settings_get(state: State<'_, AppState>) -> Result<AppSettingsPayload, String> {
    load_or_default_app_settings(state)
}

pub(crate) fn app_settings_update(
    patch: Value,
    state: State<'_, AppState>,
) -> Result<AppSettingsPayload, String> {
    let mut current =
        serde_json::to_value(load_or_default_app_settings(state)?).map_err(|e| e.to_string())?;
    merge_settings_value(
        &mut current,
        normalize_settings_patch_value(patch, &Vec::<String>::new()),
    );
    let merged: AppSettingsPayload = serde_json::from_value(current).map_err(|e| e.to_string())?;
    save_app_settings(state, &merged)
}
