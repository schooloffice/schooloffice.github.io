'use strict';

// ---- Об'єднані клітинки аркуша: модель без DOM ----
// Об'єднання — прямокутник [cMin,rMin,cMax,rMax] щонайменше з двох клітинок. Значення й формат
// має ліва верхня клітинка (якір), решта прихована. Об'єднання одного аркуша не перетинаються.

const MERGE_MAX_PER_SHEET = 1000;
// Межі моделі аркуша (setGridSize).
const MERGE_GRID_MAX_ROWS = 500;
const MERGE_GRID_MAX_COLS = 200;

function mergeContains(merge, col, row) {
  return col >= merge[0] && col <= merge[2] && row >= merge[1] && row <= merge[3];
}

function mergesIntersect(a, b) {
  return a[0] <= b[2] && b[0] <= a[2] && a[1] <= b[3] && b[1] <= a[3];
}

function mergeAt(merges, col, row) {
  for (const merge of merges || []) {
    if (mergeContains(merge, col, row)) return merge;
  }
  return null;
}

// Клітинка прихована під об'єднанням (не якір).
function isMergeCovered(merges, col, row) {
  const merge = mergeAt(merges, col, row);
  return !!merge && (merge[0] !== col || merge[1] !== row);
}

function mergeRangeError(range, rows, cols) {
  const [cMin, rMin, cMax, rMax] = range;
  if (cMin < 0 || cMax < cMin || cMax >= cols || rMin < 1 || rMax < rMin || rMax > rows) return 'діапазон поза аркушем';
  if (cMin === cMax && rMin === rMax) return "об'єднання має містити щонайменше дві клітинки";
  return '';
}

// strict — для файлів .arttab (помилка зупиняє відкриття); інакше некоректні й перекриті
// об'єднання відкидаються (чернетка, історія).
function normalizeSheetMerges(value, rows, cols, { strict = false } = {}) {
  if (value == null) return [];
  if (!Array.isArray(value)) {
    if (strict) throw new Error("Некоректний список об'єднаних клітинок");
    return [];
  }
  if (strict && value.length > MERGE_MAX_PER_SHEET) throw new Error(`Забагато об'єднаних клітинок на аркуші (максимум ${MERGE_MAX_PER_SHEET})`);
  const out = [];
  value.slice(0, MERGE_MAX_PER_SHEET).forEach((raw, index) => {
    const range = Array.isArray(raw) && raw.length === 4 ? raw.map(Number) : null;
    let error = range && range.every(Number.isInteger) ? mergeRangeError(range, rows, cols) : 'очікувався діапазон [cMin,rMin,cMax,rMax]';
    if (!error && out.some(existing => mergesIntersect(existing, range))) error = "перетинається з іншим об'єднанням";
    if (error) {
      if (strict) throw new Error(`Об'єднання ${index + 1}: ${error}`);
      return;
    }
    out.push(range);
  });
  return out;
}

// Виділення, розширене так, щоб кожне зачеплене об'єднання лежало в ньому повністю.
function expandBoundsToMerges(bounds, merges) {
  let { cMin, cMax, rMin, rMax } = bounds;
  let changed = !!merges?.length;
  while (changed) {
    changed = false;
    for (const merge of merges) {
      if (!mergesIntersect(merge, [cMin, rMin, cMax, rMax])) continue;
      if (merge[0] < cMin || merge[1] < rMin || merge[2] > cMax || merge[3] > rMax) {
        cMin = Math.min(cMin, merge[0]);
        rMin = Math.min(rMin, merge[1]);
        cMax = Math.max(cMax, merge[2]);
        rMax = Math.max(rMax, merge[3]);
        changed = true;
      }
    }
  }
  return { cMin, cMax, rMin, rMax };
}

// Нове об'єднання замінює всі, що перетинають його діапазон.
function mergeBounds(merges, bounds) {
  const range = [bounds.cMin, bounds.rMin, bounds.cMax, bounds.rMax];
  return [...(merges || []).filter(merge => !mergesIntersect(merge, range)), range];
}

function unmergeBounds(merges, bounds) {
  const range = [bounds.cMin, bounds.rMin, bounds.cMax, bounds.rMax];
  return (merges || []).filter(merge => !mergesIntersect(merge, range));
}

// Вставка/видалення рядків і колонок: об'єднання зсувається, вставка всередині його розширює,
// видалення стискає; об'єднання з однієї клітинки зникає. limits — розмір аркуша після зміни.
function shiftSheetMerges(merges, opts, limits = {}) {
  const maxRows = Math.min(MERGE_GRID_MAX_ROWS, limits.rows ?? MERGE_GRID_MAX_ROWS);
  const maxCols = Math.min(MERGE_GRID_MAX_COLS, limits.cols ?? MERGE_GRID_MAX_COLS);
  return (merges || []).flatMap(([cMin, rMin, cMax, rMax]) => {
    const rows = structuralShiftInterval(rMin, rMax, opts.rowAt ?? null, opts.rowDelta ?? 0);
    const cols = structuralShiftInterval(cMin, cMax, opts.colAt ?? null, opts.colDelta ?? 0);
    if (rows.deleted || cols.deleted || rows.a > maxRows || cols.a >= maxCols) return [];
    const range = [cols.a, rows.a, Math.min(cols.b, maxCols - 1), Math.min(rows.b, maxRows)];
    return range[0] === range[2] && range[1] === range[3] ? [] : [range];
  });
}

// Розкладка для вікна рендеру. Об'єднання, що виходить за вікно віртуалізованої сітки, малюється
// обрізаним до вікна: spans — видимий лівий верхній кут → якір і розміри, skip — решта клітинок.
function mergeRenderLayout(merges, view) {
  const spans = new Map();
  const skip = new Set();
  for (const [cMin, rMin, cMax, rMax] of merges || []) {
    const top = Math.max(rMin, view.rowStart);
    const bottom = Math.min(rMax, view.rowEnd);
    const left = Math.max(cMin, view.colStart);
    const right = Math.min(cMax, view.colEnd);
    if (top > bottom || left > right) continue;
    spans.set(`${top}:${left}`, { col: cMin, row: rMin, colSpan: right - left + 1, rowSpan: bottom - top + 1 });
    for (let r = top; r <= bottom; r++) {
      for (let c = left; c <= right; c++) {
        if (r !== top || c !== left) skip.add(`${r}:${c}`);
      }
    }
  }
  return { spans, skip };
}

// Наступна клітинка з клавіатури: крок за межу поточного об'єднання; потрапляння в інше
// об'єднання веде до його якоря.
function mergeStep(merges, col, row, dc, dr, cols, rows) {
  const current = mergeAt(merges, col, row) || [col, row, col, row];
  let nextCol = col;
  let nextRow = row;
  if (dc > 0) nextCol = current[2] + 1;
  if (dc < 0) nextCol = current[0] - 1;
  if (dr > 0) nextRow = current[3] + 1;
  if (dr < 0) nextRow = current[1] - 1;
  nextCol = Math.max(0, Math.min(cols - 1, nextCol));
  nextRow = Math.max(1, Math.min(rows, nextRow));
  const target = mergeAt(merges, nextCol, nextRow);
  return target ? { c: target[0], r: target[1] } : { c: nextCol, r: nextRow };
}

window.TablesMergeModel = {
  MERGE_MAX_PER_SHEET,
  expandBoundsToMerges,
  isMergeCovered,
  mergeAt,
  mergeBounds,
  mergeRenderLayout,
  mergeStep,
  mergesIntersect,
  normalizeSheetMerges,
  shiftSheetMerges,
  unmergeBounds
};
