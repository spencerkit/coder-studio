use std::collections::BTreeMap;

use crate::services::workspace::live_session_key;
use crate::*;

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct GatewayTerminalRuntime {
    pub(crate) runtime_id: String,
    pub(crate) workspace_id: String,
    pub(crate) session_id: String,
    pub(crate) provider: String,
    pub(crate) tmux_session_name: String,
    pub(crate) tmux_pane_id: String,
}

pub(crate) type TerminalRuntime = GatewayTerminalRuntime;

impl GatewayTerminalRuntime {
    pub(crate) fn new(
        runtime_id: String,
        workspace_id: String,
        session_id: String,
        provider: String,
        tmux_session_name: String,
        tmux_pane_id: String,
    ) -> Self {
        Self {
            runtime_id,
            workspace_id,
            session_id,
            provider,
            tmux_session_name,
            tmux_pane_id,
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

    #[cfg(test)]
    {
        let _ = input;
        let _ = runtime;
        return Ok(());
    }

    #[cfg(not(test))]
    {
        crate::services::tmux::send_tmux_raw_input(&runtime.tmux_session_name, input)
    }
}

pub(crate) fn emit_terminal_channel_output(app: &AppHandle, runtime_id: &str, data: &str) {
    crate::ws::server::emit_terminal_channel_output(app, runtime_id, data);
}

#[cfg(test)]
mod tests {
    use super::*;

    fn runtime(runtime_id: &str, workspace_id: &str, session_id: &str) -> GatewayTerminalRuntime {
        GatewayTerminalRuntime::new(
            runtime_id.to_string(),
            workspace_id.to_string(),
            session_id.to_string(),
            "claude".to_string(),
            format!("coder-studio-{workspace_id}-{session_id}"),
            "%1".to_string(),
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
}
