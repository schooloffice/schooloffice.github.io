import { STAGE_HEIGHT, STAGE_WIDTH } from './constants.js';
import { pushHistory } from './history.js';
import { getCurrentSlide } from './state.js';
import { clamp } from './utils.js';

const pointer = {
  mode: 'none', // 'drag' | 'resize' | 'marquee'
  pointerId: null,
  committed: false,
  // груповий drag
  dragStartX: 0,
  dragStartY: 0,
  dragElements: [],
  dragMinX: 0,
  dragMaxRight: 0,
  dragMinY: 0,
  dragMaxBottom: 0,
  dragLeadNode: null,
  // resize (лише одиничний)
  resizeId: null,
  handle: null,
  startX: 0,
  startY: 0,
  startBox: null,
  // рамка вибору
  marqueeEl: null,
  marqueeStart: null,
  marqueeAdditive: false,
  marqueeBase: [],
  marqueeMoved: false
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

function resetPointer() {
  pointer.mode = 'none';
  pointer.pointerId = null;
  pointer.committed = false;
  pointer.dragElements = [];
  pointer.dragLeadNode = null;
  pointer.resizeId = null;
  pointer.handle = null;
  pointer.startBox = null;
  pointer.marqueeEl = null;
  pointer.marqueeStart = null;
  pointer.marqueeAdditive = false;
  pointer.marqueeBase = [];
  pointer.marqueeMoved = false;
}

export function onElementPointerDown(event, elementId, { elementDomMap, findElementById, selectElement, isSelected, getSelectedElements, stage }) {
  if (event.target.closest('.text-element')) return;
  event.preventDefault();
  event.stopPropagation();

  const element = findElementById(elementId);
  const node = elementDomMap.get(elementId);
  if (!element || !node) return;

  // Shift-клік лише перемикає елемент у вибірці й не починає перетягування.
  if (event.shiftKey) {
    selectElement(elementId, true);
    return;
  }
  // Звичайний клік по невибраному — обираємо лише його; по вибраному —
  // зберігаємо поточний мультивибір (щоб тягнути групу).
  if (!isSelected(elementId)) selectElement(elementId, false);

  const point = getStagePoint(stage, event.clientX, event.clientY);
  const selected = getSelectedElements();
  pointer.mode = 'drag';
  pointer.pointerId = event.pointerId;
  pointer.committed = false;
  pointer.dragStartX = point.x;
  pointer.dragStartY = point.y;
  pointer.dragElements = selected.map(el => ({ id: el.id, startX: el.x, startY: el.y, w: el.w, h: el.h }));
  pointer.dragMinX = Math.min(...pointer.dragElements.map(d => d.startX));
  pointer.dragMaxRight = Math.max(...pointer.dragElements.map(d => d.startX + d.w));
  pointer.dragMinY = Math.min(...pointer.dragElements.map(d => d.startY));
  pointer.dragMaxBottom = Math.max(...pointer.dragElements.map(d => d.startY + d.h));
  pointer.dragLeadNode = node;
  node.classList.add('dragging');
  try { node.setPointerCapture(event.pointerId); } catch { /* synthetic/unsupported pointer */ }
}

export function onHandlePointerDown(event, elementId, handle, { elementDomMap, findElementById, selectElement, stage }) {
  event.preventDefault();
  event.stopPropagation();

  const element = findElementById(elementId);
  if (!element) return;

  selectElement(elementId);

  const point = getStagePoint(stage, event.clientX, event.clientY);
  pointer.mode = 'resize';
  pointer.resizeId = elementId;
  pointer.handle = handle;
  pointer.pointerId = event.pointerId;
  pointer.startX = point.x;
  pointer.startY = point.y;
  pointer.startBox = { x: element.x, y: element.y, w: element.w, h: element.h };
  pointer.committed = false;

  const node = elementDomMap.get(elementId);
  try { node?.setPointerCapture(event.pointerId); } catch { /* synthetic/unsupported pointer */ }
}

export function onStageBackgroundPointerDown(event, { stage, getSelectionIds }) {
  event.preventDefault();
  const point = getStagePoint(stage, event.clientX, event.clientY);
  pointer.mode = 'marquee';
  pointer.pointerId = event.pointerId;
  pointer.marqueeStart = point;
  pointer.marqueeAdditive = event.shiftKey;
  pointer.marqueeBase = event.shiftKey ? [...getSelectionIds()] : [];
  pointer.marqueeMoved = false;

  const div = document.createElement('div');
  div.className = 'selection-marquee';
  div.style.left = `${point.x}px`;
  div.style.top = `${point.y}px`;
  div.style.width = '0px';
  div.style.height = '0px';
  stage.appendChild(div);
  pointer.marqueeEl = div;
  try { stage.setPointerCapture(event.pointerId); } catch { /* ignore */ }
}

export function bindStage(stage, { onStageBackgroundPointerDown: onBgDown, onStagePointerMove, onStagePointerUp }) {
  stage.addEventListener('pointerdown', event => {
    if (event.target === stage) onBgDown(event);
  });
  stage.addEventListener('pointermove', onStagePointerMove);
  stage.addEventListener('pointerup', onStagePointerUp);
  stage.addEventListener('pointercancel', onStagePointerUp);
}

export function onStagePointerMove(event, { elementDomMap, findElementById, stage }) {
  if (pointer.mode === 'none' || pointer.pointerId !== event.pointerId) return;
  const point = getStagePoint(stage, event.clientX, event.clientY);

  if (pointer.mode === 'marquee') {
    const start = pointer.marqueeStart;
    const left = Math.min(start.x, point.x);
    const top = Math.min(start.y, point.y);
    const w = Math.abs(point.x - start.x);
    const h = Math.abs(point.y - start.y);
    if (w > 3 || h > 3) pointer.marqueeMoved = true;
    const node = pointer.marqueeEl;
    if (node) {
      node.style.left = `${left}px`;
      node.style.top = `${top}px`;
      node.style.width = `${w}px`;
      node.style.height = `${h}px`;
    }
    return;
  }

  if (pointer.mode === 'drag') {
    const dx = clamp(point.x - pointer.dragStartX, -pointer.dragMinX, STAGE_WIDTH - pointer.dragMaxRight);
    const dy = clamp(point.y - pointer.dragStartY, -pointer.dragMinY, STAGE_HEIGHT - pointer.dragMaxBottom);
    const changed = pointer.dragElements.some(d => {
      const el = findElementById(d.id);
      return el && (d.startX + dx !== el.x || d.startY + dy !== el.y);
    });
    if (!changed) return;
    commitOnce();
    pointer.dragElements.forEach(d => {
      const el = findElementById(d.id);
      const node = elementDomMap.get(d.id);
      if (!el || !node) return;
      el.x = d.startX + dx;
      el.y = d.startY + dy;
      node.style.left = `${el.x}px`;
      node.style.top = `${el.y}px`;
    });
    return;
  }

  if (pointer.mode === 'resize' && pointer.startBox) {
    const element = findElementById(pointer.resizeId);
    const node = elementDomMap.get(pointer.resizeId);
    if (!element || !node) return;
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

export function onStagePointerUp(event, { elementDomMap, markDirty, renderSlideList, setSelection, getCurrentElements, stage }) {
  if (pointer.mode === 'none' || pointer.pointerId !== event.pointerId) return;

  if (pointer.mode === 'marquee') {
    const start = pointer.marqueeStart;
    const point = getStagePoint(stage, event.clientX, event.clientY);
    const rect = {
      x1: Math.min(start.x, point.x),
      y1: Math.min(start.y, point.y),
      x2: Math.max(start.x, point.x),
      y2: Math.max(start.y, point.y)
    };
    pointer.marqueeEl?.remove();
    const moved = pointer.marqueeMoved;
    const additive = pointer.marqueeAdditive;
    const base = pointer.marqueeBase;
    resetPointer();
    if (!moved) {
      if (!additive) setSelection([]);
      return;
    }
    const hits = getCurrentElements().filter(el => rectsIntersect(rect, el)).map(el => el.id);
    setSelection(additive ? [...base, ...hits] : hits);
    return;
  }

  // drag / resize
  pointer.dragLeadNode?.classList.remove('dragging');
  const changed = pointer.committed;
  resetPointer();
  if (!changed) return;
  normalizeZIndexes();
  renderSlideList();
  markDirty('Положення змінено');
}

function rectsIntersect(rect, element) {
  const ex2 = element.x + element.w;
  const ey2 = element.y + element.h;
  return element.x < rect.x2 && ex2 > rect.x1 && element.y < rect.y2 && ey2 > rect.y1;
}

function commitOnce() {
  if (pointer.committed) return;
  pushHistory();
  pointer.committed = true;
}

export function normalizeZIndexes() {
  const slide = getCurrentSlide();
  if (!slide) return;
  slide.elements
    .sort((a, b) => (a.z || 1) - (b.z || 1))
    .forEach((element, index) => { element.z = index + 1; });
}
