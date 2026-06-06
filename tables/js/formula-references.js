'use strict';

// ---- Resolving cell / range values for the AST evaluator ----
// Контекст обчислення: стек { data, rows, cols } для міжаркушевих посилань
// (кожен аркуш має власний розмір, тож межі беремо з контексту, а не з активного).
let __evalCtxStack = [];
function pushEvalContext(ctx) { __evalCtxStack.push(ctx); }
function popEvalContext() { __evalCtxStack.pop(); }
function currentEvalContext() {
  return __evalCtxStack.length
    ? __evalCtxStack[__evalCtxStack.length - 1]
    : { data: cellData, rows: ROWS, cols: COL_COUNT };
}

// Повертає типізоване значення клітинки: number | string | null(порожня).
function getCellValueByIndex(col, row) {
  const ctx = currentEvalContext();
  if (col < 0 || col >= ctx.cols || row < 1 || row > ctx.rows) return null;

  const data = ctx.data;
  const key = indexToCol(col) + row;
  const raw = data[key];
  if (raw === undefined || raw === null || String(raw) === '') return null;

  const s = String(raw);
  if (s.startsWith('=')) {
    // Вкладена формула: рахуємо через спільний рушій (calcDepth ловить цикли).
    return evaluateFormula(s.substring(1));
  }

  const norm = s.replace(',', '.').trim();
  if (norm !== '' && Number.isFinite(Number(norm))) return Number(norm);
  return s; // текст
}

// Розгортає діапазон у плоский масив значень клітинок.
function rangeToValues(startCol, startRow, endCol, endRow) {
  const out = [];
  const cMin = Math.min(startCol, endCol);
  const cMax = Math.max(startCol, endCol);
  const rMin = Math.min(startRow, endRow);
  const rMax = Math.max(startRow, endRow);

  for (let c = cMin; c <= cMax; c++) {
    for (let r = rMin; r <= rMax; r++) {
      out.push(getCellValueByIndex(c, r));
    }
  }
  return out;
}

window.TablesFormulaReferences = { getCellValueByIndex, rangeToValues };
