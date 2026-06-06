$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new()

$patterns = @(
  '.browser-profile*',
  '.browser-smoke.*.stdout.txt',
  '.browser-smoke.*.stderr.txt'
)

$removed = 0
foreach ($pattern in $patterns) {
  Get-ChildItem -Path $PSScriptRoot -Force -Filter $pattern | ForEach-Object {
    Remove-Item -LiteralPath $_.FullName -Recurse -Force
    $removed++
  }
}

Write-Host "Removed $removed test artifact(s)."
