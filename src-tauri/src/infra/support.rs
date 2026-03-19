use crate::*;

fn user_home_dir() -> Option<PathBuf> {
    std::env::var_os("HOME")
        .map(PathBuf::from)
        .or_else(|| std::env::var_os("USERPROFILE").map(PathBuf::from))
}

pub(crate) fn build_tree(path: &Path, depth: usize, limit: &mut usize) -> FileNode {
    let name = path
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| path.to_string_lossy().to_string());
    let kind = if path.is_dir() { "dir" } else { "file" };
    let mut node = FileNode {
        name,
        path: path.to_string_lossy().to_string(),
        kind: kind.to_string(),
        status: None,
        children: vec![],
    };

    if kind == "file" || depth == 0 || *limit == 0 {
        return node;
    }

    if let Ok(entries) = std::fs::read_dir(path) {
        for entry in entries.flatten() {
            if *limit == 0 {
                break;
            }
            let file_name = entry.file_name().to_string_lossy().to_string();
            if file_name == ".git" {
                continue;
            }
            let child_path = entry.path();
            *limit = limit.saturating_sub(1);
            if child_path.is_dir() {
                node.children
                    .push(build_tree(&child_path, depth - 1, limit));
            } else {
                node.children.push(FileNode {
                    name: file_name,
                    path: child_path.to_string_lossy().to_string(),
                    kind: "file".to_string(),
                    status: None,
                    children: vec![],
                });
            }
        }
    }
    node
}

fn insert_change(nodes: &mut Vec<FileNode>, parts: &[&str], prefix: &str, status: &str) {
    if parts.is_empty() {
        return;
    }
    let name = parts[0];
    let path = if prefix.is_empty() {
        name.to_string()
    } else {
        format!("{}/{}", prefix, name)
    };
    let is_file = parts.len() == 1;

    let pos = nodes.iter().position(|node| node.name == name);
    let idx = if let Some(index) = pos {
        index
    } else {
        nodes.push(FileNode {
            name: name.to_string(),
            path: path.clone(),
            kind: if is_file {
                "file".to_string()
            } else {
                "dir".to_string()
            },
            status: if is_file && !status.is_empty() {
                Some(status.to_string())
            } else {
                None
            },
            children: vec![],
        });
        nodes.len() - 1
    };

    if !is_file {
        insert_change(&mut nodes[idx].children, &parts[1..], &path, status);
    }
}

pub(crate) fn build_changes_tree(changes: Vec<(String, String)>) -> Vec<FileNode> {
    let mut root: Vec<FileNode> = vec![];
    for (path, status) in changes {
        let parts: Vec<&str> = path.split('/').collect();
        insert_change(&mut root, &parts, "", &status);
    }
    root
}

pub(crate) fn build_tree_from_paths(paths: Vec<String>) -> FileNode {
    let mut root = FileNode {
        name: ".".to_string(),
        path: ".".to_string(),
        kind: "dir".to_string(),
        status: None,
        children: vec![],
    };

    for file_path in paths {
        let trimmed = file_path.trim();
        if trimmed.is_empty() {
            continue;
        }
        let clean = trimmed.trim_start_matches("./");
        let parts: Vec<&str> = clean.split('/').collect();
        insert_change(&mut root.children, &parts, "", "");
    }

    root
}

fn split_git_path(path: &str) -> (String, String) {
    if let Some((parent, name)) = path.rsplit_once('/') {
        (name.to_string(), parent.to_string())
    } else {
        (path.to_string(), String::new())
    }
}

fn git_status_code(code: char) -> String {
    match code {
        '?' => "U".to_string(),
        ' ' => "".to_string(),
        other => other.to_string(),
    }
}

