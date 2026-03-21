use crate::infra::runtime::{parse_command_binary, probe_native_command, probe_wsl_command};
use crate::*;

fn user_home_dir() -> Option<PathBuf> {
    std::env::var_os("HOME")
        .map(PathBuf::from)
        .or_else(|| std::env::var_os("USERPROFILE").map(PathBuf::from))
}

fn is_ignored_scan_dir(path: &Path) -> bool {
    matches!(
        path.file_name().and_then(|value| value.to_str()),
        Some(".git")
            | Some("node_modules")
            | Some("target")
            | Some("dist")
            | Some("build")
            | Some(".next")
            | Some(".turbo")
            | Some("coverage")
    )
}

fn strip_frontmatter(markdown: &str) -> &str {
    if !markdown.starts_with("---\n") {
        return markdown;
    }
    let remainder = &markdown[4..];
    if let Some(index) = remainder.find("\n---\n") {
        &remainder[(index + 5)..]
    } else {
        markdown
    }
}

fn parse_markdown_frontmatter(markdown: &str) -> (Option<String>, Option<String>, bool) {
    if !markdown.starts_with("---\n") {
        return (None, None, true);
    }
    let remainder = &markdown[4..];
    let Some(index) = remainder.find("\n---\n") else {
        return (None, None, true);
    };
    let header = &remainder[..index];
    let mut name = None;
    let mut description = None;
    let mut user_invocable = true;

    for line in header.lines() {
        let Some((raw_key, raw_value)) = line.split_once(':') else {
            continue;
        };
        let key = raw_key.trim();
        let value = raw_value.trim().trim_matches('"').trim_matches('\'');
        match key {
            "name" if !value.is_empty() => name = Some(value.to_string()),
            "description" if !value.is_empty() => description = Some(value.to_string()),
            "user-invocable" => {
                user_invocable = !matches!(value, "false" | "False" | "FALSE");
            }
            _ => {}
        }
    }

    (name, description, user_invocable)
}

fn first_markdown_summary(markdown: &str) -> Option<String> {
    let content = strip_frontmatter(markdown);
    let mut lines = Vec::new();

    for line in content.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            if !lines.is_empty() {
                break;
            }
            continue;
        }
        if trimmed.starts_with('#') {
            continue;
        }
        lines.push(trimmed.to_string());
        if lines.len() >= 3 {
            break;
        }
    }

    if lines.is_empty() {
        None
    } else {
        Some(lines.join(" "))
    }
}

fn source_path_label(path: &Path) -> String {
    path.to_string_lossy().replace('\\', "/")
}

fn push_slash_entry(
    entries: &mut Vec<ClaudeSlashSkillEntry>,
    seen_commands: &mut HashSet<String>,
    command_name: String,
    description: String,
    scope: &str,
    source_kind: &str,
    source_path: &Path,
) {
    let trimmed_command = command_name.trim().trim_start_matches('/');
    if trimmed_command.is_empty() {
        return;
    }
    let command = format!("/{}", trimmed_command);
    if !seen_commands.insert(command.clone()) {
        return;
    }

    entries.push(ClaudeSlashSkillEntry {
        id: format!("{}:{}:{}", scope, source_kind, trimmed_command),
        command,
        description,
        scope: scope.to_string(),
        source_kind: source_kind.to_string(),
        source_path: source_path_label(source_path),
    });
}

fn scan_skill_dir(
    skills_dir: &Path,
    scope: &str,
    entries: &mut Vec<ClaudeSlashSkillEntry>,
    seen_commands: &mut HashSet<String>,
) {
    let Ok(skill_dirs) = std::fs::read_dir(skills_dir) else {
        return;
    };

    for dir in skill_dirs.flatten() {
        let path = dir.path();
        if !path.is_dir() {
            continue;
        }
        let markdown_path = path.join("SKILL.md");
        let Ok(markdown) = std::fs::read_to_string(&markdown_path) else {
            continue;
        };
        let (name, description, user_invocable) = parse_markdown_frontmatter(&markdown);
        if !user_invocable {
            continue;
        }
        let command_name = name.unwrap_or_else(|| {
            path.file_name()
                .and_then(|value| value.to_str())
                .unwrap_or_default()
                .to_string()
        });
        let summary = description
            .or_else(|| first_markdown_summary(&markdown))
            .unwrap_or_else(|| "Claude skill".to_string());
        push_slash_entry(
            entries,
            seen_commands,
            command_name,
            summary,
            scope,
            "skill",
            &markdown_path,
        );
    }
}

fn scan_command_dir(
    commands_dir: &Path,
    scope: &str,
    entries: &mut Vec<ClaudeSlashSkillEntry>,
    seen_commands: &mut HashSet<String>,
) {
    let Ok(dir_entries) = std::fs::read_dir(commands_dir) else {
        return;
    };

    for entry in dir_entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            scan_command_dir(&path, scope, entries, seen_commands);
            continue;
        }
        if path.extension().and_then(|value| value.to_str()) != Some("md") {
            continue;
        }
        let Ok(markdown) = std::fs::read_to_string(&path) else {
            continue;
        };
        let (name, description, user_invocable) = parse_markdown_frontmatter(&markdown);
        if !user_invocable {
            continue;
        }
        let command_name = name.unwrap_or_else(|| {
            path.file_stem()
                .and_then(|value| value.to_str())
                .unwrap_or_default()
                .to_string()
        });
        let summary = description
            .or_else(|| first_markdown_summary(&markdown))
            .unwrap_or_else(|| "Claude command".to_string());
        push_slash_entry(
            entries,
            seen_commands,
            command_name,
            summary,
            scope,
            "command",
            &path,
        );
    }
}

fn scan_claude_root(
    claude_dir: &Path,
    scope: &str,
    entries: &mut Vec<ClaudeSlashSkillEntry>,
    seen_commands: &mut HashSet<String>,
) {
    scan_skill_dir(&claude_dir.join("skills"), scope, entries, seen_commands);
    scan_command_dir(&claude_dir.join("commands"), scope, entries, seen_commands);
}

fn walk_project_claude_roots(
    current: &Path,
    roots: &mut Vec<PathBuf>,
    seen_roots: &mut HashSet<PathBuf>,
) {
    if is_ignored_scan_dir(current) {
        return;
    }

    if current.file_name().and_then(|value| value.to_str()) == Some(".claude") {
        if seen_roots.insert(current.to_path_buf()) {
            roots.push(current.to_path_buf());
        }
        return;
    }

    let Ok(entries) = std::fs::read_dir(current) else {
        return;
    };

    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            walk_project_claude_roots(&path, roots, seen_roots);
        }
    }
}

pub(crate) fn claude_slash_skills(cwd: String) -> Result<Vec<ClaudeSlashSkillEntry>, String> {
    let mut entries = Vec::new();
    let mut seen_commands = HashSet::new();

    if let Some(home_dir) = user_home_dir() {
        scan_claude_root(
            &home_dir.join(".claude"),
            "personal",
            &mut entries,
            &mut seen_commands,
        );
    }

    if !cwd.trim().is_empty() {
        let root = PathBuf::from(cwd);
        if root.exists() {
            let mut claude_roots = Vec::new();
            let mut seen_roots = HashSet::new();
            walk_project_claude_roots(&root, &mut claude_roots, &mut seen_roots);
            claude_roots.sort();
            for claude_root in claude_roots {
                scan_claude_root(&claude_root, "project", &mut entries, &mut seen_commands);
            }
        }
    }

    entries.sort_by(|left, right| left.command.cmp(&right.command));
    Ok(entries)
}

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
