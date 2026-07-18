use russh_sftp::protocol::{FileAttributes, FileType, OpenFlags};
use std::path::PathBuf;

use tauri::{AppHandle, Emitter, State};
use tokio::{
    fs::File,
    io::{AsyncReadExt, AsyncWriteExt},
};
use tokio_util::sync::CancellationToken;
use uuid::Uuid;

use crate::{
    domain::{RemoteFileEntry, RemoteFileKind, TextFileContent, TransferProgressEvent},
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

#[tauri::command]
pub async fn upload_remote_file(
    app: AppHandle,
    state: State<'_, AppState>,
    session_id: String,
    local_path: PathBuf,
    remote_path: String,
) -> AppResult<String> {
    let metadata = tokio::fs::metadata(&local_path).await?;
    if !metadata.is_file() {
        return Err(AppError::Validation("当前上传接口仅接收文件".into()));
    }
    let task_id = Uuid::new_v4().to_string();
    let source = local_path.display().to_string();
    let total = metadata.len();
    let sftp = state.sessions.sftp(&session_id).await?;
    let mut source_file = File::open(&local_path).await?;
    let mut destination_file = map_sftp(
        sftp.open_with_flags(
            remote_path.clone(),
            OpenFlags::CREATE | OpenFlags::TRUNCATE | OpenFlags::WRITE,
        )
        .await,
    )?;
    let cancellation = state.transfers.start(&task_id);
    let result = transfer(
        TransferContext {
            app: &app,
            session_id: &session_id,
            task_id: &task_id,
            direction: "upload",
            source: &source,
            destination: &remote_path,
            total,
            cancellation,
        },
        &mut source_file,
        &mut destination_file,
    )
    .await;
    state.transfers.finish(&task_id);
    result?;
    destination_file
        .shutdown()
        .await
        .map_err(|error| AppError::Sftp(error.to_string()))?;
    Ok(task_id)
}

#[tauri::command]
pub async fn download_remote_file(
    app: AppHandle,
    state: State<'_, AppState>,
    session_id: String,
    remote_path: String,
    local_path: PathBuf,
) -> AppResult<String> {
    let task_id = Uuid::new_v4().to_string();
    let sftp = state.sessions.sftp(&session_id).await?;
    let metadata = map_sftp(sftp.metadata(remote_path.clone()).await)?;
    if metadata.is_dir() {
        return Err(AppError::Validation("当前下载接口仅接收文件".into()));
    }
    if let Some(parent) = local_path.parent() {
        tokio::fs::create_dir_all(parent).await?;
    }
    let mut source_file = map_sftp(sftp.open(remote_path.clone()).await)?;
    let mut destination_file = File::create(&local_path).await?;
    let cancellation = state.transfers.start(&task_id);
    let result = transfer(
        TransferContext {
            app: &app,
            session_id: &session_id,
            task_id: &task_id,
            direction: "download",
            source: &remote_path,
            destination: &local_path.display().to_string(),
            total: metadata.len(),
            cancellation,
        },
        &mut source_file,
        &mut destination_file,
    )
    .await;
    state.transfers.finish(&task_id);
    result?;
    destination_file.flush().await?;
    Ok(task_id)
}

#[tauri::command]
pub async fn open_remote_file(
    app: AppHandle,
    state: State<'_, AppState>,
    session_id: String,
    remote_path: String,
) -> AppResult<PathBuf> {
    let file_name = remote_path
        .rsplit('/')
        .next()
        .filter(|name| !name.is_empty() && *name != "." && *name != "..")
        .ok_or_else(|| AppError::Validation("远端文件名无效".into()))?;
    let local_path = state
        .paths
        .temporary
        .join(format!("{}-{file_name}", Uuid::new_v4()));
    download_remote_file(app, state, session_id, remote_path, local_path.clone()).await?;
    Ok(local_path)
}

#[tauri::command]
pub fn cancel_file_transfer(state: State<'_, AppState>, task_id: String) -> AppResult<()> {
    if state.transfers.cancel(&task_id) {
        Ok(())
    } else {
        Err(AppError::Message("传输任务已结束或不存在".into()))
    }
}

struct TransferContext<'a> {
    app: &'a AppHandle,
    session_id: &'a str,
    task_id: &'a str,
    direction: &'a str,
    source: &'a str,
    destination: &'a str,
    total: u64,
    cancellation: CancellationToken,
}

async fn transfer<R, W>(
    context: TransferContext<'_>,
    reader: &mut R,
    writer: &mut W,
) -> AppResult<()>
where
    R: tokio::io::AsyncRead + Unpin,
    W: tokio::io::AsyncWrite + Unpin,
{
    let mut buffer = vec![0_u8; 64 * 1024];
    let mut transferred = 0_u64;
    loop {
        let read = tokio::select! {
            _ = context.cancellation.cancelled() => {
                emit_transfer(&context, transferred, "canceled");
                return Err(AppError::Message("文件传输已取消".into()));
            }
            result = reader.read(&mut buffer) => match result {
                Ok(read) => read,
                Err(error) => {
                    emit_transfer(&context, transferred, "error");
                    return Err(error.into());
                }
            }
        };
        if read == 0 {
            break;
        }
        if let Err(error) = writer.write_all(&buffer[..read]).await {
            emit_transfer(&context, transferred, "error");
            return Err(error.into());
        }
        transferred = transferred.saturating_add(read as u64);
        emit_transfer(&context, transferred, "running");
    }
    emit_transfer(&context, transferred, "completed");
    Ok(())
}

fn emit_transfer(context: &TransferContext<'_>, transferred: u64, state: &str) {
    let _ = context.app.emit(
        "transfer-progress",
        TransferProgressEvent {
            session_id: context.session_id.to_owned(),
            task_id: context.task_id.to_owned(),
            direction: context.direction.to_owned(),
            source: context.source.to_owned(),
            destination: context.destination.to_owned(),
            transferred,
            total: context.total,
            state: state.into(),
        },
    );
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
