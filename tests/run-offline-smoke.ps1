param(
  [int]$Port = 0,
  [string]$Root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path,
  # Wall-clock ліміт очікування маркера однієї фази; після нього Chrome цього
  # запуску зупиняється.
  [ValidateRange(1, 3600)]
  [int]$PageTimeoutSeconds = 120,
  # Порожнє значення — стандартне розташування Chrome.
  [string]$ChromePath = ''
)

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new()
. (Join-Path $PSScriptRoot 'test-process-helpers.ps1')

function Get-ChromePath {
  foreach ($candidate in @(
    'C:\Program Files\Google\Chrome\Application\chrome.exe',
    'C:\Program Files (x86)\Google\Chrome\Application\chrome.exe'
  )) {
    if (Test-Path -LiteralPath $candidate) { return $candidate }
  }
  throw 'Chrome is not installed in the expected location.'
}

function Get-FreeTcpPort {
  $listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, 0)
  try {
    $listener.Start()
    return ([System.Net.IPEndPoint]$listener.LocalEndpoint).Port
  } finally {
    $listener.Stop()
  }
}

function Join-ProcessArguments {
  param([string[]]$ArgumentList)
  return (($ArgumentList | ForEach-Object {
    if ($_ -match '"') { throw "Unsupported quote in process argument: $_" }
    if ($_ -match '\s') { '"' + $_ + '"' } else { $_ }
  }) -join ' ')
}

function Start-CapturedProcess {
  param([string]$FilePath, [string[]]$ArgumentList)
  return Start-CapturedChildProcess -FilePath $FilePath -Arguments (Join-ProcessArguments $ArgumentList)
}

function Wait-ForServer {
  param([int]$PortNumber)
  for ($attempt = 0; $attempt -lt 40; $attempt += 1) {
    try {
      Invoke-WebRequest -UseBasicParsing -TimeoutSec 5 -Uri "http://127.0.0.1:$PortNumber/tests/offline-smoke.html" | Out-Null
      return
    } catch {
      Start-Sleep -Milliseconds 250
    }
  }
  throw "Local server did not start on port $PortNumber."
}

function Invoke-CdpEvaluation {
  param([int]$DebugPort, [string]$Expression, [int]$TimeoutSeconds = 10)
  $targets = Invoke-RestMethod -TimeoutSec $TimeoutSeconds -Uri "http://127.0.0.1:$DebugPort/json"
  $target = $null
  foreach ($candidate in $targets) {
    if ($candidate.type -eq 'page' -and $candidate.url -match '/tests/offline-smoke\.html') {
      $target = $candidate
      break
    }
  }
  if (-not $target) { throw 'Offline smoke page target is not available yet.' }
  $webSocketUrl = [string](@($target.webSocketDebuggerUrl)[0])
  if (-not $webSocketUrl) { throw 'Offline smoke DevTools WebSocket is not available yet.' }

  # Завислий renderer не відповідає на Runtime.evaluate: без токена скасування
  # ReceiveAsync чекав би вічно.
  $cancellation = [Threading.CancellationTokenSource]::new([TimeSpan]::FromSeconds($TimeoutSeconds))
  $socket = [System.Net.WebSockets.ClientWebSocket]::new()
  try {
    $token = $cancellation.Token
    [void]$socket.ConnectAsync([Uri]::new($webSocketUrl), $token).GetAwaiter().GetResult()
    $message = @{
      id = 1
      method = 'Runtime.evaluate'
      params = @{ expression = $Expression; returnByValue = $true }
    } | ConvertTo-Json -Compress -Depth 5
    $bytes = [Text.Encoding]::UTF8.GetBytes($message)
    [void]$socket.SendAsync([ArraySegment[byte]]::new($bytes), [System.Net.WebSockets.WebSocketMessageType]::Text, $true, $token).GetAwaiter().GetResult()

    $buffer = New-Object byte[] 65536
    for ($messageIndex = 0; $messageIndex -lt 20; $messageIndex += 1) {
      $responseText = [Text.StringBuilder]::new()
      do {
        $received = $socket.ReceiveAsync([ArraySegment[byte]]::new($buffer), $token).GetAwaiter().GetResult()
        [void]$responseText.Append([Text.Encoding]::UTF8.GetString($buffer, 0, $received.Count))
      } while (-not $received.EndOfMessage)
      $response = $responseText.ToString() | ConvertFrom-Json
      if ($response.id -ne 1) { continue }
      if ($response.result.exceptionDetails) { throw $response.result.exceptionDetails.text }
      if (-not $response.result.result) { throw "Unexpected Chrome DevTools response: $($responseText.ToString())" }
      return $response.result.result.value
    }
    throw 'Chrome DevTools did not return the Runtime.evaluate response.'
  } finally {
    $socket.Dispose()
    $cancellation.Dispose()
  }
}

