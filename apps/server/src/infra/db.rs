use crate::*;
use chrono::TimeZone;
use serde::de::DeserializeOwned;

const SESSION_STREAM_LIMIT: usize = 200_000;
const TERMINAL_STREAM_LIMIT: usize = 200_000;
const AGENT_LIFECYCLE_HISTORY_LIMIT_PER_SESSION: i64 = 128;
const APP_UI_STATE_ROW_ID: i64 = 1;

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

fn default_view_state(active_session_id: u64) -> WorkspaceViewState {
    WorkspaceViewState {
        active_session_id: active_session_id.to_string(),
        active_pane_id: format!("pane-{active_session_id}"),
        active_terminal_id: String::new(),
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

fn load_agent_lifecycle_events_from_conn(
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

fn load_workspace_controller_lease_from_conn(
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

fn save_workspace_controller_lease_to_conn(
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

fn upsert_workspace_attachment_to_conn(
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

fn list_workspace_ids_for_workspace_client_from_conn(
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

fn mark_workspace_client_detached_from_conn(
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
        archive,
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
    conn.execute(
        "UPDATE workspace_terminals SET recoverable = 0, updated_at = ?1",
        params![now_ts()],
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
    state: State<'_, AppState>,
    f: impl FnOnce(&Connection) -> Result<T, String>,
) -> Result<T, String> {
    let guard = state.db.lock().map_err(|e| e.to_string())?;
    let conn = guard.as_ref().ok_or("db_not_ready")?;
    f(conn)
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

pub(crate) fn workspace_access_context(
    state: State<'_, AppState>,
    workspace_id: &str,
) -> Result<(String, ExecTarget), String> {
    with_db(state, |conn| {
        let row = load_workspace_row(conn, workspace_id)?;
        Ok((row.root_path, row.target))
    })
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
    state: State<'_, AppState>,
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
    state: State<'_, AppState>,
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
    state: State<'_, AppState>,
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
    state: State<'_, AppState>,
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
        let current = load_view_state_from_conn(conn, workspace_id)
            .or_else(|_| Ok::<WorkspaceViewState, String>(default_view_state(1)))?;
        let next = WorkspaceViewState {
            active_session_id: patch.active_session_id.unwrap_or(current.active_session_id),
            active_pane_id: patch.active_pane_id.unwrap_or(current.active_pane_id),
            active_terminal_id: patch
                .active_terminal_id
                .unwrap_or(current.active_terminal_id),
            pane_layout: patch.pane_layout.unwrap_or(current.pane_layout),
            file_preview: patch.file_preview.unwrap_or(current.file_preview),
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

pub(crate) fn load_agent_lifecycle_events(
    state: State<'_, AppState>,
    workspace_id: &str,
    limit: usize,
) -> Result<Vec<AgentLifecycleHistoryEntry>, String> {
    with_db(state, |conn| {
        load_agent_lifecycle_events_from_conn(conn, workspace_id, limit)
    })
}

pub(crate) fn list_workspace_ids_for_workspace_client(
    state: State<'_, AppState>,
    device_id: &str,
    client_id: &str,
) -> Result<Vec<String>, String> {
    with_db(state, |conn| {
        list_workspace_ids_for_workspace_client_from_conn(conn, device_id, client_id)
    })
}

pub(crate) fn mark_workspace_client_detached(
    state: State<'_, AppState>,
    device_id: &str,
    client_id: &str,
) -> Result<(), String> {
    with_db(state, |conn| {
        mark_workspace_client_detached_from_conn(conn, device_id, client_id)
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

pub(crate) fn append_session_stream(
    state: State<'_, AppState>,
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
    state: State<'_, AppState>,
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
    state: State<'_, AppState>,
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
    state: State<'_, AppState>,
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
