# UI_STANDARD.md — ПЛЮС Схеми

Статус: локальний довідник редактора.

Глобальні правила дивись у `../UI_INTEGRATION_GUIDE.md` та `../OFFICE_UI_STANDARD.md`.
Архітектурну межу між shared root-шаром і локальним шаром редактора дивись у `../ARCHITECTURE.md`.

## Специфіка

- Тип: редактор блок-схем.
- Основні сценарії: створення блоків, з'єднань, підписів, експорт PNG, збереження JSON-проєкту.
- Меню: Файл, Редагування, Вставка, Перегляд, Допомога.
- `Ctrl+S` історично використовується для PNG export; JSON save відповідає toolbar Save і `Ctrl+Shift+S`.

## Локальні пріоритети

- Тримати виняток `Ctrl+S` явно задокументованим у меню.
- Standard toolbar actions мають мати `data-action`.
- File picker має йти через `OfficeUI.openFilePicker`.

## Локальна структура

- `flowcharts/index.html` — HTML shell редактора.
- `flowcharts/style.css` — локальні стилі редактора.
- `flowcharts/js/runtime.js` — стабільний runtime entrypoint без бізнес-логіки.
- `flowcharts/js/app.js` — boot і shell-adapter (`FlowchartsApp.boot`).
- `flowcharts/js/core.js` — доменна логіка блоків, зв'язків і моделі схеми.
- `flowcharts/js/ui.js` — DOM/UI-шар редактора.
- `flowcharts/js/autosave.js` — локальний controller автозбереження чернетки.
- `flowcharts/js/modals.js` — message/confirm/restore modal helpers.
- `flowcharts/js/editor-utils.js` — чисті утиліти редактора.
- `flowcharts/js/status.js` — dirty/saved badge controller.
- `flowcharts/js/colors.js` — color picker, базові кольори типів і застосування кольору до вибраної фігури.
- `flowcharts/js/connection-selection.js` — вибір стрілок, connection toolbar і modal для підпису.
- `flowcharts/js/shape-selection.js` — вибір/зняття вибору фігур, handles і синхронізація кольору вибраної фігури.
- `flowcharts/js/shape-deletion.js` — видалення вибраних фігур, пов'язаних стрілок і очищення полотна.
- `flowcharts/js/shape-text.js` — text modal, збереження тексту фігури й оновлення content/aria-label.
- `flowcharts/js/shape-interactions.js` — pointer/keyboard/hover/long-press bindings для DOM-фігур.
- `flowcharts/js/shape-factory.js` — DOM factory для фігур, initial state record, content node, animation, handles/interactions hooks.
- `flowcharts/js/viewport.js` — zoom controls, wheel zoom, background pan і deselect на полотні.
- `flowcharts/js/keyboard-shortcuts.js` — global keyboard shortcuts і Escape/Delete cleanup.
- `flowcharts/js/history.js` — undo/redo snapshots, restore flow і history button state.
- `flowcharts/js/menu-actions.js` — main menu action dispatcher і help panel toggle/binding.
- `flowcharts/js/flow-actions.js` — snap toggle, shape add buttons і decision connection modal actions.
- `flowcharts/js/title.js` — синхронізація назви схеми в header/input.
- `flowcharts/js/shape-geometry.js` — geometry helpers для фігур, handles і hit-test.
- `flowcharts/js/shape-placement.js` — розміри фігур, collision check і авто-розміщення.
- `flowcharts/js/handles.js` — SVG handles і temp-line controller для створення зв'язків.
- `flowcharts/js/routing.js` — geometry/routing для стрілок.
- `flowcharts/js/connections-dom.js` — SVG DOM для стрілок, hit-path і підписів.
- `flowcharts/js/editor.js` — orchestration шару редактора й взаємодія між локальними модулями, core та UI.
