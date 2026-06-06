# PROMPT_FOR_AGENT.md

Статус: довідковий регламент.

Коли агент або розробник змінює редактори Офіс ПЛЮС, він має працювати від поточних джерел правди:

1. `UI_INTEGRATION_GUIDE.md`
2. `README.md`
3. `OFFICE_UI_STANDARD.md`
4. `COMPONENT_CHECKLIST.md`
5. Спеціалізовані стандарти: `MODAL_STANDARD.md`, `DROPDOWN_STANDARD.md`, `KEYBOARD_SHORTCUTS.md`, `WORKSPACE_ACCESSIBILITY.md`, `CONTEXTUAL_UI_STANDARD.md`

Практичні правила:

- Перед змінами перевірити наявний патерн у редакторі.
- Для стандартних команд використовувати `OfficeShell.registerCommands` / `OfficeShell.runCommand` або сумісно `OfficeUI.registerCommands` / `OfficeUI.runCommand`.
- Для відкриття file input використовувати `OfficeShell.openFilePicker` або `OfficeUI.openFilePicker`.
- Для modal state використовувати або делегувати в `OfficeUI.openModal` / `OfficeUI.closeModal`.
- Не додавати браузерні тести без потреби; спершу додавати статичний contract check.
- Після змін запускати `tests/run-tests.ps1` і `git diff --check`.

Якщо цей файл суперечить `UI_INTEGRATION_GUIDE.md`, актуальним є `UI_INTEGRATION_GUIDE.md`.
