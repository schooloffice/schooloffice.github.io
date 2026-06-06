# UI_MIGRATION_TO_STANDARD.md — ПЛЮС Слайди

## Поточний Стан

Базовий shell, command adapter, file picker і runtime-аудіт підключені. `slides/js/runtime.js` лишається стабільним module entrypoint, а `slides/js/app.js` тепер є координатором верхнього рівня, не єдиним місцем усієї логіки редактора.

Поточний прохід зменшив технічний борг без надмірного збільшення кількості файлів: з `app.js` винесено тільки ті частини, які мають самостійну відповідальність і потрібні для майбутнього PowerPoint-подібного функціоналу.

## Поточна Структура

- `slides/js/runtime.js` — module entrypoint, який стійко запускає `SlidesApp.boot`.
- `slides/js/app.js` — boot, UI coordinator, command dispatch і зв'язування модулів.
- `slides/js/project.js` — нормалізація презентації/елементів, import/export JSON payload, filename slug.
- `slides/js/slide-list.js` — thumbnails, drag reorder і кнопки керування слайдами.
- `slides/js/stage-renderer.js` — DOM-рендеринг сцени, елементів, handles і selected-state.
- `slides/js/stage-interactions.js` — pointer state, drag, resize і координати сцени.
- `slides/js/modal-ui.js` — show/close/info/confirm modal behavior.
- `slides/js/state.js` — локальний state і serialization.
- `slides/js/history.js` — undo/redo stack.
- `slides/js/storage.js` — autosave draft у localStorage.
- `slides/js/templates.js` — створення слайдів, елементів і макетів.
- `slides/js/export.js` — PDF export, print і snapshot rendering.
- `slides/js/utils.js` — DOM, file і utility helpers.

## Зафіксовані Перевірки

- `tests/run-tests.ps1` перевіряє статичний shell/module контракт.
- `tests/run-browser-smoke.ps1` запускає `tests/slides-behavior.html`.
- `tests/slides-behavior.html` перевіряє:
  - browser import `slides/js/app.js`;
  - наявність `SlidesApp.boot`;
  - рендер списку слайдів;
  - рендер stage і stage elements;
  - стандартні команди `new/open/save/undo/redo`;
  - `normalizePresentation`, `parsePresentationText`, `slugify` з українським текстом.

## Найближчий Борг

Подальше дроблення `app.js` робити тільки за чіткою межею відповідальності. Найближчі перспективні напрями вже мають бути функціональними:

- themes і slide layouts;
- align/distribute/order object commands;
- tables/charts всередині слайдів;
- transition/animation controls;
- presenter mode і export сценарії.

## Обмеження

Не повторювати помилку надмірного дроблення. Новий модуль у `slides/js` має з'являтися лише тоді, коли він забирає самостійну відповідальність з `app.js`, додається в `sw.js` за потреби і покривається статичним аудитом або browser-smoke тестом.

Поточний висновок: Слайди достатньо стабілізовані для функціонального розвитку. Наступний редактор для техборгу перед нарощуванням можливостей — `paint/`.
