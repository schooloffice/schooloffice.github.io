# COMPONENT_CHECKLIST.md

Статус: активний чекліст.

## Перед завершенням зміни

- [ ] Запущено `powershell -ExecutionPolicy Bypass -File tests\run-tests.ps1`.
- [ ] Запущено `git diff --check`.
- [ ] Запущено `powershell -ExecutionPolicy Bypass -File tests\run-browser-smoke.ps1` після змін у runtime/UI поведінці.
- [ ] Не додано inline `onclick`, `onkeydown`, `style`.
- [ ] Не перевизначено локально `--office-*`.
- [ ] Не перевизначено локально `.office-*` component selectors.
- [ ] Локальні browser-smoke артефакти прибрано через `tests\cleanup-test-artifacts.ps1`.

## Shell

- [ ] Є `body.office-app`.
- [ ] Є правильний `data-office-service`.
- [ ] Підключено `UI_TOKENS.css`, локальний `style.css`, `shell-overrides.css`.
- [ ] Підключено `office-shell.js`, `office-ui.js` і `offline.js` у правильному порядку.
- [ ] Є header, menubar, toolbar, workspace, statusbar.

## Standard Commands

- [ ] Toolbar містить `new/open/save/undo/redo` у правильному порядку.
- [ ] Toolbar action збігається з action у головному меню.
- [ ] Редактор реєструє `OfficeShell.registerCommands` або `OfficeUI.registerCommands`.
- [ ] Entry points маршрутизуються через `OfficeShell.runCommand` або `OfficeUI.runCommand`.
- [ ] Hotkeys не викликають стару логіку напряму, якщо вже є adapter.

## File Picker

- [ ] Відкриття file input іде через `OfficeShell.openFilePicker` або `OfficeUI.openFilePicker`.
- [ ] Повторний вибір того самого файлу не губить `change`.
- [ ] Валідація формату лишається локальною.

## Modal / Dropdown

- [ ] Modal open/close делегує в `OfficeUI.openModal/closeModal`.
- [ ] Dropdown/picker state слухає `office:overlayclose`, якщо має локальний open-state.
- [ ] `Escape` закриває верхній overlay.
- [ ] Focus не губиться після закриття.

## Offline

- [ ] Нові локальні JS/CSS/image/font asset-и, підключені в HTML редакторів, додано в `sw.js` `CORE_ASSETS`.
- [ ] `CORE_ASSETS` не містить шляхів до видалених або перейменованих файлів.

## Browser QA

Ручно перевіряти тільки те, що не ловиться статично:

- Help/About modal;
- Open/Save у реальному браузері;
- canvas/svg/contenteditable focus;
- mobile/narrow layout.
