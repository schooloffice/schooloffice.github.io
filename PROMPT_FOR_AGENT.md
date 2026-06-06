# Контекст і правила для агента

Перед змінами прочитай:

1. `PROJECT_DIRECTION.md` — продуктова мета, незмінні рішення, матриця редакторів, ризики й дорожня карта.
2. `README.md` — карта репозиторію та команди перевірки.
3. `ARCHITECTURE.md` — межі shared і service layers.
4. `UI_INTEGRATION_GUIDE.md` — технічний контракт shared shell.
5. Локальні `UI_STANDARD.md` та `UI_MIGRATION_TO_STANDARD.md` редактора, який змінюється.

## Продуктові правила

- Це локальний офлайн-пакет редакторів для шкільної інформатики.
- Не додавати вправи, акаунти, cloud storage або collaboration.
- Не переписувати пакет на великий сторонній SDK без окремого пілота й рішення.
- Зберігати власний UI і shared shell.
- Розвивати редактори через типові учнівські сценарії, надійність і сумісність файлів.

## Технічні правила

- Стандартні команди проводити через `OfficeShell.registerCommands` / `OfficeShell.runCommand`.
- File picker проводити через `OfficeShell.openFilePicker`.
- Не вставляти недовірені project/file дані через `innerHTML` без валідації та escaping.
- Для імпорту додавати schema validation, ліміти й негативні тести.
- Нову залежність додавати лише після перевірки ліцензії, офлайн-роботи, bundle size і плану підтримки.
- Новий runtime-файл додавати до `sw.js` і тестового контракту.
- Не робити механічне дроблення модулів без чіткої доменної межі.

## Обов'язкова перевірка

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File tests\run-tests.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File tests\run-browser-smoke.ps1
git diff --check
```

Якщо стратегія або архітектурні правила суперечать одне одному, спочатку онови активне джерело правди або попроси продуктове рішення.
