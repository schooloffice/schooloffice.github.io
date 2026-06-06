# UI_MIGRATION_TO_STANDARD.md — ПЛЮС Текст

## Поточний стан

Базовий shell, command adapter, file picker і modal/dropdown контракти підключені.
Локальна структура вже вирівняна до `text/js/runtime.js -> text/js/app.js` поверх шарів `text/core/`, `text/ui/` і `text/formats/`.

## Найближчий борг

- Перевірити, чи toolbar Save і Ctrl+S мають однаково очікувану поведінку для користувача.
- Вирівняти confirm/info/prompt тексти після ручного браузерного QA.
- Переглянути контекстні дії для таблиць і зображень, щоб не тримати зайве в постійному toolbar.
