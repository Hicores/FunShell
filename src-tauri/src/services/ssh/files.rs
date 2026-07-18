use std::sync::Arc;

use russh::client::Handle;
use russh_sftp::client::SftpSession;
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
