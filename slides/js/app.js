import { DEFAULT_SHAPE_STYLE, DEFAULT_TEXT_STYLE, FONT_FAMILIES, FONT_SIZES, LAYOUTS, LAYOUT_KEYS, LIMITS, LINE_SHAPE_TYPES, STAGE_HEIGHT, STAGE_WIDTH, TEXT_SHAPE_TYPES, THEMES, THEME_KEYS } from './constants.js';
import { exportPresentationPdf, printPresentation, createSlideSnapshot } from './export.js';
import { pushHistory, redo, resetHistory, undo } from './history.js';
import {
  closeModal as closeModalUi,
  showConfirmModal as showConfirmModalUi,
  showInfoModal as showInfoModalUi,
  showModal as showModalUi
} from './modal-ui.js';
import { normalizeElement, normalizePresentation, parsePresentationText, savePresentationFile } from './project.js';
import { renderStage as renderStageView, syncSelectionUi as syncStageSelectionUi, applyImageCropToNode } from './stage-renderer.js';
import { renderSlideList as renderSlideListView } from './slide-list.js';
import {
  bindStage as bindStageInteractions,
  elementBounds,
  getStagePoint,
  normalizeZIndexes,
  onElementPointerDown as handleElementPointerDown,
  onHandlePointerDown as handleHandlePointerDown,
  onRotateHandlePointerDown as handleRotateHandlePointerDown,
  onStageBackgroundPointerDown as handleStageBackgroundPointerDown,
  onStagePointerMove as handleStagePointerMove,
  onStagePointerUp as handleStagePointerUp
} from './stage-interactions.js';
import { state, applyPresentationData, getCurrentSlide, getCurrentSlideIndex, getSelectedElement, getSelectedElements, isSelected, serializePresentation } from './state.js';
import { clearDraft, loadDraft, saveDraft } from './storage.js';
import { createBasicSlideElements, createDefaultPresentation, createImageElement, createPlaceholderElement, createShapeElement, createSlide, createTemplateDefinition, createTextElement } from './templates.js';
import { $, $$, clamp, debounce, deepClone, getTextFromContentEditable, readFileAsDataURL, readFileAsText, uid } from './utils.js';

window.SlidesApp = window.SlidesApp || {};

const dom = {};
const elementDomMap = new Map();

let colorAnchorButton = null;
let pendingImageOperation = { mode: 'insert', elementId: null, alt: '' };

// Масштаб полотна — лише вигляд (координати моделі лишаються логічними 960×540).
// `autoFitZoom` тримає слайд вписаним у вікно, доки користувач не задасть масштаб вручну.
let stageZoom = 1;
let autoFitZoom = true;
const ZOOM_MIN = 0.25;
const ZOOM_MAX = 3;
const ZOOM_STEP = 0.1;
// Поки true — запізніле читання чернетки з IndexedDB ще може відновити її.
// Скидається, щойно користувач створив/відкрив документ або почав редагувати,
// щоб async-hydration не перезаписала нову чи відкриту презентацію.
let draftHydrationActive = true;

function cancelDraftHydration() {
  draftHydrationActive = false;
}

// Автозбереження оновлює лише браузерну ЧЕРНЕТКУ — це не збереження файла.
// Тому воно не чіпає `unsavedChanges` і бейдж збереження файла: незбережені
// зміни лишаються незбереженими, доки користувач не завантажить файл.
const autosave = debounce(() => {
  const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  saveDraft(serializePresentation())
    .then(() => setStatusRight(`Чернетку збережено • ${time}`))
    .catch(() => setStatusRight('Чернетку не збережено: бракує локального місця'));
}, 260);

function setStatusRight(text) {
  dom.statusRight.textContent = text;
}

function updateDirtyUi() {
  dom.dirtyDot.style.display = state.unsavedChanges ? 'inline-block' : 'none';
  dom.saveBadge.textContent = state.unsavedChanges ? 'Є зміни' : 'Збережено ✓';
}

function markDirty(statusText = 'Є незбережені зміни') {
  cancelDraftHydration();
  state.unsavedChanges = true;
  updateDirtyUi();
  setStatusRight(statusText);
  autosave();
}

function applyZoom() {
  // Змінна успадковується від sizer до .stage (transform) — встановлюємо один раз.
  dom.stageSizer?.style.setProperty('--stage-zoom', String(stageZoom));
  if (dom.zoomLevel) dom.zoomLevel.textContent = `${Math.round(stageZoom * 100)}%`;
}

function setZoom(value, { auto = false } = {}) {
  stageZoom = clamp(value, ZOOM_MIN, ZOOM_MAX);
  autoFitZoom = auto;
  applyZoom();
}

function zoomIn() { setZoom(stageZoom + ZOOM_STEP); }
function zoomOut() { setZoom(stageZoom - ZOOM_STEP); }
function zoomTo100() { setZoom(1); }

function updateSnapUi() {
  dom.snapToggleItem?.classList.toggle('snap-on', state.snapToGrid);
}

function toggleSnapToGrid() {
  state.snapToGrid = !state.snapToGrid;
  updateSnapUi();
  setStatusRight(state.snapToGrid ? 'Прив’язку до сітки увімкнено' : 'Прив’язку до сітки вимкнено');
}

// Вписує слайд у робочу область, не збільшуючи понад 100%.
function fitStageToWorkspace() {
  const ws = dom.workspace;
  if (!ws || !ws.clientWidth) { setZoom(1, { auto: true }); return; }
  const availW = ws.clientWidth - 48;
  const availH = ws.clientHeight - 48;
  const fit = Math.min(availW / STAGE_WIDTH, availH / STAGE_HEIGHT);
  setZoom(clamp(fit, ZOOM_MIN, 1), { auto: true });
}

function initDom() {
  dom.fileName = $('#fileName');
  dom.dirtyDot = $('#dirtyDot');
  dom.saveBadge = $('#saveBadge');
  dom.projectFileInput = $('#projectFileInput');
  dom.imageFileInput = $('#imageFileInput');
  dom.stage = $('#stage');
  dom.stageSizer = $('#stageSizer');
  dom.zoomLevel = $('#zoomLevel');
  dom.snapToggleItem = $('#snapToggleItem');
  dom.contextMenu = $('#contextMenu');
  dom.slideList = $('#slideList');
  dom.workspace = $('#workspace');
  dom.statusLeft = $('#statusLeft');
  dom.statusRight = $('#statusRight');
  dom.fontSizeSelect = $('#fontSizeSelect');
  dom.fontFamilySelect = $('#fontFamilySelect');
  dom.lineHeightSelect = $('#lineHeightSelect');
  dom.imageToolGroup = $('#imageToolGroup');
  dom.imageToolSep = $('#imageToolSep');
  dom.imageOpacityInput = $('#imageOpacityInput');
  dom.alignToolGroup = $('#alignToolGroup');
  dom.alignToolSep = $('#alignToolSep');
  dom.colorPanelBtn = $('#colorPanelBtn');
  dom.modalOverlay = $('#modalOverlay');
  dom.modalIcon = $('#modalIcon');
  dom.modalTitle = $('#modalTitle');
  dom.modalText = $('#modalText');
  dom.modalBody = $('#modalBody');
  dom.modalCancel = $('#modalCancel');
  dom.modalConfirm = $('#modalConfirm');
  dom.colorPopover = $('#colorPopover');
  dom.colorPalette = $('#colorPalette');
  dom.colorPopoverHint = $('#colorPopoverHint');
  dom.colorModeButtons = $('#colorModeButtons');
  dom.customColorInput = $('#customColorInput');
  dom.presentOverlay = $('#presentOverlay');
  dom.presentStageWrap = $('#presentStageWrap');
  dom.presentClose = $('#presentClose');
  dom.presentPrev = $('#presentPrev');
  dom.presentNext = $('#presentNext');
}

function initSlidesEditor() {
  initDom();
  registerOfficeCommands();
  renderColorPalette();
  renderTextControls();
  loadInitialState();
  bindMenus();
  bindToolbar();
  bindInputs();
  bindStage();
  bindContextMenu();
  bindPresentation();
  renderAll();
  applyZoom();
  updateSnapUi();
  // Вписуємо слайд після того, як робоча область отримала розміри.
  requestAnimationFrame(fitStageToWorkspace);
}

function registerOfficeCommands() {
  const commandMap = {
    new: () => confirmNewProject(),
    open: () => openProjectPicker(),
    save: () => saveProjectFile(),
    undo: () => handleUndo(),
    redo: () => handleRedo()
  };
  window.OfficeShell?.registerCommands?.('slides', commandMap) ||
    window.OfficeUI?.registerCommands?.(commandMap, { source: 'slides' });
}

function runOfficeCommand(command) {
  return window.OfficeShell?.runCommand?.(command) || false;
}

function openProjectPicker() {
  window.OfficeShell?.openFilePicker?.(dom.projectFileInput) || dom.projectFileInput.click();
}

function openImagePicker({ keepOperation = false } = {}) {
  if (!keepOperation) pendingImageOperation = { mode: 'insert', elementId: null, alt: '' };
  window.OfficeShell?.openFilePicker?.(dom.imageFileInput) || dom.imageFileInput.click();
}

function loadInitialState() {
  // Дефолт показуємо синхронно (щоб UI не блимав порожнім), а чернетку з
  // IndexedDB підвантажуємо асинхронно й заміщаємо нею, якщо вона є.
  applyPresentationData(createDefaultPresentation());
  resetHistory();
  state.unsavedChanges = false;
  updateDirtyUi();
  setStatusRight('Готово');
  hydrateFromDraft();
}

async function hydrateFromDraft() {
  let raw = null;
  try {
    raw = await loadDraft();
  } catch {
    draftHydrationActive = false;
    return;
  }
  // Скасовуємо, якщо користувач за цей час створив/відкрив документ чи почав
  // редагувати — інакше чернетка перезаписала б нову/відкриту презентацію.
  if (!draftHydrationActive || !raw || state.unsavedChanges) {
    draftHydrationActive = false;
    return;
  }
  // Чернетка — власні дані редактора, тож довірена (зокрема зовнішні image URL).
  const saved = normalizePresentation(raw, { trusted: true });
  draftHydrationActive = false;
  if (!saved) return;
  applyPresentationData(saved);
  resetHistory();
  state.unsavedChanges = false;
  updateDirtyUi();
  renderAll();
  setStatusRight('Відновлено чернетку');
}

function renderAll() {
  renderFileName();
  // Палітра залежить від теми — оновлюємо разом зі станом (undo/redo/open/import).
  renderColorPalette();
  renderStage();
  renderSlideList();
  renderToolbarState();
  renderStatus();
}

