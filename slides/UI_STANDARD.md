# UI_STANDARD.md — ПЛЮС Слайди

Статус: локальний довідник редактора.

Глобальні правила дивись у `../UI_INTEGRATION_GUIDE.md` та `../OFFICE_UI_STANDARD.md`. Архітектурну межу між shared root-шаром і локальним шаром редактора дивись у `../ARCHITECTURE.md`.

## Специфіка

- Тип: редактор презентацій.
- Основні сценарії: створення слайдів, редагування тексту/фігур/зображень, збереження проєкту, PDF export і презентаційний режим.
- Меню: Файл, Редагування, Вставка, Слайд, Перегляд, Допомога.
- Runtime bundle: `slides/js/runtime.js` є стабільним deployed entry.
- Standard commands мають лишатися синхронними між меню, toolbar і hotkeys.

## Локальні пріоритети

- Не перевантажувати постійну панель об'єктним форматуванням.
- File picker для проєктів і зображень має йти через `OfficeUI.openFilePicker` / `OfficeShell.openFilePicker`.
- Не тримати import/export і normalization логіку всередині UI coordinator.
- Розділяти `app.js` поступово: кожен новий файл має мати самостійну доменну межу.

## Локальна структура

- `slides/index.html` — HTML shell редактора.
- `slides/style.css` — локальні стилі редактора.
- `slides/js/runtime.js` — стабільний module entrypoint, який лише піднімає застосунок.
- `slides/js/app.js` — coordinator для `SlidesApp.boot`, shell-adapter, command dispatch, stage UI та взаємодій.
- `slides/js/project.js` — нормалізація презентації та елементів, збереження `.artslides.json`, парсинг відкритих файлів.
- `slides/js/slide-list.js` — список слайдів, thumbnails, reorder, move/duplicate/delete actions.
- `slides/js/stage-renderer.js` — рендеринг сцени, елементів, handles і selected-state.
- `slides/js/stage-interactions.js` — pointer interactions для drag/resize.
- `slides/js/modal-ui.js` — modal open/close/info/confirm поведінка.
- `slides/js/state.js` — локальний state, selected element, serialization.
- `slides/js/history.js` — undo/redo.
- `slides/js/storage.js` — draft autosave.
- `slides/js/templates.js` — створення слайдів, елементів і макетів.
- `slides/js/export.js` — PDF export, print і snapshots.
- `slides/js/utils.js` — DOM, file і utility helpers.

## Поточна оцінка технічного боргу

`slides/js/app.js` лишається найбільшим coordinator-файлом, але з нього вже винесено project file layer, slide list, stage rendering, stage interactions і modal UI. Залишкові змішані ролі: menu/color popover UI, presentation mode, object commands і частина toolbar state. Наступні зміни варто робити через стабілізацію сценаріїв або точкове винесення одного з цих шарів.
