use tauri::State;

use crate::{
    domain::ExecResult,
    error::{AppError, AppResult},
    state::AppState,
};

const MISSING_TAR_MARKER: &str = "__FUNSHELL_ARCHIVE_MISSING_TAR__";
const MISSING_GZIP_MARKER: &str = "__FUNSHELL_ARCHIVE_MISSING_GZIP__";
const SOURCE_MISSING_MARKER: &str = "__FUNSHELL_ARCHIVE_SOURCE_MISSING__";
const ARCHIVE_EXISTS_MARKER: &str = "__FUNSHELL_ARCHIVE_EXISTS__";
const DESTINATION_INVALID_MARKER: &str = "__FUNSHELL_ARCHIVE_DESTINATION_INVALID__";

#[tauri::command]
pub async fn create_remote_archive(
    state: State<'_, AppState>,
    session_id: String,
    source_path: String,
    archive_path: String,
) -> AppResult<String> {
    let command = create_archive_command(&source_path, &archive_path)?;
    let result = state.sessions.execute_file(&session_id, &command).await?;
    ensure_archive_command_succeeded("打包", &result)?;
    Ok(archive_path)
}

#[tauri::command]
pub async fn extract_remote_archive(
    state: State<'_, AppState>,
    session_id: String,
    archive_path: String,
    destination_path: String,
) -> AppResult<String> {
    let command = extract_archive_command(&archive_path, &destination_path)?;
    let result = state.sessions.execute_file(&session_id, &command).await?;
    ensure_archive_command_succeeded("解包", &result)?;
    Ok(destination_path)
}

fn create_archive_command(source_path: &str, archive_path: &str) -> AppResult<String> {
    let (source_parent, source_name) = split_remote_path(source_path, "打包对象路径")?;
    validate_archive_path(archive_path)?;
    let (archive_parent, _) = split_remote_path(archive_path, "压缩包路径")?;
    if source_parent != archive_parent {
        return Err(AppError::Validation(
            "压缩包需要保存在打包对象所在目录".into(),
        ));
    }
    if source_path.trim_end_matches('/') == archive_path.trim_end_matches('/') {
        return Err(AppError::Validation("压缩包路径需要与打包对象不同".into()));
    }

    Ok(format!(
        "{} if [ ! -e {source} ] && [ ! -L {source} ]; then printf '%s\\n' '{SOURCE_MISSING_MARKER}' >&2; exit 2; fi; \
         if [ -e {archive} ] || [ -L {archive} ]; then printf '%s\\n' '{ARCHIVE_EXISTS_MARKER}' >&2; exit 17; fi; \
         tar -czf {archive} -C {parent} {entry}",
        dependency_check(),
        source = shell_quote(source_path.trim_end_matches('/')),
        archive = shell_quote(archive_path),
        parent = shell_quote(&source_parent),
        entry = shell_quote(&format!("./{source_name}")),
    ))
}

fn extract_archive_command(archive_path: &str, destination_path: &str) -> AppResult<String> {
    validate_archive_path(archive_path)?;
    validate_absolute_remote_path(destination_path, "解包路径")?;

    Ok(format!(
        "{} if [ ! -f {archive} ]; then printf '%s\\n' '{SOURCE_MISSING_MARKER}' >&2; exit 2; fi; \
         if ! mkdir -p {destination}; then printf '%s\\n' '{DESTINATION_INVALID_MARKER}' >&2; exit 3; fi; \
         tar -tzf {archive} >/dev/null && tar -xzf {archive} -C {destination}",
        dependency_check(),
        archive = shell_quote(archive_path),
        destination = shell_quote(destination_path),
    ))
}

fn dependency_check() -> String {
    format!(
        "if ! command -v tar >/dev/null 2>&1; then printf '%s\\n' '{MISSING_TAR_MARKER}' >&2; exit 127; fi; \
         if ! command -v gzip >/dev/null 2>&1; then printf '%s\\n' '{MISSING_GZIP_MARKER}' >&2; exit 127; fi;"
    )
}

fn split_remote_path(path: &str, label: &str) -> AppResult<(String, String)> {
    validate_absolute_remote_path(path, label)?;
    let normalized = path.trim_end_matches('/');
    if normalized.is_empty() {
        return Err(AppError::Validation(format!(
            "{label}需要指向根目录下的具体项目"
        )));
    }
    let Some((parent, name)) = normalized.rsplit_once('/') else {
        return Err(AppError::Validation(format!("{label}无效")));
    };
    if name.is_empty() || name == "." || name == ".." {
        return Err(AppError::Validation(format!("{label}中的名称无效")));
    }
    Ok((
        if parent.is_empty() {
            "/".into()
        } else {
            parent.into()
        },
        name.into(),
    ))
}

