use crate::*;

pub(crate) trait AgentClientAdapter {
    fn start_command(&self, target: &ExecTarget) -> String;
    fn resume_command(&self, target: &ExecTarget, resume_id: &str) -> String;
    fn runtime_env(&self) -> &std::collections::BTreeMap<String, String>;
    fn ensure_workspace_hooks(&self, cwd: &str, target: &ExecTarget) -> Result<(), String>;
}

pub(crate) struct ClaudeClient {
    profile: ClaudeRuntimeProfile,
}

impl ClaudeClient {
    fn new(profile: ClaudeRuntimeProfile) -> Self {
        Self { profile }
    }
}

impl AgentClientAdapter for ClaudeClient {
    fn start_command(&self, target: &ExecTarget) -> String {
        crate::services::claude::build_claude_start_command(target, &self.profile)
    }

    fn resume_command(&self, target: &ExecTarget, resume_id: &str) -> String {
        crate::services::claude::build_claude_resume_launch_command(
            target,
            &self.profile,
            resume_id,
        )
    }

    fn runtime_env(&self) -> &std::collections::BTreeMap<String, String> {
        &self.profile.env
    }

    fn ensure_workspace_hooks(&self, cwd: &str, target: &ExecTarget) -> Result<(), String> {
        ensure_claude_hook_settings(cwd, target)
    }
}

pub(crate) struct CodexClient {
    profile: CodexRuntimeProfile,
}

impl CodexClient {
    fn new(profile: CodexRuntimeProfile) -> Self {
        Self { profile }
    }
}

impl AgentClientAdapter for CodexClient {
    fn start_command(&self, target: &ExecTarget) -> String {
        crate::services::codex::build_codex_start_command(target, &self.profile)
    }

    fn resume_command(&self, target: &ExecTarget, resume_id: &str) -> String {
        crate::services::codex::build_codex_resume_command(target, &self.profile, resume_id)
    }

    fn runtime_env(&self) -> &std::collections::BTreeMap<String, String> {
        &self.profile.env
    }

    fn ensure_workspace_hooks(&self, cwd: &str, target: &ExecTarget) -> Result<(), String> {
        ensure_codex_hook_settings(cwd, target)
    }
}

pub(crate) fn resolve_agent_client(
    provider: AgentProvider,
    settings: &AppSettingsPayload,
    target: &ExecTarget,
) -> Box<dyn AgentClientAdapter> {
    match provider {
        AgentProvider::Claude => {
            Box::new(ClaudeClient::new(resolve_claude_runtime_profile(settings, target)))
        }
        AgentProvider::Codex => {
            Box::new(CodexClient::new(resolve_codex_runtime_profile(settings, target)))
        }
    }
}

pub(crate) fn escape_agent_command_part(target: &ExecTarget, value: &str) -> String {
    if matches!(target, ExecTarget::Wsl { .. }) {
        return shell_escape(value);
    }

    #[cfg(target_os = "windows")]
    {
        crate::infra::runtime::shell_escape_windows(value)
    }

    #[cfg(not(target_os = "windows"))]
    {
        shell_escape(value)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::BTreeMap;

    #[test]
    fn claude_client_separates_start_and_resume_commands() {
        let client = ClaudeClient::new(ClaudeRuntimeProfile {
            executable: "claude".into(),
            startup_args: vec!["--model".into(), "sonnet".into()],
            env: BTreeMap::new(),
            settings_json: Value::Object(Map::new()),
            global_config_json: Value::Object(Map::new()),
        });

        assert_eq!(
            client.start_command(&ExecTarget::Native),
            "claude --model sonnet"
        );
        assert_eq!(
            client.resume_command(&ExecTarget::Native, "resume-123"),
            "claude --model sonnet --resume resume-123"
        );
    }

    #[test]
    fn codex_client_separates_start_and_resume_commands() {
        let client = CodexClient::new(CodexRuntimeProfile {
            executable: "codex".into(),
            extra_args: vec!["--full-auto".into()],
            model: String::new(),
            approval_policy: String::new(),
            sandbox_mode: String::new(),
            web_search: String::new(),
            model_reasoning_effort: String::new(),
            env: BTreeMap::new(),
        });

        assert_eq!(
            client.start_command(&ExecTarget::Native),
            "codex --full-auto --enable codex_hooks"
        );
        assert_eq!(
            client.resume_command(&ExecTarget::Native, "resume-123"),
            "codex resume resume-123 --full-auto --enable codex_hooks"
        );
    }
}
