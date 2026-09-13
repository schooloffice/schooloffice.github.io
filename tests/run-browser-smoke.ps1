param(
  [int]$Port = 0,
  [string]$Root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path,
  # Wall-clock ліміт одного запуску Chrome. `--virtual-time-budget` керує лише
  # віртуальним часом сторінки і не завершує завислий процес.
  [ValidateRange(1, 3600)]
  [int]$PageTimeoutSeconds = 120,
  # Порожнє значення — стандартне розташування Chrome.
  [string]$ChromePath = ''
)

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new()
. (Join-Path $PSScriptRoot 'test-process-helpers.ps1')

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
    [string[]]$ArgumentList
  )

  return Start-CapturedChildProcess -FilePath $FilePath -Arguments (Join-ProcessArguments $ArgumentList)
}

function Wait-ForServer {
  param([int]$PortNumber)

  for ($attempt = 0; $attempt -lt 40; $attempt++) {
    try {
      Invoke-WebRequest -UseBasicParsing -TimeoutSec 5 -Uri "http://127.0.0.1:$PortNumber/tests/browser-smoke.html" | Out-Null
      return
    } catch {
      Start-Sleep -Milliseconds 250
    }
  }

  throw "Local smoke server did not start on port $PortNumber."
}

function Invoke-RawGet {
  param(
    [System.Net.Sockets.TcpClient]$Client,
    [string]$Path
  )

  $stream = $Client.GetStream()
  $stream.ReadTimeout = 10000
  $request = [Text.Encoding]::ASCII.GetBytes("GET $Path HTTP/1.1`r`nHost: 127.0.0.1`r`nConnection: close`r`n`r`n")
  try {
    $stream.Write($request, 0, $request.Length)
    $buffer = New-Object byte[] 512
    $read = $stream.Read($buffer, 0, $buffer.Length)
    if ($read -le 0) { return 'connection closed without a response' }
    return ([Text.Encoding]::ASCII.GetString($buffer, 0, $read) -split "`r`n")[0]
  } catch {
    return "request failed: $($_.Exception.GetBaseException().Message)"
  }
}

# Chrome тримає спекулятивні з'єднання відкритими й надсилає ними запит пізніше. Сервер не
# повинен ні затримувати на них інші запити, ні закривати їх, поки браузер може ними скористатися:
# інакше скрипт редактора не завантажується, а smoke падає з оманливим ReferenceError.
function Assert-ServerKeepsPreconnectedSockets {
  param([int]$PortNumber)

  $idle = [System.Net.Sockets.TcpClient]::new('127.0.0.1', $PortNumber)
  try {
    $stopwatch = [Diagnostics.Stopwatch]::StartNew()
    $parallel = [System.Net.Sockets.TcpClient]::new('127.0.0.1', $PortNumber)
    try {
      $status = Invoke-RawGet -Client $parallel -Path '/tests/browser-smoke.html'
    } finally {
      $parallel.Close()
    }
    if ($status -ne 'HTTP/1.1 200 OK' -or $stopwatch.ElapsedMilliseconds -gt 2000) {
      throw "Local smoke server delays requests while another connection is idle: $status after $($stopwatch.ElapsedMilliseconds) ms."
    }

    # Довше за колишній 3-секундний тайм-аут читання, після якого сервер закривав з'єднання.
    Start-Sleep -Milliseconds 3500
    $late = Invoke-RawGet -Client $idle -Path '/tests/browser-smoke.html'
    if ($late -ne 'HTTP/1.1 200 OK') {
      throw "Local smoke server dropped a request sent on a preconnected connection after 3.5 s: $late."
    }
  } finally {
    $idle.Close()
  }
}

function Get-ServerLogLength {
  if (-not $serverLogPath -or -not (Test-Path -LiteralPath $serverLogPath)) { return 0 }
  return (Get-Item -LiteralPath $serverLogPath).Length
}

function Get-ServerLogSince {
  param([long]$Offset)

  if (-not $serverLogPath -or -not (Test-Path -LiteralPath $serverLogPath)) { return '' }
  $stream = [IO.File]::Open($serverLogPath, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::ReadWrite)
  try {
    if ($stream.Length -le $Offset) { return '' }
    [void]$stream.Seek($Offset, [IO.SeekOrigin]::Begin)
    return (New-Object IO.StreamReader($stream, [Text.Encoding]::UTF8)).ReadToEnd().Trim()
  } finally {
    $stream.Dispose()
  }
}

# Незавантажений ресурс (404, обірвана відповідь) проявляється на сторінці як ReferenceError чи
# незавершений тест. Журнал сервера за час цієї сторінки стає першим рядком помилки.
function Add-ServerLogDetails {
  param(
    [string]$Message,
    [long]$Offset,
    [string]$Name
  )

  $log = Get-ServerLogSince $Offset
  if (-not $log) { return $Message }
  $entries = ($log -split "`r?`n" | Where-Object { $_ } | ForEach-Object { "  - $_" }) -join "`n"
  return "${Name}: resources failed to load during this page (server log):`n$entries`n$Message"
}

