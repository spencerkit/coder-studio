use std::{
    collections::{HashMap, HashSet},
    path::{Path, PathBuf},
    sync::mpsc::{self, RecvTimeoutError},
    time::Duration,
};

use notify::{
    event::{AccessKind, AccessMode},
    Config, Event, EventKind, RecommendedWatcher, RecursiveMode, Watcher,
};

use crate::*;

const WATCH_DEBOUNCE_MS: Duration = Duration::from_millis(250);
const WATCH_SUPPRESSION_TAIL_MS: Duration = Duration::from_millis(400);
const WATCH_REASON: &str = "file_watcher";

fn same_exec_target(left: &ExecTarget, right: &ExecTarget) -> bool {
    match (left, right) {
        (ExecTarget::Native, ExecTarget::Native) => true,
        (ExecTarget::Wsl { distro: left }, ExecTarget::Wsl { distro: right }) => {
            left.as_deref().unwrap_or("").trim() == right.as_deref().unwrap_or("").trim()
        }
        _ => false,
    }
}

fn resolve_watch_path(root_path: &str, target: &ExecTarget) -> Result<PathBuf, String> {
    match target {
        ExecTarget::Native => Ok(PathBuf::from(root_path)),
        ExecTarget::Wsl { .. } => resolve_wsl_watch_path(root_path, target),
    }
}

#[allow(dead_code)]
fn parse_wsl_watch_path(raw_path: &str) -> Result<PathBuf, String> {
    let trimmed = raw_path.trim();
    if trimmed.is_empty() {
        return Err("unable to resolve a Windows watch path for the WSL workspace".to_string());
    }
    Ok(PathBuf::from(trimmed))
}

#[cfg(target_os = "windows")]
fn resolve_wsl_watch_path(root_path: &str, target: &ExecTarget) -> Result<PathBuf, String> {
    let windows_path = run_cmd(target, "", &["wslpath", "-w", root_path])?;
    parse_wsl_watch_path(&windows_path)
}

#[cfg(not(target_os = "windows"))]
fn resolve_wsl_watch_path(_root_path: &str, _target: &ExecTarget) -> Result<PathBuf, String> {
    Err("workspace watching for WSL targets is unsupported on this platform".to_string())
}

fn should_refresh_for_event(event: &Event) -> bool {
    match &event.kind {
        EventKind::Access(AccessKind::Open(_))
        | EventKind::Access(AccessKind::Read)
        | EventKind::Access(AccessKind::Close(AccessMode::Read)) => false,
        EventKind::Access(_) => true,
        EventKind::Any
        | EventKind::Create(_)
        | EventKind::Modify(_)
        | EventKind::Remove(_)
        | EventKind::Other => true,
    }
}

fn is_git_index_path(path: &Path) -> bool {
    let Some(file_name) = path.file_name().and_then(|value| value.to_str()) else {
        return false;
    };
    if file_name != "index" && file_name != "index.lock" {
        return false;
    }
    path.ancestors()
        .any(|ancestor| ancestor.file_name().and_then(|value| value.to_str()) == Some(".git"))
}

fn event_is_index_only(event: &Event) -> bool {
    !event.paths.is_empty() && event.paths.iter().all(|path| is_git_index_path(path))
}

fn emit_workspace_artifacts_dirty_event(
    transport_events: &broadcast::Sender<TransportEvent>,
    path: &str,
    target: &ExecTarget,
    reason: &str,
) {
    let _ = transport_events.send(TransportEvent {
        event: "workspace://artifacts_dirty".to_string(),
        payload: json!({
            "path": path,
            "target": target,
            "reason": reason,
        }),
    });
}

fn is_workspace_watch_suppressed(
    suppressions: &Arc<Mutex<HashMap<String, WorkspaceWatchSuppression>>>,
    workspace_id: &str,
) -> bool {
    let now = std::time::Instant::now();
    let Ok(mut suppressions) = suppressions.lock() else {
        return false;
    };
    suppressions.retain(|_, state| state.active_requests > 0 || state.until > now);
    suppressions
        .get(workspace_id)
        .map(|state| state.active_requests > 0 || state.until > now)
        .unwrap_or(false)
}

