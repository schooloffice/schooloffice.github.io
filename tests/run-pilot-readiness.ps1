param(
  [string]$Root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
)

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new()
$resolvedRoot = (Resolve-Path -LiteralPath $Root).Path

function Invoke-Gate {
  param([string]$Name, [string]$Script)
  Write-Host "`n[$Name]"
  & powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot $Script) -Root $resolvedRoot
  if ($LASTEXITCODE -ne 0) { throw "$Name failed with exit code $LASTEXITCODE" }
}

Invoke-Gate 'Static and contract tests' 'run-tests.ps1'
Invoke-Gate 'Browser, behavior, responsive and low-end tests' 'run-browser-smoke.ps1'
Invoke-Gate 'Network-loss offline test' 'run-offline-smoke.ps1'

Write-Host "`n[Whitespace integrity]"
& git -C $resolvedRoot diff --check
if ($LASTEXITCODE -ne 0) { throw "git diff --check failed with exit code $LASTEXITCODE" }

Write-Host "`nAutomated school pilot readiness gate passed."
