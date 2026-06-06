# Пакет UI-стандартів для Офіс ПЛЮС

Ця папка містить MVP шкільного офісного пакета і нормативну базу для приведення всіх редакторів до єдиного стилю, поведінки та тестованої структури.

## Редактори

- `text/` — ПЛЮС Текст
- `tables/` — ПЛЮС Таблиці
- `paint/` — ПЛЮС Малюнки
- `slides/` — ПЛЮС Слайди
- `flowcharts/` — ПЛЮС Схеми
- `vector/` — ПЛЮС Вектор

## Документація

### Активні джерела правди

- `README.md` — карта пакета, поточний стан і політика документації
- `ARCHITECTURE.md` — межа між shared root-шаром і локальними шарами редакторів
- `UI_INTEGRATION_GUIDE.md` — технічний контракт інтеграції редакторів із shared shell
- `OFFICE_UI_STANDARD.md` — головний UI-стандарт усієї лінійки
- `office-shell.js` — shared helper для boot, command routing і file picker у редакторах
- `UI_TOKENS.css` — спільні CSS-токени та базові shell-компоненти
- `design-tokens.json` — машинозчитуваний набір дизайн-токенів
- `SERVICE_THEME_MAP.json` — карта сервісів, акцентів і структури меню
- `KEYBOARD_SHORTCUTS.md` — єдиний стандарт гарячих клавіш
- `MODAL_STANDARD.md` — єдиний стандарт модальних вікон
- `DROPDOWN_STANDARD.md` — єдиний стандарт dropdown, menu, picker і popover-поведінки
- `WORKSPACE_ACCESSIBILITY.md` — focus-visible, tabindex, повернення фокуса і keyboard interaction у workspace
- `CONTEXTUAL_UI_STANDARD.md` — єдиний стандарт контекстного UI
- `COMPONENT_CHECKLIST.md` — чекліст для рев'ю, QA і приймання
- `CHANGELOG.md` — фактичний журнал системних змін пакета

### Довідкові та шаблонні файли

- `APP_SHELL.html` — базовий HTML-шаблон shell-інтерфейсу
- `SHELL_COMPONENTS.md` — деталізація shell-компонентів
- `SERVICE_SHELL_BLUEPRINTS.md` — shell-схеми для кожного редактора
- `UI_REVIEW_TEMPLATE.md` — шаблон формалізованого UI-рев'ю
- `PROMPT_FOR_AGENT.md` — регламент для агента або розробника
- `CHANGELOG_STANDARD.md` — стандарт ведення changelog для UI-змін

Ці файли поки залишаються в репозиторії як довідка, але не мають дублювати або перекривати `UI_INTEGRATION_GUIDE.md`. Якщо правило повторюється, актуалізувати треба активне джерело правди.

### Висновок щодо кількості файлів

Поточна кількість документів завелика для щоденної розробки, якщо всі вважати нормативними. Оптимальна модель:

- тримати 8-10 активних документів як джерела правди;
- довідкові шаблони залишити до окремого архівного кроку;
- не додавати нові Markdown-файли без явної ролі;
- поступово переносити дублікати правил у `UI_INTEGRATION_GUIDE.md` або спеціалізований стандарт.

У корені кожного редактора повинні бути:

- `UI_STANDARD.md`
- `UI_MIGRATION_TO_STANDARD.md`

## Поточна стратегія міграції

1. Зафіксувати baseline і тестовий стенд.
2. Підключити `UI_TOKENS.css` і `office-*` shell-класи у всі редактори.
3. Винести зовнішні CDN-ресурси в локальний `vendor/`, щоб редактори працювали офлайн.
4. Уніфікувати меню, toolbar, statusbar, zoom, undo/redo.
5. Уніфікувати поведінку keyboard shortcuts, dropdown, modal і workspace focus.
6. Після цього полірувати редактори по одному за локальними `UI_MIGRATION_TO_STANDARD.md`.

### Поточний технічний висновок

`tables/` уже пройшов великий етап декомпозиції: `core.js` став фасадом, формульне ядро розділене на parser/references/functions/engine, а UI, clipboard, formatting, structure, charts, sorting, workbook file і calculation винесені в окремі модулі.

`slides/` також отримав керовану структуру: project helpers, slide list, stage renderer, stage interactions і modal UI винесені з `app.js`, runtime boot став стійким до timing-проблем, а `tests/slides-behavior.html` фіксує browser-runtime boot, stage render і project helpers. Подальше механічне дроблення Слайдів не є пріоритетом; наступні кроки там мають бути функціональними: теми, макети, вирівнювання об'єктів, transitions/animations, таблиці/діаграми у слайдах і presenter/export сценарії.

Наступний рекомендований фокус для зменшення техборгу перед нарощуванням функціоналу — `paint/`. У ньому найбільший практичний виграш дасть обережне відокремлення file/export, tool actions і canvas interaction від великого `app.js`/`canvas.js` без створення зайвих дрібних модулів.

## Тести

Запуск базового статичного аудиту:

```powershell
powershell -ExecutionPolicy Bypass -File tests\run-tests.ps1
```