fn watch_single_path(watcher: &mut RecommendedWatcher, path: &Path) -> Result<(), String> {
    watcher
        .watch(path, RecursiveMode::NonRecursive)
        .map_err(|e| e.to_string())
}

fn watch_directory_tree(watcher: &mut RecommendedWatcher, root: &Path) {
    let mut stack = vec![root.to_path_buf()];
    while let Some(path) = stack.pop() {
        let metadata = match std::fs::symlink_metadata(&path) {
            Ok(metadata) => metadata,
            Err(error) => {
                if error.kind() == std::io::ErrorKind::NotFound {
                    continue;
                }
                eprintln!("skipping workspace watch path {}: {error}", path.display());
                continue;
            }
        };

        if metadata.file_type().is_symlink() {
            continue;
        }
        if !metadata.is_dir() {
            if let Err(error) = watch_single_path(watcher, &path) {
                eprintln!("failed to watch workspace path {}: {error}", path.display());
            }
            continue;
        }

        if let Err(error) = watch_single_path(watcher, &path) {
            eprintln!(
                "failed to watch workspace directory {}: {error}",
                path.display()
            );
            continue;
        }

        let entries = match std::fs::read_dir(&path) {
            Ok(entries) => entries,
            Err(error) => {
                eprintln!(
                    "failed to read workspace directory {} while registering watches: {error}",
                    path.display()
                );
                continue;
            }
        };

        for entry in entries.flatten() {
            let file_type = match entry.file_type() {
                Ok(file_type) => file_type,
                Err(_) => continue,
            };
            if file_type.is_symlink() || !file_type.is_dir() {
                continue;
            }
            stack.push(entry.path());
        }
    }
}

fn git_visible_directories(
    root_path: &str,
    target: &ExecTarget,
    watched_root: &Path,
) -> HashSet<PathBuf> {
    let mut directories = HashSet::from([watched_root.to_path_buf()]);
    let git_files = run_cmd(
        target,
        root_path,
        &[
            "git",
            "ls-files",
            "--cached",
            "--others",
            "--exclude-standard",
            "-z",
        ],
    )
    .unwrap_or_default();

    for relative_path in git_files
        .split('\0')
        .filter(|value| !value.trim().is_empty())
    {
        let mut current = PathBuf::new();
        if let Some(parent) = Path::new(relative_path).parent() {
            for component in parent.components() {
                current.push(component.as_os_str());
                directories.insert(watched_root.join(&current));
            }
        }
    }

    directories
}

fn resolve_git_dir_watch_path(
    root_path: &str,
    target: &ExecTarget,
    watched_root: &Path,
) -> Option<PathBuf> {
    let git_dir = run_cmd(target, root_path, &["git", "rev-parse", "--git-dir"]).ok()?;
    let trimmed = git_dir.trim();
    if trimmed.is_empty() {
        return None;
    }

    let candidate = Path::new(trimmed);
    if candidate.is_absolute() {
        return resolve_watch_path(trimmed, target).ok();
    }

    match target {
        ExecTarget::Native => Some(watched_root.join(candidate)),
        ExecTarget::Wsl { .. } => {
            let combined = format!(
                "{}/{}",
                root_path.trim_end_matches('/'),
                trimmed.trim_start_matches("./")
            );
            resolve_watch_path(&combined, target).ok()
        }
    }
}

fn watch_git_metadata_paths(watcher: &mut RecommendedWatcher, git_dir_path: &Path) {
    if let Err(error) = watch_single_path(watcher, git_dir_path) {
        eprintln!(
            "failed to watch git directory {}: {error}",
            git_dir_path.display()
        );
    }

    for relative in [
        "index",
        "index.lock",
        "HEAD",
        "packed-refs",
        "ORIG_HEAD",
        "MERGE_HEAD",
        "CHERRY_PICK_HEAD",
        "REVERT_HEAD",
        "FETCH_HEAD",
    ] {
        let path = git_dir_path.join(relative);
        match std::fs::symlink_metadata(&path) {
            Ok(metadata) if !metadata.file_type().is_symlink() => {
                if let Err(error) = watch_single_path(watcher, &path) {
                    eprintln!(
                        "failed to watch git metadata path {}: {error}",
                        path.display()
                    );
                }
            }
            Ok(_) => {}
            Err(_) => {}
        }
    }

    for relative in ["refs", "logs", "objects", "rebase-merge", "rebase-apply"] {
        let path = git_dir_path.join(relative);
        if path.exists() {
            watch_directory_tree(watcher, &path);
        }
    }
}

