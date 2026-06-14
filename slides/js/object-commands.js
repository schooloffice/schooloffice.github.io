import { uid } from './utils.js';

const ALIGN_MODES = ['left', 'right', 'center-h', 'top', 'bottom', 'middle-v'];

export function groupElements(elements, createId = uid) {
  if (!Array.isArray(elements) || elements.length < 2) return false;
  const groupId = createId();
  elements.forEach(element => { element.groupId = groupId; });
  return true;
}

export function ungroupElements(elements) {
  if (!Array.isArray(elements)) return false;
  const grouped = elements.filter(element => element.groupId);
  if (!grouped.length) return false;
  grouped.forEach(element => { element.groupId = null; });
  return true;
}

export function remapGroupIds(elements, createId = uid) {
  if (!Array.isArray(elements)) return false;
  const groupIds = new Map();
  elements.forEach(element => {
    if (!element.groupId) return;
    if (!groupIds.has(element.groupId)) groupIds.set(element.groupId, createId());
    element.groupId = groupIds.get(element.groupId);
  });
  return groupIds.size > 0;
}

export function createSelectionUnits(elements, getBounds) {
  if (!Array.isArray(elements) || typeof getBounds !== 'function') return [];

  const groups = new Map();
  const units = [];
  elements.forEach(element => {
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
    const bounds = unit.members.map(getBounds);
    const left = Math.min(...bounds.map(bound => bound.left));
    const right = Math.max(...bounds.map(bound => bound.right));
    const top = Math.min(...bounds.map(bound => bound.top));
    const bottom = Math.max(...bounds.map(bound => bound.bottom));
    unit.bounds = { left, right, top, bottom, cx: (left + right) / 2, cy: (top + bottom) / 2 };
  });
  return units;
}

function moveUnit(unit, dx, dy) {
  unit.members.forEach(element => {
    element.x += dx;
    element.y += dy;
  });
}

export function alignSelectionUnits(units, mode) {
  if (!Array.isArray(units) || units.length < 2 || !ALIGN_MODES.includes(mode)) return false;

  const minLeft = Math.min(...units.map(unit => unit.bounds.left));
  const maxRight = Math.max(...units.map(unit => unit.bounds.right));
  const minTop = Math.min(...units.map(unit => unit.bounds.top));
  const maxBottom = Math.max(...units.map(unit => unit.bounds.bottom));
  const centerX = (minLeft + maxRight) / 2;
  const centerY = (minTop + maxBottom) / 2;

  units.forEach(unit => {
    if (mode === 'left') moveUnit(unit, minLeft - unit.bounds.left, 0);
    else if (mode === 'right') moveUnit(unit, maxRight - unit.bounds.right, 0);
    else if (mode === 'center-h') moveUnit(unit, centerX - unit.bounds.cx, 0);
    else if (mode === 'top') moveUnit(unit, 0, minTop - unit.bounds.top);
    else if (mode === 'bottom') moveUnit(unit, 0, maxBottom - unit.bounds.bottom);
    else if (mode === 'middle-v') moveUnit(unit, 0, centerY - unit.bounds.cy);
  });
  return true;
}

export function distributeSelectionUnits(units, axis) {
  if (!Array.isArray(units) || units.length < 3 || !['h', 'v'].includes(axis)) return false;

  const key = axis === 'h' ? 'cx' : 'cy';
  units.sort((a, b) => a.bounds[key] - b.bounds[key]);
  const first = units[0].bounds[key];
  const last = units[units.length - 1].bounds[key];
  const step = (last - first) / (units.length - 1);

  units.forEach((unit, index) => {
    if (index === 0 || index === units.length - 1) return;
    const delta = (first + index * step) - unit.bounds[key];
    if (axis === 'h') moveUnit(unit, delta, 0);
    else moveUnit(unit, 0, delta);
  });
  return true;
}
