# SERVICE_SHELL_BLUEPRINTS.md

Статус: довідковий документ.

Актуальна структура сервісів визначається реальними `index.html` редакторів, `SERVICE_THEME_MAP.json` і статичним аудитом.

Редактори:

- `text` — ПЛЮС Текст
- `tables` — ПЛЮС Таблиці
- `paint` — ПЛЮС Малюнки
- `slides` — ПЛЮС Слайди
- `flowcharts` — ПЛЮС Схеми
- `vector` — ПЛЮС Вектор

Обов'язковий shared-контракт для кожного редактора:

- `body.office-app`
- правильний `data-office-service`
- `office-header`
- `office-menubar`
- `office-toolbar`
- `office-workspace`
- `office-statusbar`
- toolbar-команди `new/open/save/undo/redo`
- parity між тулбаром і головним меню
- command adapter через `OfficeShell.registerCommands` або `OfficeUI.registerCommands`
- file picker через `OfficeShell.openFilePicker` або `OfficeUI.openFilePicker`

Деталі дивись у `UI_INTEGRATION_GUIDE.md`.
