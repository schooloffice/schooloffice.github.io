'use strict';

// ---- Formula evaluation coordinator ----
function evaluateFormula(expr) {
  calcDepth++;
  if (calcDepth > MAX_CALC_DEPTH) {
    calcDepth = 0;
    throw new Error('Circular reference');
  }

  try {
    let clean = String(expr || '').toUpperCase().trim();
    if (clean.length === 0) { calcDepth--; return 0; }
    if (clean.length > MAX_CELL_LEN) throw new Error('Formula is too long');

    clean = clean.replace(/\b([A-Z]+)(\d+)\s*:\s*([A-Z]+)(\d+)\b/g,
      (m, c1, r1, c2, r2) => expandRange(c1, parseInt(r1, 10), c2, parseInt(r2, 10)).join(','));

    let changed = true;
    let guard = 0;
    while (changed && guard++ < 30) {
      changed = false;

      clean = clean.replace(/\b(AND|OR)\(([^()]*)\)/g, (m, func, args) => {
        changed = true;
        return evaluateLogicalFunction(func, args);
      });

      clean = clean.replace(/\bNOT\(([^()]*)\)/g, (m, args) => {
        changed = true;
        return evaluateNotFunction(args);
      });

      clean = clean.replace(/\bIF\(([^()]*)\)/g, (m, args) => {
        changed = true;
        return evaluateIfFunction(args);
      });

      clean = clean.replace(/\b(SUM|AVG|MAX|MIN|COUNT|COUNTA|MEDIAN)\(([^()]*)\)/g, (m, func, args) => {
        changed = true;
        return evaluateAggregateFunction(func, args);
      });

      clean = clean.replace(/\b(ABS|SQRT|INT|FLOOR|CEIL|CEILING)\(([^()]*)\)/g, (m, func, args) => {
        changed = true;
        return evaluateUnaryMathFunction(func, args);
      });

      clean = clean.replace(/\b(ROUND|POW|POWER|MOD)\(([^()]*)\)/g, (m, func, args) => {
        changed = true;
        return evaluateBinaryMathFunction(func, args);
      });
    }

    clean = clean.replace(/(\d+(?:\.\d+)?)%/g, (m, n) => String(parseFloat(n) / 100));
    clean = clean.replace(/\b([A-Z]+)(\d+)\b/g, (m, c, r) => String(resolveValue(c + r)));

    const res = safeMathEval(clean);
    if (!isFinite(res)) throw new Error('Formula result is too large');

    calcDepth--;
    return Number.isInteger(res) ? res : parseFloat(Number(res).toFixed(10).replace(/\.?0+$/, ''));
  } catch (e) {
    calcDepth = 0;
    throw new Error(e?.message || 'Formula error');
  }
}

window.TablesFormulaEngine = {
  evaluateFormula
};
