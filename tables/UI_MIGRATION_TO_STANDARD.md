# UI_MIGRATION_TO_STANDARD.md — ПЛЮС Таблиці

## Поточний стан

Базовий shell, command adapter, file picker і статичний UI-аудит підключені. Таблиці вже пройшли великий етап розділення монолітної логіки на доменні шари.

Поточна локальна структура:

- `tables/js/addressing.js`
- `tables/js/model.js`
- `tables/js/storage.js`
- `tables/js/formula-parser.js`
- `tables/js/formula-references.js`
- `tables/js/formula-functions.js`
- `tables/js/formula-engine.js`
- `tables/js/core.js`
- `tables/js/state.js`
- `tables/js/column-sizing.js`
- `tables/js/formula-bar.js`
- `tables/js/grid.js`
- `tables/js/clipboard.js`
- `tables/js/selection-actions.js`
- `tables/js/formatting.js`
- `tables/js/structure.js`
- `tables/js/workbook.js`
- `tables/js/charts.js`
- `tables/js/ui.js`
- `tables/js/sorting.js`
- `tables/js/workbook-file.js`
- `tables/js/view-options.js`
- `tables/js/cell-format-ui.js`
- `tables/js/calculation.js`
- `tables/js/app.js`
- `tables/js/runtime.js`

## Архітектурний висновок

Поточне розділення є корисним і ще не виглядає як костиль: файли мають зрозумілі межі відповідальності, а `core.js` став сумісним фасадом ініціалізації замість мішанини стану, storage, формул і адресації.

Водночас Таблиці вже близько до межі, після якої подальше дроблення може створити надмірне нагромадження файлів. Нові модулі поки працюють у classic-script глобальному просторі, тому наступні кроки мають бути не про механічне збільшення кількості файлів, а про стабілізацію поведінки й перевірку реальних сценаріїв.

## Політика наступних змін

- Не дробити `tables/js` далі без чіткої поведінкової або тестової користі.
- Новий файл додавати лише тоді, коли він має самостійну доменну відповідальність і помітно зменшує зв'язність.
- Після кожної зміни запускати `tests\run-tests.ps1`, `tests\run-browser-smoke.ps1` і `git diff --check`.
- Підтримувати `sw.js` і `tests/static-ui-audit.ps1` синхронними з усіма новими локальними asset-файлами.

## Найближчий борг

- Стабілізувати Таблиці після розділення: ручна браузерна перевірка boot, формул, форматування, import/export workbook, CSV і діаграм.
- Додати або розширити інтеграційні browser-smoke сценарії для import/export і форматування комірок.
- Перевірити, чи всі `window.Tables*` namespace-и справді корисні як контракти, а не просто дублюють глобальні функції.
- Розширити `tables/js/charts.js` до навчальних сценаріїв: лінійні, стовпчикові й кругові діаграми з підписами, кількома рядами та виділеними діапазонами.
- Посилити `tables/js/structure.js`: формульні зсуви, перевірки діапазонів, масова вставка/видалення рядків і колонок.
- Додати майстер вставки формул поверх уже підтриманого ядра `IF`, `AND`, `OR`, `NOT`, `ROUND`, `MOD`, відсотків і статистичних функцій.

## Рекомендація щодо фокуса

Після короткої стабілізації Таблиць варто перейти до `slides/`. Таблиці й Flowcharts уже отримали значний архітектурний виграш, а редактор презентацій найімовірніше дасть більшу віддачу від наступного рефакторингу.
