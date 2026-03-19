#[cfg(target_os = "windows")]
use crate::infra::support::windows_drive_roots;
use crate::*;

#[tauri::command]
pub(crate) fn workspace_tree(
    path: String,
    target: ExecTarget,
    depth: Option<usize>,
) -> Result<WorkspaceTree, String> {
    let resolved = resolve_git_repo_path(&path, &target)?;
    let depth = depth.unwrap_or(4);
    let mut limit: usize = 800;
    let git_files = run_cmd(
        &target,
        &resolved,
        &[
            "git",
            "ls-files",
            "--cached",
            "--others",
            "--exclude-standard",
        ],
    )
    .unwrap_or_default();
    let root = if !git_files.trim().is_empty() {
        build_tree_from_paths(git_files.lines().map(|l| l.to_string()).collect())
    } else if matches!(target, ExecTarget::Wsl { .. }) {
        let find_output = run_cmd(
            &target,
            &resolved,
            &["find", ".", "-maxdepth", &depth.to_string(), "-type", "f"],
        )
        .unwrap_or_default();
        if !find_output.trim().is_empty() {
            build_tree_from_paths(find_output.lines().map(|l| l.to_string()).collect())
        } else {
            FileNode {
                name: ".".to_string(),
                path: resolved.clone(),
                kind: "dir".to_string(),
                status: None,
                children: vec![],
            }
        }
    } else {
        build_tree(&PathBuf::from(&resolved), depth, &mut limit)
    };

    let changes_raw =
        run_cmd(&target, &resolved, &["git", "status", "--porcelain"]).unwrap_or_default();
    let mut changes: Vec<(String, String)> = vec![];
    for line in changes_raw.lines() {
        if line.trim().is_empty() {
            continue;
        }
        let status = line.chars().take(2).collect::<String>().trim().to_string();
        let mut file_path = line.get(3..).unwrap_or("").trim().to_string();
        if let Some((_, target_path)) = file_path.split_once(" -> ") {
            file_path = target_path.to_string();
        }
        if !file_path.is_empty() {
            changes.push((file_path, status));
        }
    }
    let changes_tree = build_changes_tree(changes);
    Ok(WorkspaceTree {
        root,
        changes: changes_tree,
    })
}

#[tauri::command]
pub(crate) fn file_preview(path: String) -> Result<FilePreview, String> {
    const MAX_PREVIEW_BYTES: usize = 200_000;
    let bytes = std::fs::read(&path).map_err(|e| e.to_string())?;
    let mut content = String::from_utf8_lossy(&bytes).to_string();
    if bytes.len() > MAX_PREVIEW_BYTES {
        content = String::from_utf8_lossy(&bytes[..MAX_PREVIEW_BYTES]).to_string();
        content.push_str("\n\n[preview truncated]");
    }
    Ok(FilePreview { path, content })
}

#[tauri::command]
pub(crate) fn file_save(path: String, content: String) -> Result<FilePreview, String> {
    std::fs::write(&path, content.as_bytes()).map_err(|e| e.to_string())?;
    Ok(FilePreview { path, content })
}

#[tauri::command]
pub(crate) fn filesystem_roots(target: ExecTarget) -> Result<Vec<FilesystemRoot>, String> {
    match target {
        ExecTarget::Native => {
            let home = filesystem_home_for_target(&ExecTarget::Native)?;
            let mut roots = vec![FilesystemRoot {
                id: "home".to_string(),
                label: "Home".to_string(),
                path: home.clone(),
                description: "User home directory".to_string(),
            }];
            #[cfg(target_os = "windows")]
            {
                roots.extend(windows_drive_roots());
            }
            #[cfg(not(target_os = "windows"))]
            {
                roots.push(FilesystemRoot {
                    id: "root".to_string(),
                    label: "/".to_string(),
                    path: "/".to_string(),
                    description: "System root".to_string(),
                });
            }
            Ok(roots)
        }
        ExecTarget::Wsl { distro } => {
            let exec_target = ExecTarget::Wsl { distro };
            let home = filesystem_home_for_target(&exec_target)?;
            Ok(vec![
                FilesystemRoot {
                    id: "wsl-home".to_string(),
                    label: "Home".to_string(),
                    path: home,
                    description: "WSL home directory".to_string(),
                },
                FilesystemRoot {
                    id: "wsl-root".to_string(),
                    label: "/".to_string(),
                    path: "/".to_string(),
                    description: "WSL filesystem root".to_string(),
                },
                FilesystemRoot {
                    id: "wsl-mnt".to_string(),
                    label: "/mnt".to_string(),
                    path: "/mnt".to_string(),
                    description: "Mounted host drives".to_string(),
                },
            ])
        }
    }
}

#[tauri::command]
pub(crate) fn filesystem_list(
    target: ExecTarget,
    path: Option<String>,
) -> Result<FilesystemListResponse, String> {
    let roots = filesystem_roots(target.clone())?;
    let home_path = filesystem_home_for_target(&target)?;
    let requested_path = path
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(|value| resolve_target_path(value, &target))
        .transpose()?;

    let mut candidate_paths = Vec::new();
    if let Some(requested) = requested_path.clone() {
        candidate_paths.push(requested);
    }
    candidate_paths.push(home_path.clone());
    for root in &roots {
        if !candidate_paths
            .iter()
            .any(|existing| existing == &root.path)
        {
            candidate_paths.push(root.path.clone());
        }
    }

    let mut first_error: Option<String> = None;
    let mut resolved_listing: Option<(String, Vec<FilesystemEntry>)> = None;

    for candidate in candidate_paths {
        match list_directories_for_target(&target, &candidate) {
            Ok(entries) => {
                resolved_listing = Some((candidate, entries));
                break;
            }
            Err(error) => {
                if first_error.is_none() {
                    first_error = Some(error);
                }
            }
        }
    }

    let (current_path, entries) = resolved_listing.ok_or_else(|| {
        first_error.unwrap_or_else(|| "unable_to_read_server_directories".to_string())
    })?;
    let parent_path = match target {
        ExecTarget::Native => native_parent_path(&current_path),
        ExecTarget::Wsl { .. } => wsl_parent_path(&current_path, &target),
    };
    let fallback_reason = requested_path
        .as_ref()
        .filter(|requested| *requested != &current_path)
        .map(|_| "requested_path_unavailable".to_string());

    Ok(FilesystemListResponse {
        current_path,
        home_path,
        parent_path,
        roots,
        entries,
        requested_path,
        fallback_reason,
    })
}

#[tauri::command]
pub(crate) fn dialog_pick_folder(app: tauri::AppHandle) -> Result<Option<String>, String> {
    Ok(app
        .dialog()
        .file()
        .blocking_pick_folder()
        .map(|path| path.into_path())
        .transpose()
        .map_err(|e| e.to_string())?
        .map(|path| path.to_string_lossy().to_string()))
}
