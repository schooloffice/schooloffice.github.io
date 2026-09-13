# Відкриває експорти ПЛЮС (plus-exports/) у Microsoft Excel, Word і PowerPoint через COM
# та записує, що саме прочитала зовнішня програма. Потрібен встановлений Microsoft Office.
# Кожна програма працює в окремому дочірньому процесі під сторожовим тайм-аутом, щоб
# прихований діалог Office не заблокував перевірку назавжди.
param(
  [ValidateSet('all', 'excel', 'word', 'powerpoint')]
  [string]$App = 'all',
  [string]$ExportsDir = (Join-Path $PSScriptRoot 'plus-exports'),
  [string]$ResultPath = (Join-Path $PSScriptRoot 'office-reader-results.json'),
  [int]$TimeoutSeconds = 120,
  [switch]$ChildRun,
  [string]$ChildResult = ''
)

$ErrorActionPreference = 'Stop'

# Коди помилок, які Excel повертає через COM у Value2 замість значення клітинки.
$ExcelErrorCodes = @{
  -2146826281 = '#DIV/0!'; -2146826246 = '#N/A'; -2146826259 = '#NAME?'; -2146826288 = '#NULL!'
  -2146826252 = '#NUM!'; -2146826265 = '#REF!'; -2146826273 = '#VALUE!'
}

function Release-Com($object) {
  if ($null -ne $object) { [void][Runtime.InteropServices.Marshal]::ReleaseComObject($object) }
}

# Копія в тимчасову теку: Office не завжди завершує операції над файлами в синхронізованій OneDrive-теці.
function Copy-ToTemp([string]$name) {
  $dir = Join-Path ([IO.Path]::GetTempPath()) ('plus-office-check-' + [guid]::NewGuid().ToString())
  [void][IO.Directory]::CreateDirectory($dir)
  $target = Join-Path $dir $name
  [IO.File]::Copy((Join-Path $ExportsDir $name), $target, $true)
  return $target
}

function Test-Excel {
  $result = [ordered]@{ program = ''; file = 'plus-tables-formulas.xlsx'; cells = [ordered]@{}; sheets = @() }
  $excel = New-Object -ComObject Excel.Application
  try {
    $excel.Visible = $false
    $excel.DisplayAlerts = $false
    $result.program = "Microsoft Excel $($excel.Version) build $($excel.Build)"
    $book = $excel.Workbooks.Open((Copy-ToTemp 'plus-tables-formulas.xlsx'), 0, $true)
    $result.sheets = @($book.Worksheets | ForEach-Object { $_.Name })
    # Іменовані діапазони книги, як їх прочитав Excel: ім'я → RefersTo.
    $result.names = [ordered]@{}
    foreach ($definedName in $book.Names) { $result.names[$definedName.Name] = $definedName.RefersTo }
    $sheet = $book.Worksheets.Item('Дані')
    foreach ($ref in @('B2', 'B3', 'B4', 'B5', 'B6', 'B7', 'B8', 'B9', 'B10')) {
      $cell = $sheet.Range($ref)
      $value = $cell.Value2
      $isError = $value -is [int] -and $ExcelErrorCodes.ContainsKey($value)
      $result.cells[$ref] = [ordered]@{
        formula = $cell.Formula
        value = if ($isError) { $ExcelErrorCodes[$value] } else { $value }
        type = if ($null -eq $value) { 'empty' } elseif ($isError) { 'Error' } else { $value.GetType().Name }
      }
    }
    $book.Close($false)
    Release-Com $sheet; Release-Com $book
  } finally {
    $excel.Quit()
    Release-Com $excel
  }
  return $result
}

function Test-Word {
  $result = [ordered]@{ program = ''; file = 'plus-text-formatted.docx' }
  $word = New-Object -ComObject Word.Application
  try {
    $word.Visible = $false
    $word.DisplayAlerts = 0
    $result.program = "Microsoft Word $($word.Version)"
    $doc = $word.Documents.Open((Copy-ToTemp 'plus-text-formatted.docx'), $false, $true)
    $result.paragraphs = $doc.Paragraphs.Count
    $result.tables = $doc.Tables.Count
    $result.tableRows = if ($doc.Tables.Count) { $doc.Tables.Item(1).Rows.Count } else { 0 }
    $result.firstParagraph = $doc.Paragraphs.Item(1).Range.Text.Trim()
    $result.firstParagraphStyle = $doc.Paragraphs.Item(1).Style.NameLocal
    $result.listParagraphs = $doc.ListParagraphs.Count
    $result.boldWords = @($doc.Words | Where-Object { $_.Bold -eq -1 } | ForEach-Object { $_.Text.Trim() } | Where-Object { $_ })
    $doc.Close(0)
    Release-Com $doc
  } finally {
    try { while ($word.Documents.Count -gt 0) { $word.Documents.Item(1).Close(0) } } catch { }
    # SaveChanges у Word.Quit передається за посиланням.
    try { $word.Quit([ref]0) } catch { }
    Release-Com $word
  }
  return $result
}

