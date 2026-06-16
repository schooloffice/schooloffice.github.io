# UI_MIGRATION_TO_STANDARD.md — ПЛЮС Малюнки

## Поточний Стан

Базовий shell, standard commands і file picker підключені. Локальна структура вирівняна до `paint/js/runtime.js -> paint/js/app.js -> service modules`.

Триває raster-first переробка у стилі сучасного MS Paint (роадмеп — `PROJECT_DIRECTION.md`, етапи 0–10).

**Ітерацію 1 (фундамент) виконано:** документ має незалежний фіксований розмір у пікселях (`state.document`), workspace лише показує його через `state.viewport` (zoom/pan/fit). Backing store полотна не залежить від контейнера, тож resize вікна не спотворює растр.

**Ітерацію 2 (desktop layout) виконано:** верх редактора — лише назва + головне меню. Розкладка `.editor-body` (`grid`: tool rail | properties panel | workspace). Інструменти й швидкі дії — у лівій rail (несе клас `office-toolbar`); параметри інструмента + палітра + RGB/BIN мікшер — у контекстній properties panel (`data-tool-section`); дропдауни-пікери прибрано (інлайн-секції); zoom — у нижній статус-смузі.

**Ітерацію 2.5 (зміцнення підмурку) виконано:** історія undo/redo синхронна, на canvas-снапшотах, із memory budget (`HISTORY_MAX_BYTES`); серіалізація чернетки відокремлена (`toSerializable`/`restoreSerializable`) від canvas-снапшотів історії; координатна трансформація централізована (`clientToDoc`/`docToClient`); закрито XSS-поверхню `innerHTML` (escape тексту/id, валідація кольору, числові координати).

**Ітерацію 3 виконано.** Зроблено: tool registry (`paint/js/tools.js`, контракт `begin/update/commit/cancel`; `app.js` делегує `tools.getActive()`), піпетка (`I`), поворот/відзеркалення (меню «Зображення», `canvasApi.rotate90/rotate180/flip` із `flattenObjects`), прямокутне виділення (інструмент `S`, оверлей `selectionCanvas`, move з підняттям пікселів, delete, Ctrl+C/X/V, flatten на Enter/Esc/зміні інструмента), crop до виділення, масштабування зображення, прибрано дубль `state.canvasWidth/Height`, чернетку перенесено в IndexedDB (`paint/js/storage.js`, fallback на localStorage).

**Ітерацію 4 виконано.** Зроблено: **прозорість** (гумка `destination-out`; checkerboard; PNG зберігає alpha), **текстовий інструмент** (overlay `<textarea>` → `canvasApi.drawText`), **основний/додатковий колір** (ліва/права кнопка миші, swap `X`, `state.activeColor`), **фігури/штампи на operation-моделі** (тимчасові → flatten у растр при новій дії/зміні інструмента/Enter через `flattenActiveObjects`; `objectLayer` тримає лише активний об'єкт).

**Ітерація 5 — у процесі.** Зроблено: **project-файл** `.malyunok` (повний save/open round-trip через `paintDocument.saveProject/handleProjectFile` з P0 schema-валідацією; Ctrl+S/save = проєкт, PNG/JPG = експорт). Раніше по ходу: IndexedDB-чернетка, синхронна історія з memory budget. **Лишилось:** оптимізована історія (region/diff-снапшоти), великі зображення/продуктивність (ліміти, попередження, можливо Web Worker для важких операцій).

Технічний борг (відкладено): винести text-редагування з `app.js` (~970 рядків) у `text.js`.

## Поточна Структура

- `paint/js/runtime.js` — стабільний entrypoint, який запускає `PaintApp.boot` до або після `DOMContentLoaded`.
- `paint/js/app.js` — boot, command adapter, tool state coordination, canvas/object interaction wiring.
- `paint/js/document.js` — autosave draft, restore draft, image import, PNG/JPG export і print.
- `paint/js/storage.js` — чернетка в IndexedDB із fallback на localStorage (saveDraft/loadDraft/clearDraft).
- `paint/js/object-interactions.js` — select, move, resize і delete для об'єктів на полотні.
- `paint/js/tools.js` — реєстр інструментів (контракт `begin/update/commit/cancel`); пензлик/гумка/заливка/піпетка/фігури/штампи.
- `paint/js/canvas.js` — canvas API, raster drawing, object rendering, snapshots, трансформації (rotate/flip), guides.
- `paint/js/ui.js` — DOM cache, menu/picker/modal/statusbar UI.
- `paint/js/state.js` — локальний runtime state.
- `paint/js/constants.js` — інструменти, палітра, guides, brush/stamp definitions.
- `paint/js/utils.js` — DOM, color, download і canvas helpers.

## Найближчий Борг

- **Ітерація 3:** tool registry — винести інструменти з `if/else` у `app.js` у спільний контракт `begin/update/commit/cancel/renderOptions`; далі eyedropper, прямокутне виділення, crop, resize, rotate/flip.
- **Адаптивність:** на дуже вузьких екранах properties panel поки лише звужується, а не згортається в overlay; повне згортання з кнопкою-перемикачем — окремий крок (інакше параметри інструмента стають недосяжними).
- Resize-handle об'єктів масштабуються разом із `objectLayer` (`transform: scale(zoom)`), тож на малому zoom стають дрібними — за потреби counter-scale.
- Перевірити ручний сценарій імпорту зображення (відкривається у реальному розмірі з лімітами) у браузері.
- Мертві CSS-правила колишнього toolbar/picker (`.tool-btn`, `.tool-switch`, `.picker-*`, `.range-control`, `.segmented-*`) лишилися в `style.css` — прибрати при наступному дотику до стилів.

## Обмеження

Не дробити `canvas.js` на shape/math/render файли, доки не з'явиться реальна потреба. Для графічного редактора canvas API може залишатися більшим модулем, якщо він має цілісну відповідальність і покритий smoke-тестами.
