import { STAGE_HEIGHT, STAGE_WIDTH } from './constants.js';
import { pushHistory } from './history.js';
import { getCurrentSlide, state } from './state.js';
import { clamp } from './utils.js';

const SNAP_SCREEN_PX = 6; // сталий поріг в ЕКРАННИХ px (переводиться в логічні через масштаб)
const GRID_STEP = 10;
let activeGuides = [];

// Осесумісна обгортка (AABB) елемента з урахуванням rotation — щоб напрямні
// збігалися з ВИДИМИМИ краями повернутого об'єкта, а не з x/y/w/h.
export function elementBounds(el) {
  const cx = el.x + el.w / 2;
  const cy = el.y + el.h / 2;
  const rot = ((el.rotation || 0) * Math.PI) / 180;
  const cos = Math.abs(Math.cos(rot));
  const sin = Math.abs(Math.sin(rot));
  const halfW = (el.w / 2) * cos + (el.h / 2) * sin;
  const halfH = (el.w / 2) * sin + (el.h / 2) * cos;
  return { left: cx - halfW, right: cx + halfW, top: cy - halfH, bottom: cy + halfH, cx, cy };
}

// Цілі прив'язки по осях: краї/центр слайда + краї/центри інших (не перетягуваних)
// об'єктів поточного слайда (з урахуванням повороту).
function buildSnapTargets(draggedIds) {
  const xs = [0, STAGE_WIDTH / 2, STAGE_WIDTH];
  const ys = [0, STAGE_HEIGHT / 2, STAGE_HEIGHT];
  const slide = getCurrentSlide();
  if (slide) {
    const dragged = new Set(draggedIds);
    slide.elements.forEach(el => {
      if (dragged.has(el.id)) return;
      const b = elementBounds(el);
      xs.push(b.left, b.cx, b.right);
      ys.push(b.top, b.cy, b.bottom);
    });
  }
  return { xs, ys };
}

// Найближчий збіг будь-якого з опорних значень (left/center/right) із ціллю.
function snapAxis(refs, targets, threshold) {
  let best = null;
  for (const ref of refs) {
    for (const target of targets) {
      const delta = target - ref;
      if (Math.abs(delta) <= threshold && (!best || Math.abs(delta) < Math.abs(best.delta))) {
        best = { delta, target };
      }
    }
  }
  return best;
}

// Коригує зміщення (dx,dy) групи на прив'язку й повертає напрямні лінії.
function computeDragSnap(dx, dy, stage) {
  const draggedIds = pointer.dragElements.map(d => d.id);
  // Поріг — стала кількість ЕКРАННИХ px, переведена в логічні через масштаб
  // сцени, тож чутливість прив'язки однакова за будь-якого zoom.
  const rect = stage.getBoundingClientRect();
  const scale = rect.width ? rect.width / STAGE_WIDTH : 1;
  const threshold = SNAP_SCREEN_PX / scale;

  const left = pointer.dragMinX + dx;
  const right = pointer.dragMaxRight + dx;
  const cx = (pointer.dragMinX + pointer.dragMaxRight) / 2 + dx;
  const top = pointer.dragMinY + dy;
  const bottom = pointer.dragMaxBottom + dy;
  const cy = (pointer.dragMinY + pointer.dragMaxBottom) / 2 + dy;

  const { xs, ys } = buildSnapTargets(draggedIds);
  const guides = [];
  const sx = snapAxis([left, cx, right], xs, threshold);
  const sy = snapAxis([top, cy, bottom], ys, threshold);
  if (sx) { dx += sx.delta; guides.push({ type: 'v', pos: sx.target }); }
  if (sy) { dy += sy.delta; guides.push({ type: 'h', pos: sy.target }); }

  // Прив'язка до сітки — лише там, де не спрацювала розумна прив'язка.
  if (state.snapToGrid) {
    if (!sx) dx += Math.round((pointer.dragMinX + dx) / GRID_STEP) * GRID_STEP - (pointer.dragMinX + dx);
    if (!sy) dy += Math.round((pointer.dragMinY + dy) / GRID_STEP) * GRID_STEP - (pointer.dragMinY + dy);
  }

  dx = clamp(dx, -pointer.dragMinX, STAGE_WIDTH - pointer.dragMaxRight);
  dy = clamp(dy, -pointer.dragMinY, STAGE_HEIGHT - pointer.dragMaxBottom);
  return { dx, dy, guides };
}