Запуск headless browser smoke:

```powershell
powershell -ExecutionPolicy Bypass -File tests\run-browser-smoke.ps1
```

Очищення локальних артефактів browser smoke:

```powershell
powershell -ExecutionPolicy Bypass -File tests\cleanup-test-artifacts.ps1
```

Тест перевіряє:

- наявність обов'язкових стандартів;
- наявність усіх 6 редакторів;
- локальні `UI_STANDARD.md` і `UI_MIGRATION_TO_STANDARD.md`;
- підключення `../UI_TOKENS.css`;
- `body.office-app` і правильний `data-office-service`;
- базові `office-header`, `office-menubar`, `office-toolbar`, `office-workspace`, `office-statusbar`;
- focusable workspace;
- очікувані пункти меню;
- parity між стандартними командами тулбара і головного меню;
- `OfficeShell.registerCommands` / `OfficeShell.runCommand` як стандартний adapter-шар для `new/open/save/undo/redo`;
- `OfficeShell.openFilePicker` для file-open entry points;
- modal/dropdown/statusbar контракти.
- `sw.js` precache-контракт: `CORE_ASSETS` не має мертвих шляхів і містить локальні asset-и, які підключають HTML-файли редакторів.

`tests/browser-smoke.html` можна відкрити в браузері як додатковий smoke-тест DOM-структури, а `tests/run-browser-smoke.ps1` автоматизує цей сценарій через headless Chrome і додатково запускає поведінкові перевірки для Flowcharts, Slides і Tables. Для `slides/` `slides/js/runtime.js` лишається тонкою module-entry обгорткою для стабільного підключення в HTML, а `tests/slides-behavior.html` перевіряє, що `SlidesApp.boot`, список слайдів, сцена і project helpers справді працюють у браузері. Зовнішні CDN-ресурси поки лише позначаються warning-ами: їх винесення в локальний `vendor/` є окремим наступним кроком. Директорії `tests/.browser-profile*` і файли `.browser-smoke.*` є локальними артефактами запуску; вони ігноруються git і чистяться через `tests\cleanup-test-artifacts.ps1`.

Локальний сервер для першої браузерної перевірки:

```powershell
powershell -ExecutionPolicy Bypass -File tests\serve-office.ps1 -Port 4173
```

Після запуску відкрий:

- `http://127.0.0.1:4173/`
- `http://127.0.0.1:4173/tests/browser-smoke.html`

## Поточний стан базової уніфікації

Станом на зараз у пакеті вже зроблено такі базові кроки:

- прибрано жорстку прив'язку runtime-маршрутів до старого брендового префікса;
- усі 6 редакторів підключені до спільного shell-шару через `UI_TOKENS.css`, `office-shell.js`, `office-ui.js` та `offline.js`;
- уніфіковано базовий app shell:
  - header
  - menubar
  - toolbar
  - workspace
  - statusbar
- уніфіковано порядок стандартних toolbar-команд:
  - `new`
  - `open`
  - `save`
  - `undo`
  - `redo`
- додано command-adapter контракт:
- `OfficeShell.registerCommands(...)`
- `OfficeShell.runCommand(...)`
  - parity між тулбаром, головним меню і hotkeys
- додано shared file-picker helper:
- `OfficeShell.openFilePicker(inputOrId)`
  - централізоване скидання `input.value`
- додано спільну поведінку dropdown/menu:
  - відкриття з клавіатури
  - `Escape`
  - click-outside
  - повернення фокуса
- додано спільний enhancer для modal-патернів:
  - ARIA/role
  - `Escape`
  - focus return
  - focus loop всередині модалки
- додано спільний статусний шар:
  - `OfficeUI.announce(message)`
  - `OfficeUI.updateStatus(message, slot)`
  - подія `office:status`
- statusbar-и всіх редакторів отримали спільну семантику слотів:
  - `primary`
  - `secondary`
  - додаткові `meta` / service-specific слоти за потреби
- alert-семантику runtime-коду замінено на modal-семантику:
  - `showInfoModal`
  - `showConfirmModal`
  - `showPromptModal`
  - без `alertModal`, `showAlert`, `showTextPrompt`
- confirm-кнопки вирівняно до моделі `Скасувати` + конкретна дія;
- підготовлено offline-базу:
  - локальні vendor-ресурси
  - `offline.js`
  - `sw.js`
- Таблиці розділено на доменні JS-шари з перевіркою в `tests/static-ui-audit.ps1` і `tests/tables-formula-behavior.html`.

## Що ще залишилось

До завершення базового етапу уніфікації залишилось:

- вирішити, які довідкові Markdown-файли переносити в архів після стабілізації;
- привести нечитабельні або дубльовані довідкові документи до UTF-8 або замінити посиланням на активне джерело правди;
- візуально відполірувати реальні тексти statusbar у всіх редакторах;
- завершити візуальне вирівнювання коротких системних повідомлень і confirm/info/prompt-сценаріїв;
- пройти ручний візуальний QA по всіх редакторах у браузері;
- після цього переходити до шліфування кожного редактора окремо.
