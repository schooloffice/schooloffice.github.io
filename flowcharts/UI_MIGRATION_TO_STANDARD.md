# UI_MIGRATION_TO_STANDARD.md — ПЛЮС Схеми

## Поточний стан

Базова міграція до shared shell завершена: command adapter, toolbar/menu parity, file picker, modal/status контракти та офлайн-прекеш підключені.

Редактор має модульну структуру й поведінковий browser smoke. Поточна функціональна база включає:

- валідацію логіки схеми з переходом до проблемного блока;
- локальні шаблони та drag-and-drop із палітри;
- ручні waypoints, obstacle-aware `smart` routing і безпечний fallback для великих схем;
- fit-to-view, zoom і панорамування середньою кнопкою або `Пробіл`+перетягування;
- JSON round-trip, undo/redo маршрутів, PNG/print export та офлайн-режим.

## Наступний фокус

- Додати вирівнювання й рівномірний розподіл вибраних блоків.
- Реалізувати простий контрольований auto-layout без заміни ручного редактора.
- Після стабілізації layout розглянути Mermaid import/export обмеженої підмножини.
- Провести ручний візуальний QA великих схем, print/PNG/JSON round-trip і touch-жестів.

## Підтримка

- Після додавання runtime-модуля синхронізувати `flowcharts/index.html`, `sw.js` і `tests/flowcharts-behavior.html`.
- Зберігати контракт маршрутизації `custom → smart → decision → merge → default` або явно змінювати його разом із тестами.
- Виняток `Ctrl+S = PNG` лишається свідомою локальною поведінкою; JSON save — toolbar Save і `Ctrl+Shift+S`.
