use std::time::{Duration, Instant};

use crate::app::ArtifactCaches;
use crate::services::artifact_cache::{
    artifact_cache_key, cache_lookup, cache_store, invalidate_cache_entry,
};
use crate::*;

const GIT_ARTIFACT_CACHE_TTL: Duration = Duration::from_millis(500);

fn git_status_cache_key(path: &str, target: &ExecTarget) -> String {
    artifact_cache_key("git_status", path, target, None)
}

fn git_changes_cache_key(path: &str, target: &ExecTarget) -> String {
    artifact_cache_key("git_changes", path, target, None)
}

fn worktree_list_cache_key(path: &str, target: &ExecTarget) -> String {
    artifact_cache_key("worktree_list", path, target, None)
}

pub(crate) fn git_status_label(code: char) -> &'static str {
    match code {
        'M' => "Modified",
        'A' => "Added",
        'D' => "Deleted",
        'R' => "Renamed",
        'C' => "Copied",
        'T' => "Type Changed",
        'U' => "Unmerged",
        '?' => "Untracked",
        _ => "Changed",
    }
}

pub(crate) fn git_status_cached(
    path: String,
    target: ExecTarget,
    caches: &ArtifactCaches,
) -> Result<GitStatus, String> {
    let resolved = resolve_git_repo_path(&path, &target)?;
    let key = git_status_cache_key(&resolved, &target);
    let now = Instant::now();
    if let Some(value) = cache_lookup(&caches.git_status, &key, now) {
        return Ok(value);
    }

    let value = git_status(resolved.clone(), target.clone())?;
    cache_store(
        &caches.git_status,
        key,
        value.clone(),
        now + GIT_ARTIFACT_CACHE_TTL,
    );
    Ok(value)
}

pub(crate) fn git_status(path: String, target: ExecTarget) -> Result<GitStatus, String> {
    let resolved = resolve_git_repo_path(&path, &target)?;
    let branch = run_cmd(
        &target,
        &resolved,
        &["git", "rev-parse", "--abbrev-ref", "HEAD"],
    )
    .unwrap_or_else(|_| "unknown".to_string());
    let changes =
        run_cmd(&target, &resolved, &["git", "status", "--porcelain"]).unwrap_or_default();
    let change_count = changes
        .lines()
        .filter(|line| !line.trim().is_empty())
        .count() as u32;
    let last_commit = run_cmd(
        &target,
        &resolved,
        &["git", "log", "-1", "--pretty=format:%s"],
    )
    .unwrap_or_else(|_| "—".to_string());
    Ok(GitStatus {
        branch,
        changes: change_count,
        last_commit,
    })
}

pub(crate) fn git_diff(path: String, target: ExecTarget) -> Result<String, String> {
    let resolved = resolve_git_repo_path(&path, &target)?;
    if git_has_head(&resolved, &target) {
        return run_cmd(&target, &resolved, &["git", "diff", "HEAD", "--"])
            .map_err(|e| e.to_string());
    }
    Ok(combine_git_diff_sections(&[
        git_cached_diff(&resolved, &target, None),
        git_worktree_diff(&resolved, &target, None),
    ]))
}

pub(crate) fn git_changes(path: String, target: ExecTarget) -> Result<Vec<GitChangeEntry>, String> {
    let resolved = resolve_git_repo_path(&path, &target)?;
    let raw = run_cmd(&target, &resolved, &["git", "status", "--porcelain"]).unwrap_or_default();
    Ok(parse_git_changes(&raw))
}

pub(crate) fn git_changes_cached(
    path: String,
    target: ExecTarget,
    caches: &ArtifactCaches,
) -> Result<Vec<GitChangeEntry>, String> {
    let resolved = resolve_git_repo_path(&path, &target)?;
    let key = git_changes_cache_key(&resolved, &target);
    let now = Instant::now();
    if let Some(value) = cache_lookup(&caches.git_changes, &key, now) {
        return Ok(value);
    }

    let value = git_changes(resolved.clone(), target.clone())?;
    cache_store(
        &caches.git_changes,
        key,
        value.clone(),
        now + GIT_ARTIFACT_CACHE_TTL,
    );
    Ok(value)
}