fn register_workspace_watch_paths(
    watcher: &mut RecommendedWatcher,
    root_path: &str,
    target: &ExecTarget,
    watched_root: &Path,
) -> Result<(), String> {
    let mut directories = git_visible_directories(root_path, target, watched_root)
        .into_iter()
        .collect::<Vec<_>>();
    directories.sort_by_key(|path| path.components().count());

    for directory in directories {
        let metadata = match std::fs::symlink_metadata(&directory) {
            Ok(metadata) => metadata,
            Err(error) => {
                if error.kind() == std::io::ErrorKind::NotFound {
                    continue;
                }
                eprintln!(
                    "skipping workspace watch path {}: {error}",
                    directory.display()
                );
                continue;
            }
        };
        if metadata.file_type().is_symlink() || !metadata.is_dir() {
            continue;
        }
        if let Err(error) = watch_single_path(watcher, &directory) {
            eprintln!(
                "failed to watch workspace directory {}: {error}",
                directory.display()
            );
        }
    }

    if let Some(git_dir_path) = resolve_git_dir_watch_path(root_path, target, watched_root) {
        watch_git_metadata_paths(watcher, &git_dir_path);
    }

    Ok(())
}

fn spawn_workspace_watch(
    transport_events: broadcast::Sender<TransportEvent>,
    suppressions: Arc<Mutex<HashMap<String, WorkspaceWatchSuppression>>>,
    workspace_id: String,
    root_path: String,
    target: ExecTarget,
    watched_path: PathBuf,
) -> Result<RecommendedWatcher, String> {
    let (tx, rx) = mpsc::channel();
    let mut watcher = RecommendedWatcher::new(
        move |event| {
            let _ = tx.send(event);
        },
        Config::default().with_follow_symlinks(false),
    )
    .map_err(|e| e.to_string())?;
    register_workspace_watch_paths(&mut watcher, &root_path, &target, &watched_path)?;

    let watched_path_for_thread = watched_path.clone();
    std::thread::spawn(move || loop {
        let mut disconnected = false;
        let mut saw_relevant_event = false;
        let mut saw_non_index_event = false;

        match rx.recv() {
            Ok(Ok(event)) => {
                let is_relevant = should_refresh_for_event(&event);
                saw_relevant_event = is_relevant;
                saw_non_index_event = is_relevant && !event_is_index_only(&event);
            }
            Ok(Err(error)) => {
                eprintln!(
                    "workspace watcher error for {workspace_id} at {}: {error}",
                    watched_path_for_thread.display()
                );
            }
            Err(_) => break,
        }

        loop {
            match rx.recv_timeout(WATCH_DEBOUNCE_MS) {
                Ok(Ok(event)) => {
                    let is_relevant = should_refresh_for_event(&event);
                    saw_relevant_event |= is_relevant;
                    saw_non_index_event |= is_relevant && !event_is_index_only(&event);
                }
                Ok(Err(error)) => {
                    eprintln!(
                        "workspace watcher error for {workspace_id} at {}: {error}",
                        watched_path_for_thread.display()
                    );
                }
                Err(RecvTimeoutError::Timeout) => break,
                Err(RecvTimeoutError::Disconnected) => {
                    disconnected = true;
                    break;
                }
            }
        }

        if saw_relevant_event {
            let suppressed_index_event =
                !saw_non_index_event && is_workspace_watch_suppressed(&suppressions, &workspace_id);
            if !suppressed_index_event {
                emit_workspace_artifacts_dirty_event(
                    &transport_events,
                    &root_path,
                    &target,
                    WATCH_REASON,
                );
            }
        }

        if disconnected {
            break;
        }
    });

    Ok(watcher)
}

