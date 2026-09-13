# Створює незалежні PPTX-файли корпусу для пілота PPTX Import Lite справжнім Microsoft PowerPoint
# через COM. Потрібен встановлений Microsoft Office (Windows). У CI не запускається: результат
# комітиться як фікстури, а версія програми записується в registry.json.
#
# Прості файли перевіряють підтримувану підмножину (порядок і розмір слайдів, фон, текстові runs,
# прямокутник/овал, вбудовані PNG/JPEG, прямі перетворення). Складні містять відомі непідтримувані
# об'єкти, для яких імпорт має назвати точні втрати.
param(
  [string]$OutDir = $PSScriptRoot,
  # Необов'язкова тека для PNG-рендерів слайдів самим PowerPoint (для оцінки точності імпорту).
  [string]$RenderDir = '',
  # Необов'язковий журнал кроків: допомагає знайти COM-виклик, який чекає прихований діалог.
  [string]$ProgressLog = ''
)

$ErrorActionPreference = 'Stop'
$OutDir = (Resolve-Path -LiteralPath $OutDir).Path
Add-Type -AssemblyName System.Drawing

$msoTrue = -1
$msoFalse = 0
$ppLayoutTitle = 1
$ppLayoutText = 2
$ppLayoutBlank = 12
$ppSaveAsOpenXMLPresentation = 24
$ppRDIAll = 99
$msoShapeRectangle = 1
$msoShapeOval = 9
$msoShape5pointStar = 92
$msoTextOrientationHorizontal = 1
$msoFlipHorizontal = 0
$msoGradientHorizontal = 1
$ppEffectFade = 1793
$msoAnimEffectFade = 10
$ppMouseClick = 1

function Release-Com($object) {
  if ($null -ne $object) { [void][Runtime.InteropServices.Marshal]::ReleaseComObject($object) }
}

function Step([string]$message) {
  if ($ProgressLog) { Add-Content -LiteralPath $ProgressLog -Value ('{0:HH:mm:ss} {1}' -f (Get-Date), $message) -Encoding UTF8 }
}

# COM-колір PowerPoint — ціле BGR.
function Rgb([int]$r, [int]$g, [int]$b) { return $r + ($g * 256) + ($b * 65536) }

# Невелике растрове зображення без зовнішніх ресурсів: смуги й коло.
function New-TestImage([string]$path, [System.Drawing.Imaging.ImageFormat]$format, [System.Drawing.Color]$accent) {
  $bitmap = New-Object System.Drawing.Bitmap 240, 160
  $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
  try {
    $graphics.Clear([System.Drawing.Color]::White)
    $brush = New-Object System.Drawing.SolidBrush $accent
    $graphics.FillRectangle($brush, 0, 0, 240, 40)
    $graphics.FillEllipse($brush, 80, 60, 80, 80)
    $brush.Dispose()
    $bitmap.Save($path, $format)
  } finally {
    $graphics.Dispose()
    $bitmap.Dispose()
  }
}

# Нейтральна тека: шлях пов'язаного зображення потрапляє у файл, тож він не містить імені користувача.
$workDir = 'C:\plus-pptx-fixtures'
New-Item -ItemType Directory -Force -Path $workDir | Out-Null
$pngPath = Join-Path $workDir 'plus-chart.png'
$jpegPath = Join-Path $workDir 'plus-photo.jpg'
$linkedPath = Join-Path $workDir 'plus-linked.png'
New-TestImage $pngPath ([System.Drawing.Imaging.ImageFormat]::Png) ([System.Drawing.Color]::FromArgb(37, 99, 235))
New-TestImage $jpegPath ([System.Drawing.Imaging.ImageFormat]::Jpeg) ([System.Drawing.Color]::FromArgb(22, 163, 74))
New-TestImage $linkedPath ([System.Drawing.Imaging.ImageFormat]::Png) ([System.Drawing.Color]::FromArgb(220, 38, 38))

function Save-Presentation($pres, [string]$name) {
  # Прибрати автора, останнього редактора й інші персональні дані до збереження.
  $pres.RemoveDocumentInformation($ppRDIAll)
  $pres.SaveAs((Join-Path $OutDir $name), $ppSaveAsOpenXMLPresentation)
  if ($RenderDir) {
    New-Item -ItemType Directory -Force -Path $RenderDir | Out-Null
    $base = [IO.Path]::GetFileNameWithoutExtension($name)
    $width = [int]$pres.PageSetup.SlideWidth
    $height = [int]$pres.PageSetup.SlideHeight
    for ($index = 1; $index -le $pres.Slides.Count; $index++) {
      $pres.Slides.Item($index).Export((Join-Path $RenderDir "$base-$index.png"), 'PNG', $width, $height)
    }
  }
  $pres.Close()
  Step "saved $name"
}