# Профілі створює й видаляє лише цей запуск: тільки власні GUID-шляхи всередині
# tests/, без очищення за маскою чужих або паралельних прогонів.
function New-PageProfile {
  $path = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot ('.browser-profile-' + [guid]::NewGuid().ToString())))
  $script:ownedProfiles.Add($path)
  New-Item -ItemType Directory -Path $path, (Join-Path $path 'cache') -Force | Out-Null
  return $path
}

function Remove-PageProfile {
  param([string]$Path)

  $leaf = Split-Path -Leaf $Path
  if (-not $Path.StartsWith($resolvedTests, [StringComparison]::OrdinalIgnoreCase) -or $leaf -notlike '.browser-profile-*') {
    throw "Refusing to remove browser profile outside tests: $Path"
  }
  if (Test-Path -LiteralPath $Path) {
    Remove-Item -LiteralPath $Path -Recurse -Force -ErrorAction SilentlyContinue
  }
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

function Invoke-ChromeRun {
  param(
    [string[]]$ArgumentList,
    [string]$ProfilePath
  )

  $capture = Start-SafeProcess $chromePath $ArgumentList
  $completed = $false
  try {
    $result = Wait-CapturedProcess -Capture $capture -TimeoutSeconds $PageTimeoutSeconds -OwnedMarker $ProfilePath
    $completed = $true
    return $result
  } finally {
    # Перерваний прогін (Ctrl+C, виняток) не лишає браузер цього профілю.
    if (-not $completed) {
      [void](Stop-OwnedProcessTree -Capture $capture -OwnedMarker $ProfilePath)
    }
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
  $pageProfile = New-PageProfile
  $pageCache = Join-Path $pageProfile 'cache'
  $fallbackProfile = $null
  $serverLogOffset = Get-ServerLogLength
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

    $result = Invoke-ChromeRun $baseArguments $pageProfile
    $firstLaunchStderr = $result.Stderr

    # Повтор лише для швидкої GPU-відмови запуску; тайм-аут не подвоюємо.
    if (-not $result.TimedOut -and $result.ExitCode -ne 0 -and (Test-GpuLaunchFailure $result.Stderr)) {
      Write-Host "${Name}: Chrome GPU launch failed; retrying once with SwiftShader."
      $fallbackProfile = New-PageProfile
      $fallbackCache = Join-Path $fallbackProfile 'cache'
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
      $result = Invoke-ChromeRun $fallbackArguments $fallbackProfile
    } else {
      $firstLaunchStderr = ''
    }

    $launchDetails = @($firstLaunchStderr, $result.Stderr) | Where-Object { $_ }
    $stderrDetails = "Browser stderr:`n$($launchDetails -join "`n--- retry ---`n")"

    if ($result.TimedOut) {
      throw "$Name timed out: browser did not finish within $PageTimeoutSeconds s wall-clock; stopped $($result.StoppedProcessCount) process(es) of this run.`n$stderrDetails"
    }

    if (-not $result.OutputComplete) {
      throw "$Name browser output did not close after exit (exit code $($result.ExitCode)); stopped $($result.StoppedProcessCount) process(es) of this run.`n$stderrDetails"
    }

    if ($result.ExitCode -ne 0) {
      throw "$Name browser launch failed with exit code $($result.ExitCode); page checks did not run.`n$stderrDetails"
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
  } catch {
    throw (Add-ServerLogDetails $_.Exception.Message $serverLogOffset $Name)
  } finally {
    Remove-PageProfile $pageProfile
    if ($fallbackProfile) { Remove-PageProfile $fallbackProfile }
  }
}

$Port = if ($Port -gt 0) { $Port } else { Get-FreeTcpPort }
$chromePath = if ($ChromePath) { (Resolve-Path -LiteralPath $ChromePath).Path } else { Get-ChromePath }
$resolvedTests = [IO.Path]::GetFullPath($PSScriptRoot).TrimEnd('\') + '\'
$ownedProfiles = New-Object System.Collections.Generic.List[string]
$serverLogPath = [IO.Path]::Combine([IO.Path]::GetTempPath(), "office-plus-smoke-server-$([guid]::NewGuid()).log")
$server = $null
$serverCapture = $null
$failure = $null

try {
  $serverCapture = Start-SafeProcess powershell @(
    '-NoProfile',
    '-ExecutionPolicy', 'Bypass',
    '-File', (Join-Path $PSScriptRoot 'serve-office.ps1'),
    '-Port', $Port,
    '-Root', $Root,
    '-LogPath', $serverLogPath
  )
  $server = $serverCapture.Process

  Wait-ForServer -PortNumber $Port
  Assert-ServerKeepsPreconnectedSockets -PortNumber $Port

  Invoke-SmokePage "http://127.0.0.1:$Port/tests/browser-smoke.html" 'data-smoke="passed"' 'Browser smoke'
  Invoke-SmokePage "http://127.0.0.1:$Port/tests/storage-ui-behavior.html" 'data-storage-ui="passed"' 'Storage UI smoke'
  Invoke-SmokePage "http://127.0.0.1:$Port/tests/text-behavior.html" 'data-text-behavior="passed"' 'Text behavior smoke'
  Invoke-SmokePage "http://127.0.0.1:$Port/tests/text-model-behavior.html" 'data-text-model="passed"' 'Text document model smoke'
  Invoke-SmokePage "http://127.0.0.1:$Port/tests/text-header-footer-behavior.html" 'data-text-header-footer="passed"' 'Text header and footer smoke'
  Invoke-SmokePage "http://127.0.0.1:$Port/tests/text-toc-behavior.html" 'data-text-toc="passed"' 'Text table of contents smoke'
  Invoke-SmokePage "http://127.0.0.1:$Port/tests/text-sections-behavior.html" 'data-text-sections="passed"' 'Text sections smoke'
  Invoke-SmokePage "http://127.0.0.1:$Port/tests/text-columns-behavior.html" 'data-text-columns="passed"' 'Text columns smoke'
  Invoke-SmokePage "http://127.0.0.1:$Port/tests/text-formats-behavior.html" 'data-text-formats="passed"' 'Text formats smoke'
  Invoke-SmokePage "http://127.0.0.1:$Port/tests/text-storage-behavior.html" 'data-text-storage="passed"' 'Text storage smoke'
  Invoke-SmokePage "http://127.0.0.1:$Port/tests/flowcharts-behavior.html" 'data-flowcharts="passed"' 'Flowcharts behavior smoke'
  Invoke-SmokePage "http://127.0.0.1:$Port/tests/flowcharts-svg-behavior.html" 'data-flowcharts-svg="passed"' 'Flowcharts SVG behavior smoke'
  Invoke-SmokePage "http://127.0.0.1:$Port/tests/slides-behavior.html" 'data-slides-behavior="passed"' 'Slides behavior smoke'
  Invoke-SmokePage "http://127.0.0.1:$Port/tests/slides-domain-behavior.html" 'data-slides-domain="passed"' 'Slides domain smoke'
  Invoke-SmokePage "http://127.0.0.1:$Port/tests/slides-pptx-import-behavior.html" 'data-slides-pptx-import="passed"' 'Slides PPTX import pilot smoke'
  Invoke-SmokePage "http://127.0.0.1:$Port/tests/paint-behavior.html" 'data-paint-behavior="passed"' 'Paint behavior smoke'
  Invoke-SmokePage "http://127.0.0.1:$Port/tests/tables-render-behavior.html" 'data-tables-render="passed"' 'Tables render smoke'
  Invoke-SmokePage "http://127.0.0.1:$Port/tests/tables-storage-viewport-behavior.html" 'data-tables-storage-viewport="passed"' 'Tables storage and viewport smoke'
  Invoke-SmokePage "http://127.0.0.1:$Port/tests/tables-formula-behavior.html" 'data-tables-formula="passed"' 'Tables formula smoke'
  Invoke-SmokePage "http://127.0.0.1:$Port/tests/xlsx-behavior.html" 'data-xlsx="passed"' 'Tables XLSX behavior smoke'
  Invoke-SmokePage "http://127.0.0.1:$Port/tests/vector-behavior.html" 'data-vector-behavior="passed"' 'Vector behavior smoke'
  Invoke-SmokePage "http://127.0.0.1:$Port/tests/responsive-smoke.html" 'data-responsive="passed"' 'Responsive layout smoke'
  Invoke-SmokePage "http://127.0.0.1:$Port/tests/accessibility-smoke.html" 'data-accessibility="passed"' 'Contrast and zoom 200% smoke'
  Invoke-SmokePage "http://127.0.0.1:$Port/tests/pilot-readiness-behavior.html" 'data-pilot-readiness="passed"' 'Low-end pilot readiness smoke' @('--enable-low-end-device-mode')
} catch {
  $failure = $_
} finally {
  if ($server -and -not $server.HasExited) {
    Stop-Process -Id $server.Id -Force
    [void]$server.WaitForExit(10000)
  }

  # Повторна спроба для власних профілів, які ще тримав щойно зупинений процес.
  foreach ($ownedProfile in $ownedProfiles) { Remove-PageProfile $ownedProfile }
  if (Test-Path -LiteralPath $serverLogPath) { Remove-Item -LiteralPath $serverLogPath -Force -ErrorAction SilentlyContinue }
}

if ($failure) {
  $serverStderr = if ($serverCapture -and (Wait-OutputTasks -Capture $serverCapture -TimeoutSeconds 5)) {
    Get-CapturedText $serverCapture.StderrTask ''
  } else { '' }
  $serverDetails = if ($serverStderr) { "`nServer stderr:`n$serverStderr" } else { '' }
  throw "$($failure.Exception.Message)$serverDetails"
}
