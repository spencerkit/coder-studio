use crate::*;

pub(crate) fn init_db(conn: &Connection) -> Result<(), rusqlite::Error> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS sessions (
        id INTEGER PRIMARY KEY,
        tab_id TEXT NOT NULL,
        mode TEXT NOT NULL,
        status TEXT NOT NULL,
        auto_feed INTEGER NOT NULL,
        last_active_at INTEGER NOT NULL,
        payload TEXT NOT NULL
     );
     CREATE TABLE IF NOT EXISTS archives (
        id INTEGER PRIMARY KEY,
        tab_id TEXT NOT NULL,
        session_id INTEGER NOT NULL,
        time TEXT NOT NULL,
        mode TEXT NOT NULL,
        payload TEXT NOT NULL
     );",
    )
}

pub(crate) fn with_db<T>(
    state: &State<'_, AppState>,
    f: impl FnOnce(&Connection) -> Result<T, String>,
) -> Result<Option<T>, String> {
    let guard = state.db.lock().map_err(|e| e.to_string())?;
    if let Some(conn) = guard.as_ref() {
        f(conn).map(Some)
    } else {
        Ok(None)
    }
}

pub(crate) fn persist_session(state: &State<'_, AppState>, tab_id: &str, session: &SessionInfo) {
    let payload = serde_json::to_string(session).unwrap_or_default();
    let _ = with_db(state, |conn| {
        conn.execute(
      "INSERT OR REPLACE INTO sessions (id, tab_id, mode, status, auto_feed, last_active_at, payload)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
      params![
        session.id as i64,
        tab_id,
        mode_label(&session.mode),
        status_label(&session.status),
        if session.auto_feed { 1 } else { 0 },
        session.last_active_at,
        payload
      ],
    ).map_err(|e| e.to_string())?;
        Ok(())
    });
}

pub(crate) fn persist_archive(state: &State<'_, AppState>, tab_id: &str, entry: &ArchiveEntry) {
    let payload = serde_json::to_string(&entry.snapshot).unwrap_or_default();
    let _ = with_db(state, |conn| {
        conn.execute(
            "INSERT OR REPLACE INTO archives (id, tab_id, session_id, time, mode, payload)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![
                entry.id as i64,
                tab_id,
                entry.session_id as i64,
                entry.time,
                mode_label(&entry.mode),
                payload
            ],
        )
        .map_err(|e| e.to_string())?;
        Ok(())
    });
}

pub(crate) fn delete_session(state: &State<'_, AppState>, tab_id: &str, session_id: u64) {
    let _ = with_db(state, |conn| {
        conn.execute(
            "DELETE FROM sessions WHERE id = ?1 AND tab_id = ?2",
            params![session_id as i64, tab_id],
        )
        .map_err(|e| e.to_string())?;
        Ok(())
    });
}

pub(crate) fn snapshot_tab(tab: &TabState) -> TabSnapshot {
    TabSnapshot {
        tab_id: tab.tab_id.clone(),
        project_path: tab.project_path.clone(),
        target: tab.target.clone(),
        idle_policy: tab.idle_policy.clone(),
        sessions: tab.sessions.clone(),
        active_session_id: tab.active_session_id,
        archive: tab.archive.clone(),
        terminals: tab.terminals.clone(),
    }
}

pub(crate) fn ensure_tab<'a>(
    state: &'a mut HashMap<String, TabState>,
    tab_id: &str,
    target: &ExecTarget,
) -> &'a mut TabState {
    if !state.contains_key(tab_id) {
        state.insert(tab_id.to_string(), bootstrap_tab_state(tab_id, target));
    }
    state.get_mut(tab_id).unwrap()
}