function renderGuides(guides, stage) {
  clearGuides();
  guides.forEach(guide => {
    const node = document.createElement('div');
    node.className = `snap-guide snap-guide-${guide.type}`;
    if (guide.type === 'v') node.style.left = `${guide.pos}px`;
    else node.style.top = `${guide.pos}px`;
    stage.appendChild(node);
    activeGuides.push(node);
  });
}

function clearGuides() {
  activeGuides.forEach(node => node.remove());
  activeGuides = [];
}

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
  pointer.rotateCenter = null;
  pointer.marqueeEl = null;
  pointer.marqueeStart = null;
  pointer.marqueeAdditive = false;
  pointer.marqueeBase = [];
  pointer.marqueeMoved = false;
}

export function onElementPointerDown(event, elementId, { elementDomMap, findElementById, selectElement, isSelected, getSelectedElements, duplicateSelection, stage }) {
  const textTarget = event.target.closest('.text-element');
  if (textTarget?.contentEditable === 'true') return;
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

  // Alt+drag дублює виділення й тягне копії; історію записує сам duplicateSelection.
  let altDuplicated = false;
  if (event.altKey && duplicateSelection) {
    altDuplicated = !!duplicateSelection();
  }

  const point = getStagePoint(stage, event.clientX, event.clientY);
  const selected = getSelectedElements();
  if (!selected.length) return;
  pointer.mode = 'drag';
  pointer.pointerId = event.pointerId;
  pointer.committed = altDuplicated;
  pointer.dragStartX = point.x;
  pointer.dragStartY = point.y;
  pointer.dragElements = selected.map(el => ({ id: el.id, startX: el.x, startY: el.y, w: el.w, h: el.h }));
  // Межі групи — з AABB кожного елемента (з урахуванням rotation), щоб прив'язка
  // й кламбінг працювали за видимими краями повернутих об'єктів.
  const bounds = selected.map(elementBounds);
  pointer.dragMinX = Math.min(...bounds.map(b => b.left));
  pointer.dragMaxRight = Math.max(...bounds.map(b => b.right));
  pointer.dragMinY = Math.min(...bounds.map(b => b.top));
  pointer.dragMaxBottom = Math.max(...bounds.map(b => b.bottom));
  // Після Alt-дублювання вузли пересоздані — беремо вузол із актуальної мапи.
  const leadNode = elementDomMap.get(selected[selected.length - 1].id) || node;
  pointer.dragLeadNode = leadNode;
  leadNode.classList.add('dragging');
  try { leadNode.setPointerCapture(event.pointerId); } catch { /* synthetic/unsupported pointer */ }
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
  pointer.startBox = { x: element.x, y: element.y, w: element.w, h: element.h, rotation: element.rotation || 0 };
  pointer.committed = false;

  const node = elementDomMap.get(elementId);
  try { node?.setPointerCapture(event.pointerId); } catch { /* synthetic/unsupported pointer */ }
}

