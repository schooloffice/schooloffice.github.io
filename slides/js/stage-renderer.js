import { LINE_SHAPE_TYPES, STAGE_HEIGHT, STAGE_WIDTH, TEXT_SHAPE_TYPES } from './constants.js';
import { appendShapeGraphic, applyTextVisualStyles } from './element-rendering.js';
import { captureState, commitState } from './history.js';
import { getCropFractions, getCropGeometry } from './image-geometry.js';
import { getCurrentSlide, isSelected, state } from './state.js';
import { createTextContainer, getTextFromTextContainer, setTextContainerContent, splitListItemAtSelection } from './text-list.js';

export function renderStage({
  elementDomMap,
  markDirty,
  onElementPointerDown,
  onHandlePointerDown,
  onRotateHandlePointerDown,
  onCropHandlePointerDown,
  onImagePlaceholderActivate,
  renderCurrentSlideThumbnail,
  selectElement,
  stage
}) {
  stage.innerHTML = '';
  elementDomMap.clear();
  const slide = getCurrentSlide();
  if (!slide) return;

  stage.style.background = slide.background || '#ffffff';
  stage.dataset.baseWidth = String(STAGE_WIDTH);
  stage.dataset.baseHeight = String(STAGE_HEIGHT);

  const sorted = [...slide.elements].sort((a, b) => (a.z || 1) - (b.z || 1));
  sorted.forEach(element => {
    const node = renderElementNode(element, {
      markDirty,
      onElementPointerDown,
      onHandlePointerDown,
      onRotateHandlePointerDown,
      onCropHandlePointerDown,
      onImagePlaceholderActivate,
      renderCurrentSlideThumbnail,
      selectElement
    });
    elementDomMap.set(element.id, node);
    stage.appendChild(node);
  });

  syncSelectionUi(elementDomMap);
}

function renderElementNode(element, handlers) {
  const wrap = document.createElement('div');
  const selected = isSelected(element.id);
  const single = selected && state.selectedElementIds.length === 1;
  wrap.className = `stage-element${selected ? ' selected' : ''}${single ? ' single-selected' : ''}`;
  wrap.dataset.id = element.id;
  wrap.style.left = `${element.x}px`;
  wrap.style.top = `${element.y}px`;
  wrap.style.width = `${element.w}px`;
  wrap.style.height = `${element.h}px`;
  wrap.style.zIndex = String(element.z || 1);
  wrap.style.transform = `rotate(${element.rotation || 0}deg)`;

  const content = document.createElement('div');
  content.className = 'element-content';

  if (element.type === 'text') {
    content.appendChild(createTextNode(element, handlers));
  }

  if (element.type === 'image' && (element.isPlaceholder || !element.content)) {
    // Порожній image-слот макета: пунктирна рамка з підказкою «Додати зображення».
    // Заповнюється через «Замінити зображення» (елемент є image) або подвійним кліком.
    const box = document.createElement('div');
    box.className = 'image-placeholder';
    box.innerHTML = '<i class="fa-regular fa-image"></i><span>Додати зображення</span>';
    box.addEventListener('dblclick', event => {
      event.stopPropagation();
      handlers.selectElement(element.id);
      handlers.onImagePlaceholderActivate?.(element.id);
    });
    content.appendChild(box);
  } else if (element.type === 'image') {
    const cropping = state.cropElementId === element.id;
    if (cropping) {
      content.classList.add('cropping');
      // «Привид» — повне зображення приглушено, щоб бачити, що обрізається.
      const ghost = document.createElement('img');
      ghost.className = 'crop-ghost';
      ghost.src = element.content;
      ghost.alt = '';
      ghost.draggable = false;
      ghost.style.objectFit = element.style?.objectFit || 'cover';
      content.appendChild(ghost);
    }
    const win = document.createElement('div');
    win.className = 'crop-window';
    const img = document.createElement('img');
    img.className = 'image-element';
    img.src = element.content;
    img.alt = element.alt || '';
    img.draggable = false;
    img.style.objectFit = element.style?.objectFit || 'cover';
    img.style.opacity = String(element.style?.opacity ?? 1);
    win.appendChild(img);
    content.appendChild(win);
    setCropGeometry(win, img, element);
    if (cropping) {
      wrap.dataset.cropping = 'true';
      content.appendChild(createCropHandles(element, handlers.onCropHandlePointerDown));
    }
  }

  if (element.type === 'shape') {
    content.appendChild(createShapeNode(element));
    if (TEXT_SHAPE_TYPES.includes(element.shape)) {
      content.appendChild(createTextNode(element, handlers, { shapeText: true }));
    }
  }

  wrap.appendChild(content);
  wrap.appendChild(createHandles(element, handlers.onHandlePointerDown, handlers.onRotateHandlePointerDown));
  wrap.addEventListener('pointerdown', event => handlers.onElementPointerDown(event, element.id));
  return wrap;
}

