# FunShell

FunShell 是使用 Rust、Tauri 2、React 19 和 TypeScript 构建的便携式 SSH 服务器管理工具。

主要功能包括连接与目录管理、密码/私钥认证、TOFU 主机指纹、ANSI 交互终端、命令历史与预设、SFTP 文件管理、Linux 资源监控、进程与网络分析、路由追踪、代理/跳板择优和本地/远端/SOCKS5 隧道。

## 开发

```powershell
npm install
npm run dev
```

Vite 演示模式使用内置 IPC 模拟数据。运行完整桌面程序使用：

```powershell
npm run tauri dev
```

## 验证

```powershell
npm test
npm run build
cargo fmt --manifest-path src-tauri/Cargo.toml --all -- --check
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings
cargo test --manifest-path src-tauri/Cargo.toml
npm audit
```

Docker 可用时执行三发行版 SSH 集成测试：

```powershell
powershell -ExecutionPolicy Bypass -File scripts/test-fixtures.ps1
```

## 发布

```powershell
powershell -ExecutionPolicy Bypass -File scripts/build.ps1
```

发布结果为 `dest/FunShell.exe`。首次运行会在可执行文件旁创建 `config/funshell.db`、`config/settings.json`、`downloads`、`logs` 和 `temp`；重新发布只覆盖主程序，不会清理这些数据。
