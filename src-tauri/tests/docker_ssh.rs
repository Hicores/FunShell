use std::{path::PathBuf, sync::Arc, time::Duration};

use russh::{
    ChannelMsg,
    client::{self, Handle},
    keys::{PrivateKeyWithHashAlg, load_secret_key},
};
use russh_sftp::client::SftpSession;
use tokio::{
    io::{AsyncBufReadExt, BufReader},
    time::timeout,
};

struct AcceptFixtureKey;

impl client::Handler for AcceptFixtureKey {
    type Error = russh::Error;

    async fn check_server_key(
        &mut self,
        _server_public_key: &russh::keys::ssh_key::PublicKey,
    ) -> Result<bool, Self::Error> {
        Ok(true)
    }
}

async fn connect(port: u16) -> Handle<AcceptFixtureKey> {
    let config = client::Config {
        keepalive_interval: Some(Duration::from_secs(5)),
        keepalive_max: 2,
        nodelay: true,
        ..Default::default()
    };
    client::connect(Arc::new(config), ("127.0.0.1", port), AcceptFixtureKey)
        .await
        .expect("connect fixture")
}

async fn execute(handle: &Handle<AcceptFixtureKey>, command: &str, pty: bool) -> String {
    let mut channel = handle.channel_open_session().await.expect("open session");
    if pty {
        channel
            .request_pty(true, "xterm-256color", 120, 32, 0, 0, &[])
            .await
            .expect("request PTY");
        channel
            .window_change(132, 40, 0, 0)
            .await
            .expect("resize PTY");
    }
    channel.exec(true, command).await.expect("exec command");
    let mut output = Vec::new();
    while let Some(message) = channel.wait().await {
        match message {
            ChannelMsg::Data { data } | ChannelMsg::ExtendedData { data, .. } => {
                output.extend_from_slice(&data)
            }
            ChannelMsg::Close | ChannelMsg::Eof => break,
            _ => {}
        }
    }
    String::from_utf8_lossy(&output).into_owned()
}

fn fixture_key() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .expect("project root")
        .join("tests/fixtures/keys/id_ed25519")
}

#[tokio::test]
#[ignore = "requires tests/fixtures/docker-compose.yml"]
async fn validates_linux_ssh_fixtures() {
    for port in [2222_u16, 2223, 2224] {
        let mut password = connect(port).await;
        assert!(
            password
                .authenticate_password("root", "FunShellTest!234")
                .await
                .expect("password auth")
                .success()
        );
        let ansi = execute(
            &password,
            "printf '\\033[31mFUNSHELL_ANSI\\033[0m\\n'; stty size",
            true,
        )
        .await;
        assert!(
            ansi.contains("\u{1b}[31mFUNSHELL_ANSI\u{1b}[0m"),
            "unexpected ANSI output on port {port}: {:?}",
            ansi.as_bytes()
        );
        assert!(
            ansi.contains("40 132"),
            "unexpected PTY size on port {port}: {ansi:?}"
        );
        let metrics = execute(
            &password,
            "test -r /proc/meminfo && command -v ps && command -v ss && echo FUNSHELL_METRICS",
            false,
        )
        .await;
        assert!(metrics.contains("FUNSHELL_METRICS"));

        let channel = password.channel_open_session().await.expect("SFTP channel");
        channel
            .request_subsystem(true, "sftp")
            .await
            .expect("SFTP subsystem");
        let sftp = SftpSession::new(channel.into_stream())
            .await
            .expect("SFTP session");
        assert!(sftp.read_dir("/root").await.expect("list root").count() > 0);

        let forwarded = password
            .channel_open_direct_tcpip("127.0.0.1", 22, "127.0.0.1", 0)
            .await
            .expect("direct TCP forwarding");
        let mut stream = BufReader::new(forwarded.into_stream());
        let mut banner = String::new();
        timeout(Duration::from_secs(3), stream.read_line(&mut banner))
            .await
            .expect("forwarded banner timeout")
            .expect("read forwarded banner");
        assert!(banner.starts_with("SSH-"), "unexpected banner: {banner:?}");
        password
            .disconnect(russh::Disconnect::ByApplication, "fixture complete", "en")
            .await
            .expect("disconnect password session");

        let mut key = connect(port).await;
        let private_key = load_secret_key(fixture_key(), None).expect("load fixture key");
        let hash = key
            .best_supported_rsa_hash()
            .await
            .expect("hash query")
            .flatten();
        assert!(
            key.authenticate_publickey(
                "root",
                PrivateKeyWithHashAlg::new(Arc::new(private_key), hash),
            )
            .await
            .expect("public key auth")
            .success()
        );
        assert!(
            execute(&key, "echo FUNSHELL_KEY_AUTH", false)
                .await
                .contains("FUNSHELL_KEY_AUTH")
        );
        key.disconnect(russh::Disconnect::ByApplication, "fixture complete", "en")
            .await
            .expect("disconnect key session");
    }
}
