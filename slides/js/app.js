import { COLOR_PALETTE, DEFAULT_SHAPE_STYLE, DEFAULT_TEXT_STYLE, FONT_SIZES, STAGE_HEIGHT, STAGE_WIDTH } from './constants.js';
import { exportPresentationPdf, printPresentation, createSlideSnapshot } from './export.js';
import { pushHistory, redo, resetHistory, undo } from './history.js';
import {
  closeModal as closeModalUi,
  showConfirmModal as showConfirmModalUi,
  showInfoModal as showInfoModalUi,
  showModal as showModalUi
} from './modal-ui.js';
import { normalizeElement, normalizePresentation, parsePresentationText, savePresentationFile } from './project.js';
import { renderStage as renderStageView, syncSelectionUi as syncStageSelectionUi } from './stage-renderer.js';
import { renderSlideList as renderSlideListView } from './slide-list.js';
import {
  bindStage as bindStageInteractions,
  onElementPointerDown as handleElementPointerDown,
  onHandlePointerDown as handleHandlePointerDown,
  onStagePointerMove as handleStagePointerMove,
  onStagePointerUp as handleStagePointerUp
} from './stage-interactions.js';
import { state, applyPresentationData, getCurrentSlide, getCurrentSlideIndex, getSelectedElement, serializePresentation } from './state.js';
import { clearDraft, loadDraft, saveDraft } from './storage.js';
import { createBasicSlideElements, createDefaultPresentation, createImageElement, createShapeElement, createSlide, createTemplateDefinition, createTextElement } from './templates.js';
import { $, $$, clamp, debounce, deepClone, getTextFromContentEditable, readFileAsDataURL, readFileAsText } from './utils.js';

window.SlidesApp = window.SlidesApp || {};

const dom = {};
const elementDomMap = new Map();

let colorAnchorButton = null;

const autosave = debounce(() => {
  saveDraft(serializePresentation());
  state.unsavedChanges = false;
  updateDirtyUi();
  setStatusRight(`Автозбережено • ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`);
}, 260);

function setStatusRight(text) {
  dom.statusRight.textContent = text;
}

function updateDirtyUi() {
  dom.dirtyDot.style.display = state.unsavedChanges ? 'inline-block' : 'none';
  dom.saveBadge.textContent = state.unsavedChanges ? 'Є зміни' : 'Збережено ✓';
}

function markDirty(statusText = 'Є незбережені зміни') {
  state.unsavedChanges = true;
  updateDirtyUi();
  setStatusRight(statusText);
  autosave();
}