export function onRotateHandlePointerDown(event, elementId, { elementDomMap, findElementById, selectElement, stage }) {
  event.preventDefault();
  event.stopPropagation();

  const element = findElementById(elementId);
  if (!element) return;
  selectElement(elementId);

  pointer.mode = 'rotate';
  pointer.resizeId = elementId;
  pointer.pointerId = event.pointerId;
  pointer.committed = false;
  pointer.rotateCenter = { cx: element.x + element.w / 2, cy: element.y + element.h / 2 };

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
    const rawDx = clamp(point.x - pointer.dragStartX, -pointer.dragMinX, STAGE_WIDTH - pointer.dragMaxRight);
    const rawDy = clamp(point.y - pointer.dragStartY, -pointer.dragMinY, STAGE_HEIGHT - pointer.dragMaxBottom);
    const snap = computeDragSnap(rawDx, rawDy, stage);
    const dx = snap.dx;
    const dy = snap.dy;
    renderGuides(snap.guides, stage);
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

  if (pointer.mode === 'rotate' && pointer.rotateCenter) {
    const element = findElementById(pointer.resizeId);
    const node = elementDomMap.get(pointer.resizeId);
    if (!element || !node) return;
    const { cx, cy } = pointer.rotateCenter;
    let angle = Math.atan2(point.y - cy, point.x - cx) * 180 / Math.PI + 90;
    if (event.shiftKey) angle = Math.round(angle / 15) * 15; // Shift — крок 15°
    angle = ((angle % 360) + 360) % 360;
    if (angle === element.rotation) return;
    commitOnce();
    element.rotation = angle;
    node.style.transform = `rotate(${angle}deg)`;
    return;
  }

  if (pointer.mode === 'resize' && pointer.startBox) {
    const element = findElementById(pointer.resizeId);
    const node = elementDomMap.get(pointer.resizeId);
    if (!element || !node) return;
    const dx = point.x - pointer.startX;
    const dy = point.y - pointer.startY;
    const start = pointer.startBox;
    const rotation = (start.rotation * Math.PI) / 180;
    const cos = Math.cos(rotation);
    const sin = Math.sin(rotation);
    // Ручки обертаються разом з елементом, тому рух курсора переводимо з осей
    // слайда в локальні осі повернутого об'єкта.
    const localDx = dx * cos + dy * sin;
    const localDy = -dx * sin + dy * cos;
    let w = start.w;
    let h = start.h;
    const handle = pointer.handle;
    const has = symbol => handle.includes(symbol);

    if (has('e')) w += localDx;
    if (has('s')) h += localDy;
    if (has('w')) w -= localDx;
    if (has('n')) h -= localDy;

    // Shift на кутовій ручці зберігає пропорції стартового боксу.
    if (event.shiftKey && handle.length === 2) {
      const aspect = start.w / start.h;
      if (Math.abs(w - start.w) >= Math.abs(h - start.h) * aspect) {
        h = w / aspect;
      } else {
        w = h * aspect;
      }
    }

    w = Math.max(40, w);
    h = Math.max(30, h);

    // Зсув центра в локальних осях утримує протилежну ручку на місці.
    const centerLocalX = has('e') ? (w - start.w) / 2 : (has('w') ? -(w - start.w) / 2 : 0);
    const centerLocalY = has('s') ? (h - start.h) / 2 : (has('n') ? -(h - start.h) / 2 : 0);
    const centerX = start.x + start.w / 2 + centerLocalX * cos - centerLocalY * sin;
    const centerY = start.y + start.h / 2 + centerLocalX * sin + centerLocalY * cos;
    let x = centerX - w / 2;
    let y = centerY - h / 2;

    // Після resize залишаємо видиму AABB у межах слайда.
    const bounds = elementBounds({ x, y, w, h, rotation: start.rotation });
    if (bounds.left < 0) x -= bounds.left;
    if (bounds.right > STAGE_WIDTH) x += STAGE_WIDTH - bounds.right;
    if (bounds.top < 0) y -= bounds.top;
    if (bounds.bottom > STAGE_HEIGHT) y += STAGE_HEIGHT - bounds.bottom;

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

  // drag / resize / rotate
  clearGuides();
  pointer.dragLeadNode?.classList.remove('dragging');
  const wasRotate = pointer.mode === 'rotate';
  const wasResize = pointer.mode === 'resize';
  const changed = pointer.committed;
  resetPointer();
  if (!changed) return;
  normalizeZIndexes();
  renderSlideList();
  markDirty(wasRotate ? 'Об’єкт повернуто' : (wasResize ? 'Розмір змінено' : 'Положення змінено'));
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
