param(
  [int]$Port = 4173,
  [string]$Root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
)

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new()

function Get-ChromePath {
  $candidates = @(
    'C:\Program Files\Google\Chrome\Application\chrome.exe',
    'C:\Program Files (x86)\Google\Chrome\Application\chrome.exe'
  )

  foreach ($candidate in $candidates) {
    if (Test-Path $candidate) { return $candidate }
  }

  throw 'Chrome is not installed in the expected location.'
}

function Wait-ForServer {
  param([int]$PortNumber)

  for ($attempt = 0; $attempt -lt 40; $attempt++) {
    try {
      Invoke-WebRequest -UseBasicParsing -Uri "http://127.0.0.1:$PortNumber/tests/browser-smoke.html" | Out-Null
      return
    } catch {
      Start-Sleep -Milliseconds 250
    }
  }

  throw "Local smoke server did not start on port $PortNumber."
}

function Invoke-SmokePage {
  param(
    [string]$Url,
    [string]$PassPattern,
    [string]$Name
  )

  $runId = [guid]::NewGuid().ToString()
  $stdoutPath = Join-Path $PSScriptRoot ".browser-smoke.$runId.stdout.txt"
  $stderrPath = Join-Path $PSScriptRoot ".browser-smoke.$runId.stderr.txt"

  try {
    $chrome = Start-Process $chromePath -ArgumentList @(
      '--headless=new',
      '--disable-gpu',
      '--disable-crash-reporter',
      '--no-first-run',
      "--user-data-dir=$profilePath",
      "--disk-cache-dir=$cachePath",
      '--virtual-time-budget=8000',
      '--dump-dom',
      $Url
    ) -Wait -PassThru -WindowStyle Hidden -RedirectStandardOutput $stdoutPath -RedirectStandardError $stderrPath

    $dom = Get-Content -LiteralPath $stdoutPath -Raw -ErrorAction SilentlyContinue
    $stderr = Get-Content -LiteralPath $stderrPath -Raw -ErrorAction SilentlyContinue

    if ($chrome.ExitCode -ne 0) {
      throw "$Name browser process failed with exit code $($chrome.ExitCode).`n$stderr"
    }

    if ($dom -notmatch $PassPattern) {
      throw "$Name failed.`n$dom`n$stderr"
    }

    Write-Host "$Name passed."
  } finally {
    Remove-Item -LiteralPath $stdoutPath, $stderrPath -Force -ErrorAction SilentlyContinue
  }
}

$chromePath = Get-ChromePath
$server = $null
$profilePath = Join-Path $PSScriptRoot ('.browser-profile-office-browser-smoke-' + [guid]::NewGuid().ToString())
$cachePath = Join-Path $profilePath 'cache'

try {
  New-Item -ItemType Directory -Path $profilePath, $cachePath -Force | Out-Null

  $server = Start-Process powershell -ArgumentList @(
    '-NoProfile',
    '-ExecutionPolicy', 'Bypass',
    '-File', (Join-Path $PSScriptRoot 'serve-office.ps1'),
    '-Port', $Port,
    '-Root', $Root
  ) -PassThru -WindowStyle Hidden

  Wait-ForServer -PortNumber $Port

  Invoke-SmokePage "http://127.0.0.1:$Port/tests/browser-smoke.html" 'data-smoke="passed"' 'Browser smoke'
  Invoke-SmokePage "http://127.0.0.1:$Port/tests/flowcharts-behavior.html" 'data-flowcharts="passed"' 'Flowcharts behavior smoke'
  Invoke-SmokePage "http://127.0.0.1:$Port/tests/slides-behavior.html" 'data-slides-behavior="passed"' 'Slides behavior smoke'
  Invoke-SmokePage "http://127.0.0.1:$Port/tests/paint-behavior.html" 'data-paint-behavior="passed"' 'Paint behavior smoke'
  Invoke-SmokePage "http://127.0.0.1:$Port/tests/tables-render-behavior.html" 'data-tables-render="passed"' 'Tables render smoke'
  Invoke-SmokePage "http://127.0.0.1:$Port/tests/tables-formula-behavior.html" 'data-tables-formula="passed"' 'Tables formula smoke'
} finally {
  if ($server -and -not $server.HasExited) {
    Stop-Process -Id $server.Id -Force
  }

  if (Test-Path $profilePath) {
    Remove-Item -LiteralPath $profilePath -Recurse -Force
  }
}
