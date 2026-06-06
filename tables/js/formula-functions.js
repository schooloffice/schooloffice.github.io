'use strict';

// ---- Function registry ----
// Кожна функція отримує (argNodes, ctx). ctx надає:
//   evalScalar(node)      — обчислити вузол у скаляр (number|string|null)
//   toNumber(value)       — привести до числа (текст → #VALUE!)
//   isTruthy(value)       — істинність умови
//   num(node)             — toNumber(evalScalar(node))
//   collectValues(nodes)  — плоский масив значень (діапазони розгорнуто)
// Лінива природа IF/AND/OR/NOT збережена: гілки обчислюються лише за потреби.

function isFormulaNumber(v) {
  return typeof v === 'number' && Number.isFinite(v);
}

function numericValues(argNodes, ctx) {
  return ctx.collectValues(argNodes).filter(isFormulaNumber);
}

const FORMULA_FUNCTIONS = {
  // Агрегатні (ігнорують текст і порожні клітинки, як у Excel)
  SUM: (a, ctx) => numericValues(a, ctx).reduce((x, y) => x + y, 0),
  AVERAGE: (a, ctx) => {
    const v = numericValues(a, ctx);
    return v.length ? v.reduce((x, y) => x + y, 0) / v.length : 0;
  },
  AVG: (a, ctx) => FORMULA_FUNCTIONS.AVERAGE(a, ctx), // аліас (deprecated)
  MAX: (a, ctx) => { const v = numericValues(a, ctx); return v.length ? Math.max(...v) : 0; },
  MIN: (a, ctx) => { const v = numericValues(a, ctx); return v.length ? Math.min(...v) : 0; },
  MEDIAN: (a, ctx) => {
    const v = numericValues(a, ctx).slice().sort((x, y) => x - y);
    if (!v.length) return 0;
    const m = Math.floor(v.length / 2);
    return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
  },
  COUNT: (a, ctx) => ctx.collectValues(a).filter(isFormulaNumber).length,
  COUNTA: (a, ctx) => ctx.collectValues(a)
    .filter(v => v !== null && !(typeof v === 'string' && v.trim() === '')).length,

  // Логічні (короткозамкнені)
  IF: (a, ctx) => {
    const cond = ctx.isTruthy(ctx.evalScalar(a[0]));
    if (cond) return a.length > 1 ? ctx.evalScalar(a[1]) : 1;
    return a.length > 2 ? ctx.evalScalar(a[2]) : 0;
  },
  AND: (a, ctx) => a.every(n => ctx.isTruthy(ctx.evalScalar(n))) ? 1 : 0,
  OR: (a, ctx) => a.some(n => ctx.isTruthy(ctx.evalScalar(n))) ? 1 : 0,
  NOT: (a, ctx) => ctx.isTruthy(ctx.evalScalar(a[0])) ? 0 : 1,

  // Унарні математичні
  ABS: (a, ctx) => Math.abs(ctx.num(a[0])),
  INT: (a, ctx) => Math.floor(ctx.num(a[0])),
  FLOOR: (a, ctx) => Math.floor(ctx.num(a[0])),
  CEIL: (a, ctx) => Math.ceil(ctx.num(a[0])),
  CEILING: (a, ctx) => Math.ceil(ctx.num(a[0])),
  SQRT: (a, ctx) => {
    const v = ctx.num(a[0]);
    if (v < 0) throw formulaError(FORMULA_ERRORS.NUM);
    return Math.sqrt(v);
  },

  // Бінарні математичні
  ROUND: (a, ctx) => {
    const n = ctx.num(a[0]);
    const digits = a.length > 1 ? ctx.num(a[1]) : 0;
    const factor = Math.pow(10, digits);
    return Math.round(n * factor) / factor;
  },
  POW: (a, ctx) => Math.pow(ctx.num(a[0]), ctx.num(a[1])),
  POWER: (a, ctx) => Math.pow(ctx.num(a[0]), ctx.num(a[1])),
  MOD: (a, ctx) => {
    const b = ctx.num(a[1]);
    if (b === 0) throw formulaError(FORMULA_ERRORS.DIV0);
    return ctx.num(a[0]) % b;
  }
};

window.TablesFormulaFunctions = { FORMULA_FUNCTIONS, isFormulaNumber };
