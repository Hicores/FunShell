use std::path::{Path, PathBuf};

use serde::Serialize;
use tauri::{AppHandle, State};

use crate::{
    error::{AppError, AppResult},
    services::ssh::client::map_sftp,
    state::AppState,
};

const FOLDER_UPLOAD_WARNING_COUNT: usize = 64;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalUploadInfo {
    directory: bool,
    file_count: usize,
}

#[derive(Default)]
struct DirectoryUploadPlan {
    directories: Vec<String>,
    files: Vec<(PathBuf, String)>,
}

async fn scan_directory(root: &Path) -> AppResult<DirectoryUploadPlan> {
    let mut plan = DirectoryUploadPlan::default();
    let mut pending = vec![(root.to_path_buf(), String::new())];
    while let Some((local, relative)) = pending.pop() {
        let metadata = tokio::fs::symlink_metadata(&local).await?;
        if metadata.file_type().is_symlink() {
            return Err(AppError::Validation(format!(
                "文件夹上传不支持符号链接: {}",
                local.display()
            )));
        }
        if metadata.is_file() {
            plan.files.push((local, relative));
        } else if metadata.is_dir() {
            plan.directories.push(relative.clone());
            let mut entries = tokio::fs::read_dir(&local).await?;
            let mut children = Vec::new();
            while let Some(entry) = entries.next_entry().await? {
                let name = entry
                    .file_name()
                    .into_string()
                    .map_err(|_| AppError::Validation("文件名称不是有效的 Unicode 文本".into()))?;
                let path = if relative.is_empty() {
                    name
                } else {
                    format!("{relative}/{name}")
                };
                children.push((entry.path(), path));
            }
            children.sort_by(|left, right| right.1.cmp(&left.1));
            pending.extend(children);
        } else {
            return Err(AppError::Validation(format!(
                "不支持上传此文件类型: {}",
                local.display()
            )));
        }
    }
    Ok(plan)
}

#[tauri::command]
pub async fn inspect_local_upload(local_path: PathBuf) -> AppResult<LocalUploadInfo> {
    let metadata = tokio::fs::symlink_metadata(&local_path).await?;
    if metadata.file_type().is_symlink() {
        return Err(AppError::Validation("文件夹上传不支持符号链接".into()));
    }
    if metadata.is_dir() {
        let plan = scan_directory(&local_path).await?;
        Ok(LocalUploadInfo {
            directory: true,
            file_count: plan.files.len(),
        })
    } else if metadata.is_file() {
        Ok(LocalUploadInfo {
            directory: false,
            file_count: 1,
        })
    } else {
        Err(AppError::Validation("不支持上传此文件类型".into()))
    }
}

fn require_confirmation(file_count: usize, confirmed: bool) -> AppResult<()> {
    if file_count > FOLDER_UPLOAD_WARNING_COUNT && !confirmed {
        return Err(AppError::Validation(format!(
            "文件夹包含 {file_count} 个文件，超过 64 个，请确认后再上传"
        )));
    }
    Ok(())
}

fn remote_child(root: &str, relative: &str) -> String {
    if relative.is_empty() {
        root.to_owned()
    } else {
        format!("{}/{relative}", root.trim_end_matches('/'))
    }
}

#[tauri::command]
pub async fn upload_remote_directory(
    app: AppHandle,
    state: State<'_, AppState>,
    session_id: String,
    local_path: PathBuf,
    remote_path: String,
    confirmed: bool,
) -> AppResult<()> {
    let lifecycle = state.sessions.lifecycle(&session_id)?;
    let prepare = async {
        if !tokio::fs::symlink_metadata(&local_path).await?.is_dir() {
            return Err(AppError::Validation("上传对象不是文件夹".into()));
        }
        let plan = scan_directory(&local_path).await?;
        require_confirmation(plan.files.len(), confirmed)?;
        let sftp = state.sessions.sftp(&session_id).await?;
        for relative in &plan.directories {
            let destination = remote_child(&remote_path, relative);
            // Existing directories can be merged; a file or symlink must never be
            // treated as an upload directory.
            if let Err(error) = sftp.create_dir(destination.clone()).await {
                let metadata = map_sftp(sftp.symlink_metadata(destination).await)?;
                if !metadata.is_dir() {
                    return Err(AppError::Sftp(error.to_string()));
                }
            }
        }
        Ok(plan)
    };
    let plan = tokio::select! {
        biased;
        _ = lifecycle.cancelled() => return Err(AppError::Message("会话已关闭，文件夹上传已取消".into())),
        result = prepare => result?,
    };
    for (local, relative) in plan.files {
        if lifecycle.is_cancelled() {
            return Err(AppError::Message("会话已关闭，文件夹上传已取消".into()));
        }
        super::files::upload_remote_file(
            app.clone(),
            state.clone(),
            session_id.clone(),
            local,
            remote_child(&remote_path, &relative),
        )
        .await?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn scans_nested_files_and_preserves_empty_directories() {
        let root = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(root.path().join("子目录/空目录")).unwrap();
        std::fs::write(root.path().join("root.txt"), b"root").unwrap();
        std::fs::write(root.path().join("子目录/child.txt"), b"child").unwrap();
        let plan = scan_directory(root.path()).await.unwrap();
        assert_eq!(plan.directories, ["", "子目录", "子目录/空目录"]);
        let files = plan
            .files
            .iter()
            .map(|(_, relative)| relative.as_str())
            .collect::<Vec<_>>();
        assert_eq!(files, ["root.txt", "子目录/child.txt"]);
        assert_eq!(
            remote_child("/srv/release", files[1]),
            "/srv/release/子目录/child.txt"
        );
        assert_eq!(remote_child("/", "empty"), "/empty");
    }

    #[tokio::test]
    async fn counts_files_recursively_at_the_warning_boundary() {
        let root = tempfile::tempdir().unwrap();
        std::fs::create_dir(root.path().join("nested")).unwrap();
        for index in 0..64 {
            std::fs::write(root.path().join(format!("nested/{index}.txt")), b"").unwrap();
        }
        let info = inspect_local_upload(root.path().to_path_buf())
            .await
            .unwrap();
        assert!(info.directory);
        assert_eq!(info.file_count, 64);
        assert!(require_confirmation(info.file_count, false).is_ok());
        std::fs::write(root.path().join("65.txt"), b"").unwrap();
        let info = inspect_local_upload(root.path().to_path_buf())
            .await
            .unwrap();
        assert_eq!(info.file_count, 65);
        assert!(require_confirmation(info.file_count, false).is_err());
        assert!(require_confirmation(info.file_count, true).is_ok());
    }

    #[tokio::test]
    async fn inspects_single_files_and_empty_folders() {
        let root = tempfile::tempdir().unwrap();
        let info = inspect_local_upload(root.path().to_path_buf())
            .await
            .unwrap();
        assert!(info.directory);
        assert_eq!(info.file_count, 0);
        let path = root.path().join("file.txt");
        std::fs::write(&path, b"file").unwrap();
        let info = inspect_local_upload(path).await.unwrap();
        assert!(!info.directory);
        assert_eq!(info.file_count, 1);
    }
}
