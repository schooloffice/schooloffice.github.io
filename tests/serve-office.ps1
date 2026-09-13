param(
  [int]$Port = 4173,
  [string]$Root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path,
  # Необов'язковий журнал запитів без відповіді 200 і обірваних відповідей. Browser smoke
  # додає його до помилки сторінки: незавантажений скрипт інакше видно лише як ReferenceError.
  [string]$LogPath = '',
  # Скільки з'єднання може чекати на запит. Chrome відкриває спекулятивні з'єднання й
  # надсилає ними запит пізніше, тож закривати їх раніше за сам браузер не можна.
  [ValidateRange(1, 3600)]
  [int]$IdleTimeoutSeconds = 60
)

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new()

$mime = @{
  '.html' = 'text/html; charset=utf-8'
  '.css' = 'text/css; charset=utf-8'
  '.js' = 'application/javascript; charset=utf-8'
  '.json' = 'application/json; charset=utf-8'
  '.png' = 'image/png'
  '.jpg' = 'image/jpeg'
  '.jpeg' = 'image/jpeg'
  '.svg' = 'image/svg+xml'
  '.woff2' = 'font/woff2'
  '.ico' = 'image/x-icon'
  '.webmanifest' = 'application/manifest+json'
}

$rootPath = [IO.Path]::GetFullPath($Root).TrimEnd('\')
$rootPrefix = $rootPath + '\'

function Write-RequestLog {
  param([string]$Message)

  if (-not $LogPath) { return }
  try {
    [IO.File]::AppendAllText($LogPath, ('{0:HH:mm:ss.fff} {1}{2}' -f (Get-Date), $Message, [Environment]::NewLine), [Text.UTF8Encoding]::new($false))
  } catch {
    # Журнал лише діагностичний: його помилка не зупиняє сервер.
  }
}

function Send-Response {
  param(
    [System.Net.Sockets.Socket]$Socket,
    [int]$Status,
    [string]$StatusText,
    [byte[]]$Body,
    [string]$ContentType = 'text/plain; charset=utf-8'
  )

  $headers = "HTTP/1.1 $Status $StatusText`r`nContent-Type: $ContentType`r`nContent-Length: $($Body.Length)`r`nCache-Control: no-store`r`nConnection: close`r`n`r`n"
  [void]$Socket.Send([Text.Encoding]::ASCII.GetBytes($headers))
  if ($Body.Length -gt 0) {
    [void]$Socket.Send($Body)
  }
}

function Send-Text {
  param([System.Net.Sockets.Socket]$Socket, [int]$Status, [string]$StatusText)
  Send-Response $Socket $Status $StatusText ([Text.Encoding]::UTF8.GetBytes($StatusText))
}

function Invoke-Request {
  param(
    [System.Net.Sockets.Socket]$Socket,
    [string]$Request
  )

  $firstLine = ($Request -split "`r?`n")[0]
  if ($firstLine -notmatch '^GET\s+([^\s]+)\s+HTTP/') {
    Write-RequestLog "405 $firstLine"
    Send-Text $Socket 405 'Method Not Allowed'
    return
  }

  $urlPath = ($matches[1] -split '\?')[0]
  $requestPath = [Uri]::UnescapeDataString($urlPath.TrimStart('/'))
  if ([string]::IsNullOrWhiteSpace($requestPath)) { $requestPath = 'index.html' }
  $fullPath = [IO.Path]::GetFullPath([IO.Path]::Combine($rootPath, ($requestPath -replace '/', [IO.Path]::DirectorySeparatorChar)))

  if (-not $fullPath.StartsWith($rootPrefix, [StringComparison]::OrdinalIgnoreCase)) {
    Write-RequestLog "403 GET $urlPath"
    Send-Text $Socket 403 'Forbidden'
    return
  }

  if ([IO.Directory]::Exists($fullPath)) {
    $fullPath = [IO.Path]::Combine($fullPath, 'index.html')
  }

  if (-not [IO.File]::Exists($fullPath)) {
    Write-RequestLog "404 GET $urlPath"
    Send-Text $Socket 404 'Not Found'
    return
  }

  $bytes = [IO.File]::ReadAllBytes($fullPath)
  $ext = [IO.Path]::GetExtension($fullPath).ToLowerInvariant()
  $contentType = if ($mime.ContainsKey($ext)) { $mime[$ext] } else { 'application/octet-stream' }
  try {
    Send-Response $Socket 200 'OK' $bytes $contentType
  } catch {
    Write-RequestLog "aborted GET ${urlPath}: $($_.Exception.GetBaseException().Message)"
  }
}

# Однопотоковий цикл на Socket.Select: сервер читає лише з'єднання, у яких уже є дані, і не
# чекає на порожні. Раніше блокуюче читання спекулятивного з'єднання Chrome затримувало всі
# інші запити до 3 с, а після тайм-ауту закривало сокет, яким браузер згодом надсилав запит, —
# скрипт сторінки лишався незавантаженим і проявлявся як ReferenceError.
$connections = New-Object 'System.Collections.Generic.Dictionary[System.Net.Sockets.Socket,object]'
$chunk = New-Object byte[] 8192

function Close-Connection {
  param([System.Net.Sockets.Socket]$Socket)

  [void]$connections.Remove($Socket)
  try { $Socket.Shutdown([System.Net.Sockets.SocketShutdown]::Send) } catch { }
  try { $Socket.Close() } catch { }
}

$listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Parse('127.0.0.1'), $Port)
$listener.Start()
Write-Host "Serving $rootPath at http://127.0.0.1:$Port/"

