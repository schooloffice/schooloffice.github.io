# UI_MIGRATION_TO_STANDARD.md — ПЛЮС Слайди

## Поточний Стан

Базовий shell, command adapter, file picker і runtime-аудіт підключені. `slides/js/runtime.js` лишається стабільним module entrypoint, а `slides/js/app.js` тепер є координатором верхнього рівня, не єдиним місцем усієї логіки редактора.

Поточний прохід зменшив технічний борг без надмірного збільшення кількості файлів: з `app.js` винесено тільки ті частини, які мають самостійну відповідальність і потрібні для майбутнього PowerPoint-подібного функціоналу.

## Поточна Структура

- `slides/js/runtime.js` — module entrypoint, який стійко запускає `SlidesApp.boot`.
- `slides/js/app.js` — boot, UI coordinator, command dispatch і зв'язування модулів.
- `slides/js/project.js` — нормалізація презентації/елементів, import/export JSON payload, filename slug.
- `slides/js/slide-list.js` — thumbnails, drag reorder і кнопки керування слайдами.
- `slides/js/stage-renderer.js` — DOM-рендеринг сцени, елементів, resize/rotate handles і selected-state.
- `slides/js/stage-interactions.js` — pointer state, drag/resize/rotate, рамка вибору (marquee), smart guides + прив'язка (екранний поріг, AABB з урахуванням rotation), rotation-aware resize.
- `slides/js/modal-ui.js` — show/close/info/confirm modal behavior.
- `slides/js/state.js` — локальний state і serialization.
- `slides/js/history.js` — undo/redo stack.
- `slides/js/storage.js` — autosave draft у IndexedDB з graceful-фолбеком на localStorage і міграцією старої localStorage-чернетки.
- `slides/js/templates.js` — створення слайдів, елементів і макетів.
- `slides/js/export.js` — PDF export, print і snapshot rendering.
- `slides/js/utils.js` — DOM, file і utility helpers.

## Реалізовано (хвилі 0–2 і підетап 3.1)

- **Хвиля 0 — надійність ядра:** коректний undo/redo (commit-after, коаліс­ція drag/typing), розділені статуси `dirty`/draft-saved/file-saved, захищена versioned-нормалізація імпорту (ліміти, allowlist кольорів, нейтралізація зовнішніх URL, унікальні ID), автозбереження в IndexedDB з фолбеком на localStorage і реконсиляцією за часом.
- **Хвиля 1 (частково) — мультивибір:** `selectedElementIds`, shift-клік, Ctrl+A, marquee, груповий drag/нудж/delete/copy/paste, форматування за всіма вибраними. (№6 align/distribute/group — ВІДКЛАДЕНО.)
- **Хвиля 2 — зручне полотно:** zoom (фіксована сцена 960×540 + transform-scale, fit-to-window, Ctrl+±/0, Ctrl+колесо); smart guides + прив'язка до країв/центра/об'єктів + сітка; rotation handle, Shift-пропорції resize, rotation-aware resize, Alt+drag-дублювання, контекстне меню (миша + Shift+F10); доступність (alt text зображень, видимий focus, Tab-цикл об'єктів, ↑/↓ між слайдами, aria-labels).
- **Хвиля 3.1 — базове форматування текстового блока:** локальні сімейства шрифтів, довільний розмір 4–400, пресети міжрядкового інтервалу, нормальна/жирна вага 400/700; однаковий рендер на полотні, у мініатюрах і PDF/print; allowlist-нормалізація нових полів та версія текстової моделі у файлі.

## Зафіксовані Перевірки

- `tests/run-tests.ps1` перевіряє статичний shell/module контракт (зокрема відповідність `$('#id')`-посилань HTML- id з allowlist динамічних).
- `tests/run-browser-smoke.ps1` (бюджет virtual-time 35000) запускає `tests/slides-behavior.html`.
- `tests/slides-behavior.html` (~88 перевірок) покриває: boot/рендер/стандартні команди; нормалізацію (ліміти, безпека, унікальність ID, alt); storage (IDB round-trip, quota, tombstone, reload-restore); undo/redo + коаліс­цію; мультивибір (Ctrl+A, multi-delete, shift-toggle, marquee, copy/paste, змішане форматування); zoom (масштаб, незмінність координат, drag/resize/marquee при zoom); smart guides + сітку; rotation/Shift-resize/rotation-aware resize/Alt-drag/контекст-меню; доступність (Tab-цикл, навігація слайдів, клавіатурне контекст-меню, aria-label).

## Найближчий Борг

Подальше дроблення `app.js` робити тільки за чіткою межею відповідальності. Найближчі напрями:

- align/distribute/group object commands (відкладений №6);
- решта Хвилі 3 — списки, зображення (crop/replace), фігури (лінії/стрілки, текст у фігурі);
- themes і справжні slide layouts з placeholders;
- tables/charts всередині слайдів;
- presenter mode, transitions і PPTX export.

## Обмеження

Не повторювати помилку надмірного дроблення. Новий модуль у `slides/js` має з'являтися лише тоді, коли він забирає самостійну відповідальність з `app.js`, додається в `sw.js` за потреби і покривається статичним аудитом або browser-smoke тестом.

Поточний висновок: Слайди достатньо стабілізовані для функціонального розвитку. Наступний редактор для техборгу перед нарощуванням можливостей — `paint/`.