function initDom() {
  dom.fileName = $('#fileName');
  dom.dirtyDot = $('#dirtyDot');
  dom.saveBadge = $('#saveBadge');
  dom.projectFileInput = $('#projectFileInput');
  dom.imageFileInput = $('#imageFileInput');
  dom.stage = $('#stage');
  dom.slideList = $('#slideList');
  dom.workspace = $('#workspace');
  dom.statusLeft = $('#statusLeft');
  dom.statusRight = $('#statusRight');
  dom.fontSizeSelect = $('#fontSizeSelect');
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
  loadInitialState();
  bindMenus();
  bindToolbar();
  bindInputs();
  bindStage();
  bindPresentation();
  renderAll();
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

function openImagePicker() {
  window.OfficeShell?.openFilePicker?.(dom.imageFileInput) || dom.imageFileInput.click();
}

function loadInitialState() {
  const saved = normalizePresentation(loadDraft());
  const data = saved || createDefaultPresentation();
  applyPresentationData(data);
  resetHistory();
  state.unsavedChanges = false;
  updateDirtyUi();
  setStatusRight('Готово');
}

function renderAll() {
  renderFileName();
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
  const selected = getSelectedElement();
  dom.statusLeft.textContent = `Слайд ${index + 1} з ${state.slides.length}${selected ? ` • Об’єкт: ${describeElement(selected)}` : ''}`;
}

function describeElement(element) {
  if (element.type === 'text') return 'текст';
  if (element.type === 'image') return 'зображення';
  if (element.shape === 'circle') return 'коло';
  if (element.shape === 'triangle') return 'трикутник';
  return 'прямокутник';
}

function renderColorPalette() {
  dom.colorPalette.innerHTML = '';
  COLOR_PALETTE.forEach(color => {
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
  renderStageView({
    elementDomMap,
    markDirty,
    onElementPointerDown,
    onHandlePointerDown,
    renderSlideList,
    selectElement,
    stage: dom.stage
  });
}

function renderToolbarState() {
  const selected = getSelectedElement();
  dom.fontSizeSelect.value = String(selected?.style?.fontSize || FONT_SIZES[1]);
  $$('[data-action="bold"], [data-action="italic"], [data-action="underline"], [data-action="align-left"], [data-action="align-center"], [data-action="align-right"]').forEach(button => {
    button.classList.remove('active');
  });

  if (selected?.type === 'text') {
    if (selected.style.bold) $$('[data-action="bold"]').forEach(btn => btn.classList.add('active'));
    if (selected.style.italic) $$('[data-action="italic"]').forEach(btn => btn.classList.add('active'));
    if (selected.style.underline) $$('[data-action="underline"]').forEach(btn => btn.classList.add('active'));
    $$(`[data-action="align-${selected.style.align || 'left'}"]`).forEach(btn => btn.classList.add('active'));
  }
}

function syncSelectionUi() {
  syncStageSelectionUi(elementDomMap);
}

function selectElement(id) {
  state.selectedElementId = id;
  syncSelectionUi();
  renderToolbarState();
  renderStatus();
}

function clearSelection() {
  state.selectedElementId = null;
  syncSelectionUi();
  renderToolbarState();
  renderStatus();
}

function onElementPointerDown(event, elementId) {
  handleElementPointerDown(event, elementId, { elementDomMap, findElementById, selectElement, stage: dom.stage });
}

function onHandlePointerDown(event, elementId, handle) {
  handleHandlePointerDown(event, elementId, handle, { elementDomMap, findElementById, selectElement, stage: dom.stage });
}

function bindStage() {
  bindStageInteractions(dom.stage, { clearSelection, onStagePointerMove, onStagePointerUp });
}

function onStagePointerMove(event) {
  handleStagePointerMove(event, { elementDomMap, findElementById, stage: dom.stage });
}

function onStagePointerUp(event) {
  handleStagePointerUp(event, { elementDomMap, markDirty, renderSlideList });
}

function bindMenus() {
  $$('.menu-title').forEach(button => {
    button.addEventListener('click', event => {
      event.stopPropagation();
      toggleMenu(button.dataset.menu);
    });
  });

  $$('.menu-item').forEach(button => {
    button.addEventListener('click', () => {
      dispatchAction(button.dataset.action, button);
      closeMenus();
    });
  });

  document.addEventListener('pointerdown', event => {
    if (!event.target.closest('.menu-item-wrap')) closeMenus();
    if (!event.target.closest('.color-popover') && !event.target.closest('#colorPanelBtn')) closeColorPopover();
  });
}

function bindToolbar() {
  $$('[data-action]').forEach(button => {
    if (button.closest('.menu-dropdown')) return;
    button.addEventListener('click', event => dispatchAction(button.dataset.action, event.currentTarget));
  });
}

function bindInputs() {
  dom.fontSizeSelect.addEventListener('change', event => setSelectedTextStyle({ fontSize: Number(event.target.value) }));
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
  window.addEventListener('resize', () => { if (!dom.colorPopover.classList.contains('hidden')) positionColorPopover(); });
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
  const selected = getSelectedElement();
  const modes = [];
  if (selected?.type === 'text') modes.push({ key: 'text', label: 'Текст' });
  if (selected?.type === 'shape') {
    modes.push({ key: 'fill', label: 'Заливка' });
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
    if (selected?.type === 'text') state.currentColorTarget = 'text';
    else if (selected?.type === 'shape') state.currentColorTarget = 'fill';
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

    if (!isTypingInText && !isTypingInInput) {
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
    }
  }

  if (!isTypingInText && !isTypingInInput) {
    if (event.key === 'Delete' || event.key === 'Backspace') {
      event.preventDefault();
      deleteSelectedElement();
      return;
    }

    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.key)) {
      const selected = getSelectedElement();
      if (!selected) return;
      event.preventDefault();
      pushHistory();
      const step = event.shiftKey ? 10 : 2;
      if (event.key === 'ArrowUp') selected.y = clamp(selected.y - step, 0, STAGE_HEIGHT - selected.h);
      if (event.key === 'ArrowDown') selected.y = clamp(selected.y + step, 0, STAGE_HEIGHT - selected.h);
      if (event.key === 'ArrowLeft') selected.x = clamp(selected.x - step, 0, STAGE_WIDTH - selected.w);
      if (event.key === 'ArrowRight') selected.x = clamp(selected.x + step, 0, STAGE_WIDTH - selected.w);
      renderStage();
      renderSlideList();
      renderStatus();
      markDirty('Об’єкт переміщено');
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
    case 'undo': runOfficeCommand('undo') || handleUndo(); break;
    case 'redo': runOfficeCommand('redo') || handleRedo(); break;
    case 'copy': copySelectedElement(); break;
    case 'paste': pasteElement(); break;
    case 'duplicate-element': duplicateSelectedElement(); break;
    case 'delete-element': deleteSelectedElement(); break;
    case 'insert-text': addTextElement(); break;
    case 'insert-image': promptImageInsert(); break;
    case 'insert-rect': addShape('rect'); break;
    case 'insert-circle': addShape('circle'); break;
    case 'insert-triangle': addShape('triangle'); break;
    case 'new-slide': addSlide(); break;
    case 'duplicate-slide': duplicateSlide(); break;
    case 'delete-slide': confirmDeleteSlide(); break;
    case 'move-slide-up': moveSlide(-1); break;
    case 'move-slide-down': moveSlide(1); break;
    case 'show-templates': showTemplatesPicker(); break;
    case 'template-title': applyTemplate('title'); break;
    case 'template-text-image': applyTemplate('text-image'); break;
    case 'template-three-blocks': applyTemplate('three-blocks'); break;
    case 'color-panel': openColorPopover(null, trigger); break;
    case 'slide-background': openColorPopover('background', trigger || dom.colorPanelBtn); break;
    case 'present': startPresentation(); break;
    case 'bold': toggleTextStyle('bold'); break;
    case 'italic': toggleTextStyle('italic'); break;
    case 'underline': toggleTextStyle('underline'); break;
    case 'align-left': setSelectedTextStyle({ align: 'left' }); break;
    case 'align-center': setSelectedTextStyle({ align: 'center' }); break;
    case 'align-right': setSelectedTextStyle({ align: 'right' }); break;
    case 'rotate-left': rotateSelected(-15); break;
    case 'rotate-right': rotateSelected(15); break;
    case 'bring-front': bringSelectedToFront(); break;
    case 'send-back': sendSelectedToBack(); break;
    case 'about': showAbout(); break;
    case 'shortcuts': showShortcuts(); break;
    default: break;
  }
}

function handleUndo() {
  if (!undo()) return;
  state.unsavedChanges = false;
  updateDirtyUi();
  renderAll();
  setStatusRight('Скасовано');
}

function handleRedo() {
  if (!redo()) return;
  state.unsavedChanges = false;
  updateDirtyUi();
  renderAll();
  setStatusRight('Повернуто');
}

function confirmNewProject() {
  showConfirmModal({
    title: 'Нова презентація',
    text: 'Поточна презентація буде очищена. Продовжити?',
    confirmText: 'Створити',
    onConfirm: () => {
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

async function onProjectFileSelected() {
  const file = dom.projectFileInput.files?.[0];
  dom.projectFileInput.value = '';
  if (!file) return;
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
    showInfoModal('Не вдалося відкрити файл', 'Перевірте, чи це файл презентації ПЛЮС Слайди у форматі JSON.');
  }
}

function addSlide() {
  pushHistory();
  const slide = createSlide({ elements: createBasicSlideElements() });
  state.slides.push(slide);
  state.currentSlideId = slide.id;
  state.selectedElementId = slide.elements[0]?.id || null;
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
  clone.elements = clone.elements.map((element, elementIndex) => normalizeElement({ ...element, id: null }, elementIndex));
  state.slides.splice(index + 1, 0, clone);
  state.currentSlideId = clone.id;
  state.selectedElementId = null;
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
  state.selectedElementId = null;
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
  state.selectedElementId = element.id;
  renderAll();
  markDirty('Додано текст');
  requestAnimationFrame(() => {
    const node = elementDomMap.get(element.id)?.querySelector('.text-element');
    node?.focus();
  });
}

function promptImageInsert() {
  showModal({
    title: 'Додати зображення',
    text: 'Оберіть файл із пристрою або вставте посилання на зображення.',
    body: `
      <div class="form-stack">
        <button id="pickImageFile" class="link-button" type="button"><i class="fa-solid fa-image"></i> Обрати файл</button>
        <input id="imageUrlField" class="input-like" type="text" placeholder="https://...">
        <div class="helper-text">Для учнів і вчителів найнадійніше працює завантаження файлу з комп’ютера.</div>
      </div>
    `,
    confirmText: 'Додати',
    cancelText: 'Скасувати',
    onMount: () => {
      $('#pickImageFile').addEventListener('click', () => openImagePicker());
    },
    onConfirm: () => {
      const url = $('#imageUrlField').value.trim();
      if (url) insertImage(url);
    }
  });
}

async function onImageFileSelected() {
  const file = dom.imageFileInput.files?.[0];
  dom.imageFileInput.value = '';
  if (!file) return;
  try {
    const dataUrl = await readFileAsDataURL(file);
    insertImage(dataUrl);
    closeModal();
  } catch {
    showInfoModal('Не вдалося прочитати файл', 'Спробуйте інше зображення.');
  }
}

function insertImage(src) {
  pushHistory();
  const slide = getCurrentSlide();
  const element = createImageElement(src, { z: slide.elements.length + 1 });
  slide.elements.push(element);
  state.selectedElementId = element.id;
  renderAll();
  markDirty('Додано зображення');
}

function addShape(kind) {
  pushHistory();
  const slide = getCurrentSlide();
  const count = slide.elements.filter(element => element.type === 'shape').length;
  const base = createShapeElement(kind, {
    x: kind === 'circle' ? 320 : (kind === 'triangle' ? 315 : 285),
    y: kind === 'circle' ? 160 : 150,
    z: slide.elements.length + 1
  });
  base.x = clamp(base.x + (count % 4) * 24, 24, STAGE_WIDTH - base.w - 24);
  base.y = clamp(base.y + (count % 4) * 18, 24, STAGE_HEIGHT - base.h - 24);
  slide.elements.push(base);
  state.selectedElementId = base.id;
  renderAll();
  markDirty(kind === 'triangle' ? 'Додано трикутник' : 'Додано фігуру');
}

function applyTemplate(type) {
  pushHistory();
  const slide = getCurrentSlide();
  const template = createTemplateDefinition(type);
  slide.background = template.background;
  slide.elements = template.elements.map((element, index) => normalizeElement({ ...element, z: index + 1 }, index));
  state.selectedElementId = null;
  renderAll();
  markDirty('Застосовано макет');
}

function findElementById(elementId) {
  const slide = getCurrentSlide();
  if (!slide) return null;
  return slide.elements.find(element => element.id === elementId) || null;
}

function setSelectedTextStyle(partial) {
  const selected = getSelectedElement();
  if (!selected || selected.type !== 'text') return;
  pushHistory();
  Object.assign(selected.style, partial);
  renderStage();
  renderToolbarState();
  renderSlideList();
  markDirty('Формат тексту змінено');
}

function toggleTextStyle(key) {
  const selected = getSelectedElement();
  if (!selected || selected.type !== 'text') return;
  setSelectedTextStyle({ [key]: !selected.style[key] });
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

  const selected = getSelectedElement();
  if (!selected) return;
  pushHistory();
  if (state.currentColorTarget === 'text' && selected.type === 'text') selected.style.color = color;
  if (state.currentColorTarget === 'fill' && selected.type === 'shape') selected.style.fill = color;
  if (state.currentColorTarget === 'stroke' && selected.type === 'shape') selected.style.stroke = color;
  renderStage();
  renderSlideList();
  renderToolbarState();
  renderColorModeButtons();
  markDirty('Колір змінено');
}

function rotateSelected(delta) {
  const selected = getSelectedElement();
  if (!selected) return;
  pushHistory();
  selected.rotation = (((selected.rotation || 0) + delta) % 360 + 360) % 360;
  renderStage();
  renderSlideList();
  markDirty('Об’єкт повернуто');
}

function bringSelectedToFront() {
  const selected = getSelectedElement();
  if (!selected) return;
  pushHistory();
  const slide = getCurrentSlide();
  selected.z = slide.elements.length + 1;
  normalizeZIndexes();
  renderAll();
  markDirty('Змінено шар');
}

function sendSelectedToBack() {
  const selected = getSelectedElement();
  if (!selected) return;
  pushHistory();
  selected.z = 0;
  normalizeZIndexes();
  renderAll();
  markDirty('Змінено шар');
}

function copySelectedElement() {
  const selected = getSelectedElement();
  if (!selected) return;
  state.clipboard = deepClone(selected);
  setStatusRight('Об’єкт скопійовано');
}

function pasteElement() {
  if (!state.clipboard) return;
  pushHistory();
  const slide = getCurrentSlide();
  const copy = normalizeElement({
    ...deepClone(state.clipboard),
    id: null,
    x: clamp(state.clipboard.x + 24, 0, STAGE_WIDTH - state.clipboard.w),
    y: clamp(state.clipboard.y + 24, 0, STAGE_HEIGHT - state.clipboard.h),
    z: slide.elements.length + 1
  }, slide.elements.length);
  slide.elements.push(copy);
  state.selectedElementId = copy.id;
  renderAll();
  markDirty('Об’єкт вставлено');
}

function duplicateSelectedElement() {
  copySelectedElement();
  pasteElement();
}

function deleteSelectedElement() {
  const selected = getSelectedElement();
  if (!selected) return;
  pushHistory();
  const slide = getCurrentSlide();
  slide.elements = slide.elements.filter(element => element.id !== selected.id);
  state.selectedElementId = null;
  normalizeZIndexes();
  renderAll();
  markDirty('Об’єкт видалено');
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

function showModal({ title, text = '', body = '', confirmText = 'Гаразд', cancelText = 'Скасувати', icon = 'fa-solid fa-circle-info', onConfirm = null, onMount = null, showCancel = true }) {
  showModalUi(dom, { title, text, body, confirmText, cancelText, icon, onConfirm, onMount, showCancel });
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