try {
  while ($true) {
    $readable = New-Object System.Collections.ArrayList
    [void]$readable.Add($listener.Server)
    foreach ($socket in $connections.Keys) { [void]$readable.Add($socket) }
    [System.Net.Sockets.Socket]::Select($readable, $null, $null, 250000)
    $now = [DateTime]::UtcNow

    foreach ($socket in $readable) {
      if ($socket -eq $listener.Server) {
        while ($listener.Pending()) {
          $accepted = $listener.AcceptSocket()
          $accepted.SendTimeout = 30000
          $connections[$accepted] = [pscustomobject]@{ Buffer = New-Object System.IO.MemoryStream; LastActivity = $now }
        }
        continue
      }

      $state = $null
      if (-not $connections.TryGetValue($socket, [ref]$state)) { continue }
      try {
        $read = $socket.Receive($chunk)
        if ($read -le 0) {
          # Клієнт закрив з'єднання, так і не надіславши запит (невикористане спекулятивне).
          Close-Connection $socket
          continue
        }

        $state.Buffer.Write($chunk, 0, $read)
        $state.LastActivity = $now
        $request = [Text.Encoding]::ASCII.GetString($state.Buffer.GetBuffer(), 0, [int]$state.Buffer.Length)
        if ($request.IndexOf("`r`n`r`n") -lt 0) {
          if ($state.Buffer.Length -gt 65536) {
            Write-RequestLog '431 request headers too large'
            Send-Text $socket 431 'Request Header Fields Too Large'
            Close-Connection $socket
          }
          continue
        }

        Invoke-Request $socket $request
        Close-Connection $socket
      } catch {
        # Помилка одного з'єднання (обрив клієнтом тощо) не зупиняє сервер.
        Write-RequestLog "connection error: $($_.Exception.GetBaseException().Message)"
        Close-Connection $socket
      }
    }

    foreach ($socket in @($connections.Keys)) {
      if (($now - $connections[$socket].LastActivity).TotalSeconds -gt $IdleTimeoutSeconds) {
        Close-Connection $socket
      }
    }
  }
}
finally {
  foreach ($socket in @($connections.Keys)) { Close-Connection $socket }
  $listener.Stop()
}
