use russh_sftp::protocol::{FileAttributes, FileType, OpenFlags};
use tauri::State;
use tokio::io::AsyncWriteExt;

use crate::{
    domain::{RemoteFileEntry, RemoteFileKind, TextFileContent},
    error::{AppError, AppResult},
    services::ssh::client::map_sftp,
    state::AppState,
};

const MAX_TEXT_FILE_SIZE: u64 = 5 * 1024 * 1024;

#[tauri::command]
pub async fn list_remote_files(
    state: State<'_, AppState>,
    session_id: String,
    path: String,
) -> AppResult<Vec<RemoteFileEntry>> {
    let sftp = state.sessions.sftp(&session_id).await?;
    let entries = map_sftp(sftp.read_dir(path).await)?;
    let mut output = entries
        .map(|entry| {
            let metadata = entry.metadata();
            RemoteFileEntry {
                name: entry.file_name(),
                path: entry.path(),
                kind: match metadata.file_type() {
                    FileType::Dir => RemoteFileKind::Directory,
                    FileType::File => RemoteFileKind::File,
                    FileType::Symlink => RemoteFileKind::Symlink,
                    FileType::Other => RemoteFileKind::Other,
                },
                size: metadata.len(),
                modified: metadata.mtime.map(u64::from),
                permissions: metadata.permissions,
                user: metadata.user,
                group: metadata.group,
            }
        })
        .collect::<Vec<_>>();
    output.sort_by_key(|entry| {
        (
            entry.kind != RemoteFileKind::Directory,
            entry.name.to_lowercase(),
        )
    });
    Ok(output)
}

#[tauri::command]
pub async fn read_remote_text(
    state: State<'_, AppState>,
    session_id: String,
    path: String,
) -> AppResult<TextFileContent> {
    let sftp = state.sessions.sftp(&session_id).await?;
    let metadata = map_sftp(sftp.metadata(path.clone()).await)?;
    if metadata.len() > MAX_TEXT_FILE_SIZE {
        return Err(AppError::Validation(
            "文本编辑器仅打开 5 MiB 以内的文件".into(),
        ));
    }
    let bytes = map_sftp(sftp.read(path.clone()).await)?;
    if bytes.iter().take(4096).any(|byte| *byte == 0) {
        return Err(AppError::Validation("检测到二进制文件".into()));
    }
    let content = String::from_utf8(bytes)
        .map_err(|_| AppError::Validation("文件不是有效 UTF-8 文本".into()))?;
    Ok(TextFileContent {
        path,
        size: content.len(),
        content,
    })
}

#[tauri::command]
pub async fn write_remote_text(
    state: State<'_, AppState>,
    session_id: String,
    path: String,
    content: String,
) -> AppResult<()> {
    if content.len() as u64 > MAX_TEXT_FILE_SIZE {
        return Err(AppError::Validation(
            "文本编辑器仅保存 5 MiB 以内的文件".into(),
        ));
    }
    let sftp = state.sessions.sftp(&session_id).await?;
    let mut file = map_sftp(
        sftp.open_with_flags(
            path,
            OpenFlags::CREATE | OpenFlags::TRUNCATE | OpenFlags::WRITE,
        )
        .await,
    )?;
    file.write_all(content.as_bytes())
        .await
        .map_err(|error| AppError::Sftp(error.to_string()))?;
    file.shutdown()
        .await
        .map_err(|error| AppError::Sftp(error.to_string()))?;
    Ok(())
}

#[tauri::command]
pub async fn create_remote_directory(
    state: State<'_, AppState>,
    session_id: String,
    path: String,
) -> AppResult<()> {
    let sftp = state.sessions.sftp(&session_id).await?;
    map_sftp(sftp.create_dir(path).await)
}

#[tauri::command]
pub async fn rename_remote_path(
    state: State<'_, AppState>,
    session_id: String,
    from: String,
    to: String,
) -> AppResult<()> {
    let sftp = state.sessions.sftp(&session_id).await?;
    map_sftp(sftp.rename(from, to).await)
}

#[tauri::command]
pub async fn delete_remote_path(
    state: State<'_, AppState>,
    session_id: String,
    path: String,
    directory: bool,
    recursive: Option<bool>,
) -> AppResult<()> {
    if recursive.unwrap_or(false) {
        let quoted = shell_quote(&path);
        let result = state
            .sessions
            .execute(&session_id, &format!("rm -rf -- {quoted}"))
            .await?;
        if result.exit_status != Some(0) {
            return Err(AppError::Message(format!(
                "递归删除失败: {}",
                result.stderr
            )));
        }
        return Ok(());
    }
    let sftp = state.sessions.sftp(&session_id).await?;
    if directory {
        map_sftp(sftp.remove_dir(path).await)
    } else {
        map_sftp(sftp.remove_file(path).await)
    }
}

#[tauri::command]
pub async fn chmod_remote_path(
    state: State<'_, AppState>,
    session_id: String,
    path: String,
    mode: u32,
) -> AppResult<()> {
    if mode > 0o7777 {
        return Err(AppError::Validation("权限值无效".into()));
    }
    let sftp = state.sessions.sftp(&session_id).await?;
    let mut attributes = FileAttributes::empty();
    attributes.permissions = Some(mode);
    map_sftp(sftp.set_metadata(path, attributes).await)
}

fn shell_quote(value: &str) -> String {
    format!("'{}'", value.replace('\'', "'\\''"))
}

#[cfg(test)]
mod tests {
    use super::shell_quote;

    #[test]
    fn quotes_posix_paths() {
        assert_eq!(shell_quote("/tmp/a b"), "'/tmp/a b'");
        assert_eq!(shell_quote("it's"), "'it'\\''s'");
    }
}
