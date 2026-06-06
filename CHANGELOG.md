# CHANGELOG

## 2026-04-25

### Slides architecture and behavior smoke

- `slides/js/app.js` reduced to a coordinator by moving project helpers, slide list rendering, stage rendering, stage interactions and modal UI into focused modules.
- `slides/js/runtime.js` now boots safely whether `DOMContentLoaded` is still pending or already complete.
- `tests/slides-behavior.html` added and wired into `tests/run-browser-smoke.ps1` to verify browser module import, `SlidesApp.boot`, slide list render, stage render, project normalization/parsing and Ukrainian slug generation.
- Damaged Unicode/control characters in Slides project/template text literals were cleaned so browser module imports no longer fail with `SyntaxError: Invalid or unexpected token`.
- Technical conclusion recorded: pause mechanical Slides splitting and move to feature work on top of the current structure.
- Recommended next editor for debt reduction before feature growth: `paint/`.

### Paint document lifecycle split

- `paint/js/document.js` added to own autosave draft, draft restore, image import, PNG/JPG export and print.
- `paint/js/object-interactions.js` added to own object selection, move, resize and delete behavior.
- `paint/js/app.js` reduced back toward a coordinator role for boot, tool state and canvas interactions.
- `paint/js/runtime.js` made resilient to `DOMContentLoaded` timing, matching the newer Slides runtime pattern.
- `tests/paint-behavior.html` added to verify browser boot, document module export, canvas initialization and standard command markers.
- `paint/index.html`, `sw.js`, `tests/static-ui-audit.ps1`, `tests/run-browser-smoke.ps1` and `paint/UI_MIGRATION_TO_STANDARD.md` synchronized with the new document module.

### Tables architecture and stabilization decision

- `tables/js/core.js` split into dedicated model, storage, addressing and formula layers.
- Formula logic split into `formula-parser.js`, `formula-references.js`, `formula-functions.js` and `formula-engine.js`.
- Tables UI/runtime logic further separated into focused modules for clipboard, formatting, structure, charts, sorting, workbook file operations, view options, cell-format UI and calculation.
- `tables/index.html`, `sw.js`, `tests/static-ui-audit.ps1` and `tests/tables-formula-behavior.html` synchronized with the new split module graph.
- Technical conclusion recorded: Tables should pause aggressive file splitting and move into stabilization, integration testing and feature hardening.
- Recommended next editor after Tables stabilization: `slides/`.

## 2026-04-24

### Shared shell adapter

- Додано `office-shell.js` як thin adapter-шар між локальними `js/app.js` і `window.OfficeUI`.
- Командний роутинг, file picker і boot wiring у редакторах почали уніфікуватися через `OfficeShell.runCommand`, `OfficeShell.openFilePicker`, `OfficeShell.registerCommands`, `OfficeShell.bootEditor`.
- Усі редактори підключають shared root-скрипти в одному порядку: `office-shell.js` -> `office-ui.js` -> `offline.js`.

### Shared documentation and audit

- `ARCHITECTURE.md`, `UI_INTEGRATION_GUIDE.md`, `OFFICE_UI_STANDARD.md`, `SERVICE_SHELL_BLUEPRINTS.md`, `README.md` і `APP_SHELL.html` синхронізовано з новим shared shell-контрактом.
- Статичний аудит тепер перевіряє наявність `office-shell.js` і порядок підключення shared root-скриптів.

## 2026-04-23

### Уніфікація shell

- Усі 6 редакторів підключені до `UI_TOKENS.css`, `office-ui.js`, `shell-overrides.css` та `offline.js`.
- Зафіксовано базовий shell-контракт: header, menubar, toolbar, workspace, statusbar.
- Статичний аудит перевіряє `office-*` класи, `data-office-service`, порядок стилів і локальні asset paths.

### Overlay, modal, dropdown

- Додано shared modal behavior в `office-ui.js`: ARIA sync, `Escape`, focus return, focus loop.
- Виправлено ризик MutationObserver-loop: observed attributes тепер записуються тільки при зміні значення.
- Глобальний `pointerdown` більше не закриває активну модалку при кліку всередині неї.
- Локальні меню/picker синхронізують стан через `office:overlayclose`.

### Standard Commands

- Додано `OfficeUI.registerCommand`, `OfficeUI.registerCommands`, `OfficeUI.hasCommand`, `OfficeUI.runCommand`.
- Усі редактори реєструють стандартні команди `new/open/save/undo/redo`.
- Тулбар, головне меню та hotkeys поступово переведені на `OfficeUI.runCommand`.
- Статичний аудит перевіряє:
  - наявність command adapter;
  - маршрутизацію кожної стандартної команди;
  - parity між кнопкою тулбара та пунктом головного меню.

### File Picker

- Додано `OfficeUI.openFilePicker(inputOrId)`.
- File-open точки в редакторах переведені на shared helper.
- Helper скидає `input.value`, щоб повторне відкриття того самого файлу не губило `change` event.
- Статичний аудит перевіряє використання `OfficeUI.openFilePicker` у кожному редакторі.

### Save/Open стабілізація

- Перевірено `Save` у всіх редакторах через статичний контракт.
- Flowcharts більше не має окремого винятку для toolbar Save: стандартні toolbar-кнопки отримали явні `data-action`.
- Vector отримав захист від подвійного спрацювання `toggle-snap`.

### Стилі і токени

- Аудит перевіряє, що `UI_TOKENS.css` підключений до локальних стилів, а `shell-overrides.css` після них.
- Локальні `style.css` не повинні перевизначати `--office-*` токени або `.office-*` component selectors.
- Локальний `--accent` має відповідати `SERVICE_THEME_MAP.json`.

### Документація

- `UI_INTEGRATION_GUIDE.md` оновлено до поточного command/file-picker/modal/status контракту.
- `README.md` розділено на активні джерела правди, довідкові документи і кандидати на архів.
- Поточний висновок: кількість документації завелика для щоденної розробки, але масово видаляти її не варто без окремого архівного кроку.