function renderFileName() {
  dom.fileName.textContent = state.fileName;
}

function renderStatus() {
  const index = getCurrentSlideIndex();
  const selectedCount = getSelectedElements().length;
  let suffix = '';
  if (selectedCount === 1) {
    const selected = getSelectedElement();
    if (selected) suffix = ` • Об’єкт: ${describeElement(selected)}`;
  } else if (selectedCount > 1) {
    suffix = ` • Вибрано об’єктів: ${selectedCount}`;
  }
  dom.statusLeft.textContent = `Слайд ${index + 1} з ${state.slides.length}${suffix}`;
}

function describeElement(element) {
  if (element.type === 'text') return 'текст';
  if (element.type === 'image') return 'зображення';
  if (element.shape === 'circle') return 'коло';
  if (element.shape === 'triangle') return 'трикутник';
  if (element.shape === 'line') return 'лінія';
  if (element.shape === 'arrow') return 'стрілка';
  return 'прямокутник';
}

function renderTextControls() {
  dom.fontFamilySelect.innerHTML = '';
  FONT_FAMILIES.forEach(font => {
    const option = document.createElement('option');
    option.value = font.key;
    option.textContent = font.label;
    dom.fontFamilySelect.appendChild(option);
  });
  // Інтервал — довільне число 0.8–3 (без datalist: на number-інпуті атрибут list
  // додає пікер, який обрізає центроване значення у вузькому полі тулбара).
}

function getActiveTheme() {
  return THEMES.find(theme => theme.key === state.theme) || THEMES[0];
}

function renderColorPalette() {
  dom.colorPalette.innerHTML = '';
  getActiveTheme().palette.forEach(color => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'color-swatch';
    button.title = color.toUpperCase();
    button.style.background = color;
    if (color.toLowerCase() === '#ffffff') button.style.borderColor = '#cbd5e1';
    button.addEventListener('click', () => {
      applyColor(color);
      closeColorPopover();
    });
    dom.colorPalette.appendChild(button);
  });
}

// Зміна теми оновлює фон усіх слайдів і акцентну палітру; вміст елементів не
// чіпається. Один крок історії (theme серіалізується, тож undo/redo повертають).
function applyTheme(themeKey) {
  if (!THEME_KEYS.includes(themeKey) || themeKey === state.theme) return;
  const theme = THEMES.find(item => item.key === themeKey);
  pushHistory();
  state.theme = themeKey;
  state.slides.forEach(slide => { slide.background = theme.background; });
  renderColorPalette();
  renderStage();
  renderSlideList();
  markDirty('Тему змінено');
}

function showThemePicker() {
  const cards = THEMES.map(theme => {
    const dots = theme.palette.slice(2, 8).map(color => `<span class="theme-dot" style="background:${color}"></span>`).join('');
    const active = theme.key === state.theme ? ' active' : '';
    return `<button type="button" class="theme-card${active}" data-theme="${theme.key}" aria-pressed="${theme.key === state.theme}">
        <span class="theme-preview" style="background:${theme.background}">${dots}</span>
        <span class="theme-name">${theme.name}</span>
      </button>`;
  }).join('');
  showModal({
    title: 'Тема оформлення',
    text: 'Зміна теми оновлює фон усіх слайдів і палітру кольорів. Вміст слайдів не змінюється.',
    body: `<div class="theme-grid">${cards}</div>`,
    confirmText: 'Закрити',
    showCancel: false,
    onMount: () => {
      $$('.theme-card').forEach(card => {
        card.addEventListener('click', () => {
          applyTheme(card.dataset.theme);
          closeModal();
        });
      });
    }
  });
}

// Застосування макета до ПОТОЧНОГО слайда — неруйнівне: реальний вміст лишається,
// порожні placeholder-и прибираються, а для слотів, які ще не «закриті» реальним
// вмістом того ж типу, додаються нові placeholder-и. Один крок історії.
function applyLayout(layoutKey) {
  if (!LAYOUT_KEYS.includes(layoutKey)) return;
  const slide = getCurrentSlide();
  if (!slide) return;
  const layout = LAYOUTS.find(item => item.key === layoutKey);
  pushHistory();
  // Прибираємо ЛИШЕ порожні типізовані placeholder-и макета (isPlaceholder +
  // placeholderType). Реальні фігури, фігури з текстовою підказкою та порожні
  // ручні текстові поля (placeholderType=null) зберігаються.
  const kept = slide.elements.filter(element => !(element.isPlaceholder && element.placeholderType));
  const satisfied = {};
  kept.forEach(element => {
    if (element.placeholderType) satisfied[element.placeholderType] = (satisfied[element.placeholderType] || 0) + 1;
  });
  let z = kept.reduce((max, element) => Math.max(max, element.z || 1), 0) + 1;
  const placeholders = [];
  layout.slots.forEach(slot => {
    if (satisfied[slot.type] > 0) { satisfied[slot.type] -= 1; return; }
    placeholders.push(createPlaceholderElement(slot, z++));
  });
  slide.elements = [...kept, ...placeholders];
  slide.layout = layoutKey;
  state.selectedElementIds = [];
  state.cropElementId = null;
  renderAll();
  markDirty('Макет застосовано');
}

function showLayoutPicker() {
  const slide = getCurrentSlide();
  const cards = LAYOUTS.map(layout => {
    const slots = layout.slots.map(slot => {
      const type = slot.type === 'image' ? ' image' : (slot.type === 'title' ? ' title' : '');
      return `<span class="layout-slot${type}" style="left:${slot.x / STAGE_WIDTH * 100}%;top:${slot.y / STAGE_HEIGHT * 100}%;width:${slot.w / STAGE_WIDTH * 100}%;height:${slot.h / STAGE_HEIGHT * 100}%"></span>`;
    }).join('');
    const active = slide && slide.layout === layout.key ? ' active' : '';
    return `<button type="button" class="layout-card${active}" data-layout="${layout.key}" aria-pressed="${slide && slide.layout === layout.key}">
        <span class="layout-preview">${slots}</span>
        <span class="layout-name">${layout.name}</span>
      </button>`;
  }).join('');
  showModal({
    title: 'Макет слайда',
    text: 'Застосовується до поточного слайда. Заповнений вміст зберігається — оновлюються лише порожні слоти.',
    body: `<div class="layout-grid">${cards}</div>`,
    confirmText: 'Закрити',
    showCancel: false,
    onMount: () => {
      $$('.layout-card').forEach(card => {
        card.addEventListener('click', () => {
          applyLayout(card.dataset.layout);
          closeModal();
        });
      });
    }
  });
}

// Подвійний клік по image-placeholder відкриває діалог заповнення (елемент є
// image, тож працює через звичайний replace-флоу; заповнення знімає isPlaceholder).
function activateImagePlaceholder(elementId) {
  selectElement(elementId);
  promptImageReplace();
}

function renderSlideList() {
  renderSlideListView({
    host: dom.slideList,
    closeColorPopover,
    confirmDeleteSlide,
    duplicateSlide,
    markDirty,
    moveSlide,
    renderAll,
    setStatusRight
  });
}

function renderStage() {
  // Вихід із режиму кадрування, якщо кадроване зображення зникло з ПОТОЧНОГО
  // слайда (зміна слайда, видалення, undo тощо) — інакше стан «воскресає» при
  // поверненні на слайд. Навігація/видалення міняють selectedElementIds напряму,
  // тож централізуємо очищення тут, де сходяться всі ці шляхи.
  if (state.cropElementId) {
    const slide = getCurrentSlide();
    const stillCroppable = slide?.elements.some(el => el.id === state.cropElementId && el.type === 'image');
    if (!stillCroppable) state.cropElementId = null;
  }
  renderStageView({
    elementDomMap,
    markDirty,
    onElementPointerDown,
    onHandlePointerDown,
    onRotateHandlePointerDown,
    onCropHandlePointerDown,
    onImagePlaceholderActivate: activateImagePlaceholder,
    renderSlideList,
    selectElement,
    stage: dom.stage
  });
}

// Представник для текстового форматування у вибірці: головний, якщо він текст,
// інакше — перший вибраний текстовий блок. Тож формат доступний у змішаному
// мультивиборі незалежно від того, що вибрано останнім.
function getPrimaryTextElement() {
  const primary = getSelectedElement();
  if (primary && (primary.type === 'text' || (primary.type === 'shape' && TEXT_SHAPE_TYPES.includes(primary.shape)))) return primary;
  return getSelectedElements().find(element => element.type === 'text' || (element.type === 'shape' && TEXT_SHAPE_TYPES.includes(element.shape))) || null;
}

function renderToolbarState() {
  const textEl = getPrimaryTextElement();
  const primary = getSelectedElement();
  dom.fontSizeSelect.value = String(textEl?.style?.fontSize || primary?.style?.fontSize || FONT_SIZES[1]);
  dom.fontFamilySelect.value = textEl?.style?.fontFamily || DEFAULT_TEXT_STYLE.fontFamily;
  dom.lineHeightSelect.value = String(textEl?.style?.lineHeight || DEFAULT_TEXT_STYLE.lineHeight);
  $$('[data-action="bold"], [data-action="italic"], [data-action="underline"], [data-action="align-left"], [data-action="align-center"], [data-action="align-right"], [data-action="list-bullet"], [data-action="list-number"]').forEach(button => {
    button.classList.remove('active');
  });

  if (textEl) {
    if (textEl.style.bold) $$('[data-action="bold"]').forEach(btn => btn.classList.add('active'));
    if (textEl.style.italic) $$('[data-action="italic"]').forEach(btn => btn.classList.add('active'));
    if (textEl.style.underline) $$('[data-action="underline"]').forEach(btn => btn.classList.add('active'));
    $$(`[data-action="align-${textEl.style.align || 'left'}"]`).forEach(btn => btn.classList.add('active'));
    if (textEl.style.listType !== 'none') $$(`[data-action="list-${textEl.style.listType}"]`).forEach(btn => btn.classList.add('active'));
  }

  // Група інструментів зображення видима лише коли у вибірці є зображення.
  const imageEl = getPrimaryImageElement();
  dom.imageToolGroup.classList.toggle('hidden', !imageEl);
  dom.imageToolSep.classList.toggle('hidden', !imageEl);
  $$('[data-action="image-fit-cover"], [data-action="image-fit-contain"]').forEach(btn => btn.classList.remove('active'));
  $$('[data-action="image-crop"]').forEach(btn => btn.classList.toggle('active', !!imageEl && state.cropElementId === imageEl.id));
  if (imageEl) {
    $$(`[data-action="image-fit-${imageEl.style.objectFit || 'cover'}"]`).forEach(btn => btn.classList.add('active'));
    // Підпис — «прозорість»: 0% = повністю видиме (opacity 1), 100% = невидиме (opacity 0).
    dom.imageOpacityInput.value = String(Math.round((1 - (imageEl.style.opacity ?? 1)) * 100));
  }

  // Вирівнювання/розподіл працюють за геометричними одиницями: група рахується
  // як одна. Для однієї групи лишаємо панель видимою тільки заради «Розгрупувати».
  const unitCount = selectionUnits().length;
  const hasGroup = getSelectedElements().some(element => element.groupId);
  const showAlignTools = unitCount >= 2 || hasGroup;
  dom.alignToolGroup.classList.toggle('hidden', !showAlignTools);
  dom.alignToolSep.classList.toggle('hidden', !showAlignTools);
  $$('[data-action="align-objects-left"], [data-action="align-objects-h-center"], [data-action="align-objects-right"], [data-action="align-objects-top"], [data-action="align-objects-v-middle"], [data-action="align-objects-bottom"]').forEach(btn => { btn.disabled = unitCount < 2; });
  $$('[data-action="distribute-h"], [data-action="distribute-v"]').forEach(btn => { btn.disabled = unitCount < 3; });
  $$('[data-action="group-objects"]').forEach(btn => { btn.disabled = unitCount < 2; });
  $$('[data-action="ungroup-objects"]').forEach(btn => { btn.disabled = !hasGroup; });
}

