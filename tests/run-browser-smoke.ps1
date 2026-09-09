param(
  [int]$Port = 0,
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

  if ($CaptureOutput) {
    $stdoutTask = $process.StandardOutput.ReadToEndAsync()
    $stderrTask = $process.StandardError.ReadToEndAsync()
  }

  if (-not $Wait) {
    if ($CaptureOutput) {
      return [pscustomobject]@{
        Process = $process
        StdoutTask = $stdoutTask
        StderrTask = $stderrTask
      }
    }

    return $process
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

function Test-GpuLaunchFailure {
  param([string]$Stderr)

  return $Stderr -match "(?i)(GPU process (?:exited unexpectedly|isn't usable)|gpu_data_manager|ANGLE.*(?:error|failed)|GL[_ -]?context.*(?:error|failed))"
}

# Необроблений виняток у редакторі не валить smoke-сторінку: тест може дійти до
# кінця й показати PASSED, поки половина ініціалізації мовчки не виконалась (саме
# так довго жили ReferenceError у Flowcharts і Slides). Тому окремо перевіряємо
# console сторінки.
#
# Chrome пише console у stderr рядками виду:
#   [pid:tid:date/time:INFO:CONSOLE:12] "повідомлення", source: url (12)
# Рівень там завжди INFO, тож фільтруємо за самим повідомленням: беремо лише
# `Uncaught ...` — необроблені винятки й rejection-и. Свідомі console.error/warn
# із коду (негативні фікстури імпорту) навмисно НЕ вважаємо помилкою.
function Assert-NoUncaughtPageErrors {
  param(
    [string]$Stderr,
    [string]$Name
  )

  if (-not $Stderr) { return }

  $uncaught = [regex]::Matches($Stderr, '(?m):CONSOLE:\d+\]\s+"(Uncaught[^"]*)"(?:,\s*source:\s*([^\r\n]*))?') |
    ForEach-Object {
      $message = $_.Groups[1].Value
      $source = $_.Groups[2].Value.Trim()
      if ($source) { "$message ($source)" } else { $message }
    } |
    Sort-Object -Unique

  if ($uncaught.Count -gt 0) {
    throw "$Name has uncaught page errors:`n  - $($uncaught -join "`n  - ")"
  }
}

function Invoke-SmokePage {
  param(
    [string]$Url,
    [string]$PassPattern,
    [string]$Name,
    [string[]]$ExtraArguments = @()
  )

  # Окремий профіль і кеш на КОЖНУ сторінку: спільний --user-data-dir між
  # послідовними chrome у CI спричиняв конкуренцію за профіль/disk-cache
  # (ERROR simple_index_file.cc "Could not create a directory") і нестабільний
  # стан storage у наступних сторінках.
  $pageProfile = Join-Path $PSScriptRoot ('.browser-profile-' + [guid]::NewGuid().ToString())
  $pageCache = Join-Path $pageProfile 'cache'
  $fallbackProfile = $null
  New-Item -ItemType Directory -Path $pageProfile, $pageCache -Force | Out-Null
  try {
    $baseArguments = @(
      '--headless=new',
      '--disable-gpu',
      '--disable-crash-reporter',
      '--no-first-run',
      "--user-data-dir=$pageProfile",
      "--disk-cache-dir=$pageCache",
      '--virtual-time-budget=35000',
      # Console сторінки йде в stderr — так ловимо необроблені винятки, які
      # не валять сам тест (див. Assert-NoUncaughtPageErrors).
      '--enable-logging=stderr',
      '--log-level=0',
      '--dump-dom'
    ) + $ExtraArguments + @($Url)

    $result = Start-SafeProcess $chromePath $baseArguments -Wait -CaptureOutput
    $firstLaunchStderr = $result.Stderr

    if ($result.Process.ExitCode -ne 0 -and (Test-GpuLaunchFailure $result.Stderr)) {
      Write-Host "${Name}: Chrome GPU launch failed; retrying once with SwiftShader."
      $fallbackProfile = Join-Path $PSScriptRoot ('.browser-profile-' + [guid]::NewGuid().ToString())
      $fallbackCache = Join-Path $fallbackProfile 'cache'
      New-Item -ItemType Directory -Path $fallbackProfile, $fallbackCache -Force | Out-Null
      $fallbackArguments = @(
        '--headless=new',
        '--disable-crash-reporter',
        '--no-first-run',
        '--use-angle=swiftshader',
        '--enable-unsafe-swiftshader',
        '--disable-gpu-sandbox',
        "--user-data-dir=$fallbackProfile",
        "--disk-cache-dir=$fallbackCache",
        '--virtual-time-budget=35000',
        '--enable-logging=stderr',
        '--log-level=0',
        '--dump-dom'
      ) + $ExtraArguments + @($Url)
      $result = Start-SafeProcess $chromePath $fallbackArguments -Wait -CaptureOutput
    } else {
      $firstLaunchStderr = ''
    }

    if ($result.Process.ExitCode -ne 0) {
      $launchDetails = @($firstLaunchStderr, $result.Stderr) | Where-Object { $_ }
      throw "$Name browser process failed with exit code $($result.Process.ExitCode).`nBrowser stderr:`n$($launchDetails -join "`n--- retry ---`n")"
    }

    try {
      Assert-NoUncaughtPageErrors $result.Stderr $Name

      if ($result.Stdout -notmatch $PassPattern) {
        # Витягуємо текст #result (назву перевірки/стек), щоб лог CI був читабельним,
        # а не дампом усього DOM.
        $reason = if ($result.Stdout -match '(?s)<pre id="result"[^>]*>(.*?)</pre>') {
          ($matches[1] -replace '\s+', ' ').Trim()
        } else {
          'result element missing — page did not finish or failed to load'
        }
        throw "$Name failed: $reason"
      }

      Write-Host "$Name passed."
    } catch {
      throw "$($_.Exception.Message)`nBrowser stderr:`n$($result.Stderr)"
    }
  } finally {
    if (Test-Path $pageProfile) {
      Remove-Item -LiteralPath $pageProfile -Recurse -Force -ErrorAction SilentlyContinue
    }
    if ($fallbackProfile -and (Test-Path $fallbackProfile)) {
      Remove-Item -LiteralPath $fallbackProfile -Recurse -Force -ErrorAction SilentlyContinue
    }
  }
}

$Port = if ($Port -gt 0) { $Port } else { Get-FreeTcpPort }
$chromePath = Get-ChromePath
$server = $null
$serverCapture = $null
$failure = $null

try {
  $serverCapture = Start-SafeProcess powershell @(
    '-NoProfile',
    '-ExecutionPolicy', 'Bypass',
    '-File', (Join-Path $PSScriptRoot 'serve-office.ps1'),
    '-Port', $Port,
    '-Root', $Root
  ) -CaptureOutput
  $server = $serverCapture.Process

  Wait-ForServer -PortNumber $Port

  Invoke-SmokePage "http://127.0.0.1:$Port/tests/browser-smoke.html" 'data-smoke="passed"' 'Browser smoke'
  Invoke-SmokePage "http://127.0.0.1:$Port/tests/storage-ui-behavior.html" 'data-storage-ui="passed"' 'Storage UI smoke'
  Invoke-SmokePage "http://127.0.0.1:$Port/tests/text-behavior.html" 'data-text-behavior="passed"' 'Text behavior smoke'
  Invoke-SmokePage "http://127.0.0.1:$Port/tests/text-storage-behavior.html" 'data-text-storage="passed"' 'Text storage smoke'
  Invoke-SmokePage "http://127.0.0.1:$Port/tests/flowcharts-behavior.html" 'data-flowcharts="passed"' 'Flowcharts behavior smoke'
  Invoke-SmokePage "http://127.0.0.1:$Port/tests/flowcharts-svg-behavior.html" 'data-flowcharts-svg="passed"' 'Flowcharts SVG behavior smoke'
  Invoke-SmokePage "http://127.0.0.1:$Port/tests/slides-behavior.html" 'data-slides-behavior="passed"' 'Slides behavior smoke'
  Invoke-SmokePage "http://127.0.0.1:$Port/tests/slides-domain-behavior.html" 'data-slides-domain="passed"' 'Slides domain smoke'
  Invoke-SmokePage "http://127.0.0.1:$Port/tests/paint-behavior.html" 'data-paint-behavior="passed"' 'Paint behavior smoke'
  Invoke-SmokePage "http://127.0.0.1:$Port/tests/tables-render-behavior.html" 'data-tables-render="passed"' 'Tables render smoke'
  Invoke-SmokePage "http://127.0.0.1:$Port/tests/tables-storage-viewport-behavior.html" 'data-tables-storage-viewport="passed"' 'Tables storage and viewport smoke'
  Invoke-SmokePage "http://127.0.0.1:$Port/tests/tables-formula-behavior.html" 'data-tables-formula="passed"' 'Tables formula smoke'
  Invoke-SmokePage "http://127.0.0.1:$Port/tests/xlsx-behavior.html" 'data-xlsx="passed"' 'Tables XLSX behavior smoke'
  Invoke-SmokePage "http://127.0.0.1:$Port/tests/vector-behavior.html" 'data-vector-behavior="passed"' 'Vector behavior smoke'
  Invoke-SmokePage "http://127.0.0.1:$Port/tests/responsive-smoke.html" 'data-responsive="passed"' 'Responsive layout smoke'
  Invoke-SmokePage "http://127.0.0.1:$Port/tests/pilot-readiness-behavior.html" 'data-pilot-readiness="passed"' 'Low-end pilot readiness smoke' @('--enable-low-end-device-mode')
} catch {
  $failure = $_
} finally {
  if ($server -and -not $server.HasExited) {
    Stop-Process -Id $server.Id -Force
    $server.WaitForExit()
  }

  # Прибираємо будь-які залишкові per-page профілі (на випадок аварійного виходу).
  Get-ChildItem -LiteralPath $PSScriptRoot -Filter '.browser-profile-*' -Directory -Force -ErrorAction SilentlyContinue |
    Remove-Item -Recurse -Force -ErrorAction SilentlyContinue
}

if ($failure) {
  $serverStderr = if ($serverCapture) { $serverCapture.StderrTask.Result } else { '' }
  $serverDetails = if ($serverStderr) { "`nServer stderr:`n$serverStderr" } else { '' }
  throw "$($failure.Exception.Message)$serverDetails"
}