pub(crate) fn parse_git_changes(raw: &str) -> Vec<GitChangeEntry> {
    let mut entries = Vec::new();

    for line in raw.lines() {
        if line.trim().is_empty() || line.len() < 3 {
            continue;
        }

        let chars: Vec<char> = line.chars().collect();
        let index_code = chars.first().copied().unwrap_or(' ');
        let worktree_code = chars.get(1).copied().unwrap_or(' ');
        let mut file_path = line.get(3..).unwrap_or("").trim().to_string();

        if let Some((_, target_path)) = file_path.split_once(" -> ") {
            file_path = target_path.to_string();
        }

        if file_path.is_empty() {
            continue;
        }

        let (name, parent) = split_git_path(&file_path);

        if index_code == '?' && worktree_code == '?' {
            entries.push(GitChangeEntry {
                path: file_path,
                name,
                parent,
                section: "untracked".to_string(),
                status: git_status_label('?').to_string(),
                code: git_status_code('?'),
            });
            continue;
        }

        if index_code != ' ' {
            entries.push(GitChangeEntry {
                path: file_path.clone(),
                name: name.clone(),
                parent: parent.clone(),
                section: "staged".to_string(),
                status: git_status_label(index_code).to_string(),
                code: git_status_code(index_code),
            });
        }

        if worktree_code != ' ' {
            entries.push(GitChangeEntry {
                path: file_path,
                name,
                parent,
                section: "changes".to_string(),
                status: git_status_label(worktree_code).to_string(),
                code: git_status_code(worktree_code),
            });
        }
    }

    entries
}

fn relative_git_path(repo_root: &str, file_path: &str) -> String {
    let normalized_repo = repo_root
        .replace('\\', "/")
        .trim_end_matches('/')
        .to_string();
    let normalized_path = file_path
        .replace('\\', "/")
        .trim()
        .trim_start_matches("file://")
        .to_string();
    let cleaned_path = normalized_path
        .trim_start_matches(":/")
        .trim_start_matches(':')
        .trim_start_matches('/')
        .to_string();

    if let Some(stripped) = cleaned_path.strip_prefix(&(normalized_repo.clone() + "/")) {
        stripped.to_string()
    } else {
        cleaned_path.trim_start_matches("./").to_string()
    }
}

fn git_worktree_path_exists(path: &str, target: &ExecTarget, relative: &str) -> bool {
    if relative.is_empty() {
        return false;
    }
    if matches!(target, ExecTarget::Wsl { .. }) {
        return run_cmd(target, path, &["test", "-e", relative]).is_ok();
    }
    PathBuf::from(path).join(relative).exists()
}

fn git_index_path_exists(path: &str, target: &ExecTarget, relative: &str) -> bool {
    if relative.is_empty() {
        return false;
    }
    run_cmd(
        target,
        path,
        &["git", "ls-files", "--error-unmatch", "--", relative],
    )
    .is_ok()
}

fn git_known_change_paths(path: &str, target: &ExecTarget) -> Vec<String> {
    let raw = run_cmd(target, path, &["git", "status", "--porcelain"]).unwrap_or_default();
    let mut paths = Vec::new();
    for entry in parse_git_changes(&raw) {
        if !entry.path.is_empty() {
            paths.push(entry.path);
        }
    }
    paths.sort();
    paths.dedup();
    paths
}

fn git_known_repo_paths(path: &str, target: &ExecTarget) -> Vec<String> {
    let raw = run_cmd(
        target,
        path,
        &[
            "git",
            "ls-files",
            "--cached",
            "--others",
            "--exclude-standard",
        ],
    )
    .unwrap_or_default();
    let mut paths = raw
        .lines()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(|value| value.to_string())
        .collect::<Vec<_>>();
    paths.sort();
    paths.dedup();
    paths
}

fn recover_git_relative_path_from_paths(candidate: &str, known: &[String]) -> Option<String> {
    if candidate.is_empty() || known.is_empty() {
        return None;
    }

    if let Some(exact) = known.iter().find(|value| *value == candidate) {
        return Some(exact.clone());
    }

    let suffix_matches: Vec<&String> = known
        .iter()
        .filter(|value| value.ends_with(candidate))
        .collect();
    if suffix_matches.len() == 1 {
        return Some(suffix_matches[0].clone());
    }

    let single_char_shift_matches: Vec<&String> = known
        .iter()
        .filter(|value| {
            value.len() == candidate.len() + 1
                && value
                    .chars()
                    .next()
                    .map(|_| value.ends_with(candidate))
                    .unwrap_or(false)
        })
        .collect();
    if single_char_shift_matches.len() == 1 {
        return Some(single_char_shift_matches[0].clone());
    }

    None
}

