'use strict';

// ---- Resolving cell / range values for the AST evaluator ----
// Контекст даних: стек cellData-об'єктів для міжаркушевих посилань.
let __evalDataStack = [];
function pushEvalData(d) { __evalDataStack.push(d); }
function popEvalData() { __evalDataStack.pop(); }
function currentEvalData() { return __evalDataStack.length ? __evalDataStack[__evalDataStack.length - 1] : cellData; }

// Повертає типізоване значення клітинки: number | string | null(порожня).
function getCellValueByIndex(col, row) {
  if (col < 0 || col >= COL_COUNT || row < 1 || row > ROWS) return null;

  const data = currentEvalData();
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
