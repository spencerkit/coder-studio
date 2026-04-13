use std::collections::BTreeMap;

use crate::services::workspace::live_session_key;
use crate::*;

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct GatewayTerminalRuntime {
    pub(crate) runtime_id: String,
    pub(crate) workspace_id: String,
    pub(crate) session_id: String,
    pub(crate) provider: String,
    pub(crate) terminal_id: u64,
}

pub(crate) type TerminalRuntime = GatewayTerminalRuntime;

impl GatewayTerminalRuntime {
    pub(crate) fn new(
        runtime_id: String,
        workspace_id: String,
        session_id: String,
        provider: String,
        terminal_id: u64,
    ) -> Self {
        Self {
            runtime_id,
            workspace_id,
            session_id,
            provider,
            terminal_id,
        }
    }
}

#[derive(Default)]
pub(crate) struct TerminalRuntimeRegistry {
    by_runtime_id: BTreeMap<String, GatewayTerminalRuntime>,
    by_session_key: BTreeMap<String, String>,
}

impl TerminalRuntimeRegistry {
    pub(crate) fn insert(
        &mut self,
        runtime: GatewayTerminalRuntime,
    ) -> Option<GatewayTerminalRuntime> {
        let session_key = live_session_key(&runtime.workspace_id, &runtime.session_id);
        let runtime_id = runtime.runtime_id.clone();
        let replaced_runtime = self
            .by_session_key
            .insert(session_key, runtime_id)
            .and_then(|previous_runtime_id| self.by_runtime_id.remove(&previous_runtime_id));
        self.by_runtime_id
            .insert(runtime.runtime_id.clone(), runtime);
        replaced_runtime
    }

    pub(crate) fn by_session(
        &self,
        workspace_id: &str,
        session_id: &str,
    ) -> Option<&GatewayTerminalRuntime> {
        self.by_session_key
            .get(&live_session_key(workspace_id, session_id))
            .and_then(|runtime_id| self.by_runtime_id.get(runtime_id))
    }

    pub(crate) fn by_runtime_id(&self, runtime_id: &str) -> Option<&GatewayTerminalRuntime> {
        self.by_runtime_id.get(runtime_id)
    }

    pub(crate) fn remove(
        &mut self,
        workspace_id: &str,
        session_id: &str,
    ) -> Option<GatewayTerminalRuntime> {
        let session_key = live_session_key(workspace_id, session_id);
        let runtime_id = self.by_session_key.remove(&session_key)?;
        self.by_runtime_id.remove(&runtime_id)
    }
}

pub(crate) fn send_input(
    runtime_id: &str,
    input: &str,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let runtime = state
        .terminal_runtimes
        .lock()
        .map_err(|error| error.to_string())?
        .by_runtime_id(runtime_id)
        .cloned()
        .ok_or_else(|| "terminal_runtime_not_found".to_string())?;

    crate::services::terminal::terminal_write(
        runtime.workspace_id.clone(),
        runtime.terminal_id,
        input.to_string(),
        crate::TerminalWriteOrigin::User,
        state,
    )?;

    let _ = sync_session_runtime_state(
        state,
        &runtime.workspace_id,
        &runtime.session_id,
        SessionStatus::Running,
        true,
        Some(SessionRuntimeLiveness::Attached),
    );
    Ok(())
}

