# FunShell Agent Notes

## Project invariants

- The release target is a portable Windows x64 Tauri executable. Runtime data must default to directories beside `FunShell.exe`.
- Keep secrets in the Rust backend. Frontend DTOs may contain secret identifiers, never stored plaintext credentials.
- Remote Linux data collection must prefer `/proc`, `/sys`, and locale-independent output (`LC_ALL=C`) over distribution-specific tools.
- Terminal, monitor, SFTP, and tunnel tasks must be cancellable when a session closes.
- Keep UI modules and Rust services split by feature; do not accumulate unrelated code in a single file.
- Update this file only with reproducible build/runtime pitfalls and their verified resolution.

## Verified environment notes

- Tauri builds require the MSVC target and WebView2 Evergreen Runtime. The development machine uses `stable-x86_64-pc-windows-msvc` and has WebView2 installed.
- The repository started with reference screenshots only; `PIC/` is source material and must remain unchanged.
- Vite 8 requires `@vitejs/plugin-react` 6 and its additional compiler peers. The project deliberately pins Vite 7.3 with plugin-react 5.1 to keep a stable, conflict-free React toolchain; do not upgrade one without the other.
- Vitest releases before 4.1.0 contain GHSA-5xrq-8626-4rwp. Keep Vitest at 4.1 or newer and run `npm audit` after dependency updates.
- `tauri-build` on Windows requires `src-tauri/icons/icon.ico` even when bundle generation is disabled. Regenerate the icon set with `npx tauri icon assets/icon.svg` after changing the source mark.
- `russh` defaults to `aws-lc-rs`, whose Windows build requires NASM. Keep `default-features = false` and enable `ring`, `rsa`, and `flate2`; otherwise clean Windows machines fail inside `aws-lc-sys` before Rust compilation.
- Tauri CLI rejects Rust/frontend plugin minor-version mismatches before release builds. Plain Cargo versions such as `"2.6.0"` permit a later `2.7.x`; keep `tauri-plugin-dialog` and `tauri-plugin-opener` pinned with `=...` to the same versions as their `@tauri-apps` npm packages.
- The first Windows release build compiles embedded web assets and performs full LTO. Allow at least five minutes for `scripts/build.ps1`; a short outer timeout can return while orphaned `cargo`/`rustc` children are still linking, so inspect those processes before starting another build.
- PowerShell's `$ErrorActionPreference = "Stop"` does not convert native executable failures into terminating errors. Build/test scripts must check `$LASTEXITCODE` immediately after `npm`, `cargo`, and `docker` commands or a later cleanup command can mask the failure.
- OpenSSH forwarding defaults differ across Linux images. Docker SSH fixtures pass `AllowTcpForwarding=yes` and `PermitOpen=any` as `sshd` command-line options so direct-channel tests are deterministic across Debian, Alpine, and Rocky.
- Rust string `"\033"` is a NUL escape followed by `33`, not a shell ESC escape. SSH fixture commands that use POSIX `printf` must contain the literal shell sequence `"\\033"`.
- Linux `ss` socket rows do not reliably include a network-interface name. Resolve bound local addresses with `ip -o addr show`; treat `0.0.0.0` and `::` as all-interface listeners, and keep IPv4/IPv6 families separate when associating established connections to wildcard listeners.
- A network-rate chart must retain timestamped `receiveBps`/`transmitBps` samples per session and interface. Recomputing decorative bars from only the latest value loses the time series and produces a misleading graph; cap the real history instead and derive the vertical scale from its observed peak.
- `@xterm/addon-fit` derives rows from the terminal host geometry. Bottom padding on a full-height host does not reliably reserve rows for an overlaid command bar; reduce the host's positioned `bottom` edge above the bar so PTY resize and the visible canvas use the same unobstructed height.
