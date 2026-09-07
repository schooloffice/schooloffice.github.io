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

// ---- Контекст одного циклу перерахунку ----
// Без кешу вкладена формула рахується заново на кожне посилання: ланцюжок
// A2==A1+A1, A3==A2+A2, … A16==A15+A15 давав 32 768 викликів evaluator замість
// 16 (аудит F10). Кеш живе рівно один цикл: між циклами дані могли змінитися.
//
// Ключ — пара «аркуш + клітинка», де аркуш ідентифікує сам об'єкт даних із
// контексту: цього досить і для активного аркуша, і для міжаркушевих посилань.
let __calcCycles = 0;
let __evalCache = null;      // Map<data, Map<cellKey, { value } | { error }>>
let __evalInProgress = null; // Map<data, Set<cellKey>> — ланцюжок, що рахується зараз

function beginCalculation() {
  if (__calcCycles === 0) {
    __evalCache = new Map();
    __evalInProgress = new Map();
  }
  __calcCycles++;
}

function endCalculation() {
  __calcCycles = Math.max(0, __calcCycles - 1);
  if (__calcCycles === 0) {
    __evalCache = null;
    __evalInProgress = null;
  }
}

function _bucket(map, data, factory) {
  let bucket = map.get(data);
  if (!bucket) {
    bucket = factory();
    map.set(data, bucket);
  }
  return bucket;
}

function _evaluateCellFormula(data, key, expr) {
  if (!__evalCache) return evaluateFormula(expr);

  const cache = _bucket(__evalCache, data, () => new Map());
  const cached = cache.get(key);
  if (cached) {
    if (cached.error) throw cached.error;
    return cached.value;
  }

  // Пряме виявлення циклу: клітинка вже рахується у власному ланцюжку.
  // MAX_CALC_DEPTH лишається запобіжником для глибокої, але не циклічної вкладеності.
  const running = _bucket(__evalInProgress, data, () => new Set());
  if (running.has(key)) {
    const circular = formulaError(FORMULA_ERRORS.CIRC);
    cache.set(key, { error: circular });
    throw circular;
  }

  running.add(key);
  try {
    const value = evaluateFormula(expr);
    cache.set(key, { value });
    return value;
  } catch (error) {
    cache.set(key, { error });
    throw error;
  } finally {
    running.delete(key);
  }
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
  if (s.startsWith('=')) return _evaluateCellFormula(data, key, s.substring(1));

  const norm = s.replace(',', '.').trim();
  if (norm !== '' && Number.isFinite(Number(norm))) return Number(norm);
  return s; // текст
}

// Межі діапазону перевіряємо ДО перебору й до виділення масивів: інакше
// короткий рядок із величезним діапазоном займає головний потік, а результат
// мовчки виходить іншим, ніж очікує користувач.
function _rangeBounds(startCol, startRow, endCol, endRow) {
  const bounds = {
    cMin: Math.min(startCol, endCol),
    cMax: Math.max(startCol, endCol),
    rMin: Math.min(startRow, endRow),
    rMax: Math.max(startRow, endRow)
  };
  const cells = (bounds.cMax - bounds.cMin + 1) * (bounds.rMax - bounds.rMin + 1);
  if (!Number.isFinite(cells) || cells > MAX_RANGE_CELLS) {
    throw formulaError(FORMULA_ERRORS.REF);
  }
  return bounds;
}

// Розгортає діапазон у плоский масив значень клітинок.
function rangeToValues(startCol, startRow, endCol, endRow) {
  const out = [];
  const { cMin, cMax, rMin, rMax } = _rangeBounds(startCol, startRow, endCol, endRow);

  for (let c = cMin; c <= cMax; c++) {
    for (let r = rMin; r <= rMax; r++) {
      out.push(getCellValueByIndex(c, r));
    }
  }
  return out;
}

// Розгортає діапазон із збереженням форми: VLOOKUP, INDEX і MATCH працюють
// з рядками й стовпцями, а не з плоским списком.
// Повертає { rows, cols, get(r, c) } з нумерацією від 0 у межах діапазону.
function rangeToGrid(startCol, startRow, endCol, endRow) {
  const { cMin, cMax, rMin, rMax } = _rangeBounds(startCol, startRow, endCol, endRow);

  const cells = [];
  for (let r = rMin; r <= rMax; r++) {
    const row = [];
    for (let c = cMin; c <= cMax; c++) row.push(getCellValueByIndex(c, r));
    cells.push(row);
  }

  return {
    rows: rMax - rMin + 1,
    cols: cMax - cMin + 1,
    get(r, c) {
      const row = cells[r];
      return row ? (row[c] ?? null) : null;
    }
  };
}

window.TablesFormulaReferences = {
  getCellValueByIndex, rangeToValues, rangeToGrid,
  beginCalculation, endCalculation
};
