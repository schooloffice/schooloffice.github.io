# UI_STANDARD.md — ПЛЮС Вектор

Статус: локальний довідник редактора.

Глобальні правила дивись у `../UI_INTEGRATION_GUIDE.md` та `../OFFICE_UI_STANDARD.md`.
Архітектурну межу між shared root-шаром і локальним шаром редактора дивись у `../ARCHITECTURE.md`.

## Специфіка

- Тип: векторний графічний редактор.
- Основні сценарії: створення фігур, редагування контурів, текст, експорт SVG/PNG, збереження JSON-проєкту.
- Меню: Файл, Редагування, Вставка, Формат, Перегляд, Допомога.
- Standard commands мають іти через command adapter.

## Локальні пріоритети

- Не дублювати toggle/listener для одного `data-action`.
- File picker має йти через `OfficeUI.openFilePicker`.
- Контекстні властивості об'єкта не мають перетворювати toolbar на важкий ribbon.

## Локальна структура

- `vector/index.html` — HTML shell редактора.
- `vector/style.css` — локальні стилі редактора.
- `vector/js/runtime.js` — стабільний runtime entrypoint без бізнес-логіки.
- `vector/js/app.js` — boot і shell-adapter (`VectorApp.boot`).
- `vector/js/state.js` — локальний runtime state.
- `vector/js/ui.js` — DOM/UI-шар редактора.
- `vector/js/editor.js` — доменна логіка векторного редактора.
- `vector/js/constants.js`, `vector/js/utils.js` — допоміжні модулі редактора.
