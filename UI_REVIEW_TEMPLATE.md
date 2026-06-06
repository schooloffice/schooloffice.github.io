# UI_REVIEW_TEMPLATE.md

Статус: довідковий шаблон.

Для щоденної перевірки використовуй:

```powershell
powershell -ExecutionPolicy Bypass -File tests\run-tests.ps1
```

Мінімальний UI-review звіт:

## Scope

- Редактор:
- Змінені файли:
- Який контракт зачеплено: shell / command / file picker / modal / dropdown / status / styles

## Static Checks

- `tests/run-tests.ps1`: pass/fail
- `git diff --check`: pass/fail

## Manual Browser Checks

Заповнюється лише для сценаріїв, які не ловляться статично:

- About/help modal:
- Open file:
- Save/export:
- Keyboard shortcut:
- Mobile/narrow viewport:

## Risks

- Що може зламатися:
- Що перевірити вручну:

Джерела правди:

- `UI_INTEGRATION_GUIDE.md`
- `COMPONENT_CHECKLIST.md`
- `OFFICE_UI_STANDARD.md`