function Test-PowerPoint {
  $result = [ordered]@{ program = ''; files = [ordered]@{} }
  $powerPoint = New-Object -ComObject PowerPoint.Application
  try {
    $result.program = "Microsoft PowerPoint $($powerPoint.Version) build $($powerPoint.Build)"
    foreach ($name in @('plus-slides-text-shapes.pptx', 'plus-slides-local-image.pptx', 'plus-slides-table-chart-link.pptx')) {
      # ReadOnly, Untitled, WithWindow=false.
      $presentation = $powerPoint.Presentations.Open((Copy-ToTemp $name), -1, 0, 0)
      $slides = @()
      foreach ($slide in $presentation.Slides) {
        $shapes = @()
        foreach ($shape in $slide.Shapes) {
          # PowerShell 5.1 не приймає try як вираз усередині hashtable.
          $autoShapeType = $null
          try { $autoShapeType = $shape.AutoShapeType } catch { }
          $linkAction = $null
          try { $linkAction = $shape.TextFrame.TextRange.ActionSettings.Item(1).Action } catch { }
          $text = ''
          if ($shape.HasTextFrame -and $shape.TextFrame.HasText) { $text = $shape.TextFrame.TextRange.Text }
          $shapes += [ordered]@{
            type = $shape.Type
            hasTable = [bool]$shape.HasTable
            hasChart = [bool]$shape.HasChart
            text = $text
            autoShapeType = $autoShapeType
            linkAction = $linkAction
          }
        }
        $slides += [ordered]@{ index = $slide.SlideIndex; shapes = $shapes }
      }
      $result.files[$name] = [ordered]@{ slides = $slides }
      $presentation.Close()
      Release-Com $presentation
    }
  } finally {
    $powerPoint.Quit()
    Release-Com $powerPoint
  }
  return $result
}

if ($ChildRun) {
  try {
    $output = switch ($App) {
      'excel' { Test-Excel }
      'word' { Test-Word }
      'powerpoint' { Test-PowerPoint }
    }
  } catch {
    # Причину падіння повертаємо в результаті, а не губимо з кодом виходу.
    $output = [ordered]@{ error = $_.Exception.Message; line = $_.InvocationInfo.ScriptLineNumber }
  }
  [IO.File]::WriteAllText($ChildResult, ($output | ConvertTo-Json -Depth 8), [Text.UTF8Encoding]::new($false))
  return
}

$apps = if ($App -eq 'all') { @('excel', 'word', 'powerpoint') } else { @($App) }
$processNames = @{ excel = 'EXCEL'; word = 'WINWORD'; powerpoint = 'POWERPNT' }
$results = [ordered]@{ checkedAt = (Get-Date).ToString('s'); machine = $env:COMPUTERNAME }

foreach ($name in $apps) {
  $childResult = Join-Path ([IO.Path]::GetTempPath()) ("plus-office-$name-" + [guid]::NewGuid().ToString() + '.json')
  $started = Get-Date
  # Без перенаправлення stdout: з ним Office-операції через COM зависали.
  $child = Start-Process -FilePath 'powershell' -PassThru -WindowStyle Hidden -ArgumentList @(
    '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', "`"$PSCommandPath`"",
    '-App', $name, '-ChildRun', '-ChildResult', "`"$childResult`"", '-ExportsDir', "`"$ExportsDir`""
  )
  $finished = $child.WaitForExit($TimeoutSeconds * 1000)
  if ($finished -and (Test-Path -LiteralPath $childResult)) {
    $results[$name] = [IO.File]::ReadAllText($childResult, [Text.Encoding]::UTF8) | ConvertFrom-Json
    [IO.File]::Delete($childResult)
  } else {
    if (-not $child.HasExited) { Stop-Process -Id $child.Id -Force -ErrorAction SilentlyContinue }
    $results[$name] = [ordered]@{ error = "no result within $TimeoutSeconds s" }
  }
  # Office не завжди виходить після Quit у прихованому режимі: прибираємо лише процеси цієї перевірки.
  Get-Process $processNames[$name] -ErrorAction SilentlyContinue | Where-Object { $_.StartTime -ge $started.AddSeconds(-1) } | ForEach-Object { Stop-Process -Id $_.Id -Force }
}

[IO.File]::WriteAllText($ResultPath, ($results | ConvertTo-Json -Depth 10), [Text.UTF8Encoding]::new($false))
$results | ConvertTo-Json -Depth 10
