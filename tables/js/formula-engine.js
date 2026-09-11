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

// Книга, яку зараз експортують у XLSX: міжаркушеві посилання беремо з неї, а не з живої сітки.
let exportWorkbookSheets = null;

// Контекст аркуша для міжаркушевого посилання (активний → живі глобали + його межі).
function resolveSheetContext(name) {
  if (exportWorkbookSheets) {
    const key = String(name || '').trim().toLowerCase();
    const exported = exportWorkbookSheets.find(s => String(s.name).trim().toLowerCase() === key);
    if (!exported) throw formulaError(FORMULA_ERRORS.REF);
    return { data: exported.cellData || {}, rows: exported.rows, cols: exported.cols };
  }
  const sh = findSheetByName(name);
  if (!sh) throw formulaError(FORMULA_ERRORS.REF);
  if (sh === sheets[activeSheet]) return { data: cellData, rows: ROWS, cols: COL_COUNT };
  return { data: sh.cellData, rows: sh.rows, cols: sh.cols };
}

function getCellValueForRef(node) {
  if (node.sheet) {
    pushEvalContext(resolveSheetContext(node.sheet));
    try { return getCellValueByIndex(node.col, node.row); }
    finally { popEvalContext(); }
  }
  return getCellValueByIndex(node.col, node.row);
}