function createTextNode(element, { markDirty, renderCurrentSlideThumbnail, selectElement }, { shapeText = false } = {}) {
  const textBox = createTextContainer(element.style.listType);
  textBox.className = `text-element${shapeText ? ' shape-text-element' : ''}`;
  textBox.contentEditable = shapeText ? 'false' : 'true';
  textBox.spellcheck = false;
  setTextContainerContent(textBox, element.content, element.style.listType);
  applyTextStylesToNode(textBox, element);
  // Безперервне введення тексту коаліс­уємо в один крок історії. Пре-стан
  // захоплюємо на focus — ДО очищення плейсхолдера, — а записуємо лише на
  // першій реальній зміні, щоб undo повертав саме початковий стан поля.
  let pendingSnapshot = null;
  const beginShapeTextEditing = event => {
    event.preventDefault();
    event.stopPropagation();
    selectElement(element.id);
    textBox.contentEditable = 'true';
    textBox.focus();
  };
  textBox.addEventListener('pointerdown', event => {
    if (shapeText && textBox.contentEditable !== 'true') {
      if (event.detail >= 2) beginShapeTextEditing(event);
      return;
    }
    event.stopPropagation();
    // Shift-клік додає/прибирає текстовий блок з мультивибору, не входячи в
    // редагування.
    if (event.shiftKey) {
      event.preventDefault();
      selectElement(element.id, true);
      return;
    }
    selectElement(element.id);
  });
  if (shapeText) {
    textBox.addEventListener('dblclick', beginShapeTextEditing);
  }
  textBox.addEventListener('focus', () => {
    pendingSnapshot = captureState();
    selectElement(element.id);
    if (element.isPlaceholder) {
      element.content = '';
      element.isPlaceholder = false;
      setTextContainerContent(textBox, '', element.style.listType);
      applyTextStylesToNode(textBox, element);
    }
  });
  const syncTextContent = () => {
    if (pendingSnapshot) {
      commitState(pendingSnapshot);
      pendingSnapshot = null;
    }
    const value = getTextFromTextContainer(textBox, element.style.listType);
    element.content = value;
    element.isPlaceholder = false;
    markDirty('Текст змінено');
    renderCurrentSlideThumbnail();
  };
  textBox.addEventListener('keydown', event => {
    if (element.style.listType === 'none' || event.key !== 'Enter' || event.shiftKey) return;
    if (!splitListItemAtSelection(textBox)) return;
    event.preventDefault();
    syncTextContent();
  });
  textBox.addEventListener('input', syncTextContent);
  textBox.addEventListener('blur', () => {
    const value = getTextFromTextContainer(textBox, element.style.listType).trim();
    if (!value && element.placeholder) {
      element.content = element.placeholder;
      element.isPlaceholder = true;
      setTextContainerContent(textBox, element.placeholder, element.style.listType);
      applyTextStylesToNode(textBox, element);
      renderCurrentSlideThumbnail();
      markDirty('Поле очищено');
    }
  });
  if (shapeText) textBox.addEventListener('blur', () => { textBox.contentEditable = 'false'; });
  return textBox;
}