function Wait-ForOfflineMarker {
  param([int]$DebugPort, [string]$DatasetName, [string]$Name, [System.Diagnostics.Process]$BrowserProcess)
  $lastResult = 'Waiting for page...'
  $clock = [Diagnostics.Stopwatch]::StartNew()
  while ($clock.Elapsed.TotalSeconds -lt $PageTimeoutSeconds) {
    if ($BrowserProcess.HasExited) {
      throw "$Name browser launch failed with exit code $($BrowserProcess.ExitCode); page checks did not run."
    }
    $remaining = [Math]::Max(1, [Math]::Min(10, [int]($PageTimeoutSeconds - $clock.Elapsed.TotalSeconds)))
    $marker = ''
    try {
      $marker = Invoke-CdpEvaluation -DebugPort $DebugPort -TimeoutSeconds $remaining -Expression "document.body.dataset.$DatasetName || ''"
      $lastResult = Invoke-CdpEvaluation -DebugPort $DebugPort -TimeoutSeconds $remaining -Expression "document.getElementById('result')?.textContent || ''"
    } catch {
      if ($_.Exception.Message -notmatch 'not available yet|actively refused') { $lastResult = $_.Exception.Message }
    }
    if ($marker -eq 'passed') {
      Write-Host "$Name passed."
      return
    }
    # Помилку перевірки не ковтаємо до тайм-ауту: це assertion failure, а не зависання.
    if ($marker -eq 'failed') { throw "$Name failed: $lastResult" }
    Start-Sleep -Milliseconds 250
  }
  throw "$Name timed out: no result within $PageTimeoutSeconds s wall-clock: $lastResult"
}

function Invoke-LiveOfflinePage {
  param([string]$Url, [string]$DatasetName, [string]$Name)
  $debugPort = Get-FreeTcpPort
  $capture = Start-CapturedProcess -FilePath $chromePath -ArgumentList @(
    '--headless=new',
    '--disable-gpu',
    '--disable-crash-reporter',
    '--no-first-run',
    "--remote-debugging-port=$debugPort",
    "--user-data-dir=$profilePath",
    '--enable-logging=stderr',
    '--log-level=0',
    $Url
  )

  $failure = $null
  $result = $null
  try {
    Wait-ForOfflineMarker -DebugPort $debugPort -DatasetName $DatasetName -Name $Name -BrowserProcess $capture.Process
  } catch {
    $failure = $_
  } finally {
    # Live-сторінка не завершується сама: зупиняємо лише дерево й профіль цього запуску.
    [void](Stop-OwnedProcessTree -Capture $capture -OwnedMarker $resolvedProfile)
    $result = Wait-CapturedProcess -Capture $capture -TimeoutSeconds 5 -OwnedMarker $resolvedProfile
  }
  if ($failure) { throw "$($failure.Exception.Message)`nChrome stderr:`n$($result.Stderr)" }
}

$Port = if ($Port -gt 0) { $Port } else { Get-FreeTcpPort }
$chromePath = if ($ChromePath) { (Resolve-Path -LiteralPath $ChromePath).Path } else { Get-ChromePath }
$profilePath = Join-Path $PSScriptRoot ('.offline-profile-' + [guid]::NewGuid().ToString())
$resolvedTests = [IO.Path]::GetFullPath($PSScriptRoot).TrimEnd('\') + '\'
$resolvedProfile = [IO.Path]::GetFullPath($profilePath)
if (-not $resolvedProfile.StartsWith($resolvedTests, [StringComparison]::OrdinalIgnoreCase)) {
  throw "Refusing to create or remove profile outside tests: $resolvedProfile"
}

$serverCapture = $null
$server = $null
try {
  New-Item -ItemType Directory -Path $profilePath -Force | Out-Null
  $serverCapture = Start-CapturedProcess -FilePath 'powershell' -ArgumentList @(
    '-NoProfile', '-ExecutionPolicy', 'Bypass',
    '-File', (Join-Path $PSScriptRoot 'serve-office.ps1'),
    '-Port', $Port,
    '-Root', $Root
  )
  $server = $serverCapture.Process
  Wait-ForServer -PortNumber $Port

  Invoke-LiveOfflinePage -Url "http://127.0.0.1:$Port/tests/offline-smoke.html?phase=prime" -DatasetName 'offlinePrime' -Name 'Offline cache prime'

  if ($server -and -not $server.HasExited) {
    Stop-Process -Id $server.Id -Force
    [void]$server.WaitForExit(10000)
  }
  $server = $null

  Invoke-LiveOfflinePage -Url "http://127.0.0.1:$Port/tests/offline-smoke.html?phase=offline" -DatasetName 'offlineSmoke' -Name 'Network-loss offline smoke'
} catch {
  if ($server -and -not $server.HasExited) {
    Stop-Process -Id $server.Id -Force
    [void]$server.WaitForExit(10000)
  }
  $server = $null
  $serverError = if ($serverCapture -and (Wait-OutputTasks -Capture $serverCapture -TimeoutSeconds 5)) {
    Get-CapturedText $serverCapture.StderrTask ''
  } else { '' }
  if ($serverError) { throw "$($_.Exception.Message)`nServer stderr:`n$serverError" }
  throw
} finally {
  if ($server -and -not $server.HasExited) {
    Stop-Process -Id $server.Id -Force
    [void]$server.WaitForExit(10000)
  }
  if (Test-Path -LiteralPath $resolvedProfile) {
    Remove-Item -LiteralPath $resolvedProfile -Recurse -Force -ErrorAction SilentlyContinue
  }
}
