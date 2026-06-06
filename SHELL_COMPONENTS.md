# SHELL_COMPONENTS.md

Статус: довідковий документ.

Актуальний технічний контракт shell-компонентів описаний у:

- `UI_INTEGRATION_GUIDE.md`
- `OFFICE_UI_STANDARD.md`
- `UI_TOKENS.css`
- `shell-overrides.css`

Цей файл більше не є окремим нормативним джерелом. Його роль — швидко нагадати склад shell:

1. `office-header`
2. `office-menubar`
3. `office-toolbar`
4. service-specific contextual UI, якщо потрібен
5. `office-workspace`
6. `office-statusbar`

Кодові інваріанти перевіряє `tests/static-ui-audit.ps1`.

Не дублюй тут правила з `UI_INTEGRATION_GUIDE.md`. Якщо потрібно змінити shell-контракт, оновлюй інтеграційний гайд і статичний аудит.
