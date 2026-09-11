# Створює незалежні XLSX-файли корпусу сумісності справжнім Microsoft Excel через COM.
# Потрібен встановлений Microsoft Office (Windows). У CI не запускається: результат комітиться
# як фікстури, а версія програми записується в registry.json.
#
# DOCX-частини тут немає: у середовищі перевірки Word через COM стабільно не завершував
# SaveAs2 для документів корпусу (див. registry.json → pending). Незалежні DOCX потрібно
# створити в Word вручну або на іншій машині й додати до реєстру.
param(
  [string]$OutDir = $PSScriptRoot,
  # Необов'язковий журнал кроків: допомагає знайти COM-виклик, який чекає прихований діалог.
  [string]$ProgressLog = ''
)

$ErrorActionPreference = 'Stop'
$OutDir = (Resolve-Path -LiteralPath $OutDir).Path
$missing = [System.Reflection.Missing]::Value
$xlOpenXMLWorkbook = 51
$xlColumnClustered = 51

function Release-Com($object) {
  if ($null -ne $object) { [void][Runtime.InteropServices.Marshal]::ReleaseComObject($object) }
}

function Step([string]$message) {
  if ($ProgressLog) { Add-Content -LiteralPath $ProgressLog -Value ('{0:HH:mm:ss} {1}' -f (Get-Date), $message) -Encoding UTF8 }
}

Step 'excel: start'
$excel = New-Object -ComObject Excel.Application
try {
  $excel.Visible = $false
  $excel.DisplayAlerts = $false
  $program = "Microsoft Excel $($excel.Version) build $($excel.Build)"

  # 1. Числові, логічні й текстові формули на одному аркуші.
  $wb = $excel.Workbooks.Add()
  $ws = $wb.Worksheets.Item(1)
  $ws.Name = 'Формули'
  $ws.Range('A1').Value2 = 10
  $ws.Range('A2').Value2 = 4
  $ws.Range('A3').Value2 = 'Текст'
  $ws.Range('B1').Formula = '=A1/A2'
  $ws.Range('B2').Formula = '=A1>A2'
  $ws.Range('B3').Formula = '=IF(A1>A2,"більше","менше")'
  $ws.Range('B4').Formula = '=SUM(A1:A2)'
  $ws.Range('B5').Value2 = $true
  $wb.SaveAs((Join-Path $OutDir 'excel-formulas-types.xlsx'), $xlOpenXMLWorkbook)
  $wb.Close($false)
  Release-Com $ws; Release-Com $wb
  Step 'excel: formulas saved'

  # 2. Два аркуші з міжаркушевими формулами.
  $wb = $excel.Workbooks.Add()
  while ($wb.Worksheets.Count -lt 2) { [void]$wb.Worksheets.Add($missing, $wb.Worksheets.Item($wb.Worksheets.Count)) }
  $data = $wb.Worksheets.Item(1)
  $totals = $wb.Worksheets.Item(2)
  $data.Name = 'Дані'
  $totals.Name = 'Підсумок'
  $data.Range('A1').Value2 = 'Учень'
  $data.Range('B1').Value2 = 'Бал'
  $data.Range('A2').Value2 = 'Олена'
  $data.Range('B2').Value2 = 11
  $data.Range('A3').Value2 = 'Тарас'
  $data.Range('B3').Value2 = 9
  $totals.Range('A1').Value2 = 'Разом'
  $totals.Range('B1').Formula = '=SUM(Дані!B2:B3)'
  $totals.Range('A2').Value2 = 'Максимум'
  $totals.Range('B2').Formula = '=MAX(Дані!B2:B3)'
  $wb.SaveAs((Join-Path $OutDir 'excel-two-sheets.xlsx'), $xlOpenXMLWorkbook)
  $wb.Close($false)
  Release-Com $data; Release-Com $totals; Release-Com $wb
  Step 'excel: two sheets saved'

  # 3. Оформлення, числовий формат, дата, ширина колонки й діаграма.
  $wb = $excel.Workbooks.Add()
  $ws = $wb.Worksheets.Item(1)
  $ws.Name = 'Оформлення'
  $ws.Range('A1').Value2 = 'Місяць'
  $ws.Range('B1').Value2 = 'Оцінка'
  $ws.Range('A1:B1').Font.Bold = $true
  $ws.Range('A1:B1').Interior.Color = 0x99FFFF
  $ws.Range('A2').Value2 = 'Вересень'
  $ws.Range('B2').Value2 = 10.5
  $ws.Range('A3').Value2 = 'Жовтень'
  $ws.Range('B3').Value2 = 11.25
  # Формат задаємо локальними кодами самого Excel: COM з PowerShell 5.1 не приймає
  # англійський '0.00' в українській локалі.
  $decimal = $excel.International(3)
  $day = $excel.International(21)
  $month = $excel.International(20)
  $year = $excel.International(19)
  $ws.Range('B2:B3').NumberFormatLocal = "0${decimal}00"
  $ws.Range('C2').Formula = '=DATE(2026,9,1)'
  $ws.Range('C2').NumberFormatLocal = "$($day * 2).$($month * 2).$($year * 4)"
  $ws.Columns.Item(1).ColumnWidth = 20
  $chartObject = $ws.ChartObjects().Add(220, 40, 300, 200)
  $chartObject.Chart.SetSourceData($ws.Range('A1:B3'))
  $chartObject.Chart.ChartType = $xlColumnClustered
  $wb.SaveAs((Join-Path $OutDir 'excel-formatting-chart.xlsx'), $xlOpenXMLWorkbook)
  $wb.Close($false)
  Release-Com $chartObject; Release-Com $ws; Release-Com $wb
  Step 'excel: formatting and chart saved'
} finally {
  $excel.Quit()
  Release-Com $excel
  [GC]::Collect()
  [GC]::WaitForPendingFinalizers()
}

Step "done: $program"
$program