function syncSelectionUi() {
  syncStageSelectionUi(elementDomMap);
}

function setSelection(ids) {
  const next = Array.from(new Set(ids));
  // Вихід із режиму кадрування, якщо кадроване зображення більше не у вибірці.
  const leftCrop = state.cropElementId && !next.includes(state.cropElementId);
  if (leftCrop) state.cropElementId = null;
  state.selectedElementIds = next;
  if (leftCrop) renderStage();
  syncSelectionUi();
  renderToolbarState();
  renderStatus();
}

// Усі елементи в одній групі з даним (липкий вибір): клік по члену групи вибирає
// всю групу. Для негрупованого — лише сам елемент.
function groupMemberIds(id) {
  const slide = getCurrentSlide();
  const element = slide?.elements.find(item => item.id === id);
  if (!element || !element.groupId) return [id];
  return slide.elements.filter(item => item.groupId === element.groupId).map(item => item.id);
}

function selectElement(id, additive = false) {
  if (!id) {
    setSelection([]);
    return;
  }
  const members = groupMemberIds(id);
  if (additive) {
    const set = new Set(state.selectedElementIds);
    const allSelected = members.every(member => set.has(member));
    members.forEach(member => { if (allSelected) set.delete(member); else set.add(member); });
    setSelection([...set]);
  } else {
    setSelection(members);
  }
}

function groupSelected() {
  const targets = getSelectedElements();
  if (targets.length < 2) return;
  pushHistory();
  const groupId = uid();
  targets.forEach(element => { element.groupId = groupId; });
  renderStage();
  renderToolbarState();
  markDirty('Згруповано');
}

function ungroupSelected() {
  const targets = getSelectedElements().filter(element => element.groupId);
  if (!targets.length) return;
  pushHistory();
  targets.forEach(element => { element.groupId = null; });
  renderStage();
  renderToolbarState();
  markDirty('Розгруповано');
}

// Копії групи мають утворювати НОВУ групу, а не зливатися з оригіналом: один
// старий groupId → один новий у межах партії клонів.
function remapGroupIds(elements) {
  const map = new Map();
  elements.forEach(element => {
    if (!element.groupId) return;
    if (!map.has(element.groupId)) map.set(element.groupId, uid());
    element.groupId = map.get(element.groupId);
  });
}

function clearSelection() {
  setSelection([]);
}

function selectAllElements() {
  const slide = getCurrentSlide();
  if (!slide || !slide.elements.length) return;
  setSelection(slide.elements.map(element => element.id));
  setStatusRight(`Вибрано об’єктів: ${slide.elements.length}`);
}

function getCurrentElements() {
  return getCurrentSlide()?.elements || [];
}

// Циклічний вибір об'єктів клавішею Tab (у візуальному порядку шарів).
function cycleObjectSelection(direction) {
  const slide = getCurrentSlide();
  if (!slide || !slide.elements.length) return;
  const ordered = [...slide.elements].sort((a, b) => (a.z || 0) - (b.z || 0));
  const primary = getSelectedElement();
  let index = primary ? ordered.findIndex(el => el.id === primary.id) : -1;
  index = index === -1 ? (direction > 0 ? 0 : ordered.length - 1) : (index + direction + ordered.length) % ordered.length;
  setSelection([ordered[index].id]);
  dom.workspace.focus();
}

// Клавіатурна навігація між слайдами; фокус лишається на активній мініатюрі.
function moveSlideFocus(direction) {
  const index = getCurrentSlideIndex();
  const next = clamp(index + direction, 0, state.slides.length - 1);
  if (next === index) return;
  state.currentSlideId = state.slides[next].id;
  state.selectedElementIds = [];
  closeColorPopover();
  renderAll();
  setStatusRight('Слайд вибрано');
  $('.slide-card.active .slide-thumb-button')?.focus();
}

function onElementPointerDown(event, elementId) {
  handleElementPointerDown(event, elementId, { elementDomMap, findElementById, selectElement, isSelected, getSelectedElements, duplicateSelection: beginAltDragDuplicate, stage: dom.stage });
}

function onHandlePointerDown(event, elementId, handle) {
  handleHandlePointerDown(event, elementId, handle, { elementDomMap, findElementById, selectElement, stage: dom.stage });
}

function onRotateHandlePointerDown(event, elementId) {
  handleRotateHandlePointerDown(event, elementId, { elementDomMap, findElementById, selectElement, stage: dom.stage });
}

// Дублює виділення на місці (без зміщення) для Alt+drag; історію записує сам.
function beginAltDragDuplicate() {
  const targets = getSelectedElements();
  if (!targets.length) return false;
  pushHistory();
  const slide = getCurrentSlide();
  const copies = [];
  targets.forEach(el => {
    const copy = normalizeElement({ ...deepClone(el), id: null, z: slide.elements.length + 1 }, slide.elements.length, { trusted: true });
    slide.elements.push(copy);
    copies.push(copy);
  });
  remapGroupIds(copies);
  state.selectedElementIds = copies.map(copy => copy.id);
  renderStage();
  return true;
}

function bindStage() {
  bindStageInteractions(dom.stage, { onStageBackgroundPointerDown, onStagePointerMove, onStagePointerUp });
}

function onStageBackgroundPointerDown(event) {
  handleStageBackgroundPointerDown(event, { stage: dom.stage, getSelectionIds: () => state.selectedElementIds });
}

function onStagePointerMove(event) {
  handleStagePointerMove(event, { elementDomMap, findElementById, stage: dom.stage });
}

function onStagePointerUp(event) {
  handleStagePointerUp(event, { elementDomMap, markDirty, renderSlideList, setSelection, getCurrentElements, stage: dom.stage });
}

function bindMenus() {
  $$('.menu-title').forEach(button => {
    button.addEventListener('click', event => {
      event.stopPropagation();
      toggleMenu(button.dataset.menu);
    });
  });

  $$('.menu-dropdown .menu-item').forEach(button => {
    button.addEventListener('click', () => {
      dispatchAction(button.dataset.action, button);
      closeMenus();
    });
  });

  document.addEventListener('pointerdown', event => {
    if (!event.target.closest('.menu-item-wrap')) closeMenus();
    if (!event.target.closest('.color-popover') && !event.target.closest('#colorPanelBtn')) closeColorPopover();
    if (!event.target.closest('.context-menu')) hideContextMenu();
  });
}

function bindToolbar() {
  $$('[data-action]').forEach(button => {
    if (button.closest('.menu-dropdown') || button.closest('.context-menu')) return;
    button.addEventListener('click', event => dispatchAction(button.dataset.action, event.currentTarget));
  });
}

function bindContextMenu() {
  dom.stage.addEventListener('contextmenu', onStageContextMenu);
  $$('.menu-item', dom.contextMenu).forEach(button => {
    button.addEventListener('click', () => {
      dispatchAction(button.dataset.action, button);
      // Якщо команда не перевела фокус у modal/інший control, повертаємо його
      // з прихованого пункту меню до безпечної робочої області.
      hideContextMenu({ restoreFocus: dom.contextMenu.contains(document.activeElement) });
    });
  });
  // Клавіатурна навігація всередині контекст-меню.
  dom.contextMenu.addEventListener('keydown', event => {
    const items = $$('.menu-item', dom.contextMenu);
    const index = items.indexOf(document.activeElement);
    if (event.key === 'ArrowDown') { event.preventDefault(); items[(index + 1) % items.length]?.focus(); }
    else if (event.key === 'ArrowUp') { event.preventDefault(); items[(index - 1 + items.length) % items.length]?.focus(); }
    else if (event.key === 'Home') { event.preventDefault(); items[0]?.focus(); }
    else if (event.key === 'End') { event.preventDefault(); items[items.length - 1]?.focus(); }
    else if (event.key === 'Escape') { event.preventDefault(); hideContextMenu({ restoreFocus: true }); }
  });
}

// Робить натиснутий елемент ГОЛОВНИМ (зберігаючи мультивибір), щоб per-object
// дії (зокрема edit-alt) працювали саме з ним.
function makePrimary(id) {
  if (!isSelected(id)) {
    selectElement(id, false);
  } else {
    setSelection([...state.selectedElementIds.filter(x => x !== id), id]);
  }
}

function onStageContextMenu(event) {
  const wrap = event.target.closest('.stage-element');
  if (!wrap) { hideContextMenu(); return; }
  event.preventDefault();
  if (wrap.dataset.id) makePrimary(wrap.dataset.id);
  showContextMenu(event.clientX, event.clientY);
}

// Відкриття контекст-меню з клавіатури (Shift+F10 / клавіша меню) біля головного
// вибраного об'єкта.
function openContextMenuForSelection() {
  const element = getSelectedElement();
  if (!element) return;
  const node = elementDomMap.get(element.id);
  const rect = (node || dom.stage).getBoundingClientRect();
  showContextMenu(rect.left + rect.width / 2, rect.top + rect.height / 2, true);
}