fn collect_repo_relative_paths(root: &Path, current: &Path, paths: &mut Vec<String>) {
    let entries = match std::fs::read_dir(current) {
        Ok(entries) => entries,
        Err(_) => return,
    };

    for entry in entries.flatten() {
        let entry_path = entry.path();
        let file_name = entry.file_name();
        if file_name.to_string_lossy() == ".git" {
            continue;
        }

        if entry_path.is_dir() {
            collect_repo_relative_paths(root, &entry_path, paths);
            continue;
        }

        if let Ok(relative) = entry_path.strip_prefix(root) {
            let normalized = relative.to_string_lossy().replace('\\', "/");
            if !normalized.is_empty() {
                paths.push(normalized);
            }
        }
    }
}

fn recover_git_relative_path_from_fs(path: &str, candidate: &str) -> Option<String> {
    if candidate.is_empty() {
        return None;
    }

    let root = PathBuf::from(path);
    if !root.exists() {
        return None;
    }

    let mut paths = Vec::new();
    collect_repo_relative_paths(&root, &root, &mut paths);
    paths.sort();
    paths.dedup();
    recover_git_relative_path_from_paths(candidate, &paths)
}

pub(crate) fn resolve_git_command_path(path: &str, target: &ExecTarget, file_path: &str) -> String {
    let candidate = relative_git_path(path, file_path);
    if git_worktree_path_exists(path, target, &candidate)
        || git_index_path_exists(path, target, &candidate)
    {
        return candidate;
    }

    if !candidate.starts_with('.') {
        let dotted = format!(".{}", candidate);
        if git_worktree_path_exists(path, target, &dotted)
            || git_index_path_exists(path, target, &dotted)
        {
            return dotted;
        }
    }

    if let Some(recovered) =
        recover_git_relative_path_from_paths(&candidate, &git_known_change_paths(path, target))
    {
        return recovered;
    }

    if let Some(recovered) =
        recover_git_relative_path_from_paths(&candidate, &git_known_repo_paths(path, target))
    {
        return recovered;
    }

    if let Some(recovered) = recover_git_relative_path_from_fs(path, &candidate) {
        return recovered;
    }

    candidate
}

fn read_file_text(path: &Path) -> String {
    std::fs::read(path)
        .map(|bytes| String::from_utf8_lossy(&bytes).to_string())
        .unwrap_or_default()
}

pub(crate) fn read_target_file_text(path: &str, target: &ExecTarget, relative: &str) -> String {
    if matches!(target, ExecTarget::Wsl { .. }) {
        return run_cmd(target, path, &["cat", relative]).unwrap_or_default();
    }
    read_file_text(&PathBuf::from(path).join(relative))
}

pub(crate) fn git_show_file(path: &str, target: &ExecTarget, spec: &str, relative: &str) -> String {
    let object = if spec == ":" {
        format!(":{}", relative)
    } else {
        format!("{}:{}", spec, relative)
    };
    run_cmd(target, path, &["git", "show", &object]).unwrap_or_default()
}

pub(crate) fn git_cached_diff(path: &str, target: &ExecTarget, relative: Option<&str>) -> String {
    let mut args = vec!["git", "diff", "--cached"];
    if let Some(value) = relative {
        args.push("--");
        args.push(value);
    }
    run_cmd(target, path, &args).unwrap_or_default()
}

pub(crate) fn git_worktree_diff(path: &str, target: &ExecTarget, relative: Option<&str>) -> String {
    let mut args = vec!["git", "diff"];
    if let Some(value) = relative {
        args.push("--");
        args.push(value);
    }
    run_cmd(target, path, &args).unwrap_or_default()
}

