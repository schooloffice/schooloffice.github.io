# CHANGELOG

## 2026-06-15

### Paint: project-файл (.malyunok) — повний save/open round-trip (Ітерація 5)

DoD-вимога «save/open round-trip не втрачає суттєвий стан».

- **Локальний project-файл** `.malyunok` (JSON: `format`/`version`/`document`/`raster`) зберігає повний редагований стан (розмір, фон, прозорість, увесь растр із alpha). `Ctrl+S` / «Зберегти проєкт» / shell-команда `save` тепер зберігають **проєкт** (через `commitPending` спершу запікається весь незавершений стан). PNG/JPG стали **«Експортувати»** (пласке зображення для обміну).
- **Відкриття проєкту** (`open`-команда, меню «Відкрити проєкт…») з **P0 schema-валідацією** недовіреного файлу: перевірка `format`, версії, меж розміру/пікселів документа, MIME та довжини растру, ліміту розміру файлу; санітизація фону (hex) і назви. Невалідні/пошкоджені файли відхиляються з повідомленням, не ламаючи редактор.
- Меню «Файл» перебудовано: Новий / Відкрити проєкт / Відкрити зображення · Зберегти проєкт · Експортувати PNG/JPG / Друк. Rail: office-команди `open`/`save` тепер вказують на проєкт.
- `sw.js` → `v32`. `tests/paint-behavior.html`: project round-trip (растр+розмір+назва) і відхилення поганого формату / завеликих розмірів / пошкодженого JSON.

### Paint: централізований commit незавершеного стану (фікс втрати вмісту)

Критичний перегляд Ітерацій 1–4 виявив баг із втратою даних: експорт/збереження/друк не фіксували незавершений редагований стан. `exportMergedCanvas` зливав активну фігуру (`state.objects`), але не активний текстовий overlay (`<textarea>`) і не плаваюче виділення (на окремому overlay-canvas) — тож набраний, але не підтверджений текст / посунуте виділення зникали зі збереженого файлу.

- **Єдиний `commitPending()`** (`app.js`) запікає весь незавершений стан (текст + плаваюче виділення + активна фігура/штамп) у растр. Кликається на КОЖНІЙ межі WYSIWYG: збереження PNG/JPG, друк (меню + Ctrl+S/Ctrl+P + shell-команда save), а також rotate/flip/«Розмір полотна»/«Масштабувати зображення». Прибирає і сам баг, і розкидані по коду окремі commit-виклики.
- Побічно виправлено неузгодженість: «Розмір полотна» (resize, scale:false) тепер теж запікає активну фігуру (раніше — ні).
- Імпорт зображення прибирає активний текстовий overlay (`discardActiveText`).
- `sw.js` → `v31`. `tests/paint-behavior.html`: набраний текст при Ctrl+S запікається в растр (перевірка пікселів + зникнення overlay).

### Paint: фігури/штампи на operation-моделі (завершення Ітерації 4)

Останній крок raster-first переробки: фігури і штампи більше не «вічні» DOM-об'єкти.

- **Тимчасова operation-модель.** Після розміщення фігура/штамп лишається редагованою (move/resize наявними ручками), але **запікається в растр** (`canvasApi.flattenObjects`) щойно користувач починає нову дію на полотні, змінює інструмент або тисне Enter (`flattenActiveObjects` в `app.js`). Escape теж запікає. Так `objectLayer` тепер тримає щонайбільше один активний об'єкт — постійний DOM-шар фактично став тимчасовим, а per-move innerHTML rebuild більше не масштабується з кількістю об'єктів (закриває техборг, відзначений у критиці Ітерації 2.5).
- Undo коректний: запікання не додає окремого запису (snapshot на початку розміщення вже покриває весь цикл place→adjust→flatten).
- `sw.js` → `v30`. `tests/paint-behavior.html`: фігура запікається в растр при наступній дії на полотні (objects очищається, пікселі лишаються).

### Paint: основний/додатковий колір (Ітерація 4, частина 3)

Завершує «Кольори» Етапу 7.