pub(crate) fn git_diff_file(
    path: String,
    target: ExecTarget,
    file_path: String,
    staged: Option<bool>,
) -> Result<String, String> {
    let resolved = resolve_git_repo_path(&path, &target)?;
    let relative = resolve_git_command_path(&resolved, &target, &file_path);
    if staged.unwrap_or(false) {
        let diff = git_cached_diff(&resolved, &target, Some(&relative));
        if !diff.trim().is_empty() {
            return Ok(diff);
        }
        Ok(git_worktree_diff(&resolved, &target, Some(&relative)))
    } else {
        let diff = git_worktree_diff(&resolved, &target, Some(&relative));
        if !diff.trim().is_empty() {
            return Ok(diff);
        }
        Ok(git_cached_diff(&resolved, &target, Some(&relative)))
    }
}

pub(crate) fn git_file_diff_payload(
    path: String,
    target: ExecTarget,
    file_path: String,
    section: String,
) -> Result<GitFileDiffPayload, String> {
    let resolved = resolve_git_repo_path(&path, &target)?;
    let relative = resolve_git_command_path(&resolved, &target, &file_path);
    let working_content = read_target_file_text(&resolved, &target, &relative);
    let head_content = git_show_file(&resolved, &target, "HEAD", &relative);
    let index_content = git_show_file(&resolved, &target, ":", &relative);

    let (original_content, modified_content, diff) = match section.as_str() {
        "staged" => (
            head_content,
            index_content,
            git_cached_diff(&resolved, &target, Some(&relative)),
        ),
        "untracked" => (
            String::new(),
            working_content,
            git_worktree_diff(&resolved, &target, Some(&relative)),
        ),
        _ => {
            let original = if index_content.is_empty() {
                head_content
            } else {
                index_content
            };
            (
                original,
                working_content,
                git_worktree_diff(&resolved, &target, Some(&relative)),
            )
        }
    };

    Ok(GitFileDiffPayload {
        original_content,
        modified_content,
        diff,
    })
}

pub(crate) fn git_stage_all(path: String, target: ExecTarget) -> Result<(), String> {
    let resolved = resolve_git_repo_path(&path, &target)?;
    run_cmd(&target, &resolved, &["git", "add", "-A"]).map(|_| ())
}

pub(crate) fn git_stage_file(
    path: String,
    target: ExecTarget,
    file_path: String,
) -> Result<(), String> {
    let resolved = resolve_git_repo_path(&path, &target)?;
    let relative = resolve_git_command_path(&resolved, &target, &file_path);
    run_cmd(&target, &resolved, &["git", "add", "--", &relative])
        .map(|_| ())
        .map_err(|error| format!("{} (input: {}, resolved: {})", error, file_path, relative))
}

pub(crate) fn git_unstage_all(path: String, target: ExecTarget) -> Result<(), String> {
    let resolved = resolve_git_repo_path(&path, &target)?;
    if git_has_head(&resolved, &target) {
        run_cmd(&target, &resolved, &["git", "reset", "HEAD", "--", "."]).map(|_| ())
    } else {
        run_cmd(&target, &resolved, &["git", "rm", "--cached", "-r", "."]).map(|_| ())
    }
}

pub(crate) fn git_unstage_file(
    path: String,
    target: ExecTarget,
    file_path: String,
) -> Result<(), String> {
    let resolved = resolve_git_repo_path(&path, &target)?;
    let relative = resolve_git_command_path(&resolved, &target, &file_path);
    if git_has_head(&resolved, &target) {
        run_cmd(
            &target,
            &resolved,
            &["git", "restore", "--staged", "--", &relative],
        )
        .map(|_| ())
        .map_err(|error| format!("{} (input: {}, resolved: {})", error, file_path, relative))
    } else {
        run_cmd(
            &target,
            &resolved,
            &["git", "rm", "--cached", "--", &relative],
        )
        .map(|_| ())
        .map_err(|error| format!("{} (input: {}, resolved: {})", error, file_path, relative))
    }
}

pub(crate) fn git_discard_all(path: String, target: ExecTarget) -> Result<(), String> {
    let resolved = resolve_git_repo_path(&path, &target)?;
    if git_has_head(&resolved, &target) {
        run_cmd(&target, &resolved, &["git", "reset", "--hard", "HEAD"])?;
    } else {
        let _ = run_cmd(&target, &resolved, &["git", "rm", "--cached", "-r", "."]);
    }
    let _ = run_cmd(&target, &resolved, &["git", "clean", "-fd"]);
    Ok(())
}

