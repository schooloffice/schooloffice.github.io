# Технічний гайд інтеграції UI-стандарту Офіс ПЛЮС

Цей документ є коротким технічним джерелом правди для інтеграції редакторів із shared shell-шаром. Детальні дизайн-правила можуть жити в окремих документах, але кодові контракти нижче мають вищий пріоритет для реалізації та статичного аудиту.

## 1. Обов'язкові shared-файли

У корені пакета мають існувати:

- `office-shell.js`
- `office-ui.js`
- `UI_TOKENS.css`
- `shell-overrides.css`
- `design-tokens.json`
- `SERVICE_THEME_MAP.json`
- `offline.js`
- `sw.js`

Кожен редактор має підключати:

```html
<link rel="stylesheet" href="../UI_TOKENS.css">
<link rel="stylesheet" href="style.css">
<link rel="stylesheet" href="../shell-overrides.css">
<script src="../office-shell.js" defer></script>
<script src="../office-ui.js" defer></script>
<script src="../offline.js" defer></script>
```

Порядок важливий: shared tokens -> локальні стилі -> shell overrides -> office-shell -> office-ui -> offline.

## 2. DOM-контракт shell

Кожен редактор має мати стабільний shell:

```html
<body class="office-app" data-office-service="text">
  <header class="office-header">...</header>
  <nav class="office-menubar">...</nav>
  <section class="office-toolbar">...</section>
  <main class="office-workspace office-workspace-focusable" tabindex="0">...</main>
  <footer class="office-statusbar" aria-label="...">
    <span data-office-status-slot="primary"></span>
    <span data-office-status-slot="secondary"></span>
  </footer>
</body>
```

Допустимі `data-office-service`: `text`, `tables`, `paint`, `slides`, `flowcharts`, `vector`.

## 3. Standard Commands

Стандартні команди:

- `new`
- `open`
- `save`
- `undo`
- `redo`

Кожен редактор має:

1. Позначити кнопки тулбара через `data-office-command`.
2. Мати відповідний пункт головного меню з тим самим локальним action.
3. Зареєструвати локальну реалізацію через `OfficeShell.registerCommands` або напряму через `OfficeUI.registerCommands`.
4. Маршрутизувати тулбар, меню і hotkeys через `OfficeShell.runCommand` або `OfficeUI.runCommand`.

Приклад:

```js
window.OfficeShell?.registerCommands?.('vector', {
  new: createProject,
  open: openProject,
  save: saveProject,
  undo: undo,
  redo: redo
}) || window.OfficeUI?.registerCommands?.({
  new: createProject,
  open: openProject,
  save: saveProject,
  undo: undo,
  redo: redo
}, { source: 'vector' });
```

```js
window.OfficeShell?.runCommand?.('save') || saveProject();
```

Це гарантує, що меню, тулбар і клавіатура не роз'їдуться.

## 4. File Picker

Відкриття локальних файлів має йти через:

```js
OfficeShell.openFilePicker(inputOrId)
```

Helper:

- приймає DOM-елемент або `id`;
- перевіряє, що це `input[type="file"]`;
- скидає `input.value`;
- викликає `input.click()`;
- повертає `true`, якщо picker відкрито.

Приклад:

```js
window.OfficeShell?.openFilePicker?.('projectFileInput') ||
  window.OfficeUI?.openFilePicker?.('projectFileInput') ||
  document.getElementById('projectFileInput')?.click();
```

Читання файлу, валідація формату і імпорт залишаються локальною відповідальністю редактора.

## 5. Modal, Overlay, Status

Shared API:

- `OfficeUI.openModal(modalOrId, options)`
- `OfficeUI.closeModal(modalOrId, options)`
- `OfficeUI.closeActiveModal()`
- `OfficeUI.closeTopOverlay()`
- `OfficeUI.dispatchOverlayClose(type, detail)`
- `OfficeUI.setPressed(target, pressed)`
- `OfficeUI.updateStatus(message, slot)`
- `OfficeUI.announce(message)`

Локальні modal helpers мають делегувати в `OfficeUI.openModal/closeModal` і мати fallback.

`OfficeShell` не замінює modal/status API. Він відповідає лише за boot, command routing і file picker adapter.

Overlay state у локальних меню/picker має слухати подію:

```js
document.addEventListener('office:overlayclose', () => {
  openMenuName = null;
});
```

## 6. Статичний аудит

Базова перевірка:

```powershell
powershell -ExecutionPolicy Bypass -File tests\run-tests.ps1
```

Аудит перевіряє:

- наявність shared-файлів;
- підключення стилів і скриптів;
- shell-класи;
- порядок `new/open/save/undo/redo`;
- parity між тулбаром і головним меню;
- реєстрацію `OfficeShell.registerCommands` або `OfficeUI.registerCommands`;
- маршрутизацію стандартних команд через `OfficeShell.runCommand` або `OfficeUI.runCommand`;
- використання `OfficeShell.openFilePicker` або `OfficeUI.openFilePicker`;
- modal/dropdown/statusbar контракти;
- відсутність inline handlers/styles у HTML.

Браузерні тести мають бути точковими й використовуватись лише для поведінки, яку неможливо надійно відтворити статично.

## 7. Документаційна політика

Активними джерелами правди для коду є:

- `README.md`
- `UI_INTEGRATION_GUIDE.md`
- `OFFICE_UI_STANDARD.md`
- `KEYBOARD_SHORTCUTS.md`
- `MODAL_STANDARD.md`
- `DROPDOWN_STANDARD.md`
- `WORKSPACE_ACCESSIBILITY.md`
- `CONTEXTUAL_UI_STANDARD.md`
- `COMPONENT_CHECKLIST.md`

Довідкові або шаблонні файли:

- `APP_SHELL.html`
- `SHELL_COMPONENTS.md`
- `SERVICE_SHELL_BLUEPRINTS.md`
- `UI_REVIEW_TEMPLATE.md`
- `PROMPT_FOR_AGENT.md`
- `CHANGELOG_STANDARD.md`

Їх не треба вважати рівноцінними нормативними джерелами для щоденної розробки. Якщо правило дублюється, оновлювати треба активне джерело правди, а довідковий документ або синхронізувати, або переносити в архів на окремому кроці.
