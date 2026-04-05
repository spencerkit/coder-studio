use crate::infra::time::now_ts_ms;
use crate::*;
use serde::de::DeserializeOwned;
#[cfg(test)]
use std::sync::atomic::{AtomicUsize, Ordering};
#[cfg(test)]
use std::thread::ThreadId;

const TERMINAL_STREAM_LIMIT: usize = 200_000;
const AGENT_LIFECYCLE_HISTORY_LIMIT_PER_SESSION: i64 = 128;
const APP_UI_STATE_ROW_ID: i64 = 1;
const APP_SETTINGS_ROW_ID: i64 = 1;
const DB_SCHEMA_VERSION: i64 = 4;
const DEFAULT_SESSION_SLOT_ID: &str = "slot-primary";
const SESSION_TIMESTAMP_MILLIS_THRESHOLD: i64 = 1_000_000_000_000;
const MISSING_PROVIDER_SESSION_REASON: &str = "该会话已经被删除，无法恢复";

#[cfg(test)]
static WITH_DB_CALL_COUNT: AtomicUsize = AtomicUsize::new(0);
#[cfg(test)]
static WITH_DB_COUNT_OWNER: Mutex<Option<ThreadId>> = Mutex::new(None);
#[cfg(test)]
static WORKSPACE_SESSION_QUERY_COUNT: AtomicUsize = AtomicUsize::new(0);

#[derive(Clone, Serialize, Deserialize)]
struct DeviceWorkbenchUiState {
    open_workspace_ids: Vec<String>,
    layout: WorkbenchLayout,
}

#[derive(Clone, Serialize, Deserialize)]
struct ClientWorkbenchUiState {
    active_workspace_id: Option<String>,
}

#[derive(Clone)]
struct WorkspaceRow {
    id: String,
    title: String,
    root_path: String,
    source_kind: WorkspaceSourceKind,
    source_value: String,
    git_url: Option<String>,
    target: ExecTarget,
    idle_policy: IdlePolicy,
}

#[derive(Clone)]
struct SessionRow {
    id: i64,
    workspace_id: String,
    archived_at: Option<i64>,
    sort_order: i64,
    payload: String,
}

#[derive(Clone)]
struct PersistedTerminalRow {
    terminal_id: u64,
    output: String,
    recoverable: bool,
}

fn json_string<T: Serialize>(value: &T) -> Result<String, String> {
    serde_json::to_string(value).map_err(|e| e.to_string())
}

fn parse_json<T: DeserializeOwned>(value: &str) -> Result<T, String> {
    serde_json::from_str(value).map_err(|e| e.to_string())
}

fn default_workbench_layout() -> WorkbenchLayout {
    WorkbenchLayout {
        left_width: 320.0,
        right_width: 320.0,
        right_split: 64.0,
        show_code_panel: false,
        show_terminal_panel: false,
    }
}

fn default_ui_state() -> WorkbenchUiState {
    WorkbenchUiState {
        open_workspace_ids: Vec::new(),
        active_workspace_id: None,
        layout: default_workbench_layout(),
    }
}

fn default_file_preview_value() -> Value {
    json!({
        "path": "",
        "content": "",
        "mode": "preview",
        "originalContent": "",
        "modifiedContent": "",
        "dirty": false
    })
}

fn session_title(id: &str) -> String {
    format!("Session {}", id)
}

#[cfg(test)]
fn archive_entry_id(session_id: &str, archived_at: i64) -> u64 {
    let session_hash = session_id.bytes().fold(0u64, |acc, byte| {
        acc.wrapping_mul(131).wrapping_add(byte as u64)
    });
    ((archived_at as u64) << 32) ^ session_hash
}

fn session_timestamp_to_millis(value: i64) -> i64 {
    if value > 0 && value < SESSION_TIMESTAMP_MILLIS_THRESHOLD {
        value.saturating_mul(1000)
    } else {
        value
    }
}

fn migrate_session_last_active_at_payload(payload: &str) -> Result<String, rusqlite::Error> {
    let mut value: Value =
        serde_json::from_str(payload).map_err(|error| schema_migration_error(error.to_string()))?;
    let object = value
        .as_object_mut()
        .ok_or_else(|| schema_migration_error("session_payload_must_be_object"))?;
    if let Some(last_active_at) = object.get("last_active_at").and_then(Value::as_i64) {
        object.insert(
            "last_active_at".to_string(),
            Value::from(session_timestamp_to_millis(last_active_at)),
        );
    }
    serde_json::to_string(&value).map_err(|error| schema_migration_error(error.to_string()))
}

fn workspace_title_from_path(path: &str) -> String {
    PathBuf::from(path)
        .file_name()
        .map(|value| value.to_string_lossy().to_string())
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| "Workspace".to_string())
}

fn random_hex(bytes_len: usize) -> Result<String, String> {
    let mut bytes = vec![0u8; bytes_len];
    getrandom::getrandom(&mut bytes).map_err(|e| e.to_string())?;
    Ok(bytes.iter().map(|byte| format!("{byte:02x}")).collect())
}

fn workspace_id() -> Result<String, String> {
    Ok(format!("ws_{}", random_hex(8)?))
}

fn session_slot_id() -> Result<String, String> {
    Ok(format!("slot_{}", random_hex(8)?))
}

fn parse_source_kind(value: &str) -> Result<WorkspaceSourceKind, String> {
    match value {
        "local" => Ok(WorkspaceSourceKind::Local),
        "remote" => Ok(WorkspaceSourceKind::Remote),
        other => Err(format!("invalid_workspace_source_kind:{other}")),
    }
}

fn workspace_source_label(kind: &WorkspaceSourceKind) -> &'static str {
    match kind {
        WorkspaceSourceKind::Local => "local",
        WorkspaceSourceKind::Remote => "remote",
    }
}

fn parse_workspace_row(row: &rusqlite::Row<'_>) -> Result<WorkspaceRow, rusqlite::Error> {
    let source_kind: String = row.get("source_kind")?;
    let target_json: String = row.get("target_json")?;
    let idle_policy_json: String = row.get("idle_policy_json")?;
    Ok(WorkspaceRow {
        id: row.get("id")?,
        title: row.get("title")?,
        root_path: row.get("root_path")?,
        source_kind: parse_source_kind(&source_kind).map_err(|e| {
            rusqlite::Error::FromSqlConversionFailure(
                0,
                rusqlite::types::Type::Text,
                Box::new(std::io::Error::other(e)),
            )
        })?,
        source_value: row.get("source_value")?,
        git_url: row.get("git_url")?,
        target: parse_json(&target_json).map_err(|e| {
            rusqlite::Error::FromSqlConversionFailure(
                0,
                rusqlite::types::Type::Text,
                Box::new(std::io::Error::other(e)),
            )
        })?,
        idle_policy: parse_json(&idle_policy_json).map_err(|e| {
            rusqlite::Error::FromSqlConversionFailure(
                0,
                rusqlite::types::Type::Text,
                Box::new(std::io::Error::other(e)),
            )
        })?,
    })
}

fn row_to_workspace_summary(row: WorkspaceRow) -> WorkspaceSummary {
    WorkspaceSummary {
        workspace_id: row.id,
        title: row.title,
        project_path: row.root_path,
        source_kind: row.source_kind,
        source_value: row.source_value,
        git_url: row.git_url,
        target: row.target,
        idle_policy: row.idle_policy,
    }
}

fn load_workspace_row(conn: &Connection, workspace_id: &str) -> Result<WorkspaceRow, String> {
    let mut stmt = conn
        .prepare(
            "SELECT id, title, root_path, source_kind, source_value, git_url, target_json, idle_policy_json
             FROM workspaces
             WHERE id = ?1",
        )
        .map_err(|e| e.to_string())?;
    stmt.query_row(params![workspace_id], parse_workspace_row)
        .map_err(|e| match e {
            rusqlite::Error::QueryReturnedNoRows => "workspace_not_found".to_string(),
            other => other.to_string(),
        })
}

pub(crate) fn ensure_workspace_exists_from_conn(
    conn: &Connection,
    workspace_id: &str,
) -> Result<(), String> {
    load_workspace_row(conn, workspace_id).map(|_| ())
}

fn load_workspace_row_by_root(
    conn: &Connection,
    root_path: &str,
) -> Result<Option<WorkspaceRow>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT id, title, root_path, source_kind, source_value, git_url, target_json, idle_policy_json
             FROM workspaces
             WHERE root_path = ?1",
        )
        .map_err(|e| e.to_string())?;
    match stmt.query_row(params![root_path], parse_workspace_row) {
        Ok(row) => Ok(Some(row)),
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
        Err(error) => Err(error.to_string()),
    }
}

fn load_all_workspace_rows(conn: &Connection) -> Result<Vec<WorkspaceRow>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT id, title, root_path, source_kind, source_value, git_url, target_json, idle_policy_json
             FROM workspaces
             ORDER BY last_opened_at DESC, created_at DESC, id DESC",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], parse_workspace_row)
        .map_err(|e| e.to_string())?;
    let mut items = Vec::new();
    for row in rows {
        items.push(row.map_err(|e| e.to_string())?);
    }
    Ok(items)
}

fn session_from_payload(payload: &str) -> Result<SessionInfo, String> {
    let mut value: Value = parse_json(payload)?;
    if let Some(id) = value.get_mut("id") {
        match id {
            Value::String(_) => {}
            Value::Number(number) => *id = Value::String(number.to_string()),
            other => {
                return Err(format!(
                    "session_payload_id_must_be_string_or_number:{other:?}"
                ))
            }
        }
    }
    serde_json::from_value(value).map_err(|e| e.to_string())
}

fn session_row_from_query(row: &rusqlite::Row<'_>) -> Result<SessionRow, rusqlite::Error> {
    Ok(SessionRow {
        id: row.get("id")?,
        workspace_id: row.get("workspace_id")?,
        archived_at: row.get("archived_at")?,
        sort_order: row.get("sort_order")?,
        payload: row.get("payload")?,
    })
}

fn load_session_row_by_row_id(
    conn: &Connection,
    workspace_id: &str,
    row_id: u64,
) -> Result<SessionRow, String> {
    let mut stmt = conn
        .prepare(
            "SELECT id, workspace_id, archived_at, sort_order, payload
             FROM workspace_sessions
             WHERE workspace_id = ?1 AND id = ?2",
        )
        .map_err(|e| e.to_string())?;
    stmt.query_row(params![workspace_id, row_id as i64], session_row_from_query)
        .map_err(|e| match e {
            rusqlite::Error::QueryReturnedNoRows => "session_not_found".to_string(),
            other => other.to_string(),
        })
}