function evalScalar(node) {
  switch (node.type) {
    case 'num': return node.value;
    case 'str': return node.value;
    case 'err': throw formulaError(node.value);
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
      if (sheetName) { pushEvalContext(resolveSheetContext(sheetName)); pushed = true; }
      try {
        const vals = rangeToValues(node.start.col, node.start.row, node.end.col, node.end.row);
        for (const v of vals) out.push(v);
      } finally {
        if (pushed) popEvalContext();
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

// ---- Кешовані значення для XLSX ----
// Кеш пишемо лише тоді, коли Excel гарантовано отримає той самий результат того самого
// типу. Функції поза цим набором (AVG, POW, CEIL, ROUND, MOD, FLOOR/CEILING з одним
// аргументом, критерії *IF) у ПЛЮС рахуються інакше або відсутні в Excel.
const EXCEL_EXACT_FUNCTIONS = new Set(['SUM', 'MAX', 'MIN', 'COUNT', 'COUNTA', 'AVERAGE', 'MEDIAN', 'ABS', 'INT', 'SQRT', 'POWER', 'DATE', 'TODAY', 'NOW', 'AND', 'OR', 'NOT', 'IF', 'PV', 'FV', 'PMT']);
// PV/FV/PMT збігаються з Excel лише за 3–5 аргументів: іншу кількість Excel не приймає.
const EXCEL_FINANCE_FUNCTIONS = new Set(['PV', 'FV', 'PMT']);
const EXCEL_BOOLEAN_FUNCTIONS = new Set(['AND', 'OR', 'NOT']);
const COMPARISON_OPERATORS = new Set(['=', '<>', '<', '>', '<=', '>=']);
const EXCEL_ERROR_VALUES = new Set([FORMULA_ERRORS.DIV0, FORMULA_ERRORS.REF, FORMULA_ERRORS.NAME, FORMULA_ERRORS.VALUE, FORMULA_ERRORS.NUM]);
const EXACT_CHECK_MAX_DEPTH = 40;
const EXACT_CHECK_MAX_RANGE_CELLS = 10000;
// «1,5» ПЛЮС читає як число, а Excel зберігає як текст.
const COMMA_DECIMAL_RE = /^\s*-?\d+,\d+\s*$/;

function cellIsExcelExact(ctx, col, row, depth) {
  if (col < 0 || col >= ctx.cols || row < 1 || row > ctx.rows) return true;
  const raw = ctx.data[indexToCol(col) + row];
  if (raw === undefined || raw === null || String(raw) === '') return true;
  const text = String(raw);
  if (COMMA_DECIMAL_RE.test(text)) return false;
  if (!text.startsWith('=')) return true;
  if (depth > EXACT_CHECK_MAX_DEPTH) return false;
  let ast;
  try { ast = parseFormula(text.substring(1).trim()); } catch { return false; }
  pushEvalContext(ctx);
  try { return isExcelExactNode(ast, depth + 1); } finally { popEvalContext(); }
}

function contextForSheet(sheetName) {
  if (!sheetName) return currentEvalContext();
  try { return resolveSheetContext(sheetName); } catch { return null; }
}

function isExcelExactNode(node, depth = 0) {
  if (depth > EXACT_CHECK_MAX_DEPTH) return false;
  switch (node.type) {
    case 'num':
    case 'str':
    case 'err':
      return true;
    case 'ref': {
      const ctx = contextForSheet(node.sheet);
      return !ctx || cellIsExcelExact(ctx, node.col, node.row, depth);
    }
    case 'range': {
      const ctx = contextForSheet(node.start.sheet);
      if (!ctx) return true;
      const cMin = Math.min(node.start.col, node.end.col);
      const cMax = Math.max(node.start.col, node.end.col);
      const rMin = Math.min(node.start.row, node.end.row);
      const rMax = Math.max(node.start.row, node.end.row);
      if ((cMax - cMin + 1) * (rMax - rMin + 1) > EXACT_CHECK_MAX_RANGE_CELLS) return false;
      for (let c = cMin; c <= cMax; c++) {
        for (let r = rMin; r <= rMax; r++) {
          if (!cellIsExcelExact(ctx, c, r, depth)) return false;
        }
      }
      return true;
    }
    case 'unary':
      return isExcelExactNode(node.operand, depth + 1);
    case 'binary': {
      if (!isExcelExactNode(node.left, depth + 1) || !isExcelExactNode(node.right, depth + 1)) return false;
      if (!COMPARISON_OPERATORS.has(node.op)) return true;
      // ПЛЮС порівнює текст із урахуванням регістру, Excel — без; текстовий літерал Excel
      // вважає текстом навіть «12». Тож кешуємо лише порівняння двох чисел.
      if (node.left.type === 'str' || node.right.type === 'str') return false;
      try {
        return toNumberOrNull(evalScalar(node.left)) !== null && toNumberOrNull(evalScalar(node.right)) !== null;
      } catch {
        return false;
      }
    }
    case 'call': {
      if (!EXCEL_EXACT_FUNCTIONS.has(node.name)) return false;
      if (node.name === 'IF' && node.args.length !== 3) return false;
      if (EXCEL_FINANCE_FUNCTIONS.has(node.name) && (node.args.length < 3 || node.args.length > 5)) return false;
      if (!node.args.every(arg => isExcelExactNode(arg, depth + 1))) return false;
      if (node.name === 'AVERAGE' || node.name === 'MEDIAN') {
        // Без чисел ПЛЮС повертає 0, а Excel — #DIV/0! або #NUM!.
        try { return numericValues(node.args, FORMULA_CTX).length > 0; } catch { return false; }
      }
      return true;
    }
    default:
      return false;
  }
}

// Результат формули для кешу XLSX: { kind: number|boolean|string|error|unknown, value }.
// «unknown» означає, що кеш не пишемо взагалі, а не підставляємо 0.
function evaluateFormulaForExport(expr, workbookSheets, sheetIndex) {
  const sheet = workbookSheets?.[sheetIndex];
  if (!sheet) return { kind: 'unknown' };
  const previousSheets = exportWorkbookSheets;
  exportWorkbookSheets = workbookSheets;
  pushEvalContext({ data: sheet.cellData || {}, rows: sheet.rows, cols: sheet.cols });
  try {
    const src = String(expr || '').trim();
    let ast;
    try { ast = parseFormula(src); } catch { return { kind: 'unknown' }; }
    if (!isExcelExactNode(ast)) return { kind: 'unknown' };
    let value;
    try {
      calcDepth = 0;
      value = evaluateFormula(src);
    } catch (error) {
      const code = error?.message;
      return EXCEL_ERROR_VALUES.has(code) ? { kind: 'error', value: code } : { kind: 'unknown' };
    }
    if (typeof value === 'string') return { kind: 'string', value };
    if (typeof value !== 'number' || !Number.isFinite(value)) return { kind: 'unknown' };
    const isBoolean = (ast.type === 'binary' && COMPARISON_OPERATORS.has(ast.op))
      || (ast.type === 'call' && EXCEL_BOOLEAN_FUNCTIONS.has(ast.name));
    return isBoolean ? { kind: 'boolean', value: value ? 1 : 0 } : { kind: 'number', value };
  } finally {
    popEvalContext();
    exportWorkbookSheets = previousSheets;
    calcDepth = 0;
  }
}

window.TablesFormulaEngine = { evaluateFormula, evaluateFormulaForExport };