function showContextMenu(clientX, clientY, focusFirst = false) {
  const menu = dom.contextMenu;
  menu.classList.remove('hidden');
  // Тримаємо меню в межах вікна.
  const width = menu.offsetWidth || 200;
  const height = menu.offsetHeight || 220;
  const left = Math.min(clientX, window.innerWidth - width - 8);
  const top = Math.min(clientY, window.innerHeight - height - 8);
  menu.style.left = `${Math.max(8, left)}px`;
  menu.style.top = `${Math.max(8, top)}px`;
  if (focusFirst) menu.querySelector('.menu-item')?.focus();
}

function hideContextMenu({ restoreFocus = false } = {}) {
  dom.contextMenu?.classList.add('hidden');
  if (restoreFocus) dom.workspace?.focus();
}

function bindInputs() {
  dom.fontSizeSelect.addEventListener('input', event => {
    const value = Math.round(Number(event.target.value));
    if (!event.target.value || !Number.isFinite(value) || value < 4 || value > 400) return;
    setSelectedTextStyle({ fontSize: value });
  });
  dom.fontSizeSelect.addEventListener('change', event => {
    const value = clamp(Math.round(Number(event.target.value)) || DEFAULT_TEXT_STYLE.fontSize, 4, 400);
    setSelectedTextStyle({ fontSize: value });
    event.target.value = String(value);
  });
  dom.fontFamilySelect.addEventListener('change', event => setSelectedTextStyle({ fontFamily: event.target.value }));
  dom.lineHeightSelect.addEventListener('change', event => {
    const value = clamp(Number(event.target.value) || DEFAULT_TEXT_STYLE.lineHeight, 0.8, 3);
    setSelectedTextStyle({ lineHeight: value });
    event.target.value = String(value);
  });
  dom.imageOpacityInput.addEventListener('change', event => {
    // Введений % — це прозорість; у модель пишемо opacity = 1 - прозорість.
    const percent = clamp(Math.round(Number(event.target.value)), 0, 100);
    setSelectedImageStyle({ opacity: 1 - percent / 100 });
    event.target.value = String(percent);
  });
  dom.projectFileInput.addEventListener('change', onProjectFileSelected);
  dom.imageFileInput.addEventListener('change', onImageFileSelected);

  $('#closeColorPopover').addEventListener('click', closeColorPopover);
  $('#applyCustomColor').addEventListener('click', () => {
    applyColor(dom.customColorInput.value);
    closeColorPopover();
  });

  dom.fileName.addEventListener('click', beginRenameFile);
  dom.fileName.addEventListener('keydown', event => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      beginRenameFile();
    }
  });

  dom.modalOverlay.addEventListener('pointerdown', event => {
    if (event.target === dom.modalOverlay) closeModal();
  });

  document.addEventListener('keydown', handleKeyboardShortcuts);
  window.addEventListener('resize', () => {
    if (!dom.colorPopover.classList.contains('hidden')) positionColorPopover();
    if (autoFitZoom) fitStageToWorkspace();
  });

  // Ctrl+колесо — масштабування полотна.
  dom.workspace.addEventListener('wheel', event => {
    if (!(event.ctrlKey || event.metaKey)) return;
    event.preventDefault();
    setZoom(stageZoom + (event.deltaY < 0 ? ZOOM_STEP : -ZOOM_STEP));
  }, { passive: false });
  dom.workspace.addEventListener('scroll', hideContextMenu);
}


function bindPresentation() {
  dom.presentClose.addEventListener('click', stopPresentation);
  dom.presentPrev.addEventListener('click', showPreviousPresentationSlide);
  dom.presentNext.addEventListener('click', showNextPresentationSlide);
}

function toggleMenu(name) {
  const current = $(`.menu-dropdown[data-menu="${name}"]`);
  const willOpen = !current.classList.contains('open');
  closeMenus();
  if (!willOpen) return;
  current.classList.add('open');
  $(`.menu-title[data-menu="${name}"]`)?.setAttribute('aria-expanded', 'true');
}

function closeMenus() {
  $$('.menu-dropdown.open').forEach(menu => menu.classList.remove('open'));
  $$('.menu-title').forEach(button => button.setAttribute('aria-expanded', 'false'));
}

function getAvailableColorModes() {
  // Режими доступні за ВСІМА вибраними типами, а не лише за головним об'єктом.
  const selected = getSelectedElements();
  const hasText = selected.some(element => element.type === 'text' || (element.type === 'shape' && TEXT_SHAPE_TYPES.includes(element.shape)));
  const hasShape = selected.some(element => element.type === 'shape');
  const hasFilledShape = selected.some(element => element.type === 'shape' && !LINE_SHAPE_TYPES.includes(element.shape));
  const modes = [];
  if (hasText) modes.push({ key: 'text', label: 'Текст' });
  if (hasShape) {
    if (hasFilledShape) modes.push({ key: 'fill', label: 'Заливка' });
    modes.push({ key: 'stroke', label: 'Контур' });
  }
  modes.push({ key: 'background', label: 'Фон слайда' });
  return modes;
}

function renderColorModeButtons() {
  dom.colorModeButtons.innerHTML = '';
  const modes = getAvailableColorModes();
  if (!modes.some(mode => mode.key === state.currentColorTarget)) {
    state.currentColorTarget = modes[0]?.key || 'background';
  }
  modes.forEach(mode => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `color-mode-btn${mode.key === state.currentColorTarget ? ' active' : ''}`;
    button.textContent = mode.label;
    button.addEventListener('click', () => {
      state.currentColorTarget = mode.key;
      renderColorModeButtons();
      const titles = {
        text: 'Колір тексту',
        fill: 'Заливка фігури',
        stroke: 'Контур фігури',
        background: 'Фон слайда'
      };
      dom.colorPopoverHint.textContent = titles[mode.key] || 'Виберіть колір';
    });
    dom.colorModeButtons.appendChild(button);
  });
}

function positionColorPopover() {
  if (!colorAnchorButton) return;
  const rect = colorAnchorButton.getBoundingClientRect();
  const popWidth = dom.colorPopover.offsetWidth || 290;
  const popHeight = dom.colorPopover.offsetHeight || 260;
  const left = Math.min(window.innerWidth - popWidth - 12, Math.max(12, rect.left));
  const top = Math.min(window.innerHeight - popHeight - 12, rect.bottom + 8);
  dom.colorPopover.style.left = `${left}px`;
  dom.colorPopover.style.top = `${top}px`;
}

function openColorPopover(target = null, anchorButton = null) {
  const selected = getSelectedElement();
  if (target) state.currentColorTarget = target;
  if (!target) {
    if (selected && (selected.type === 'text' || (selected.type === 'shape' && TEXT_SHAPE_TYPES.includes(selected.shape)))) state.currentColorTarget = 'text';
    else if (selected?.type === 'shape') state.currentColorTarget = LINE_SHAPE_TYPES.includes(selected.shape) ? 'stroke' : 'fill';
    else state.currentColorTarget = 'background';
  }
  colorAnchorButton = anchorButton || colorAnchorButton || dom.colorPanelBtn;
  renderColorModeButtons();
  const titles = {
    text: 'Колір тексту',
    fill: 'Заливка фігури',
    stroke: 'Контур фігури',
    background: 'Фон слайда'
  };
  dom.colorPopoverHint.textContent = titles[state.currentColorTarget] || 'Виберіть колір';
  dom.colorPopover.classList.remove('hidden');
  requestAnimationFrame(positionColorPopover);
}

function closeColorPopover() {
  dom.colorPopover.classList.add('hidden');
}

function beginRenameFile() {
  const input = document.createElement('input');
  input.className = 'filename-input';
  input.value = state.fileName;
  dom.fileName.replaceWith(input);
  input.focus();
  input.select();

  const finish = commit => {
    if (commit) {
      const nextName = input.value.trim() || 'моя презентація';
      if (nextName !== state.fileName) {
        pushHistory();
        state.fileName = nextName;
        markDirty('Назву змінено');
      }
    }
    input.replaceWith(dom.fileName);
    renderFileName();
  };

  input.addEventListener('keydown', event => {
    if (event.key === 'Enter') finish(true);
    if (event.key === 'Escape') finish(false);
  });
  input.addEventListener('blur', () => finish(true), { once: true });
}