fn load_session_row_by_session_id(
    conn: &Connection,
    workspace_id: &str,
    session_id: &str,
) -> Result<SessionRow, String> {
    let mut stmt = conn
        .prepare(
            "SELECT id, workspace_id, archived_at, sort_order, payload
             FROM workspace_sessions
             WHERE workspace_id = ?1",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(params![workspace_id], session_row_from_query)
        .map_err(|e| e.to_string())?;
    for row in rows {
        let row = row.map_err(|e| e.to_string())?;
        let session = session_from_payload(&row.payload)?;
        if session.id == session_id {
            return Ok(row);
        }
    }
    Err("session_not_found".to_string())
}

fn load_session_row<S: ToString>(
    conn: &Connection,
    workspace_id: &str,
    session_id: S,
) -> Result<SessionRow, String> {
    let session_id = session_id.to_string();
    if let Ok(row) = load_session_row_by_session_id(conn, workspace_id, &session_id) {
        return Ok(row);
    }
    if let Ok(row_id) = session_id.parse::<u64>() {
        return load_session_row_by_row_id(conn, workspace_id, row_id);
    }
    Err("session_not_found".to_string())
}

fn persist_session_row(
    conn: &Connection,
    workspace_id: &str,
    row_id: i64,
    session: &SessionInfo,
    archived_at: Option<i64>,
    sort_order: i64,
) -> Result<(), String> {
    let payload = json_string(session)?;
    conn.execute(
        "UPDATE workspace_sessions
         SET status = ?3,
             last_active_at = ?4,
             provider = ?5,
             resume_id = ?6,
             payload = ?7,
             archived_at = ?8,
             sort_order = ?9
         WHERE workspace_id = ?1 AND id = ?2",
        params![
            workspace_id,
            row_id,
            status_label(&session.status),
            session.last_active_at,
            serde_json::to_string(&session.provider).map_err(|e| e.to_string())?,
            session.resume_id,
            payload,
            archived_at,
            sort_order,
        ],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

fn recreate_all_tables(conn: &Connection) -> Result<(), rusqlite::Error> {
    conn.execute_batch(
        "DROP TABLE IF EXISTS app_client_ui_state;
        DROP TABLE IF EXISTS app_device_ui_state;
        DROP TABLE IF EXISTS app_settings;
        DROP TABLE IF EXISTS app_ui_state;
        DROP TABLE IF EXISTS agent_lifecycle_events;
        DROP TABLE IF EXISTS workspace_terminals;
        DROP TABLE IF EXISTS workspace_attachments;
        DROP TABLE IF EXISTS workspace_controller_leases;
        DROP TABLE IF EXISTS workspace_view_state;
        DROP TABLE IF EXISTS workspace_sessions;
        DROP TABLE IF EXISTS workspaces;",
    )
}

fn schema_migration_error(message: impl Into<String>) -> rusqlite::Error {
    rusqlite::Error::ToSqlConversionFailure(Box::new(std::io::Error::other(message.into())))
}

fn table_has_column(
    conn: &Connection,
    table_name: &str,
    column_name: &str,
) -> Result<bool, rusqlite::Error> {
    let pragma = format!("PRAGMA table_info({table_name})");
    let mut stmt = conn.prepare(&pragma)?;
    let rows = stmt.query_map([], |row| row.get::<_, String>(1))?;
    for row in rows {
        if row? == column_name {
            return Ok(true);
        }
    }
    Ok(false)
}

fn migrate_legacy_session_payload(
    payload: &str,
    resume_id: Option<&str>,
) -> Result<String, rusqlite::Error> {
    let mut value: Value =
        serde_json::from_str(payload).map_err(|error| schema_migration_error(error.to_string()))?;
    let object = value
        .as_object_mut()
        .ok_or_else(|| schema_migration_error("legacy_session_payload_must_be_object"))?;
    object
        .entry("provider".to_string())
        .or_insert(serde_json::json!(AgentProvider::claude()));
    object
        .entry("resume_id".to_string())
        .or_insert_with(|| match resume_id {
            Some(value) => Value::String(value.to_string()),
            None => Value::Null,
        });
    object.remove("claude_session_id");
    serde_json::to_string(&value).map_err(|error| schema_migration_error(error.to_string()))
}

fn migrate_workspace_sessions_v2_to_v3(conn: &Connection) -> Result<(), rusqlite::Error> {
    #[derive(Clone)]
    struct LegacyWorkspaceSessionRow {
        id: i64,
        workspace_id: String,
        archived_at: Option<i64>,
        sort_order: i64,
        last_active_at: i64,
        status: String,
        resume_id: Option<String>,
        payload: String,
    }

    let mut stmt = conn.prepare(
        "SELECT id, workspace_id, archived_at, sort_order, last_active_at, status, claude_session_id, payload
         FROM workspace_sessions
         ORDER BY id ASC",
    )?;
    let rows = stmt.query_map([], |row| {
        Ok(LegacyWorkspaceSessionRow {
            id: row.get(0)?,
            workspace_id: row.get(1)?,
            archived_at: row.get(2)?,
            sort_order: row.get(3)?,
            last_active_at: row.get(4)?,
            status: row.get(5)?,
            resume_id: row.get(6)?,
            payload: row.get(7)?,
        })
    })?;
    let mut legacy_rows = Vec::new();
    for row in rows {
        legacy_rows.push(row?);
    }

    let provider = serde_json::to_string(&AgentProvider::claude())
        .map_err(|error| schema_migration_error(error.to_string()))?;

    conn.execute_batch("SAVEPOINT workspace_sessions_v2_to_v3")?;
    let migration = (|| -> Result<(), rusqlite::Error> {
        conn.execute(
            "ALTER TABLE workspace_sessions RENAME TO workspace_sessions_legacy_v2",
            [],
        )?;
        conn.execute_batch(
            "CREATE TABLE workspace_sessions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                workspace_id TEXT NOT NULL,
                archived_at INTEGER,
                sort_order INTEGER NOT NULL,
                last_active_at INTEGER NOT NULL,
                status TEXT NOT NULL,
                provider TEXT NOT NULL,
                resume_id TEXT,
                payload TEXT NOT NULL,
                FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
            );",
        )?;
        for row in legacy_rows {
            let payload = migrate_legacy_session_payload(&row.payload, row.resume_id.as_deref())?;
            conn.execute(
                "INSERT INTO workspace_sessions (id, workspace_id, archived_at, sort_order, last_active_at, status, provider, resume_id, payload)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
                params![
                    row.id,
                    row.workspace_id,
                    row.archived_at,
                    row.sort_order,
                    row.last_active_at,
                    row.status,
                    provider,
                    row.resume_id,
                    payload,
                ],
            )?;
        }
        conn.execute("DROP TABLE workspace_sessions_legacy_v2", [])?;
        Ok(())
    })();

    match migration {
        Ok(()) => {
            conn.execute_batch("RELEASE SAVEPOINT workspace_sessions_v2_to_v3")?;
            Ok(())
        }
        Err(error) => {
            let _ = conn.execute_batch(
                "ROLLBACK TO SAVEPOINT workspace_sessions_v2_to_v3;
                 RELEASE SAVEPOINT workspace_sessions_v2_to_v3;",
            );
            Err(error)
        }
    }
}

fn migrate_schema_v2_to_v3(conn: &Connection) -> Result<(), rusqlite::Error> {
    let has_provider = table_has_column(conn, "workspace_sessions", "provider")?;
    let has_resume_id = table_has_column(conn, "workspace_sessions", "resume_id")?;
    let has_claude_session_id = table_has_column(conn, "workspace_sessions", "claude_session_id")?;

    if has_claude_session_id {
        return migrate_workspace_sessions_v2_to_v3(conn);
    }
    if has_provider && has_resume_id {
        return Ok(());
    }
    if !has_provider && !has_resume_id {
        return Ok(());
    }
    recreate_all_tables(conn)
}

fn migrate_schema_v3_to_v4(conn: &Connection) -> Result<(), rusqlite::Error> {
    if !table_has_column(conn, "workspace_sessions", "last_active_at")? {
        return Ok(());
    }

    #[derive(Clone)]
    struct WorkspaceSessionTimestampRow {
        id: i64,
        last_active_at: i64,
        payload: String,
    }

    let mut stmt = conn.prepare(
        "SELECT id, last_active_at, payload
         FROM workspace_sessions
         ORDER BY id ASC",
    )?;
    let rows = stmt.query_map([], |row| {
        Ok(WorkspaceSessionTimestampRow {
            id: row.get(0)?,
            last_active_at: row.get(1)?,
            payload: row.get(2)?,
        })
    })?;
    let mut session_rows = Vec::new();
    for row in rows {
        session_rows.push(row?);
    }

    conn.execute_batch("SAVEPOINT workspace_sessions_v3_to_v4")?;
    let migration = (|| -> Result<(), rusqlite::Error> {
        for row in session_rows {
            conn.execute(
                "UPDATE workspace_sessions
                 SET last_active_at = ?2,
                     payload = ?3
                 WHERE id = ?1",
                params![
                    row.id,
                    session_timestamp_to_millis(row.last_active_at),
                    migrate_session_last_active_at_payload(&row.payload)?,
                ],
            )?;
        }
        Ok(())
    })();

    match migration {
        Ok(()) => {
            conn.execute_batch("RELEASE SAVEPOINT workspace_sessions_v3_to_v4")?;
            Ok(())
        }
        Err(error) => {
            let _ = conn.execute_batch(
                "ROLLBACK TO SAVEPOINT workspace_sessions_v3_to_v4;
                 RELEASE SAVEPOINT workspace_sessions_v3_to_v4;",
            );
            Err(error)
        }
    }
}

fn ensure_schema_version(conn: &Connection) -> Result<(), rusqlite::Error> {
    let mut current_version: i64 = conn.query_row("PRAGMA user_version", [], |row| row.get(0))?;
    loop {
        match current_version {
            0 | DB_SCHEMA_VERSION => break,
            2 => {
                migrate_schema_v2_to_v3(conn)?;
                current_version = 3;
            }
            3 => {
                migrate_schema_v3_to_v4(conn)?;
                current_version = 4;
            }
            _ => {
                recreate_all_tables(conn)?;
                break;
            }
        }
    }
    conn.pragma_update(None, "user_version", DB_SCHEMA_VERSION)?;
    Ok(())
}

pub(crate) fn init_db(conn: &Connection) -> Result<(), rusqlite::Error> {
    ensure_schema_version(conn)?;
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS workspaces (
            id TEXT PRIMARY KEY,
            title TEXT NOT NULL,
            root_path TEXT NOT NULL UNIQUE,
            source_kind TEXT NOT NULL,
            source_value TEXT NOT NULL,
            git_url TEXT,
            target_json TEXT NOT NULL,
            idle_policy_json TEXT NOT NULL,
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL,
            last_opened_at INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS workspace_sessions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            workspace_id TEXT NOT NULL,
            archived_at INTEGER,
            sort_order INTEGER NOT NULL,
            last_active_at INTEGER NOT NULL,
            status TEXT NOT NULL,
            provider TEXT NOT NULL,
            resume_id TEXT,
            payload TEXT NOT NULL,
            FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS idx_workspace_sessions_workspace_active
            ON workspace_sessions(workspace_id, archived_at, sort_order, last_active_at DESC);
        CREATE UNIQUE INDEX IF NOT EXISTS idx_workspace_sessions_workspace_provider_resume
            ON workspace_sessions(workspace_id, provider, resume_id)
            WHERE resume_id IS NOT NULL;
        CREATE TABLE IF NOT EXISTS workspace_view_state (
            workspace_id TEXT PRIMARY KEY,
            payload TEXT NOT NULL,
            updated_at INTEGER NOT NULL,
            FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
        );
        CREATE TABLE IF NOT EXISTS workspace_controller_leases (
            workspace_id TEXT PRIMARY KEY,
            payload TEXT NOT NULL,
            updated_at INTEGER NOT NULL,
            FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
        );
        CREATE TABLE IF NOT EXISTS workspace_attachments (
            attachment_id TEXT PRIMARY KEY,
            workspace_id TEXT NOT NULL,
            device_id TEXT NOT NULL,
            client_id TEXT NOT NULL,
            role TEXT NOT NULL,
            attached_at INTEGER NOT NULL,
            last_seen_at INTEGER NOT NULL,
            detached_at INTEGER,
            FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
        );
        CREATE TABLE IF NOT EXISTS workspace_terminals (
            workspace_id TEXT NOT NULL,
            terminal_id INTEGER NOT NULL,
            output TEXT NOT NULL,
            recoverable INTEGER NOT NULL DEFAULT 1,
            updated_at INTEGER NOT NULL,
            PRIMARY KEY (workspace_id, terminal_id),
            FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
        );
        CREATE TABLE IF NOT EXISTS agent_lifecycle_events (
            workspace_id TEXT NOT NULL,
            session_id TEXT NOT NULL,
            seq INTEGER NOT NULL,
            kind TEXT NOT NULL,
            source_event TEXT NOT NULL,
            data TEXT NOT NULL,
            created_at INTEGER NOT NULL,
            PRIMARY KEY (workspace_id, session_id, seq),
            FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
        );
        CREATE TABLE IF NOT EXISTS app_ui_state (
            id INTEGER PRIMARY KEY CHECK (id = 1),
            payload TEXT NOT NULL,
            updated_at INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS app_settings (
            id INTEGER PRIMARY KEY CHECK (id = 1),
            payload TEXT NOT NULL,
            updated_at INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS app_device_ui_state (
            device_id TEXT PRIMARY KEY,
            payload TEXT NOT NULL,
            updated_at INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS app_client_ui_state (
            device_id TEXT NOT NULL,
            client_id TEXT NOT NULL,
            payload TEXT NOT NULL,
            updated_at INTEGER NOT NULL,
            PRIMARY KEY (device_id, client_id)
        );",
    )?;
    let payload = serde_json::to_string(&default_ui_state()).unwrap_or_else(|_| "{}".to_string());
    conn.execute(
        "INSERT OR IGNORE INTO app_ui_state (id, payload, updated_at) VALUES (?1, ?2, ?3)",
        params![APP_UI_STATE_ROW_ID, payload, now_ts()],
    )?;
    let app_settings_payload =
        serde_json::to_string(&AppSettingsPayload::default()).unwrap_or_else(|_| "{}".to_string());
    conn.execute(
        "INSERT OR IGNORE INTO app_settings (id, payload, updated_at) VALUES (?1, ?2, ?3)",
        params![APP_SETTINGS_ROW_ID, app_settings_payload, now_ts()],
    )?;
    conn.execute(
        "UPDATE workspace_terminals SET recoverable = 0, updated_at = ?1",
        params![now_ts()],
    )?;
    Ok(())
}

fn min_active_sort_order(conn: &Connection, workspace_id: &str) -> Result<i64, String> {
    let value: Option<i64> = conn
        .query_row(
            "SELECT MIN(sort_order) FROM workspace_sessions WHERE workspace_id = ?1 AND archived_at IS NULL",
            params![workspace_id],
            |row| row.get(0),
        )
        .map_err(|e| e.to_string())?;
    Ok(value.unwrap_or(1))
}

fn load_legacy_ui_state_from_conn(conn: &Connection) -> Result<WorkbenchUiState, String> {
    let payload: String = conn
        .query_row(
            "SELECT payload FROM app_ui_state WHERE id = ?1",
            params![APP_UI_STATE_ROW_ID],
            |row| row.get(0),
        )
        .map_err(|e| e.to_string())?;
    parse_json(&payload)
}

fn save_legacy_ui_state_to_conn(
    conn: &Connection,
    ui_state: &WorkbenchUiState,
) -> Result<(), String> {
    let payload = json_string(ui_state)?;
    conn.execute(
        "INSERT INTO app_ui_state (id, payload, updated_at)
         VALUES (?1, ?2, ?3)
         ON CONFLICT(id) DO UPDATE SET payload = excluded.payload, updated_at = excluded.updated_at",
        params![APP_UI_STATE_ROW_ID, payload, now_ts()],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

fn scoped_ui_ids<'a>(
    device_id: Option<&'a str>,
    client_id: Option<&'a str>,
) -> Option<(&'a str, &'a str)> {
    let device_id = device_id?.trim();
    let client_id = client_id?.trim();
    if device_id.is_empty() || client_id.is_empty() {
        return None;
    }
    Some((device_id, client_id))
}

fn load_device_ui_state_from_conn(
    conn: &Connection,
    device_id: Option<&str>,
) -> Result<DeviceWorkbenchUiState, String> {
    let Some(device_id) = device_id.map(str::trim).filter(|value| !value.is_empty()) else {
        let legacy = load_legacy_ui_state_from_conn(conn)?;
        return Ok(DeviceWorkbenchUiState {
            open_workspace_ids: legacy.open_workspace_ids,
            layout: legacy.layout,
        });
    };

    let payload = conn.query_row(
        "SELECT payload FROM app_device_ui_state WHERE device_id = ?1",
        params![device_id],
        |row| row.get::<_, String>(0),
    );
    match payload {
        Ok(value) => parse_json(&value),
        Err(rusqlite::Error::QueryReturnedNoRows) => {
            let legacy =
                load_legacy_ui_state_from_conn(conn).unwrap_or_else(|_| default_ui_state());
            Ok(DeviceWorkbenchUiState {
                open_workspace_ids: legacy.open_workspace_ids,
                layout: legacy.layout,
            })
        }
        Err(error) => Err(error.to_string()),
    }
}

fn save_device_ui_state_to_conn(
    conn: &Connection,
    device_id: Option<&str>,
    ui_state: &DeviceWorkbenchUiState,
) -> Result<(), String> {
    let Some(device_id) = device_id.map(str::trim).filter(|value| !value.is_empty()) else {
        return save_legacy_ui_state_to_conn(
            conn,
            &WorkbenchUiState {
                open_workspace_ids: ui_state.open_workspace_ids.clone(),
                active_workspace_id: load_legacy_ui_state_from_conn(conn)
                    .ok()
                    .and_then(|state| state.active_workspace_id),
                layout: ui_state.layout.clone(),
            },
        );
    };

    let payload = json_string(ui_state)?;
    conn.execute(
        "INSERT INTO app_device_ui_state (device_id, payload, updated_at)
         VALUES (?1, ?2, ?3)
         ON CONFLICT(device_id) DO UPDATE SET payload = excluded.payload, updated_at = excluded.updated_at",
        params![device_id, payload, now_ts()],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

fn load_client_ui_state_from_conn(
    conn: &Connection,
    device_id: Option<&str>,
    client_id: Option<&str>,
) -> Result<ClientWorkbenchUiState, String> {
    let Some((device_id, client_id)) = scoped_ui_ids(device_id, client_id) else {
        let legacy = load_legacy_ui_state_from_conn(conn)?;
        return Ok(ClientWorkbenchUiState {
            active_workspace_id: legacy.active_workspace_id,
        });
    };

    let payload = conn.query_row(
        "SELECT payload FROM app_client_ui_state WHERE device_id = ?1 AND client_id = ?2",
        params![device_id, client_id],
        |row| row.get::<_, String>(0),
    );
    match payload {
        Ok(value) => parse_json(&value),
        Err(rusqlite::Error::QueryReturnedNoRows) => {
            let legacy =
                load_legacy_ui_state_from_conn(conn).unwrap_or_else(|_| default_ui_state());
            Ok(ClientWorkbenchUiState {
                active_workspace_id: legacy.active_workspace_id,
            })
        }
        Err(error) => Err(error.to_string()),
    }
}

fn save_client_ui_state_to_conn(
    conn: &Connection,
    device_id: Option<&str>,
    client_id: Option<&str>,
    ui_state: &ClientWorkbenchUiState,
) -> Result<(), String> {
    let Some((device_id, client_id)) = scoped_ui_ids(device_id, client_id) else {
        return save_legacy_ui_state_to_conn(
            conn,
            &WorkbenchUiState {
                open_workspace_ids: load_legacy_ui_state_from_conn(conn)
                    .unwrap_or_else(|_| default_ui_state())
                    .open_workspace_ids,
                active_workspace_id: ui_state.active_workspace_id.clone(),
                layout: load_legacy_ui_state_from_conn(conn)
                    .unwrap_or_else(|_| default_ui_state())
                    .layout,
            },
        );
    };

    let payload = json_string(ui_state)?;
    conn.execute(
        "INSERT INTO app_client_ui_state (device_id, client_id, payload, updated_at)
         VALUES (?1, ?2, ?3, ?4)
         ON CONFLICT(device_id, client_id) DO UPDATE SET payload = excluded.payload, updated_at = excluded.updated_at",
        params![device_id, client_id, payload, now_ts()],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

fn compose_workbench_ui_state(
    mut device_state: DeviceWorkbenchUiState,
    mut client_state: ClientWorkbenchUiState,
) -> WorkbenchUiState {
    device_state.open_workspace_ids =
        device_state
            .open_workspace_ids
            .into_iter()
            .fold(Vec::new(), |mut items, workspace_id| {
                if !items.iter().any(|item| item == &workspace_id) {
                    items.push(workspace_id);
                }
                items
            });
    if let Some(active) = client_state.active_workspace_id.as_deref() {
        if !device_state
            .open_workspace_ids
            .iter()
            .any(|workspace_id| workspace_id == active)
        {
            client_state.active_workspace_id = device_state.open_workspace_ids.first().cloned();
        }
    } else {
        client_state.active_workspace_id = device_state.open_workspace_ids.first().cloned();
    }

    WorkbenchUiState {
        open_workspace_ids: device_state.open_workspace_ids,
        active_workspace_id: client_state.active_workspace_id,
        layout: device_state.layout,
    }
}

fn load_ui_state_from_conn(
    conn: &Connection,
    device_id: Option<&str>,
    client_id: Option<&str>,
) -> Result<WorkbenchUiState, String> {
    if scoped_ui_ids(device_id, client_id).is_none() {
        return load_legacy_ui_state_from_conn(conn);
    }
    let device_state = load_device_ui_state_from_conn(conn, device_id)?;
    let client_state = load_client_ui_state_from_conn(conn, device_id, client_id)?;
    Ok(compose_workbench_ui_state(device_state, client_state))
}

fn save_ui_state_to_conn(
    conn: &Connection,
    device_id: Option<&str>,
    client_id: Option<&str>,
    ui_state: &WorkbenchUiState,
) -> Result<(), String> {
    if scoped_ui_ids(device_id, client_id).is_none() {
        return save_legacy_ui_state_to_conn(conn, ui_state);
    }
    save_device_ui_state_to_conn(
        conn,
        device_id,
        &DeviceWorkbenchUiState {
            open_workspace_ids: ui_state.open_workspace_ids.clone(),
            layout: ui_state.layout.clone(),
        },
    )?;
    save_client_ui_state_to_conn(
        conn,
        device_id,
        client_id,
        &ClientWorkbenchUiState {
            active_workspace_id: ui_state.active_workspace_id.clone(),
        },
    )
}

fn default_view_state(active_session_id: String) -> WorkspaceViewState {
    WorkspaceViewState {
        active_session_id: active_session_id.clone(),
        active_pane_id: format!("pane-{active_session_id}"),
        active_terminal_id: String::new(),
        pane_layout: json!({
            "type": "leaf",
            "id": format!("pane-{active_session_id}"),
            "sessionId": active_session_id,
        }),
        file_preview: default_file_preview_value(),
        session_bindings: Vec::new(),
    }
}

fn derive_legacy_session_bindings_from_conn(
    conn: &Connection,
    workspace_id: &str,
    view_state: &WorkspaceViewState,
) -> Result<Vec<WorkspaceSessionBinding>, String> {
    let mut mounted_session_ids = HashSet::new();
    collect_pane_session_ids(&view_state.pane_layout, &mut mounted_session_ids);
    if mounted_session_ids.is_empty() {
        return Ok(Vec::new());
    }

    let mut stmt = conn
        .prepare(
            "SELECT id, workspace_id, archived_at, sort_order, payload
             FROM workspace_sessions
             WHERE workspace_id = ?1
               AND archived_at IS NULL
               AND provider IS NOT NULL
               AND resume_id IS NOT NULL
             ORDER BY sort_order ASC, last_active_at DESC, id DESC",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(params![workspace_id], session_row_from_query)
        .map_err(|e| e.to_string())?;
    let mut bindings = Vec::new();
    for row in rows {
        let row = row.map_err(|e| e.to_string())?;
        let session = session_from_payload(&row.payload)?;
        if !mounted_session_ids.contains(&session.id) {
            continue;
        }
        let Some(resume_id) = session.resume_id.clone() else {
            continue;
        };
        bindings.push(WorkspaceSessionBinding {
            session_id: session.id,
            provider: session.provider,
            resume_id,
            title_snapshot: session.title,
            last_seen_at: session.last_active_at,
        });
    }
    Ok(bindings)
}

fn load_view_state_from_conn(
    conn: &Connection,
    workspace_id: &str,
) -> Result<WorkspaceViewState, String> {
    let payload: String = conn
        .query_row(
            "SELECT payload FROM workspace_view_state WHERE workspace_id = ?1",
            params![workspace_id],
            |row| row.get(0),
        )
        .map_err(|e| match e {
            rusqlite::Error::QueryReturnedNoRows => "workspace_view_not_found".to_string(),
            other => other.to_string(),
        })?;
    let value: Value = parse_json(&payload)?;
    let needs_binding_migration = value
        .as_object()
        .map(|object| !object.contains_key("session_bindings"))
        .unwrap_or(false);
    let mut view_state: WorkspaceViewState =
        serde_json::from_value(value).map_err(|e| e.to_string())?;
    if needs_binding_migration {
        let bindings = derive_legacy_session_bindings_from_conn(conn, workspace_id, &view_state)?;
        view_state.session_bindings = bindings;
        save_view_state_to_conn(conn, workspace_id, &view_state)?;
    }
    Ok(view_state)
}

fn save_view_state_to_conn(
    conn: &Connection,
    workspace_id: &str,
    view_state: &WorkspaceViewState,
) -> Result<(), String> {
    let payload = json_string(view_state)?;
    conn.execute(
        "INSERT INTO workspace_view_state (workspace_id, payload, updated_at)
         VALUES (?1, ?2, ?3)
         ON CONFLICT(workspace_id) DO UPDATE SET payload = excluded.payload, updated_at = excluded.updated_at",
        params![workspace_id, payload, now_ts()],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

fn persisted_terminal_row_from_query(
    row: &rusqlite::Row<'_>,
) -> Result<PersistedTerminalRow, rusqlite::Error> {
    Ok(PersistedTerminalRow {
        terminal_id: row.get::<_, i64>("terminal_id")? as u64,
        output: row.get("output")?,
        recoverable: row.get::<_, i64>("recoverable")? != 0,
    })
}

fn load_persisted_terminals_from_conn(
    conn: &Connection,
    workspace_id: &str,
) -> Result<Vec<PersistedTerminalRow>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT terminal_id, output, recoverable
             FROM workspace_terminals
             WHERE workspace_id = ?1
             ORDER BY terminal_id ASC",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(params![workspace_id], persisted_terminal_row_from_query)
        .map_err(|e| e.to_string())?;
    rows.map(|row| row.map_err(|e| e.to_string())).collect()
}

fn persist_terminal_row(
    conn: &Connection,
    workspace_id: &str,
    terminal_id: u64,
    output: &str,
    recoverable: bool,
) -> Result<(), String> {
    conn.execute(
        "INSERT INTO workspace_terminals (workspace_id, terminal_id, output, recoverable, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5)
         ON CONFLICT(workspace_id, terminal_id) DO UPDATE SET output = excluded.output, recoverable = excluded.recoverable, updated_at = excluded.updated_at",
        params![
            workspace_id,
            terminal_id as i64,
            truncate_tail(output, TERMINAL_STREAM_LIMIT),
            if recoverable { 1 } else { 0 },
            now_ts(),
        ],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

fn set_terminal_recoverable(
    conn: &Connection,
    workspace_id: &str,
    terminal_id: u64,
    recoverable: bool,
) -> Result<(), String> {
    conn.execute(
        "UPDATE workspace_terminals
         SET recoverable = ?3, updated_at = ?4
         WHERE workspace_id = ?1 AND terminal_id = ?2",
        params![
            workspace_id,
            terminal_id as i64,
            if recoverable { 1 } else { 0 },
            now_ts()
        ],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

fn append_terminal_output(
    conn: &Connection,
    workspace_id: &str,
    terminal_id: u64,
    chunk: &str,
) -> Result<(), String> {
    let existing = load_persisted_terminals_from_conn(conn, workspace_id)?
        .into_iter()
        .find(|row| row.terminal_id == terminal_id)
        .map(|row| row.output);
    let Some(existing) = existing else {
        return Ok(());
    };
    persist_terminal_row(
        conn,
        workspace_id,
        terminal_id,
        &format!("{existing}{chunk}"),
        true,
    )
}

fn delete_persisted_terminal(
    conn: &Connection,
    workspace_id: &str,
    terminal_id: u64,
) -> Result<(), String> {
    conn.execute(
        "DELETE FROM workspace_terminals WHERE workspace_id = ?1 AND terminal_id = ?2",
        params![workspace_id, terminal_id as i64],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

fn agent_lifecycle_history_entry_from_query(
    row: &rusqlite::Row<'_>,
) -> Result<AgentLifecycleHistoryEntry, rusqlite::Error> {
    Ok(AgentLifecycleHistoryEntry {
        workspace_id: row.get("workspace_id")?,
        session_id: row.get("session_id")?,
        seq: row.get("seq")?,
        kind: row.get("kind")?,
        source_event: row.get("source_event")?,
        data: row.get("data")?,
    })
}

fn next_agent_lifecycle_seq(
    conn: &Connection,
    workspace_id: &str,
    session_id: &str,
) -> Result<i64, String> {
    conn.query_row(
        "SELECT COALESCE(MAX(seq), 0) + 1
         FROM agent_lifecycle_events
         WHERE workspace_id = ?1 AND session_id = ?2",
        params![workspace_id, session_id],
        |row| row.get::<_, i64>(0),
    )
    .map_err(|e| e.to_string())
}

fn append_agent_lifecycle_event_to_conn(
    conn: &Connection,
    workspace_id: &str,
    session_id: &str,
    kind: &str,
    source_event: &str,
    data: &str,
) -> Result<AgentLifecycleHistoryEntry, String> {
    let seq = next_agent_lifecycle_seq(conn, workspace_id, session_id)?;
    conn.execute(
        "INSERT INTO agent_lifecycle_events (workspace_id, session_id, seq, kind, source_event, data, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        params![workspace_id, session_id, seq, kind, source_event, data, now_ts()],
    )
    .map_err(|e| e.to_string())?;

    let cutoff = seq.saturating_sub(AGENT_LIFECYCLE_HISTORY_LIMIT_PER_SESSION);
    if cutoff > 0 {
        conn.execute(
            "DELETE FROM agent_lifecycle_events
             WHERE workspace_id = ?1 AND session_id = ?2 AND seq <= ?3",
            params![workspace_id, session_id, cutoff],
        )
        .map_err(|e| e.to_string())?;
    }

    Ok(AgentLifecycleHistoryEntry {
        workspace_id: workspace_id.to_string(),
        session_id: session_id.to_string(),
        seq,
        kind: kind.to_string(),
        source_event: source_event.to_string(),
        data: data.to_string(),
    })
}

pub(crate) fn load_agent_lifecycle_events_from_conn(
    conn: &Connection,
    workspace_id: &str,
    limit: usize,
) -> Result<Vec<AgentLifecycleHistoryEntry>, String> {
    if limit == 0 {
        return Ok(Vec::new());
    }

    let mut stmt = conn
        .prepare(
            "SELECT workspace_id, session_id, seq, kind, source_event, data
             FROM (
                 SELECT workspace_id, session_id, seq, kind, source_event, data, created_at
                 FROM agent_lifecycle_events
                 WHERE workspace_id = ?1
                 ORDER BY created_at DESC, session_id DESC, seq DESC
                 LIMIT ?2
             )
             ORDER BY created_at ASC, session_id ASC, seq ASC",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(
            params![workspace_id, limit as i64],
            agent_lifecycle_history_entry_from_query,
        )
        .map_err(|e| e.to_string())?;
    rows.map(|row| row.map_err(|e| e.to_string())).collect()
}

fn default_workspace_controller_lease(workspace_id: &str) -> WorkspaceControllerLease {
    WorkspaceControllerLease {
        workspace_id: workspace_id.to_string(),
        controller_device_id: None,
        controller_client_id: None,
        lease_expires_at: 0,
        fencing_token: 0,
        takeover_request_id: None,
        takeover_requested_by_device_id: None,
        takeover_requested_by_client_id: None,
        takeover_deadline_at: None,
    }
}

pub(crate) fn load_workspace_controller_lease_from_conn(
    conn: &Connection,
    workspace_id: &str,
) -> Result<WorkspaceControllerLease, String> {
    let payload = conn.query_row(
        "SELECT payload FROM workspace_controller_leases WHERE workspace_id = ?1",
        params![workspace_id],
        |row| row.get::<_, String>(0),
    );

    match payload {
        Ok(value) => parse_json(&value),
        Err(rusqlite::Error::QueryReturnedNoRows) => {
            Ok(default_workspace_controller_lease(workspace_id))
        }
        Err(error) => Err(error.to_string()),
    }
}

pub(crate) fn save_workspace_controller_lease_to_conn(
    conn: &Connection,
    lease: &WorkspaceControllerLease,
) -> Result<(), String> {
    conn.execute(
        "INSERT INTO workspace_controller_leases (workspace_id, payload, updated_at)
         VALUES (?1, ?2, ?3)
         ON CONFLICT(workspace_id) DO UPDATE SET payload = excluded.payload, updated_at = excluded.updated_at",
        params![lease.workspace_id, json_string(lease)?, now_ts()],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

pub(crate) fn upsert_workspace_attachment_to_conn(
    conn: &Connection,
    workspace_id: &str,
    device_id: &str,
    client_id: &str,
    role: &str,
) -> Result<(), String> {
    let attachment_id = format!("{workspace_id}:{device_id}:{client_id}");
    conn.execute(
        "INSERT INTO workspace_attachments (attachment_id, workspace_id, device_id, client_id, role, attached_at, last_seen_at, detached_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?6, NULL)
         ON CONFLICT(attachment_id) DO UPDATE SET role = excluded.role, last_seen_at = excluded.last_seen_at, detached_at = NULL",
        params![attachment_id, workspace_id, device_id, client_id, role, now_ts()],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

pub(crate) fn list_workspace_ids_for_workspace_client_from_conn(
    conn: &Connection,
    device_id: &str,
    client_id: &str,
) -> Result<Vec<String>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT DISTINCT workspace_id
             FROM workspace_attachments
             WHERE device_id = ?1 AND client_id = ?2 AND detached_at IS NULL",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(params![device_id, client_id], |row| row.get::<_, String>(0))
        .map_err(|e| e.to_string())?;
    let mut workspace_ids = Vec::new();
    for row in rows {
        workspace_ids.push(row.map_err(|e| e.to_string())?);
    }
    Ok(workspace_ids)
}

pub(crate) fn mark_workspace_client_detached_from_conn(
    conn: &Connection,
    device_id: &str,
    client_id: &str,
) -> Result<(), String> {
    conn.execute(
        "UPDATE workspace_attachments
         SET detached_at = ?3
         WHERE device_id = ?1 AND client_id = ?2 AND detached_at IS NULL",
        params![device_id, client_id, now_ts()],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

fn load_all_session_rows_from_conn(
    conn: &Connection,
    workspace_id: &str,
) -> Result<Vec<SessionRow>, String> {
    #[cfg(test)]
    record_workspace_session_query_count();
    let mut stmt = conn
        .prepare(
            "SELECT id, workspace_id, archived_at, sort_order, payload
             FROM workspace_sessions
             WHERE workspace_id = ?1
             ORDER BY last_active_at DESC, id DESC",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(params![workspace_id], session_row_from_query)
        .map_err(|e| e.to_string())?;
    let mut items = Vec::new();
    for row in rows {
        items.push(row.map_err(|e| e.to_string())?);
    }
    Ok(items)
}

fn load_snapshot_sessions_from_conn(
    conn: &Connection,
    workspace_id: &str,
) -> Result<Vec<SessionInfo>, String> {
    #[cfg(test)]
    record_workspace_session_query_count();
    let mut stmt = conn
        .prepare(
            "SELECT id, workspace_id, archived_at, sort_order, payload
             FROM workspace_sessions
             WHERE workspace_id = ?1
             ORDER BY
                CASE WHEN archived_at IS NULL THEN 0 ELSE 1 END ASC,
                CASE WHEN archived_at IS NULL THEN sort_order END ASC,
                CASE WHEN archived_at IS NULL THEN last_active_at END DESC,
                CASE WHEN archived_at IS NULL THEN id END DESC,
                CASE WHEN archived_at IS NOT NULL THEN archived_at END DESC,
                CASE WHEN archived_at IS NOT NULL THEN id END DESC",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(params![workspace_id], session_row_from_query)
        .map_err(|e| e.to_string())?;
    let mut sessions = Vec::new();
    for row in rows {
        let row = row.map_err(|e| e.to_string())?;
        if row.archived_at.is_none() {
            let session = session_from_payload(&row.payload)?;
            sessions.push(session);
        }
    }
    Ok(sessions)
}

fn collect_ordered_pane_session_ids(
    value: &Value,
    ordered: &mut Vec<String>,
    seen: &mut HashSet<String>,
) {
    let Value::Object(map) = value else {
        return;
    };
    let Some(Value::String(kind)) = map.get("type") else {
        return;
    };

    if kind == "leaf" {
        if let Some(Value::String(session_id)) =
            map.get("session_id").or_else(|| map.get("sessionId"))
        {
            if seen.insert(session_id.clone()) {
                ordered.push(session_id.clone());
            }
        }
        return;
    }

    if kind == "split" {
        if let Some(next) = map.get("first") {
            collect_ordered_pane_session_ids(next, ordered, seen);
        }
        if let Some(next) = map.get("second") {
            collect_ordered_pane_session_ids(next, ordered, seen);
        }
    }
}

fn ordered_visible_session_ids(view_state: &WorkspaceViewState) -> Vec<String> {
    let mut ordered = Vec::new();
    let mut seen = HashSet::new();
    if !view_state.active_session_id.trim().is_empty()
        && seen.insert(view_state.active_session_id.clone())
    {
        ordered.push(view_state.active_session_id.clone());
    }
    collect_ordered_pane_session_ids(&view_state.pane_layout, &mut ordered, &mut seen);
    ordered
}

fn list_provider_workspace_sessions(
    workspace_path: &str,
) -> Result<Vec<ProviderWorkspaceSession>, String> {
    let mut sessions = Vec::new();
    for provider_id in [AgentProvider::claude(), AgentProvider::codex()] {
        let Some(adapter) =
            crate::services::provider_registry::resolve_provider_adapter(provider_id.as_str())
        else {
            continue;
        };
        match adapter.list_workspace_sessions(workspace_path) {
            Ok(provider_sessions) => sessions.extend(provider_sessions),
            Err(error) => {
                eprintln!(
                    "failed to list provider sessions provider={} workspace_path={workspace_path}: {error}",
                    provider_id.as_str()
                );
            }
        }
    }
    Ok(sessions)
}

fn provider_session_for_binding<'a>(
    provider_sessions: &'a [ProviderWorkspaceSession],
    binding: &WorkspaceSessionBinding,
) -> Option<&'a ProviderWorkspaceSession> {
    provider_sessions.iter().find(|session| {
        session.provider == binding.provider && session.resume_id == binding.resume_id
    })
}

fn session_placeholder(
    session_id: &str,
    title: String,
    provider: AgentProvider,
    resume_id: Option<String>,
    last_active_at: i64,
    unavailable_reason: Option<String>,
) -> SessionInfo {
    SessionInfo {
        id: session_id.to_string(),
        title,
        status: SessionStatus::Interrupted,
        mode: SessionMode::Branch,
        provider,
        auto_feed: true,
        queue: Vec::new(),
        messages: Vec::new(),
        unread: 0,
        last_active_at: session_timestamp_to_millis(last_active_at),
        resume_id,
        unavailable_reason,
        runtime_active: false,
    }
}

fn resolve_bound_session_from_binding(
    binding: &WorkspaceSessionBinding,
    provider_sessions: &[ProviderWorkspaceSession],
) -> SessionInfo {
    if let Some(provider_session) = provider_session_for_binding(provider_sessions, binding) {
        return session_placeholder(
            &binding.session_id,
            provider_session.title.clone(),
            binding.provider.clone(),
            Some(binding.resume_id.clone()),
            provider_session.last_active_at,
            None,
        );
    }

    session_placeholder(
        &binding.session_id,
        if binding.title_snapshot.trim().is_empty() {
            session_title(&binding.session_id)
        } else {
            binding.title_snapshot.clone()
        },
        binding.provider.clone(),
        Some(binding.resume_id.clone()),
        binding.last_seen_at,
        Some(MISSING_PROVIDER_SESSION_REASON.to_string()),
    )
}

fn collect_pane_session_ids(value: &Value, ids: &mut HashSet<String>) {
    let Value::Object(map) = value else {
        return;
    };
    let Some(Value::String(kind)) = map.get("type") else {
        return;
    };

    if kind == "leaf" {
        if let Some(Value::String(session_id)) =
            map.get("session_id").or_else(|| map.get("sessionId"))
        {
            ids.insert(session_id.clone());
        }
        return;
    }

    if kind == "split" {
        if let Some(next) = map.get("first") {
            collect_pane_session_ids(next, ids);
        }
        if let Some(next) = map.get("second") {
            collect_pane_session_ids(next, ids);
        }
    }
}

fn build_history_from_conn(conn: &Connection) -> Result<Vec<SessionHistoryRecord>, String> {
    let mut records = Vec::new();
    for workspace in load_all_workspace_rows(conn)? {
        let view_state = load_view_state_from_conn(conn, &workspace.id)
            .unwrap_or_else(|_| default_view_state(DEFAULT_SESSION_SLOT_ID.to_string()));
        let provider_sessions = list_provider_workspace_sessions(&workspace.root_path)?;

        for provider_session in &provider_sessions {
            let mounted_binding = view_state.session_bindings.iter().find(|binding| {
                binding.provider == provider_session.provider
                    && binding.resume_id == provider_session.resume_id
            });
            records.push(SessionHistoryRecord {
                workspace_id: workspace.id.clone(),
                workspace_title: workspace.title.clone(),
                workspace_path: workspace.root_path.clone(),
                session_id: mounted_binding
                    .map(|binding| binding.session_id.clone())
                    .unwrap_or_else(|| {
                        format!(
                            "{}:{}",
                            provider_session.provider.as_str(),
                            provider_session.resume_id
                        )
                    }),
                title: provider_session.title.clone(),
                status: SessionStatus::Interrupted,
                provider: provider_session.provider.clone(),
                archived: mounted_binding.is_none(),
                mounted: mounted_binding.is_some(),
                availability: "available".to_string(),
                recoverable: true,
                created_at: provider_session.created_at,
                last_active_at: provider_session.last_active_at,
                archived_at: None,
                resume_id: Some(provider_session.resume_id.clone()),
            });
        }

        for binding in &view_state.session_bindings {
            if provider_session_for_binding(&provider_sessions, binding).is_some() {
                continue;
            }
            records.push(SessionHistoryRecord {
                workspace_id: workspace.id.clone(),
                workspace_title: workspace.title.clone(),
                workspace_path: workspace.root_path.clone(),
                session_id: binding.session_id.clone(),
                title: if binding.title_snapshot.trim().is_empty() {
                    session_title(&binding.session_id)
                } else {
                    binding.title_snapshot.clone()
                },
                status: SessionStatus::Interrupted,
                provider: binding.provider.clone(),
                archived: false,
                mounted: true,
                availability: "missing".to_string(),
                recoverable: false,
                created_at: binding.last_seen_at,
                last_active_at: binding.last_seen_at,
                archived_at: None,
                resume_id: Some(binding.resume_id.clone()),
            });
        }
    }
    records.sort_by(|left, right| {
        right
            .last_active_at
            .cmp(&left.last_active_at)
            .then_with(|| left.workspace_id.cmp(&right.workspace_id))
            .then_with(|| left.session_id.cmp(&right.session_id))
    });
    Ok(records)
}

fn load_mounted_session_ids_from_conn(conn: &Connection, workspace_id: &str) -> HashSet<String> {
    load_view_state_from_conn(conn, workspace_id)
        .ok()
        .map(|view_state| {
            let mut ids = HashSet::new();
            collect_pane_session_ids(&view_state.pane_layout, &mut ids);
            ids
        })
        .unwrap_or_default()
}

pub(crate) fn build_snapshot_from_conn(
    conn: &Connection,
    workspace_id: &str,
) -> Result<WorkspaceSnapshot, String> {
    let workspace = row_to_workspace_summary(load_workspace_row(conn, workspace_id)?);
    let row_sessions = load_snapshot_sessions_from_conn(conn, workspace_id)?;
    let mut view_state = match load_view_state_from_conn(conn, workspace_id) {
        Ok(value) => value,
        Err(_) => default_view_state(
            row_sessions
                .first()
                .map(|session| session.id.clone())
                .unwrap_or_else(|| DEFAULT_SESSION_SLOT_ID.to_string()),
        ),
    };
    let visible_session_ids = ordered_visible_session_ids(&view_state);
    let provider_sessions = list_provider_workspace_sessions(&workspace.project_path)?;
    let mut sessions = Vec::new();
    let mut binding_snapshots_changed = false;

    for session_id in &visible_session_ids {
        if let Some(session) = row_sessions
            .iter()
            .find(|session| session.id == *session_id)
            .cloned()
        {
            sessions.push(session);
            continue;
        }
        let Some(binding_index) = view_state
            .session_bindings
            .iter()
            .position(|binding| binding.session_id == *session_id)
        else {
            continue;
        };
        let binding = view_state.session_bindings[binding_index].clone();
        if let Some(provider_session) = provider_session_for_binding(&provider_sessions, &binding) {
            if view_state.session_bindings[binding_index].title_snapshot != provider_session.title
                || view_state.session_bindings[binding_index].last_seen_at
                    != provider_session.last_active_at
            {
                view_state.session_bindings[binding_index].title_snapshot =
                    provider_session.title.clone();
                view_state.session_bindings[binding_index].last_seen_at =
                    provider_session.last_active_at;
                binding_snapshots_changed = true;
            }
        }
        sessions.push(resolve_bound_session_from_binding(
            &binding,
            &provider_sessions,
        ));
    }

    if binding_snapshots_changed {
        save_view_state_to_conn(conn, workspace_id, &view_state)?;
    }
    let terminals = load_persisted_terminals_from_conn(conn, workspace_id)?
        .into_iter()
        .map(|row| TerminalInfo {
            id: row.terminal_id,
            output: row.output,
            recoverable: row.recoverable,
        })
        .collect();
    Ok(WorkspaceSnapshot {
        workspace,
        sessions,
        view_state,
        terminals,
    })
}

fn build_bootstrap_from_conn(
    conn: &Connection,
    device_id: Option<&str>,
    client_id: Option<&str>,
) -> Result<WorkbenchBootstrap, String> {
    let mut ui_state = load_ui_state_from_conn(conn, device_id, client_id)?;
    let mut workspaces = Vec::new();
    let mut next_open_ids = Vec::new();
    for workspace_id in ui_state.open_workspace_ids.iter() {
        match build_snapshot_from_conn(conn, workspace_id) {
            Ok(snapshot) => {
                next_open_ids.push(workspace_id.clone());
                workspaces.push(snapshot);
            }
            Err(error) if error == "workspace_not_found" => {}
            Err(error) => return Err(error),
        }
    }
    if next_open_ids != ui_state.open_workspace_ids {
        ui_state.open_workspace_ids = next_open_ids;
        if let Some(active) = ui_state.active_workspace_id.clone() {
            if !ui_state
                .open_workspace_ids
                .iter()
                .any(|item| item == &active)
            {
                ui_state.active_workspace_id = ui_state.open_workspace_ids.first().cloned();
            }
        }
        save_ui_state_to_conn(conn, device_id, client_id, &ui_state)?;
    }
    Ok(WorkbenchBootstrap {
        ui_state,
        workspaces,
    })
}

fn ensure_workspace_open_in_ui(
    conn: &Connection,
    workspace_id: &str,
    device_id: Option<&str>,
    client_id: Option<&str>,
) -> Result<(WorkbenchUiState, bool), String> {
    let mut ui_state = load_ui_state_from_conn(conn, device_id, client_id)?;
    let already_open = ui_state
        .open_workspace_ids
        .iter()
        .any(|item| item == workspace_id);
    if !already_open {
        ui_state.open_workspace_ids.push(workspace_id.to_string());
    }
    ui_state.active_workspace_id = Some(workspace_id.to_string());
    save_ui_state_to_conn(conn, device_id, client_id, &ui_state)?;
    conn.execute(
        "UPDATE workspaces SET last_opened_at = ?2, updated_at = ?2 WHERE id = ?1",
        params![workspace_id, now_ts()],
    )
    .map_err(|e| e.to_string())?;
    Ok((ui_state, already_open))
}

fn remove_workspace_from_all_ui_state_scopes(
    conn: &Connection,
    workspace_id: &str,
    device_id: Option<&str>,
    client_id: Option<&str>,
) -> Result<WorkbenchUiState, String> {
    let legacy = load_legacy_ui_state_from_conn(conn).unwrap_or_else(|_| default_ui_state());
    let mut next_legacy = legacy.clone();
    next_legacy
        .open_workspace_ids
        .retain(|item| item != workspace_id);
    if next_legacy.active_workspace_id.as_deref() == Some(workspace_id) {
        next_legacy.active_workspace_id = next_legacy.open_workspace_ids.last().cloned();
    }
    if next_legacy.open_workspace_ids != legacy.open_workspace_ids
        || next_legacy.active_workspace_id != legacy.active_workspace_id
    {
        save_legacy_ui_state_to_conn(conn, &next_legacy)?;
    }

    {
        let mut stmt = conn
            .prepare("SELECT device_id, payload FROM app_device_ui_state")
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
            })
            .map_err(|e| e.to_string())?;
        for row in rows {
            let (device_id_row, payload) = row.map_err(|e| e.to_string())?;
            let mut ui_state: DeviceWorkbenchUiState = parse_json(&payload)?;
            let before = ui_state.open_workspace_ids.clone();
            ui_state
                .open_workspace_ids
                .retain(|item| item != workspace_id);
            if ui_state.open_workspace_ids != before {
                save_device_ui_state_to_conn(conn, Some(device_id_row.as_str()), &ui_state)?;
            }
        }
    }

    {
        let mut stmt = conn
            .prepare("SELECT device_id, client_id, payload FROM app_client_ui_state")
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                ))
            })
            .map_err(|e| e.to_string())?;
        for row in rows {
            let (device_id_row, client_id_row, payload) = row.map_err(|e| e.to_string())?;
            let mut ui_state: ClientWorkbenchUiState = parse_json(&payload)?;
            if ui_state.active_workspace_id.as_deref() == Some(workspace_id) {
                ui_state.active_workspace_id = None;
                save_client_ui_state_to_conn(
                    conn,
                    Some(device_id_row.as_str()),
                    Some(client_id_row.as_str()),
                    &ui_state,
                )?;
            }
        }
    }

    load_ui_state_from_conn(conn, device_id, client_id)
}

pub(crate) fn mark_active_sessions_interrupted_on_boot(conn: &Connection) -> Result<(), String> {
    let mut stmt = conn
        .prepare(
            "SELECT id, workspace_id, archived_at, sort_order, payload
             FROM workspace_sessions
             WHERE archived_at IS NULL",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], session_row_from_query)
        .map_err(|e| e.to_string())?;
    let debug_resume = std::env::var("CODER_STUDIO_DEBUG_RESUME")
        .map(|value| {
            let normalized = value.trim().to_ascii_lowercase();
            !normalized.is_empty() && normalized != "0" && normalized != "false"
        })
        .unwrap_or(false);
    let mut interrupted_count = 0usize;
    for row in rows {
        let row = row.map_err(|e| e.to_string())?;
        let mut session = session_from_payload(&row.payload)?;
        if !(session.runtime_active || session.status == SessionStatus::Running) {
            continue;
        }
        session.status = SessionStatus::Interrupted;
        session.runtime_active = false;
        persist_session_row(
            conn,
            &row.workspace_id,
            row.id,
            &session,
            row.archived_at,
            row.sort_order,
        )?;
        interrupted_count += 1;
    }
    if debug_resume {
        eprintln!(
            "[resume-debug] mark_active_sessions_interrupted_on_boot interrupted_count={interrupted_count}"
        );
    }
    Ok(())
}

pub(crate) fn with_db<T>(
    state: State<'_, AppState>,
    f: impl FnOnce(&Connection) -> Result<T, String>,
) -> Result<T, String> {
    with_db_mapped(state, |error| error, f)
}

pub(crate) fn with_db_mapped<T, E>(
    state: State<'_, AppState>,
    map_err: impl Fn(String) -> E,
    f: impl FnOnce(&Connection) -> Result<T, E>,
) -> Result<T, E> {
    #[cfg(test)]
    {
        let current = std::thread::current().id();
        if WITH_DB_COUNT_OWNER
            .lock()
            .ok()
            .and_then(|guard| guard.as_ref().map(|owner| owner == &current))
            .unwrap_or(false)
        {
            WITH_DB_CALL_COUNT.fetch_add(1, Ordering::SeqCst);
        }
    }
    let guard = state.db.lock().map_err(|e| map_err(e.to_string()))?;
    let conn = guard
        .as_ref()
        .ok_or_else(|| map_err("db_not_ready".to_string()))?;
    f(conn)
}

#[cfg(test)]
pub(crate) fn reset_with_db_call_count() {
    if let Ok(mut owner) = WITH_DB_COUNT_OWNER.lock() {
        *owner = Some(std::thread::current().id());
    }
    WITH_DB_CALL_COUNT.store(0, Ordering::SeqCst);
}

#[cfg(test)]
pub(crate) fn read_with_db_call_count() -> usize {
    WITH_DB_CALL_COUNT.load(Ordering::SeqCst)
}

#[cfg(test)]
fn record_workspace_session_query_count() {
    let current = std::thread::current().id();
    if WITH_DB_COUNT_OWNER
        .lock()
        .ok()
        .and_then(|guard| guard.as_ref().map(|owner| owner == &current))
        .unwrap_or(false)
    {
        WORKSPACE_SESSION_QUERY_COUNT.fetch_add(1, Ordering::SeqCst);
    }
}

#[cfg(test)]
pub(crate) fn reset_workspace_session_query_count() {
    if let Ok(mut owner) = WITH_DB_COUNT_OWNER.lock() {
        *owner = Some(std::thread::current().id());
    }
    WORKSPACE_SESSION_QUERY_COUNT.store(0, Ordering::SeqCst);
}

#[cfg(test)]
pub(crate) fn read_workspace_session_query_count() -> usize {
    WORKSPACE_SESSION_QUERY_COUNT.load(Ordering::SeqCst)
}

pub(crate) fn workbench_bootstrap(
    state: State<'_, AppState>,
    device_id: Option<&str>,
    client_id: Option<&str>,
) -> Result<WorkbenchBootstrap, String> {
    with_db(state, |conn| {
        build_bootstrap_from_conn(conn, device_id, client_id)
    })
}

pub(crate) fn workspace_snapshot(
    state: State<'_, AppState>,
    workspace_id: &str,
) -> Result<WorkspaceSnapshot, String> {
    with_db(state, |conn| build_snapshot_from_conn(conn, workspace_id))
}

fn load_workspace_slot_session_from_conn(
    conn: &Connection,
    workspace_id: &str,
    session_id: &str,
) -> Result<SessionInfo, String> {
    if let Ok(row) = load_session_row(conn, workspace_id, session_id) {
        return session_from_payload(&row.payload);
    }

    let workspace = load_workspace_row(conn, workspace_id)?;
    let mut view_state = load_view_state_from_conn(conn, workspace_id).or_else(|_| {
        Ok::<WorkspaceViewState, String>(default_view_state(DEFAULT_SESSION_SLOT_ID.to_string()))
    })?;
    let Some(binding_index) = view_state
        .session_bindings
        .iter()
        .position(|binding| binding.session_id == session_id)
    else {
        return Err("session_not_found".to_string());
    };
    let provider_sessions = list_provider_workspace_sessions(&workspace.root_path)?;
    let binding = view_state.session_bindings[binding_index].clone();
    if let Some(provider_session) = provider_session_for_binding(&provider_sessions, &binding) {
        if view_state.session_bindings[binding_index].title_snapshot != provider_session.title
            || view_state.session_bindings[binding_index].last_seen_at
                != provider_session.last_active_at
        {
            view_state.session_bindings[binding_index].title_snapshot =
                provider_session.title.clone();
            view_state.session_bindings[binding_index].last_seen_at =
                provider_session.last_active_at;
            save_view_state_to_conn(conn, workspace_id, &view_state)?;
        }
    }
    Ok(resolve_bound_session_from_binding(
        &binding,
        &provider_sessions,
    ))
}

pub(crate) fn load_workspace_slot_session(
    state: State<'_, AppState>,
    workspace_id: &str,
    session_id: &str,
) -> Result<SessionInfo, String> {
    with_db(state, |conn| {
        load_workspace_slot_session_from_conn(conn, workspace_id, session_id)
    })
}

pub(crate) fn upsert_workspace_session_binding(
    state: State<'_, AppState>,
    workspace_id: &str,
    binding: WorkspaceSessionBinding,
) -> Result<WorkspaceViewState, String> {
    with_db(state, |conn| {
        let mut view_state = load_view_state_from_conn(conn, workspace_id).or_else(|_| {
            Ok::<WorkspaceViewState, String>(default_view_state(binding.session_id.clone()))
        })?;
        if let Some(existing) = view_state
            .session_bindings
            .iter_mut()
            .find(|existing| existing.session_id == binding.session_id)
        {
            *existing = binding;
        } else {
            view_state.session_bindings.push(binding);
        }
        save_view_state_to_conn(conn, workspace_id, &view_state)?;
        Ok(view_state)
    })
}

pub(crate) fn remove_workspace_session_binding(
    state: State<'_, AppState>,
    workspace_id: &str,
    session_id: &str,
) -> Result<WorkspaceViewState, String> {
    with_db(state, |conn| {
        let mut view_state = load_view_state_from_conn(conn, workspace_id).or_else(|_| {
            Ok::<WorkspaceViewState, String>(default_view_state(
                DEFAULT_SESSION_SLOT_ID.to_string(),
            ))
        })?;
        view_state
            .session_bindings
            .retain(|binding| binding.session_id != session_id);
        save_view_state_to_conn(conn, workspace_id, &view_state)?;
        Ok(view_state)
    })
}

pub(crate) fn remove_workspace_bindings_for_provider_session(
    state: State<'_, AppState>,
    workspace_id: &str,
    provider: &AgentProvider,
    resume_id: &str,
) -> Result<Vec<String>, String> {
    with_db(state, |conn| {
        let mut view_state = load_view_state_from_conn(conn, workspace_id).or_else(|_| {
            Ok::<WorkspaceViewState, String>(default_view_state(
                DEFAULT_SESSION_SLOT_ID.to_string(),
            ))
        })?;
        let removed_session_ids = view_state
            .session_bindings
            .iter()
            .filter(|binding| binding.provider == *provider && binding.resume_id == resume_id)
            .map(|binding| binding.session_id.clone())
            .collect::<Vec<_>>();
        view_state
            .session_bindings
            .retain(|binding| !(binding.provider == *provider && binding.resume_id == resume_id));
        save_view_state_to_conn(conn, workspace_id, &view_state)?;
        Ok(removed_session_ids)
    })
}

pub(crate) fn workspace_access_context(
    state: State<'_, AppState>,
    workspace_id: &str,
) -> Result<(String, ExecTarget), String> {
    with_db(state, |conn| {
        workspace_access_context_from_conn(conn, workspace_id)
    })
}

pub(crate) fn workspace_access_context_from_conn(
    conn: &Connection,
    workspace_id: &str,
) -> Result<(String, ExecTarget), String> {
    let row = load_workspace_row(conn, workspace_id)?;
    Ok((row.root_path, row.target))
}

#[cfg(test)]
pub(crate) fn launch_workspace_record(
    state: State<'_, AppState>,
    source: WorkspaceSource,
    project_path: String,
    idle_policy: IdlePolicy,
) -> Result<WorkspaceLaunchResult, String> {
    launch_workspace_record_scoped(state, source, project_path, idle_policy, None, None)
}

pub(crate) fn launch_workspace_record_scoped(
    state: State<'_, AppState>,
    source: WorkspaceSource,
    project_path: String,
    idle_policy: IdlePolicy,
    device_id: Option<&str>,
    client_id: Option<&str>,
) -> Result<WorkspaceLaunchResult, String> {
    with_db(state, |conn| {
        let mut created = false;
        let workspace_row = if let Some(existing) = load_workspace_row_by_root(conn, &project_path)?
        {
            existing
        } else {
            created = true;
            let id = workspace_id()?;
            let title = workspace_title_from_path(&project_path);
            let git_url = match source.kind {
                WorkspaceSourceKind::Remote => Some(source.path_or_url.clone()),
                WorkspaceSourceKind::Local => None,
            };
            conn.execute(
                "INSERT INTO workspaces (id, title, root_path, source_kind, source_value, git_url, target_json, idle_policy_json, created_at, updated_at, last_opened_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?9, ?9)",
                params![
                    id,
                    title,
                    project_path,
                    workspace_source_label(&source.kind),
                    source.path_or_url,
                    git_url,
                    json_string(&source.target)?,
                    json_string(&idle_policy)?,
                    now_ts(),
                ],
            )
            .map_err(|e| e.to_string())?;
            load_workspace_row(conn, &id)?
        };

        let (ui_state, already_open) =
            ensure_workspace_open_in_ui(conn, &workspace_row.id, device_id, client_id)?;
        let snapshot = build_snapshot_from_conn(conn, &workspace_row.id)?;
        Ok(WorkspaceLaunchResult {
            ui_state,
            snapshot,
            created,
            already_open,
        })
    })
}

fn create_workspace_session_from_template(
    conn: &Connection,
    workspace_id: &str,
    mut template: SessionInfo,
) -> Result<SessionInfo, String> {
    let sort_order = min_active_sort_order(conn, workspace_id)? - 1;
    template.last_active_at = session_timestamp_to_millis(template.last_active_at);
    if template.id.trim().is_empty() || template.id == "0" {
        template.id = session_slot_id()?;
    }
    conn.execute(
        "INSERT INTO workspace_sessions (workspace_id, archived_at, sort_order, last_active_at, status, provider, resume_id, payload)
         VALUES (?1, NULL, ?2, ?3, ?4, ?5, ?6, '')",
        params![
            workspace_id,
            sort_order,
            template.last_active_at,
            status_label(&template.status),
            serde_json::to_string(&template.provider).map_err(|e| e.to_string())?,
            template.resume_id,
        ],
    )
    .map_err(|e| e.to_string())?;
    let row_id = conn.last_insert_rowid();
    if template.title.trim().is_empty() {
        template.title = session_title(&template.id);
    }
    persist_session_row(conn, workspace_id, row_id, &template, None, sort_order)?;
    Ok(template)
}

pub(crate) fn create_workspace_session(
    state: State<'_, AppState>,
    workspace_id: &str,
    mode: SessionMode,
    provider: AgentProvider,
) -> Result<SessionInfo, String> {
    with_db(state, |conn| {
        let workspace = load_workspace_row(conn, workspace_id)?;
        let template = SessionInfo {
            id: session_slot_id()?,
            title: String::new(),
            status: SessionStatus::Idle,
            mode,
            provider,
            auto_feed: true,
            queue: Vec::new(),
            messages: vec![SessionMessage {
                id: format!("msg-{}", random_hex(6)?),
                role: SessionMessageRole::System,
                content: format!("{} ready", workspace.title),
                time: now_label(),
            }],
            unread: 0,
            last_active_at: now_ts_ms(),
            resume_id: None,
            unavailable_reason: None,
            runtime_active: false,
        };
        create_workspace_session_from_template(conn, workspace_id, template)
    })
}

pub(crate) fn update_workspace_session<S: ToString>(
    state: State<'_, AppState>,
    workspace_id: &str,
    session_id: S,
    patch: SessionPatch,
) -> Result<SessionInfo, String> {
    with_db(state, |conn| {
        let row = load_session_row(conn, workspace_id, session_id)?;
        let mut session = session_from_payload(&row.payload)?;
        if let Some(title) = patch.title {
            session.title = title;
        }
        if let Some(status) = patch.status {
            session.status = status;
        }
        if let Some(mode) = patch.mode {
            session.mode = mode;
        }
        if let Some(auto_feed) = patch.auto_feed {
            session.auto_feed = auto_feed;
        }
        if let Some(queue) = patch.queue {
            session.queue = queue;
        }
        if let Some(messages) = patch.messages {
            session.messages = messages;
        }
        if let Some(unread) = patch.unread {
            session.unread = unread;
        }
        if let Some(last_active_at) = patch.last_active_at {
            session.last_active_at = session_timestamp_to_millis(last_active_at);
        }
        if let Some(resume_id) = patch.resume_id {
            session.resume_id = Some(resume_id);
        }
        persist_session_row(
            conn,
            workspace_id,
            row.id,
            &session,
            row.archived_at,
            row.sort_order,
        )?;
        Ok(session)
    })
}

pub(crate) fn switch_workspace_session<S: ToString>(
    state: State<'_, AppState>,
    workspace_id: &str,
    session_id: S,
) -> Result<SessionInfo, String> {
    with_db(state, |conn| {
        let row = load_session_row(conn, workspace_id, session_id)?;
        let mut session = session_from_payload(&row.payload)?;
        session.last_active_at = now_ts_ms();
        persist_session_row(
            conn,
            workspace_id,
            row.id,
            &session,
            row.archived_at,
            row.sort_order,
        )?;
        Ok(session)
    })
}

#[cfg(test)]
pub(crate) fn archive_workspace_session<S: ToString>(
    state: State<'_, AppState>,
    workspace_id: &str,
    session_id: S,
) -> Result<ArchiveEntry, String> {
    with_db(state, |conn| {
        let row = load_session_row(conn, workspace_id, session_id)?;
        let mut session = session_from_payload(&row.payload)?;
        let archived_at = row.archived_at.unwrap_or_else(now_ts);
        session.status = SessionStatus::Idle;
        session.runtime_active = false;
        session.last_active_at = now_ts_ms();
        persist_session_row(
            conn,
            workspace_id,
            row.id,
            &session,
            Some(archived_at),
            row.sort_order,
        )?;
        Ok(ArchiveEntry {
            id: archive_entry_id(&session.id, archived_at),
            session_id: session.id.clone(),
            mode: session.mode.clone(),
            time: now_label(),
            snapshot: serde_json::to_value(session).map_err(|e| e.to_string())?,
        })
    })
}

pub(crate) fn load_session_history_records(
    state: State<'_, AppState>,
) -> Result<Vec<SessionHistoryRecord>, String> {
    with_db(state, build_history_from_conn)
}

pub(crate) fn restore_workspace_session<S: ToString>(
    state: State<'_, AppState>,
    workspace_id: &str,
    session_id: S,
) -> Result<SessionRestoreResult, String> {
    with_db(state, |conn| {
        let row = load_session_row(conn, workspace_id, session_id)?;
        let mounted_session_ids = load_mounted_session_ids_from_conn(conn, workspace_id);
        let mut session = session_from_payload(&row.payload)?;
        let already_active = row.archived_at.is_none() && mounted_session_ids.contains(&session.id);
        if already_active {
            return Ok(SessionRestoreResult {
                session,
                already_active: true,
            });
        }

        session.status = SessionStatus::Idle;
        session.runtime_active = false;
        session.last_active_at = now_ts_ms();
        let sort_order = min_active_sort_order(conn, workspace_id)? - 1;
        persist_session_row(conn, workspace_id, row.id, &session, None, sort_order)?;
        Ok(SessionRestoreResult {
            session,
            already_active: false,
        })
    })
}

pub(crate) fn delete_workspace_session<S: ToString>(
    state: State<'_, AppState>,
    workspace_id: &str,
    session_id: S,
) -> Result<(), String> {
    with_db(state, |conn| {
        let row = load_session_row(conn, workspace_id, session_id)?;
        let session = session_from_payload(&row.payload)?;
        conn.execute(
            "DELETE FROM workspace_sessions WHERE workspace_id = ?1 AND id = ?2",
            params![workspace_id, row.id],
        )
        .map_err(|e| e.to_string())?;
        conn.execute(
            "DELETE FROM agent_lifecycle_events WHERE workspace_id = ?1 AND session_id = ?2",
            params![workspace_id, session.id],
        )
        .map_err(|e| e.to_string())?;
        Ok(())
    })
}

pub(crate) fn update_workspace_idle_policy(
    state: State<'_, AppState>,
    workspace_id: &str,
    policy: IdlePolicy,
) -> Result<(), String> {
    with_db(state, |conn| {
        conn.execute(
            "UPDATE workspaces SET idle_policy_json = ?2, updated_at = ?3 WHERE id = ?1",
            params![workspace_id, json_string(&policy)?, now_ts()],
        )
        .map_err(|e| e.to_string())?;
        Ok(())
    })
}

pub(crate) fn activate_workspace_ui(
    state: State<'_, AppState>,
    workspace_id: &str,
    device_id: Option<&str>,
    client_id: Option<&str>,
) -> Result<WorkbenchUiState, String> {
    with_db(state, |conn| {
        load_workspace_row(conn, workspace_id)?;
        let (ui_state, _) = ensure_workspace_open_in_ui(conn, workspace_id, device_id, client_id)?;
        Ok(ui_state)
    })
}

pub(crate) fn close_workspace_ui(
    state: State<'_, AppState>,
    workspace_id: &str,
    device_id: Option<&str>,
    client_id: Option<&str>,
) -> Result<WorkbenchUiState, String> {
    with_db(state, |conn| {
        remove_workspace_from_all_ui_state_scopes(conn, workspace_id, device_id, client_id)
    })
}

pub(crate) fn update_workbench_layout(
    state: State<'_, AppState>,
    layout: WorkbenchLayout,
    device_id: Option<&str>,
    client_id: Option<&str>,
) -> Result<WorkbenchUiState, String> {
    with_db(state, |conn| {
        let mut ui_state = load_ui_state_from_conn(conn, device_id, client_id)?;
        ui_state.layout = layout;
        save_ui_state_to_conn(conn, device_id, client_id, &ui_state)?;
        Ok(ui_state)
    })
}

pub(crate) fn patch_workspace_view_state(
    state: State<'_, AppState>,
    workspace_id: &str,
    patch: WorkspaceViewPatch,
) -> Result<WorkspaceViewState, String> {
    with_db(state, |conn| {
        let current = load_view_state_from_conn(conn, workspace_id).or_else(|_| {
            Ok::<WorkspaceViewState, String>(default_view_state(
                DEFAULT_SESSION_SLOT_ID.to_string(),
            ))
        })?;
        let next = WorkspaceViewState {
            active_session_id: patch.active_session_id.unwrap_or(current.active_session_id),
            active_pane_id: patch.active_pane_id.unwrap_or(current.active_pane_id),
            active_terminal_id: patch
                .active_terminal_id
                .unwrap_or(current.active_terminal_id),
            pane_layout: patch.pane_layout.unwrap_or(current.pane_layout),
            file_preview: patch.file_preview.unwrap_or(current.file_preview),
            session_bindings: current.session_bindings,
        };
        save_view_state_to_conn(conn, workspace_id, &next)?;
        Ok(next)
    })
}

pub(crate) fn load_workspace_controller_lease(
    state: State<'_, AppState>,
    workspace_id: &str,
) -> Result<WorkspaceControllerLease, String> {
    with_db(state, |conn| {
        load_workspace_controller_lease_from_conn(conn, workspace_id)
    })
}

pub(crate) fn save_workspace_controller_lease(
    state: State<'_, AppState>,
    lease: &WorkspaceControllerLease,
) -> Result<(), String> {
    with_db(state, |conn| {
        save_workspace_controller_lease_to_conn(conn, lease)
    })
}

pub(crate) fn upsert_workspace_attachment(
    state: State<'_, AppState>,
    workspace_id: &str,
    device_id: &str,
    client_id: &str,
    role: &str,
) -> Result<(), String> {
    with_db(state, |conn| {
        upsert_workspace_attachment_to_conn(conn, workspace_id, device_id, client_id, role)
    })
}

pub(crate) fn append_agent_lifecycle_event(
    state: State<'_, AppState>,
    workspace_id: &str,
    session_id: &str,
    kind: &str,
    source_event: &str,
    data: &str,
) -> Result<AgentLifecycleHistoryEntry, String> {
    with_db(state, |conn| {
        append_agent_lifecycle_event_to_conn(
            conn,
            workspace_id,
            session_id,
            kind,
            source_event,
            data,
        )
    })
}

pub(crate) fn persist_workspace_terminal(
    state: State<'_, AppState>,
    workspace_id: &str,
    terminal_id: u64,
    output: &str,
    recoverable: bool,
) -> Result<(), String> {
    with_db(state, |conn| {
        persist_terminal_row(conn, workspace_id, terminal_id, output, recoverable)
    })
}

pub(crate) fn append_workspace_terminal_output(
    state: State<'_, AppState>,
    workspace_id: &str,
    terminal_id: u64,
    chunk: &str,
) -> Result<(), String> {
    with_db(state, |conn| {
        append_terminal_output(conn, workspace_id, terminal_id, chunk)
    })
}

pub(crate) fn set_workspace_terminal_recoverable(
    state: State<'_, AppState>,
    workspace_id: &str,
    terminal_id: u64,
    recoverable: bool,
) -> Result<(), String> {
    with_db(state, |conn| {
        set_terminal_recoverable(conn, workspace_id, terminal_id, recoverable)
    })
}

pub(crate) fn delete_workspace_terminal(
    state: State<'_, AppState>,
    workspace_id: &str,
    terminal_id: u64,
) -> Result<(), String> {
    with_db(state, |conn| {
        delete_persisted_terminal(conn, workspace_id, terminal_id)
    })
}

#[cfg(test)]
pub(crate) fn set_session_status<S: ToString>(
    state: State<'_, AppState>,
    workspace_id: &str,
    session_id: S,
    status: SessionStatus,
) -> Result<(), String> {
    with_db(state, |conn| {
        let row = load_session_row(conn, workspace_id, session_id)?;
        let mut session = session_from_payload(&row.payload)?;
        session.status = status;
        session.last_active_at = now_ts_ms();
        persist_session_row(
            conn,
            workspace_id,
            row.id,
            &session,
            row.archived_at,
            row.sort_order,
        )
    })
}

pub(crate) fn set_session_status_if_not_archived<S: ToString>(
    state: State<'_, AppState>,
    workspace_id: &str,
    session_id: S,
    status: SessionStatus,
) -> Result<bool, String> {
    with_db(state, |conn| {
        let row = match load_session_row(conn, workspace_id, session_id) {
            Ok(row) => row,
            Err(error) if error == "session_not_found" => return Ok(false),
            Err(error) => return Err(error),
        };
        if row.archived_at.is_some() {
            return Ok(false);
        }
        let mut session = session_from_payload(&row.payload)?;
        session.status = status;
        session.last_active_at = now_ts_ms();
        persist_session_row(
            conn,
            workspace_id,
            row.id,
            &session,
            row.archived_at,
            row.sort_order,
        )?;
        Ok(true)
    })
}

pub(crate) fn set_session_runtime_state_if_not_archived<S: ToString>(
    state: State<'_, AppState>,
    workspace_id: &str,
    session_id: S,
    status: SessionStatus,
    runtime_active: bool,
) -> Result<bool, String> {
    with_db(state, |conn| {
        let row = match load_session_row(conn, workspace_id, session_id) {
            Ok(row) => row,
            Err(error) if error == "session_not_found" => return Ok(false),
            Err(error) => return Err(error),
        };
        if row.archived_at.is_some() {
            return Ok(false);
        }
        let mut session = session_from_payload(&row.payload)?;
        session.status = status;
        session.runtime_active = runtime_active;
        session.last_active_at = now_ts_ms();
        persist_session_row(
            conn,
            workspace_id,
            row.id,
            &session,
            row.archived_at,
            row.sort_order,
        )?;
        Ok(true)
    })
}

pub(crate) fn set_session_resume_id<S: ToString>(
    state: State<'_, AppState>,
    workspace_id: &str,
    session_id: S,
    resume_id: String,
) -> Result<(), String> {
    with_db(state, |conn| {
        let row = load_session_row(conn, workspace_id, session_id)?;
        let mut session = session_from_payload(&row.payload)?;
        session.resume_id = Some(resume_id);
        persist_session_row(
            conn,
            workspace_id,
            row.id,
            &session,
            row.archived_at,
            row.sort_order,
        )
    })
}

pub(crate) fn load_session<S: ToString>(
    state: State<'_, AppState>,
    workspace_id: &str,
    session_id: S,
) -> Result<SessionInfo, String> {
    with_db(state, |conn| {
        let row = load_session_row(conn, workspace_id, session_id)?;
        session_from_payload(&row.payload)
    })
}

pub(crate) fn truncate_tail(value: &str, limit: usize) -> String {
    if value.len() <= limit {
        return value.to_string();
    }
    value
        .chars()
        .rev()
        .take(limit)
        .collect::<String>()
        .chars()
        .rev()
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn insert_workspace(conn: &Connection, workspace_id: &str) {
        let now = now_ts_ms();
        conn.execute(
            "INSERT INTO workspaces (id, title, root_path, source_kind, source_value, git_url, target_json, idle_policy_json, created_at, updated_at, last_opened_at)
             VALUES (?1, ?2, ?3, ?4, ?5, NULL, ?6, ?7, ?8, ?9, ?10)",
            params![
                workspace_id,
                format!("Workspace {workspace_id}"),
                format!("/tmp/{workspace_id}"),
                "local",
                format!("/tmp/{workspace_id}"),
                serde_json::to_string(&ExecTarget::Native).unwrap(),
                serde_json::to_string(&default_idle_policy()).unwrap(),
                now,
                now,
                now,
            ],
        )
        .unwrap();
    }

    fn legacy_session_payload(resume_id: Option<&str>) -> String {
        json!({
            "id": 1,
            "title": "Session 1",
            "status": "suspended",
            "mode": "branch",
            "auto_feed": true,
            "queue": [],
            "messages": [],
            "stream": "",
            "unread": 0,
            "last_active_at": 123,
            "claude_session_id": resume_id,
        })
        .to_string()
    }

    fn session_payload_with_id(
        session_id: &str,
        provider: AgentProvider,
        resume_id: Option<&str>,
        last_active_at: i64,
        runtime_active: bool,
    ) -> String {
        json!({
            "id": session_id,
            "title": format!("Session {session_id}"),
            "status": "suspended",
            "mode": "branch",
            "provider": provider,
            "auto_feed": true,
            "queue": [],
            "messages": [],
            "stream": "",
            "unread": 0,
            "last_active_at": last_active_at,
            "resume_id": resume_id,
            "runtime_active": runtime_active,
        })
        .to_string()
    }

    fn current_session_payload(
        provider: AgentProvider,
        resume_id: Option<&str>,
        last_active_at: i64,
        runtime_active: bool,
    ) -> String {
        session_payload_with_id("1", provider, resume_id, last_active_at, runtime_active)
    }

    fn workspace_session_columns(conn: &Connection) -> Vec<String> {
        let mut stmt = conn
            .prepare("PRAGMA table_info(workspace_sessions)")
            .unwrap();
        stmt.query_map([], |row| row.get::<_, String>(1))
            .unwrap()
            .map(|row| row.unwrap())
            .collect()
    }

    #[test]
    fn session_from_payload_deserializes_string_session_ids() {
        let session = session_from_payload(&session_payload_with_id(
            "slot-alpha",
            AgentProvider::claude(),
            Some("resume-alpha"),
            123,
            false,
        ))
        .expect("string session ids should deserialize");

        let serialized = serde_json::to_value(session).unwrap();
        assert_eq!(serialized["id"], "slot-alpha");
    }

    #[test]
    fn load_view_state_from_conn_defaults_session_bindings_for_legacy_payloads() {
        let conn = Connection::open_in_memory().unwrap();
        init_db(&conn).unwrap();
        insert_workspace(&conn, "ws_view_legacy");
        conn.execute(
            "INSERT INTO workspace_view_state (workspace_id, payload, updated_at)
             VALUES (?1, ?2, ?3)",
            params![
                "ws_view_legacy",
                json!({
                    "active_session_id": "slot-alpha",
                    "active_pane_id": "pane-alpha",
                    "active_terminal_id": "",
                    "pane_layout": {
                        "type": "leaf",
                        "id": "pane-alpha",
                        "sessionId": "slot-alpha",
                    },
                    "file_preview": default_file_preview_value(),
                })
                .to_string(),
                now_ts_ms(),
            ],
        )
        .unwrap();

        let view_state = load_view_state_from_conn(&conn, "ws_view_legacy").unwrap();
        let serialized = serde_json::to_value(view_state).unwrap();
        let persisted_payload: String = conn
            .query_row(
                "SELECT payload FROM workspace_view_state WHERE workspace_id = ?1",
                params!["ws_view_legacy"],
                |row| row.get(0),
            )
            .unwrap();
        let persisted_value: Value = serde_json::from_str(&persisted_payload).unwrap();

        assert_eq!(serialized["session_bindings"], json!([]));
        assert_eq!(persisted_value["session_bindings"], json!([]));
    }

    #[test]
    fn load_view_state_from_conn_migrates_only_mounted_legacy_session_rows_into_bindings() {
        let conn = Connection::open_in_memory().unwrap();
        init_db(&conn).unwrap();
        insert_workspace(&conn, "ws_binding_migration");
        conn.execute(
            "INSERT INTO workspace_view_state (workspace_id, payload, updated_at)
             VALUES (?1, ?2, ?3)",
            params![
                "ws_binding_migration",
                json!({
                    "active_session_id": "slot-mounted",
                    "active_pane_id": "pane-mounted",
                    "active_terminal_id": "",
                    "pane_layout": {
                        "type": "leaf",
                        "id": "pane-mounted",
                        "sessionId": "slot-mounted",
                    },
                    "file_preview": default_file_preview_value(),
                })
                .to_string(),
                now_ts_ms(),
            ],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO workspace_sessions (id, workspace_id, archived_at, sort_order, last_active_at, status, provider, resume_id, payload)
             VALUES (?1, ?2, NULL, ?3, ?4, ?5, ?6, ?7, ?8)",
            params![
                1_i64,
                "ws_binding_migration",
                1_i64,
                1_730_000_000_000_i64,
                "idle",
                serde_json::to_string(&AgentProvider::claude()).unwrap(),
                "resume-mounted",
                session_payload_with_id(
                    "slot-mounted",
                    AgentProvider::claude(),
                    Some("resume-mounted"),
                    1_730_000_000_000_i64,
                    false,
                ),
            ],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO workspace_sessions (id, workspace_id, archived_at, sort_order, last_active_at, status, provider, resume_id, payload)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
            params![
                2_i64,
                "ws_binding_migration",
                1_730_000_000_500_i64,
                2_i64,
                1_730_000_000_500_i64,
                "suspended",
                serde_json::to_string(&AgentProvider::codex()).unwrap(),
                "resume-archived",
                session_payload_with_id(
                    "slot-archived",
                    AgentProvider::codex(),
                    Some("resume-archived"),
                    1_730_000_000_500_i64,
                    false,
                ),
            ],
        )
        .unwrap();

        let view_state = load_view_state_from_conn(&conn, "ws_binding_migration").unwrap();
        let serialized = serde_json::to_value(view_state).unwrap();
        let bindings = serialized["session_bindings"]
            .as_array()
            .expect("session_bindings should serialize as an array");

        assert_eq!(bindings.len(), 1);
        assert_eq!(
            bindings[0],
            json!({
                "session_id": "slot-mounted",
                "provider": AgentProvider::claude(),
                "resume_id": "resume-mounted",
                "title_snapshot": "Session slot-mounted",
                "last_seen_at": 1_730_000_000_000_i64,
            })
        );
    }

    #[test]
    fn build_snapshot_from_conn_only_includes_visible_sessions() {
        let conn = Connection::open_in_memory().unwrap();
        init_db(&conn).unwrap();
        insert_workspace(&conn, "ws_snapshot_visible");
        conn.execute(
            "INSERT INTO workspace_view_state (workspace_id, payload, updated_at)
             VALUES (?1, ?2, ?3)",
            params![
                "ws_snapshot_visible",
                json!({
                    "active_session_id": "slot-visible",
                    "active_pane_id": "pane-visible",
                    "active_terminal_id": "",
                    "pane_layout": {
                        "type": "leaf",
                        "id": "pane-visible",
                        "sessionId": "slot-visible",
                    },
                    "file_preview": default_file_preview_value(),
                    "session_bindings": [],
                })
                .to_string(),
                now_ts_ms(),
            ],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO workspace_sessions (id, workspace_id, archived_at, sort_order, last_active_at, status, provider, resume_id, payload)
             VALUES (?1, ?2, NULL, ?3, ?4, ?5, ?6, NULL, ?7)",
            params![
                1_i64,
                "ws_snapshot_visible",
                1_i64,
                1_730_000_000_000_i64,
                "idle",
                serde_json::to_string(&AgentProvider::claude()).unwrap(),
                session_payload_with_id(
                    "slot-visible",
                    AgentProvider::claude(),
                    None,
                    1_730_000_000_000_i64,
                    false,
                ),
            ],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO workspace_sessions (id, workspace_id, archived_at, sort_order, last_active_at, status, provider, resume_id, payload)
             VALUES (?1, ?2, NULL, ?3, ?4, ?5, ?6, NULL, ?7)",
            params![
                2_i64,
                "ws_snapshot_visible",
                2_i64,
                1_730_000_000_500_i64,
                "idle",
                serde_json::to_string(&AgentProvider::codex()).unwrap(),
                session_payload_with_id(
                    "slot-hidden",
                    AgentProvider::codex(),
                    None,
                    1_730_000_000_500_i64,
                    false,
                ),
            ],
        )
        .unwrap();

        let snapshot = build_snapshot_from_conn(&conn, "ws_snapshot_visible").unwrap();
        let session_ids = snapshot
            .sessions
            .into_iter()
            .map(|session| session.id)
            .collect::<Vec<_>>();

        assert_eq!(session_ids, vec!["slot-visible".to_string()]);
    }

    #[test]
    fn init_db_migrates_legacy_workspace_sessions_schema_from_version_2() {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(
            "CREATE TABLE workspaces (id TEXT PRIMARY KEY);
            CREATE TABLE workspace_sessions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                workspace_id TEXT NOT NULL,
                archived_at INTEGER,
                sort_order INTEGER NOT NULL,
                last_active_at INTEGER NOT NULL,
                status TEXT NOT NULL,
                claude_session_id TEXT,
                payload TEXT NOT NULL,
                FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
            );
            CREATE INDEX idx_workspace_sessions_workspace_active
                ON workspace_sessions(workspace_id, archived_at, sort_order, last_active_at DESC);
            CREATE UNIQUE INDEX idx_workspace_sessions_workspace_claude
                ON workspace_sessions(workspace_id, claude_session_id)
                WHERE claude_session_id IS NOT NULL;
            PRAGMA user_version = 2;",
        )
        .unwrap();
        conn.execute(
            "INSERT INTO workspaces (id) VALUES (?1)",
            params!["ws_legacy"],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO workspace_sessions (id, workspace_id, archived_at, sort_order, last_active_at, status, claude_session_id, payload)
             VALUES (?1, ?2, NULL, ?3, ?4, ?5, ?6, ?7)",
            params![
                1_i64,
                "ws_legacy",
                1_i64,
                123_i64,
                "suspended",
                "claude-resume-id",
                legacy_session_payload(Some("claude-resume-id")),
            ],
        )
        .unwrap();

        init_db(&conn).unwrap();

        let columns = workspace_session_columns(&conn);
        assert!(columns.iter().any(|column| column == "provider"));
        assert!(columns.iter().any(|column| column == "resume_id"));
        assert!(!columns.iter().any(|column| column == "claude_session_id"));

        let current_version: i64 = conn
            .query_row("PRAGMA user_version", [], |row| row.get(0))
            .unwrap();
        assert_eq!(current_version, DB_SCHEMA_VERSION);

        let (provider, resume_id, payload): (String, Option<String>, String) = conn
            .query_row(
                "SELECT provider, resume_id, payload
                 FROM workspace_sessions
                 WHERE id = 1",
                [],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .unwrap();
        assert_eq!(
            provider,
            serde_json::to_string(&AgentProvider::claude()).unwrap()
        );
        assert_eq!(resume_id.as_deref(), Some("claude-resume-id"));

        let session = session_from_payload(&payload).unwrap();
        assert_eq!(session.provider, AgentProvider::claude());
        assert_eq!(session.resume_id.as_deref(), Some("claude-resume-id"));
    }

    #[test]
    fn init_db_preserves_current_workspace_sessions_rows_when_version_2_is_already_current_shape() {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(
            "CREATE TABLE workspaces (id TEXT PRIMARY KEY);
            CREATE TABLE workspace_sessions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                workspace_id TEXT NOT NULL,
                archived_at INTEGER,
                sort_order INTEGER NOT NULL,
                last_active_at INTEGER NOT NULL,
                status TEXT NOT NULL,
                provider TEXT NOT NULL,
                resume_id TEXT,
                payload TEXT NOT NULL,
                FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
            );
            PRAGMA user_version = 2;",
        )
        .unwrap();
        conn.execute(
            "INSERT INTO workspaces (id) VALUES (?1)",
            params!["ws_current"],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO workspace_sessions (id, workspace_id, archived_at, sort_order, last_active_at, status, provider, resume_id, payload)
             VALUES (?1, ?2, NULL, ?3, ?4, ?5, ?6, ?7, ?8)",
            params![
                1_i64,
                "ws_current",
                1_i64,
                123_i64,
                "suspended",
                serde_json::to_string(&AgentProvider::codex()).unwrap(),
                "codex-resume-id",
                current_session_payload(
                    AgentProvider::codex(),
                    Some("codex-resume-id"),
                    123,
                    false,
                ),
            ],
        )
        .unwrap();

        init_db(&conn).unwrap();

        let row_count: i64 = conn
            .query_row("SELECT COUNT(*) FROM workspace_sessions", [], |row| {
                row.get(0)
            })
            .unwrap();
        assert_eq!(row_count, 1);

        let payload: String = conn
            .query_row(
                "SELECT payload FROM workspace_sessions WHERE id = 1",
                [],
                |row| row.get(0),
            )
            .unwrap();
        let session = session_from_payload(&payload).unwrap();
        assert_eq!(session.provider, AgentProvider::codex());
        assert_eq!(session.resume_id.as_deref(), Some("codex-resume-id"));
    }

    #[test]
    fn init_db_migrates_session_last_active_at_from_seconds_to_millis() {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(
            "CREATE TABLE workspaces (id TEXT PRIMARY KEY);
            CREATE TABLE workspace_sessions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                workspace_id TEXT NOT NULL,
                archived_at INTEGER,
                sort_order INTEGER NOT NULL,
                last_active_at INTEGER NOT NULL,
                status TEXT NOT NULL,
                provider TEXT NOT NULL,
                resume_id TEXT,
                payload TEXT NOT NULL,
                FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
            );
            PRAGMA user_version = 3;",
        )
        .unwrap();
        conn.execute(
            "INSERT INTO workspaces (id) VALUES (?1)",
            params!["ws_seconds"],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO workspace_sessions (id, workspace_id, archived_at, sort_order, last_active_at, status, provider, resume_id, payload)
             VALUES (?1, ?2, NULL, ?3, ?4, ?5, ?6, ?7, ?8)",
            params![
                1_i64,
                "ws_seconds",
                1_i64,
                1_730_000_000_i64,
                "suspended",
                serde_json::to_string(&AgentProvider::claude()).unwrap(),
                "claude-seconds-resume-id",
                current_session_payload(
                    AgentProvider::claude(),
                    Some("claude-seconds-resume-id"),
                    1_730_000_000_i64,
                    false,
                ),
            ],
        )
        .unwrap();

        init_db(&conn).unwrap();

        let (last_active_at, payload): (i64, String) = conn
            .query_row(
                "SELECT last_active_at, payload
                 FROM workspace_sessions
                 WHERE id = 1",
                [],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .unwrap();
        assert_eq!(last_active_at, 1_730_000_000_000);

        let session = session_from_payload(&payload).unwrap();
        assert_eq!(session.last_active_at, 1_730_000_000_000);
    }

    #[test]
    fn mark_active_sessions_interrupted_on_boot_interrupts_runtime_active_idle_sessions() {
        let conn = Connection::open_in_memory().unwrap();
        init_db(&conn).unwrap();
        let now = now_ts_ms();
        conn.execute(
            "INSERT INTO workspaces (id, title, root_path, source_kind, source_value, git_url, target_json, idle_policy_json, created_at, updated_at, last_opened_at)
             VALUES (?1, ?2, ?3, ?4, ?5, NULL, ?6, ?7, ?8, ?9, ?10)",
            params![
                "ws_boot",
                "Boot Workspace",
                "/tmp/coder-studio-boot-workspace",
                "local",
                "/tmp/coder-studio-boot-workspace",
                serde_json::to_string(&ExecTarget::Native).unwrap(),
                serde_json::to_string(&IdlePolicy {
                    enabled: true,
                    idle_minutes: 10,
                    max_active: 3,
                    pressure: true,
                })
                .unwrap(),
                now,
                now,
                now,
            ],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO workspace_sessions (id, workspace_id, archived_at, sort_order, last_active_at, status, provider, resume_id, payload)
             VALUES (?1, ?2, NULL, ?3, ?4, ?5, ?6, NULL, ?7)",
            params![
                1_i64,
                "ws_boot",
                1_i64,
                now,
                "idle",
                serde_json::to_string(&AgentProvider::claude()).unwrap(),
                json!({
                    "id": 1,
                    "title": "Session 1",
                    "status": "idle",
                    "mode": "branch",
                    "provider": AgentProvider::claude(),
                    "auto_feed": true,
                    "queue": [],
                    "messages": [],
                    "unread": 0,
                    "last_active_at": now,
                    "resume_id": null,
                    "runtime_active": true,
                })
                .to_string(),
            ],
        )
        .unwrap();

        mark_active_sessions_interrupted_on_boot(&conn).unwrap();

        let payload: String = conn
            .query_row(
                "SELECT payload FROM workspace_sessions WHERE id = 1",
                [],
                |row| row.get(0),
            )
            .unwrap();
        let session = session_from_payload(&payload).unwrap();
        assert_eq!(session.status, SessionStatus::Interrupted);
        assert!(!session.runtime_active);
    }
}
