use crate::*;
use crate::models::ProviderRuntimePreview;
use std::collections::BTreeMap;

pub(crate) struct ProviderLaunchConfig {
    pub(crate) launch_spec: crate::services::agent_client::AgentLaunchSpec,
    pub(crate) runtime_env: BTreeMap<String, String>,
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

pub(crate) fn provider_runtime_preview(
    settings: &AppSettingsPayload,
    provider: &ProviderId,
    target: &ExecTarget,
) -> Result<ProviderRuntimePreview, String> {
    let adapter = resolve_provider_adapter(provider.as_str())
        .ok_or_else(|| format!("unknown_provider:{}", provider.as_str()))?;
    let launch = adapter.build_start(settings, target)?;
    Ok(ProviderRuntimePreview {
        provider: provider.clone(),
        display_command: crate::services::session_runtime::launch_spec_display_command(
            &launch.launch_spec,
        ),
    })
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
        assert_eq!(
            serde_json::to_string(&provider_id).unwrap(),
            "\"custom-agent\""
        );
        assert_eq!(
            serde_json::from_str::<ProviderId>("\"codex\"")
                .unwrap()
                .as_str(),
            "codex"
        );
    }
}