function handleKeyboardShortcuts(event) {
  const activeElement = document.activeElement;
  const isTypingInText = activeElement?.classList?.contains('text-element');
  const isTypingInInput = activeElement && ['INPUT', 'TEXTAREA', 'SELECT'].includes(activeElement.tagName);
  const ctrlOrMeta = event.ctrlKey || event.metaKey;

  if (event.key === 'F5') {
    event.preventDefault();
    startPresentation();
    return;
  }

  if (dom.presentOverlay.classList.contains('hidden') === false) {
    if (event.key === 'Escape') stopPresentation();
    if (event.key === 'ArrowLeft') showPreviousPresentationSlide();
    if (event.key === 'ArrowRight' || event.key === ' ') {
      event.preventDefault();
      showNextPresentationSlide();
    }
    return;
  }

  // Коли фокус у відкритому контекст-меню — воно саме обробляє клавіатуру.
  if (dom.contextMenu && !dom.contextMenu.classList.contains('hidden') && dom.contextMenu.contains(activeElement)) return;

  // У режимі кадрування Esc/Enter завершують його (поза полями введення).
  if (state.cropElementId && !isTypingInText && !isTypingInInput && (event.key === 'Escape' || event.key === 'Enter')) {
    event.preventDefault();
    exitCropMode();
    return;
  }

  if (event.key === 'Escape') hideContextMenu();

  if (ctrlOrMeta) {
    const key = event.key.toLowerCase();
    if (key === 'z') {
      event.preventDefault();
      if (event.shiftKey) runOfficeCommand('redo') || handleRedo(); else runOfficeCommand('undo') || handleUndo();
      return;
    }
    if (key === 'y') {
      event.preventDefault();
      runOfficeCommand('redo') || handleRedo();
      return;
    }
    if (key === 's') {
      event.preventDefault();
      runOfficeCommand('save') || saveProjectFile();
      return;
    }
    if (key === 'o') {
      event.preventDefault();
      runOfficeCommand('open') || openProjectPicker();
      return;
    }
    if (key === 'n') {
      event.preventDefault();
      runOfficeCommand('new') || confirmNewProject();
      return;
    }
    if (key === 'p') {
      event.preventDefault();
      handlePrint();
      return;
    }
    if (key === '=' || key === '+') {
      event.preventDefault();
      zoomIn();
      return;
    }
    if (key === '-' || key === '_') {
      event.preventDefault();
      zoomOut();
      return;
    }
    if (key === '0') {
      event.preventDefault();
      zoomTo100();
      return;
    }

    if (!isTypingInText && !isTypingInInput) {
      if (key === 'a') {
        event.preventDefault();
        selectAllElements();
      }
      if (key === 'c') {
        event.preventDefault();
        copySelectedElement();
      }
      if (key === 'v') {
        event.preventDefault();
        pasteElement();
      }
      if (key === 'd') {
        event.preventDefault();
        duplicateSelectedElement();
      }
      if (key === 'g') {
        event.preventDefault();
        if (event.shiftKey) ungroupSelected(); else groupSelected();
      }
    }
  }

  if (!isTypingInText && !isTypingInInput) {
    // Стрілки в списку слайдів — навігація між слайдами.
    if (['ArrowUp', 'ArrowDown'].includes(event.key) && dom.slideList.contains(activeElement)) {
      event.preventDefault();
      moveSlideFocus(event.key === 'ArrowDown' ? 1 : -1);
      return;
    }

    // Shift+F10 або клавіша меню — контекст-меню для вибраного об'єкта.
    if ((event.key === 'F10' && event.shiftKey) || event.key === 'ContextMenu') {
      if (getSelectedElement()) {
        event.preventDefault();
        openContextMenuForSelection();
        return;
      }
    }

    // Tab — циклічний вибір об'єктів, лише коли фокус БЕЗПОСЕРЕДНЬО на полотні
    // (щоб не блокувати звичайний обхід меню/палітри/контекст-меню).
    if (event.key === 'Tab' && activeElement === dom.workspace) {
      const slide = getCurrentSlide();
      if (slide && slide.elements.length) {
        event.preventDefault();
        cycleObjectSelection(event.shiftKey ? -1 : 1);
        return;
      }
    }

    if (event.key === 'Delete' || event.key === 'Backspace') {
      event.preventDefault();
      deleteSelectedElement();
      return;
    }

    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.key)) {
      const selected = getSelectedElements();
      if (!selected.length) return;
      event.preventDefault();
      const step = event.shiftKey ? 10 : 2;
      let dx = 0;
      let dy = 0;
      if (event.key === 'ArrowUp') dy = -step;
      if (event.key === 'ArrowDown') dy = step;
      if (event.key === 'ArrowLeft') dx = -step;
      if (event.key === 'ArrowRight') dx = step;
      // Спільний кламбінг, щоб уся група лишалась у межах слайда.
      const minX = Math.min(...selected.map(el => el.x));
      const maxRight = Math.max(...selected.map(el => el.x + el.w));
      const minY = Math.min(...selected.map(el => el.y));
      const maxBottom = Math.max(...selected.map(el => el.y + el.h));
      dx = clamp(dx, -minX, STAGE_WIDTH - maxRight);
      dy = clamp(dy, -minY, STAGE_HEIGHT - maxBottom);
      if (dx === 0 && dy === 0) return;
      pushHistory();
      selected.forEach(el => { el.x += dx; el.y += dy; });
      renderStage();
      renderSlideList();
      renderStatus();
      markDirty(selected.length > 1 ? 'Об’єкти переміщено' : 'Об’єкт переміщено');
    }
  }
}

function dispatchAction(action, trigger = null) {
  switch (action) {
    case 'new-project': runOfficeCommand('new') || confirmNewProject(); break;
    case 'open-project': runOfficeCommand('open') || openProjectPicker(); break;
    case 'save-project': runOfficeCommand('save') || saveProjectFile(); break;
    case 'export-pdf': handleExportPdf(); break;
    case 'print': handlePrint(); break;
    case 'clear-draft': confirmClearDraft(); break;
    case 'undo': runOfficeCommand('undo') || handleUndo(); break;
    case 'redo': runOfficeCommand('redo') || handleRedo(); break;
    case 'copy': copySelectedElement(); break;
    case 'paste': pasteElement(); break;
    case 'duplicate-element': duplicateSelectedElement(); break;
    case 'delete-element': deleteSelectedElement(); break;
    case 'insert-text': addTextElement(); break;
    case 'insert-image': promptImageInsert(); break;
    case 'replace-image': promptImageReplace(); break;
    case 'edit-alt': editImageAlt(); break;
    case 'insert-rect': addShape('rect'); break;
    case 'insert-circle': addShape('circle'); break;
    case 'insert-triangle': addShape('triangle'); break;
    case 'insert-line': addShape('line'); break;
    case 'insert-arrow': addShape('arrow'); break;
    case 'new-slide': addSlide(); break;
    case 'duplicate-slide': duplicateSlide(); break;
    case 'delete-slide': confirmDeleteSlide(); break;
    case 'move-slide-up': moveSlide(-1); break;
    case 'move-slide-down': moveSlide(1); break;
    case 'show-templates': showTemplatesPicker(); break;
    case 'show-themes': showThemePicker(); break;
    case 'show-layouts': showLayoutPicker(); break;
    case 'template-title': applyTemplate('title'); break;
    case 'template-text-image': applyTemplate('text-image'); break;
    case 'template-three-blocks': applyTemplate('three-blocks'); break;
    case 'color-panel': openColorPopover(null, trigger); break;
    case 'slide-background': openColorPopover('background', trigger || dom.colorPanelBtn); break;
    case 'present': startPresentation(); break;
    case 'zoom-in': zoomIn(); break;
    case 'zoom-out': zoomOut(); break;
    case 'zoom-100': zoomTo100(); break;
    case 'zoom-fit': fitStageToWorkspace(); break;
    case 'toggle-snap': toggleSnapToGrid(); break;
    case 'bold': toggleTextStyle('bold'); break;
    case 'italic': toggleTextStyle('italic'); break;
    case 'underline': toggleTextStyle('underline'); break;
    case 'align-left': setSelectedTextStyle({ align: 'left' }); break;
    case 'align-center': setSelectedTextStyle({ align: 'center' }); break;
    case 'align-right': setSelectedTextStyle({ align: 'right' }); break;
    case 'list-bullet': toggleTextList('bullet'); break;
    case 'list-number': toggleTextList('number'); break;
    case 'image-fit-cover': setSelectedImageStyle({ objectFit: 'cover' }); break;
    case 'image-fit-contain': setSelectedImageStyle({ objectFit: 'contain' }); break;
    case 'image-crop': toggleCropMode(); break;
    case 'rotate-left': rotateSelected(-15); break;
    case 'rotate-right': rotateSelected(15); break;
    case 'bring-front': bringSelectedToFront(); break;
    case 'send-back': sendSelectedToBack(); break;
    case 'align-objects-left': alignSelected('left'); break;
    case 'align-objects-h-center': alignSelected('center-h'); break;
    case 'align-objects-right': alignSelected('right'); break;
    case 'align-objects-top': alignSelected('top'); break;
    case 'align-objects-v-middle': alignSelected('middle-v'); break;
    case 'align-objects-bottom': alignSelected('bottom'); break;
    case 'distribute-h': distributeSelected('h'); break;
    case 'distribute-v': distributeSelected('v'); break;
    case 'group-objects': groupSelected(); break;
    case 'ungroup-objects': ungroupSelected(); break;
    case 'about': showAbout(); break;
    case 'shortcuts': showShortcuts(); break;
    default: break;
  }
}

function handleUndo() {
  if (!undo()) return;
  renderAll();
  markDirty('Скасовано');
}

function handleRedo() {
  if (!redo()) return;
  renderAll();
  markDirty('Повернуто');
}

function confirmNewProject() {
  showConfirmModal({
    title: 'Нова презентація',
    text: 'Поточна презентація буде очищена. Продовжити?',
    confirmText: 'Створити',
    onConfirm: () => {
      cancelDraftHydration();
      clearDraft();
      applyPresentationData(createDefaultPresentation());
      resetHistory();
      state.unsavedChanges = false;
      updateDirtyUi();
      renderAll();
      setStatusRight('Створено нову презентацію');
    }
  });
}

function saveProjectFile() {
  savePresentationFile(serializePresentation());
  state.unsavedChanges = false;
  updateDirtyUi();
  setStatusRight('Файл збережено');
}

function confirmClearDraft() {
  showConfirmModal({
    title: 'Очистити збережену чернетку',
    text: 'Локальну автозбережену чернетку буде видалено. Поточна презентація на екрані залишиться. Продовжити?',
    confirmText: 'Очистити',
    onConfirm: async () => {
      // Скасовуємо відкладене автозбереження, щоб воно не відродило чернетку
      // одразу після очищення.
      autosave.cancel();
      const ok = await clearDraft();
      setStatusRight(ok ? 'Чернетку очищено' : 'Не вдалося очистити чернетку');
    }
  });
}

async function onProjectFileSelected() {
  const file = dom.projectFileInput.files?.[0];
  dom.projectFileInput.value = '';
  if (!file) return;
  if (file.size > LIMITS.MAX_PROJECT_FILE_BYTES) {
    showInfoModal('Файл завеликий', `Максимальний розмір файла презентації — ${Math.round(LIMITS.MAX_PROJECT_FILE_BYTES / (1024 * 1024))} МБ.`);
    return;
  }
  // Відкриття файла користувачем скасовує запізніле відновлення чернетки.
  cancelDraftHydration();
  // Повний знімок стану редагування для відкату: якщо застосування чи рендер
  // імпорту зірветься (попри валідацію), повертаємо відкритий проєкт РАЗОМ з
  // історією та статусом збереження, без втрат.
  const previous = {
    presentation: serializePresentation(),
    undoStack: deepClone(state.undoStack),
    redoStack: deepClone(state.redoStack),
    unsavedChanges: state.unsavedChanges
  };
  try {
    const text = await readFileAsText(file);
    const parsed = parsePresentationText(text);
    if (!parsed) throw new Error('invalid');
    applyPresentationData(parsed);
    resetHistory();
    state.unsavedChanges = false;
    updateDirtyUi();
    renderAll();
    setStatusRight('Файл відкрито');
  } catch {
    applyPresentationData(previous.presentation);
    state.undoStack = previous.undoStack;
    state.redoStack = previous.redoStack;
    state.unsavedChanges = previous.unsavedChanges;
    updateDirtyUi();
    renderAll();
    showInfoModal('Не вдалося відкрити файл', 'Перевірте, чи це файл презентації ПЛЮС Слайди у форматі JSON.');
  }
}

