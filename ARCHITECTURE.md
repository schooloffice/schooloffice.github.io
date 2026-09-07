# Архітектура Office

Цей репозиторій має два узгоджені шари: shared root layer у корені репозиторію і локальні service layers кожного редактора. Мета рефакторингу - не збільшити кількість файлів, а зробити межі відповідальності керованими перед нарощуванням функціоналу.

## Shared Root Layer

Корінь репозиторію містить спільну інфраструктуру для всіх редакторів:

- `office-shell.js` - thin adapter для boot, command routing і file picker.
- `office-ui.js` - shared UI helpers: команди, modal/menu/dropdown/status поведінка.
- `office-draft-storage.js` - механізм браузерної чернетки (IndexedDB із fallback у localStorage).
  Що саме зберігати й коли відновлювати, вирішує редактор; спільним є лише механізм.
- `sw.js` - перехідний Service Worker: поки офлайн відкладено, він знімає реєстрацію та кеші попередніх офлайн-релізів і не обслуговує ресурси.
- `UI_TOKENS.css`, `shell-overrides.css` - shared shell styling.
- `vendor/` - локальні сторонні залежності.
- `tests/` - статичні й browser-smoke перевірки.

Shared layer не повинен містити редактор-специфічну бізнес-логіку.

## Service Layer

Кожен редактор має власну папку і відповідає лише за свою предметну логіку, UI і локальний state.

Рекомендована структура сервісу:

- `index.html` - HTML shell редактора.
- `style.css` - локальні стилі редактора.
- `js/runtime.js` - стабільний module entrypoint для HTML.
- `js/app.js` - boot, command adapter і координація верхнього рівня.
- `js/state.js` - локальний runtime state.
- `js/ui.js` або тематичні UI-модулі - DOM bindings, menu, toolbar, modal, panels.
- доменні модулі на кшталт `editor.js`, `canvas.js`, `project.js`, `formula-engine.js`.
- `js/export.js`, `js/storage.js`, `js/utils.js`, `js/constants.js` - за потреби.

## Layer Rules

- `index.html` підключає shared root файли лише наприкінці: `../office-shell.js`, `../office-ui.js`.
- `js/runtime.js` не містить бізнес-логіки; він імпортує `js/app.js` і запускає `window.<Editor>App.boot`.
- `js/app.js` не дублює shared root API, а делегує в `window.OfficeShell` і `window.OfficeUI`.
- Shared root layer не знає внутрішньої структури конкретного редактора, крім стабільних ресурсних шляхів у тестах.
- Локальні модулі можуть залежати від shared root API, але не повинні конфліктувати з глобальними іменами інших редакторів.

## Правило Нарізки Модулів

Новий локальний JS-файл виправданий лише тоді, коли він:

- має самостійну доменну відповідальність;
- зменшує змішування UI, state, persistence, parsing або domain logic;
- має стабільний порядок підключення або імпорту;
- покритий статичним аудитом або browser-smoke сценарієм.

Якщо файл менший за 30-40 рядків і не має окремої ролі, його краще залишити частиною сусіднього шару. Мета - зрозуміла система, а не велика кількість модулів.

## Поточний Стан Редакторів

### Tables

`tables/` уже пройшов великий етап декомпозиції:

- `core.js` став фасадом ініціалізації;
- модель, storage, адресація і формули винесені в окремі core-шари;
- формульний рушій розділений на parser, references, functions і coordinator;
- UI-дії, clipboard, formatting, structure, charts, sorting, workbook file і calculation рознесені по доменних модулях.

Подальше агресивне дроблення Таблиць не є пріоритетом. Наступний етап для `tables/` - стабілізація, інтеграційні перевірки і розвиток можливостей.

### Slides

`slides/` отримав керовану структуру без надмірного дроблення:

- `runtime.js` лишається тонким і стійко запускає `SlidesApp.boot` як до, так і після `DOMContentLoaded`;
- `app.js` лишається координатором;
- `project.js` відповідає за нормалізацію, import/export JSON payload і filename slug;
- `element-rendering.js` відповідає за спільні visual text styles і SVG-геометрію фігур stage/export;
- `image-geometry.js` відповідає за спільну crop-математику stage та export;
- `object-commands.js` відповідає за чисті object-команди без DOM та history;
- `presentation-design.js` відповідає за чисті доменні операції тем і макетів без DOM та history;
- `history.js` використовує обмежені full snapshots; перехід на diff/command history допустимий лише після виміряного bottleneck;
- `slide-list.js` відповідає за thumbnails, drag reorder і кнопки керування слайдами;
- `stage-renderer.js` відповідає за DOM-рендер сцени, елементів, handles і selected-state;
- `stage-interactions.js` відповідає за pointer state, drag і resize;
- `modal-ui.js` відповідає за локальні modal helpers;
- `templates.js` і `state.js` очищені від пошкоджених Unicode/control-символів;
- `tests/slides-behavior.html` перевіряє browser-runtime boot, stage render і project helpers.

Поточний висновок: стабілізаційну Хвилю 4.5 завершено, і Слайди готові для функціонального
розвитку у напрямку PowerPoint-подібного редактора. Далі варто додавати можливості поверх
наявних меж, а не дробити файли механічно.

### Flowcharts

`flowcharts/` має модульну структуру, поведінковий browser smoke, валідацію схеми, локальні шаблони, ручні waypoints і obstacle-aware routing. `editor.js` лишається orchestration-шаром, `core.js` — чистою доменною логікою й project validation, а `routing.js` явно оркеструє стратегії `custom → smart → decision → merge → default`.

Наступний архітектурний крок має бути функціональним: вирівнювання та контрольований auto-layout. Не дробити routing/editor механічно; окремий модуль виправданий лише для нової доменної межі, наприклад layout або Mermaid adapter.

### Paint і Vector

`paint/` уже розділено на document/storage/tools/text — старий опис моноліту застарів.

- `vector/js/app.js` лишається великим: доменна логіка винесена в `editor.js`, але file/lifecycle/interaction ще змішані в `app.js`;
- дроблення заради розміру файла не є метою. Переробляти варто там, де зміна одного сценарію зачіпає кілька незалежних відповідальностей.

Рекомендований наступний фокус: `paint/`, бо він має найбільший потенціал швидко відокремити доменні блоки без ризику надмірної нарізки.