function createShapeNode(element) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('width', '100%');
  svg.setAttribute('height', '100%');
  svg.setAttribute('viewBox', '0 0 100 100');
  svg.setAttribute('class', 'shape-element');
  appendShapeGraphic(svg, element);
  return svg;
}

function createHandles(element, onHandlePointerDown, onRotateHandlePointerDown) {
  const handles = document.createElement('div');
  handles.className = 'resize-handles';
  const handleNames = element.type === 'shape' && LINE_SHAPE_TYPES.includes(element.shape)
    ? ['e', 'w']
    : ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];
  handleNames.forEach(handleName => {
    const handle = document.createElement('div');
    handle.className = `resize-handle ${handleName}`;
    handle.dataset.handle = handleName;
    handle.addEventListener('pointerdown', event => onHandlePointerDown(event, element.id, handleName));
    handles.appendChild(handle);
  });
  if (onRotateHandlePointerDown) {
    const rotate = document.createElement('div');
    rotate.className = 'rotate-handle';
    rotate.dataset.handle = 'rotate';
    rotate.title = 'Перетягни, щоб повернути';
    rotate.addEventListener('pointerdown', event => onRotateHandlePointerDown(event, element.id));
    handles.appendChild(rotate);
  }
  return handles;
}

// Кадрування у просторі рамки: вікно показує підпрямокутник, а зображення
// всередині лишається розміром у повну рамку й зсувається — тож обрізаються краї.
function setCropGeometry(win, img, element) {
  const crop = getCropGeometry(element.crop);
  const { l, t } = crop;
  win.style.left = `${l * 100}%`;
  win.style.top = `${t * 100}%`;
  win.style.width = `${crop.visibleWidth * 100}%`;
  win.style.height = `${crop.visibleHeight * 100}%`;
  img.style.width = `${crop.imageWidth * 100}%`;
  img.style.height = `${crop.imageHeight * 100}%`;
  img.style.left = `${crop.imageLeft * 100}%`;
  img.style.top = `${crop.imageTop * 100}%`;
}

const CROP_HANDLES = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];

function cropHandlePosition(name, crop) {
  const { l, t, r, b } = crop;
  const left = name.includes('w') ? l : (name.includes('e') ? 1 - r : (l + (1 - r)) / 2);
  const top = name.includes('n') ? t : (name.includes('s') ? 1 - b : (t + (1 - b)) / 2);
  return { left, top };
}

function positionCropHandles(handles, element) {
  const crop = getCropFractions(element.crop);
  handles.querySelectorAll('.crop-handle').forEach(handle => {
    const { left, top } = cropHandlePosition(handle.dataset.handle, crop);
    handle.style.left = `${left * 100}%`;
    handle.style.top = `${top * 100}%`;
  });
}

function createCropHandles(element, onCropHandlePointerDown) {
  const handles = document.createElement('div');
  handles.className = 'crop-handles';
  CROP_HANDLES.forEach(name => {
    const handle = document.createElement('div');
    handle.className = `crop-handle ${name}`;
    handle.dataset.handle = name;
    if (onCropHandlePointerDown) {
      handle.addEventListener('pointerdown', event => onCropHandlePointerDown(event, element.id, name));
    }
    handles.appendChild(handle);
  });
  positionCropHandles(handles, element);
  return handles;
}

// Жива синхронізація DOM під час перетягування crop-ручки (без перебудови вузла).
export function applyImageCropToNode(node, element) {
  const win = node.querySelector('.crop-window');
  const img = win?.querySelector('.image-element');
  if (win && img) setCropGeometry(win, img, element);
  const handles = node.querySelector('.crop-handles');
  if (handles) positionCropHandles(handles, element);
}

function applyTextStylesToNode(node, element) {
  applyTextVisualStyles(node, element);
}

export function syncSelectionUi(elementDomMap) {
  const single = state.selectedElementIds.length === 1;
  elementDomMap.forEach((node, id) => {
    const selected = isSelected(id);
    node.classList.toggle('selected', selected);
    node.classList.toggle('single-selected', selected && single);
  });
}
