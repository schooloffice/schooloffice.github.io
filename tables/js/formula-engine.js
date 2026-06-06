'use strict';

// ---- AST evaluator + public evaluateFormula ----

// Приведення до числа для арифметики: порожнє → 0, текст → #VALUE!.
function toFormulaNumber(v) {
  if (v === null || v === undefined) return 0;
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) throw formulaError(FORMULA_ERRORS.NUM);
    return v;
  }
  if (typeof v === 'boolean') return v ? 1 : 0;
  const s = String(v).trim();
  if (s === '') return 0;
  const num = Number(s.replace(',', '.'));
  if (!Number.isFinite(num)) throw formulaError(FORMULA_ERRORS.VALUE);
  return num;
}

// М'яке приведення для порівнянь: повертає число або null (якщо не число).
function toNumberOrNull(v) {
  if (v === null || v === undefined) return 0;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'boolean') return v ? 1 : 0;
  const s = String(v).trim();
  if (s === '') return 0;
  const num = Number(s.replace(',', '.'));
  return Number.isFinite(num) ? num : null;
}

function formulaToString(v) {
  return v === null || v === undefined ? '' : String(v);
}

function isFormulaTruthy(v) {
  return toFormulaNumber(v) !== 0;
}

function compareValues(left, right, op) {
  let a, b;
  const ln = toNumberOrNull(left);
  const rn = toNumberOrNull(right);
  if (ln !== null && rn !== null) { a = ln; b = rn; }
  else { a = formulaToString(left); b = formulaToString(right); }

  switch (op) {
    case '=': return a === b;
    case '<>': return a !== b;
    case '<': return a < b;
    case '>': return a > b;
    case '<=': return a <= b;
    case '>=': return a >= b;
    default: return false;
  }
}

// Дані аркуша для міжаркушевого посилання (активний аркуш → живі глобали).
function resolveSheetData(name) {
  const sh = findSheetByName(name);
  if (!sh) throw formulaError(FORMULA_ERRORS.REF);
  return sh === sheets[activeSheet] ? cellData : sh.cellData;
}

function getCellValueForRef(node) {
  if (node.sheet) {
    pushEvalData(resolveSheetData(node.sheet));
    try { return getCellValueByIndex(node.col, node.row); }
    finally { popEvalData(); }
  }
  return getCellValueByIndex(node.col, node.row);
}

function evalScalar(node) {
  switch (node.type) {
    case 'num': return node.value;
    case 'str': return node.value;
    case 'ref': return getCellValueForRef(node);
    case 'range': throw formulaError(FORMULA_ERRORS.VALUE); // діапазон не можна як скаляр
    case 'unary': {
      if (node.op === '%post') return toFormulaNumber(evalScalar(node.operand)) / 100;
      const v = toFormulaNumber(evalScalar(node.operand));
      return node.op === '-' ? -v : v;
    }
    case 'binary': return evalBinary(node);
    case 'call': return dispatchFunction(node);
    default: throw formulaError(FORMULA_ERRORS.VALUE);
  }
}

function evalBinary(node) {
  const op = node.op;
  if (op === '+' || op === '-' || op === '*' || op === '/') {
    const a = toFormulaNumber(evalScalar(node.left));
    const b = toFormulaNumber(evalScalar(node.right));
    if (op === '+') return a + b;
    if (op === '-') return a - b;
    if (op === '*') return a * b;
    if (b === 0) throw formulaError(FORMULA_ERRORS.DIV0);
    return a / b;
  }
  return compareValues(evalScalar(node.left), evalScalar(node.right), op) ? 1 : 0;
}

function collectValues(argNodes) {
  const out = [];
  for (const node of argNodes) {
    if (node.type === 'range') {
      const sheetName = node.start.sheet;
      let pushed = false;
      if (sheetName) { pushEvalData(resolveSheetData(sheetName)); pushed = true; }
      try {
        const vals = rangeToValues(node.start.col, node.start.row, node.end.col, node.end.row);
        for (const v of vals) out.push(v);
      } finally {
        if (pushed) popEvalData();
      }
    } else {
      out.push(evalScalar(node));
    }
  }
  return out;
}

const FORMULA_CTX = {
  evalScalar,
  toNumber: toFormulaNumber,
  isTruthy: isFormulaTruthy,
  num: node => toFormulaNumber(evalScalar(node)),
  collectValues
};

function dispatchFunction(node) {
  const fn = FORMULA_FUNCTIONS[node.name];
  if (typeof fn !== 'function') throw formulaError(FORMULA_ERRORS.NAME);
  return fn(node.args, FORMULA_CTX);
}

function normalizeFormulaResult(res) {
  if (res === null || res === undefined) return 0;
  if (typeof res === 'boolean') return res ? 1 : 0;
  if (typeof res === 'number') {
    if (!Number.isFinite(res)) throw formulaError(FORMULA_ERRORS.NUM);
    return Number.isInteger(res) ? res : parseFloat(Number(res).toFixed(10).replace(/\.?0+$/, ''));
  }
  return res; // рядок
}

function evaluateFormula(expr) {
  calcDepth++;
  if (calcDepth > MAX_CALC_DEPTH) {
    calcDepth = 0;
    throw formulaError(FORMULA_ERRORS.CIRC);
  }

  try {
    const src = String(expr || '').trim();
    if (src === '') { calcDepth--; return 0; }
    if (src.length > MAX_CELL_LEN) throw formulaError(FORMULA_ERRORS.VALUE);

    const ast = parseFormula(src);
    const out = normalizeFormulaResult(evalScalar(ast));
    calcDepth--;
    return out;
  } catch (e) {
    calcDepth = 0;
    if (e && (e.isFormulaError || isFormulaErrorCode(e.message))) throw e;
    throw formulaError(FORMULA_ERRORS.VALUE);
  }
}

window.TablesFormulaEngine = { evaluateFormula };
