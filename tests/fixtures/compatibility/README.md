# Корпус сумісності

Малий набір файлів для перевірки обміну з офісними програмами. Реєстр випадків, походження, очікуваних втрат і результатів — `registry.json`. Сирі результати відкриття в Microsoft Office — `office-reader-results.json`.

## Що перевіряється автоматично (офлайн, у browser smoke)

- `tests/xlsx-behavior.html` — імпорт XLSX, створених Microsoft Excel; типізований кеш формул і XML експорту.
- `tests/slides-domain-behavior.html` — PPTX із проєктів `plus-slides-*.json` через справжній PptxGenJS: об'єкти, медіа, таблиця, діаграма, посилання.

## Що перевіряється вручну на Windows із Microsoft Office

1. `generate-office-fixtures.ps1` — перестворює `excel-*.xlsx` у Microsoft Excel.
2. Відкрити `tests/compatibility-export.html` у headless Chrome через локальний сервер і зберегти base64-файли з `#exports` у `plus-exports/`.
3. `check-office-readers.ps1` — відкриває `plus-exports/` у Excel, Word і PowerPoint та записує `office-reader-results.json`.

Скрипти запускати без перенаправлення stdout (наприклад, через `Start-Process`): з перенаправленим виводом COM-операції Office у середовищі перевірки зависали. Кожна програма працює під сторожовим тайм-аутом і прибирає лише власні процеси.

## Відомі прогалини

- Незалежні DOCX, створені Microsoft Word, ще не додано: Word через COM не завершував `SaveAs2` (див. `registry.json`).
- Кожен формат перевірено лише одним зовнішнім читачем. Другої програми (LibreOffice тощо) на машині перевірки не було.
