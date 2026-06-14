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

function Join-ProcessArguments {
  param([string[]]$ArgumentList)

  return (($ArgumentList | ForEach-Object {
    if ($_ -match '"') {
      throw "Process argument contains an unsupported quote: $_"
    }

    if ($_ -match '\s') { return '"' + $_ + '"' }
    return $_
  }) -join ' ')
}

function Start-SafeProcess {
  param(
    [string]$FilePath,
    [string[]]$ArgumentList,
    [switch]$Wait,
    [switch]$CaptureOutput
  )

  $startInfo = [System.Diagnostics.ProcessStartInfo]::new()
  $startInfo.FileName = $FilePath
  $startInfo.Arguments = Join-ProcessArguments $ArgumentList
  $startInfo.UseShellExecute = $false
  $startInfo.CreateNoWindow = $true

  if ($CaptureOutput) {
    $startInfo.RedirectStandardOutput = $true
    $startInfo.RedirectStandardError = $true
  }

  $process = [System.Diagnostics.Process]::new()
  $process.StartInfo = $startInfo
  [void]$process.Start()

  if (-not $Wait) { return $process }

  if ($CaptureOutput) {
    $stdoutTask = $process.StandardOutput.ReadToEndAsync()
    $stderrTask = $process.StandardError.ReadToEndAsync()
  }

  $process.WaitForExit()

  if ($CaptureOutput) {
    return [pscustomobject]@{
      Process = $process
      Stdout = $stdoutTask.Result
      Stderr = $stderrTask.Result
    }
  }

  return $process
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

  $result = Start-SafeProcess $chromePath @(
    '--headless=new',
    '--disable-gpu',
    '--disable-crash-reporter',
    '--no-first-run',
    "--user-data-dir=$profilePath",
    "--disk-cache-dir=$cachePath",
    '--virtual-time-budget=35000',
    '--dump-dom',
    $Url
  ) -Wait -CaptureOutput

  if ($result.Process.ExitCode -ne 0) {
    throw "$Name browser process failed with exit code $($result.Process.ExitCode).`n$($result.Stderr)"
  }

  if ($result.Stdout -notmatch $PassPattern) {
    throw "$Name failed.`n$($result.Stdout)`n$($result.Stderr)"
  }

  Write-Host "$Name passed."
}

$chromePath = Get-ChromePath
$server = $null
$profilePath = Join-Path $PSScriptRoot ('.browser-profile-office-browser-smoke-' + [guid]::NewGuid().ToString())
$cachePath = Join-Path $profilePath 'cache'

try {
  New-Item -ItemType Directory -Path $profilePath, $cachePath -Force | Out-Null

  $server = Start-SafeProcess powershell @(
    '-NoProfile',
    '-ExecutionPolicy', 'Bypass',
    '-File', (Join-Path $PSScriptRoot 'serve-office.ps1'),
    '-Port', $Port,
    '-Root', $Root
  )

  Wait-ForServer -PortNumber $Port

  Invoke-SmokePage "http://127.0.0.1:$Port/tests/browser-smoke.html" 'data-smoke="passed"' 'Browser smoke'
  Invoke-SmokePage "http://127.0.0.1:$Port/tests/flowcharts-behavior.html" 'data-flowcharts="passed"' 'Flowcharts behavior smoke'
  Invoke-SmokePage "http://127.0.0.1:$Port/tests/slides-behavior.html" 'data-slides-behavior="passed"' 'Slides behavior smoke'
  Invoke-SmokePage "http://127.0.0.1:$Port/tests/slides-domain-behavior.html" 'data-slides-domain="passed"' 'Slides domain smoke'
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
