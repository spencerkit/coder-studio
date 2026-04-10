use crate::models::ProviderRuntimePreview;
use crate::*;
use std::collections::BTreeMap;

pub(crate) struct ProviderLaunchConfig {
    pub(crate) launch_spec: crate::services::agent_client::AgentLaunchSpec,
    pub(crate) runtime_env: BTreeMap<String, String>,
}

pub(crate) trait ProviderAdapter: Sync {
    fn id(&self) -> &'static str;
    fn list_workspace_sessions(
        &self,
        workspace_path: &str,
    ) -> Result<Vec<ProviderWorkspaceSession>, String>;
    fn session_exists(&self, workspace_path: &str, resume_id: &str) -> Result<bool, String>;
    fn delete_workspace_session(&self, workspace_path: &str, resume_id: &str)
        -> Result<(), String>;
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
    /// Builds a provider-native one-shot/headless invocation for supervisor turns.
    /// The returned launch spec must be non-interactive and consumable by
    /// `agent_client::run_one_shot_prompt` (prompt provided via stdin or args).
    fn build_supervisor_invoke(
        &self,
        settings: &AppSettingsPayload,
        target: &ExecTarget,
    ) -> Result<ProviderLaunchConfig, String>;
    fn hooks_installed(&self) -> bool;
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

pub(crate) fn install_provider_hooks(
    provider_id: &str,
    cwd: &str,
    target: &ExecTarget,
) -> Result<(), String> {
    let adapter = resolve_provider_adapter(provider_id)
        .ok_or_else(|| format!("unknown_provider:{provider_id}"))?;
    adapter.ensure_workspace_integration(cwd, target)
}

pub(crate) fn provider_hook_install_required(provider_id: &str) -> Result<bool, String> {
    let adapter = resolve_provider_adapter(provider_id)
        .ok_or_else(|| format!("unknown_provider:{provider_id}"))?;
    Ok(!adapter.hooks_installed())
}

pub(crate) fn install_missing_provider_hooks(
    settings: &AppSettingsPayload,
    cwd: &str,
    target: &ExecTarget,
) -> Vec<(String, String)> {
    let mut providers = settings.providers.keys().cloned().collect::<Vec<_>>();
    let default_provider = settings.agent_defaults.provider.as_str().to_string();
    if !default_provider.is_empty() {
        providers.push(default_provider);
    }
    providers.sort();
    providers.dedup();

    providers
        .into_iter()
        .filter_map(
            |provider_id| match provider_hook_install_required(&provider_id) {
                Ok(false) => None,
                Ok(true) => install_provider_hooks(&provider_id, cwd, target)
                    .err()
                    .map(|error| (provider_id, error)),
                Err(error) => Some((provider_id, error)),
            },
        )
        .collect()
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

pub(crate) fn provider_boot_command(
    settings: &AppSettingsPayload,
    provider: &ProviderId,
    target: &ExecTarget,
    resume_id: Option<&str>,
) -> Result<String, String> {
    let adapter = resolve_provider_adapter(provider.as_str())
        .ok_or_else(|| format!("unknown_provider:{}", provider.as_str()))?;
    let launch = match resume_id {
        Some(id) => adapter.build_resume(settings, target, id)?,
        None => adapter.build_start(settings, target)?,
    };
    Ok(crate::services::session_runtime::launch_spec_display_command(&launch.launch_spec))
}

#[cfg(test)]
pub(crate) fn provider_env_test_lock() -> &'static std::sync::Mutex<()> {
    static LOCK: std::sync::OnceLock<std::sync::Mutex<()>> = std::sync::OnceLock::new();
    LOCK.get_or_init(|| std::sync::Mutex::new(()))
}

#[cfg(test)]
pub(crate) struct ProviderEnvVarGuard {
    key: &'static str,
    previous: Option<std::ffi::OsString>,
}

#[cfg(test)]
impl ProviderEnvVarGuard {
    pub(crate) fn set(key: &'static str, value: impl AsRef<std::ffi::OsStr>) -> Self {
        let previous = std::env::var_os(key);
        std::env::set_var(key, value);
        Self { key, previous }
    }
}

#[cfg(test)]
impl Drop for ProviderEnvVarGuard {
    fn drop(&mut self) {
        if let Some(value) = self.previous.take() {
            std::env::set_var(self.key, value);
        } else {
            std::env::remove_var(self.key);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::infra::time::now_ts_ms;
    use std::path::Path;

    fn write_installed_claude_hooks(home_root: &Path) {
        std::fs::create_dir_all(home_root.join(".claude")).unwrap();
        std::fs::write(
            home_root.join(".claude/settings.json"),
            serde_json::to_string_pretty(&json!({
                "hooks": {
                    "SessionStart": [{
                        "matcher": ".*",
                        "hooks": [{
                            "type": "command",
                            "command": "/bin/sh -lc 'exec \"/tmp/app\" --coder-studio-agent-hook'"
                        }]
                    }],
                    "Stop": [{
                        "hooks": [{
                            "type": "command",
                            "command": "/bin/sh -lc 'exec \"/tmp/app\" --coder-studio-agent-hook'"
                        }]
                    }]
                }
            }))
            .unwrap(),
        )
        .unwrap();
    }

    fn write_installed_codex_hooks(home_root: &Path) {
        std::fs::create_dir_all(home_root.join(".codex")).unwrap();
        std::fs::write(
            home_root.join(".codex/config.toml"),
            "[features]\ncodex_hooks = true\n",
        )
        .unwrap();
        std::fs::write(
            home_root.join(".codex/hooks.json"),
            serde_json::to_string_pretty(&json!({
                "hooks": {
                    "SessionStart": [{
                        "matcher": "startup|resume",
                        "hooks": [{
                            "type": "command",
                            "command": "/bin/sh -lc 'exec \"/tmp/app\" --coder-studio-agent-hook'"
                        }]
                    }],
                    "Stop": [{
                        "hooks": [{
                            "type": "command",
                            "command": "/bin/sh -lc 'exec \"/tmp/app\" --coder-studio-agent-hook'"
                        }]
                    }]
                }
            }))
            .unwrap(),
        )
        .unwrap();
    }

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

    #[test]
    fn install_missing_provider_hooks_skips_when_all_required_hooks_exist() {
        let _guard = provider_env_test_lock().lock().unwrap();
        let claude_home = std::env::temp_dir().join(format!(
            "coder-studio-provider-hooks-claude-installed-{}",
            now_ts_ms()
        ));
        let codex_home = std::env::temp_dir().join(format!(
            "coder-studio-provider-hooks-codex-installed-{}",
            now_ts_ms()
        ));
        write_installed_claude_hooks(&claude_home);
        write_installed_codex_hooks(&codex_home);
        let claude_before =
            std::fs::read_to_string(claude_home.join(".claude/settings.json")).unwrap();
        let codex_before = std::fs::read_to_string(codex_home.join(".codex/hooks.json")).unwrap();

        let _claude_env = ProviderEnvVarGuard::set("CODER_STUDIO_CLAUDE_HOME", &claude_home);
        let _codex_env = ProviderEnvVarGuard::set("CODER_STUDIO_CODEX_HOME", &codex_home);

        let mut settings = AppSettingsPayload::default();
        settings.agent_defaults.provider = ProviderId::claude();
        let errors =
            install_missing_provider_hooks(&settings, "/tmp/workspace", &ExecTarget::Native);

        assert!(errors.is_empty());
        assert_eq!(
            std::fs::read_to_string(claude_home.join(".claude/settings.json")).unwrap(),
            claude_before
        );
        assert_eq!(
            std::fs::read_to_string(codex_home.join(".codex/hooks.json")).unwrap(),
            codex_before
        );

        let _ = std::fs::remove_dir_all(claude_home);
        let _ = std::fs::remove_dir_all(codex_home);
    }

    #[test]
    fn install_missing_provider_hooks_installs_only_missing_providers_and_collects_failures() {
        let _guard = provider_env_test_lock().lock().unwrap();
        let claude_home = std::env::temp_dir().join(format!(
            "coder-studio-provider-hooks-claude-missing-{}",
            now_ts_ms()
        ));
        let codex_home = std::env::temp_dir().join(format!(
            "coder-studio-provider-hooks-codex-missing-{}",
            now_ts_ms()
        ));
        std::fs::create_dir_all(&claude_home).unwrap();
        write_installed_codex_hooks(&codex_home);

        let _claude_env = ProviderEnvVarGuard::set("CODER_STUDIO_CLAUDE_HOME", &claude_home);
        let _codex_env = ProviderEnvVarGuard::set("CODER_STUDIO_CODEX_HOME", &codex_home);
        std::fs::write(claude_home.join(".claude"), "blocking file").unwrap();

        let mut settings = AppSettingsPayload::default();
        settings.agent_defaults.provider = ProviderId::claude();
        settings.providers.remove("codex");

        let errors =
            install_missing_provider_hooks(&settings, "/tmp/workspace", &ExecTarget::Native);

        assert_eq!(errors.len(), 1);
        assert_eq!(errors[0].0, "claude");
        assert!(std::fs::read_to_string(codex_home.join(".codex/hooks.json")).is_ok());
        assert!(!claude_home.join(".claude/settings.json").exists());

        let _ = std::fs::remove_dir_all(claude_home);
        let _ = std::fs::remove_dir_all(codex_home);
    }
}
