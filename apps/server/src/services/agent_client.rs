use crate::*;

#[cfg_attr(not(target_os = "windows"), allow(dead_code))]
pub(crate) enum AgentLaunchSpec {
    ShellCommand(String),
    Direct {
        program: String,
        args: Vec<String>,
        display_command: String,
    },
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