function addSlide() {
  pushHistory();
  const slide = createSlide({ background: getActiveTheme().background, elements: createBasicSlideElements() });
  state.slides.push(slide);
  state.currentSlideId = slide.id;
  state.selectedElementIds = slide.elements[0] ? [slide.elements[0].id] : [];
  renderAll();
  markDirty('Додано новий слайд');
  requestAnimationFrame(() => {
    const titleNode = slide.elements[0] ? elementDomMap.get(slide.elements[0].id)?.querySelector('.text-element') : null;
    titleNode?.focus();
  });
}

function duplicateSlide(slideId = state.currentSlideId) {
  const index = state.slides.findIndex(slide => slide.id === slideId);
  if (index === -1) return;
  pushHistory();
  const original = state.slides[index];
  const clone = deepClone(original);
  clone.id = createSlide().id;
  clone.elements = clone.elements.map((element, elementIndex) => normalizeElement({ ...element, id: null }, elementIndex, { trusted: true }));
  state.slides.splice(index + 1, 0, clone);
  state.currentSlideId = clone.id;
  state.selectedElementIds = [];
  renderAll();
  markDirty('Слайд дубльовано');
}

function confirmDeleteSlide(slideId = state.currentSlideId) {
  if (state.slides.length === 1) {
    showInfoModal('Не можна видалити', 'У презентації має залишатися хоча б один слайд.');
    return;
  }
  showConfirmModal({
    title: 'Видалити слайд',
    text: 'Слайд буде видалено без можливості швидкого повернення, якщо ви закриєте сторінку.',
    confirmText: 'Видалити',
    onConfirm: () => deleteSlide(slideId)
  });
}

function deleteSlide(slideId) {
  pushHistory();
  const index = state.slides.findIndex(slide => slide.id === slideId);
  if (index === -1) return;
  state.slides.splice(index, 1);
  const nextIndex = clamp(index, 0, state.slides.length - 1);
  state.currentSlideId = state.slides[nextIndex].id;
  state.selectedElementIds = [];
  renderAll();
  markDirty('Слайд видалено');
}

function moveSlide(direction) {
  const currentIndex = getCurrentSlideIndex();
  const nextIndex = currentIndex + direction;
  if (nextIndex < 0 || nextIndex >= state.slides.length) return;
  pushHistory();
  const [slide] = state.slides.splice(currentIndex, 1);
  state.slides.splice(nextIndex, 0, slide);
  state.currentSlideId = slide.id;
  renderAll();
  markDirty('Слайд переставлено');
}

function addTextElement() {
  pushHistory();
  const slide = getCurrentSlide();
  const element = createTextElement({ z: slide.elements.length + 1 });
  slide.elements.push(element);
  state.selectedElementIds = [element.id];
  renderAll();
  markDirty('Додано текст');
  requestAnimationFrame(() => {
    const node = elementDomMap.get(element.id)?.querySelector('.text-element');
    node?.focus();
  });
}

function promptImageInsert() {
  pendingImageOperation = { mode: 'insert', elementId: null, alt: '' };
  showImageSourceModal({
    title: 'Додати зображення',
    text: 'Оберіть файл із пристрою або вставте посилання на зображення.',
    confirmText: 'Додати'
  });
}

function promptImageReplace() {
  const element = getSelectedElement();
  if (!element || element.type !== 'image') {
    showInfoModal('Замінити зображення', 'Виберіть одне зображення, яке потрібно замінити.');
    return;
  }
  pendingImageOperation = { mode: 'replace', elementId: element.id, alt: element.alt || '' };
  showImageSourceModal({
    title: 'Замінити зображення',
    text: 'Нове зображення збереже позицію, розмір, поворот і шар поточного.',
    confirmText: 'Замінити',
    alt: element.alt || ''
  });
}

function showImageSourceModal({ title, text, confirmText, alt = '' }) {
  showModal({
    title,
    text,
    body: `
      <div class="form-stack">
        <button id="pickImageFile" class="link-button" type="button"><i class="fa-solid fa-image"></i> Обрати файл</button>
        <input id="imageUrlField" class="input-like" type="text" placeholder="https://...">
        <input id="imageAltField" class="input-like" type="text" placeholder="Опис зображення (alt) — для доступності">
        <div class="helper-text">Для учнів і вчителів найнадійніше працює завантаження файлу з комп’ютера.</div>
        <div id="imageSourceError" class="form-error hidden" role="alert"></div>
      </div>
    `,
    confirmText,
    cancelText: 'Скасувати',
    // Закриття/заміна модалки інвалідує незавершений HTTPS-fetch, тож його
    // пізнє завершення не застосує/не замінить зображення й не закриє іншу модалку.
    onClose: invalidateImageEmbed,
    onMount: () => {
      $('#imageAltField').value = alt;
      $('#pickImageFile').addEventListener('click', () => {
        pendingImageOperation.alt = $('#imageAltField').value.trim();
        openImagePicker({ keepOperation: true });
      });
    },
    // Повертаємо false при порожньому/невалідному джерелі — модалка лишається
    // відкритою з інлайн-поясненням, тож уведені URL та alt не втрачаються.
    onConfirm: () => {
      const url = $('#imageUrlField').value.trim();
      const alt = $('#imageAltField').value.trim();
      if (!url) {
        showImageSourceError('Вставте посилання на зображення або оберіть файл із пристрою.');
        return false;
      }
      if (url.startsWith('data:')) {
        if (!applyImageSource(url, alt)) {
          showImageSourceError('Некоректний data:image URL або зображення завелике.');
          return false;
        }
        return;
      }
      if (!/^https:\/\//i.test(url)) {
        showImageSourceError('Підтримуються файл, HTTPS-посилання або data:image URL.');
        return false;
      }
      // HTTPS вбудовуємо як data: одразу: модель зберігає лише data:, тож
      // зображення переживає перезбереження й працює офлайн (зовнішні URL
      // нейтралізуються при імпорті). Поки триває fetch — модалка відкрита.
      embedAndApplyImageUrl(url, alt);
      return false;
    }
  });
}

function showImageSourceError(message) {
  const box = $('#imageSourceError');
  if (!box) return;
  box.classList.remove('form-busy');
  box.textContent = message || '';
  box.classList.toggle('hidden', !message);
}

function setImageSourceBusy(busy, message = '') {
  const box = $('#imageSourceError');
  if (box) {
    box.classList.toggle('form-busy', busy);
    box.textContent = busy ? message : '';
    box.classList.toggle('hidden', !busy);
  }
  if (dom.modalConfirm) dom.modalConfirm.disabled = busy;
}

// Кожне HTTPS-завантаження отримує власний токен і AbortController. Інвалідація
// (закриття/заміна модалки) збільшує лічильник і перериває fetch, тож запит, що
// завершився ПІСЛЯ скасування, не пройде перевірку токена й нічого не змінить.
let imageEmbedSeq = 0;
let imageEmbedAbort = null;

function invalidateImageEmbed() {
  imageEmbedSeq += 1;
  imageEmbedAbort?.abort();
  imageEmbedAbort = null;
  if (dom.modalConfirm) dom.modalConfirm.disabled = false;
}

async function embedAndApplyImageUrl(url, alt) {
  const token = ++imageEmbedSeq;
  imageEmbedAbort?.abort();
  const controller = new AbortController();
  imageEmbedAbort = controller;
  // Знімок операції на момент старту — глобальний pendingImageOperation може
  // змінитися (інша вставка/заміна) поки триває fetch.
  const operation = { ...pendingImageOperation };
  setImageSourceBusy(true, 'Завантаження зображення…');
  try {
    const dataUrl = await fetchImageAsDataURL(url, controller.signal);
    if (token !== imageEmbedSeq) return;            // скасовано/заміщено під час fetch
    setImageSourceBusy(false);
    if (!applyImageSource(dataUrl, alt, operation)) {
      showImageSourceError('Зображення завелике для вбудовування. Спробуйте менший файл.');
      return;
    }
    closeModal();
  } catch {
    if (token !== imageEmbedSeq) return;            // скасовано — UI вже належить іншому стану
    setImageSourceBusy(false);
    showImageSourceError('Не вдалося завантажити зображення за посиланням (його може блокувати CORS). Збережіть файл і додайте з пристрою.');
  }
}

// Завантажуємо зображення за HTTPS і кодуємо в data: URL для вбудовування.
async function fetchImageAsDataURL(url, signal) {
  const response = await fetch(url, { mode: 'cors', signal });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const blob = await response.blob();
  if (!blob.type.startsWith('image/')) throw new Error('not an image');
  if (blob.size > LIMITS.MAX_IMAGE_FILE_BYTES) throw new Error('too large');
  return readFileAsDataURL(blob);
}

async function onImageFileSelected() {
  const file = dom.imageFileInput.files?.[0];
  dom.imageFileInput.value = '';
  if (!file) return;
  if (!file.type.startsWith('image/')) {
    showInfoModal('Непідтримуваний файл', 'Оберіть файл зображення.');
    return;
  }
  if (file.size > LIMITS.MAX_IMAGE_FILE_BYTES) {
    showInfoModal('Зображення завелике', `Максимальний розмір зображення — ${Math.round(LIMITS.MAX_IMAGE_FILE_BYTES / (1024 * 1024))} МБ.`);
    return;
  }
  try {
    const dataUrl = await readFileAsDataURL(file);
    if (!applyImageSource(dataUrl, pendingImageOperation.alt)) return;
    pendingImageOperation = { mode: 'insert', elementId: null, alt: '' };
    closeModal();
  } catch {
    showInfoModal('Не вдалося прочитати файл', 'Спробуйте інше зображення.');
  }
}

// operation — знімок наміру (insert/replace). Для синхронних шляхів (файл, data:)
// це поточний pendingImageOperation; для асинхронного HTTPS — зафіксований на старті.
function applyImageSource(src, alt = '', operation = pendingImageOperation) {
  if (!isSupportedImageSource(src)) {
    setStatusRight('Зображення не додано: використайте файл, HTTPS-посилання або коректний data:image URL');
    return false;
  }
  // На цей рівень джерело доходить уже як data: (HTTPS вбудовано раніше),
  // тож у моделі ніколи не зберігається сирий зовнішній URL.
  if (operation.mode === 'replace') {
    const replaced = replaceImage(operation.elementId, src, alt);
    if (replaced) pendingImageOperation = { mode: 'insert', elementId: null, alt: '' };
    return replaced;
  }
  insertImage(src, alt);
  return true;
}

function isSupportedImageSource(src) {
  if (typeof src !== 'string' || !src) return false;
  // Лише data:image — HTTPS вбудовується в data: ще до цього кроку (embedAndApplyImageUrl),
  // тож сирий зовнішній URL не потрапляє в модель і не ламає офлайн/безпеку.
  return src.startsWith('data:image/') && src.length <= LIMITS.MAX_DATA_URL_LENGTH;
}

