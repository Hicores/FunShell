use russh::{
    Channel,
    client::{ChannelOpenHandle, Msg, Session},
};
use tokio::sync::mpsc;

use crate::{error::AppResult, persistence::Database};

pub struct ForwardedChannel {
    pub channel: Channel<Msg>,
    pub connected_address: String,
    pub connected_port: u32,
}

pub struct ClientHandler {
    database: Database,
    host: String,
    port: u16,
    forwarded: mpsc::UnboundedSender<ForwardedChannel>,
}

impl ClientHandler {
    pub fn new(
        database: Database,
        host: String,
        port: u16,
        forwarded: mpsc::UnboundedSender<ForwardedChannel>,
    ) -> Self {
        Self {
            database,
            host,
            port,
            forwarded,
        }
    }
}

impl russh::client::Handler for ClientHandler {
    type Error = crate::error::AppError;

    async fn check_server_key(
        &mut self,
        server_public_key: &russh::keys::ssh_key::PublicKey,
    ) -> Result<bool, Self::Error> {
        let fingerprint = server_public_key
            .fingerprint(russh::keys::ssh_key::HashAlg::Sha256)
            .to_string();
        let algorithm = server_public_key.algorithm().to_string();
        match self.database.known_host(&self.host, self.port)? {
            Some(known) if known.fingerprint == fingerprint => Ok(true),
            Some(known) => Err(crate::error::AppError::HostKeyChanged {
                host: self.host.clone(),
                port: self.port,
                algorithm,
                fingerprint,
                expected: known.fingerprint,
            }),
            None => Err(crate::error::AppError::HostKeyRequired {
                host: self.host.clone(),
                port: self.port,
                algorithm,
                fingerprint,
            }),
        }
    }

    async fn server_channel_open_forwarded_tcpip(
        &mut self,
        channel: Channel<Msg>,
        connected_address: &str,
        connected_port: u32,
        _originator_address: &str,
        _originator_port: u32,
        reply: ChannelOpenHandle,
        _session: &mut Session,
    ) -> Result<(), Self::Error> {
        reply.accept().await;
        let _ = self.forwarded.send(ForwardedChannel {
            channel,
            connected_address: connected_address.to_owned(),
            connected_port,
        });
        Ok(())
    }
}

pub fn map_sftp<T>(result: Result<T, russh_sftp::client::error::Error>) -> AppResult<T> {
    result.map_err(|error| crate::error::AppError::Sftp(error.to_string()))
}
