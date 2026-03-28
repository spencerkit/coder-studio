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

fn load_or_default_app_settings_from_conn(conn: &Connection) -> Result<AppSettingsPayload, String> {
    ensure_app_settings_row(conn)?;
    let raw: String = conn
        .query_row(
            "SELECT payload FROM app_settings WHERE id = ?1",
            params![APP_SETTINGS_ROW_ID],
            |row| row.get(0),
        )
        .map_err(|e| e.to_string())?;
    serde_json::from_str(&raw).map_err(|e| e.to_string())
}

fn save_app_settings_to_conn(
    conn: &Connection,
    settings: &AppSettingsPayload,
) -> Result<AppSettingsPayload, String> {
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
}

fn should_replace_object_patch(path: &[String]) -> bool {
    let path = path.iter().map(String::as_str).collect::<Vec<_>>();
    matches!(
        path.as_slice(),
        ["claude", "global", "env"]
            | ["claude", "global", "settings_json"]
            | ["claude", "global", "global_config_json"]
            | ["claude", "overrides", "native", "profile", "env"]
            | ["claude", "overrides", "native", "profile", "settings_json"]
            | ["claude", "overrides", "native", "profile", "global_config_json"]
            | ["claude", "overrides", "wsl", "profile", "env"]
            | ["claude", "overrides", "wsl", "profile", "settings_json"]
            | ["claude", "overrides", "wsl", "profile", "global_config_json"]
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
    with_db(state, load_or_default_app_settings_from_conn)
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
        let mut current = serde_json::to_value(load_or_default_app_settings_from_conn(conn)?)
            .map_err(|e| e.to_string())?;
        merge_settings_value(&mut current, normalized_patch, &[]);
        before_save()?;
        let merged: AppSettingsPayload =
            serde_json::from_value(current).map_err(|e| e.to_string())?;
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
    use std::sync::atomic::{AtomicBool, Ordering};
    use std::sync::Arc;

    fn test_app() -> AppHandle {
        let (app, _shutdown_rx) = RuntimeHandle::new();
        let conn = Connection::open_in_memory().unwrap();
        init_db(&conn).unwrap();
        *app.state().db.lock().unwrap() = Some(conn);
        app
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
        assert_eq!(saved.general.locale, "zh");
        assert_eq!(
            saved
                .claude
                .global
                .env
                .get("TEST_MARKER")
                .map(String::as_str),
            Some("persisted-value")
        );
    }
}
