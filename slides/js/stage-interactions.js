import { STAGE_HEIGHT, STAGE_WIDTH } from './constants.js';
import { pushHistory } from './history.js';
import { getCurrentSlide } from './state.js';
import { clamp } from './utils.js';

const pointer = {
  mode: 'none',
  elementId: null,
  handle: null,
  pointerId: null,
  startX: 0,
  startY: 0,
  dragOffsetX: 0,
  dragOffsetY: 0,
  startBox: null,
  committed: false
};

export function getStagePoint(stage, clientX, clientY) {
  const rect = stage.getBoundingClientRect();
  const scaleX = STAGE_WIDTH / rect.width;
  const scaleY = STAGE_HEIGHT / rect.height;
  return {
    x: (clientX - rect.left) * scaleX,
    y: (clientY - rect.top) * scaleY
  };
}

export function onElementPointerDown(event, elementId, { elementDomMap, findElementById, selectElement, stage }) {
  if (event.target.closest('.text-element')) return;
  event.preventDefault();
  event.stopPropagation();

  const element = findElementById(elementId);
  const node = elementDomMap.get(elementId);
  if (!element || !node) return;

  selectElement(elementId);

  const point = getStagePoint(stage, event.clientX, event.clientY);
  pointer.mode = 'drag';
  pointer.elementId = elementId;
  pointer.pointerId = event.pointerId;
  pointer.dragOffsetX = point.x - element.x;
  pointer.dragOffsetY = point.y - element.y;
  pointer.committed = false;
  node.classList.add('dragging');
  node.setPointerCapture(event.pointerId);
}

export function onHandlePointerDown(event, elementId, handle, { elementDomMap, findElementById, selectElement, stage }) {
  event.preventDefault();
  event.stopPropagation();

  const element = findElementById(elementId);
  if (!element) return;

  selectElement(elementId);

  const point = getStagePoint(stage, event.clientX, event.clientY);
  pointer.mode = 'resize';
  pointer.elementId = elementId;
  pointer.handle = handle;
  pointer.pointerId = event.pointerId;
  pointer.startX = point.x;
  pointer.startY = point.y;
  pointer.startBox = { x: element.x, y: element.y, w: element.w, h: element.h };
  pointer.committed = false;

  const node = elementDomMap.get(elementId);
  node?.setPointerCapture(event.pointerId);
}

export function bindStage(stage, { clearSelection, onStagePointerMove, onStagePointerUp }) {
  stage.addEventListener('pointerdown', event => {
    if (event.target === stage) clearSelection();
  });

  stage.addEventListener('pointermove', onStagePointerMove);
  stage.addEventListener('pointerup', onStagePointerUp);
  stage.addEventListener('pointercancel', onStagePointerUp);
}

export function onStagePointerMove(event, { elementDomMap, findElementById, stage }) {
  if (pointer.mode === 'none' || pointer.pointerId !== event.pointerId) return;
  const element = findElementById(pointer.elementId);
  const node = elementDomMap.get(pointer.elementId);
  if (!element || !node) return;

  const point = getStagePoint(stage, event.clientX, event.clientY);

  if (pointer.mode === 'drag') {
    const nextX = clamp(point.x - pointer.dragOffsetX, 0, STAGE_WIDTH - element.w);
    const nextY = clamp(point.y - pointer.dragOffsetY, 0, STAGE_HEIGHT - element.h);
    if (nextX === element.x && nextY === element.y) return;
    commitOnce();
    element.x = nextX;
    element.y = nextY;
    node.style.left = `${element.x}px`;
    node.style.top = `${element.y}px`;
    return;
  }

  if (pointer.mode === 'resize' && pointer.startBox) {
    const dx = point.x - pointer.startX;
    const dy = point.y - pointer.startY;
    let { x, y, w, h } = pointer.startBox;
    const handle = pointer.handle;
    const has = symbol => handle.includes(symbol);

    if (has('e')) w += dx;
    if (has('s')) h += dy;
    if (has('w')) { x += dx; w -= dx; }
    if (has('n')) { y += dy; h -= dy; }

    w = Math.max(40, w);
    h = Math.max(30, h);
    x = clamp(x, 0, STAGE_WIDTH - w);
    y = clamp(y, 0, STAGE_HEIGHT - h);

    if (x === element.x && y === element.y && w === element.w && h === element.h) return;
    commitOnce();
    element.x = x;
    element.y = y;
    element.w = w;
    element.h = h;

    node.style.left = `${x}px`;
    node.style.top = `${y}px`;
    node.style.width = `${w}px`;
    node.style.height = `${h}px`;
  }
}

export function onStagePointerUp(event, { elementDomMap, markDirty, renderSlideList }) {
  if (pointer.mode === 'none' || pointer.pointerId !== event.pointerId) return;
  const node = elementDomMap.get(pointer.elementId);
  node?.classList.remove('dragging');
  const changed = pointer.committed;
  pointer.mode = 'none';
  pointer.elementId = null;
  pointer.handle = null;
  pointer.pointerId = null;
  pointer.startBox = null;
  pointer.committed = false;
  if (!changed) return;
  normalizeZIndexes();
  renderSlideList();
  markDirty('Положення змінено');
}

function commitOnce() {
  if (pointer.committed) return;
  pushHistory();
  pointer.committed = true;
}

function normalizeZIndexes() {
  const slide = getCurrentSlide();
  if (!slide) return;
  slide.elements
    .sort((a, b) => (a.z || 1) - (b.z || 1))
    .forEach((element, index) => { element.z = index + 1; });
}
