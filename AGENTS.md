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