function insertImage(src, alt = '') {
  pushHistory();
  const slide = getCurrentSlide();
  const element = createImageElement(src, { z: slide.elements.length + 1, alt });
  slide.elements.push(element);
  state.selectedElementIds = [element.id];
  renderAll();
  markDirty('Додано зображення');
}

function replaceImage(elementId, src, alt = '') {
  const element = findElementById(elementId);
  if (!element || element.type !== 'image') {
    setStatusRight('Зображення не замінено: вибраний об’єкт більше не існує');
    return false;
  }
  if (element.content === src && element.alt === alt) return true;
  pushHistory();
  element.content = src;
  element.alt = alt;
  // Заповнення image-placeholder робить його реальним зображенням.
  element.isPlaceholder = false;
  state.selectedElementIds = [element.id];
  renderAll();
  markDirty('Зображення замінено');
  return true;
}

function editImageAlt() {
  const element = getSelectedElement();
  if (!element || element.type !== 'image') {
    showInfoModal('Опис зображення', 'Виберіть зображення, щоб задати текстовий опис (alt).');
    return;
  }
  showModal({
    title: 'Опис зображення (alt)',
    text: 'Короткий текстовий опис для доступності та озвучення зчитувачем екрана.',
    body: '<input id="altEditField" class="input-like" type="text" placeholder="Напр.: Схема кругообігу води">',
    confirmText: 'Зберегти',
    onMount: () => {
      const field = $('#altEditField');
      field.value = element.alt || '';
      field.focus();
    },
    onConfirm: () => {
      pushHistory();
      element.alt = $('#altEditField').value.trim();
      renderStage();
      markDirty('Опис зображення змінено');
    }
  });
}

function addShape(kind) {
  pushHistory();
  const slide = getCurrentSlide();
  const count = slide.elements.filter(element => element.type === 'shape').length;
  const base = createShapeElement(kind, {
    ...(kind === 'circle' ? { x: 320, y: 160 } : {}),
    ...(kind === 'triangle' ? { x: 315, y: 150 } : {}),
    ...(kind === 'rect' ? { x: 285, y: 150 } : {}),
    ...(TEXT_SHAPE_TYPES.includes(kind) ? {
      content: 'Текст фігури',
      placeholder: 'Текст фігури',
      isPlaceholder: true,
      style: { align: 'center' }
    } : {}),
    z: slide.elements.length + 1
  });
  base.x = clamp(base.x + (count % 4) * 24, 24, STAGE_WIDTH - base.w - 24);
  base.y = clamp(base.y + (count % 4) * 18, 24, STAGE_HEIGHT - base.h - 24);
  slide.elements.push(base);
  state.selectedElementIds = [base.id];
  renderAll();
  const labels = {
    rect: 'Додано прямокутник',
    circle: 'Додано коло',
    triangle: 'Додано трикутник',
    line: 'Додано лінію',
    arrow: 'Додано стрілку'
  };
  markDirty(labels[kind] || 'Додано фігуру');
}

function applyTemplate(type) {
  pushHistory();
  const slide = getCurrentSlide();
  const template = createTemplateDefinition(type);
  slide.background = getActiveTheme().background;
  slide.elements = template.elements.map((element, index) => normalizeElement({ ...element, z: index + 1 }, index, { trusted: true }));
  state.selectedElementIds = [];
  renderAll();
  markDirty('Застосовано макет');
}

function findElementById(elementId) {
  const slide = getCurrentSlide();
  if (!slide) return null;
  return slide.elements.find(element => element.id === elementId) || null;
}

function setSelectedTextStyle(partial) {
  const targets = getSelectedElements().filter(element => element.type === 'text' || (element.type === 'shape' && TEXT_SHAPE_TYPES.includes(element.shape)));
  if (!targets.length) return;
  const changedTargets = targets.filter(element => Object.entries(partial).some(([key, value]) => element.style[key] !== value));
  if (!changedTargets.length) return;
  pushHistory();
  changedTargets.forEach(element => Object.assign(element.style, partial));
  renderStage();
  renderToolbarState();
  renderSlideList();
  markDirty('Формат тексту змінено');
}

// Представник зображення у вибірці: головний, якщо він зображення, інакше —
// перше вибране зображення (для відображення стану в тулбарі при мультивиборі).
// Порожній image-placeholder НЕ вважаємо «зображенням» для тулбара: fit/opacity/
// crop недоречні, доки його не заповнено (інакше crop активувався б без ручок).
function getPrimaryImageElement() {
  const isRealImage = element => element?.type === 'image' && !element.isPlaceholder;
  const primary = getSelectedElement();
  if (isRealImage(primary)) return primary;
  return getSelectedElements().find(isRealImage) || null;
}

function setSelectedImageStyle(partial) {
  const targets = getSelectedElements().filter(element => element.type === 'image');
  if (!targets.length) return;
  const changedTargets = targets.filter(element => Object.entries(partial).some(([key, value]) => element.style[key] !== value));
  if (!changedTargets.length) return;
  pushHistory();
  changedTargets.forEach(element => Object.assign(element.style, partial));
  renderStage();
  renderToolbarState();
  renderSlideList();
  markDirty('Зображення оформлено');
}

// Режим кадрування: показуємо crop-ручки й «привид» для вибраного зображення.
function toggleCropMode() {
  const imageEl = getPrimaryImageElement();
  if (!imageEl) return;
  if (state.cropElementId === imageEl.id) {
    exitCropMode();
    return;
  }
  state.cropElementId = imageEl.id;
  setSelection([imageEl.id]);
  renderStage();
  renderToolbarState();
}

function exitCropMode() {
  if (!state.cropElementId) return;
  state.cropElementId = null;
  renderStage();
  renderToolbarState();
}

// Перетягування crop-ручки змінює відповідні частки рамки. Логіка ізольована від
// головної pointer-машини: слухачі на document живуть лише на час перетягування.
function onCropHandlePointerDown(event, elementId, handle) {
  event.preventDefault();
  event.stopPropagation();
  const element = findElementById(elementId);
  const node = elementDomMap.get(elementId);
  if (!element || !node || element.type !== 'image') return;

  const startPoint = getStagePoint(dom.stage, event.clientX, event.clientY);
  const start = { ...(element.crop || { l: 0, t: 0, r: 0, b: 0 }), w: element.w, h: element.h, rotation: (element.rotation || 0) * Math.PI / 180 };
  const cos = Math.cos(start.rotation);
  const sin = Math.sin(start.rotation);
  const MIN_VISIBLE = 0.1; // лишаємо хоча б 10% видимого вікна
  let committed = false;

  const onMove = moveEvent => {
    const point = getStagePoint(dom.stage, moveEvent.clientX, moveEvent.clientY);
    const dx = point.x - startPoint.x;
    const dy = point.y - startPoint.y;
    // Рух курсора переводимо в локальні осі повернутого об'єкта (як у resize).
    const localDx = dx * cos + dy * sin;
    const localDy = -dx * sin + dy * cos;
    const fx = start.w ? localDx / start.w : 0;
    const fy = start.h ? localDy / start.h : 0;
    let l = start.l; let t = start.t; let r = start.r; let b = start.b;
    if (handle.includes('w')) l = clamp(start.l + fx, 0, 1 - start.r - MIN_VISIBLE);
    if (handle.includes('e')) r = clamp(start.r - fx, 0, 1 - start.l - MIN_VISIBLE);
    if (handle.includes('n')) t = clamp(start.t + fy, 0, 1 - start.b - MIN_VISIBLE);
    if (handle.includes('s')) b = clamp(start.b - fy, 0, 1 - start.t - MIN_VISIBLE);
    if (l === element.crop.l && t === element.crop.t && r === element.crop.r && b === element.crop.b) return;
    if (!committed) { pushHistory(); committed = true; }
    element.crop = { l, t, r, b };
    applyImageCropToNode(node, element);
  };
  // Спільне очищення: завершуємо й на pointerup, і на pointercancel (втрата
  // контролю/перерваний touch-жест), інакше pointermove лишається активним і
  // далі мутує кадрування.
  const finishCrop = () => {
    document.removeEventListener('pointermove', onMove);
    document.removeEventListener('pointerup', finishCrop);
    document.removeEventListener('pointercancel', finishCrop);
    if (committed) { renderSlideList(); markDirty('Зображення кадровано'); }
  };
  document.addEventListener('pointermove', onMove);
  document.addEventListener('pointerup', finishCrop);
  document.addEventListener('pointercancel', finishCrop);
}

function toggleTextStyle(key) {
  // Напрям перемикання визначаємо за представником тексту, застосовуємо до всіх
  // вибраних текстових блоків (незалежно від того, що вибрано останнім).
  const textEl = getPrimaryTextElement();
  if (!textEl) return;
  setSelectedTextStyle({ [key]: !textEl.style[key] });
}

function toggleTextList(listType) {
  const textEl = getPrimaryTextElement();
  if (!textEl) return;
  setSelectedTextStyle({ listType: textEl.style.listType === listType ? 'none' : listType });
}

function applyColor(color) {
  if (state.currentColorTarget === 'background') {
    pushHistory();
    const slide = getCurrentSlide();
    slide.background = color;
    renderStage();
    renderSlideList();
    renderColorModeButtons();
    markDirty('Фон змінено');
    return;
  }

  const targets = getSelectedElements();
  if (!targets.length) return;
  pushHistory();
  targets.forEach(element => {
    if (state.currentColorTarget === 'text' && (element.type === 'text' || (element.type === 'shape' && TEXT_SHAPE_TYPES.includes(element.shape)))) element.style.color = color;
    if (state.currentColorTarget === 'fill' && element.type === 'shape') element.style.fill = color;
    if (state.currentColorTarget === 'stroke' && element.type === 'shape') element.style.stroke = color;
  });
  renderStage();
  renderSlideList();
  renderToolbarState();
  renderColorModeButtons();
  markDirty('Колір змінено');
}

function rotateSelected(delta) {
  const targets = getSelectedElements();
  if (!targets.length) return;
  pushHistory();
  targets.forEach(element => {
    element.rotation = (((element.rotation || 0) + delta) % 360 + 360) % 360;
  });
  renderStage();
  renderSlideList();
  markDirty('Об’єкт повернуто');
}

