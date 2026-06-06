import { DEFAULT_SHAPE_STYLE, STAGE_HEIGHT, STAGE_WIDTH } from './constants.js';
import { getCurrentSlide, state } from './state.js';
import { getTextFromContentEditable } from './utils.js';

export function renderStage({
  elementDomMap,
  markDirty,
  onElementPointerDown,
  onHandlePointerDown,
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
  wrap.className = `stage-element${element.id === state.selectedElementId ? ' selected' : ''}`;
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
    const img = document.createElement('img');
    img.className = 'image-element';
    img.src = element.content;
    img.alt = '';
    img.draggable = false;
    content.appendChild(img);
  }

  if (element.type === 'shape') {
    content.appendChild(createShapeNode(element));
  }

  wrap.appendChild(content);
  wrap.appendChild(createHandles(element.id, handlers.onHandlePointerDown));
  wrap.addEventListener('pointerdown', event => handlers.onElementPointerDown(event, element.id));
  return wrap;
}

function createTextNode(element, { markDirty, renderSlideList, selectElement }) {
  const textBox = document.createElement('div');
  textBox.className = 'text-element';
  textBox.contentEditable = 'true';
  textBox.spellcheck = false;
  textBox.textContent = element.content || '';
  applyTextStylesToNode(textBox, element);
  textBox.addEventListener('pointerdown', event => {
    event.stopPropagation();
    selectElement(element.id);
  });
  textBox.addEventListener('focus', () => {
    selectElement(element.id);
    if (element.isPlaceholder) {
      element.content = '';
      element.isPlaceholder = false;
      textBox.textContent = '';
      applyTextStylesToNode(textBox, element);
    }
  });
  textBox.addEventListener('input', () => {
    const value = getTextFromContentEditable(textBox);
    element.content = value;
    element.isPlaceholder = false;
    markDirty('Текст змінено');
    renderSlideList();
  });
  textBox.addEventListener('blur', () => {
    const value = getTextFromContentEditable(textBox).trim();
    if (!value && element.placeholder) {
      element.content = element.placeholder;
      element.isPlaceholder = true;
      textBox.textContent = element.placeholder;
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

function createHandles(elementId, onHandlePointerDown) {
  const handles = document.createElement('div');
  handles.className = 'resize-handles';
  ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'].forEach(handleName => {
    const handle = document.createElement('div');
    handle.className = `resize-handle ${handleName}`;
    handle.dataset.handle = handleName;
    handle.addEventListener('pointerdown', event => onHandlePointerDown(event, elementId, handleName));
    handles.appendChild(handle);
  });
  return handles;
}

function applyTextStylesToNode(node, element) {
  node.style.fontSize = `${element.style.fontSize || 28}px`;
  node.style.color = element.isPlaceholder ? (element.style.color || '#94a3b8') : (element.style.color || '#111827');
  node.style.fontWeight = element.style.bold ? '900' : '700';
  node.style.fontStyle = element.isPlaceholder ? 'normal' : (element.style.italic ? 'italic' : 'normal');
  node.style.textDecoration = element.isPlaceholder ? 'none' : (element.style.underline ? 'underline' : 'none');
  node.style.textAlign = element.style.align || 'left';
  node.classList.toggle('is-placeholder', !!element.isPlaceholder);
}

export function syncSelectionUi(elementDomMap) {
  elementDomMap.forEach((node, id) => {
    node.classList.toggle('selected', id === state.selectedElementId);
  });
}
