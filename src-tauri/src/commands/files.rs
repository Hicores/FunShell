use chrono::Utc;
use futures_util::{StreamExt, stream};
use russh_sftp::protocol::{FileAttributes, FileType, OpenFlags};
use std::{
    collections::{HashMap, hash_map::Entry},
    path::PathBuf,
    time::Instant,
};

use tauri::{AppHandle, Emitter, Manager, State};
use tokio::{
    fs::File,
    io::{AsyncReadExt, AsyncWriteExt},
};
use tokio_util::sync::CancellationToken;
use uuid::Uuid;

use crate::{
    domain::{RemoteFileEntry, RemoteFileKind, TextFileContent, TransferProgressEvent},
    error::{AppError, AppResult},
    services::ssh::{PipelinedSftpReader, client::map_sftp},
    state::AppState,
};

const MAX_TEXT_FILE_SIZE: u64 = 5 * 1024 * 1024;
const DOWNLOAD_CHUNK_SIZE: u64 = 128 * 1024;
const DOWNLOAD_PIPELINE_DEPTH: usize = 32;

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
                user: metadata
                    .user
                    .or_else(|| metadata.uid.map(|uid| uid.to_string())),
                group: metadata
                    .group
                    .or_else(|| metadata.gid.map(|gid| gid.to_string())),
                user_id: metadata.uid,
                group_id: metadata.gid,
            }
        })
        .collect::<Vec<_>>();
    drop(sftp);
    let paths = output
        .iter()
        .map(|entry| entry.path.clone())
        .collect::<Vec<_>>();
    for (index, (user, group)) in resolve_owner_names(&state, &session_id, &paths)
        .await
        .into_iter()
        .enumerate()
    {
        if let Some(user) = user {
            output[index].user = Some(user);
        }
        if let Some(group) = group {
            output[index].group = Some(group);
        }
    }
    output.sort_by_key(|entry| {
        (
            entry.kind != RemoteFileKind::Directory,
            entry.name.to_lowercase(),
        )
    });
    Ok(output)
}

const OWNER_LOOKUP_BATCH_SIZE: usize = 64;

async fn resolve_owner_names(
    state: &AppState,
    session_id: &str,
    paths: &[String],
) -> Vec<(Option<String>, Option<String>)> {
    let mut resolved = vec![(None, None); paths.len()];
    let mut user_cache = HashMap::<u32, Option<String>>::new();
    let mut group_cache = HashMap::<u32, Option<String>>::new();
    for (offset, batch) in paths.chunks(OWNER_LOOKUP_BATCH_SIZE).enumerate() {
        let quoted_paths = batch
            .iter()
            .map(|path| shell_quote(path))
            .collect::<Vec<_>>()
            .join(" ");
        let command = format!("stat -c '%U\\t%G' -- {quoted_paths}");
        let Ok(result) = state.sessions.execute(session_id, &command).await else {
            continue;
        };
        if result.exit_status != Some(0) {
            continue;
        }
        for (index, line) in result.stdout.lines().enumerate() {
            let Some((user, group)) = line.trim().split_once('\t') else {
                continue;
            };
            let target = offset * OWNER_LOOKUP_BATCH_SIZE + index;
            if target >= resolved.len() {
                break;
            }
            if !user.is_empty() && user != "?" && !group.is_empty() && group != "?" {
                let user =
                    resolve_numeric_name(state, session_id, "passwd", user, &mut user_cache).await;
                let group =
                    resolve_numeric_name(state, session_id, "group", group, &mut group_cache).await;
                resolved[target] = (Some(user), Some(group));
            }
        }
    }
    resolved
}

