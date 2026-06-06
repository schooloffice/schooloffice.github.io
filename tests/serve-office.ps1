param(
  [int]$Port = 4173,
  [string]$Root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
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

function Send-Response {
  param(
    [System.Net.Sockets.NetworkStream]$Stream,
    [int]$Status,
    [string]$StatusText,
    [byte[]]$Body,
    [string]$ContentType = 'text/plain; charset=utf-8'
  )

  $headers = "HTTP/1.1 $Status $StatusText`r`nContent-Type: $ContentType`r`nContent-Length: $($Body.Length)`r`nConnection: close`r`n`r`n"
  $headerBytes = [Text.Encoding]::ASCII.GetBytes($headers)
  $Stream.Write($headerBytes, 0, $headerBytes.Length)
  if ($Body.Length -gt 0) {
    $Stream.Write($Body, 0, $Body.Length)
  }
}

$server = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Parse('127.0.0.1'), $Port)
$server.Start()
Write-Host "Serving $Root at http://127.0.0.1:$Port/"

try {
  while ($true) {
    $client = $server.AcceptTcpClient()
    try {
      $stream = $client.GetStream()
      $buffer = New-Object byte[] 8192
      $read = $stream.Read($buffer, 0, $buffer.Length)
      if ($read -le 0) { continue }

      $request = [Text.Encoding]::ASCII.GetString($buffer, 0, $read)
      $firstLine = ($request -split "`r?`n")[0]
      if ($firstLine -notmatch '^GET\s+([^\s]+)\s+HTTP/') {
        Send-Response $stream 405 'Method Not Allowed' ([Text.Encoding]::UTF8.GetBytes('Method Not Allowed'))
        continue
      }

      $urlPath = ($matches[1] -split '\?')[0]
      $requestPath = [Uri]::UnescapeDataString($urlPath.TrimStart('/'))
      if ([string]::IsNullOrWhiteSpace($requestPath)) { $requestPath = 'index.html' }
      $requestPath = $requestPath -replace '/', [IO.Path]::DirectorySeparatorChar
      $fullPath = [IO.Path]::GetFullPath((Join-Path $Root $requestPath))

      if (-not $fullPath.StartsWith($Root, [StringComparison]::OrdinalIgnoreCase)) {
        Send-Response $stream 403 'Forbidden' ([Text.Encoding]::UTF8.GetBytes('Forbidden'))
        continue
      }

      if ((Test-Path $fullPath -PathType Container)) {
        $fullPath = Join-Path $fullPath 'index.html'
      }

      if (-not (Test-Path $fullPath -PathType Leaf)) {
        Send-Response $stream 404 'Not Found' ([Text.Encoding]::UTF8.GetBytes('Not Found'))
        continue
      }

      $bytes = [IO.File]::ReadAllBytes($fullPath)
      $ext = [IO.Path]::GetExtension($fullPath).ToLowerInvariant()
      $contentType = if ($mime.ContainsKey($ext)) { $mime[$ext] } else { 'application/octet-stream' }
      Send-Response $stream 200 'OK' $bytes $contentType
    }
    finally {
      $client.Close()
    }
  }
}
finally {
  $server.Stop()
}
