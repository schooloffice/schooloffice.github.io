param(
  [string]$Root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
)

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new()

$services = @(
  @{ Key = 'text'; Path = 'text'; Menu = @('file', 'edit', 'insert', 'view', 'help'); ActionFiles = @('text/ui/menu.js'); CommandFiles = @('text/js/app.js'); FilePickerFiles = @('text/ui/menu.js', 'text/ui/editor.js'); OptionalIds = @() },
  @{ Key = 'tables'; Path = 'tables'; Menu = @('file', 'edit', 'insert', 'format', 'data', 'view', 'help'); ActionFiles = @('tables/js/ui.js'); CommandFiles = @('tables/js/app.js'); FilePickerFiles = @('tables/js/ui.js', 'tables/js/workbook-file.js', 'tables/js/xlsx-file.js'); OptionalIds = @('header') },
  @{ Key = 'paint'; Path = 'paint'; Menu = @('file', 'edit', 'view', 'help'); ActionFiles = @('paint/js/app.js'); CommandFiles = @('paint/js/app.js'); FilePickerFiles = @('paint/js/document.js'); OptionalIds = @() },
  @{ Key = 'slides'; Path = 'slides'; Menu = @('file', 'edit', 'insert', 'slide', 'view', 'help'); ActionFiles = @('slides/js/app.js'); CommandFiles = @('slides/js/app.js'); FilePickerFiles = @('slides/js/app.js'); OptionalIds = @('imageAltField', 'altEditField', 'pickImageFile', 'linkUrlField', 'linkSlideField', 'linkError', 'actionTargetField', 'actionStartHiddenField', 'actionError','tableRowsField', 'tableColsField', 'tableHeaderField', 'tableStyleField', 'tableResizeWarning', 'tableResizeConfirmField', 'tableCellFillField', 'tableCellColorField', 'tableCellAlignField', 'tableCellVAlignField', 'tableCellBoldField', 'tableCellClearField', 'tableApplyFillField', 'tableApplyColorField', 'tableApplyAlignField', 'tableApplyVAlignField', 'tableApplyBoldField', 'tableRowWeightField', 'tableColumnWeightField', 'chartTypeField', 'chartTitleField', 'chartLegendField', 'chartDataField', 'chartError', 'transitionType', 'transitionDuration', 'transitionApplyAll') },
  @{ Key = 'flowcharts'; Path = 'flowcharts'; Menu = @('file', 'edit', 'insert', 'view', 'help'); ActionFiles = @('flowcharts/js/editor.js', 'flowcharts/js/menu-actions.js'); CommandFiles = @('flowcharts/js/editor.js', 'flowcharts/js/project-io.js', 'flowcharts/js/menu-actions.js'); FilePickerFiles = @('flowcharts/js/editor.js', 'flowcharts/js/project-io.js'); OptionalIds = @('delete-button', 'help-button') },
  @{ Key = 'vector'; Path = 'vector'; Menu = @('file', 'edit', 'insert', 'format', 'help'); ActionFiles = @('vector/js/app.js'); CommandFiles = @('vector/js/app.js'); FilePickerFiles = @('vector/js/app.js'); OptionalIds = @() }
)

$requiredRootFiles = @(
  'OFFICE_UI_STANDARD.md',
  'UI_INTEGRATION_GUIDE.md',
  'UI_TOKENS.css',
  'shell-overrides.css',
  'design-tokens.json',
  'SERVICE_THEME_MAP.json',
  'KEYBOARD_SHORTCUTS.md',
  'WORKSPACE_ACCESSIBILITY.md',
  'MODAL_STANDARD.md',
  'DROPDOWN_STANDARD.md',
  'CONTEXTUAL_UI_STANDARD.md',
  'PILOT_READINESS.md',
  'COMPONENT_CHECKLIST.md',
  'CHANGELOG.md',
  'CHANGELOG_STANDARD.md',
  'LICENSE',
  'THIRD_PARTY_NOTICES.md',
  'office-storage.js',
  'landing.js',
  'text/core/storage.js',
  'tables/js/grid-viewport.js',
  'office-shell.js',
  'office-ui.js',
  'offline.js',
  'sw.js',
  'tests/offline-smoke.html',
  'tests/run-offline-smoke.ps1',
  'tests/test-process-helpers.ps1',
  'tests/responsive-smoke.html'
)

$failures = New-Object System.Collections.Generic.List[string]
$warnings = New-Object System.Collections.Generic.List[string]

function Assert-True {
  param([bool]$Condition, [string]$Message)
  if (-not $Condition) { $script:failures.Add($Message) }
}

function Add-Warning {
  param([string]$Message)
  $script:warnings.Add($Message)
}

function Assert-CommandOrder {
  param(
    [string]$Html,
    [string]$ServicePath
  )

  $requiredCommands = @('new', 'open', 'save', 'undo', 'redo')
  $lastIndex = -1
  foreach ($command in $requiredCommands) {
    $match = [regex]::Match($Html, "data-office-command=""$command""")
    Assert-True $match.Success "${ServicePath}: toolbar is missing standard command marker: $command"
    if ($match.Success) {
      Assert-True ($match.Index -gt $lastIndex) "${ServicePath}: standard toolbar command order is wrong near: $command"
      $lastIndex = $match.Index
    }
  }
}

function Get-HtmlAttribute {
  param(
    [string]$Tag,
    [string]$Name
  )

  $match = [regex]::Match($Tag, "\s$([regex]::Escape($Name))=""([^""]+)""")
  if ($match.Success) { return $match.Groups[1].Value }
  return $null
}

function Get-ServiceActionSource {
  param([hashtable]$Service)

  $source = ''
  foreach ($actionFile in $Service.ActionFiles) {
    $actionPath = Join-Path $Root $actionFile
    Assert-True (Test-Path $actionPath) "$($Service.Path): action dispatcher file is missing: $actionFile"
    if (Test-Path $actionPath) {
      $source += "`n" + (Get-Content -Raw -Encoding UTF8 $actionPath)
    }
  }
  return $source
}

function Assert-SaveCommandContract {
  param(
    [hashtable]$Service,
    [string]$Html,
    [string]$ActionSource
  )

  $saveButtons = [regex]::Matches($Html, '<button\b(?=[^>]*data-office-command="save")[^>]*>')
  Assert-True ($saveButtons.Count -eq 1) "$($Service.Path): expected exactly one toolbar button with data-office-command=""save"""
  if ($saveButtons.Count -ne 1) { return }

  $saveTag = $saveButtons[0].Value
  $action = Get-HtmlAttribute $saveTag 'data-action'
  $menuAction = Get-HtmlAttribute $saveTag 'data-menu-action'
  $buttonId = Get-HtmlAttribute $saveTag 'id'
  $handledActions = Get-RegexGroupValues $ActionSource 'case\s+[''"]([^''"]+)[''"]'

  if ($action) {
    Assert-True ($handledActions -contains $action) "$($Service.Path): Save toolbar data-action has no dispatcher case: $action"
    return
  }

  if ($menuAction) {
    Assert-True ($handledActions -contains $menuAction) "$($Service.Path): Save toolbar data-menu-action has no dispatcher case: $menuAction"
    return
  }

  if ($Service.SaveDirectPattern) {
    Assert-True ($ActionSource -match $Service.SaveDirectPattern) "$($Service.Path): Save toolbar button uses direct binding, but the expected click listener was not found"
    return
  }

  Assert-True $false "$($Service.Path): Save toolbar button must use data-action, data-menu-action, or an explicit SaveDirectPattern contract$(if ($buttonId) { " (id: $buttonId)" } else { '' })"
}

function Get-CommandActionFromButtonTag {
  param([string]$Tag)

  foreach ($attribute in @('data-action', 'data-menu-action', 'data-history-action')) {
    $value = Get-HtmlAttribute $Tag $attribute
    if ($value) { return $value }
  }
  return $null
}

function Assert-MenuToolbarCommandParity {
  param(
    [hashtable]$Service,
    [string]$Html
  )

  foreach ($command in @('new', 'open', 'save', 'undo', 'redo')) {
    $toolbarMatches = [regex]::Matches($Html, "<button\b(?=[^>]*data-office-command=""$command"")[^>]*>")
    Assert-True ($toolbarMatches.Count -eq 1) "$($Service.Path): expected exactly one toolbar button for standard command: $command"
    if ($toolbarMatches.Count -ne 1) { continue }

    $toolbarAction = Get-CommandActionFromButtonTag $toolbarMatches[0].Value
    Assert-True (!!$toolbarAction) "$($Service.Path): toolbar command $command must expose data-action, data-menu-action, or data-history-action"
    if (!$toolbarAction) { continue }

    $menuPattern = "<button\b(?=[^>]*class=""[^""]*\bmenu-item\b)(?=[^>]*data-action=""$([regex]::Escape($toolbarAction))"")[^>]*>"
    Assert-True ([regex]::IsMatch($Html, $menuPattern)) "$($Service.Path): toolbar command $command uses '$toolbarAction', but no matching main-menu item was found"
  }
}

function Assert-CommandAdapterContract {
  param([hashtable]$Service)

  $source = ''
  foreach ($commandFile in $Service.CommandFiles) {
    $commandPath = Join-Path $Root $commandFile
    Assert-True (Test-Path $commandPath) "$($Service.Path): command adapter file is missing: $commandFile"
    if (Test-Path $commandPath) {
      $source += "`n" + (Get-Content -Raw -Encoding UTF8 $commandPath)
    }
  }

  Assert-True ($source -match 'Office(?:UI|Shell)\?*\.registerCommands\?*\.') "$($Service.Path): must register standard commands through OfficeUI.registerCommands or OfficeShell.registerCommands"
  foreach ($command in @('new', 'open', 'save', 'undo', 'redo')) {
    Assert-True ($source -match "(^|[\{\s,])$command\s*:") "$($Service.Path): OfficeUI.registerCommands must expose command: $command"
    $routingPattern = "(?:Office(?:UI|Shell)\?*\.runCommand\?*\.?\(|runOfficeCommand\()[\s\S]{0,90}['""]$command['""]"
    Assert-True ($source -match $routingPattern) "$($Service.Path): standard command entry points should route $command through OfficeUI.runCommand or OfficeShell.runCommand"
  }
}

function Assert-FilePickerContract {
  param([hashtable]$Service)

  $source = ''
  foreach ($filePickerFile in $Service.FilePickerFiles) {
    $filePickerPath = Join-Path $Root $filePickerFile
    Assert-True (Test-Path $filePickerPath) "$($Service.Path): file picker adapter file is missing: $filePickerFile"
    if (Test-Path $filePickerPath) {
      $source += "`n" + (Get-Content -Raw -Encoding UTF8 $filePickerPath)
    }
  }

  Assert-True ($source -match 'Office(?:UI|Shell)\?*\.openFilePicker\?*\.') "$($Service.Path): file-open entry points should use OfficeUI.openFilePicker or OfficeShell.openFilePicker"
}

function Assert-StylesheetOrder {
  param(
    [string]$Html,
    [string]$ServicePath
  )

  $tokens = [regex]::Matches($Html, 'href="\.\./UI_TOKENS\.css"')
  $local = [regex]::Matches($Html, 'href="style\.css"')
  $overrides = [regex]::Matches($Html, 'href="\.\./shell-overrides\.css"')
  Assert-True ($tokens.Count -eq 1) "${ServicePath}: UI_TOKENS.css should be linked exactly once"
  Assert-True ($local.Count -eq 1) "${ServicePath}: local style.css should be linked exactly once"
  Assert-True ($overrides.Count -eq 1) "${ServicePath}: shell-overrides.css should be linked exactly once"
  if ($tokens.Count -eq 1 -and $local.Count -eq 1 -and $overrides.Count -eq 1) {
    Assert-True ($tokens[0].Index -lt $local[0].Index) "${ServicePath}: UI_TOKENS.css must load before local style.css"
    Assert-True ($local[0].Index -lt $overrides[0].Index) "${ServicePath}: shell-overrides.css must load after local style.css"
  }
}

function Get-RegexGroupValues {
  param([string]$Content, [string]$Pattern)
  [regex]::Matches($Content, $Pattern) |
    ForEach-Object { $_.Groups[1].Value } |
    Sort-Object -Unique
}

function Get-FirstMatchedGroupValue {
  param([System.Text.RegularExpressions.Match]$Match)
  for ($i = 1; $i -lt $Match.Groups.Count; $i++) {
    if ($Match.Groups[$i].Success) { return $Match.Groups[$i].Value }
  }
  return $null
}

function Test-ExternalOrVirtualPath {
  param([string]$Path)
  return $Path -match '^(?:https?:|mailto:|tel:|data:|blob:|#|/)' -or $Path -eq ''
}

function Assert-CspBaseline {
  param(
    [string]$Html,
    [string]$PathLabel
  )

  $match = [regex]::Match($Html, '<meta\s+http-equiv="Content-Security-Policy"\s+content="([^"]+)"')
  Assert-True $match.Success "${PathLabel}: production HTML must declare a Content-Security-Policy meta tag"
  if (-not $match.Success) { return }

  $policy = $match.Groups[1].Value
  foreach ($directive in @(
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "frame-ancestors 'none'",
    "form-action 'self'",
    "worker-src 'self' blob:"
  )) {
    Assert-True ($policy.Contains($directive)) "${PathLabel}: CSP is missing directive: $directive"
  }
  Assert-True ($policy -notmatch "script-src[^;]*'unsafe-inline'") "${PathLabel}: CSP must not allow inline scripts"
  Assert-True ($policy -notmatch 'connect-src[^;]*https:') "${PathLabel}: CSP must not allow arbitrary HTTPS connections"
}

function Assert-BlankLinksAreIsolated {
  param(
    [string]$Html,
    [string]$PathLabel
  )

  $blankLinks = [regex]::Matches($Html, '<a\b(?=[^>]*\starget="_blank")[^>]*>')
  foreach ($link in $blankLinks) {
    $tag = $link.Value
    $rel = Get-HtmlAttribute $tag 'rel'
    Assert-True ($rel -and $rel -match '(^|\s)noopener(\s|$)' -and $rel -match '(^|\s)noreferrer(\s|$)') "${PathLabel}: target=""_blank"" link must use rel=""noopener noreferrer"": $tag"
  }
}

function Assert-ProductionHtmlSecurityBaseline {
  param(
    [string]$Html,
    [string]$PathLabel
  )

  Assert-CspBaseline $Html $PathLabel
  Assert-BlankLinksAreIsolated $Html $PathLabel
  Assert-True ($Html -notmatch '\bhref\s*=\s*["'']javascript:') "${PathLabel}: production HTML must not use javascript: links"
  Assert-True ($Html -notmatch '<script(?![^>]*\bsrc=)[^>]*>[\s\S]*?</script>') "${PathLabel}: inline scripts must be moved to local JavaScript files"
}

function Assert-LocalHtmlAssetsExist {
  param(
    [string]$Html,
    [string]$IndexPath,
    [string]$ServicePath
  )

  $serviceRoot = Split-Path -Parent $IndexPath
  $assetMatches = [regex]::Matches($Html, '<(?:script|link|img|source)\b[^>]*(?:src|href)="([^"]+)"')
  foreach ($match in $assetMatches) {
    $assetPath = $match.Groups[1].Value
    if (Test-ExternalOrVirtualPath $assetPath) { continue }
    $assetPathWithoutQuery = ($assetPath -split '[?#]', 2)[0]
    $resolved = Join-Path $serviceRoot $assetPathWithoutQuery
    Assert-True (Test-Path $resolved) "${ServicePath}: local asset path does not exist: $assetPath"
  }
}

