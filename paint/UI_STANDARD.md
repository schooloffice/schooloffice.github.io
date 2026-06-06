# UI_STANDARD.md — ПЛЮС Малюнки

Статус: локальний довідник редактора.

Глобальні правила дивись у `../UI_INTEGRATION_GUIDE.md` та `../OFFICE_UI_STANDARD.md`.
Архітектурну межу між shared root-шаром і локальним шаром редактора дивись у `../ARCHITECTURE.md`.

## Специфіка

- Тип: растровий графічний редактор.
- Основні сценарії: малювання, робота з об'єктами, імпорт зображення, експорт PNG/JPG.
- Меню: Файл, Редагування, Вставка, Інструменти, Перегляд, Допомога.
- Для молодших учнів перевага за стабільними controls, а не за floating UI.

## Локальні пріоритети

- Не ховати основні параметри інструмента надто глибоко.
- Open image має використовувати `OfficeUI.openFilePicker`.
- Стандартні команди мають іти через command adapter.

## Локальна структура

- `paint/index.html` — HTML shell редактора.
- `paint/style.css` — локальні стилі редактора.
- `paint/js/runtime.js` — стабільний runtime entrypoint без бізнес-логіки.
- `paint/js/app.js` — boot і shell-adapter (`PaintApp.boot`).
- `paint/js/state.js` — локальний runtime state.
- `paint/js/ui.js` — DOM/UI-шар редактора.
- `paint/js/canvas.js` — canvas-логіка й інструменти малювання.
- `paint/js/constants.js`, `paint/js/utils.js` — допоміжні модулі редактора.