Step 'powerpoint: start'
$app = New-Object -ComObject PowerPoint.Application
try {
  $program = "Microsoft PowerPoint $($app.Version) build $($app.Build)"

  # 1. Простий: титульний слайд із placeholder-ами макета й слайд із фігурами, текстовими runs і фоном.
  $pres = $app.Presentations.Add($msoFalse)
  $slide = $pres.Slides.Add(1, $ppLayoutTitle)
  $slide.Shapes.Placeholders.Item(1).TextFrame.TextRange.Text = 'Кругообіг води'
  $slide.Shapes.Placeholders.Item(2).TextFrame.TextRange.Text = 'Урок природознавства'
  $slide = $pres.Slides.Add(2, $ppLayoutBlank)
  $slide.FollowMasterBackground = $msoFalse
  $slide.Background.Fill.Solid()
  $slide.Background.Fill.ForeColor.RGB = (Rgb 239 246 255)
  $rect = $slide.Shapes.AddShape($msoShapeRectangle, 60, 80, 300, 160)
  $rect.Fill.ForeColor.RGB = (Rgb 254 243 199)
  $rect.Line.ForeColor.RGB = (Rgb 180 83 9)
  $rect.TextFrame.TextRange.Text = 'Випаровування'
  $oval = $slide.Shapes.AddShape($msoShapeOval, 480, 80, 220, 220)
  $oval.Fill.ForeColor.RGB = (Rgb 191 219 254)
  $oval.TextFrame.TextRange.Text = 'Хмара'
  $box = $slide.Shapes.AddTextbox($msoTextOrientationHorizontal, 60, 340, 640, 80)
  $box.TextFrame.TextRange.Text = 'Вода нагрівається і стає парою'
  $box.TextFrame.TextRange.Font.Size = 28
  $box.TextFrame.TextRange.Characters(1, 4).Font.Bold = $msoTrue
  Save-Presentation $pres 'powerpoint-simple-title-shapes.pptx'
  Release-Com $box; Release-Com $oval; Release-Com $rect; Release-Com $slide; Release-Com $pres

  # 2. Простий: вбудовані PNG і JPEG, підпис, повернуте й обрізане зображення на другому слайді.
  $pres = $app.Presentations.Add($msoFalse)
  $slide = $pres.Slides.Add(1, $ppLayoutBlank)
  $png = $slide.Shapes.AddPicture($pngPath, $msoFalse, $msoTrue, 60, 60, 360, 240)
  $jpeg = $slide.Shapes.AddPicture($jpegPath, $msoFalse, $msoTrue, 520, 60, 360, 240)
  $caption = $slide.Shapes.AddTextbox($msoTextOrientationHorizontal, 60, 360, 820, 60)
  $caption.TextFrame.TextRange.Text = 'Графік і фото з уроку'
  $caption.TextFrame.TextRange.ParagraphFormat.Alignment = 2
  $slide = $pres.Slides.Add(2, $ppLayoutBlank)
  $rotated = $slide.Shapes.AddPicture($pngPath, $msoFalse, $msoTrue, 300, 120, 360, 240)
  $rotated.Rotation = 15
  $rotated.PictureFormat.CropLeft = 24
  Save-Presentation $pres 'powerpoint-simple-images.pptx'
  Release-Com $rotated; Release-Com $caption; Release-Com $jpeg; Release-Com $png; Release-Com $slide; Release-Com $pres

  # 3. Простий: формат 4:3, макет «Заголовок і вміст» з маркованим списком і повернутий прямокутник.
  $pres = $app.Presentations.Add($msoFalse)
  $pres.PageSetup.SlideWidth = 720
  $pres.PageSetup.SlideHeight = 540
  $slide = $pres.Slides.Add(1, $ppLayoutText)
  $slide.Shapes.Placeholders.Item(1).TextFrame.TextRange.Text = 'Стани води'
  $body = $slide.Shapes.Placeholders.Item(2).TextFrame.TextRange
  $body.Text = "Лід`rВода`rПара"
  $body.Paragraphs(2).Font.Underline = $msoTrue
  $turned = $slide.Shapes.AddShape($msoShapeRectangle, 480, 360, 160, 90)
  $turned.Rotation = 30
  $turned.Fill.ForeColor.RGB = (Rgb 220 252 231)
  Save-Presentation $pres 'powerpoint-simple-4x3-bullets.pptx'
  Release-Com $turned; Release-Com $slide; Release-Com $pres

  # 4. Складний: група, таблиця, довільна фігура, зірка, градієнтний фон, перехід і анімація.
  $pres = $app.Presentations.Add($msoFalse)
  $slide = $pres.Slides.Add(1, $ppLayoutBlank)
  $slide.FollowMasterBackground = $msoFalse
  $slide.Background.Fill.TwoColorGradient($msoGradientHorizontal, 1)
  $slide.Background.Fill.ForeColor.RGB = (Rgb 255 255 255)
  $slide.Background.Fill.BackColor.RGB = (Rgb 219 234 254)
  $first = $slide.Shapes.AddShape($msoShapeRectangle, 40, 40, 160, 80)
  $first.Name = 'GroupA'
  $second = $slide.Shapes.AddShape($msoShapeOval, 220, 40, 80, 80)
  $second.Name = 'GroupB'
  $group = $slide.Shapes.Range([object[]]@('GroupA', 'GroupB')).Group()
  $table = $slide.Shapes.AddTable(2, 2, 40, 180, 400, 120)
  $table.Table.Cell(1, 1).Shape.TextFrame.TextRange.Text = 'Місяць'
  $table.Table.Cell(1, 2).Shape.TextFrame.TextRange.Text = 'Опади'
  # SmartArtLayouts через COM із PowerShell повертає null, тож непідтримувану геометрію дає довільна фігура.
  $builder = $slide.Shapes.BuildFreeform(0, 480, 200)
  $builder.AddNodes(0, 0, 700, 200)
  $builder.AddNodes(0, 0, 620, 380)
  $builder.AddNodes(0, 0, 480, 200)
  $freeform = $builder.ConvertToShape()
  $star = $slide.Shapes.AddShape($msoShape5pointStar, 700, 30, 120, 120)
  $note = $slide.Shapes.AddTextbox($msoTextOrientationHorizontal, 40, 440, 600, 50)
  $note.TextFrame.TextRange.Text = 'Складний слайд'
  $slide.SlideShowTransition.EntryEffect = $ppEffectFade
  [void]$slide.TimeLine.MainSequence.AddEffect($note, $msoAnimEffectFade)
  Save-Presentation $pres 'powerpoint-complex-group-table-freeform.pptx'
  Release-Com $note; Release-Com $star; Release-Com $freeform; Release-Com $builder; Release-Com $table; Release-Com $group
  Release-Com $second; Release-Com $first; Release-Com $slide; Release-Com $pres

  # 5. Складний: гіперпосилання, нотатки, лінія, віддзеркалене зображення, змішане форматування
  #    й пов'язане (зовнішнє) зображення.
  $pres = $app.Presentations.Add($msoFalse)
  $slide = $pres.Slides.Add(1, $ppLayoutBlank)
  $mixed = $slide.Shapes.AddTextbox($msoTextOrientationHorizontal, 40, 40, 700, 80)
  $mixed.TextFrame.TextRange.Text = 'Докладніше на сайті'
  $mixed.TextFrame.TextRange.Font.Size = 24
  $mixed.TextFrame.TextRange.Characters(13, 7).Font.Size = 36
  $mixed.TextFrame.TextRange.Characters(13, 7).Font.Color.RGB = (Rgb 220 38 38)
  $mixed.TextFrame.TextRange.Characters(13, 7).ActionSettings($ppMouseClick).Hyperlink.Address = 'https://example.com/'
  $line = $slide.Shapes.AddLine(40, 160, 600, 160)
  $flipped = $slide.Shapes.AddPicture($pngPath, $msoFalse, $msoTrue, 40, 200, 300, 200)
  $flipped.Flip($msoFlipHorizontal)
  $linked = $slide.Shapes.AddPicture($linkedPath, $msoTrue, $msoFalse, 400, 200, 300, 200)
  $slide.NotesPage.Shapes.Placeholders.Item(2).TextFrame.TextRange.Text = 'Нагадати про домашнє завдання'
  Save-Presentation $pres 'powerpoint-complex-links-notes-linked-image.pptx'
  Release-Com $linked; Release-Com $flipped; Release-Com $line; Release-Com $mixed; Release-Com $slide; Release-Com $pres
} catch {
  Step "error at line $($_.InvocationInfo.ScriptLineNumber): $($_.Exception.Message)"
  throw
} finally {
  $app.Quit()
  Release-Com $app
  [GC]::Collect()
  [GC]::WaitForPendingFinalizers()
  Remove-Item -LiteralPath $workDir -Recurse -Force -ErrorAction SilentlyContinue
}

Step "done: $program"
$program