fn validate_archive_path(path: &str) -> AppResult<()> {
    validate_absolute_remote_path(path, "压缩包路径")?;
    if !path.to_ascii_lowercase().ends_with(".tar.gz") {
        return Err(AppError::Validation("压缩包名称必须以 .tar.gz 结尾".into()));
    }
    Ok(())
}

fn validate_absolute_remote_path(path: &str, label: &str) -> AppResult<()> {
    if !path.starts_with('/') || path.contains('\0') || path.contains('\n') || path.contains('\r') {
        return Err(AppError::Validation(format!(
            "{label}必须是有效的远程绝对路径"
        )));
    }
    Ok(())
}

fn ensure_archive_command_succeeded(action: &str, result: &ExecResult) -> AppResult<()> {
    if result.exit_status == Some(0) {
        return Ok(());
    }
    let output = format!("{}\n{}", result.stderr, result.stdout);
    let detail = if output.contains(MISSING_TAR_MARKER) {
        "服务器缺少 tar 命令，请安装 tar 后重试".into()
    } else if output.contains(MISSING_GZIP_MARKER) {
        "服务器缺少 gzip 命令，请安装 gzip 后重试".into()
    } else if output.contains(SOURCE_MISSING_MARKER) {
        if action == "打包" {
            "打包对象不存在或已经被移动".into()
        } else {
            "压缩包不存在或不是普通文件".into()
        }
    } else if output.contains(ARCHIVE_EXISTS_MARKER) {
        "当前目录已经存在同名压缩包，请修改压缩包名称".into()
    } else if output.contains(DESTINATION_INVALID_MARKER) {
        "解包路径创建失败，请检查路径和写入权限".into()
    } else {
        remote_command_failure_detail(result)
    };
    Err(AppError::Message(format!("{action}失败: {detail}")))
}

fn remote_command_failure_detail(result: &ExecResult) -> String {
    if !result.stderr.trim().is_empty() {
        result.stderr.trim().to_owned()
    } else if !result.stdout.trim().is_empty() {
        result.stdout.trim().to_owned()
    } else if let Some(status) = result.exit_status {
        format!("远端命令退出码 {status}，服务器未返回错误详情")
    } else {
        "服务器未返回退出状态或错误详情".into()
    }
}

fn shell_quote(value: &str) -> String {
    format!("'{}'", value.replace('\'', "'\\''"))
}

#[cfg(test)]
mod tests {
    use crate::domain::ExecResult;

    use super::{
        create_archive_command, ensure_archive_command_succeeded, extract_archive_command,
        split_remote_path,
    };

    #[test]
    fn archives_one_relative_entry_for_reversible_extraction() {
        let command = create_archive_command(
            "/srv/releases/my app",
            "/srv/releases/my app.20260801-203000.tar.gz",
        )
        .expect("archive command");
        assert!(command.contains("tar -czf '/srv/releases/my app.20260801-203000.tar.gz'"));
        assert!(command.contains("-C '/srv/releases' './my app'"));
    }

    #[test]
    fn extracts_into_the_selected_directory() {
        let command = extract_archive_command(
            "/srv/releases/my app.20260801-203000.tar.gz",
            "/opt/restored app",
        )
        .expect("extract command");
        assert!(command.contains("mkdir -p '/opt/restored app'"));
        assert!(command.contains(
            "tar -xzf '/srv/releases/my app.20260801-203000.tar.gz' -C '/opt/restored app'"
        ));
    }

    #[test]
    fn keeps_the_archive_beside_its_source() {
        assert!(create_archive_command("/srv/app", "/tmp/app.tar.gz").is_err());
    }

    #[test]
    fn rejects_the_remote_root_as_a_single_archive_entry() {
        assert!(split_remote_path("/", "打包对象路径").is_err());
    }

    #[test]
    fn reports_missing_archive_dependencies() {
        let result = ExecResult {
            stdout: String::new(),
            stderr: "__FUNSHELL_ARCHIVE_MISSING_TAR__\n".into(),
            exit_status: Some(127),
        };
        let error = ensure_archive_command_succeeded("打包", &result).expect_err("missing tar");
        assert_eq!(
            error.to_string(),
            "打包失败: 服务器缺少 tar 命令，请安装 tar 后重试"
        );
    }
}
