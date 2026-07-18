[CmdletBinding()]
param(
    [switch]$KeepRunning
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$compose = Join-Path $root "tests\fixtures\docker-compose.yml"

Push-Location $root
try {
    docker compose -f $compose up --build --detach --wait
    if ($LASTEXITCODE -ne 0) {
        throw "Docker fixture startup failed with exit code $LASTEXITCODE"
    }
    cargo test --manifest-path src-tauri/Cargo.toml --test docker_ssh -- --ignored --nocapture
    if ($LASTEXITCODE -ne 0) {
        throw "Docker SSH integration test failed with exit code $LASTEXITCODE"
    }
}
finally {
    if (-not $KeepRunning) {
        docker compose -f $compose down --volumes
    }
    Pop-Location
}