pub(crate) fn git_discard_file(
    path: String,
    target: ExecTarget,
    file_path: String,
    section: Option<String>,
) -> Result<(), String> {
    let resolved = resolve_git_repo_path(&path, &target)?;
    let relative = resolve_git_command_path(&resolved, &target, &file_path);
    let is_untracked = section.as_deref() == Some("untracked");

    if is_untracked {
        let _ = run_cmd(
            &target,
            &resolved,
            &["git", "clean", "-fd", "--", &relative],
        );
        if matches!(target, ExecTarget::Wsl { .. }) {
            let _ = run_cmd(&target, &resolved, &["rm", "-rf", &relative]);
        } else {
            let absolute = PathBuf::from(&resolved).join(&relative);
            if absolute.is_dir() {
                let _ = std::fs::remove_dir_all(&absolute);
            } else if absolute.exists() {
                let _ = std::fs::remove_file(&absolute);
            }
        }
        return Ok(());
    }

    if git_has_head(&resolved, &target) {
        run_cmd(
            &target,
            &resolved,
            &["git", "restore", "--worktree", "--", &relative],
        )
        .map(|_| ())
        .map_err(|error| format!("{} (input: {}, resolved: {})", error, file_path, relative))
    } else if matches!(target, ExecTarget::Wsl { .. }) {
        run_cmd(&target, &resolved, &["rm", "-rf", &relative])
            .map(|_| ())
            .map_err(|error| format!("{} (input: {}, resolved: {})", error, file_path, relative))
    } else {
        let absolute = PathBuf::from(&resolved).join(&relative);
        if absolute.is_dir() {
            std::fs::remove_dir_all(&absolute).map_err(|e| e.to_string())
        } else if absolute.exists() {
            std::fs::remove_file(&absolute).map_err(|e| e.to_string())
        } else {
            Ok(())
        }
    }
}

pub(crate) fn git_commit(
    path: String,
    target: ExecTarget,
    message: String,
) -> Result<String, String> {
    let trimmed = message.trim();
    if trimmed.is_empty() {
        return Err("commit message required".to_string());
    }
    let resolved = resolve_git_repo_path(&path, &target)?;
    run_cmd(&target, &resolved, &["git", "commit", "-m", trimmed])
}

pub(crate) fn worktree_list(path: String, target: ExecTarget) -> Result<Vec<WorktreeInfo>, String> {
    let resolved = resolve_git_repo_path(&path, &target)?;
    let raw = run_cmd(
        &target,
        &resolved,
        &["git", "worktree", "list", "--porcelain"],
    )
    .unwrap_or_default();
    let mut list = Vec::new();
    let mut current = WorktreeInfo {
        name: "".to_string(),
        path: "".to_string(),
        branch: "".to_string(),
        status: "".to_string(),
        diff: "".to_string(),
        tree: "".to_string(),
    };
    for line in raw.lines() {
        if line.starts_with("worktree ") {
            if !current.path.is_empty() {
                current.status = summarize_status(&current.path, &target);
                list.push(current.clone());
            }
            current = WorktreeInfo {
                name: "".to_string(),
                path: "".to_string(),
                branch: "".to_string(),
                status: "".to_string(),
                diff: "".to_string(),
                tree: "".to_string(),
            };
            current.path = line.replace("worktree ", "");
            current.name = current
                .path
                .split('/')
                .next_back()
                .unwrap_or("worktree")
                .to_string();
        } else if line.starts_with("branch ") {
            current.branch = trim_branch_name(line);
        }
    }
    if !current.path.is_empty() {
        current.status = summarize_status(&current.path, &target);
        list.push(current);
    }
    Ok(list)
}

pub(crate) fn worktree_list_cached(
    path: String,
    target: ExecTarget,
    caches: &ArtifactCaches,
) -> Result<Vec<WorktreeInfo>, String> {
    let resolved = resolve_git_repo_path(&path, &target)?;
    let key = worktree_list_cache_key(&resolved, &target);
    let now = Instant::now();
    if let Some(value) = cache_lookup(&caches.worktree_list, &key, now) {
        return Ok(value);
    }

    let value = worktree_list(resolved.clone(), target.clone())?;
    cache_store(
        &caches.worktree_list,
        key,
        value.clone(),
        now + GIT_ARTIFACT_CACHE_TTL,
    );
    Ok(value)
}

pub(crate) fn invalidate_git_artifact_caches(
    caches: &ArtifactCaches,
    path: &str,
    target: &ExecTarget,
) {
    let resolved = resolve_git_repo_path(path, target).unwrap_or_else(|_| path.to_string());
    invalidate_cache_entry(&caches.git_status, &git_status_cache_key(&resolved, target));
    invalidate_cache_entry(&caches.git_changes, &git_changes_cache_key(&resolved, target));
    invalidate_cache_entry(&caches.worktree_list, &worktree_list_cache_key(&resolved, target));
}
