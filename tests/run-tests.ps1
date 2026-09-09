param(
  [string]$Root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
)

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new()

$root = (Resolve-Path -LiteralPath $Root).Path

Write-Host "Running static UI audit..."
powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot 'static-ui-audit.ps1') -Root $root
if ($LASTEXITCODE -ne 0) {
  exit $LASTEXITCODE
}

Write-Host "All baseline tests passed."
