use crate::*;
use std::collections::BTreeMap;

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) enum FirstSubmitStrategy {
    ImmediateNewline,
    FlushThenDelayedNewline { delay_ms: u64 },
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct ProviderInputPolicy {
    pub(crate) first_submit_strategy: FirstSubmitStrategy,
}

pub(crate) struct ProviderLaunchConfig {
    pub(crate) launch_spec: crate::services::agent_client::AgentLaunchSpec,
    pub(crate) runtime_env: BTreeMap<String, String>,
    pub(crate) input_policy: ProviderInputPolicy,
}

pub(crate) trait ProviderAdapter: Sync {
    fn id(&self) -> &'static str;
    fn build_start(
        &self,
        settings: &AppSettingsPayload,
        target: &ExecTarget,
    ) -> Result<ProviderLaunchConfig, String>;
    fn build_resume(
        &self,
        settings: &AppSettingsPayload,
        target: &ExecTarget,
        resume_id: &str,
    ) -> Result<ProviderLaunchConfig, String>;
    fn ensure_workspace_integration(&self, cwd: &str, target: &ExecTarget) -> Result<(), String>;
    fn normalize_hook_payload(&self, payload: &Value) -> Option<AgentLifecycleEvent>;
    fn extract_resume_id(&self, payload: &Value) -> Option<String>;
}

pub(crate) fn resolve_provider_adapter(provider_id: &str) -> Option<&'static dyn ProviderAdapter> {
    match provider_id {
        "claude" => Some(crate::services::claude::adapter()),
        "codex" => Some(crate::services::codex::adapter()),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn provider_registry_resolves_builtin_adapters_by_string_id() {
        assert_eq!(resolve_provider_adapter("claude").unwrap().id(), "claude");
        assert_eq!(resolve_provider_adapter("codex").unwrap().id(), "codex");
        assert!(resolve_provider_adapter("mock").is_none());
        assert!(resolve_provider_adapter("missing").is_none());
    }

    #[test]
    fn provider_id_serializes_as_plain_json_string() {
        let provider_id = ProviderId::new("custom-agent").expect("provider id");
        assert_eq!(serde_json::to_string(&provider_id).unwrap(), "\"custom-agent\"");
        assert_eq!(
            serde_json::from_str::<ProviderId>("\"codex\"")
                .unwrap()
                .as_str(),
            "codex"
        );
    }
}
