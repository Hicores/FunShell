use std::sync::Arc;

use zeroize::Zeroizing;

use crate::{
    domain::{AuthMethod, ConnectionProfile},
    error::{AppError, AppResult},
    security::VaultService,
};

pub(crate) const SUDO_SUCCESS_MARKER: &str = "__FUNSHELL_SUDO_SUCCESS__";
pub(crate) const SUDO_PROMPT_MARKER: &str = "__FUNSHELL_SUDO_PASSWORD__";
pub(crate) const SFTP_SERVER_MISSING_MARKER: &str = "__FUNSHELL_SFTP_SERVER_MISSING__";

pub(crate) const SFTP_SERVER_DISCOVERY_SCRIPT: &str = r#"
for candidate in /usr/lib/openssh/sftp-server /usr/lib/ssh/sftp-server /usr/libexec/openssh/sftp-server /usr/libexec/sftp-server; do
  if [ -x "$candidate" ]; then printf '%s\n' "$candidate"; exit 0; fi
done
candidate=$(command -v sftp-server 2>/dev/null || true)
if [ -n "$candidate" ]; then printf '%s\n' "$candidate"; exit 0; fi
printf '%s\n' '__FUNSHELL_SFTP_SERVER_MISSING__' >&2
exit 127
"#;

#[derive(Clone)]
pub(crate) enum SudoCredential {
    Passwordless,
    Password(Arc<Zeroizing<Vec<u8>>>),
}

impl SudoCredential {
    pub(crate) fn command(&self, command: &str) -> String {
        let prefix = match self {
            Self::Passwordless => "sudo -n -k",
            Self::Password(_) => "sudo -S -k -p '__FUNSHELL_SUDO_PASSWORD__'",
        };
        format!("{prefix} -- sh -c {}", shell_quote(command))
    }

    pub(crate) fn direct_command(&self, executable: &str) -> String {
        let prefix = match self {
            Self::Passwordless => "sudo -n -k",
            Self::Password(_) => "sudo -S -k -p '__FUNSHELL_SUDO_PASSWORD__'",
        };
        format!("{prefix} -- {}", shell_quote(executable))
    }

    pub(crate) fn stdin_payload(&self) -> Option<Zeroizing<Vec<u8>>> {
        let Self::Password(password) = self else {
            return None;
        };
        let mut payload = Zeroizing::new(password.as_ref().as_slice().to_vec());
        payload.push(b'\n');
        Some(payload)
    }
}

#[derive(Clone)]
pub(crate) struct SudoContext {
    credential: SudoCredential,
    sftp_server: Arc<str>,
}

impl SudoContext {
    pub(crate) fn new(credential: SudoCredential, sftp_server: String) -> Self {
        Self {
            credential,
            sftp_server: Arc::from(sftp_server),
        }
    }

    pub(crate) fn command(&self, command: &str) -> String {
        self.credential.command(command)
    }

    pub(crate) fn sftp_command(&self) -> String {
        self.credential.direct_command(&self.sftp_server)
    }

    pub(crate) fn stdin_payload(&self) -> Option<Zeroizing<Vec<u8>>> {
        self.credential.stdin_payload()
    }
}

pub(crate) fn passwordless_probe_command() -> String {
    format!("sudo -n -k -- sh -c true && printf '%s\\n' '{SUDO_SUCCESS_MARKER}'")
}

pub(crate) fn password_probe_command() -> String {
    format!(
        "sudo -S -k -p '{SUDO_PROMPT_MARKER}' -- sh -c true && printf '%s\\n' '{SUDO_SUCCESS_MARKER}'"
    )
}

pub(crate) fn configured_sudo_password(
    profile: &ConnectionProfile,
    vault: &VaultService,
) -> AppResult<Option<Arc<Zeroizing<Vec<u8>>>>> {
    let secret_id = profile.sudo_secret_id.as_deref().or_else(|| {
        if profile.auth_method == AuthMethod::Password {
            profile.secret_id.as_deref()
        } else {
            None
        }
    });
    let Some(secret_id) = secret_id else {
        return Ok(None);
    };
    let password = vault.reveal(secret_id)?;
    if password.is_empty() || password.iter().any(|byte| *byte == b'\n' || *byte == b'\r') {
        return Err(AppError::Validation("sudo 密码格式无效".into()));
    }
    Ok(Some(Arc::new(password)))
}

fn shell_quote(value: &str) -> String {
    format!("'{}'", value.replace('\'', "'\\''"))
}

#[cfg(test)]
mod tests {
    use zeroize::Zeroizing;

    use super::{SudoCredential, password_probe_command, passwordless_probe_command};

    #[test]
    fn wraps_background_commands_without_exposing_the_password() {
        let credential = SudoCredential::Password(std::sync::Arc::new(Zeroizing::new(
            b"secret-value".to_vec(),
        )));
        let command = credential.command("cat '/root/private file'");
        assert!(command.starts_with("sudo -S -k -p '__FUNSHELL_SUDO_PASSWORD__'"));
        assert!(command.contains("sh -c 'cat '\\''/root/private file'\\'''"));
        assert!(!command.contains("secret-value"));
        let payload = credential.stdin_payload();
        assert_eq!(
            payload.as_ref().map(|value| value.as_slice()),
            Some(b"secret-value\n".as_slice())
        );
    }

    #[test]
    fn probes_passwordless_and_password_sudo_with_success_markers() {
        assert!(passwordless_probe_command().contains("sudo -n -k"));
        assert!(password_probe_command().contains("sudo -S -k"));
        assert!(password_probe_command().contains("__FUNSHELL_SUDO_SUCCESS__"));
    }
}
