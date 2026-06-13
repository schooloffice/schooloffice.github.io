import { DEFAULT_SHAPE_STYLE, FONT_FAMILY_CSS, STAGE_HEIGHT, STAGE_WIDTH } from './constants.js';
import { captureState, commitState } from './history.js';
import { getCurrentSlide, isSelected, state } from './state.js';
import { createTextContainer, getTextFromTextContainer, setTextContainerContent, splitListItemAtSelection } from './text-list.js';

export function renderStage({
  elementDomMap,
  markDirty,
  onElementPointerDown,
  onHandlePointerDown,
  onRotateHandlePointerDown,
  onCropHandlePointerDown,
  renderSlideList,
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
      renderSlideList,
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

  if (element.type === 'image') {
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
  }

  wrap.appendChild(content);
  wrap.appendChild(createHandles(element.id, handlers.onHandlePointerDown, handlers.onRotateHandlePointerDown));
  wrap.addEventListener('pointerdown', event => handlers.onElementPointerDown(event, element.id));
  return wrap;
}

function createTextNode(element, { markDirty, renderSlideList, selectElement }) {
  const textBox = createTextContainer(element.style.listType);
  textBox.className = 'text-element';
  textBox.contentEditable = 'true';
  textBox.spellcheck = false;
  setTextContainerContent(textBox, element.content, element.style.listType);
  applyTextStylesToNode(textBox, element);
  // Безперервне введення тексту коаліс­уємо в один крок історії. Пре-стан
  // захоплюємо на focus — ДО очищення плейсхолдера, — а записуємо лише на
  // першій реальній зміні, щоб undo повертав саме початковий стан поля.
  let pendingSnapshot = null;
  textBox.addEventListener('pointerdown', event => {
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
    renderSlideList();
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
      renderSlideList();
      markDirty('Поле очищено');
    }
  });
  return textBox;
}

function createShapeNode(element) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('width', '100%');
  svg.setAttribute('height', '100%');
  svg.setAttribute('viewBox', '0 0 100 100');
  svg.setAttribute('class', 'shape-element');
  let shape;
  if (element.shape === 'circle') {
    shape = document.createElementNS('http://www.w3.org/2000/svg', 'ellipse');
    shape.setAttribute('cx', '50%');
    shape.setAttribute('cy', '50%');
    shape.setAttribute('rx', '48%');
    shape.setAttribute('ry', '48%');
  } else if (element.shape === 'triangle') {
    shape = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
    shape.setAttribute('points', '50,4 96,96 4,96');
  } else {
    shape = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    shape.setAttribute('x', '2%');
    shape.setAttribute('y', '2%');
    shape.setAttribute('width', '96%');
    shape.setAttribute('height', '96%');
    shape.setAttribute('rx', '12');
    shape.setAttribute('ry', '12');
  }
  shape.setAttribute('fill', element.style.fill || DEFAULT_SHAPE_STYLE.fill);
  shape.setAttribute('stroke', element.style.stroke || DEFAULT_SHAPE_STYLE.stroke);
  shape.setAttribute('stroke-width', '8');
  svg.appendChild(shape);
  return svg;
}

function createHandles(elementId, onHandlePointerDown, onRotateHandlePointerDown) {
  const handles = document.createElement('div');
  handles.className = 'resize-handles';
  ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'].forEach(handleName => {
    const handle = document.createElement('div');
    handle.className = `resize-handle ${handleName}`;
    handle.dataset.handle = handleName;
    handle.addEventListener('pointerdown', event => onHandlePointerDown(event, elementId, handleName));
    handles.appendChild(handle);
  });
  if (onRotateHandlePointerDown) {
    const rotate = document.createElement('div');
    rotate.className = 'rotate-handle';
    rotate.dataset.handle = 'rotate';
    rotate.title = 'Перетягни, щоб повернути';
    rotate.addEventListener('pointerdown', event => onRotateHandlePointerDown(event, elementId));
    handles.appendChild(rotate);
  }
  return handles;
}

// Кадрування у просторі рамки: вікно показує підпрямокутник, а зображення
// всередині лишається розміром у повну рамку й зсувається — тож обрізаються краї.
function getCrop(element) {
  const c = element.crop || {};
  return {
    l: Number.isFinite(c.l) ? c.l : 0,
    t: Number.isFinite(c.t) ? c.t : 0,
    r: Number.isFinite(c.r) ? c.r : 0,
    b: Number.isFinite(c.b) ? c.b : 0
  };
}

function setCropGeometry(win, img, element) {
  const { l, t, r, b } = getCrop(element);
  const visW = Math.max(0.0001, 1 - l - r);
  const visH = Math.max(0.0001, 1 - t - b);
  win.style.left = `${l * 100}%`;
  win.style.top = `${t * 100}%`;
  win.style.width = `${visW * 100}%`;
  win.style.height = `${visH * 100}%`;
  img.style.width = `${(1 / visW) * 100}%`;
  img.style.height = `${(1 / visH) * 100}%`;
  img.style.left = `${-(l / visW) * 100}%`;
  img.style.top = `${-(t / visH) * 100}%`;
}

const CROP_HANDLES = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];

function cropHandlePosition(name, crop) {
  const { l, t, r, b } = crop;
  const left = name.includes('w') ? l : (name.includes('e') ? 1 - r : (l + (1 - r)) / 2);
  const top = name.includes('n') ? t : (name.includes('s') ? 1 - b : (t + (1 - b)) / 2);
  return { left, top };
}

function positionCropHandles(handles, element) {
  const crop = getCrop(element);
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
  node.style.fontSize = `${element.style.fontSize || 28}px`;
  node.style.color = element.isPlaceholder ? (element.style.color || '#94a3b8') : (element.style.color || '#111827');
  // Звичайний текст — нормальної ваги (400), жирний — 700 (раніше все було 700+).
  node.style.fontWeight = element.style.bold ? '700' : '400';
  node.style.fontFamily = FONT_FAMILY_CSS[element.style.fontFamily] || 'inherit';
  node.style.lineHeight = String(element.style.lineHeight || 1.15);
  node.style.fontStyle = element.isPlaceholder ? 'normal' : (element.style.italic ? 'italic' : 'normal');
  node.style.textDecoration = element.isPlaceholder ? 'none' : (element.style.underline ? 'underline' : 'none');
  node.style.textAlign = element.style.align || 'left';
  node.classList.toggle('is-placeholder', !!element.isPlaceholder);
}

export function syncSelectionUi(elementDomMap) {
  const single = state.selectedElementIds.length === 1;
  elementDomMap.forEach((node, id) => {
    const selected = isSelected(id);
    node.classList.toggle('selected', selected);
    node.classList.toggle('single-selected', selected && single);
  });
}
