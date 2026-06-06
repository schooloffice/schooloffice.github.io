# WORKSPACE_ACCESSIBILITY.md

Статус: активне джерело правди.

## Workspace

Кожен редактор має мати робочу область із:

- класом `office-workspace`;
- класом `office-workspace-focusable`;
- `tabindex="0"`, якщо основний workspace не має native focus;
- видимим `focus-visible`;
- стабільною поведінкою після закриття modal/dropdown/popover.

## Focus

- Overlay має повертати focus на trigger або безпечну робочу зону.
- Modal має утримувати focus всередині себе.
- Глобальні hotkeys не мають ламати введення в form controls.
- Втрата focus не має виглядати як зламаний workspace.

## Перевірка

Статичний аудит перевіряє базову наявність focusable workspace. Ручний браузерний QA потрібен лише для складної canvas/svg/contenteditable поведінки.
