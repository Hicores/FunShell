use tauri::State;
use tokio::process::Command;

use crate::{
    domain::{
        ProcessDetails, ProcessInfo, RouteTraceResult, ServerSnapshot, SocketInfo, SystemInfo,
    },
    error::{AppError, AppResult},
    services::monitor::{
        PROCESS_SCRIPT, SNAPSHOT_SCRIPT, SOCKET_SCRIPT, SYSTEM_SCRIPT, parse_process_details,
        parse_processes, parse_snapshot, parse_sockets, parse_system_info,
    },
    state::AppState,
};

#[tauri::command]
pub async fn collect_server_snapshot(
    state: State<'_, AppState>,
    session_id: String,
) -> AppResult<ServerSnapshot> {
    let result = state.sessions.execute(&session_id, SNAPSHOT_SCRIPT).await?;
    ensure_success(&result.stderr, result.exit_status)?;
    Ok(parse_snapshot(&result.stdout))
}

#[tauri::command]
pub async fn get_system_info(
    state: State<'_, AppState>,
    session_id: String,
) -> AppResult<SystemInfo> {
    let snapshot = collect_server_snapshot(state.clone(), session_id.clone()).await?;
    let result = state.sessions.execute(&session_id, SYSTEM_SCRIPT).await?;
    ensure_success(&result.stderr, result.exit_status)?;
    Ok(parse_system_info(&result.stdout, snapshot))
}

#[tauri::command]
pub async fn list_processes(
    state: State<'_, AppState>,
    session_id: String,
) -> AppResult<Vec<ProcessInfo>> {
    let result = state.sessions.execute(&session_id, PROCESS_SCRIPT).await?;
    ensure_success(&result.stderr, result.exit_status)?;
    Ok(parse_processes(&result.stdout))
}

#[tauri::command]
pub async fn get_process_details(
    state: State<'_, AppState>,
    session_id: String,
    pid: u32,
) -> AppResult<ProcessDetails> {
    if pid == 0 {
        return Err(AppError::Validation("PID 无效".into()));
    }
    let script = format!(
        "LC_ALL=C\necho __NAME__; cat /proc/{pid}/comm 2>/dev/null\necho __EXE__; readlink /proc/{pid}/exe 2>/dev/null\necho __CWD__; readlink /proc/{pid}/cwd 2>/dev/null\necho __CMD__; tr '\\0' ' ' </proc/{pid}/cmdline 2>/dev/null; echo\necho __ENV__; tr '\\0' '\\n' </proc/{pid}/environ 2>/dev/null\n"
    );
    let result = state.sessions.execute(&session_id, &script).await?;
    Ok(parse_process_details(&result.stdout, pid))
}

#[tauri::command]
pub async fn terminate_process(
    state: State<'_, AppState>,
    session_id: String,
    pid: u32,
    force: Option<bool>,
) -> AppResult<()> {
    if pid == 0 || pid == 1 {
        return Err(AppError::Validation("不允许终止该系统进程".into()));
    }
    let signal = if force.unwrap_or(false) {
        "KILL"
    } else {
        "TERM"
    };
    let result = state
        .sessions
        .execute(&session_id, &format!("kill -{signal} -- {pid}"))
        .await?;
    ensure_success(&result.stderr, result.exit_status)
}

#[tauri::command]
pub async fn list_sockets(
    state: State<'_, AppState>,
    session_id: String,
) -> AppResult<Vec<SocketInfo>> {
    let result = state.sessions.execute(&session_id, SOCKET_SCRIPT).await?;
    Ok(parse_sockets(&result.stdout))
}

#[tauri::command]
pub async fn trace_route(
    state: State<'_, AppState>,
    session_id: Option<String>,
    target: String,
    remote: bool,
) -> AppResult<RouteTraceResult> {
    validate_target(&target)?;
    let output = if remote {
        let session_id = session_id
            .as_deref()
            .ok_or_else(|| AppError::Validation("远端路由追踪需要活动会话".into()))?;
        let script = format!(
            "LC_ALL=C\nif command -v tracepath >/dev/null 2>&1; then tracepath -n {target}; elif command -v traceroute >/dev/null 2>&1; then traceroute -n {target}; else echo 'TRACE_TOOL_MISSING'; exit 127; fi"
        );
        let result = state.sessions.execute(session_id, &script).await?;
        if result.exit_status == Some(127) {
            return Err(AppError::Message(
                "服务器未安装 tracepath 或 traceroute".into(),
            ));
        }
        format!("{}{}", result.stdout, result.stderr)
    } else {
        let result = Command::new("tracert")
            .args(["-d", "-w", "1500", &target])
            .output()
            .await?;
        String::from_utf8_lossy(&result.stdout).into_owned()
    };
    Ok(RouteTraceResult {
        target,
        remote,
        output,
    })
}

fn ensure_success(stderr: &str, status: Option<u32>) -> AppResult<()> {
    if status == Some(0) || status.is_none() {
        Ok(())
    } else {
        Err(AppError::Message(if stderr.trim().is_empty() {
            format!("远端命令退出码 {}", status.unwrap_or_default())
        } else {
            stderr.trim().to_owned()
        }))
    }
}

fn validate_target(target: &str) -> AppResult<()> {
    let valid = !target.is_empty()
        && target.len() <= 253
        && target
            .chars()
            .all(|character| character.is_ascii_alphanumeric() || ".:-[]_".contains(character));
    if valid {
        Ok(())
    } else {
        Err(AppError::Validation("路由追踪目标格式无效".into()))
    }
}
