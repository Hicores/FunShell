use std::sync::Arc;

use russh::client::Handle;
use russh_sftp::{
    client::{Config, RawSftpSession, SftpSession},
    protocol::{FileAttributes, OpenFlags},
};
use tokio::sync::Mutex;

use crate::{
    error::AppResult,
    services::ssh::{client::ClientHandler, client::map_sftp},
};

pub async fn open_sftp(handle: &Arc<Mutex<Handle<ClientHandler>>>) -> AppResult<SftpSession> {
    let handle = handle.lock().await;
    let channel = handle.channel_open_session().await?;
    channel.request_subsystem(true, "sftp").await?;
    drop(handle);
    map_sftp(SftpSession::new(channel.into_stream()).await)
}

#[derive(Clone)]
pub struct PipelinedSftpReader {
    session: Arc<RawSftpSession>,
    handle: String,
}

impl PipelinedSftpReader {
    pub async fn read_range(&self, offset: u64, length: usize) -> AppResult<Vec<u8>> {
        let mut output = Vec::with_capacity(length);
        while output.len() < length {
            let next_offset = offset + output.len() as u64;
            let remaining = length - output.len();
            let packet = map_sftp(
                self.session
                    .read(self.handle.clone(), next_offset, remaining as u32)
                    .await,
            )?;
            if packet.data.is_empty() {
                return Err(crate::error::AppError::Sftp("远端文件读取提前结束".into()));
            }
            output.extend_from_slice(&packet.data);
        }
        Ok(output)
    }

    pub async fn close(self) -> AppResult<()> {
        let result = map_sftp(self.session.close(self.handle).await).map(|_| ());
        let _ = self.session.close_session();
        result
    }
}

pub async fn open_pipelined_reader(
    handle: &Arc<Mutex<Handle<ClientHandler>>>,
    path: String,
) -> AppResult<PipelinedSftpReader> {
    let handle = handle.lock().await;
    let channel = handle.channel_open_session().await?;
    channel.request_subsystem(true, "sftp").await?;
    drop(handle);

    let config = Config {
        request_timeout_secs: 30,
        ..Default::default()
    };
    let session = Arc::new(RawSftpSession::new_with_config(
        channel.into_stream(),
        config,
    ));
    map_sftp(session.init().await)?;
    let remote_handle = map_sftp(
        session
            .open(path, OpenFlags::READ, FileAttributes::empty())
            .await,
    )?
    .handle;
    Ok(PipelinedSftpReader {
        session,
        handle: remote_handle,
    })
}