// Вирівнювання вибраних об'єктів за спільним обмежувальним прямокутником. Працює
// на видимих краях (elementBounds — AABB з урахуванням rotation): зсув по x/y
// транслює AABB на ту саму величину, тож математика однакова й для повернутих.
// Одиниці вирівнювання/розподілу: кожна група — ОДНА одиниця зі спільним AABB
// (зсувається цілісно, зберігаючи внутрішнє розташування); негруповані — окремо.
function selectionUnits() {
  const groups = new Map();
  const units = [];
  getSelectedElements().forEach(element => {
    if (element.groupId) {
      if (!groups.has(element.groupId)) {
        const unit = { members: [] };
        groups.set(element.groupId, unit);
        units.push(unit);
      }
      groups.get(element.groupId).members.push(element);
    } else {
      units.push({ members: [element] });
    }
  });
  units.forEach(unit => {
    const bounds = unit.members.map(elementBounds);
    const left = Math.min(...bounds.map(b => b.left));
    const right = Math.max(...bounds.map(b => b.right));
    const top = Math.min(...bounds.map(b => b.top));
    const bottom = Math.max(...bounds.map(b => b.bottom));
    unit.b = { left, right, top, bottom, cx: (left + right) / 2, cy: (top + bottom) / 2 };
  });
  return units;
}

function moveUnit(unit, dx, dy) {
  unit.members.forEach(element => { element.x += dx; element.y += dy; });
}

function alignSelected(mode) {
  const units = selectionUnits();
  if (units.length < 2) return;
  const minLeft = Math.min(...units.map(u => u.b.left));
  const maxRight = Math.max(...units.map(u => u.b.right));
  const minTop = Math.min(...units.map(u => u.b.top));
  const maxBottom = Math.max(...units.map(u => u.b.bottom));
  const centerX = (minLeft + maxRight) / 2;
  const centerY = (minTop + maxBottom) / 2;
  pushHistory();
  units.forEach(u => {
    if (mode === 'left') moveUnit(u, minLeft - u.b.left, 0);
    else if (mode === 'right') moveUnit(u, maxRight - u.b.right, 0);
    else if (mode === 'center-h') moveUnit(u, centerX - u.b.cx, 0);
    else if (mode === 'top') moveUnit(u, 0, minTop - u.b.top);
    else if (mode === 'bottom') moveUnit(u, 0, maxBottom - u.b.bottom);
    else if (mode === 'middle-v') moveUnit(u, 0, centerY - u.b.cy);
  });
  renderStage();
  renderSlideList();
  markDirty('Вирівняно');
}

// Рівномірний розподіл центрів ОДИНИЦЬ між крайніми (потрібно ≥3 одиниці).
function distributeSelected(axis) {
  const units = selectionUnits();
  if (units.length < 3) return;
  const key = axis === 'h' ? 'cx' : 'cy';
  units.sort((a, b) => a.b[key] - b.b[key]);
  const first = units[0].b[key];
  const last = units[units.length - 1].b[key];
  const step = (last - first) / (units.length - 1);
  pushHistory();
  units.forEach((unit, index) => {
    if (index === 0 || index === units.length - 1) return;
    const delta = (first + index * step) - unit.b[key];
    if (axis === 'h') moveUnit(unit, delta, 0);
    else moveUnit(unit, 0, delta);
  });
  renderStage();
  renderSlideList();
  markDirty('Розподілено');
}

function bringSelectedToFront() {
  const targets = getSelectedElements().slice().sort((a, b) => (a.z || 0) - (b.z || 0));
  if (!targets.length) return;
  pushHistory();
  const slide = getCurrentSlide();
  let z = slide.elements.length + 1;
  // У порядку z — зберігаємо взаємний ВІЗУАЛЬНИЙ порядок вибраних об'єктів.
  targets.forEach(element => { element.z = z++; });
  normalizeZIndexes();
  renderAll();
  markDirty('Змінено шар');
}

function sendSelectedToBack() {
  const targets = getSelectedElements().slice().sort((a, b) => (a.z || 0) - (b.z || 0));
  if (!targets.length) return;
  pushHistory();
  let z = -targets.length;
  targets.forEach(element => { element.z = z++; });
  normalizeZIndexes();
  renderAll();
  markDirty('Змінено шар');
}

function copySelectedElement() {
  // Сортуємо за z, щоб вставлені копії зберегли взаємний ВІЗУАЛЬНИЙ порядок
  // накладання (масивний порядок після імпорту може не збігатися з z).
  const targets = getSelectedElements().slice().sort((a, b) => (a.z || 0) - (b.z || 0));
  if (!targets.length) return;
  state.clipboard = targets.map(element => deepClone(element));
  setStatusRight(targets.length > 1 ? `Скопійовано об’єктів: ${targets.length}` : 'Об’єкт скопійовано');
}

function pasteElement() {
  const items = Array.isArray(state.clipboard) ? state.clipboard : (state.clipboard ? [state.clipboard] : []);
  if (!items.length) return;
  pushHistory();
  const slide = getCurrentSlide();
  // Спільне зміщення для всієї групи, обмежене так, щоб уся група лишалась у
  // межах і ЗБЕРЕГЛА взаємне розташування (а не з'їжджалася біля країв).
  const offset = 24;
  const minX = Math.min(...items.map(item => item.x));
  const maxRight = Math.max(...items.map(item => item.x + item.w));
  const minY = Math.min(...items.map(item => item.y));
  const maxBottom = Math.max(...items.map(item => item.y + item.h));
  const dx = clamp(offset, -minX, STAGE_WIDTH - maxRight);
  const dy = clamp(offset, -minY, STAGE_HEIGHT - maxBottom);
  const copies = [];
  items.forEach(item => {
    const copy = normalizeElement({
      ...deepClone(item),
      id: null,
      x: item.x + dx,
      y: item.y + dy,
      z: slide.elements.length + 1
    }, slide.elements.length, { trusted: true });
    slide.elements.push(copy);
    copies.push(copy);
  });
  remapGroupIds(copies);
  const newIds = copies.map(copy => copy.id);
  state.selectedElementIds = newIds;
  renderAll();
  markDirty(newIds.length > 1 ? 'Об’єкти вставлено' : 'Об’єкт вставлено');
}

function duplicateSelectedElement() {
  copySelectedElement();
  pasteElement();
}

function deleteSelectedElement() {
  const targets = getSelectedElements();
  if (!targets.length) return;
  pushHistory();
  const slide = getCurrentSlide();
  const ids = new Set(state.selectedElementIds);
  slide.elements = slide.elements.filter(element => !ids.has(element.id));
  state.selectedElementIds = [];
  normalizeZIndexes();
  renderAll();
  markDirty(targets.length > 1 ? 'Об’єкти видалено' : 'Об’єкт видалено');
}

function handleExportPdf() {
  exportPresentationPdf(state.fileName, state.slides).catch(() => {
    showInfoModal('Експорт не вдався', 'Не вдалося створити PDF. Спробуйте ще раз.');
  });
}

function handlePrint() {
  const ok = printPresentation(state.fileName, state.slides);
  if (!ok) showInfoModal('Друк заблоковано', 'Браузер не відкрив вікно друку. Дозвольте спливаючі вікна для цієї сторінки.');
}

function startPresentation() {
  state.presentationIndex = getCurrentSlideIndex();
  dom.presentOverlay.classList.remove('hidden');
  renderPresentationSlide();
}

function stopPresentation() {
  dom.presentOverlay.classList.add('hidden');
  dom.presentStageWrap.innerHTML = '';
}

function showPreviousPresentationSlide() {
  if (state.presentationIndex > 0) {
    state.presentationIndex -= 1;
    renderPresentationSlide();
  }
}

function showNextPresentationSlide() {
  if (state.presentationIndex < state.slides.length - 1) {
    state.presentationIndex += 1;
    renderPresentationSlide();
  } else {
    stopPresentation();
  }
}

function renderPresentationSlide() {
  dom.presentStageWrap.innerHTML = '';
  const slide = state.slides[state.presentationIndex];
  if (!slide) return;
  const snapshot = createSlideSnapshot(slide);
  snapshot.classList.add('present-stage');
  dom.presentStageWrap.appendChild(snapshot);
}


function showTemplatesPicker() {
  showModal({
    title: 'Макети слайдів',
    text: 'Оберіть базовий шкільний макет і відразу редагуйте його.',
    body: `
      <div class="template-list">
        <button class="template-btn" data-template="title" type="button">
          <span class="template-title">Титульний слайд</span>
          <span class="template-text">Великий заголовок і підпис автора</span>
        </button>
        <button class="template-btn" data-template="text-image" type="button">
          <span class="template-title">Текст + фото</span>
          <span class="template-text">Заголовок, список і місце для ілюстрації</span>
        </button>
        <button class="template-btn" data-template="three-blocks" type="button">
          <span class="template-title">3 блоки</span>
          <span class="template-text">Порівняння трьох ідей або понять</span>
        </button>
      </div>
    `,
    confirmText: 'Закрити',
    showCancel: false,
    onMount: () => {
      $$('.template-btn', dom.modalBody).forEach(button => {
        button.addEventListener('click', () => {
          applyTemplate(button.dataset.template);
          closeModal();
        });
      });
    }
  });
}

function showAbout() {
  showInfoModal('Про ПЛЮС Слайди', 'ПЛЮС Слайди — простий редактор презентацій для шкільного офісного пакета. Є базові макети, текст, зображення, фігури, PDF і режим показу.');
}

function showShortcuts() {
  showInfoModal('Клавіатурні скорочення', 'Ctrl+N — нова презентація\nCtrl+O — відкрити\nCtrl+S — зберегти файл\nCtrl+Z / Ctrl+Y — скасувати / повернути\nCtrl+C / Ctrl+V — копіювати / вставити об’єкт\nCtrl+D — дублювати\nDelete — видалити\nСтрілки — рух об’єкта\nF5 — показ');
}

function showModal({ title, text = '', body = '', confirmText = 'Гаразд', cancelText = 'Скасувати', icon = 'fa-solid fa-circle-info', onConfirm = null, onMount = null, onClose = null, showCancel = true }) {
  showModalUi(dom, { title, text, body, confirmText, cancelText, icon, onConfirm, onMount, onClose, showCancel });
}

function closeModal() {
  closeModalUi(dom);
}

function showInfoModal(title, text) {
  showInfoModalUi(dom, title, text);
}

function showConfirmModal({ title, text, confirmText = 'Продовжити', onConfirm }) {
  showConfirmModalUi(dom, { title, text, confirmText, onConfirm });
}

window.SlidesApp.boot = initSlidesEditor;
window.SlidesApp.runCommand = runOfficeCommand;
window.SlidesApp.openProjectPicker = openProjectPicker;
window.SlidesApp.openImagePicker = openImagePicker;