pub(crate) fn combine_git_diff_sections(sections: &[String]) -> String {
    let mut merged = Vec::new();
    for section in sections {
        if section.trim().is_empty() {
            continue;
        }
        if !merged.is_empty() {
            merged.push(String::new());
        }
        merged.push(section.trim_end().to_string());
    }
    merged.join("\n")
}

pub(crate) fn git_has_head(path: &str, target: &ExecTarget) -> bool {
    run_cmd(target, path, &["git", "rev-parse", "--verify", "HEAD"]).is_ok()
}

#[cfg(target_os = "windows")]
pub(crate) fn windows_drive_roots() -> Vec<FilesystemRoot> {
    let mut roots = Vec::new();
    for letter in 'C'..='Z' {
        let path = format!("{letter}:\\");
        if Path::new(&path).exists() {
            roots.push(FilesystemRoot {
                id: format!("drive-{letter}"),
                label: format!("{letter}:"),
                path,
                description: "Windows drive".to_string(),
            });
        }
    }
    roots
}

pub(crate) fn filesystem_home_for_target(target: &ExecTarget) -> Result<String, String> {
    match target {
        ExecTarget::Native => user_home_dir()
            .map(|path| path.to_string_lossy().to_string())
            .ok_or("home_directory_not_found".to_string()),
        ExecTarget::Wsl { .. } => {
            let home = run_cmd(target, "", &["printenv", "HOME"])?;
            let trimmed = home.trim();
            if trimmed.is_empty() {
                Err("wsl_home_directory_not_found".to_string())
            } else {
                Ok(trimmed.to_string())
            }
        }
    }
}

pub(crate) fn native_parent_path(path: &str) -> Option<String> {
    let candidate = PathBuf::from(path);
    let parent = candidate.parent()?.to_path_buf();
    let rendered = parent.to_string_lossy().to_string();
    if rendered.is_empty() || rendered == path {
        None
    } else {
        Some(rendered)
    }
}

pub(crate) fn wsl_parent_path(path: &str, target: &ExecTarget) -> Option<String> {
    if path.trim().is_empty() || path == "/" {
        return None;
    }
    run_cmd(target, "", &["dirname", path])
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty() && value != path)
}

pub(crate) fn list_native_directories(path: &str) -> Result<Vec<FilesystemEntry>, String> {
    let mut entries = std::fs::read_dir(path)
        .map_err(|e| e.to_string())?
        .filter_map(Result::ok)
        .filter_map(|entry| {
            let metadata = entry.metadata().ok()?;
            if !metadata.is_dir() {
                return None;
            }
            let name = entry.file_name().to_string_lossy().to_string();
            Some(FilesystemEntry {
                name,
                path: entry.path().to_string_lossy().to_string(),
                kind: "dir".to_string(),
            })
        })
        .collect::<Vec<_>>();
    entries.sort_by(|left, right| left.name.to_lowercase().cmp(&right.name.to_lowercase()));
    Ok(entries)
}

pub(crate) fn list_wsl_directories(
    path: &str,
    target: &ExecTarget,
) -> Result<Vec<FilesystemEntry>, String> {
    let output = run_cmd(
        target,
        "",
        &[
            "find",
            path,
            "-mindepth",
            "1",
            "-maxdepth",
            "1",
            "-type",
            "d",
            "-printf",
            "%f\t%p\n",
        ],
    )?;
    let mut entries = output
        .lines()
        .filter_map(|line| {
            let (name, full_path) = line.split_once('\t')?;
            Some(FilesystemEntry {
                name: name.to_string(),
                path: full_path.to_string(),
                kind: "dir".to_string(),
            })
        })
        .collect::<Vec<_>>();
    entries.sort_by(|left, right| left.name.to_lowercase().cmp(&right.name.to_lowercase()));
    Ok(entries)
}

pub(crate) fn list_directories_for_target(
    target: &ExecTarget,
    path: &str,
) -> Result<Vec<FilesystemEntry>, String> {
    match target {
        ExecTarget::Native => list_native_directories(path),
        ExecTarget::Wsl { .. } => list_wsl_directories(path, target),
    }
}