pub(crate) fn ensure_workspace_watch(
    state: State<'_, AppState>,
    workspace_id: &str,
    root_path: &str,
    target: &ExecTarget,
) -> Result<(), String> {
    let watched_path = resolve_watch_path(root_path, target)?;
    let transport_events = state.transport_events.clone();
    let suppressions = state.workspace_watch_suppressions.clone();
    let mut watches = state.workspace_watches.lock().map_err(|e| e.to_string())?;

    if let Some(existing) = watches.get(workspace_id) {
        if existing.root_path == root_path
            && existing.watched_path == watched_path
            && same_exec_target(&existing.target, target)
        {
            return Ok(());
        }
    }

    let watcher = spawn_workspace_watch(
        transport_events,
        suppressions,
        workspace_id.to_string(),
        root_path.to_string(),
        target.clone(),
        watched_path.clone(),
    )?;

    watches.insert(
        workspace_id.to_string(),
        WorkspaceWatch {
            root_path: root_path.to_string(),
            target: target.clone(),
            watched_path,
            _watcher: watcher,
        },
    );
    Ok(())
}

pub(crate) fn stop_workspace_watch(state: State<'_, AppState>, workspace_id: &str) {
    if let Ok(mut watches) = state.workspace_watches.lock() {
        watches.remove(workspace_id);
    }
    if let Ok(mut suppressions) = state.workspace_watch_suppressions.lock() {
        suppressions.remove(workspace_id);
    }
}

pub(crate) fn begin_workspace_watch_suppression(
    state: State<'_, AppState>,
    path: &str,
    target: &ExecTarget,
) -> Vec<String> {
    let workspace_ids = {
        let Ok(watches) = state.workspace_watches.lock() else {
            return Vec::new();
        };
        watches
            .iter()
            .filter(|(_, watch)| watch.root_path == path && same_exec_target(&watch.target, target))
            .map(|(workspace_id, _)| workspace_id.clone())
            .collect::<Vec<_>>()
    };
    if workspace_ids.is_empty() {
        return workspace_ids;
    }
    if let Ok(mut suppressions) = state.workspace_watch_suppressions.lock() {
        let now = std::time::Instant::now();
        suppressions.retain(|_, state| state.active_requests > 0 || state.until > now);
        for workspace_id in &workspace_ids {
            let entry =
                suppressions
                    .entry(workspace_id.clone())
                    .or_insert(WorkspaceWatchSuppression {
                        active_requests: 0,
                        until: now,
                    });
            entry.active_requests += 1;
        }
    }
    workspace_ids
}

pub(crate) fn end_workspace_watch_suppression(
    state: State<'_, AppState>,
    workspace_ids: &[String],
) {
    if workspace_ids.is_empty() {
        return;
    }
    if let Ok(mut suppressions) = state.workspace_watch_suppressions.lock() {
        let now = std::time::Instant::now();
        suppressions.retain(|_, state| state.active_requests > 0 || state.until > now);
        for workspace_id in workspace_ids {
            if let Some(state) = suppressions.get_mut(workspace_id) {
                state.active_requests = state.active_requests.saturating_sub(1);
                state.until = now + WATCH_SUPPRESSION_TAIL_MS;
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::parse_wsl_watch_path;
    use std::path::PathBuf;

    #[test]
    fn parse_wsl_watch_path_trims_windows_drive_output() {
        let parsed = parse_wsl_watch_path("C:\\Users\\spencer\\repo\r\n").unwrap();
        assert_eq!(parsed, PathBuf::from("C:\\Users\\spencer\\repo"));
    }

    #[test]
    fn parse_wsl_watch_path_accepts_unc_output() {
        let parsed = parse_wsl_watch_path("\\\\wsl$\\Ubuntu\\home\\spencer\\repo\n").unwrap();
        assert_eq!(
            parsed,
            PathBuf::from("\\\\wsl$\\Ubuntu\\home\\spencer\\repo")
        );
    }
}
