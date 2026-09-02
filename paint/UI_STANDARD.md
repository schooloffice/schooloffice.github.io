# UI_STANDARD.md — ПЛЮС Малюнки

Статус: локальний довідник редактора.

Глобальні правила дивись у `../UI_INTEGRATION_GUIDE.md` та `../OFFICE_UI_STANDARD.md`.
Архітектурну межу між shared root-шаром і локальним шаром редактора дивись у `../ARCHITECTURE.md`.

## Специфіка

- Тип: растровий (raster-first) графічний редактор у стилі сучасного MS Paint.
- Документ має незалежний фіксований розмір у пікселях (`state.document`); workspace лише показує його через `state.viewport` (zoom/pan/fit). Розмір полотна НЕ залежить від контейнера — resize вікна змінює лише zoom.
- Основні сценарії: малювання, робота з об'єктами, імпорт зображення, експорт PNG/JPG.
- Розкладка (спільна з `vector/`): верх — лише назва + головне меню; ліва **tool rail** 72px (лише інструменти, іконка над коротким підписом, несе клас `office-toolbar`) + контекстна **properties panel** 232px (параметри інструмента, палітра, RGB/BIN мікшер), яку можна згорнути (`Ctrl+\`, кнопка внизу rail); workspace із документом; zoom і «підігнати до вікна» — у статус-смузі.
- Швидкі дії save/undo/redo — компактними іконками в header, щоб не займати ані рядка робочої області, ані місця в rail; `data-office-command` маркери лишаються в прихованому `command-proxies`.
- Меню: Файл, Редагування, Перегляд, Допомога (zoom і «Розмір полотна…» — у «Перегляд»).
- Параметри інструмента показуються інлайн у properties panel (`data-tool-section`), без floating-дропдаунів.
- Для молодших учнів перевага за стабільними controls, а не за floating UI.

## Локальні пріоритети

- Не ховати основні параметри інструмента надто глибоко.
- Boot має відбуватися рівно один раз: не покладатися на значення, яке повертає `OfficeShell.bootEditor`.
- Панель параметрів має вміщатися без прокрутки на ноутбучній висоті (1366×768).
- Open image має використовувати `OfficeShell.openFilePicker` через локальний command/file adapter.
- Стандартні команди мають іти через command adapter.

## Локальна структура

- `paint/index.html` — HTML shell редактора.
- `paint/style.css` — локальні стилі редактора.
- `paint/js/runtime.js` — стабільний runtime entrypoint без бізнес-логіки.
- `paint/js/app.js` — boot і shell-adapter (`PaintApp.boot`).
- `paint/js/state.js` — локальний runtime state.
- `paint/js/ui.js` — DOM/UI-шар редактора.
- `paint/js/tools.js` — реєстр інструментів (контракт `begin/update/commit/cancel`).
- `paint/js/canvas.js` — canvas-логіка, растрові операції, трансформації документа.
- `paint/js/constants.js`, `paint/js/utils.js` — допоміжні модулі редактора.
