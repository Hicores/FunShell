# FunShell

FunShell is a portable Windows SSH workspace built with Rust, Tauri, React, and TypeScript.

## Development

```powershell
npm install
npm run tauri dev
```

Development data is written to `.dev-data`. Release data is written beside `FunShell.exe`.

## Release

```powershell
.\scripts\build.ps1
```

The portable executable is copied to `dest\FunShell.exe`.
