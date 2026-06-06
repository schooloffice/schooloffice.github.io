'use strict';

// ---- Row filter (фільтр за стовпцем) ----
// rowFilter = { col, op, v1, v2 } — показуємо лише рядки, де клітинка стовпця
// відповідає умові. Фільтр транзитивний (не зберігається у файл), реаплаїться
// після кожної перебудови сітки.

const FILTER_OPS_NEEDS2 = { between: true };
let filterWired = false;

function filterMatches(spec, raw) {
  const s = String(raw ?? '').trim();
  if (s === '') return false;

  if (spec.op === 'contains') {
    return s.toLowerCase().includes(String(spec.v1 ?? '').trim().toLowerCase());
  }

  const num = Number(s.replace(',', '.'));
  if (!Number.isFinite(num)) return false;
  const a = Number(spec.v1);
  switch (spec.op) {
    case 'gt': return num > a;
    case 'ge': return num >= a;
    case 'lt': return num < a;
    case 'le': return num <= a;
    case 'eq': return num === a;
    case 'ne': return num !== a;
    case 'between': { const b = Number(spec.v2); return num >= Math.min(a, b) && num <= Math.max(a, b); }
    default: return true;
  }
}

// Значення клітинки для фільтра (формула → обчислений результат).
function filterCellValue(col, row) {
  const raw = cellData[getCellId(col, row)];
  if (raw === undefined || raw === null || String(raw).trim() === '') return '';
  const s = String(raw);
  if (s.startsWith('=')) {
    try { calcDepth = 0; return evaluateFormula(s.substring(1)); }
    catch (_) { return ''; }
  }
  return raw;
}

function applyRowFilter() {
  for (let r = 1; r <= ROWS; r++) {
    const cell = cellTd[r]?.[0];
    const tr = cell ? cell.closest('tr') : null;
    if (!tr) continue;
    if (!rowFilter) { tr.style.display = ''; continue; }
    tr.style.display = filterMatches(rowFilter, filterCellValue(rowFilter.col, r)) ? '' : 'none';
  }
}

function clearRowFilter() {
  rowFilter = null;
  applyRowFilter();
  announce('Фільтр знято');
}

function showFilterError(msg) {
  const el = document.getElementById('filterError');
  if (el) el.textContent = msg || '';
}

function toggleFilterV2() {
  const op = document.getElementById('filterOp')?.value;
  const needs2 = !!FILTER_OPS_NEEDS2[op];
  const v2 = document.getElementById('filterV2');
  const and = document.getElementById('filterAnd');
  if (v2) v2.hidden = !needs2;
  if (and) and.hidden = !needs2;
}

function onApplyFilter() {
  const op = document.getElementById('filterOp')?.value || 'gt';
  const v1 = document.getElementById('filterV1')?.value ?? '';

  if (op === 'contains') {
    if (String(v1).trim() === '') { showFilterError('Вкажіть текст.'); return; }
  } else if (!Number.isFinite(parseFloat(v1))) {
    showFilterError('Вкажіть число.'); return;
  }

  let v2 = null;
  if (FILTER_OPS_NEEDS2[op]) {
    v2 = parseFloat(document.getElementById('filterV2')?.value);
    if (!Number.isFinite(v2)) { showFilterError('Вкажіть друге число.'); return; }
  }

  rowFilter = { col: active.c, op, v1, v2 };
  applyRowFilter();
  showFilterError('');
  closeModal('filterModal');
  announce('Фільтр застосовано до стовпця ' + COLS[active.c]);
}

function wireFilterModalOnce() {
  if (filterWired) return;
  filterWired = true;
  document.getElementById('filterOp')?.addEventListener('change', toggleFilterV2);
  document.getElementById('filterApplyBtn')?.addEventListener('click', onApplyFilter);
  document.getElementById('filterClearBtn')?.addEventListener('click', () => {
    clearRowFilter();
    closeModal('filterModal');
  });
}

function openFilterModal() {
  wireFilterModalOnce();
  const label = document.getElementById('filterColLabel');
  if (label) label.textContent = COLS[active.c];
  toggleFilterV2();
  showFilterError('');
  openModal('filterModal');
}

window.TablesFilter = {
  applyRowFilter,
  clearRowFilter,
  filterMatches,
  openFilterModal
};