function Get-LocalHtmlAssetPaths {
  param(
    [string]$Html,
    [string]$IndexPath
  )

  $htmlRoot = Split-Path -Parent $IndexPath
  $assetMatches = [regex]::Matches($Html, '<(?:script|link|img|source)\b[^>]*(?:src|href)="([^"]+)"')
  foreach ($match in $assetMatches) {
    $assetPath = $match.Groups[1].Value
    if (Test-ExternalOrVirtualPath $assetPath) { continue }

    $assetPathWithoutQuery = ($assetPath -split '[?#]', 2)[0]
    $resolved = [IO.Path]::GetFullPath((Join-Path $htmlRoot $assetPathWithoutQuery))
    if (-not $resolved.StartsWith($Root, [StringComparison]::OrdinalIgnoreCase)) { continue }
    if (-not (Test-Path $resolved -PathType Leaf)) { continue }

    $relative = $resolved.Substring($Root.Length).TrimStart('\', '/').Replace('\', '/')
    "./$relative"
  }
}

function Assert-StaticIdReferencesExist {
  param(
    [string]$Html,
    [string]$ServiceRoot,
    [string]$ServicePath,
    [string[]]$OptionalIds
  )

  $ids = Get-RegexGroupValues $Html '\sid="([^"]+)"'
  $optional = @($OptionalIds)
  $scriptFiles = Get-ChildItem -Path $ServiceRoot -Recurse -File -Include '*.js'
  $idPattern = 'getElementById\([''"]([^''"]+)[''"]\)|\$\([''"]#([^''"]+)[''"]\)|utils\.\$\([''"]([^''"]+)[''"]\)'

  foreach ($scriptFile in $scriptFiles) {
    $relativePath = $scriptFile.FullName.Substring($Root.Length).TrimStart('\', '/').Replace('\', '/')
    $content = Get-Content -Raw -Encoding UTF8 $scriptFile.FullName
    $refs = [regex]::Matches($content, $idPattern) |
      ForEach-Object { Get-FirstMatchedGroupValue $_ } |
      Where-Object { $_ } |
      Sort-Object -Unique

    foreach ($ref in $refs) {
      if ($optional -contains $ref) { continue }
      Assert-True ($ids -contains $ref) "${relativePath}: static id reference has no matching HTML id: $ref"
    }
  }
}

function Assert-ServiceWorkerPrecache {
  param([string]$ServiceWorkerContent)

  $precacheAssets = [regex]::Matches($ServiceWorkerContent, "['""](\./[^'""]+)['""]") |
    ForEach-Object { $_.Groups[1].Value } |
    Where-Object { $_ -ne './__offline_status__' } |
    Sort-Object -Unique

  foreach ($asset in $precacheAssets) {
    $localPath = Join-Path $Root ($asset.Substring(2) -replace '/', [IO.Path]::DirectorySeparatorChar)
    Assert-True (Test-Path $localPath) "sw.js: precache asset does not exist: $asset"
  }

  $requiredAssets = New-Object System.Collections.Generic.HashSet[string]
  foreach ($asset in @(
    './index.html',
    './landing.js',
    './office-storage.js',
    './office-shell.js',
    './office-ui.js',
    './offline.js',
    './UI_TOKENS.css',
    './shell-overrides.css',
    './design-tokens.json',
    './SERVICE_THEME_MAP.json'
  )) {
    [void]$requiredAssets.Add($asset)
  }

  foreach ($service in $services) {
    [void]$requiredAssets.Add("./$($service.Path)/index.html")
    $indexPath = Join-Path (Join-Path $Root $service.Path) 'index.html'
    if (-not (Test-Path $indexPath)) { continue }
    $html = Get-Content -Raw -Encoding UTF8 $indexPath
    foreach ($asset in Get-LocalHtmlAssetPaths $html $indexPath) {
      [void]$requiredAssets.Add($asset)
    }
  }

  foreach ($asset in $requiredAssets) {
    Assert-True ($precacheAssets -contains $asset) "sw.js: named offline asset groups are missing required local asset: $asset"
  }
}

foreach ($file in $requiredRootFiles) {
  Assert-True (Test-Path (Join-Path $Root $file)) "Missing required root standard file: $file"
}

$html2PdfLicensePath = Join-Path $Root 'vendor/html2pdf/html2pdf.bundle.min.js.LICENSE.txt'
Assert-True (Test-Path $html2PdfLicensePath) "vendor/html2pdf: missing companion LICENSE notice referenced by html2pdf.bundle.min.js"

$productionJsFiles = Get-ChildItem -Path $Root -Recurse -File -Include '*.js' |
  Where-Object {
    $_.FullName -notmatch '\\vendor\\' -and
    $_.FullName -notmatch '\\tests\\'
  }

$innerHtmlBaseline = 92
$innerHtmlCount = 0
foreach ($jsFile in $productionJsFiles) {
  $relativePath = $jsFile.FullName.Substring($Root.Length).TrimStart('\', '/').Replace('\', '/')
  $content = Get-Content -Raw -Encoding UTF8 $jsFile.FullName
  $fileInnerHtmlCount = [regex]::Matches($content, '\binnerHTML\b').Count
  if ($fileInnerHtmlCount -gt 0) {
    Add-Warning "${relativePath}: contains $fileInnerHtmlCount innerHTML reference(s); keep reducing this security debt"
  }
  $innerHtmlCount += $fileInnerHtmlCount
}

Assert-True ($innerHtmlCount -le $innerHtmlBaseline) "production JS innerHTML baseline increased: $innerHtmlCount > $innerHtmlBaseline"

$normativeDocFiles = @(
  'README.md',
  'UI_INTEGRATION_GUIDE.md',
  'COMPONENT_CHECKLIST.md',
  'APP_SHELL.html',
  'SHELL_COMPONENTS.md',
  'SERVICE_SHELL_BLUEPRINTS.md',
  'WORKSPACE_ACCESSIBILITY.md',
  'MODAL_STANDARD.md',
  'DROPDOWN_STANDARD.md',
  'CONTEXTUAL_UI_STANDARD.md',
  'UI_REVIEW_TEMPLATE.md',
  'OFFICE_UI_STANDARD.md',
  'CHANGELOG.md',
  'CHANGELOG_STANDARD.md'
)

$oldGlobalStandardFile = ('ART' + '_OFFICE_UI_STANDARD.md')

$legacyBrandPatterns = @(
  'data-art-service',
  '\.art-',
  '\bart-app\b',
  '\bart-header\b',
  '\bart-menubar\b',
  '\bart-toolbar\b',
  '\bart-statusbar\b',
  '\bart-workspace\b',
  '/office/art-',
  'UI_REVIEW_art-'
)

foreach ($docFile in $normativeDocFiles) {
  $fullPath = Join-Path $Root $docFile
  if (-not (Test-Path $fullPath)) { continue }
  $content = Get-Content -Raw -Encoding UTF8 $fullPath
  foreach ($pattern in $legacyBrandPatterns) {
    Assert-True ($content -notmatch $pattern) "${docFile}: contains legacy branded shell term matching ${pattern}"
  }
  Assert-True (-not $content.Contains($oldGlobalStandardFile)) "${docFile}: still references old global standard filename"
}

$rootIndexPath = Join-Path $Root 'index.html'
if (Test-Path $rootIndexPath) {
  $rootHtml = Get-Content -Raw -Encoding UTF8 $rootIndexPath
  Assert-ProductionHtmlSecurityBaseline $rootHtml 'index.html'
  Assert-True ($rootHtml -notmatch '/office/art-') "Root index still contains old /office/art-* links"
  Assert-True ($rootHtml -notmatch '/office/office-') "Root index contains invalid /office/office-* links"
  Assert-True ($rootHtml -notmatch "pathname\.endsWith\('/office'\)") "Standalone root index should not contain the old /office redirect"
  Assert-True ($rootHtml -match 'src="office-storage\.js"') "Root index must load office-storage.js"
  Assert-True ($rootHtml -match 'src="landing\.js"') "Root index must load the external landing.js bootstrap"
  Assert-True ([regex]::Matches($rootHtml, 'data-office-clear-drafts(?=\s|>)').Count -eq 1) "Root index must provide one clear-all-drafts control"
  Assert-True ([regex]::Matches($rootHtml, 'data-office-clear-drafts-result').Count -eq 1) "Root index must provide one clear-all-drafts result region"
  foreach ($service in $services) {
    Assert-True ($rootHtml -match "href=""$($service.Path)/""") "Root index is missing relative link to $($service.Path)/"
  }

  $landingClaims = @(
    @{ Card = 'ПЛЮС Слайди'; Forbidden = 'анімаці|мультимеді'; Message = 'must not claim animations or multimedia support' },
    @{ Card = 'ПЛЮС Малюнки'; Forbidden = '\.bmp'; Message = 'must not claim BMP support' },
    @{ Card = 'ПЛЮС Вектор'; Forbidden = 'Безьє|\bшар(?:и|ами)?\b'; Message = 'must not claim Bezier curves or layers' }
  )

  foreach ($claim in $landingClaims) {
    $title = [regex]::Escape($claim.Card)
    $cardMatch = [regex]::Match($rootHtml, "(?s)<article\b(?:(?!</article>).)*?<h2\b[^>]*>$title</h2>(?:(?!</article>).)*?</article>")
    Assert-True $cardMatch.Success "index.html: landing card is missing: $($claim.Card)"
    if ($cardMatch.Success) {
      Assert-True ($cardMatch.Value -notmatch $claim.Forbidden) "index.html: $($claim.Card) $($claim.Message)"
    }
  }
  Assert-True ($rootHtml -match '<span[^>]*class="[^"]*office-format-tag[^"]*"[^>]*>\s*\.xlsx\s*</span>') 'index.html: Tables card should advertise verified XLSX support'
  Assert-True ($rootHtml -match '<span[^>]*class="[^"]*office-format-tag[^"]*"[^>]*>\s*\.svg\s*</span>') 'index.html: Flowcharts card should advertise verified SVG export'
}

$appShellPath = Join-Path $Root 'APP_SHELL.html'
if (Test-Path $appShellPath) {
  Assert-ProductionHtmlSecurityBaseline (Get-Content -Raw -Encoding UTF8 $appShellPath) 'APP_SHELL.html'
}

$themeMapPath = Join-Path $Root 'SERVICE_THEME_MAP.json'
if (Test-Path $themeMapPath) {
  $themeMap = Get-Content -Raw -Encoding UTF8 $themeMapPath | ConvertFrom-Json
  foreach ($service in $services) {
    $serviceConfig = $themeMap.services.PSObject.Properties[$service.Key].Value
    Assert-True ($null -ne $serviceConfig) "SERVICE_THEME_MAP.json is missing $($service.Key)"
    Assert-True ($serviceConfig.serviceKey -eq $service.Key) "SERVICE_THEME_MAP.json has wrong serviceKey for $($service.Key)"
  }
}

foreach ($service in $services) {
  $serviceRoot = Join-Path $Root $service.Path
  $indexPath = Join-Path $serviceRoot 'index.html'
  Assert-True (Test-Path $serviceRoot) "Missing service directory: $($service.Path)"
  Assert-True (Test-Path $indexPath) "Missing index.html for service: $($service.Path)"
  Assert-True (Test-Path (Join-Path $serviceRoot 'UI_STANDARD.md')) "Missing UI_STANDARD.md for service: $($service.Path)"
  Assert-True (Test-Path (Join-Path $serviceRoot 'UI_MIGRATION_TO_STANDARD.md')) "Missing UI_MIGRATION_TO_STANDARD.md for service: $($service.Path)"

  if (-not (Test-Path $indexPath)) { continue }

  $html = Get-Content -Raw -Encoding UTF8 $indexPath
  Assert-ProductionHtmlSecurityBaseline $html "$($service.Path)/index.html"
  Assert-LocalHtmlAssetsExist $html $indexPath $service.Path
  Assert-StaticIdReferencesExist $html $serviceRoot $service.Path $service.OptionalIds
  Assert-StylesheetOrder $html $service.Path

  $stylePath = Join-Path $serviceRoot 'style.css'
  Assert-True (Test-Path $stylePath) "$($service.Path): missing local style.css"
  if (Test-Path $stylePath) {
    $style = Get-Content -Raw -Encoding UTF8 $stylePath
    $localAccent = [regex]::Match($style, '--accent\s*:\s*(#[0-9a-fA-F]{6})')
    Assert-True $localAccent.Success "$($service.Path): local style.css should expose --accent for the service shell"
    if ($localAccent.Success -and (Test-Path $themeMapPath)) {
      $expectedAccent = $themeMap.services.PSObject.Properties[$service.Key].Value.accent
      Assert-True ($localAccent.Groups[1].Value.ToLowerInvariant() -eq $expectedAccent.ToLowerInvariant()) "$($service.Path): local --accent must match SERVICE_THEME_MAP.json ($expectedAccent)"
    }
    Assert-True ($style -notmatch '--office-[\w-]+\s*:') "$($service.Path): local style.css should not redefine shared --office-* tokens"
    Assert-True ($style -notmatch '(^|[}\r\n]\s*)[^{}]*\.office-[^{]+\{') "$($service.Path): local style.css should not redefine shared .office-* component selectors"
  }

  Assert-True ($html -match 'href="\.\./UI_TOKENS\.css"') "$($service.Path): UI_TOKENS.css is not linked before local styling"
  Assert-True ($html -match 'href="\.\./shell-overrides\.css"') "$($service.Path): shell-overrides.css is not linked after local styling"
  Assert-True ($html -match 'src="\.\./office-shell\.js"') "$($service.Path): office-shell.js is not linked"
  Assert-True ($html -match 'src="\.\./office-ui\.js"') "$($service.Path): office-ui.js is not linked"
  Assert-True ($html -match 'src="\.\./office-storage\.js"') "$($service.Path): office-storage.js is not linked"
  Assert-True ($html -match 'src="\.\./offline\.js"') "$($service.Path): offline.js is not registered"
  Assert-True ($html -match 'src="\.\./office-storage\.js"[\s\S]*src="(?:js/)?(?:storage|autosave)\.js"|src="\.\./office-storage\.js"[\s\S]*src="(?:core|js)/[^\"]*\.js"') "$($service.Path): office-storage.js must load before local storage/app modules"
  Assert-True ($html -match 'src="\.\./office-shell\.js"[\s\S]*src="\.\./office-ui\.js"') "$($service.Path): office-shell.js must be linked before office-ui.js"
  Assert-True ($html -match 'src="\.\./office-ui\.js"[\s\S]*src="\.\./offline\.js"') "$($service.Path): office-ui.js must be linked before offline.js"
  Assert-True ($html -match '<body[^>]*class="[^"]*\boffice-app\b[^"]*"') "$($service.Path): body is missing office-app class"
  Assert-True ($html -match "<body[^>]*data-office-service=""$($service.Key)""") "$($service.Path): body has missing or wrong data-office-service"
  Assert-True ($html -notmatch 'href="/office"') "$($service.Path): back link should be relative so custom domains under /office/ resolve correctly"
  Assert-True ($html -match '<header[^>]*class="[^"]*\boffice-header\b[^"]*"') "$($service.Path): header is missing office-header class"
  Assert-True ($html -match '<nav[^>]*class="[^"]*\boffice-menubar\b[^"]*"') "$($service.Path): menubar is missing office-menubar class"
  Assert-True ($html -match 'class="[^"]*\boffice-toolbar\b[^"]*"') "$($service.Path): toolbar is missing office-toolbar class"
  Assert-True ($html -match 'class="[^"]*\boffice-workspace\b[^"]*"') "$($service.Path): workspace is missing office-workspace class"
  Assert-True ($html -match 'class="[^"]*\boffice-statusbar\b[^"]*"') "$($service.Path): statusbar is missing office-statusbar class"
  Assert-True ($html -match '<footer[^>]*class="[^"]*\boffice-statusbar\b[^"]*"[^>]*aria-label=') "$($service.Path): statusbar should have an aria-label"
  Assert-True ($html -match 'data-office-status-slot="primary"') "$($service.Path): statusbar is missing primary status slot"
  Assert-True ($html -match 'data-office-status-slot="secondary"') "$($service.Path): statusbar is missing secondary status slot"
  Assert-True ([regex]::Matches($html, 'data-office-end-session').Count -eq 1) "$($service.Path): File menu must contain exactly one end-session command"
  Assert-True ($html -match 'class="[^"]*\boffice-workspace-focusable\b[^"]*"') "$($service.Path): workspace is missing office-workspace-focusable class"
  Assert-True ($html -match 'office-workspace-focusable[^>]*tabindex="0"|tabindex="0"[^>]*office-workspace-focusable') "$($service.Path): focusable workspace should have tabindex=0"
  Assert-True ($html -match 'class="[^"]*\bmodal(?:-overlay)?\b[^"]*"') "$($service.Path): expected at least one modal surface for standard behavior checks"
  Assert-CommandOrder $html $service.Path
  Assert-MenuToolbarCommandParity $service $html
  $actionSource = Get-ServiceActionSource $service
  Assert-SaveCommandContract $service $html $actionSource
  Assert-CommandAdapterContract $service
  Assert-FilePickerContract $service

  foreach ($menuKey in $service.Menu) {
    Assert-True ($html -match "data-menu=""$menuKey""") "$($service.Path): expected menu key is missing: $menuKey"
  }

  $markupActions = Get-RegexGroupValues $html 'data-action="([^"]+)"'
  if ($markupActions.Count -gt 0) {
    $handledActions = Get-RegexGroupValues $actionSource 'case\s+[''"]([^''"]+)[''"]'
    foreach ($action in $markupActions) {
      Assert-True ($handledActions -contains $action) "$($service.Path): data-action has no dispatcher case: $action"
    }
  }

  Assert-True ($html -notmatch '\son(?:click|keydown|mousedown|change)=') "$($service.Path): inline event handlers should stay migrated to data attributes and JS bindings"
  Assert-True ($html -notmatch '\sstyle=') "$($service.Path): inline styles should stay migrated to CSS classes"

  $externalMatches = [regex]::Matches($html, '<(?:script|link|img|source)\b[^>]*(?:src|href)="https?://')
  if ($externalMatches.Count -gt 0) {
    Add-Warning "$($service.Path): external resources are still present ($($externalMatches.Count)); offline hardening is a later migration step."
  }
}

$serviceScriptFiles = Get-ChildItem -Path ($services | ForEach-Object { Join-Path $Root $_.Path }) -Recurse -File -Include '*.js'
foreach ($scriptFile in $serviceScriptFiles) {
  $relativePath = $scriptFile.FullName.Substring($Root.Length).TrimStart('\', '/').Replace('\', '/')
  $content = Get-Content -Raw -Encoding UTF8 $scriptFile.FullName
  Assert-True ($content -notmatch '\.onclick\s*=') "${relativePath}: use addEventListener instead of assigning .onclick"
}

$runtimeFiles = @(
  'paint/js/ui.js',
  'paint/js/app.js',
  'paint/js/runtime.js',
  'vector/js/ui.js',
  'vector/js/app.js',
  'vector/js/runtime.js',
  'tables/js/addressing.js',
  'tables/js/app.js',
  'tables/js/core.js',
  'tables/js/formula-engine.js',
  'tables/js/formula-functions.js',
  'tables/js/formula-parser.js',
  'tables/js/formula-references.js',
  'tables/js/model.js',
  'tables/js/storage.js',
  'tables/js/ui.js',
  'tables/js/grid.js',
  'tables/js/runtime.js',
  'tables/js/state.js',
  'tables/js/workbook.js',
  'slides/js/app.js',
  'slides/js/chart-controller.js',
  'slides/js/chart-element.js',
  'slides/js/element-rendering.js',
  'slides/js/image-geometry.js',
  'slides/js/modal-ui.js',
  'slides/js/object-commands.js',
  'slides/js/presentation-design.js',
  'slides/js/pptx-export.js',
  'slides/js/pptx-import.js',
  'slides/js/project.js',
  'slides/js/runtime.js',
  'slides/js/slide-list.js',
  'slides/js/stage-interactions.js',
  'slides/js/stage-renderer.js',
  'slides/js/table-controller.js',
  'slides/js/table-element.js',
  'slides/js/text-list.js',
  'text/js/app.js',
  'text/js/runtime.js'
)

foreach ($runtimeFile in $runtimeFiles) {
  $fullPath = Join-Path $Root $runtimeFile
  if (-not (Test-Path $fullPath)) { continue }
  $content = Get-Content -Raw -Encoding UTF8 $fullPath
  Assert-True ($content -notmatch '\bshowAlert\b') "${runtimeFile}: legacy showAlert API should be renamed to modal semantics"
  Assert-True ($content -notmatch '\balertModal\b') "${runtimeFile}: legacy alertModal API should be renamed to modal semantics"
  Assert-True ($content -notmatch '\bshowTextPrompt\b') "${runtimeFile}: legacy showTextPrompt API should be renamed to modal semantics"
  Assert-True ($content -notmatch "confirmText\s*=\s*'Так'") "${runtimeFile}: confirm modal defaults should use specific actions, not Так"
}

$printSafetyFiles = @(
  'paint/js/app.js',
  'vector/js/app.js',
  'slides/js/export.js',
  'slides/js/app.js'
)

foreach ($printSafetyFile in $printSafetyFiles) {
  $fullPath = Join-Path $Root $printSafetyFile
  if (-not (Test-Path $fullPath)) { continue }
  $content = Get-Content -Raw -Encoding UTF8 $fullPath
  Assert-True ($content -notmatch '\.document\.write\(`<!DOCTYPE html') "${printSafetyFile}: print windows should build DOM nodes instead of injecting raw HTML templates"
}

$modalMarkupFiles = @(
  'tables/index.html',
  'paint/index.html',
  'vector/index.html',
  'slides/index.html',
  'text/index.html'
)

foreach ($modalMarkupFile in $modalMarkupFiles) {
  $fullPath = Join-Path $Root $modalMarkupFile
  if (-not (Test-Path $fullPath)) { continue }
  $content = Get-Content -Raw -Encoding UTF8 $fullPath
  Assert-True ($content -notmatch '>Так</button>') "${modalMarkupFile}: modal buttons should use specific action labels, not Так"
  Assert-True ($content -notmatch '>Ні</button>') "${modalMarkupFile}: modal buttons should use Скасувати instead of Ні"
}

$slidesIndexPath = Join-Path $Root 'slides/index.html'
if (Test-Path $slidesIndexPath) {
  $slidesHtml = Get-Content -Raw -Encoding UTF8 $slidesIndexPath
  Assert-True ($slidesHtml -match 'type="module"\s+src="js/runtime\.js"|src="js/runtime\.js"\s+type="module"') "slides/index.html: should load runtime.js as the module entrypoint"
  Assert-True ($slidesHtml -notmatch 'src="js/app\.js"') "slides/index.html: should not load source app.js directly while runtime.js stays the stable entrypoint"
  Assert-True ($slidesHtml -notmatch 'vendor/pptxgenjs/pptxgen\.bundle\.js') "slides/index.html: PPTX bundle should be lazy-loaded instead of delaying editor boot"
}

$slidesPptxExportPath = Join-Path $Root 'slides/js/pptx-export.js'
if (Test-Path $slidesPptxExportPath) {
  $slidesPptxExport = Get-Content -Raw -Encoding UTF8 $slidesPptxExportPath
  Assert-True ($slidesPptxExport -match 'export function buildPptxPresentation\(') "slides/js/pptx-export.js: should expose a testable PPTX builder"
  Assert-True ($slidesPptxExport -match 'export function loadPptxLibrary\(') "slides/js/pptx-export.js: should lazy-load the vendored PPTX bundle"
  Assert-True ($slidesPptxExport -match 'export async function exportPresentationPptx\(') "slides/js/pptx-export.js: should own PPTX file writing"
  Assert-True ($slidesPptxExport -match 'normalizeTable\(') "slides/js/pptx-export.js: should export normalized table data"
  Assert-True ($slidesPptxExport -match 'normalizeChart\(') "slides/js/pptx-export.js: should export normalized chart data"
}

$slidesRuntimePath = Join-Path $Root 'slides/js/runtime.js'
if (Test-Path $slidesRuntimePath) {
  $slidesRuntime = Get-Content -Raw -Encoding UTF8 $slidesRuntimePath
  Assert-True ($slidesRuntime -match "import\s+['""]\.\/app\.js['""]") "slides/js/runtime.js: should be a thin wrapper that imports app.js"
  Assert-True ($slidesRuntime -notmatch "document\.addEventListener\('DOMContentLoaded',\s*boot\)") "slides/js/runtime.js: runtime wrapper should not duplicate application boot logic"
}

$slidesProjectPath = Join-Path $Root 'slides/js/project.js'
if (Test-Path $slidesProjectPath) {
  $slidesProject = Get-Content -Raw -Encoding UTF8 $slidesProjectPath
  foreach ($projectFunction in @('normalizeElement', 'normalizePresentation', 'normalizeAction', 'normalizeSlideActions', 'parsePresentationText', 'savePresentationFile', 'slugify')) {
    Assert-True ($slidesProject -match "export function $projectFunction\(") "slides/js/project.js: should own $projectFunction"
  }
}

# Click action in presentation: declarative allowlist without code strings, both menus, presentation-only snapshot, honest PPTX warning.
$slidesConstantsPath = Join-Path $Root 'slides/js/constants.js'
$slidesAppPath = Join-Path $Root 'slides/js/app.js'
$slidesExportPath = Join-Path $Root 'slides/js/export.js'
if ((Test-Path $slidesConstantsPath) -and (Test-Path $slidesAppPath) -and (Test-Path $slidesExportPath) -and (Test-Path $slidesIndexPath) -and (Test-Path $slidesPptxExportPath)) {
  $slidesConstants = Get-Content -Raw -Encoding UTF8 $slidesConstantsPath
  $slidesAppSource = Get-Content -Raw -Encoding UTF8 $slidesAppPath
  $slidesExportSource = Get-Content -Raw -Encoding UTF8 $slidesExportPath
  Assert-True ($slidesConstants -match "export const ELEMENT_ACTION_KINDS = \['show', 'hide', 'toggle'\];") "slides/js/constants.js: click actions should use the show/hide/toggle allowlist"
  Assert-True ([regex]::Matches($slidesHtml, 'data-action="edit-action"').Count -eq 2) "slides/index.html: click action should be available from the Insert menu and the object context menu"
  Assert-True ($slidesAppSource -match "case 'edit-action': showActionModal\(\)") "slides/js/app.js: edit-action should open the click action dialog"
  Assert-True ($slidesExportSource -match 'export function createSlideSnapshot\(slide, \{ presentation = false \} = \{\}\)') "slides/js/export.js: only the presentation snapshot should hide start-hidden objects and expose triggers"
  Assert-True ($slidesAppSource -match 'createSlideSnapshot\(slide, \{ presentation: true \}\)') "slides/js/app.js: presentation should render the interactive snapshot"
  Assert-True ($slidesAppSource -notmatch '\bnew Function\(|\beval\(') "slides/js/app.js: click actions must not execute code strings"
  Assert-True ($slidesPptxExport -match 'element\.action \|\| element\.startHidden') "slides/js/pptx-export.js: should warn when click actions cannot be exported"
}

# PPTX Import Lite pilot: dependency-free adapter with ZIP/XML limits, no resource loading, explicit user choice before replacing the document.
$slidesPptxImportPath = Join-Path $Root 'slides/js/pptx-import.js'
if ((Test-Path $slidesPptxImportPath) -and (Test-Path $slidesAppPath) -and (Test-Path $slidesIndexPath)) {
  $slidesPptxImport = Get-Content -Raw -Encoding UTF8 $slidesPptxImportPath
  $slidesAppForImport = Get-Content -Raw -Encoding UTF8 $slidesAppPath
  Assert-True ($slidesPptxImport -match 'export async function importPptxArrayBuffer\(') "slides/js/pptx-import.js: should expose a testable import adapter"
  Assert-True ($slidesPptxImport -match 'export const PPTX_IMPORT_LIMITS') "slides/js/pptx-import.js: should declare explicit ZIP and XML limits"
  Assert-True ($slidesPptxImport -match "new DecompressionStream\('deflate-raw'\)") "slides/js/pptx-import.js: should inflate ZIP entries natively under a byte limit"
  Assert-True ($slidesPptxImport -match '<!DOCTYPE\|<!ENTITY') "slides/js/pptx-import.js: should reject DTD and entity declarations"
  Assert-True ($slidesPptxImport -notmatch '\bfetch\(|XMLHttpRequest|new Image\(|\.src\s*=') "slides/js/pptx-import.js: import must not load external resources"
  Assert-True ($slidesPptxImport -notmatch "from '\.\./\.\./vendor/") "slides/js/pptx-import.js: pilot must not depend on vendored libraries"
  Assert-True ($slidesAppForImport -match "import\('\./pptx-import\.js'\)") "slides/js/app.js: PPTX import adapter should be loaded on demand"
  Assert-True ($slidesAppForImport -match 'replacePresentation\(presentation, \{ statusText') "slides/js/app.js: imported PPTX should replace the document only through the confirmed rollback path"
  Assert-True (($slidesHtml -match 'data-action="import-pptx"') -and ($slidesHtml -match 'id="pptxFileInput"[^>]*accept="\.pptx')) "slides/index.html: File menu should offer the PPTX import pilot with a .pptx picker"
}

$slidesHistoryPath = Join-Path $Root 'slides/js/history.js'
if (Test-Path $slidesHistoryPath) {
  $slidesHistory = Get-Content -Raw -Encoding UTF8 $slidesHistoryPath
  Assert-True ($slidesHistory -notmatch 'deepClone\(serializePresentation\(\)\)') "slides/js/history.js: serializePresentation already returns a detached snapshot and must not be cloned twice"
}

$slidesElementRenderingPath = Join-Path $Root 'slides/js/element-rendering.js'
if (Test-Path $slidesElementRenderingPath) {
  $slidesElementRendering = Get-Content -Raw -Encoding UTF8 $slidesElementRenderingPath
  foreach ($renderFunction in @('appendShapeGraphic', 'applyTextVisualStyles')) {
    Assert-True ($slidesElementRendering -match "export function $renderFunction\(") "slides/js/element-rendering.js: should own $renderFunction"
  }
}

$slidesImageGeometryPath = Join-Path $Root 'slides/js/image-geometry.js'
if (Test-Path $slidesImageGeometryPath) {
  $slidesImageGeometry = Get-Content -Raw -Encoding UTF8 $slidesImageGeometryPath
  foreach ($geometryFunction in @('getCropFractions', 'getCropGeometry')) {
    Assert-True ($slidesImageGeometry -match "export function $geometryFunction\(") "slides/js/image-geometry.js: should own $geometryFunction"
  }
}

$slidesPresentationDesignPath = Join-Path $Root 'slides/js/presentation-design.js'
if (Test-Path $slidesPresentationDesignPath) {
  $slidesPresentationDesign = Get-Content -Raw -Encoding UTF8 $slidesPresentationDesignPath
  foreach ($designFunction in @('getTheme', 'applyThemeToPresentation', 'applyLayoutToSlide')) {
    Assert-True ($slidesPresentationDesign -match "export function $designFunction\(") "slides/js/presentation-design.js: should own $designFunction"
  }
}

$slidesObjectCommandsPath = Join-Path $Root 'slides/js/object-commands.js'
if (Test-Path $slidesObjectCommandsPath) {
  $slidesObjectCommands = Get-Content -Raw -Encoding UTF8 $slidesObjectCommandsPath
  foreach ($objectCommand in @('groupElements', 'ungroupElements', 'remapGroupIds', 'createSelectionUnits', 'alignSelectionUnits', 'distributeSelectionUnits')) {
    Assert-True ($slidesObjectCommands -match "export function $objectCommand\(") "slides/js/object-commands.js: should own $objectCommand"
  }
}

$slidesModalUiPath = Join-Path $Root 'slides/js/modal-ui.js'
if (Test-Path $slidesModalUiPath) {
  $slidesModalUi = Get-Content -Raw -Encoding UTF8 $slidesModalUiPath
  foreach ($modalUiFunction in @('closeModal', 'showConfirmModal', 'showInfoModal', 'showModal')) {
    Assert-True ($slidesModalUi -match "export function $modalUiFunction\(") "slides/js/modal-ui.js: should own $modalUiFunction"
  }
}

$slidesSlideListPath = Join-Path $Root 'slides/js/slide-list.js'
if (Test-Path $slidesSlideListPath) {
  $slidesSlideList = Get-Content -Raw -Encoding UTF8 $slidesSlideListPath
  Assert-True ($slidesSlideList -match 'export function renderSlideList\(') "slides/js/slide-list.js: should own slide list rendering"
  foreach ($slideListFunction in @('reorderSlides', 'moveSlideById', 'makeMiniAction')) {
    Assert-True ($slidesSlideList -match "function $slideListFunction\(") "slides/js/slide-list.js: should keep $slideListFunction inside the slide list layer"
  }
}

$slidesStageRendererPath = Join-Path $Root 'slides/js/stage-renderer.js'
if (Test-Path $slidesStageRendererPath) {
  $slidesStageRenderer = Get-Content -Raw -Encoding UTF8 $slidesStageRendererPath
  Assert-True ($slidesStageRenderer -match 'export function renderStage\(') "slides/js/stage-renderer.js: should own stage rendering"
  Assert-True ($slidesStageRenderer -match 'export function syncSelectionUi\(') "slides/js/stage-renderer.js: should own stage selection DOM sync"
  foreach ($stageRendererFunction in @('renderElementNode', 'createTextNode', 'createShapeNode', 'createHandles', 'applyTextStylesToNode')) {
    Assert-True ($slidesStageRenderer -match "function $stageRendererFunction\(") "slides/js/stage-renderer.js: should keep $stageRendererFunction inside the stage renderer layer"
  }
}

$slidesStageInteractionsPath = Join-Path $Root 'slides/js/stage-interactions.js'
if (Test-Path $slidesStageInteractionsPath) {
  $slidesStageInteractions = Get-Content -Raw -Encoding UTF8 $slidesStageInteractionsPath
  foreach ($stageInteractionFunction in @('bindStage', 'getStagePoint', 'onElementPointerDown', 'onHandlePointerDown', 'onStagePointerMove', 'onStagePointerUp')) {
    Assert-True ($slidesStageInteractions -match "export function $stageInteractionFunction\(") "slides/js/stage-interactions.js: should own $stageInteractionFunction"
  }
  Assert-True ($slidesStageInteractions -match 'const pointer\s*=') "slides/js/stage-interactions.js: should own pointer interaction state"
}

$slidesTableControllerPath = Join-Path $Root 'slides/js/table-controller.js'
if (Test-Path $slidesTableControllerPath) {
  $slidesTableController = Get-Content -Raw -Encoding UTF8 $slidesTableControllerPath
  Assert-True ($slidesTableController -match 'export function createTableController\(') "slides/js/table-controller.js: should expose the table orchestration boundary"
  foreach ($tableControllerFunction in @('selectCell', 'navigateCell', 'showTableModal', 'changeStructure', 'copySelectedRange', 'pasteCopiedRange', 'mergeSelectedCells', 'splitActiveCell')) {
    Assert-True ($slidesTableController -match "function $tableControllerFunction\(") "slides/js/table-controller.js: should own $tableControllerFunction"
  }
}

$slidesChartControllerPath = Join-Path $Root 'slides/js/chart-controller.js'
if (Test-Path $slidesChartControllerPath) {
  $slidesChartController = Get-Content -Raw -Encoding UTF8 $slidesChartControllerPath
  Assert-True ($slidesChartController -match 'export function createChartController\(') "slides/js/chart-controller.js: should expose the chart orchestration boundary"
  Assert-True ($slidesChartController -match 'function showChartModal\(') "slides/js/chart-controller.js: should own chart modal orchestration"
}

$paintIndexPath = Join-Path $Root 'paint/index.html'
if (Test-Path $paintIndexPath) {
  $paintHtml = Get-Content -Raw -Encoding UTF8 $paintIndexPath
  Assert-True ($paintHtml -match 'src="js/app\.js"') "paint/index.html: should load js/app.js as the local boot layer"
  Assert-True ($paintHtml -match 'src="js/runtime\.js"') "paint/index.html: should load js/runtime.js as the runtime entrypoint"
}

$paintRuntimePath = Join-Path $Root 'paint/js/runtime.js'
if (Test-Path $paintRuntimePath) {
  $paintRuntime = Get-Content -Raw -Encoding UTF8 $paintRuntimePath
  Assert-True ($paintRuntime -match 'window\.PaintApp\?\.boot\?\.') "paint/js/runtime.js: runtime should boot through PaintApp"
}

$paintAppPath = Join-Path $Root 'paint/js/app.js'
if (Test-Path $paintAppPath) {
  $paintApp = Get-Content -Raw -Encoding UTF8 $paintAppPath
  Assert-True ($paintApp -match 'window\.PaintApp\s*=') "paint/js/app.js: should expose PaintApp facade"
}

$vectorIndexPath = Join-Path $Root 'vector/index.html'
if (Test-Path $vectorIndexPath) {
  $vectorHtml = Get-Content -Raw -Encoding UTF8 $vectorIndexPath
  Assert-True ($vectorHtml -match 'src="js/app\.js"') "vector/index.html: should load js/app.js as the local boot layer"
  Assert-True ($vectorHtml -match 'src="js/runtime\.js"') "vector/index.html: should load js/runtime.js as the runtime entrypoint"
}

$vectorRuntimePath = Join-Path $Root 'vector/js/runtime.js'
if (Test-Path $vectorRuntimePath) {
  $vectorRuntime = Get-Content -Raw -Encoding UTF8 $vectorRuntimePath
  Assert-True ($vectorRuntime -match 'window\.VectorApp\?\.boot\?\.') "vector/js/runtime.js: runtime should boot through VectorApp"
}

$vectorEditorPath = Join-Path $Root 'vector/js/editor.js'
if (Test-Path $vectorEditorPath) {
  $vectorEditor = Get-Content -Raw -Encoding UTF8 $vectorEditorPath
  # PNG і друк мають відповідати перевіреному SVG: приховані об'єкти не експортуються.
  Assert-True ($vectorEditor -match 'async exportPngBlob\(\)\s*\{\s*const svgMarkup = this\.exportSvgMarkup\(\)') 'vector/js/editor.js: PNG export must render the same SVG markup as SVG export'
  Assert-True ($vectorEditor -match 'exportSvgNode\(\)[\s\S]*?\.filter\(\(obj\) => !obj\.hidden\)') 'vector/js/editor.js: SVG export must skip hidden objects'
}

$vectorAppPath = Join-Path $Root 'vector/js/app.js'
if (Test-Path $vectorAppPath) {
  $vectorApp = Get-Content -Raw -Encoding UTF8 $vectorAppPath
  Assert-True ($vectorApp -match 'window\.VectorApp\s*=') "vector/js/app.js: should expose VectorApp facade"
}

$flowchartsIndexPath = Join-Path $Root 'flowcharts/index.html'
if (Test-Path $flowchartsIndexPath) {
  $flowchartsHtml = Get-Content -Raw -Encoding UTF8 $flowchartsIndexPath
  Assert-True ($flowchartsHtml -match 'src="js/core\.js"') "flowcharts/index.html: should load js/core.js as the shared domain layer"
  Assert-True ($flowchartsHtml -match 'src="js/ui\.js"') "flowcharts/index.html: should load js/ui.js as the shared UI helper layer"
  foreach ($moduleName in @('svg-export', 'autosave', 'modals', 'editor-utils', 'status', 'colors', 'connection-selection', 'shape-selection', 'shape-deletion', 'shape-text', 'shape-interactions', 'shape-factory', 'viewport', 'keyboard-shortcuts', 'history', 'menu-actions', 'flow-actions', 'title', 'shape-geometry', 'shape-placement', 'handles', 'routing', 'connections-dom')) {
    Assert-True ($flowchartsHtml -match "src=""js/$moduleName\.js""") "flowcharts/index.html: should load js/$moduleName.js before editor.js"
    Assert-True ($flowchartsHtml -match "src=""js/$moduleName\.js""[\s\S]*src=""js/editor\.js""") "flowcharts/index.html: js/$moduleName.js must load before js/editor.js"
  }
  Assert-True ($flowchartsHtml -match 'src="js/editor\.js"') "flowcharts/index.html: should load js/editor.js as the editor implementation"
  Assert-True ($flowchartsHtml -match 'src="js/app\.js"') "flowcharts/index.html: should load js/app.js as the shell adapter layer"
  Assert-True ($flowchartsHtml -match 'src="js/runtime\.js"') "flowcharts/index.html: should load js/runtime.js as the runtime entrypoint"
  Assert-True ($flowchartsHtml -notmatch 'src="main\.js"|src="app-core\.js"|src="ui\.js"|src="flowchart-core\.js"') "flowcharts/index.html: should not load legacy root scripts after js/ migration"
}

$flowchartsAppPath = Join-Path $Root 'flowcharts/js/app.js'
if (Test-Path $flowchartsAppPath) {
  $flowchartsApp = Get-Content -Raw -Encoding UTF8 $flowchartsAppPath
  Assert-True ($flowchartsApp -match 'window\.FlowchartsApp\s*=') "flowcharts/js/app.js: should expose a stable FlowchartsApp facade"
  Assert-True ($flowchartsApp -match 'window\.FlowchartsApp\.boot\s*=') "flowcharts/js/app.js: shell adapter should expose FlowchartsApp.boot"
  Assert-True ($flowchartsApp -match 'window\.initFlowchartsEditor\?\.\(\)') "flowcharts/js/app.js: shell adapter should delegate boot to initFlowchartsEditor"
}

$flowchartsRuntimePath = Join-Path $Root 'flowcharts/js/runtime.js'
if (Test-Path $flowchartsRuntimePath) {
  $flowchartsRuntime = Get-Content -Raw -Encoding UTF8 $flowchartsRuntimePath
  Assert-True ($flowchartsRuntime -match 'window\.FlowchartsApp\?\.boot\?\.') "flowcharts/js/runtime.js: runtime should boot through the FlowchartsApp facade"
}

$flowchartsEditorPath = Join-Path $Root 'flowcharts/js/editor.js'
if (Test-Path $flowchartsEditorPath) {
  $flowchartsEditor = Get-Content -Raw -Encoding UTF8 $flowchartsEditorPath
  Assert-True ($flowchartsEditor -match 'window\.initFlowchartsEditor\s*=\s*function initFlowchartsEditor') "flowcharts/js/editor.js: editor implementation should expose initFlowchartsEditor"
  Assert-True ($flowchartsEditor -match 'Office(?:UI|Shell)\?*\.registerCommands\?*\.') "flowcharts/js/editor.js: editor implementation should register standard shell commands"
  Assert-True ($flowchartsEditor -match 'Office(?:UI|Shell)\?*\.openFilePicker\?*\.') "flowcharts/js/editor.js: editor implementation should use OfficeUI.openFilePicker or OfficeShell.openFilePicker"
}

$flowchartsModuleContracts = @{
  'flowcharts/js/autosave.js' = 'window\.FlowchartsAutosave\s*='
  'flowcharts/js/modals.js' = 'window\.FlowchartsModals\s*='
  'flowcharts/js/editor-utils.js' = 'window\.FlowchartsEditorUtils\s*='
  'flowcharts/js/status.js' = 'window\.FlowchartsStatus\s*='
  'flowcharts/js/colors.js' = 'window\.FlowchartsColors\s*='
  'flowcharts/js/connection-selection.js' = 'window\.FlowchartsConnectionSelection\s*='
  'flowcharts/js/shape-selection.js' = 'window\.FlowchartsShapeSelection\s*='
  'flowcharts/js/shape-deletion.js' = 'window\.FlowchartsShapeDeletion\s*='
  'flowcharts/js/shape-text.js' = 'window\.FlowchartsShapeText\s*='
  'flowcharts/js/shape-interactions.js' = 'window\.FlowchartsShapeInteractions\s*='
  'flowcharts/js/shape-factory.js' = 'window\.FlowchartsShapeFactory\s*='
  'flowcharts/js/viewport.js' = 'window\.FlowchartsViewport\s*='
  'flowcharts/js/keyboard-shortcuts.js' = 'window\.FlowchartsKeyboardShortcuts\s*='
  'flowcharts/js/history.js' = 'window\.FlowchartsHistory\s*='
  'flowcharts/js/menu-actions.js' = 'window\.FlowchartsMenuActions\s*='
  'flowcharts/js/flow-actions.js' = 'window\.FlowchartsFlowActions\s*='
  'flowcharts/js/title.js' = 'window\.FlowchartsTitle\s*='
  'flowcharts/js/shape-geometry.js' = 'window\.FlowchartsShapeGeometry\s*='
  'flowcharts/js/shape-placement.js' = 'window\.FlowchartsShapePlacement\s*='
  'flowcharts/js/handles.js' = 'window\.FlowchartsHandles\s*='
  'flowcharts/js/routing.js' = 'window\.FlowchartsRouting\s*='
  'flowcharts/js/connections-dom.js' = 'window\.FlowchartsConnectionsDom\s*='
  'flowcharts/js/svg-export.js' = 'root\.FlowchartsSvgExport\s*='
}
foreach ($modulePath in $flowchartsModuleContracts.Keys) {
  $fullPath = Join-Path $Root $modulePath
  Assert-True (Test-Path $fullPath) "flowcharts: expected local module file: $modulePath"
  if (Test-Path $fullPath) {
    $moduleSource = Get-Content -Raw -Encoding UTF8 $fullPath
    Assert-True ($moduleSource -match $flowchartsModuleContracts[$modulePath]) "${modulePath}: should expose its Flowcharts module namespace"
  }
}

$tablesIndexPath = Join-Path $Root 'tables/index.html'
if (Test-Path $tablesIndexPath) {
  $tablesHtml = Get-Content -Raw -Encoding UTF8 $tablesIndexPath
  foreach ($tablesCoreModule in @('addressing', 'model', 'storage', 'formula-parser', 'formula-references', 'formula-functions', 'formula-engine', 'core')) {
    Assert-True ($tablesHtml -match "src=""js/$tablesCoreModule\.js""") "tables/index.html: should load js/$tablesCoreModule.js as part of the split core layer"
  }
  Assert-True ($tablesHtml -match 'src="js/addressing\.js"[\s\S]*src="js/model\.js"[\s\S]*src="js/storage\.js"[\s\S]*src="js/formula-parser\.js"[\s\S]*src="js/formula-references\.js"[\s\S]*src="js/formula-functions\.js"[\s\S]*src="js/formula-engine\.js"[\s\S]*src="js/core\.js"[\s\S]*src="js/state\.js"') "tables/index.html: split core modules should load before state.js in dependency order"
  Assert-True ($tablesHtml -match 'src="js/state\.js"') "tables/index.html: should load js/state.js as the UI state layer"
  Assert-True ($tablesHtml -match 'src="js/column-sizing\.js"') "tables/index.html: should load js/column-sizing.js as the column sizing layer"
  Assert-True ($tablesHtml -match 'src="js/state\.js"[\s\S]*src="js/column-sizing\.js"[\s\S]*src="js/formula-bar\.js"') "tables/index.html: js/column-sizing.js should load after state.js and before formula-bar.js"
  Assert-True ($tablesHtml -match 'src="js/formula-bar\.js"') "tables/index.html: should load js/formula-bar.js as the formula bar layer"
  Assert-True ($tablesHtml -match 'src="js/grid-viewport\.js"') "tables/index.html: should load js/grid-viewport.js"
  Assert-True ($tablesHtml -match 'src="js/formula-bar\.js"[\s\S]*src="js/grid-viewport\.js"[\s\S]*src="js/grid\.js"') "tables/index.html: viewport policy must load immediately before grid.js"
  Assert-True ($tablesHtml -match 'src="js/column-sizing\.js"[\s\S]*src="js/formula-bar\.js"[\s\S]*src="js/grid\.js"') "tables/index.html: js/formula-bar.js should load after column-sizing.js and before grid.js"
  Assert-True ($tablesHtml -match 'src="js/clipboard\.js"') "tables/index.html: should load js/clipboard.js as the clipboard layer"
  Assert-True ($tablesHtml -match 'src="js/grid\.js"[\s\S]*src="js/clipboard\.js"[\s\S]*src="js/structure\.js"') "tables/index.html: js/clipboard.js should load after grid.js and before structure.js"
  Assert-True ($tablesHtml -match 'src="js/selection-actions\.js"') "tables/index.html: should load js/selection-actions.js as the selection command layer"
  Assert-True ($tablesHtml -match 'src="js/clipboard\.js"[\s\S]*src="js/selection-actions\.js"[\s\S]*src="js/structure\.js"') "tables/index.html: js/selection-actions.js should load after clipboard.js and before structure.js"
  Assert-True ($tablesHtml -match 'src="js/formatting\.js"') "tables/index.html: should load js/formatting.js as the formatting layer"
  Assert-True ($tablesHtml -match 'src="js/selection-actions\.js"[\s\S]*src="js/formatting\.js"[\s\S]*src="js/structure\.js"') "tables/index.html: js/formatting.js should load after selection-actions.js and before structure.js"
  Assert-True ($tablesHtml -match 'src="js/structure\.js"') "tables/index.html: should load js/structure.js as the sheet structure layer"
  Assert-True ($tablesHtml -match 'src="js/grid\.js"[\s\S]*src="js/structure\.js"[\s\S]*src="js/workbook\.js"') "tables/index.html: js/structure.js should load after grid.js and before workbook.js"
  Assert-True ($tablesHtml -match 'src="js/charts\.js"') "tables/index.html: should load js/charts.js as the chart layer"
  Assert-True ($tablesHtml -match 'src="js/workbook\.js"[\s\S]*src="js/charts\.js"[\s\S]*src="js/ui\.js"') "tables/index.html: js/charts.js should load after workbook.js and before ui.js"
  foreach ($tablesUiModule in @('sorting', 'workbook-file', 'xlsx-file', 'view-options', 'cell-format-ui')) {
    Assert-True ($tablesHtml -match "src=""js/$tablesUiModule\.js""") "tables/index.html: should load js/$tablesUiModule.js as a UI sublayer"
    Assert-True ($tablesHtml -match "src=""js/ui\.js""[\s\S]*src=""js/$tablesUiModule\.js""[\s\S]*src=""js/calculation\.js""") "tables/index.html: js/$tablesUiModule.js should load after ui.js and before calculation.js"
  }
  Assert-True ($tablesHtml -match 'src="js/calculation\.js"') "tables/index.html: should load js/calculation.js as the calculation layer"
  Assert-True ($tablesHtml -match 'src="js/ui\.js"[\s\S]*src="js/calculation\.js"[\s\S]*src="js/app\.js"') "tables/index.html: js/calculation.js should load after ui.js and before app.js"
  Assert-True ($tablesHtml -match 'src="js/app\.js"') "tables/index.html: should load js/app.js as the boot and command layer"
  Assert-True ($tablesHtml -match 'src="js/runtime\.js"') "tables/index.html: should load js/runtime.js as the runtime entrypoint"
  Assert-True ($tablesHtml -notmatch 'src="logic\.js"|src="js/app-core\.js"|src="js/main\.js"') "tables/index.html: should not load legacy table script names after js/ migration"
}

$tablesAddressingPath = Join-Path $Root 'tables/js/addressing.js'
if (Test-Path $tablesAddressingPath) {
  $tablesAddressing = Get-Content -Raw -Encoding UTF8 $tablesAddressingPath
  Assert-True ($tablesAddressing -match 'window\.TablesAddressing\s*=') "tables/js/addressing.js: should expose a stable TablesAddressing namespace"
  foreach ($addressingFunction in @('buildCols', 'colToIndex', 'expandRange', 'indexToCol', 'shiftFormulaRefs')) {
    Assert-True ($tablesAddressing -match "function $addressingFunction\(") "tables/js/addressing.js: should own $addressingFunction"
  }
}

$tablesModelPath = Join-Path $Root 'tables/js/model.js'
if (Test-Path $tablesModelPath) {
  $tablesModel = Get-Content -Raw -Encoding UTF8 $tablesModelPath
  Assert-True ($tablesModel -match 'window\.TablesModel\s*=') "tables/js/model.js: should expose a stable TablesModel namespace"
  foreach ($modelBinding in @('DEFAULT_ROWS', 'DEFAULT_COL_COUNT', 'ROWS', 'COL_COUNT', 'cellData', 'cellStyles', 'colWidths')) {
    Assert-True ($tablesModel -match "\b$modelBinding\b") "tables/js/model.js: should own shared model binding $modelBinding"
  }
  Assert-True ($tablesModel -match 'function setGridSize\(') "tables/js/model.js: should own setGridSize"
}

$tablesStoragePath = Join-Path $Root 'tables/js/storage.js'
if (Test-Path $tablesStoragePath) {
  $tablesStorage = Get-Content -Raw -Encoding UTF8 $tablesStoragePath
  Assert-True ($tablesStorage -match 'window\.TablesStorage\s*=') "tables/js/storage.js: should expose a stable TablesStorage namespace"
  foreach ($storageFunction in @('loadStateFromStorage', 'persistStateToStorage', 'flushStateToStorage', 'clearStateFromStorage', 'safeGetItem', 'safeParseJSON', 'safeSetItem')) {
    Assert-True ($tablesStorage -match "function $storageFunction\(") "tables/js/storage.js: should own $storageFunction"
  }
  Assert-True ($tablesStorage -match "createDraftStore\(\{[\s\S]*app:\s*'tables'") "tables/js/storage.js: persistence must use the shared Tables draft store"
  Assert-True ($tablesStorage -match 'STORAGE_DEBOUNCE_MS\s*=\s*250') "tables/js/storage.js: persistence debounce must be 250 ms"
}

$xlsxAdapterPath = Join-Path $Root 'tables/js/xlsx-file.js'
if (Test-Path $xlsxAdapterPath) {
  $xlsxAdapter = Get-Content -Raw -Encoding UTF8 $xlsxAdapterPath
  Assert-True ($xlsxAdapter -match 'root\.TablesXlsxFile\s*=') 'tables/js/xlsx-file.js: should expose TablesXlsxFile'
  Assert-True ($xlsxAdapter -match 'DecompressionStream') 'tables/js/xlsx-file.js: should decompress locally in the browser'
  # Blob.stream() читається поза подіями сторінки: headless smoke під virtual-time-budget знімав DOM до кінця імпорту.
  Assert-True ($xlsxAdapter -notmatch 'Blob\([^)]*\)\.stream\(\)') 'tables/js/xlsx-file.js: should feed DecompressionStream from bytes, not Blob.stream()'
  Assert-True ($xlsxAdapter -notmatch 'https?://[^"'']+\.js') 'tables/js/xlsx-file.js: must not load a CDN dependency'
}

$flowchartsSvgPath = Join-Path $Root 'flowcharts/js/svg-export.js'
if (Test-Path $flowchartsSvgPath) {
  $flowchartsSvg = Get-Content -Raw -Encoding UTF8 $flowchartsSvgPath
  Assert-True ($flowchartsSvg -match 'root\.FlowchartsSvgExport\s*=') 'flowcharts/js/svg-export.js: should expose FlowchartsSvgExport'
  Assert-True ($flowchartsSvg -notmatch 'foreignObject') 'flowcharts/js/svg-export.js: must use native SVG text instead of foreignObject'
  Assert-True ($flowchartsSvg -match '\.textContent\s*=') 'flowcharts/js/svg-export.js: should assign untrusted labels with textContent'
}

$tablesViewportPath = Join-Path $Root 'tables/js/grid-viewport.js'
if (Test-Path $tablesViewportPath) {
  $tablesViewport = Get-Content -Raw -Encoding UTF8 $tablesViewportPath
  Assert-True ($tablesViewport -match 'window\.TablesGridViewport|const TablesGridViewport\s*=') "tables/js/grid-viewport.js: should expose a viewport contract"
  Assert-True ($tablesViewport -match 'ROW_OVERSCAN\s*=\s*5') "tables/js/grid-viewport.js: row overscan must be 5"
  Assert-True ($tablesViewport -match 'COL_OVERSCAN\s*=\s*2') "tables/js/grid-viewport.js: column overscan must be 2"
  Assert-True ($tablesViewport -match 'function ensureCellVisible\(') "tables/js/grid-viewport.js: must expose ensureCellVisible"
}

$tablesWorkbookPath = Join-Path $Root 'tables/js/workbook.js'
if (Test-Path $tablesWorkbookPath) {
  $tablesWorkbook = Get-Content -Raw -Encoding UTF8 $tablesWorkbookPath
  Assert-True ($tablesWorkbook -match '\^\[=\+\\-@\\t\\r\]') "tables/js/workbook.js: CSV text values must be protected from formula injection"
  foreach ($fixture in @('=CMD', '+SUM', '-1+1', '@IMPORT')) {
    Assert-True ((Get-Content -Raw -Encoding UTF8 (Join-Path $Root 'tests/tables-storage-viewport-behavior.html')) -match [regex]::Escape($fixture)) "Tables CSV behavior test must cover $fixture"
  }
  Assert-True ($slidesModalUi -match 'bodyNode\s*=\s*null') "slides/js/modal-ui.js: showModal must accept bodyNode"
  Assert-True ($slidesModalUi -notmatch '\binnerHTML\b') "slides/js/modal-ui.js: modal content must not use innerHTML"
  Assert-True ($slidesModalUi -notmatch '\bbody\s*=\s*[''"]') "slides/js/modal-ui.js: modal API must not accept HTML body strings"
}

$slidesAppPath = Join-Path $Root 'slides/js/app.js'
$slidesChartControllerPath = Join-Path $Root 'slides/js/chart-controller.js'
$slidesTableControllerPath = Join-Path $Root 'slides/js/table-controller.js'
foreach ($safeModalFile in @($slidesAppPath, $slidesChartControllerPath, $slidesTableControllerPath)) {
  if (-not (Test-Path $safeModalFile)) { continue }
  $safeModalSource = Get-Content -Raw -Encoding UTF8 $safeModalFile
  Assert-True ($safeModalSource -notmatch '(?m)^\s*body\s*:') "$([IO.Path]::GetFileName($safeModalFile)): modal callers must pass bodyNode, not HTML strings"
}
if (Test-Path $slidesAppPath) {
  $slidesAppSource = Get-Content -Raw -Encoding UTF8 $slidesAppPath
  Assert-True ($slidesAppSource -notmatch '\bfetch\s*\(') "slides/js/app.js: arbitrary network image loading must remain disabled"
  Assert-True ($slidesAppSource -notmatch 'imageUrlField') "slides/js/app.js: image modal must not expose an external URL field"
}

$tablesFormulaParserPath = Join-Path $Root 'tables/js/formula-parser.js'
if (Test-Path $tablesFormulaParserPath) {
  $tablesFormulaParser = Get-Content -Raw -Encoding UTF8 $tablesFormulaParserPath
  Assert-True ($tablesFormulaParser -match 'window\.TablesFormulaParser\s*=') "tables/js/formula-parser.js: should expose a stable TablesFormulaParser namespace"
  foreach ($formulaParserFunction in @('tokenizeFormula', 'parseFormula')) {
    Assert-True ($tablesFormulaParser -match "function $formulaParserFunction\(") "tables/js/formula-parser.js: should own $formulaParserFunction"
  }
}

$tablesFormulaReferencesPath = Join-Path $Root 'tables/js/formula-references.js'
if (Test-Path $tablesFormulaReferencesPath) {
  $tablesFormulaReferences = Get-Content -Raw -Encoding UTF8 $tablesFormulaReferencesPath
  Assert-True ($tablesFormulaReferences -match 'window\.TablesFormulaReferences\s*=') "tables/js/formula-references.js: should expose a stable TablesFormulaReferences namespace"
  foreach ($formulaReferenceFunction in @('getCellValueByIndex', 'rangeToValues')) {
    Assert-True ($tablesFormulaReferences -match "function $formulaReferenceFunction\(") "tables/js/formula-references.js: should own $formulaReferenceFunction"
  }
}

$tablesFormulaFunctionsPath = Join-Path $Root 'tables/js/formula-functions.js'
if (Test-Path $tablesFormulaFunctionsPath) {
  $tablesFormulaFunctions = Get-Content -Raw -Encoding UTF8 $tablesFormulaFunctionsPath
  Assert-True ($tablesFormulaFunctions -match 'window\.TablesFormulaFunctions\s*=') "tables/js/formula-functions.js: should expose a stable TablesFormulaFunctions namespace"
  Assert-True ($tablesFormulaFunctions -match 'const FORMULA_FUNCTIONS\s*=') "tables/js/formula-functions.js: should own the FORMULA_FUNCTIONS registry"
  foreach ($formulaFunction in @('SUM', 'AVERAGE', 'COUNT', 'IF', 'ROUND', 'MOD', 'COUNTIF', 'SUMIF', 'AVERAGEIF', 'TODAY', 'NOW', 'DATE')) {
    Assert-True ($tablesFormulaFunctions -match "(?m)^\s*$formulaFunction\s*:") "tables/js/formula-functions.js: registry should define $formulaFunction"
  }
}

$tablesFormulaEnginePath = Join-Path $Root 'tables/js/formula-engine.js'
if (Test-Path $tablesFormulaEnginePath) {
  $tablesFormulaEngine = Get-Content -Raw -Encoding UTF8 $tablesFormulaEnginePath
  Assert-True ($tablesFormulaEngine -match 'window\.TablesFormulaEngine\s*=') "tables/js/formula-engine.js: should expose a stable TablesFormulaEngine namespace"
  Assert-True ($tablesFormulaEngine -match 'function evaluateFormula\(') "tables/js/formula-engine.js: should own evaluateFormula"
}

$tablesCorePath = Join-Path $Root 'tables/js/core.js'
if (Test-Path $tablesCorePath) {
  $tablesCore = Get-Content -Raw -Encoding UTF8 $tablesCorePath
  Assert-True ($tablesCore -match 'window\.TablesCore\s*=') "tables/js/core.js: should expose the split core facade"
  $tablesAppSource = Get-Content -Raw -Encoding UTF8 (Join-Path $Root 'tables/js/app.js')
  Assert-True ($tablesAppSource -match 'async function initTablesEditor\(\)[\s\S]*await loadStateFromStorage\(\)') "tables/js/app.js: async boot should await persisted state before rendering"
}

$tablesColumnSizingPath = Join-Path $Root 'tables/js/column-sizing.js'
if (Test-Path $tablesColumnSizingPath) {
  $tablesColumnSizing = Get-Content -Raw -Encoding UTF8 $tablesColumnSizingPath
  Assert-True ($tablesColumnSizing -match 'window\.TablesColumnSizing\s*=') "tables/js/column-sizing.js: should expose a stable TablesColumnSizing namespace"
  foreach ($columnSizingFunction in @('applyColWidths', 'resizeColumn', 'startResize')) {
    Assert-True ($tablesColumnSizing -match "function $columnSizingFunction\(") "tables/js/column-sizing.js: should own $columnSizingFunction"
  }
}

$tablesFormulaBarPath = Join-Path $Root 'tables/js/formula-bar.js'
if (Test-Path $tablesFormulaBarPath) {
  $tablesFormulaBar = Get-Content -Raw -Encoding UTF8 $tablesFormulaBarPath
  Assert-True ($tablesFormulaBar -match 'window\.TablesFormulaBar\s*=') "tables/js/formula-bar.js: should expose a stable TablesFormulaBar namespace"
  Assert-True ($tablesFormulaBar -match 'function insertChar\(') "tables/js/formula-bar.js: should own insertChar"
}

$tablesClipboardPath = Join-Path $Root 'tables/js/clipboard.js'
if (Test-Path $tablesClipboardPath) {
  $tablesClipboard = Get-Content -Raw -Encoding UTF8 $tablesClipboardPath
  Assert-True ($tablesClipboard -match 'window\.TablesClipboard\s*=') "tables/js/clipboard.js: should expose a stable TablesClipboard namespace"
  foreach ($clipboardFunction in @('applyTsvToGridData', 'copySelectionToClipboard', 'pasteToGrid', 'serializeSelectionToTsv')) {
    Assert-True ($tablesClipboard -match "function $clipboardFunction\(") "tables/js/clipboard.js: should own $clipboardFunction"
  }
}

$tablesSelectionActionsPath = Join-Path $Root 'tables/js/selection-actions.js'
if (Test-Path $tablesSelectionActionsPath) {
  $tablesSelectionActions = Get-Content -Raw -Encoding UTF8 $tablesSelectionActionsPath
  Assert-True ($tablesSelectionActions -match 'window\.TablesSelectionActions\s*=') "tables/js/selection-actions.js: should expose a stable TablesSelectionActions namespace"
  foreach ($selectionActionFunction in @('applyFunc', 'deleteSelection')) {
    Assert-True ($tablesSelectionActions -match "function $selectionActionFunction\(") "tables/js/selection-actions.js: should own $selectionActionFunction"
  }
}

$tablesFormattingPath = Join-Path $Root 'tables/js/formatting.js'
if (Test-Path $tablesFormattingPath) {
  $tablesFormatting = Get-Content -Raw -Encoding UTF8 $tablesFormattingPath
  Assert-True ($tablesFormatting -match 'window\.TablesFormatting\s*=') "tables/js/formatting.js: should expose a stable TablesFormatting namespace"
  foreach ($formattingFunction in @('applyStyleToSelection', 'autoFitColumns', 'cycleColor', 'toggleStyle')) {
    Assert-True ($tablesFormatting -match "function $formattingFunction\(") "tables/js/formatting.js: should own $formattingFunction"
  }
}

$tablesStructurePath = Join-Path $Root 'tables/js/structure.js'
if (Test-Path $tablesStructurePath) {
  $tablesStructure = Get-Content -Raw -Encoding UTF8 $tablesStructurePath
  Assert-True ($tablesStructure -match 'window\.TablesStructure\s*=') "tables/js/structure.js: should expose a stable TablesStructure namespace"
  foreach ($structureFunction in @('insertRow', 'deleteRow', 'insertColumn', 'deleteColumn', 'updateInsertHover')) {
    Assert-True ($tablesStructure -match "function $structureFunction\(") "tables/js/structure.js: should own $structureFunction"
  }
}

$tablesChartPath = Join-Path $Root 'tables/js/charts.js'
if (Test-Path $tablesChartPath) {
  $tablesCharts = Get-Content -Raw -Encoding UTF8 $tablesChartPath
  Assert-True ($tablesCharts -match 'window\.TablesCharts\s*=') "tables/js/charts.js: should expose a stable TablesCharts namespace"
  Assert-True ($tablesCharts -match 'function makeChart\(') "tables/js/charts.js: should own chart creation from selected ranges"
  Assert-True ($tablesCharts -match 'function setChartType\(') "tables/js/charts.js: should own chart type switching"
}

$tablesSortingPath = Join-Path $Root 'tables/js/sorting.js'
if (Test-Path $tablesSortingPath) {
  $tablesSorting = Get-Content -Raw -Encoding UTF8 $tablesSortingPath
  Assert-True ($tablesSorting -match 'window\.TablesSorting\s*=') "tables/js/sorting.js: should expose a stable TablesSorting namespace"
  foreach ($sortingFunction in @('compareSortValues', 'sortSelection')) {
    Assert-True ($tablesSorting -match "function $sortingFunction\(") "tables/js/sorting.js: should own $sortingFunction"
  }
}

$tablesWorkbookFilePath = Join-Path $Root 'tables/js/workbook-file.js'
if (Test-Path $tablesWorkbookFilePath) {
  $tablesWorkbookFile = Get-Content -Raw -Encoding UTF8 $tablesWorkbookFilePath
  Assert-True ($tablesWorkbookFile -match 'window\.TablesWorkbookFile\s*=') "tables/js/workbook-file.js: should expose a stable TablesWorkbookFile namespace"
  foreach ($workbookFileFunction in @('exportWorkbook', 'importWorkbookText', 'triggerWorkbookImport')) {
    Assert-True ($tablesWorkbookFile -match "function $workbookFileFunction\(") "tables/js/workbook-file.js: should own $workbookFileFunction"
  }
}

$tablesViewOptionsPath = Join-Path $Root 'tables/js/view-options.js'
if (Test-Path $tablesViewOptionsPath) {
  $tablesViewOptions = Get-Content -Raw -Encoding UTF8 $tablesViewOptionsPath
  Assert-True ($tablesViewOptions -match 'window\.TablesViewOptions\s*=') "tables/js/view-options.js: should expose a stable TablesViewOptions namespace"
  foreach ($viewOptionsFunction in @('changeTheme', 'setZoom')) {
    Assert-True ($tablesViewOptions -match "function $viewOptionsFunction\(") "tables/js/view-options.js: should own $viewOptionsFunction"
  }
}

$tablesCellFormatUiPath = Join-Path $Root 'tables/js/cell-format-ui.js'
if (Test-Path $tablesCellFormatUiPath) {
  $tablesCellFormatUi = Get-Content -Raw -Encoding UTF8 $tablesCellFormatUiPath
  Assert-True ($tablesCellFormatUi -match 'window\.TablesCellFormatUi\s*=') "tables/js/cell-format-ui.js: should expose a stable TablesCellFormatUi namespace"
  foreach ($cellFormatUiFunction in @('applyNumberFormat', 'formatDisplayValue', 'getSelectionStats', 'updateSelectionStats', 'updateToolbarState')) {
    Assert-True ($tablesCellFormatUi -match "function $cellFormatUiFunction\(") "tables/js/cell-format-ui.js: should own $cellFormatUiFunction"
  }
}

$tablesCalculationPath = Join-Path $Root 'tables/js/calculation.js'
if (Test-Path $tablesCalculationPath) {
  $tablesCalculation = Get-Content -Raw -Encoding UTF8 $tablesCalculationPath
  Assert-True ($tablesCalculation -match 'window\.TablesCalculation\s*=') "tables/js/calculation.js: should expose a stable TablesCalculation namespace"
  Assert-True ($tablesCalculation -match 'function recalculateAll\(') "tables/js/calculation.js: should own recalculateAll"
}

$tablesAppPath = Join-Path $Root 'tables/js/app.js'
if (Test-Path $tablesAppPath) {
  $tablesApp = Get-Content -Raw -Encoding UTF8 $tablesAppPath
  Assert-True ($tablesApp -match 'window\.TablesApp\s*=\s*window\.TablesApp\s*\|\|\s*\{\}') "tables/js/app.js: should expose a stable TablesApp facade"
  Assert-True ($tablesApp -match 'window\.TablesApp\.boot\s*=') "tables/js/app.js: should expose TablesApp.boot as the stable boot function"
  Assert-True ($tablesApp -match 'window\.initTablesApp\s*=\s*initTablesEditor') "tables/js/app.js: should keep initTablesApp as a compatibility alias"
  Assert-True ($tablesApp -match 'Office(?:UI|Shell)\?*\.registerCommands\?*\.') "tables/js/app.js: should register standard shell commands"
}

$tablesRuntimePath = Join-Path $Root 'tables/js/runtime.js'
if (Test-Path $tablesRuntimePath) {
  $tablesRuntime = Get-Content -Raw -Encoding UTF8 $tablesRuntimePath
  Assert-True ($tablesRuntime -match 'window\.TablesApp\?\.boot\?\.') "tables/js/runtime.js: runtime should boot through the TablesApp facade"
}

$slidesAppPath = Join-Path $Root 'slides/js/app.js'
if (Test-Path $slidesAppPath) {
  $slidesApp = Get-Content -Raw -Encoding UTF8 $slidesAppPath
  Assert-True ($slidesApp -match 'window\.SlidesApp\s*=\s*window\.SlidesApp\s*\|\|\s*\{\}') "slides/js/app.js: should expose a stable SlidesApp facade"
  Assert-True ($slidesApp -match 'window\.SlidesApp\.boot\s*=') "slides/js/app.js: should expose SlidesApp.boot as the stable boot function"
  Assert-True ($slidesApp -notmatch 'DOMContentLoaded') "slides/js/app.js: app module should not self-boot after runtime split"
  Assert-True ($slidesApp -match 'function\s+renderAll\(\)\s*\{[\s\S]*?renderFileName\(\);[\s\S]*?renderColorPalette\(\);[\s\S]*?renderWorkspace\(\);[\s\S]*?\}') "slides/js/app.js: full render should delegate workspace rendering after filename and palette"
  Assert-True ($slidesApp -match 'function\s+renderWorkspace\(\)\s*\{[\s\S]*?renderStage\(\);[\s\S]*?renderSlideList\(\);[\s\S]*?renderToolbarState\(\);[\s\S]*?renderStatus\(\);[\s\S]*?\}') "slides/js/app.js: workspace render should keep stage, thumbnails, toolbar, and status together"
  Assert-True ($slidesApp -match 'function\s+renderCurrentSlideWorkspace\(\)\s*\{[\s\S]*?renderStage\(\);[\s\S]*?renderCurrentSlideThumbnail\(\);[\s\S]*?renderToolbarState\(\);[\s\S]*?renderStatus\(\);[\s\S]*?\}') "slides/js/app.js: current-slide changes should update only the active thumbnail"
  Assert-True ($slidesApp -match "import\s+\{\s*createTableController\s*\}\s+from\s+['""]\.\/table-controller\.js['""]") "slides/js/app.js: should delegate table orchestration to table-controller.js"
  Assert-True ($slidesApp -notmatch "from\s+['""]\.\/table-element\.js['""]") "slides/js/app.js: should not import table domain operations directly"
  Assert-True ($slidesApp -match "import\s+\{\s*createChartController\s*\}\s+from\s+['""]\.\/chart-controller\.js['""]") "slides/js/app.js: should delegate chart orchestration to chart-controller.js"
  Assert-True ($slidesApp -notmatch "from\s+['""]\.\/chart-element\.js['""]") "slides/js/app.js: should not import chart domain operations directly"
}

$slidesRuntimePath = Join-Path $Root 'slides/js/runtime.js'
if (Test-Path $slidesRuntimePath) {
  $slidesRuntime = Get-Content -Raw -Encoding UTF8 $slidesRuntimePath
  Assert-True ($slidesRuntime -match 'window\.SlidesApp\?\.boot\?\.') "slides/js/runtime.js: runtime should boot through the SlidesApp facade"
}

$textIndexPath = Join-Path $Root 'text/index.html'
if (Test-Path $textIndexPath) {
  $textHtml = Get-Content -Raw -Encoding UTF8 $textIndexPath
  Assert-True ($textHtml -match 'src="js/app\.js"') "text/index.html: should load js/app.js as the local boot layer"
  Assert-True ($textHtml -match 'src="js/runtime\.js"') "text/index.html: should load js/runtime.js as the runtime entrypoint"
  Assert-True ($textHtml -notmatch 'src="app\.js"') "text/index.html: should not load the legacy root app.js path after js/ migration"
  Assert-True ($textHtml -match 'src="\.\./office-storage\.js"[\s\S]*src="core/storage\.js"[\s\S]*src="js/app\.js"') "text/index.html: shared and Text storage modules must load before app boot"
}

$textStoragePath = Join-Path $Root 'text/core/storage.js'
if (Test-Path $textStoragePath) {
  $textStorage = Get-Content -Raw -Encoding UTF8 $textStoragePath
  Assert-True ($textStorage -match "createDraftStore\(\{[\s\S]*app:\s*'text'[\s\S]*key:\s*'text'") "text/core/storage.js: must use the shared Text draft store"
  Assert-True ($textStorage -match 'MAX_DRAFT_BYTES\s*=\s*8\s*\*\s*1024\s*\*\s*1024') "text/core/storage.js: draft size must be capped at 8 MiB"
  Assert-True ($textStorage -match 'AUTOSAVE_DELAY_MS\s*=\s*300') "text/core/storage.js: autosave debounce must be 300 ms"
  Assert-True ($textStorage -match "visibilitychange" -and $textStorage -match "pagehide") "text/core/storage.js: must flush on visibilitychange and pagehide"
  Assert-True ($textStorage -match 'bootRevision[\s\S]*getDocumentRevision') "text/core/storage.js: restore must be guarded by a boot revision"
}

$textEditorPath = Join-Path $Root 'text/ui/editor.js'
if (Test-Path $textEditorPath) {
  $textEditor = Get-Content -Raw -Encoding UTF8 $textEditorPath
  foreach ($method in @('getDraftPayload', 'restoreDraft', 'clearDocument')) {
    Assert-True ($textEditor -match "function $method\(") "text/ui/editor.js: expected public $method method"
  }
  foreach ($limit in @('MAX_TEXT_FILE_BYTES', 'MAX_DOCX_FILE_BYTES', 'MAX_IMAGE_FILE_BYTES', 'MAX_IMAGE_PIXELS')) {
    Assert-True ($textEditor -match "const $limit\s*=") "text/ui/editor.js: missing $limit import limit"
  }
  Assert-True ($textEditor -match 'createImageBitmap' -and $textEditor -match 'URL\.revokeObjectURL') "text/ui/editor.js: image dimensions must be decoded safely and object URLs revoked"
}

$textFindPath = Join-Path $Root 'text/ui/find.js'
Assert-True (Test-Path $textFindPath) 'text/ui/find.js: search and replace module must exist'
if (Test-Path $textFindPath) {
  $textFind = Get-Content -Raw -Encoding UTF8 $textFindPath
  # Пошук не змінює документ: підсвітка через CSS Custom Highlight API, а не <mark> у DOM.
  Assert-True ($textFind -match 'CSS\.highlights') 'text/ui/find.js: match highlights must not mutate the document DOM'
  Assert-True ($textFind -notmatch 'surroundContents|search-hit|innerHTML') 'text/ui/find.js: must not wrap matches or write HTML'
  Assert-True ($textFind -match 'tr\[data-art-table-repeat\]') 'text/ui/find.js: repeated table headers must be excluded from search'
}

$textIndexPath = Join-Path $Root 'text/index.html'
if (Test-Path $textIndexPath) {
  $textIndex = Get-Content -Raw -Encoding UTF8 $textIndexPath
  # Перемикач правопису має реальний checked-стан, а пояснення не обіцяє офлайн-словник.
  Assert-True ($textIndex -match '<button[^>]*data-action="toggle-spellcheck"[^>]*role="menuitemcheckbox"[^>]*aria-checked="(true|false)"') 'text/index.html: spellcheck toggle must be a menuitemcheckbox with aria-checked'
  Assert-True ($textIndex -match 'id="spellcheckHelp"') 'text/index.html: help must explain where the spellcheck dictionary comes from'
}

$textStylePath = Join-Path $Root 'text/style.css'
$textDocxPath = Join-Path $Root 'text/formats/docx.js'
if ((Test-Path $textStylePath) -and (Test-Path $textDocxPath)) {
  $textStyle = Get-Content -Raw -Encoding UTF8 $textStylePath
  $textDocx = Get-Content -Raw -Encoding UTF8 $textDocxPath
  # C2(а): розрив сторінки не додає зайвої сторінки в друку й переноситься в DOCX.
  Assert-True ($textStyle -match '@media print[\s\S]*hr\[style\*="break-after"\][\s\S]*?break-after:\s*auto\s*!important') 'text/style.css: print must neutralize the inline break of a page break'
  Assert-True ($textDocx -match 'new PageBreak\(\)' -and $textDocx -match "breakType === 'page'") 'text/formats/docx.js: page breaks must be exported and imported'
  # C2(б): колонтитули не є абзацами: на екрані — окремий шар аркуша, у друку — поля @page, у DOCX — Header/Footer.
  Assert-True ($textStyle -match '@media print[\s\S]*\.page-chrome\s*\{\s*display:\s*none') 'text/style.css: print must hide the screen header/footer layer'
  Assert-True ($textDocx -match 'PageNumber\.CURRENT' -and $textDocx -match 'word\\/\(header\|footer\)') 'text/formats/docx.js: header/footer must be exported and flagged on import'
  $textPagePath = Join-Path $Root 'text/ui/page.js'
  if (Test-Path $textPagePath) {
    $textPage = Get-Content -Raw -Encoding UTF8 $textPagePath
    Assert-True ($textPage -match '@top-center' -and $textPage -match 'counter\(page\)') 'text/ui/page.js: header, footer and page numbers must print in page margin boxes'
  }
  # C2(в): зміст — абзаци з позначкою, що проходить санітайзер; у DOCX — крапкова табуляція й попередження.
  $textSanitizePath = Join-Path $Root 'text/core/sanitize.js'
  if (Test-Path $textSanitizePath) {
    $textSanitize = Get-Content -Raw -Encoding UTF8 $textSanitizePath
    Assert-True ($textSanitize -match "'data-art-toc'") 'text/core/sanitize.js: the table of contents marker must survive sanitizing'
  }
  Assert-True ($textDocx -match 'LeaderType\.DOT' -and $textDocx -match "querySelector\('\[data-art-toc\]'\)") 'text/formats/docx.js: table of contents must export with dot leaders and warn before saving'
  Assert-True ($textStyle -match '@media print[\s\S]*data-art-toc-stale\]::after\s*\{\s*content:\s*none') 'text/style.css: the stale table of contents marker must not print'
  # C2(г): розділ — розрив сторінки з data-art-section; друк через іменовані сторінки, DOCX — розділи Word.
  if (Test-Path $textSanitizePath) {
    Assert-True ($textSanitize -match "'data-art-section'") 'text/core/sanitize.js: section settings must survive sanitizing'
  }
  Assert-True ($textDocx -match "hasAttribute\('data-art-section'\)" -and $textDocx -match '<w:sectPr') 'text/formats/docx.js: section breaks must export as Word sections and be flagged on import'
  if (Test-Path $textPagePath) {
    Assert-True ($textPage -match 'function setSectionPrintPages' -and $textPage -match 'function normalizeSettings') 'text/ui/page.js: sections must print as named pages with validated settings'
  }
  # C2(ґ): колонки заповнюються по черзі й переносяться в DOCX як колонки розділу Word.
  Assert-True ($textStyle -match '\.page-content\s*\{\s*column-gap:\s*1\.25cm;\s*column-fill:\s*auto;') 'text/style.css: columns must fill in order on screen and in print'
  Assert-True ($textStyle -match '@media print[\s\S]*?\.page\s*\{\s*width:\s*100%;') 'text/style.css: printed pages must use the full print width so columns stay on paper'
  Assert-True ($textStyle -match '@media print[\s\S]*?\.pages-wrap\s*\{[^}]*min-width:\s*0\s*!important') 'text/style.css: print must not size the page stack to the unbounded max-content of columns'
  Assert-True ($textStyle -match '@media print[\s\S]*?\.pages-wrap\s*\{[^}]*justify-content:\s*flex-start') 'text/style.css: print must start the page stack at the left edge so wider section pages stay on paper'
  Assert-True ($textStyle -match '@media print[\s\S]*?body,\s*html\s*\{[^}]*background:\s*#fff\s*!important') 'text/style.css: print must paint html and body white so the shell background does not show under the last page'
  Assert-True ($textStyle -match '@media print[\s\S]*?\.page-content\s*\{\s*height:\s*auto;\s*column-fill:\s*balance;') 'text/style.css: printed columns must balance so one page stays on one sheet'
  if (Test-Path $textPagePath) {
    Assert-True ($textPage -match 'function _printTextWidth') 'text/ui/page.js: printed pages must get an exact text width in centimetres'
    Assert-True ($textPage -match 'Math\.min\(\.\.\.widths\)' -and $textPage -match '\.pages-wrap, #editor\.document-editor \{ width:') 'text/ui/page.js: with sections every printed page and the page stack must use the narrowest section text width, or Chrome scales the whole print down'
  }
  Assert-True ($textDocx -match 'column:\s*\{\s*count:\s*columns' -and $textDocx -match 'w:cols') 'text/formats/docx.js: columns must export as Word section columns and be flagged on import'
}

$textHistoryPath = Join-Path $Root 'text/core/history.js'
if (Test-Path $textHistoryPath) {
  $textHistory = Get-Content -Raw -Encoding UTF8 $textHistoryPath
  Assert-True ($textHistory -match 'MAX_HISTORY_ENTRIES\s*=\s*80') "text/core/history.js: history entry limit must be 80"
  Assert-True ($textHistory -match 'MAX_HISTORY_BYTES\s*=\s*24\s*\*\s*1024\s*\*\s*1024') "text/core/history.js: history byte limit must be 24 MiB"
  # C1: історія зберігає логічний потік, а не сторінковий DOM.
  Assert-True ($textHistory -match 'ArtDocumentModel\.serialize\(') "text/core/history.js: snapshots must use the logical document serializer"
  Assert-True ($textHistory -notmatch 'html:\s*_editor\.innerHTML') "text/core/history.js: snapshots must not store the paginated editor DOM"
  Assert-True (Test-Path (Join-Path $Root 'text/core/document-model.js')) "text/core/document-model.js: logical document model must exist"
}

$textDocxPath = Join-Path $Root 'text/formats/docx.js'
if (Test-Path $textDocxPath) {
  $textDocx = Get-Content -Raw -Encoding UTF8 $textDocxPath
  foreach ($limit in @('MAX_IMPORTED_DOM_NODES', 'MAX_IMPORTED_TEXT_CHARS', 'MAX_IMPORTED_IMAGES')) {
    Assert-True ($textDocx -match "const $limit\s*=") "text/formats/docx.js: missing post-conversion $limit limit"
  }
  Assert-True ($textDocx -match '_validateConvertedHtml\(html\)') "text/formats/docx.js: converted HTML must be validated before import"
}

$textAppPath = Join-Path $Root 'text/js/app.js'
if (Test-Path $textAppPath) {
  $textApp = Get-Content -Raw -Encoding UTF8 $textAppPath
  Assert-True ($textApp -match 'window\.TextApp\s*=') "text/js/app.js: should expose TextApp facade"
  Assert-True ($textApp -match 'Office(?:UI|Shell)\?*\.registerCommands\?*\.') "text/js/app.js: should register standard shell commands"
}

$textRuntimePath = Join-Path $Root 'text/js/runtime.js'
if (Test-Path $textRuntimePath) {
  $textRuntime = Get-Content -Raw -Encoding UTF8 $textRuntimePath
  Assert-True ($textRuntime -match 'window\.TextApp\?\.boot\?\.') "text/js/runtime.js: runtime should boot through TextApp"
}
if (Test-Path $textIndexPath) {
  $textHtml = Get-Content -Raw -Encoding UTF8 $textIndexPath
  $textModalStart = $textHtml.IndexOf('<!-- Зберегти як -->')
  $textModalEnd = $textHtml.IndexOf('<!-- ════════════════════════════════════════', [Math]::Max(0, $textModalStart + 1))
  if ($textModalStart -ge 0 -and $textModalEnd -gt $textModalStart) {
    $textModalHtml = $textHtml.Substring($textModalStart, $textModalEnd - $textModalStart)
    Assert-True ($textModalHtml -notmatch '\son(?:click|keydown)=') "text/index.html: modal inline handlers should stay migrated to data attributes and JS bindings"
  }
}

$officeShellPath = Join-Path $Root 'office-shell.js'
if (Test-Path $officeShellPath) {
  $officeShell = Get-Content -Raw -Encoding UTF8 $officeShellPath
  Assert-True ($officeShell -match 'function runCommand\(') "office-shell.js: expected shared runCommand helper for editor shell adapters"
  Assert-True ($officeShell -match 'function openFilePicker\(') "office-shell.js: expected shared openFilePicker helper for editor shell adapters"
  Assert-True ($officeShell -match 'function registerCommands\(') "office-shell.js: expected shared registerCommands helper for editor shell adapters"
  Assert-True ($officeShell -match 'function bootEditor\(') "office-shell.js: expected shared bootEditor helper for standard editor boot flow"
  Assert-True ($officeShell -match 'window\.OfficeShell\s*=') "office-shell.js: helper API must be exported on window.OfficeShell"
}

$officeStoragePath = Join-Path $Root 'office-storage.js'
if (Test-Path $officeStoragePath) {
  $officeStorage = Get-Content -Raw -Encoding UTF8 $officeStoragePath
  foreach ($storageFunction in @('createDraftStore', 'clearAllKnownDrafts', 'getDraftStatus')) {
    Assert-True ($officeStorage -match "function $storageFunction\(") "office-storage.js: expected shared $storageFunction API"
    Assert-True ($officeStorage -match "\b$storageFunction[,\s]") "office-storage.js: $storageFunction must be exported on window.OfficeStorage"
  }
  foreach ($draftMethod in @('load', 'save', 'clear', 'flush', 'getStatus')) {
    Assert-True ($officeStorage -match "\b$draftMethod[,\s]") "office-storage.js: draft store must expose $draftMethod"
  }
  Assert-True ($officeStorage -match "CustomEvent\('office:storage-error'") "office-storage.js: storage failures must emit office:storage-error"
  Assert-True ($officeStorage -match 'schemaVersion:\s*SCHEMA_VERSION[\s\S]*savedAt:\s*Date\.now\(\)[\s\S]*revision[\s\S]*payload') "office-storage.js: records must contain schemaVersion, savedAt, revision, and payload"
  Assert-True ($officeStorage -match 'makeRecord\(nextRevision\(\),\s*null\)') "office-storage.js: clear must persist a tombstone"
}

$officeUiPath = Join-Path $Root 'office-ui.js'
if (Test-Path $officeUiPath) {
  $officeUi = Get-Content -Raw -Encoding UTF8 $officeUiPath
  Assert-True ($officeUi -match 'function openModal\(') "office-ui.js: expected shared openModal helper for modal state contract"
  Assert-True ($officeUi -match '\bopenModal,') "office-ui.js: openModal must be exported on window.OfficeUI"
  Assert-True ($officeUi -match 'function setPressed\(') "office-ui.js: expected shared setPressed helper for active/aria-pressed state"
  Assert-True ($officeUi -match '\bsetPressed,') "office-ui.js: setPressed must be exported on window.OfficeUI"
  Assert-True ($officeUi -match 'function openFilePicker\(') "office-ui.js: expected shared openFilePicker helper for file input activation"
  Assert-True ($officeUi -match '\bopenFilePicker,') "office-ui.js: openFilePicker must be exported on window.OfficeUI"
  Assert-True ($officeUi -match 'function registerCommand\(') "office-ui.js: expected shared registerCommand helper for editor command adapters"
  Assert-True ($officeUi -match 'function registerCommands\(') "office-ui.js: expected shared registerCommands helper for editor command adapters"
  Assert-True ($officeUi -match 'function runCommand\(') "office-ui.js: expected shared runCommand helper for editor command adapters"
  Assert-True ($officeUi -match '\bregisterCommands,') "office-ui.js: registerCommands must be exported on window.OfficeUI"
  Assert-True ($officeUi -match '\brunCommand,') "office-ui.js: runCommand must be exported on window.OfficeUI"
  Assert-True ($officeUi -match 'function dispatchOverlayClose\(') "office-ui.js: expected overlay close event helper for local state cleanup"
  Assert-True ($officeUi -match '\bdispatchOverlayClose,') "office-ui.js: dispatchOverlayClose must be exported on window.OfficeUI"
  Assert-True ($officeUi -match "CustomEvent\('office:overlayclose'") "office-ui.js: overlay close helper must emit office:overlayclose"
  Assert-True ($officeUi -match 'function setAttributeIfChanged\(') "office-ui.js: observed attributes must be written only when changed to avoid MutationObserver loops"
  Assert-True ($officeUi -match "setAttributeIfChanged\(modal,\s*'aria-hidden',\s*visible \? 'false' : 'true'\)") "office-ui.js: modal sync must not repeatedly set aria-hidden from MutationObserver callbacks"
  Assert-True ($officeUi -match 'getActiveModal\(\)\?\.contains\(event\.target\)') "office-ui.js: global pointerdown close must ignore clicks inside the active modal"
  Assert-True ($officeUi -match '\.menu-dropdown') "office-ui.js: global pointerdown close must ignore interactions inside actual menu dropdowns"
  Assert-True ($officeUi -match '!panel\.classList\.contains\(''modal-box''\)') "office-ui.js: enhanceModal must not add office-modal sizing to existing modal-box panels"
  Assert-True ($officeUi -match '!panel\.contains\(document\.activeElement\)') "office-ui.js: modal focus sync must avoid refocusing when focus is already inside the modal"
}

$swPath = Join-Path $Root 'sw.js'
if (Test-Path $swPath) {
  $sw = Get-Content -Raw -Encoding UTF8 $swPath
  foreach ($assetGroup in @('CORE_SHELL_ASSETS', 'TEXT_ASSETS', 'TABLES_ASSETS', 'SLIDES_ASSETS', 'PAINT_ASSETS', 'VECTOR_ASSETS', 'FLOWCHARTS_ASSETS')) {
    Assert-True ($sw -match "const $assetGroup =") "sw.js: expected named offline group $assetGroup"
  }
  Assert-True ($sw -match 'const CACHE_GROUPS =') "sw.js: named asset groups must map to separate caches"
  Assert-True ($sw -match 'const GROUP_CACHE_NAMES =') "sw.js: each asset group must have a dedicated cache"
  Assert-True ($sw -match 'const RUNTIME_CACHE =') "sw.js: expected a dedicated runtime cache bucket"
  Assert-True ($sw -match 'const OFFLINE_STATUS_CACHE =') "sw.js: failed offline resources must be persisted"
  Assert-True ($sw -match 'Promise\.allSettled') "sw.js: partial cache failures must not abort the complete install pass"
  Assert-True ($sw -match "type === 'CHECK_OFFLINE_STATUS'") "sw.js: missing CHECK_OFFLINE_STATUS message API"
  Assert-True ($sw -match "type === 'RETRY_OFFLINE_CACHE'") "sw.js: missing RETRY_OFFLINE_CACHE message API"
  Assert-True ($sw -match "type: 'OFFLINE_STATUS'") "sw.js: status response must identify its payload"
  Assert-True ($sw -match 'editors\[editor\] = \{ ready:') "sw.js: status response must expose per-editor readiness"
  Assert-True ($sw -match 'const MAX_RUNTIME_ENTRIES =') "sw.js: runtime cache should declare an explicit size cap"
  Assert-True ($sw -match "request\.mode === 'navigate' \|\| acceptsHtml\(request\)") "sw.js: HTML requests should use a dedicated navigation strategy"
  Assert-True ($sw -match 'event\.waitUntil\(refresh\)') "sw.js: asset refresh should continue in the background"
  Assert-True ($sw -match 'trimRuntimeCache') "sw.js: runtime cache should be pruned after writes"
  Assert-True ($sw -notmatch 'caches\.match\(request\)\.then\(cached => \{\s*if \(cached\) return cached;\s*return fetch\(request\)') "sw.js: legacy blanket cache-first handler should be removed"
  Assert-ServiceWorkerPrecache $sw
}

$offlinePath = Join-Path $Root 'offline.js'
if (Test-Path $offlinePath) {
  $offline = Get-Content -Raw -Encoding UTF8 $offlinePath
  Assert-True ($offline -match 'navigator\.serviceWorker\.register') "offline.js: service worker registration must remain enabled"
  Assert-True ($offline -match 'console\.error\(`Offline') "offline.js: technical registration/cache errors must be logged"
  Assert-True ($offline -match "CustomEvent\('office:offline-error'") "offline.js: failures must emit office:offline-error"
  Assert-True ($offline -match "'Офлайн-режим ще не готовий'") "offline.js: incomplete caches need an explicit not-ready label"
  Assert-True ($offline -match "'Працює офлайн'") "offline.js: confirmed offline readiness needs an explicit ready label"
  Assert-True ($offline -match "postToWorker\(currentRegistration, 'CHECK_OFFLINE_STATUS'\)") "offline.js: ready UI must be based on Service Worker status"
  Assert-True ($offline -notmatch '\.catch\(\(\) => \{\s*\}\)') "offline.js: registration errors must not be swallowed silently"
  Assert-True ($offline -notmatch 'getRegistrations\(\)[\s\S]*unregister\(\)') "offline.js: must not unregister the service worker during normal boot"
  Assert-True ($offline -notmatch 'caches\.keys\(\)[\s\S]*caches\.delete') "offline.js: must not clear offline caches during normal boot"
}

$offlineSmokeRunnerPath = Join-Path $Root 'tests/run-offline-smoke.ps1'
if (Test-Path $offlineSmokeRunnerPath) {
  $offlineSmokeRunner = Get-Content -Raw -Encoding UTF8 $offlineSmokeRunnerPath
  Assert-True ($offlineSmokeRunner -match 'TcpListener') "run-offline-smoke.ps1: expected dynamic port allocation"
  Assert-True ($offlineSmokeRunner -match '--user-data-dir=\$profilePath') "run-offline-smoke.ps1: online and offline phases must share one temporary Chrome profile"
  Assert-True ($offlineSmokeRunner -match 'Stop-Process[\s\S]*phase=offline') "run-offline-smoke.ps1: local server must stop before the offline phase"
  Assert-True ($offlineSmokeRunner -match 'StartsWith\(\$resolvedTests') "run-offline-smoke.ps1: profile cleanup must validate its owning tests directory"
  Assert-True ($offlineSmokeRunner -match 'Remove-Item -LiteralPath \$resolvedProfile') "run-offline-smoke.ps1: cleanup must target only the resolved temporary profile"
}

# Browser/offline smoke мають завершуватися контрольовано навіть із завислим Chrome.
$processHelpers = Get-Content -Raw -Encoding UTF8 (Join-Path $Root 'tests/test-process-helpers.ps1')
Assert-True ($processHelpers -match 'WaitForExit\(\$TimeoutSeconds \* 1000\)') "test-process-helpers.ps1: browser wait must use a wall-clock timeout"
Assert-True ($processHelpers -match 'Task\]::WaitAll\(\$tasks, \$TimeoutSeconds \* 1000\)') "test-process-helpers.ps1: stdout/stderr reads must be bounded"
Assert-True ($processHelpers -match 'ParentProcessId' -and $processHelpers -match '\$OwnedMarker') "test-process-helpers.ps1: only this run's process tree and profile may be stopped"
Assert-True ($processHelpers -notmatch '(?i)taskkill[^\r\n]*/IM|Get-Process\s+(-Name\s+)?chrome|Name\s*=\s*''chrome\.exe''') "test-process-helpers.ps1: must not stop every chrome.exe"
foreach ($runnerName in @('run-browser-smoke.ps1', 'run-offline-smoke.ps1')) {
  $runner = Get-Content -Raw -Encoding UTF8 (Join-Path $Root "tests/$runnerName")
  Assert-True ($runner -match '\[int\]\$PageTimeoutSeconds = \d+') "${runnerName}: configurable wall-clock page timeout is required"
  Assert-True ($runner -match 'test-process-helpers\.ps1') "${runnerName}: must use bounded process helpers"
  Assert-True ($runner -notmatch '\.WaitForExit\(\)|\.(?:StdoutTask|StderrTask)\.Result') "${runnerName}: unbounded process or output waits are forbidden"
}
$browserSmokeRunner = Get-Content -Raw -Encoding UTF8 (Join-Path $Root 'tests/run-browser-smoke.ps1')
Assert-True ($browserSmokeRunner -match 'Wait-CapturedProcess -Capture \$capture -TimeoutSeconds \$PageTimeoutSeconds') "run-browser-smoke.ps1: every Chrome page must run under the wall-clock timeout"
Assert-True ($browserSmokeRunner -notmatch 'Get-ChildItem[^\r\n]*\.browser-profile-\*') "run-browser-smoke.ps1: cleanup must remove only profiles created by this run"

# Головна сторінка не блокує масштабування; контраст і zoom 200% перевіряє browser smoke.
$landingHtml = Get-Content -Raw -Encoding UTF8 (Join-Path $Root 'index.html')
$landingViewport = [regex]::Match($landingHtml, '<meta\s+name="viewport"\s+content="([^"]*)"')
Assert-True $landingViewport.Success 'index.html: viewport meta is required'
Assert-True ($landingViewport.Groups[1].Value -notmatch '(?i)user-scalable\s*=\s*(no|0)|maximum-scale\s*=\s*1(\.0)?\b') 'index.html: viewport must not block user zoom'
Assert-True ((Get-Content -Raw -Encoding UTF8 (Join-Path $Root 'tests/run-browser-smoke.ps1')) -match 'accessibility-smoke\.html') 'run-browser-smoke.ps1: contrast and zoom smoke must be registered'

# Browser smoke infrastructure: the local server must not block on or drop idle preconnected sockets,
# failed pages must carry the server request log, and accessibility smoke waits for observable conditions.
$serveOfficePath = Join-Path $Root 'tests/serve-office.ps1'
$smokeRunnerPath = Join-Path $Root 'tests/run-browser-smoke.ps1'
$accessibilitySmokePath = Join-Path $Root 'tests/accessibility-smoke.html'
if ((Test-Path $serveOfficePath) -and (Test-Path $smokeRunnerPath) -and (Test-Path $accessibilitySmokePath)) {
  $serveOffice = Get-Content -Raw -Encoding UTF8 $serveOfficePath
  $smokeRunner = Get-Content -Raw -Encoding UTF8 $smokeRunnerPath
  $accessibilitySmoke = Get-Content -Raw -Encoding UTF8 $accessibilitySmokePath
  Assert-True ($serveOffice -match '\[System\.Net\.Sockets\.Socket\]::Select\(') 'tests/serve-office.ps1: should serve connections from a Select loop instead of blocking on idle preconnected sockets'
  Assert-True ($serveOffice -notmatch 'ReadTimeout\s*=') 'tests/serve-office.ps1: must not close connections after a short blocking read timeout'
  Assert-True ($smokeRunner -match 'Assert-ServerKeepsPreconnectedSockets -PortNumber \$Port') 'run-browser-smoke.ps1: should verify that the server keeps preconnected sockets usable'
  Assert-True ($smokeRunner -match "'-LogPath', \`$serverLogPath" -and $smokeRunner -match 'Add-ServerLogDetails') 'run-browser-smoke.ps1: failed pages should include the server log of resources that failed to load'
  Assert-True ($accessibilitySmoke -match 'async function openFileMenu\(doc\) \{[^}]*waitFor\(') 'tests/accessibility-smoke.html: File menu check should wait for visible commands, not a fixed sleep'
  Assert-True ($accessibilitySmoke -notmatch 'await wait\(700\)') 'tests/accessibility-smoke.html: frames should wait for editor readiness, not a fixed 700 ms'
}

# Responsive and text model smoke wait for observable conditions instead of fixed sleeps or timer-only
# polling, which under load either fires before the work is done or burns the virtual time budget.
$responsiveSmokePath = Join-Path $Root 'tests/responsive-smoke.html'
$textModelSmokePath = Join-Path $Root 'tests/text-model-behavior.html'
if ((Test-Path $responsiveSmokePath) -and (Test-Path $textModelSmokePath)) {
  $responsiveSmoke = Get-Content -Raw -Encoding UTF8 $responsiveSmokePath
  $textModelSmoke = Get-Content -Raw -Encoding UTF8 $textModelSmokePath
  Assert-True ($responsiveSmoke -notmatch 'await wait\((?:180|250|350|450)\)') 'tests/responsive-smoke.html: frame and toolbar checks should wait for observable conditions, not fixed sleeps'
  Assert-True ($responsiveSmoke -match "classList\.contains\('office-toolbar-scrollable'\)") 'tests/responsive-smoke.html: overflow gradient check should wait until toolbar scroll classes match its geometry'
  Assert-True ($textModelSmoke -match "addEventListener\('art:paginated'") 'tests/text-model-behavior.html: settle should finish on the art:paginated event, not on timer polling alone'
}

$officeUiPath = Join-Path $Root 'office-ui.js'
if (Test-Path $officeUiPath) {
  $officeUi = Get-Content -Raw -Encoding UTF8 $officeUiPath
  Assert-True ($officeUi -match 'const scheduleToolbarUpdate = callback' -and $officeUi -match 'setTimeout\(run, \d+\)') 'office-ui.js: responsive toolbar scroll state should not depend on requestAnimationFrame alone'
}
Assert-True ($landingHtml -notmatch 'status-badge[^>]*>\s*soon\s*<') 'index.html: editor cards must not show a stale "soon" status'

# XLSX: невідомий результат формули не записується як 0, аркуш без ширин не має порожнього <cols>.
$xlsxAdapter = Get-Content -Raw -Encoding UTF8 (Join-Path $Root 'tables/js/xlsx-file.js')
Assert-True ($xlsxAdapter -notmatch '</f><v>0</v>') 'tables/js/xlsx-file.js: formulas must not be cached as a made-up zero'
Assert-True ($xlsxAdapter -match 'fullCalcOnLoad="1"') 'tables/js/xlsx-file.js: exported workbooks must ask for recalculation on load'
Assert-True ($xlsxAdapter -notmatch '<cols>\$\{cols\}</cols><sheetData>') 'tables/js/xlsx-file.js: an empty <cols> element makes Excel refuse the file'
Assert-True (Test-Path (Join-Path $Root 'tests/fixtures/compatibility/registry.json')) 'tests/fixtures/compatibility/registry.json: compatibility registry is required'

# Ctrl/Cmd+S у Схемах зберігає JSON-проєкт; PNG лишається окремим експортом у меню.
$flowchartsShortcuts = Get-Content -Raw -Encoding UTF8 (Join-Path $Root 'flowcharts/js/keyboard-shortcuts.js')
Assert-True ($flowchartsShortcuts -notmatch 'openSaveTitlePrompt|exportPng') 'flowcharts/js/keyboard-shortcuts.js: Ctrl+S must save the project, not export PNG'
Assert-True ($flowchartsShortcuts -match "key === 's'[\s\S]{0,120}runOfficeCommand\?\.\('save'\)") 'flowcharts/js/keyboard-shortcuts.js: Ctrl+S must run the shared save command'
Assert-True ((Get-Content -Raw -Encoding UTF8 (Join-Path $Root 'KEYBOARD_SHORTCUTS.md')) -notmatch 'Поточний допустимий виняток') 'KEYBOARD_SHORTCUTS.md: the Ctrl+S exception must stay removed'

$responsiveSmoke = Get-Content -Raw -Encoding UTF8 (Join-Path $Root 'tests/responsive-smoke.html')
foreach ($viewport in @('390, height: 844', '768, height: 1024', '1366, height: 768')) {
  Assert-True ($responsiveSmoke -match [regex]::Escape($viewport)) "responsive-smoke.html: missing viewport $viewport"
}
$officeUiSource = Get-Content -Raw -Encoding UTF8 (Join-Path $Root 'office-ui.js')
$shellOverrides = Get-Content -Raw -Encoding UTF8 (Join-Path $Root 'shell-overrides.css')
Assert-True ($officeUiSource -match 'bindResponsiveToolbars') 'office-ui.js: Text/Slides responsive toolbar enhancer is required'
Assert-True ($officeUiSource -match "addEventListener\('wheel'") 'office-ui.js: horizontal toolbar wheel scrolling is required'
Assert-True ($officeUiSource -match 'MutationObserver') 'office-ui.js: active toolbar controls must be revealed after state changes'
Assert-True ($shellOverrides -match 'can-scroll-right') 'shell-overrides.css: toolbar overflow gradient contract is required'
foreach ($service in @('paint', 'vector')) {
  $serviceUi = Get-Content -Raw -Encoding UTF8 (Join-Path $Root "$service/js/ui.js")
  $serviceCss = Get-Content -Raw -Encoding UTF8 (Join-Path $Root "$service/style.css")
  Assert-True ($serviceUi -match "matchMedia\('\(max-width: 760px\)'\)") "$service/js/ui.js: mobile properties panel must start collapsed"
  Assert-True ($serviceCss -match '@media \(max-width: 760px\)[\s\S]*?\.properties-panel\s*\{[\s\S]*?position:\s*fixed') "$service/style.css: mobile properties panel must be an overlay"
  Assert-True ($serviceCss -match '@media \(max-width: 760px\)[\s\S]*?\.tool-rail\s*\{[\s\S]*?flex-direction:\s*row') "$service/style.css: mobile tool rail must be horizontal"
}
$flowchartsCss = Get-Content -Raw -Encoding UTF8 (Join-Path $Root 'flowcharts/style.css')
Assert-True ($flowchartsCss -match '@media \(max-width: 760px\)[\s\S]*?grid-template-rows:\s*116px minmax\(0, 1fr\)') 'flowcharts/style.css: mobile canvas must retain the primary workspace row'
Assert-True ($flowchartsCss -match '@media \(max-width: 760px\)[\s\S]*?\.shape-list\s*\{[\s\S]*?flex-direction:\s*row') 'flowcharts/style.css: mobile shape palette must be horizontal'

$modalContractFiles = @(
  'text/ui/modals.js',
  'tables/js/ui.js',
  'paint/js/ui.js',
  'vector/js/ui.js',
  'slides/js/modal-ui.js',
  'flowcharts/js/ui.js'
)

foreach ($modalContractFile in $modalContractFiles) {
  $fullPath = Join-Path $Root $modalContractFile
  if (-not (Test-Path $fullPath)) { continue }
  $content = Get-Content -Raw -Encoding UTF8 $fullPath
  Assert-True ($content -match "classList\.remove\('hidden'\)|classList\.remove\(""hidden""\)") "${modalContractFile}: modal open path must remove hidden because office-ui.js can add it when closing"
  Assert-True ($content -match "classList\.add\('active'\)|classList\.add\(""active""\)") "${modalContractFile}: modal open path must add active so office-ui.js can detect the modal"
  Assert-True ($content -match "classList\.remove\('active'\)|classList\.remove\(""active""\)") "${modalContractFile}: modal close path must remove active"
  Assert-True ($content -match "setAttribute\('aria-hidden',\s*'false'\)|setAttribute\(""aria-hidden"",\s*""false""\)") "${modalContractFile}: modal open path must expose aria-hidden=false"
  Assert-True ($content -match "setAttribute\('aria-hidden',\s*'true'\)|setAttribute\(""aria-hidden"",\s*""true""\)") "${modalContractFile}: modal close path must restore aria-hidden=true"
}

$sharedModalApiFiles = @(
  'text/ui/modals.js',
  'tables/js/ui.js',
  'flowcharts/js/ui.js'
)

foreach ($sharedModalApiFile in $sharedModalApiFiles) {
  $fullPath = Join-Path $Root $sharedModalApiFile
  if (-not (Test-Path $fullPath)) { continue }
  $content = Get-Content -Raw -Encoding UTF8 $fullPath
  Assert-True ($content -match 'OfficeUI\?\.openModal') "${sharedModalApiFile}: simple modal helpers should delegate to OfficeUI.openModal with a local fallback"
  Assert-True ($content -match 'OfficeUI\?\.closeModal') "${sharedModalApiFile}: simple modal helpers should delegate to OfficeUI.closeModal with a local fallback"
}

$menuStateContractFiles = @(
  @{ File = 'text/ui/menu.js'; State = '_openMenu' },
  @{ File = 'paint/js/ui.js'; State = 'openMenuName' },
  # Vector більше не має floating tool-пікерів: інструменти живуть у лівій rail,
  # а підінструмент вибирається інлайн у панелі параметрів (openPickerName прибрано).
  @{ File = 'vector/js/ui.js'; State = 'openMenuName' },
  @{ File = 'flowcharts/js/ui.js'; State = 'openMenuName' }
)

foreach ($contract in $menuStateContractFiles) {
  $fullPath = Join-Path $Root $contract.File
  if (-not (Test-Path $fullPath)) { continue }
  $content = Get-Content -Raw -Encoding UTF8 $fullPath
  $state = [regex]::Escape($contract.State)
  Assert-True ($content -match "addEventListener\('office:overlayclose'[\s\S]*?$state\s*=\s*null") "$($contract.File): local $($contract.State) must listen for office:overlayclose so office-ui.js cannot leave stale overlay state"
}

$pressedStateFiles = @(
  'text/ui/toolbar.js',
  'tables/js/cell-format-ui.js'
)

foreach ($pressedStateFile in $pressedStateFiles) {
  $fullPath = Join-Path $Root $pressedStateFile
  if (-not (Test-Path $fullPath)) { continue }
  $content = Get-Content -Raw -Encoding UTF8 $fullPath
  Assert-True ($content -match "setAttribute\('aria-pressed',\s*String\(") "${pressedStateFile}: active formatting controls must sync aria-pressed"
  Assert-True ($content -match 'OfficeUI\?\.setPressed') "${pressedStateFile}: active formatting controls should delegate to OfficeUI.setPressed with a local fallback"
}

$toolbarPath = Join-Path $Root 'text/ui/toolbar.js'
if (Test-Path $toolbarPath) {
  $toolbar = Get-Content -Raw -Encoding UTF8 $toolbarPath
  Assert-True ($toolbar -notmatch "textNoColor[\s\S]{0,120}applyColor\('inherit'\)") "text/ui/toolbar.js: textNoColor must not also apply color: inherit after clearing color"
  Assert-True ($toolbar -notmatch "highlightNoColor[\s\S]{0,120}applyHighlight\('transparent'\)") "text/ui/toolbar.js: highlightNoColor must not also apply transparent highlight after clearing highlight"
}

if ($warnings.Count -gt 0) {
  Write-Host "WARNINGS"
  foreach ($warning in $warnings) {
    Write-Host "  - $warning"
  }
}

if ($failures.Count -gt 0) {
  Write-Host "FAILURES"
  foreach ($failure in $failures) {
    Write-Host "  - $failure"
  }
  exit 1
}

Write-Host "Static UI audit passed for $($services.Count) editors."