- **Два кольори, як у MS Paint:** основний (`state.currentColor`) і додатковий (`state.backgroundColor`). **Ліва кнопка миші** малює основним, **права** — додатковим (раніше права кнопка ігнорувалася). Працює для пензля, заливки і фігур через `state.activeColor`, який виставляється на pointerdown.
- **UI:** дві накладені плашки (foreground/background) + кнопка обміну і клавіша **X**; контекстне меню на полотні та палітрі вимкнено. Правий клік по палітрі задає додатковий колір.
- Додатковий колір зберігається в чернетці. `sw.js` → `v29`.
- `tests/paint-behavior.html`: UI присутній, права кнопка малює додатковим кольором (pointer-pipeline), X міняє кольори місцями.

### Paint: текстовий інструмент (Ітерація 4, частина 2)

- **Інструмент «Текст»** на tool registry: клік на полотні створює редаговану текстову область (`<textarea>` overlay, z5, авторозмір, без перенесення), яка **запікається в растр** при підтвердженні (`canvasApi.drawText`) — raster-first, без постійних об'єктів. Підтвердження: Esc, зміна інструмента, нова текстова область; трансформації/crop/scale запікають текст перед собою, новий документ/clear — відкидають, undo/redo — теж відкидають активний overlay.
- **Параметри тексту** в боковій панелі (секція `text`): шрифт (без зарубок / із зарубками / моноширинний / Nunito), розмір, **Ж**/**К** (жирний/курсив); колір — зі спільної палітри. Overlay оновлюється наживо при зміні шрифту/кольору/zoom (WYSIWYG). Кнопка в rail, статус і підказка.
- Налаштування шрифту зберігаються в чернетці. `sw.js` → `v28`.
- `tests/paint-behavior.html`: наявність інструмента/панелі, запікання тексту в растр (перевірка пікселів). Storage-перевірку зроблено детермінованою (підключення модуля + логіка звірки замість нестабільного headless-IDB round-trip).

### Paint: робоча прозорість документа (Ітерація 4, частина 1)

Опція «прозорий фон» (з'явилася в Ітерації 1) тепер працює наскрізь, а не лише як прапорець.

- **Гумка очищає alpha.** На прозорому документі гумка малює в режимі `destination-out` (реально стирає до прозорого), а не білим; на непрозорому — фоновим кольором документа (`erase`).
- **Checkerboard під документом.** Прозорий документ показує світлий checkerboard замість суцільного білого (`.canvas-stage.transparent-doc`, перемикається в `applyDisplaySize`).
- **Експорт зберігає прозорість.** `exportMergedCanvas({ flatten })` + `exportImage`: PNG для прозорого документа зберігає alpha, JPG (без alpha) і непрозорий PNG заливаються фоном документа.
- `tests/paint-behavior.html`: гумка чистить alpha, стейдж отримує/знімає checkerboard-клас, PNG-композит зберігає alpha. `sw.js` → `v27`.

### Paint: чернетка в IndexedDB (завершення Ітерації 3)

- **`paint/js/storage.js`** — чернетка переїхала з `localStorage` в IndexedDB (structured clone, без ~5 МБ ліміту — критично, бо документи тепер бувають великі). Патерн портовано зі `slides/js/storage.js`: IDB з м'яким fallback на localStorage, таймаути операцій (для headless/приватного режиму), записи з позначкою часу й вибір новішої копії з обох сховищ. `document.js` autosave/restore тепер ідуть через `paintStorage.saveDraft/loadDraft`; старий формат localStorage-чернетки читається сумісно.
- `storage.js` додано в `sw.js` (→ `v26`) та `index.html`; `tests/paint-behavior.html` перевіряє round-trip чернетки через storage-шар.

### Paint: tool registry + перші інструменти Ітерації 3

Початок Ітерації 3: винесено диспетчер інструментів у спільний контракт і додано перші нові інструменти на ньому.

- **Tool registry (`paint/js/tools.js`).** Кожен інструмент — об'єкт зі спільним контрактом `begin/update/commit/cancel`; pointer-обробники в `app.js` більше не мають розгалужень `if/else` по `currentTool`, а делегують `tools.getActive()`. Наявні інструменти (пензлик, гумка, заливка, фігури, штампи) перенесено в реєстр без зміни поведінки.
- **Піпетка (eyedropper).** Новий інструмент: клік бере колір пікселя (`canvasApi.pickColor`) і застосовує його; кнопка в лівій rail, клавіша `I`. Перевіряє реєстр і координатну трансформацію.
- **Поворот і відзеркалення.** Нове меню «Зображення»: поворот на 90° за/проти годинникової, на 180°, відзеркалення по горизонталі/вертикалі (`canvasApi.rotate90/rotate180/flip`). Трансформації спершу запікають об'єкти в растр (`flattenObjects`) — крок до raster-first моделі. «Розмір полотна…» переїхав із «Перегляд» у «Зображення».
- **Прямокутне виділення (інструмент «Виділення», клавіша `S`).** Окреме оверлей-полотно (`selectionCanvas`, z4) із пунктирною рамкою; перетягування рамки, переміщення з «підняттям» пікселів у плаваючий буфер (джерело очищається до фону), `Delete` — видалити, `Ctrl+C/X/V` — копіювати/вирізати/вставити, `Enter`/`Esc`/зміна інструмента — зафіксувати в растр. Undo/redo і зміна розміру документа коректно скидають виділення.
- **Crop і масштабування.** «Обрізати до виділення» (`canvasApi.cropToSelection`), «Масштабувати зображення…» (`resizeDocument({ scale: true })`) і «Розмір полотна…» (crop/розширення) — три окремі поняття в меню «Зображення».
- **Прибрано дубль стану `state.canvasWidth/Height`** — усюди тепер `state.document.*` (єдине джерело правди розміру).
- `tests/paint-behavior.html` розширено: реєстр/піпетка, піпетка бере колір через реальний pointer-pipeline, поворот міняє dimensions, flip дзеркалить растр, виділення copy/delete/paste + pointer-маркер, crop, масштабування. `tools.js` додано в `sw.js` (→ `v25`) та `index.html`.

## 2026-06-14

### Paint: зміцнення підмурку перед інструментами (Ітерація 2.5)

Критична самооцінка Ітерацій 1–2 виявила три підмуркові ризики, на яких не варто будувати інструменти Ітерації 3. Закрито найризиковіше; решту (IndexedDB-чернетка, дубль `canvasWidth/Height`) свідомо відкладено в Ітерацію 3.

- **Історія undo/redo — синхронна, на canvas-снапшотах, із memory budget.** `snapshot()` тепер зберігає растр як offscreen-`<canvas>` (а не PNG dataURL), `restoreSnapshot()` синхронний (без async `Image`-декоду й прихованих гонок). `pushUndo` обмежує історію і за кількістю (`MAX_UNDO` 80), і за пам'яттю (`HISTORY_MAX_BYTES` 128 МБ) — критично, бо Ітерація 1 дозволила документи до 16 МП. Серіалізацію чернетки відокремлено: `toSerializable()`/`restoreSerializable()` (dataURL, JSON-safe) для localStorage, окремо від canvas-снапшотів історії; старий формат чернетки читається через адаптер.
- **Координатна трансформація централізована.** Додано `clientToDoc`/`docToClient` як єдине джерело правди viewport↔документ; `getPointerPosition` і `zoomAtPoint` тепер делегують їм (надійна основа для selection/crop/text Ітерації 3).
- **Закрито XSS-поверхню `innerHTML`.** `objectMarkup`/`shapeSvgMarkup` екранують текст штампа й `id` (`escapeHtml`), валідують колір (`sanitizeHexColor`) і приводять координати до `Number` — перед майбутнім завантаженням об'єктів із project-файлу (P0 у `PROJECT_DIRECTION.md`).
- Прибрано невикористане поле `state.activeOperation` (повернемо, коли реалізуємо operation-модель).
- `tests/paint-behavior.html` посилено справжніми e2e-перевірками: малювання pointer-подіями при zoom 3× потрапляє в правильний піксель, синхронний undo відкочує мазок, значення об'єктів екрануються проти XSS.

### Paint: desktop-розкладка з лівими панелями (Ітерація 2)

Перехід на компонування у стилі десктопних растрових редакторів. Верх редактора тепер містить **лише назву та головне меню** — великий горизонтальний toolbar прибрано, усе перенесено в ліву колонку.

- **Нова grid-розкладка** — `.editor-body` (`grid-template-columns: rail | properties | workspace`, house-style як у `flowcharts/`): ліва **tool rail** (іконки) + контекстна **properties panel** + workspace із документом-сторінкою.
- **Tool rail** — швидкі дії (новий/відкрити/зберегти/друк, undo/redo), інструменти (пензлик/гумка/заливка/фігури/штампи) і небезпечні дії (видалити/очистити) знизу. `data-office-command` кнопки збережено в порядку new/open/save/undo/redo; rail несе клас `office-toolbar` для контракту shell.
- **Properties panel** — параметри активного інструмента показуються контекстно (`data-tool-section`): режим пензлика, фігура, штамп, товщина, непрозорість; завжди видимі — палітра, власний колір і **RGB/BIN мікшер** (тепер інлайнова згортувана секція замість плаваючої панелі).
- **Дропдауни-пікери прибрано** — режими/фігури/штампи рендеряться інлайн у панелі; `bindPickers/openPicker` видалено, `closePickers` лишився no-op для сумісності.
- **Zoom-контроли** переїхали в нижню статус-смугу (кнопки −/100%/+/fit + індикатор).
- **Адаптивність** — на вузьких екранах rail і panel звужуються, статус-смуга стекається; rail лишається доступним.
- Контракт static-ui-audit оновлено (Paint більше не має picker-стану); `tests/paint-behavior.html` розширено перевірками rail/properties/контекстних секцій. Повний smoke і static audit проходять.

### Paint: модель документа фіксованого розміру + viewport (Ітерація 1)

Старт raster-first переробки ПЛЮС Малюнки у стилі сучасного MS Paint. Головний дефект, який лікувала ця ітерація: розмір полотна дорівнював розміру DOM-контейнера, тож resize вікна перемальовував і спотворював растр.

- **Модель документа як єдине джерело правди** — `state.document` (`version`, `width`, `height`, `background`, `transparent`) і `state.viewport` (`zoom`, `fitMode`, `panX/panY`). Backing store полотна тепер дорівнює пікселям документа й **не залежить** від контейнера. `state.canvasWidth/Height` лишаються дзеркалами для сумісності.
- **`canvas.js`** — `resizeToContainer()` прибрано; додано `setDocumentSize`, `resizeDocument` (crop/розширення зі збереженням растру), `fillBackground`, `applyDisplaySize`, `fitDocumentToViewport`, `refit` (resize вікна перераховує лише zoom), `setZoom/zoomIn/zoomOut/zoomTo100/zoomAtPoint`, `centerScroll`. `snapshot()` тепер містить розмір/фон документа, тож undo/redo відновлює dimensions.
- **Viewport, zoom і pan** — сірий scroll-стейдж із документом-сторінкою по центру (тінь, checkerboard навколо); zoom in/out, 100%, fit-to-window, Ctrl+колесо (із прив'язкою до курсора), pan колесом/скролбарами та Space/середня кнопка + drag. Координати pointer коректно конвертуються в пікселі документа за будь-якого zoom.
- **Діалог нового документа / розміру полотна** — ширина, висота, білий або прозорий фон, готові формати (800×600, 1024×768, 1280×720, A4 книжкова/альбомна, квадрат). Імпорт зображення відкривається у реальному розмірі з лімітами сторони (4096) і пікселів (16 МП).
- **Статусбар і панель** — додано zoom-контроли (тулбар + меню «Перегляд» + Ctrl +/−/0) і zoom-індикатор у статусбарі; пункт «Розмір полотна…».
- **Регресія (Етап 0)** — `tests/paint-behavior.html` розширено перевірками: resize вікна не змінює dimensions і не спотворює растр, fit-to-window зберігає пікселі, координати узгоджені при zoom 1×/4×, undo відновлює розмір документа, новий розмір дає задані dimensions. Повний browser smoke і static audit проходять.

## 2026-06-06

### Flowcharts: навчальні та UX-покращення (натхнені порівнянням з FCD)

- **Перевірка логіки схеми** — додано чисту функцію `FlowchartCore.validateDiagram` (немає «Початку»/кілька «Початків», немає «Кінця», недосяжні блоки, умова без гілки «Так/Ні», блоки без входу/виходу, дубльовані стрілки) та модуль `flowcharts/js/validation.js` з бічною панеллю результатів; клік по знахідці підсвічує проблемний блок. Пункт меню `Редагування → Перевірити схему`.
- **A\*-подібне прокладання стрілок з обходом блоків** — новий UMD-модуль `flowcharts/js/obstacle-routing.js` (граф координатних ліній + A* зі штрафом за повороти) як режим маршруту `smart` («Розумний обхід»); коли детальна сітка завелика або шлях не знайдено, використовується перевірений зовнішній обхід, а не маршрут крізь блоки.
- **Ручне редагування сегментів стрілок** — модуль `flowcharts/js/connection-waypoints.js`: рожеві ручки на вибраній стрілці (перетягування вузлів, ghost-точки для додавання згину, подвійний клік для видалення). Waypoints і прапорець `isCustom` серіалізуються у JSON та переживають undo/redo; перемикання маршруту скидає ручний шлях.
- **Локальні шаблони схем** — `flowcharts/js/templates-data.js` (порожня, лінійний алгоритм, розгалуження, цикл, вкладене розгалуження, підпрограма) і `flowcharts/js/templates.js` з галереєю; завантаження проходить через ту саму валідацію імпорту. Пункт меню `Файл → Шаблони схем…`.
- **Drag-and-drop із палітри** — `flowcharts/js/palette-dnd.js`: блок можна перетягнути одразу в потрібне місце (напівпрозорий preview, прив'язка до сітки), при цьому звичайний клік далі працює.
- **«Вмістити всю схему» та покращене панорамування** — `viewport.fitToBounds`, кнопка тулбара та `Shift+1`; панорама середньою кнопкою миші та `Пробіл`+перетягування.
- Усі нові локальні скрипти додано в `sw.js` (офлайн), піднято `CACHE_VERSION` до `office-plus-v8`; `tests/flowcharts-behavior.html` розширено перевірками всіх нових модулів. Меню та панель інструментів не змінювалися структурно — лише додано нові пункти/кнопку.

#### Доопрацювання після рев'ю

- Drag-and-drop: прапорець придушення кліку скидається на наступному `pointerdown`, тож відсутній трейлінг-клік більше не «з'їдає» наступний навмисний клік.
- Панорамування `Пробіл`/середня кнопка тепер працює і поверх фігур, стрілок, waypoint та conn-handle (усі ці елементи пропускають пан-жест через спільний `panGestureCheck`).
- `smart` для гілок «Так/Ні»: маршрут виходить уздовж сторони через lead-стаб, усі блоки (включно з джерелом/ціллю) — перешкоди, а decision-перешкоди розширено до меж діаманта, тож стрілка не повертається крізь умову.
- `smart` для великих і складних схем: якщо детальна A* сітка перевищує бюджет, будується безпечний зовнішній обхід; якщо чистий маршрут фізично не знайдено, редактор явно повідомляє про перехід до звичайного маршруту.
- Ручні маршрути: орієнтація першого/останнього сегмента узгоджена зі сторонами виходу/входу (не лише «горизонталь-перша»), щоб стрілка входила в блок перпендикулярно.
- `Вмістити/експорт`: merge-контекст будується один раз перед обходом з'єднань; повна побудова меж усе ще залежить від кількості з'єднань і складності їхніх маршрутів.
- Явно зафіксовано й покрито тестами пріоритет стратегій маршрутизації: `custom → smart → decision → merge → default`.

## 2026-04-25

### Slides architecture and behavior smoke

- `slides/js/app.js` reduced to a coordinator by moving project helpers, slide list rendering, stage rendering, stage interactions and modal UI into focused modules.
- `slides/js/runtime.js` now boots safely whether `DOMContentLoaded` is still pending or already complete.
- `tests/slides-behavior.html` added and wired into `tests/run-browser-smoke.ps1` to verify browser module import, `SlidesApp.boot`, slide list render, stage render, project normalization/parsing and Ukrainian slug generation.
- Damaged Unicode/control characters in Slides project/template text literals were cleaned so browser module imports no longer fail with `SyntaxError: Invalid or unexpected token`.
- Technical conclusion recorded: pause mechanical Slides splitting and move to feature work on top of the current structure.
- Recommended next editor for debt reduction before feature growth: `paint/`.

### Paint document lifecycle split

- `paint/js/document.js` added to own autosave draft, draft restore, image import, PNG/JPG export and print.
- `paint/js/object-interactions.js` added to own object selection, move, resize and delete behavior.
- `paint/js/app.js` reduced back toward a coordinator role for boot, tool state and canvas interactions.
- `paint/js/runtime.js` made resilient to `DOMContentLoaded` timing, matching the newer Slides runtime pattern.
- `tests/paint-behavior.html` added to verify browser boot, document module export, canvas initialization and standard command markers.
- `paint/index.html`, `sw.js`, `tests/static-ui-audit.ps1`, `tests/run-browser-smoke.ps1` and `paint/UI_MIGRATION_TO_STANDARD.md` synchronized with the new document module.

### Tables architecture and stabilization decision

- `tables/js/core.js` split into dedicated model, storage, addressing and formula layers.
- Formula logic split into `formula-parser.js`, `formula-references.js`, `formula-functions.js` and `formula-engine.js`.
- Tables UI/runtime logic further separated into focused modules for clipboard, formatting, structure, charts, sorting, workbook file operations, view options, cell-format UI and calculation.
- `tables/index.html`, `sw.js`, `tests/static-ui-audit.ps1` and `tests/tables-formula-behavior.html` synchronized with the new split module graph.
- Technical conclusion recorded: Tables should pause aggressive file splitting and move into stabilization, integration testing and feature hardening.
- Recommended next editor after Tables stabilization: `slides/`.

## 2026-04-24

### Shared shell adapter

- Додано `office-shell.js` як thin adapter-шар між локальними `js/app.js` і `window.OfficeUI`.
- Командний роутинг, file picker і boot wiring у редакторах почали уніфікуватися через `OfficeShell.runCommand`, `OfficeShell.openFilePicker`, `OfficeShell.registerCommands`, `OfficeShell.bootEditor`.
- Усі редактори підключають shared root-скрипти в одному порядку: `office-shell.js` -> `office-ui.js` -> `offline.js`.

### Shared documentation and audit

- `ARCHITECTURE.md`, `UI_INTEGRATION_GUIDE.md`, `OFFICE_UI_STANDARD.md`, `SERVICE_SHELL_BLUEPRINTS.md`, `README.md` і `APP_SHELL.html` синхронізовано з новим shared shell-контрактом.
- Статичний аудит тепер перевіряє наявність `office-shell.js` і порядок підключення shared root-скриптів.

## 2026-04-23

### Уніфікація shell

- Усі 6 редакторів підключені до `UI_TOKENS.css`, `office-ui.js`, `shell-overrides.css` та `offline.js`.
- Зафіксовано базовий shell-контракт: header, menubar, toolbar, workspace, statusbar.
- Статичний аудит перевіряє `office-*` класи, `data-office-service`, порядок стилів і локальні asset paths.

### Overlay, modal, dropdown

- Додано shared modal behavior в `office-ui.js`: ARIA sync, `Escape`, focus return, focus loop.
- Виправлено ризик MutationObserver-loop: observed attributes тепер записуються тільки при зміні значення.
- Глобальний `pointerdown` більше не закриває активну модалку при кліку всередині неї.
- Локальні меню/picker синхронізують стан через `office:overlayclose`.

### Standard Commands

- Додано `OfficeUI.registerCommand`, `OfficeUI.registerCommands`, `OfficeUI.hasCommand`, `OfficeUI.runCommand`.
- Усі редактори реєструють стандартні команди `new/open/save/undo/redo`.
- Тулбар, головне меню та hotkeys поступово переведені на `OfficeUI.runCommand`.
- Статичний аудит перевіряє:
  - наявність command adapter;
  - маршрутизацію кожної стандартної команди;
  - parity між кнопкою тулбара та пунктом головного меню.

### File Picker

- Додано `OfficeUI.openFilePicker(inputOrId)`.
- File-open точки в редакторах переведені на shared helper.
- Helper скидає `input.value`, щоб повторне відкриття того самого файлу не губило `change` event.
- Статичний аудит перевіряє використання `OfficeUI.openFilePicker` у кожному редакторі.

### Save/Open стабілізація

- Перевірено `Save` у всіх редакторах через статичний контракт.
- Flowcharts більше не має окремого винятку для toolbar Save: стандартні toolbar-кнопки отримали явні `data-action`.
- Vector отримав захист від подвійного спрацювання `toggle-snap`.

### Стилі і токени

- Аудит перевіряє, що `UI_TOKENS.css` підключений до локальних стилів, а `shell-overrides.css` після них.
- Локальні `style.css` не повинні перевизначати `--office-*` токени або `.office-*` component selectors.
- Локальний `--accent` має відповідати `SERVICE_THEME_MAP.json`.

### Документація

- `UI_INTEGRATION_GUIDE.md` оновлено до поточного command/file-picker/modal/status контракту.
- `README.md` розділено на активні джерела правди, довідкові документи і кандидати на архів.
- Поточний висновок: кількість документації завелика для щоденної розробки, але масово видаляти її не варто без окремого архівного кроку.
