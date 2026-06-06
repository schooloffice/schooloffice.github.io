# UI_MIGRATION_TO_STANDARD.md — ПЛЮС Малюнки

## Поточний Стан

Базовий shell, standard commands і file picker підключені. Локальна структура вирівняна до `paint/js/runtime.js -> paint/js/app.js -> service modules`.

Поточний фокус — зменшити борг перед нарощуванням інструментів малювання. Для цього не треба механічно дробити весь canvas layer; спершу варто відокремлювати життєвий цикл документа, file/export сценарії і великі interaction-блоки.

## Поточна Структура

- `paint/js/runtime.js` — стабільний entrypoint, який запускає `PaintApp.boot` до або після `DOMContentLoaded`.
- `paint/js/app.js` — boot, command adapter, tool state coordination, canvas/object interaction wiring.
- `paint/js/document.js` — autosave draft, restore draft, image import, PNG/JPG export і print.
- `paint/js/object-interactions.js` — select, move, resize і delete для об'єктів на полотні.
- `paint/js/canvas.js` — canvas API, raster drawing, object rendering, snapshots і guides.
- `paint/js/ui.js` — DOM cache, menu/picker/modal/statusbar UI.
- `paint/js/state.js` — локальний runtime state.
- `paint/js/constants.js` — інструменти, палітра, guides, brush/stamp definitions.
- `paint/js/utils.js` — DOM, color, download і canvas helpers.

## Найближчий Борг

- Розширити `tests/paint-behavior.html` сценаріями для імпорту зображення і object interactions.
- Перевірити, чи варто винести raster stroke/pending object creation з `app.js`; робити це тільки після розширення browser-smoke.
- Перевірити ручний сценарій імпорту зображення в браузері.
- Вирівняти statusbar тексти для canvas/tool state.
- Переглянути, чи не дублюються інструменти між меню, toolbar і picker.

## Обмеження

Не дробити `canvas.js` на shape/math/render файли, доки не з'явиться реальна потреба. Для графічного редактора canvas API може залишатися більшим модулем, якщо він має цілісну відповідальність і покритий smoke-тестами.
