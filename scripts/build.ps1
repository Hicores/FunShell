[CmdletBinding()]
param()

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$source = Join-Path $root "src-tauri\target\release\funshell.exe"
$destinationDirectory = Join-Path $root "dest"
$destination = Join-Path $destinationDirectory "FunShell.exe"

Push-Location $root
try {
    npm run tauri -- build --no-bundle
    if ($LASTEXITCODE -ne 0) {
        throw "Tauri release build failed with exit code $LASTEXITCODE"
    }
    if (-not (Test-Path -LiteralPath $source -PathType Leaf)) {
        throw "Release executable was not produced: $source"
    }
    New-Item -ItemType Directory -Path $destinationDirectory -Force | Out-Null
    Copy-Item -LiteralPath $source -Destination $destination -Force
    $artifact = Get-Item -LiteralPath $destination
    Write-Host ("Built {0} ({1:N0} bytes)" -f $artifact.FullName, $artifact.Length)
}
finally {
    Pop-Location
}
