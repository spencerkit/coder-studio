use crate::*;
use chrono::TimeZone;
use serde::de::DeserializeOwned;

const SESSION_STREAM_LIMIT: usize = 200_000;
const APP_UI_STATE_ROW_ID: i64 = 1;

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
    workspace_id: String,
    archived_at: Option<i64>,
    sort_order: i64,
    payload: String,
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

fn session_title(id: u64) -> String {
    format!("Session {}", id)
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

fn session_from_payload(payload: &str) -> Result<SessionInfo, String> {
    parse_json(payload)
}

fn session_row_from_query(row: &rusqlite::Row<'_>) -> Result<SessionRow, rusqlite::Error> {
    Ok(SessionRow {
        workspace_id: row.get("workspace_id")?,
        archived_at: row.get("archived_at")?,
        sort_order: row.get("sort_order")?,
        payload: row.get("payload")?,
    })
}

fn load_session_row(
    conn: &Connection,
    workspace_id: &str,
    session_id: u64,
) -> Result<SessionRow, String> {
    let mut stmt = conn
        .prepare(
            "SELECT workspace_id, archived_at, sort_order, payload
             FROM workspace_sessions
             WHERE workspace_id = ?1 AND id = ?2",
        )
        .map_err(|e| e.to_string())?;
    stmt.query_row(
        params![workspace_id, session_id as i64],
        session_row_from_query,
    )
    .map_err(|e| match e {
        rusqlite::Error::QueryReturnedNoRows => "session_not_found".to_string(),
        other => other.to_string(),
    })
}

fn persist_session_row(
    conn: &Connection,
    workspace_id: &str,
    session: &SessionInfo,
    archived_at: Option<i64>,
    sort_order: i64,
) -> Result<(), String> {
    let payload = json_string(session)?;
    conn.execute(
        "UPDATE workspace_sessions
         SET status = ?3,
             last_active_at = ?4,
             claude_session_id = ?5,
             payload = ?6,
             archived_at = ?7,
             sort_order = ?8
         WHERE workspace_id = ?1 AND id = ?2",
        params![
            workspace_id,
            session.id as i64,
            status_label(&session.status),
            session.last_active_at,
            session.claude_session_id,
            payload,
            archived_at,
            sort_order,
        ],
    )
    .map_err(|e| e.to_string())?;
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

fn load_ui_state_from_conn(conn: &Connection) -> Result<WorkbenchUiState, String> {
    let payload: String = conn
        .query_row(
            "SELECT payload FROM app_ui_state WHERE id = ?1",
            params![APP_UI_STATE_ROW_ID],
            |row| row.get(0),
        )
        .map_err(|e| e.to_string())?;
    parse_json(&payload)
}

fn save_ui_state_to_conn(conn: &Connection, ui_state: &WorkbenchUiState) -> Result<(), String> {
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

fn default_view_state(active_session_id: u64) -> WorkspaceViewState {
    WorkspaceViewState {
        active_session_id: active_session_id.to_string(),
        active_pane_id: format!("pane-{active_session_id}"),
        pane_layout: json!({
            "type": "leaf",
            "id": format!("pane-{active_session_id}"),
            "sessionId": active_session_id.to_string(),
        }),
        file_preview: default_file_preview_value(),
    }
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
    parse_json(&payload)
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

fn load_sessions_from_conn(
    conn: &Connection,
    workspace_id: &str,
    archived: bool,
) -> Result<Vec<SessionRow>, String> {
    let sql = if archived {
        "SELECT workspace_id, archived_at, sort_order, payload
         FROM workspace_sessions
         WHERE workspace_id = ?1 AND archived_at IS NOT NULL
         ORDER BY archived_at DESC, id DESC"
    } else {
        "SELECT workspace_id, archived_at, sort_order, payload
         FROM workspace_sessions
         WHERE workspace_id = ?1 AND archived_at IS NULL
         ORDER BY sort_order ASC, last_active_at DESC, id DESC"
    };
    let mut stmt = conn.prepare(sql).map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(params![workspace_id], session_row_from_query)
        .map_err(|e| e.to_string())?;
    let mut items = Vec::new();
    for row in rows {
        items.push(row.map_err(|e| e.to_string())?);
    }
    Ok(items)
}

fn session_rows_to_archive(rows: Vec<SessionRow>) -> Result<Vec<ArchiveEntry>, String> {
    rows.into_iter()
        .map(|row| {
            let session = session_from_payload(&row.payload)?;
            let time = row
                .archived_at
                .and_then(|value| chrono::Local.timestamp_opt(value, 0).single())
                .map(|dt| dt.format("%H:%M").to_string())
                .unwrap_or_else(now_label);
            Ok(ArchiveEntry {
                id: row.archived_at.unwrap_or(now_ts()) as u64,
                session_id: session.id,
                mode: session.mode.clone(),
                time,
                snapshot: serde_json::to_value(session).map_err(|e| e.to_string())?,
            })
        })
        .collect()
}

fn build_snapshot_from_conn(
    conn: &Connection,
    workspace_id: &str,
) -> Result<WorkspaceSnapshot, String> {
    let workspace = row_to_workspace_summary(load_workspace_row(conn, workspace_id)?);
    let mut sessions = load_sessions_from_conn(conn, workspace_id, false)?
        .into_iter()
        .map(|row| session_from_payload(&row.payload))
        .collect::<Result<Vec<_>, _>>()?;
    if sessions.is_empty() {
        let template = SessionInfo {
            id: 0,
            title: String::new(),
            status: SessionStatus::Idle,
            mode: SessionMode::Branch,
            auto_feed: true,
            queue: Vec::new(),
            messages: vec![SessionMessage {
                id: format!("msg-{}", random_hex(6)?),
                role: SessionMessageRole::System,
                content: format!("{} ready", workspace.title),
                time: now_label(),
            }],
            stream: String::new(),
            unread: 0,
            last_active_at: now_ts(),
            claude_session_id: None,
        };
        let session = create_workspace_session_from_template(conn, workspace_id, template)?;
        sessions.push(session.clone());
        save_view_state_to_conn(conn, workspace_id, &default_view_state(session.id))?;
    }
    let archive = session_rows_to_archive(load_sessions_from_conn(conn, workspace_id, true)?)?;
    let view_state = match load_view_state_from_conn(conn, workspace_id) {
        Ok(value) => value,
        Err(_) => default_view_state(sessions.first().map(|session| session.id).unwrap_or(1)),
    };
    Ok(WorkspaceSnapshot {
        workspace,
        sessions,
        archive,
        view_state,
        terminals: Vec::new(),
    })
}

fn build_bootstrap_from_conn(conn: &Connection) -> Result<WorkbenchBootstrap, String> {
    let mut ui_state = load_ui_state_from_conn(conn)?;
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
        save_ui_state_to_conn(conn, &ui_state)?;
    }
    Ok(WorkbenchBootstrap {
        ui_state,
        workspaces,
    })
}

fn ensure_workspace_open_in_ui(
    conn: &Connection,
    workspace_id: &str,
) -> Result<(WorkbenchUiState, bool), String> {
    let mut ui_state = load_ui_state_from_conn(conn)?;
    let already_open = ui_state
        .open_workspace_ids
        .iter()
        .any(|item| item == workspace_id);
    if !already_open {
        ui_state.open_workspace_ids.push(workspace_id.to_string());
    }
    ui_state.active_workspace_id = Some(workspace_id.to_string());
    save_ui_state_to_conn(conn, &ui_state)?;
    conn.execute(
        "UPDATE workspaces SET last_opened_at = ?2, updated_at = ?2 WHERE id = ?1",
        params![workspace_id, now_ts()],
    )
    .map_err(|e| e.to_string())?;
    Ok((ui_state, already_open))
}

pub(crate) fn init_db(conn: &Connection) -> Result<(), rusqlite::Error> {
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
            claude_session_id TEXT,
            payload TEXT NOT NULL,
            FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS idx_workspace_sessions_workspace_active
            ON workspace_sessions(workspace_id, archived_at, sort_order, last_active_at DESC);
        CREATE UNIQUE INDEX IF NOT EXISTS idx_workspace_sessions_workspace_claude
            ON workspace_sessions(workspace_id, claude_session_id)
            WHERE claude_session_id IS NOT NULL;
        CREATE TABLE IF NOT EXISTS workspace_view_state (
            workspace_id TEXT PRIMARY KEY,
            payload TEXT NOT NULL,
            updated_at INTEGER NOT NULL,
            FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
        );
        CREATE TABLE IF NOT EXISTS app_ui_state (
            id INTEGER PRIMARY KEY CHECK (id = 1),
            payload TEXT NOT NULL,
            updated_at INTEGER NOT NULL
        );",
    )?;
    let payload = serde_json::to_string(&default_ui_state()).unwrap_or_else(|_| "{}".to_string());
    conn.execute(
        "INSERT OR IGNORE INTO app_ui_state (id, payload, updated_at) VALUES (?1, ?2, ?3)",
        params![APP_UI_STATE_ROW_ID, payload, now_ts()],
    )?;
    Ok(())
}

pub(crate) fn mark_active_sessions_interrupted_on_boot(conn: &Connection) -> Result<(), String> {
    let mut stmt = conn
        .prepare(
            "SELECT id, workspace_id, archived_at, sort_order, payload
             FROM workspace_sessions
             WHERE archived_at IS NULL AND status IN ('running', 'waiting', 'background')",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], session_row_from_query)
        .map_err(|e| e.to_string())?;
    for row in rows {
        let row = row.map_err(|e| e.to_string())?;
        let mut session = session_from_payload(&row.payload)?;
        session.status = SessionStatus::Interrupted;
        persist_session_row(
            conn,
            &row.workspace_id,
            &session,
            row.archived_at,
            row.sort_order,
        )?;
    }
    Ok(())
}

pub(crate) fn with_db<T>(
    state: &State<'_, AppState>,
    f: impl FnOnce(&Connection) -> Result<T, String>,
) -> Result<T, String> {
    let guard = state.db.lock().map_err(|e| e.to_string())?;
    let conn = guard.as_ref().ok_or("db_not_ready")?;
    f(conn)
}

pub(crate) fn workbench_bootstrap(
    state: &State<'_, AppState>,
) -> Result<WorkbenchBootstrap, String> {
    with_db(state, build_bootstrap_from_conn)
}

pub(crate) fn workspace_snapshot(
    state: &State<'_, AppState>,
    workspace_id: &str,
) -> Result<WorkspaceSnapshot, String> {
    with_db(state, |conn| build_snapshot_from_conn(conn, workspace_id))
}

pub(crate) fn workspace_access_context(
    state: &State<'_, AppState>,
    workspace_id: &str,
) -> Result<(String, ExecTarget), String> {
    with_db(state, |conn| {
        let row = load_workspace_row(conn, workspace_id)?;
        Ok((row.root_path, row.target))
    })
}

pub(crate) fn launch_workspace_record(
    state: &State<'_, AppState>,
    source: WorkspaceSource,
    project_path: String,
    idle_policy: IdlePolicy,
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

        let (ui_state, already_open) = ensure_workspace_open_in_ui(conn, &workspace_row.id)?;
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
    conn.execute(
        "INSERT INTO workspace_sessions (workspace_id, archived_at, sort_order, last_active_at, status, claude_session_id, payload)
         VALUES (?1, NULL, ?2, ?3, ?4, ?5, '')",
        params![
            workspace_id,
            sort_order,
            template.last_active_at,
            status_label(&template.status),
            template.claude_session_id,
        ],
    )
    .map_err(|e| e.to_string())?;
    template.id = conn.last_insert_rowid() as u64;
    if template.title.trim().is_empty() {
        template.title = session_title(template.id);
    }
    persist_session_row(conn, workspace_id, &template, None, sort_order)?;
    Ok(template)
}

pub(crate) fn create_workspace_session(
    state: &State<'_, AppState>,
    workspace_id: &str,
    mode: SessionMode,
) -> Result<SessionInfo, String> {
    with_db(state, |conn| {
        let workspace = load_workspace_row(conn, workspace_id)?;
        let active_sessions = load_sessions_from_conn(conn, workspace_id, false)?
            .into_iter()
            .map(|row| session_from_payload(&row.payload))
            .collect::<Result<Vec<_>, _>>()?;
        let active_count = active_sessions
            .iter()
            .filter(|session| {
                !matches!(
                    session.status,
                    SessionStatus::Suspended | SessionStatus::Queued
                )
            })
            .count() as u32;
        let status = if active_count >= workspace.idle_policy.max_active {
            SessionStatus::Queued
        } else {
            SessionStatus::Idle
        };
        let template = SessionInfo {
            id: 0,
            title: String::new(),
            status,
            mode,
            auto_feed: true,
            queue: Vec::new(),
            messages: vec![SessionMessage {
                id: format!("msg-{}", random_hex(6)?),
                role: SessionMessageRole::System,
                content: format!("{} ready", workspace.title),
                time: now_label(),
            }],
            stream: String::new(),
            unread: 0,
            last_active_at: now_ts(),
            claude_session_id: None,
        };
        create_workspace_session_from_template(conn, workspace_id, template)
    })
}

pub(crate) fn update_workspace_session(
    state: &State<'_, AppState>,
    workspace_id: &str,
    session_id: u64,
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
        if let Some(stream) = patch.stream {
            session.stream = truncate_tail(&stream, SESSION_STREAM_LIMIT);
        }
        if let Some(unread) = patch.unread {
            session.unread = unread;
        }
        if let Some(last_active_at) = patch.last_active_at {
            session.last_active_at = last_active_at;
        }
        if let Some(claude_session_id) = patch.claude_session_id {
            session.claude_session_id = Some(claude_session_id);
        }
        persist_session_row(
            conn,
            workspace_id,
            &session,
            row.archived_at,
            row.sort_order,
        )?;
        Ok(session)
    })
}

pub(crate) fn switch_workspace_session(
    state: &State<'_, AppState>,
    workspace_id: &str,
    session_id: u64,
) -> Result<SessionInfo, String> {
    with_db(state, |conn| {
        let row = load_session_row(conn, workspace_id, session_id)?;
        let mut session = session_from_payload(&row.payload)?;
        session.last_active_at = now_ts();
        persist_session_row(
            conn,
            workspace_id,
            &session,
            row.archived_at,
            row.sort_order,
        )?;
        Ok(session)
    })
}

pub(crate) fn archive_workspace_session(
    state: &State<'_, AppState>,
    workspace_id: &str,
    session_id: u64,
) -> Result<ArchiveEntry, String> {
    with_db(state, |conn| {
        let row = load_session_row(conn, workspace_id, session_id)?;
        let session = session_from_payload(&row.payload)?;
        let archived_at = now_ts();
        conn.execute(
            "UPDATE workspace_sessions SET archived_at = ?3, status = ?4 WHERE workspace_id = ?1 AND id = ?2",
            params![workspace_id, session_id as i64, archived_at, status_label(&SessionStatus::Suspended)],
        )
        .map_err(|e| e.to_string())?;
        Ok(ArchiveEntry {
            id: archived_at as u64,
            session_id: session.id,
            mode: session.mode.clone(),
            time: now_label(),
            snapshot: serde_json::to_value(session).map_err(|e| e.to_string())?,
        })
    })
}

pub(crate) fn update_workspace_idle_policy(
    state: &State<'_, AppState>,
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
    state: &State<'_, AppState>,
    workspace_id: &str,
) -> Result<WorkbenchUiState, String> {
    with_db(state, |conn| {
        load_workspace_row(conn, workspace_id)?;
        let (ui_state, _) = ensure_workspace_open_in_ui(conn, workspace_id)?;
        Ok(ui_state)
    })
}

pub(crate) fn close_workspace_ui(
    state: &State<'_, AppState>,
    workspace_id: &str,
) -> Result<WorkbenchUiState, String> {
    with_db(state, |conn| {
        let mut ui_state = load_ui_state_from_conn(conn)?;
        ui_state
            .open_workspace_ids
            .retain(|item| item != workspace_id);
        if ui_state.active_workspace_id.as_deref() == Some(workspace_id) {
            ui_state.active_workspace_id = ui_state.open_workspace_ids.last().cloned();
        }
        save_ui_state_to_conn(conn, &ui_state)?;
        Ok(ui_state)
    })
}

pub(crate) fn update_workbench_layout(
    state: &State<'_, AppState>,
    layout: WorkbenchLayout,
) -> Result<WorkbenchUiState, String> {
    with_db(state, |conn| {
        let mut ui_state = load_ui_state_from_conn(conn)?;
        ui_state.layout = layout;
        save_ui_state_to_conn(conn, &ui_state)?;
        Ok(ui_state)
    })
}

pub(crate) fn patch_workspace_view_state(
    state: &State<'_, AppState>,
    workspace_id: &str,
    patch: WorkspaceViewPatch,
) -> Result<WorkspaceViewState, String> {
    with_db(state, |conn| {
        let current = load_view_state_from_conn(conn, workspace_id)
            .or_else(|_| Ok::<WorkspaceViewState, String>(default_view_state(1)))?;
        let next = WorkspaceViewState {
            active_session_id: patch.active_session_id.unwrap_or(current.active_session_id),
            active_pane_id: patch.active_pane_id.unwrap_or(current.active_pane_id),
            pane_layout: patch.pane_layout.unwrap_or(current.pane_layout),
            file_preview: patch.file_preview.unwrap_or(current.file_preview),
        };
        save_view_state_to_conn(conn, workspace_id, &next)?;
        Ok(next)
    })
}

pub(crate) fn append_session_stream(
    state: &State<'_, AppState>,
    workspace_id: &str,
    session_id: u64,
    chunk: &str,
) -> Result<(), String> {
    with_db(state, |conn| {
        let row = load_session_row(conn, workspace_id, session_id)?;
        let mut session = session_from_payload(&row.payload)?;
        session.stream = truncate_tail(
            &format!("{}{}", session.stream, chunk),
            SESSION_STREAM_LIMIT,
        );
        session.last_active_at = now_ts();
        persist_session_row(
            conn,
            workspace_id,
            &session,
            row.archived_at,
            row.sort_order,
        )
    })
}

pub(crate) fn set_session_status(
    state: &State<'_, AppState>,
    workspace_id: &str,
    session_id: u64,
    status: SessionStatus,
) -> Result<(), String> {
    with_db(state, |conn| {
        let row = load_session_row(conn, workspace_id, session_id)?;
        let mut session = session_from_payload(&row.payload)?;
        session.status = status;
        session.last_active_at = now_ts();
        persist_session_row(
            conn,
            workspace_id,
            &session,
            row.archived_at,
            row.sort_order,
        )
    })
}

pub(crate) fn set_session_claude_id(
    state: &State<'_, AppState>,
    workspace_id: &str,
    session_id: u64,
    claude_session_id: String,
) -> Result<(), String> {
    with_db(state, |conn| {
        let row = load_session_row(conn, workspace_id, session_id)?;
        let mut session = session_from_payload(&row.payload)?;
        session.claude_session_id = Some(claude_session_id);
        persist_session_row(
            conn,
            workspace_id,
            &session,
            row.archived_at,
            row.sort_order,
        )
    })
}

pub(crate) fn load_session(
    state: &State<'_, AppState>,
    workspace_id: &str,
    session_id: u64,
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
