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
