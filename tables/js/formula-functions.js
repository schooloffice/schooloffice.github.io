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

function valueToNumberOrNull(v) {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  if (s === '') return null;
  const n = Number(s.replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

// Будує предикат для критерію COUNTIF/SUMIF/AVERAGEIF.
// Критерій — число (точна рівність) або рядок: "текст", ">5", "<=10", "<>3"…
function makeCriteriaPredicate(criteria) {
  if (typeof criteria === 'number') {
    return v => valueToNumberOrNull(v) === criteria;
  }

  const s = String(criteria ?? '').trim();
  const m = /^(>=|<=|<>|>|<|=)?\s*([\s\S]*)$/.exec(s);
  const op = m[1] || '=';
  const rhs = m[2];
  const rhsNum = valueToNumberOrNull(rhs);
  const rhsText = String(rhs).toLowerCase();

  return (v) => {
    const vn = valueToNumberOrNull(v);
    if (rhsNum !== null && vn !== null) {
      switch (op) {
        case '=': return vn === rhsNum;
        case '<>': return vn !== rhsNum;
        case '>': return vn > rhsNum;
        case '<': return vn < rhsNum;
        case '>=': return vn >= rhsNum;
        case '<=': return vn <= rhsNum;
      }
    }
    const vs = String(v ?? '').trim().toLowerCase();
    switch (op) {
      case '<>': return vs !== rhsText;
      case '>': return vs > rhsText;
      case '<': return vs < rhsText;
      case '>=': return vs >= rhsText;
      case '<=': return vs <= rhsText;
      default: return vs === rhsText;
    }
  };
}

// ---- Date serials (Excel-сумісні: дні від 1899-12-30) ----
const DATE_EPOCH_UTC = Date.UTC(1899, 11, 30);

function ymdToSerial(y, m, d) {
  return Math.round((Date.UTC(y, m - 1, d) - DATE_EPOCH_UTC) / 86400000);
}

function todaySerial() {
  const n = new Date();
  return ymdToSerial(n.getFullYear(), n.getMonth() + 1, n.getDate());
}

function nowSerial() {
  const n = new Date();
  const dayFrac = (n.getHours() * 3600 + n.getMinutes() * 60 + n.getSeconds()) / 86400;
  return todaySerial() + dayFrac;
}

function serialToDateString(serial, withTime) {
  const s = Number(serial);
  if (!Number.isFinite(s)) return String(serial);
  const whole = Math.floor(s);
  const dt = new Date(DATE_EPOCH_UTC + whole * 86400000);
  const dd = String(dt.getUTCDate()).padStart(2, '0');
  const mm = String(dt.getUTCMonth() + 1).padStart(2, '0');
  let out = `${dd}.${mm}.${dt.getUTCFullYear()}`;
  if (withTime) {
    const totalSec = Math.round((s - whole) * 86400);
    const hh = String(Math.floor(totalSec / 3600) % 24).padStart(2, '0');
    const mi = String(Math.floor(totalSec / 60) % 60).padStart(2, '0');
    out += ` ${hh}:${mi}`;
  }
  return out;
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

  // Умовні (для журналів/відомостей)
  COUNTIF: (a, ctx) => {
    const range = ctx.collectValues([a[0]]);
    const pred = makeCriteriaPredicate(ctx.evalScalar(a[1]));
    return range.filter(pred).length;
  },
  SUMIF: (a, ctx) => {
    const range = ctx.collectValues([a[0]]);
    const pred = makeCriteriaPredicate(ctx.evalScalar(a[1]));
    const sumRange = a.length > 2 ? ctx.collectValues([a[2]]) : range;
    let sum = 0;
    for (let i = 0; i < range.length; i++) {
      if (!pred(range[i])) continue;
      const n = valueToNumberOrNull(sumRange[i]);
      if (n !== null) sum += n;
    }
    return sum;
  },
  AVERAGEIF: (a, ctx) => {
    const range = ctx.collectValues([a[0]]);
    const pred = makeCriteriaPredicate(ctx.evalScalar(a[1]));
    const avgRange = a.length > 2 ? ctx.collectValues([a[2]]) : range;
    let sum = 0;
    let count = 0;
    for (let i = 0; i < range.length; i++) {
      if (!pred(range[i])) continue;
      const n = valueToNumberOrNull(avgRange[i]);
      if (n !== null) { sum += n; count++; }
    }
    if (count === 0) throw formulaError(FORMULA_ERRORS.DIV0);
    return sum / count;
  },

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
  },

  // Дати (повертають серійний номер; формат «Дата» показує DD.MM.YYYY)
  TODAY: () => todaySerial(),
  NOW: () => nowSerial(),
  DATE: (a, ctx) => ymdToSerial(ctx.num(a[0]), ctx.num(a[1]), ctx.num(a[2]))
};

window.TablesFormulaFunctions = { FORMULA_FUNCTIONS, isFormulaNumber };
