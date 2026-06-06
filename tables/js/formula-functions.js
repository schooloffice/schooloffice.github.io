'use strict';

// ---- Spreadsheet function implementations ----
function countNonEmptyArgs(args) {
  return args.filter(arg => {
    if (isCellReference(arg)) {
      const raw = resolveRawCellValue(arg);
      return raw !== undefined && raw !== null && String(raw).trim() !== '';
    }
    return String(arg || '').trim() !== '';
  }).length;
}

function countNumericArgs(args) {
  return args.filter(arg => {
    const src = String(arg || '').trim();
    if (src === '') return false;

    if (isCellReference(src)) {
      const raw = resolveRawCellValue(src);
      if (raw === undefined || raw === null || String(raw).trim() === '') return false;
      if (String(raw).startsWith('=')) {
        try {
          return Number.isFinite(Number(evaluateFormula(String(raw).substring(1))));
        } catch (_) {
          return false;
        }
      }
      return Number.isFinite(Number(String(raw).replace(',', '.')));
    }

    try {
      return Number.isFinite(Number(resolveExpressionValue(src)));
    } catch (_) {
      return false;
    }
  }).length;
}

function evaluateLogicalFunction(func, args) {
  const rawArgs = splitFormulaArgs(args);
  if (rawArgs.length === 0) return '0';
  if (func === 'AND') return rawArgs.every(evaluateCondition) ? '1' : '0';
  return rawArgs.some(evaluateCondition) ? '1' : '0';
}

function evaluateNotFunction(args) {
  return evaluateCondition(args) ? '0' : '1';
}

function evaluateIfFunction(args) {
  const parts = splitFormulaArgs(args);
  const condition = parts[0] ?? '0';
  const whenTrue = parts[1] ?? '1';
  const whenFalse = parts[2] ?? '0';
  return String(resolveExpressionValue(evaluateCondition(condition) ? whenTrue : whenFalse));
}

function evaluateAggregateFunction(func, args) {
  const rawArgs = splitFormulaArgs(args);
  const vals = rawArgs.map(a => resolveValue(a.trim())).filter(v => isFinite(v));
  if (func === 'COUNT') return String(countNumericArgs(rawArgs));
  if (func === 'COUNTA') return String(countNonEmptyArgs(rawArgs));
  if (vals.length === 0) return '0';
  if (func === 'SUM') return String(vals.reduce((a, b) => a + b, 0));
  if (func === 'AVG') return String(vals.reduce((a, b) => a + b, 0) / vals.length);
  if (func === 'MAX') return String(Math.max(...vals));
  if (func === 'MIN') return String(Math.min(...vals));
  if (func === 'MEDIAN') {
    const sorted = [...vals].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return String(sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2);
  }
  return '0';
}

function evaluateUnaryMathFunction(func, args) {
  const val = resolveValue(splitFormulaArgs(args)[0]);
  if (func === 'ABS') return String(Math.abs(val));
  if (func === 'INT' || func === 'FLOOR') return String(Math.floor(val));
  if (func === 'CEIL' || func === 'CEILING') return String(Math.ceil(val));
  if (func === 'SQRT') {
    if (val < 0) throw new Error('Square root of a negative number is not supported');
    return String(Math.sqrt(val));
  }
  return '0';
}

function evaluateBinaryMathFunction(func, args) {
  const parts = splitFormulaArgs(args);
  const a = resolveValue(parts[0]);
  const b = resolveValue(parts[1]);
  if (func === 'MOD') {
    if (b === 0) throw new Error('Division by zero');
    return String(a % b);
  }
  if (func === 'ROUND') {
    const digits = Number.isFinite(b) ? b : 0;
    const factor = Math.pow(10, digits);
    return String(Math.round(a * factor) / factor);
  }
  return String(Math.pow(a, b));
}

window.TablesFormulaFunctions = {
  countNonEmptyArgs,
  countNumericArgs,
  evaluateAggregateFunction,
  evaluateBinaryMathFunction,
  evaluateIfFunction,
  evaluateLogicalFunction,
  evaluateNotFunction,
  evaluateUnaryMathFunction
};
