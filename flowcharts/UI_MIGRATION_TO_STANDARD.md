# UI_MIGRATION_TO_STANDARD.md — ПЛЮС Схеми

## Поточний стан

Базовий shell, command adapter, toolbar/menu parity і file picker підключені.
Локальна структура вже вирівняна до `flowcharts/js/core.js`, `flowcharts/js/ui.js`, `flowcharts/js/editor.js`, `flowcharts/js/app.js`, `flowcharts/js/runtime.js`.
Частину колишнього монолітного `editor.js` винесено в локальні модулі: `autosave.js`, `modals.js`, `editor-utils.js`, `status.js`, `colors.js`, `connection-selection.js`, `shape-selection.js`, `shape-deletion.js`, `shape-text.js`, `shape-interactions.js`, `shape-factory.js`, `viewport.js`, `keyboard-shortcuts.js`, `history.js`, `menu-actions.js`, `flow-actions.js`, `title.js`, `shape-geometry.js`, `shape-placement.js`, `handles.js`, `routing.js`, `connections-dom.js`.

## Найближчий борг

- Перевірити ручний сценарій Help/About, open project, PNG save і JSON save.
- Після кожного нового split-кроку оновлювати `flowcharts/index.html`, `sw.js` і static audit module-contract.
- Вирівняти statusbar тексти.
- Пізніше вирішити, чи залишати виняток `Ctrl+S = PNG`, чи перевести на єдину модель.
