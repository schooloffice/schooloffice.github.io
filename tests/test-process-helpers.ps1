# Спільні обмежені в часі операції з дочірніми процесами для browser/offline smoke.
#
# Chrome запускає renderer/GPU/utility-процеси, які успадковують stdout/stderr.
# Тому ні `WaitForExit()` без тайм-ауту, ні `.Result` задач читання не можна
# використовувати: завислий браузер або нащадок, що тримає pipe, блокує весь
# прогін. Завершуємо лише дерево процесу, який запустив цей раннер, і процеси з
# унікальним (GUID) профілем цього запуску — ніколи не всі chrome.exe.

function Start-CapturedChildProcess {
  param([string]$FilePath, [string]$Arguments)

  $info = [System.Diagnostics.ProcessStartInfo]::new()
  $info.FileName = $FilePath
  $info.Arguments = $Arguments
  $info.UseShellExecute = $false
  $info.CreateNoWindow = $true
  $info.RedirectStandardOutput = $true
  $info.RedirectStandardError = $true

  $process = [System.Diagnostics.Process]::new()
  $process.StartInfo = $info
  # Час до старту: нащадки root створені не раніше, а процеси з повторно
  # використаним PID — раніше.
  $startTime = Get-Date
  [void]$process.Start()

  return [pscustomobject]@{
    Process = $process
    StartTime = $startTime
    StdoutTask = $process.StandardOutput.ReadToEndAsync()
    StderrTask = $process.StandardError.ReadToEndAsync()
  }
}

function Get-OwnedProcessIds {
  param(
    [int]$RootId,
    [datetime]$RootStartTime,
    [string]$OwnedMarker
  )

  $all = @(Get-CimInstance Win32_Process -Property ProcessId, ParentProcessId, CreationDate, CommandLine -ErrorAction SilentlyContinue)
  $owned = New-Object 'System.Collections.Generic.HashSet[int]'
  $queue = New-Object 'System.Collections.Generic.Queue[object]'
  $notBefore = $RootStartTime.AddSeconds(-1)

  foreach ($candidate in $all) {
    if ($candidate.ProcessId -eq $RootId -and $candidate.CreationDate -ge $notBefore) { [void]$owned.Add($RootId) }
  }
  # Нащадки вже завершеного root зберігають його ParentProcessId.
  $queue.Enqueue([pscustomobject]@{ Id = $RootId; Created = $notBefore })
  while ($queue.Count -gt 0) {
    $parent = $queue.Dequeue()
    foreach ($child in $all) {
      if ($child.ParentProcessId -eq $parent.Id -and $child.ProcessId -ne $parent.Id -and $child.CreationDate -ge $parent.Created -and $owned.Add($child.ProcessId)) {
        $queue.Enqueue([pscustomobject]@{ Id = $child.ProcessId; Created = $child.CreationDate })
      }
    }
  }

  if ($OwnedMarker) {
    foreach ($candidate in $all) {
      if ($candidate.CommandLine -and $candidate.CommandLine.IndexOf($OwnedMarker, [StringComparison]::OrdinalIgnoreCase) -ge 0) {
        [void]$owned.Add($candidate.ProcessId)
      }
    }
  }

  [void]$owned.Remove($PID)
  return @($owned)
}

function Stop-OwnedProcessTree {
  param(
    [pscustomobject]$Capture,
    [string]$OwnedMarker
  )

  $stopped = 0
  for ($pass = 0; $pass -lt 3; $pass++) {
    $ids = @(Get-OwnedProcessIds -RootId $Capture.Process.Id -RootStartTime $Capture.StartTime -OwnedMarker $OwnedMarker)
    if ($ids.Count -eq 0) { break }
    foreach ($id in $ids) {
      try {
        Stop-Process -Id $id -Force -ErrorAction Stop
        $stopped++
      } catch {
        # Процес завершився між знімком і зупинкою.
      }
    }
    Start-Sleep -Milliseconds 200
  }

  if (-not $Capture.Process.HasExited) { [void]$Capture.Process.WaitForExit(5000) }
  return $stopped
}

function Wait-OutputTasks {
  param([pscustomobject]$Capture, [int]$TimeoutSeconds)

  $tasks = [System.Threading.Tasks.Task[]]@($Capture.StdoutTask, $Capture.StderrTask)
  try {
    return [System.Threading.Tasks.Task]::WaitAll($tasks, $TimeoutSeconds * 1000)
  } catch {
    # AggregateException: читання завершилося з помилкою, але вже не блокує.
    return $true
  }
}

function Get-CapturedText {
  param([System.Threading.Tasks.Task]$Task, [string]$Unavailable)
  if ($Task.IsCompleted -and -not $Task.IsFaulted) { return $Task.Result }
  return $Unavailable
}

# Чекає процес не довше TimeoutSeconds, потім зупиняє дерево цього запуску.
# Читання stdout/stderr теж обмежене: якщо pipe тримає нащадок, його зупиняють.
function Wait-CapturedProcess {
  param(
    [pscustomobject]$Capture,
    [int]$TimeoutSeconds,
    [string]$OwnedMarker,
    [int]$OutputGraceSeconds = 10
  )

  $process = $Capture.Process
  $timedOut = -not $process.WaitForExit($TimeoutSeconds * 1000)
  $stopped = 0
  if ($timedOut) {
    $stopped += Stop-OwnedProcessTree -Capture $Capture -OwnedMarker $OwnedMarker
  }

  $outputComplete = Wait-OutputTasks -Capture $Capture -TimeoutSeconds $OutputGraceSeconds
  if (-not $outputComplete) {
    $stopped += Stop-OwnedProcessTree -Capture $Capture -OwnedMarker $OwnedMarker
    $outputComplete = Wait-OutputTasks -Capture $Capture -TimeoutSeconds $OutputGraceSeconds
  }

  return [pscustomobject]@{
    Process = $process
    TimedOut = $timedOut
    ExitCode = $(if ($process.HasExited) { $process.ExitCode } else { $null })
    OutputComplete = $outputComplete
    StoppedProcessCount = $stopped
    Stdout = Get-CapturedText $Capture.StdoutTask ''
    Stderr = Get-CapturedText $Capture.StderrTask '<stderr unavailable: output pipe stayed open>'
  }
}