pub(crate) fn emit_terminal_channel_output(app: &AppHandle, runtime_id: &str, data: &str) {
    crate::ws::server::emit_terminal_channel_output(app, runtime_id, data);
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::runtime::RuntimeHandle;
    use crate::services::workspace::resolve_session_for_slot;
    use crate::{
        create_session, default_idle_policy, init_db, launch_workspace_record, AgentProvider,
        ExecTarget, SessionMode, TerminalWriteOrigin, WorkspaceSource, WorkspaceSourceKind,
    };

    fn test_app() -> AppHandle {
        let (app, _shutdown_rx) = RuntimeHandle::new();
        let conn = rusqlite::Connection::open_in_memory().unwrap();
        init_db(&conn).unwrap();
        *app.state().db.lock().unwrap() = Some(conn);
        app
    }

    fn launch_test_workspace(app: &AppHandle, root: &str) -> String {
        let result = launch_workspace_record(
            app.state(),
            WorkspaceSource {
                kind: WorkspaceSourceKind::Local,
                path_or_url: root.to_string(),
                target: ExecTarget::Native,
            },
            root.to_string(),
            default_idle_policy(),
        )
        .unwrap();
        result.snapshot.workspace.workspace_id
    }

    fn runtime(runtime_id: &str, workspace_id: &str, session_id: &str) -> GatewayTerminalRuntime {
        GatewayTerminalRuntime::new(
            runtime_id.to_string(),
            workspace_id.to_string(),
            session_id.to_string(),
            "claude".to_string(),
            0,
        )
    }

    #[test]
    fn terminal_runtime_registry_tracks_runtime_by_workspace_and_session() {
        let mut registry = TerminalRuntimeRegistry::default();
        let runtime = runtime("runtime-1", "ws-1", "session-1");

        registry.insert(runtime.clone());

        let stored = registry
            .by_session("ws-1", "session-1")
            .expect("runtime should exist");
        assert_eq!(stored.runtime_id, "runtime-1");
        assert_eq!(stored.provider, "claude");
    }

    #[test]
    fn terminal_runtime_registry_returns_none_for_missing_session() {
        let registry = TerminalRuntimeRegistry::default();

        assert_eq!(registry.by_session("ws-1", "missing-session"), None);
    }

    #[test]
    fn terminal_runtime_registry_insert_reports_replaced_runtime() {
        let mut registry = TerminalRuntimeRegistry::default();
        let original = runtime("runtime-1", "ws-1", "session-1");
        let replacement = runtime("runtime-2", "ws-1", "session-1");

        let first_insert = registry.insert(original.clone());
        let replaced = registry.insert(replacement.clone());

        assert_eq!(first_insert, None);
        assert_eq!(replaced, Some(original));
        assert_eq!(registry.by_session("ws-1", "session-1"), Some(&replacement));
        assert_eq!(registry.by_runtime_id("runtime-2"), Some(&replacement));
        assert_eq!(registry.by_runtime_id("runtime-1"), None);
    }

    #[test]
    fn terminal_runtime_registry_remove_clears_registered_runtime() {
        let mut registry = TerminalRuntimeRegistry::default();
        let original = runtime("runtime-1", "ws-1", "session-1");

        registry.insert(original.clone());

        let removed = registry.remove("ws-1", "session-1");

        assert_eq!(removed, Some(original));
        assert_eq!(registry.by_session("ws-1", "session-1"), None);
    }

    #[test]
    fn send_input_marks_bound_session_running() {
        let app = test_app();
        let workspace_id = launch_test_workspace(&app, "/tmp/ws-terminal-channel-running-state");
        let created = create_session(
            workspace_id.clone(),
            SessionMode::Branch,
            AgentProvider::claude(),
            app.state(),
        )
        .unwrap();
        let terminal_id = 42u64;
        app.state().terminal_runtimes.lock().unwrap().insert(
            TerminalRuntime::new(
                "runtime-1".to_string(),
                workspace_id.clone(),
                created.id.clone(),
                "claude".to_string(),
                terminal_id,
            ),
        );

        send_input("runtime-1", "hello", app.state()).unwrap();

        let updated = resolve_session_for_slot(app.state(), &workspace_id, &created.id).unwrap();
        assert_eq!(updated.status, SessionStatus::Running);
        assert_eq!(
            updated.runtime_liveness,
            Some(SessionRuntimeLiveness::Attached)
        );

        let log = app.state().terminal_write_log.lock().unwrap();
        assert!(
            log.iter().any(|(ws, tid, data, origin)| {
                ws == &workspace_id && *tid == terminal_id && data == "hello" && *origin == TerminalWriteOrigin::User
            }),
            "terminal_write_log should contain the sent input: {:?}",
            &*log
        );
    }
}
