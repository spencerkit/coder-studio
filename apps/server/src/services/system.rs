use crate::infra::runtime::{parse_command_binary, probe_native_command, probe_wsl_command};
use crate::*;

pub(crate) fn command_exists(
    command: String,
    target: ExecTarget,
    cwd: Option<String>,
) -> Result<CommandAvailability, String> {
    let trimmed = command.trim().to_string();
    let Some(binary) = parse_command_binary(&trimmed) else {
        return Ok(CommandAvailability {
            command: trimmed,
            available: false,
            resolved_path: None,
            error: Some("empty_command".to_string()),
        });
    };

    let cwd_ref = cwd
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty());
    let result = match &target {
        ExecTarget::Native => probe_native_command(&binary, cwd_ref),
        ExecTarget::Wsl { .. } => probe_wsl_command(&binary, &target, cwd_ref),
    };

    Ok(match result {
        Ok(resolved_path) => CommandAvailability {
            command: trimmed,
            available: true,
            resolved_path: Some(resolved_path),
            error: None,
        },
        Err(error) => CommandAvailability {
            command: trimmed,
            available: false,
            resolved_path: None,
            error: Some(if error.trim().is_empty() {
                format!("`{binary}` was not found")
            } else {
                error
            }),
        },
    })
}
