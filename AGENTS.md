# FunShell Agent Notes

## Project invariants

- The release target is a portable Windows x64 Tauri executable. Runtime data must default to directories beside `FunShell.exe`.
- Keep secrets in the Rust backend. Frontend DTOs may contain secret identifiers, never stored plaintext credentials.
- Remote Linux data collection must prefer `/proc`, `/sys`, and locale-independent output (`LC_ALL=C`) over distribution-specific tools.
- Terminal, monitor, SFTP, and tunnel tasks must be cancellable when a session closes.
- Keep UI modules and Rust services split by feature; do not accumulate unrelated code in a single file.
- Update this file only with reproducible build/runtime pitfalls and their verified resolution.

## Verified environment notes

- The repository root has no Cargo workspace manifest. Run `cargo fmt`, `cargo test`, and `cargo clippy` from `src-tauri`; running them from the root fails before checking the Rust code.
- External file drops in a Tauri webview must use `getCurrentWebview().onDragDropEvent` to receive local filesystem paths. HTML `File.path` is absent in production; Tauri reports physical coordinates, so divide them by `devicePixelRatio` before testing the drop target bounds.
- `russh-sftp` pipelines writes but its `File` `AsyncRead` waits for every read response before sending the next request. High-latency downloads must use offset-based concurrent `RawSftpSession::read` requests and preserve response order; increasing only the read buffer does not remove the RTT bottleneck.
- SSH identification strings over a forwarded channel may be split across TCP reads. Integration fixtures must read through the newline with a timeout instead of assuming one `read()` returns the complete `SSH-...` banner.
- Repeated `ssh-keyscan` Docker health checks create unauthenticated connections and can trigger OpenSSH per-source penalties, causing loopback forwarding tests to receive `Not allowed at this time`. Check the listening socket with `ss -lnt` instead.
- Tauri builds require the MSVC target and WebView2 Evergreen Runtime. The development machine uses `stable-x86_64-pc-windows-msvc` and has WebView2 installed.
- The repository started with reference screenshots only; `PIC/` is source material and must remain unchanged.
- Vite 8 requires `@vitejs/plugin-react` 6 and its additional compiler peers. The project deliberately pins Vite 7.3 with plugin-react 5.1 to keep a stable, conflict-free React toolchain; do not upgrade one without the other.
- Vitest releases before 4.1.0 contain GHSA-5xrq-8626-4rwp. Keep Vitest at 4.1 or newer and run `npm audit` after dependency updates.
- `tauri-build` on Windows requires `src-tauri/icons/icon.ico` even when bundle generation is disabled. Regenerate the icon set with `npx tauri icon assets/icon.svg` after changing the source mark.
- `russh` defaults to `aws-lc-rs`, whose Windows build requires NASM. Keep `default-features = false` and enable `ring`, `rsa`, and `flate2`; otherwise clean Windows machines fail inside `aws-lc-sys` before Rust compilation.
- Tauri CLI rejects Rust/frontend plugin minor-version mismatches before release builds. Plain Cargo versions such as `"2.6.0"` permit a later `2.7.x`; keep `tauri-plugin-dialog` and `tauri-plugin-opener` pinned with `=...` to the same versions as their `@tauri-apps` npm packages.
- The first Windows release build compiles embedded web assets and performs full LTO. Allow at least five minutes for `scripts/build.ps1`; a short shell timeout can close Vite's output pipe and fail with `EPIPE`, or return while orphaned `cargo`/`rustc` children are still linking, so inspect those processes before starting another build.
- PowerShell's `$ErrorActionPreference = "Stop"` does not convert native executable failures into terminating errors. Build/test scripts must check `$LASTEXITCODE` immediately after `npm`, `cargo`, and `docker` commands or a later cleanup command can mask the failure.
- OpenSSH forwarding defaults differ across Linux images. Docker SSH fixtures pass `AllowTcpForwarding=yes` and `PermitOpen=any` as `sshd` command-line options so direct-channel tests are deterministic across Debian, Alpine, and Rocky.
- Rust string `"\033"` is a NUL escape followed by `33`, not a shell ESC escape. SSH fixture commands that use POSIX `printf` must contain the literal shell sequence `"\\033"`.
- Linux `ss` socket rows do not reliably include a network-interface name. Resolve bound local addresses with `ip -o addr show`; treat `0.0.0.0` and `::` as all-interface listeners, and keep IPv4/IPv6 families separate when associating established connections to wildcard listeners.
- `russh-sftp 2.3` deserializes directory metadata with numeric UID/GID but usually leaves `user/group` names empty. Resolve those IDs by reading `/etc/passwd` and `/etc/group` over SFTP and parsing locally, then fall back to remote `getent`; this avoids server-specific `stat` output and restricted shells while retaining numeric IDs as the final fallback.
- A network-rate chart must retain timestamped `receiveBps`/`transmitBps` samples per session and interface. Recomputing decorative bars from only the latest value loses the time series and produces a misleading graph; cap the real history instead and derive the vertical scale from its observed peak.
- `@xterm/addon-fit` derives rows from the terminal host geometry. Bottom padding on a full-height host does not reliably reserve rows for an overlaid command bar; reduce the host's positioned `bottom` edge above the bar so PTY resize and the visible canvas use the same unobstructed height.
- Create a connecting terminal tab before awaiting SSH and pass its preallocated session ID into the Rust session manager. Creating the tab only after `connect_session` returns hides progress and can lose shell output emitted between PTY startup and frontend subscription.
- Remove a manually closed terminal tab from frontend state before invoking backend disconnect. Otherwise the resulting `session-status: disconnected` event still sees a live tab and incorrectly schedules automatic reconnect.
- Vitest is configured without global test APIs, so React Testing Library does not auto-register cleanup from a global `afterEach`. Keep the explicit `cleanup()` call in `src/test/setup.ts`; otherwise multiple tests in one file retain duplicate dialogs and produce misleading role-query failures.
- `rusqlite 0.38` does not implement `ToSql` or `FromSql` for `u64`. Persist file byte counts as saturating non-negative `i64` values and convert them back explicitly; binding `u64` fields directly fails compilation.
- Importing `TerminalView` in Vitest's jsdom environment can print `HTMLCanvasElement.getContext()` as not implemented because xterm probes canvas support; the terminal context-action tests remain valid and avoid mounting xterm until a canvas test shim is intentionally added.
- The installed Testing Library typings reject `exact` in `findByRole` options even though the runtime supports exact matching; use a unique string `name` and verify uniqueness instead of adding `exact` to async role queries.
- Terminal reconnects must keep each workspace tab's stable `id` and replace only `sessionId`; changing the React key remounts xterm and loses scrollback, current input, and terminal context.
- Portable UI state belongs in the executable-adjacent `settings.json`, not WebView storage. Use a locked field-specific settings update for frequently changed UI state so stale whole-object saves do not overwrite unrelated settings.