async fn resolve_numeric_name(
    state: &AppState,
    session_id: &str,
    database: &str,
    value: &str,
    cache: &mut HashMap<u32, Option<String>>,
) -> String {
    let Ok(id) = value.parse::<u32>() else {
        return value.to_owned();
    };
    if let Entry::Vacant(entry) = cache.entry(id) {
        let database_file = match database {
            "passwd" => "/etc/passwd",
            "group" => "/etc/group",
            _ => "",
        };
        let command = format!(
            "name=$(getent {database} {id} 2>/dev/null | cut -d: -f1); \
             if [ -n \"$name\" ]; then printf '%s\\n' \"$name\"; \
             elif [ -n \"{database_file}\" ]; then awk -F: -v id={id} '$3 == id {{ print $1; exit }}' {database_file}; fi"
        );
        let name = state
            .sessions
            .execute(session_id, &command)
            .await
            .ok()
            .filter(|result| result.exit_status == Some(0))
            .map(|result| result.stdout.trim().to_owned())
            .filter(|name| !name.is_empty());
        entry.insert(name);
    }
    cache
        .get(&id)
        .and_then(Clone::clone)
        .unwrap_or_else(|| value.to_owned())
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
pub async fn create_remote_file(
    state: State<'_, AppState>,
    session_id: String,
    path: String,
) -> AppResult<()> {
    let sftp = state.sessions.sftp(&session_id).await?;
    let mut file = map_sftp(
        sftp.open_with_flags(
            path,
            OpenFlags::CREATE | OpenFlags::EXCLUDE | OpenFlags::WRITE,
        )
        .await,
    )?;
    file.shutdown()
        .await
        .map_err(|error| AppError::Sftp(error.to_string()))
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
pub async fn chown_remote_path(
    state: State<'_, AppState>,
    session_id: String,
    path: String,
    owner: String,
    group: String,
) -> AppResult<()> {
    let owner = owner.trim();
    let group = group.trim();
    if owner.is_empty() || group.is_empty() || owner.contains(':') || group.contains(':') {
        return Err(AppError::Validation(
            "所有者和用户组不能为空，且不能包含冒号".into(),
        ));
    }
    let command = chown_command(owner, group, &path);
    let result = state.sessions.execute(&session_id, &command).await?;
    if result.exit_status != Some(0) {
        return Err(AppError::Message(format!(
            "修改所有者失败: {}",
            result.stderr.trim()
        )));
    }
    Ok(())
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
    drop(sftp);
    if metadata.is_dir() {
        return Err(AppError::Validation("当前下载接口仅接收文件".into()));
    }
    if let Some(parent) = local_path.parent() {
        tokio::fs::create_dir_all(parent).await?;
    }
    let source_file = state
        .sessions
        .download_reader(&session_id, remote_path.clone())
        .await?;
    let mut destination_file = File::create(&local_path).await?;
    let cancellation = state.transfers.start(&task_id);
    let destination = local_path.display().to_string();
    let result = download_pipelined(
        TransferContext {
            app: &app,
            session_id: &session_id,
            task_id: &task_id,
            direction: "download",
            source: &remote_path,
            destination: &destination,
            total: metadata.len(),
            cancellation,
        },
        &source_file,
        &mut destination_file,
    )
    .await;
    let close_result = source_file.close().await;
    state.transfers.finish(&task_id);
    result?;
    close_result?;
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

fn download_ranges(total: u64) -> Vec<(u64, usize)> {
    let mut ranges = Vec::new();
    let mut offset = 0_u64;
    while offset < total {
        let length = (total - offset).min(DOWNLOAD_CHUNK_SIZE) as usize;
        ranges.push((offset, length));
        offset += length as u64;
    }
    ranges
}

async fn download_pipelined(
    context: TransferContext<'_>,
    reader: &PipelinedSftpReader,
    writer: &mut File,
) -> AppResult<()> {
    let requests = download_ranges(context.total)
        .into_iter()
        .map(|(offset, length)| {
            let reader = reader.clone();
            async move { reader.read_range(offset, length).await }
        });
    let mut chunks = stream::iter(requests).buffered(DOWNLOAD_PIPELINE_DEPTH);
    let mut transferred = 0_u64;
    let mut last_progress = Instant::now();
    emit_transfer(&context, 0, "running");
    loop {
        let next = tokio::select! {
            _ = context.cancellation.cancelled() => {
                emit_transfer(&context, transferred, "canceled");
                return Err(AppError::Message("文件传输已取消".into()));
            }
            next = chunks.next() => next,
        };
        let Some(chunk) = next else { break };
        let data = match chunk {
            Ok(data) => data,
            Err(error) => {
                emit_transfer(&context, transferred, "error");
                return Err(error);
            }
        };
        if let Err(error) = writer.write_all(&data).await {
            emit_transfer(&context, transferred, "error");
            return Err(error.into());
        }
        transferred = transferred.saturating_add(data.len() as u64);
        if last_progress.elapsed().as_millis() >= 100 || transferred >= context.total {
            emit_transfer(&context, transferred, "running");
            last_progress = Instant::now();
        }
    }
    emit_transfer(&context, transferred, "completed");
    Ok(())
}

fn emit_transfer(context: &TransferContext<'_>, transferred: u64, state: &str) {
    let transfer = TransferProgressEvent {
        session_id: context.session_id.to_owned(),
        task_id: context.task_id.to_owned(),
        direction: context.direction.to_owned(),
        source: context.source.to_owned(),
        destination: context.destination.to_owned(),
        transferred,
        total: context.total,
        state: state.into(),
        updated_at: Utc::now().to_rfc3339(),
        viewed: false,
    };
    if state != "running" || transferred == 0 {
        if let Err(error) = context
            .app
            .state::<AppState>()
            .database
            .save_transfer(&transfer)
        {
            tracing::warn!(%error, task_id = context.task_id, "failed to persist transfer history");
        }
    }
    let _ = context.app.emit("transfer-progress", transfer);
}

fn shell_quote(value: &str) -> String {
    format!("'{}'", value.replace('\'', "'\\''"))
}

fn chown_command(owner: &str, group: &str, path: &str) -> String {
    format!(
        "chown -- {} {}",
        shell_quote(&format!("{owner}:{group}")),
        shell_quote(path)
    )
}

#[cfg(test)]
mod tests {
    use super::{DOWNLOAD_CHUNK_SIZE, chown_command, download_ranges, shell_quote};

    #[test]
    fn quotes_posix_paths() {
        assert_eq!(shell_quote("/tmp/a b"), "'/tmp/a b'");
        assert_eq!(shell_quote("it's"), "'it'\\''s'");
    }

    #[test]
    fn builds_a_quoted_chown_command() {
        assert_eq!(
            chown_command("deploy", "release", "/srv/my app"),
            "chown -- 'deploy:release' '/srv/my app'"
        );
    }

    #[test]
    fn splits_download_into_ordered_ranges() {
        let total = DOWNLOAD_CHUNK_SIZE * 2 + 17;
        assert_eq!(
            download_ranges(total),
            vec![
                (0, DOWNLOAD_CHUNK_SIZE as usize),
                (DOWNLOAD_CHUNK_SIZE, DOWNLOAD_CHUNK_SIZE as usize),
                (DOWNLOAD_CHUNK_SIZE * 2, 17),
            ]
        );
    }
}
