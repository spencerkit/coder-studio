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
    merge_settings_value(&mut current, patch);
    let merged: AppSettingsPayload = serde_json::from_value(current).map_err(|e| e.to_string())?;
    save_app_settings(state, &merged)
}
