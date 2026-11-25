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

// Шаблон із підстановками Excel: * — будь-яка кількість символів, ? — один символ,
// ~* ~? ~~ — буквальні символи. Повертає RegExp (без урахування регістру).
function wildcardToRegExp(pattern, anchored) {
  let out = '';
  const src = String(pattern);
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (ch === '~' && i + 1 < src.length && '*?~'.includes(src[i + 1])) {
      out += '\\' + src[i + 1];
      i++;
    } else if (ch === '*') out += '[\\s\\S]*';
    else if (ch === '?') out += '[\\s\\S]';
    else out += ch.replace(/[.+^${}()|[\]\\\/-]/g, '\\$&');
  }
  return new RegExp(anchored ? `^${out}$` : out, 'i');
}

function hasWildcard(text) {
  return /[*?]/.test(String(text));
}

// Будує предикат для критерію COUNTIF/SUMIF/AVERAGEIF і *IFS.
// Критерій — число (точна рівність) або рядок: "текст", ">5", "<=10", "<>3", "а*", "?б".
// Для "=" і "<>" працюють підстановки * та ?; порівняння тексту — без урахування регістру.
// Числові оператори (> < >= <=) ігнорують текстові й порожні клітинки, як у Excel.
function makeCriteriaPredicate(criteria) {
  if (typeof criteria === 'number') {
    return v => typeof v !== 'string' && valueToNumberOrNull(v) === criteria;
  }

  const s = String(criteria ?? '').trim();
  const m = /^(>=|<=|<>|>|<|=)?\s*([\s\S]*)$/.exec(s);
  const op = m[1] || '=';
  const rhs = m[2];
  const rhsNum = valueToNumberOrNull(rhs);
  const rhsText = String(rhs).toLowerCase();
  const wildcard = rhsNum === null && (op === '=' || op === '<>') && hasWildcard(rhs)
    ? wildcardToRegExp(rhs, true) : null;

  return (v) => {
    const vn = valueToNumberOrNull(v);
    if (rhsNum !== null) {
      if (vn !== null) {
        switch (op) {
          case '=': return vn === rhsNum;
          case '<>': return vn !== rhsNum;
          case '>': return vn > rhsNum;
          case '<': return vn < rhsNum;
          case '>=': return vn >= rhsNum;
          case '<=': return vn <= rhsNum;
        }
      }
      // Число в критерії, а в клітинці текст чи порожньо.
      return op === '<>';
    }
    const vs = String(v ?? '').trim();
    if (wildcard) return op === '<>' ? !wildcard.test(vs) : wildcard.test(vs);
    const lower = vs.toLowerCase();
    switch (op) {
      case '<>': return lower !== rhsText;
      case '>': return lower > rhsText;
      case '<': return lower < rhsText;
      case '>=': return lower >= rhsText;
      case '<=': return lower <= rhsText;
      default: return lower === rhsText;
    }
  };
}

// ---- Фінансові функції PV/FV/PMT ----
// Сигнатури й формули — як у Microsoft Excel (контрольні значення в
// tests/tables-formula-behavior.html отримано з Excel 16):
//   PV(rate, nper, pmt, [fv], [type])   FV(rate, nper, pmt, [pv], [type])
//   PMT(rate, nper, pv, [fv], [type])
// rate — ставка за період (річна / 12 для щомісячних платежів), nper — кількість
// періодів. Знак грошового потоку: сплачене — від'ємне, отримане — додатне.
// type: 0 (або пропущено) — платіж наприкінці періоду; будь-яке інше число — на початку.
function financeArgs(a, ctx) {
  if (a.length < 3 || a.length > 5) throw formulaError(FORMULA_ERRORS.VALUE);
  const values = a.map(node => ctx.num(node));
  return {
    rate: values[0],
    nper: values[1],
    third: values[2],
    fourth: a.length > 3 ? values[3] : 0,
    type: a.length > 4 && values[4] !== 0 ? 1 : 0
  };
}

// (1 + rate)^nper з правилами POWER у Excel: 0^0 — #NUM!, 0 у від'ємному степені —
// #DIV/0!, переповнення — #NUM!, а не нескінченність чи 0.
function financeGrowth(rate, nper) {
  const base = 1 + rate;
  if (base === 0 && nper === 0) throw formulaError(FORMULA_ERRORS.NUM);
  if (base === 0 && nper < 0) throw formulaError(FORMULA_ERRORS.DIV0);
  const growth = Math.pow(base, nper);
  if (!Number.isFinite(growth)) throw formulaError(FORMULA_ERRORS.NUM);
  return growth;
}

function financeResult(value) {
  if (!Number.isFinite(value)) throw formulaError(FORMULA_ERRORS.NUM);
  return value;
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
  DATE: (a, ctx) => ymdToSerial(ctx.num(a[0]), ctx.num(a[1]), ctx.num(a[2])),

  // Фінансові (див. financeArgs вище)
  PV: (a, ctx) => {
    const { rate, nper, third: pmt, fourth: fv, type } = financeArgs(a, ctx);
    if (rate === 0) return financeResult(-(fv + pmt * nper));
    const growth = financeGrowth(rate, nper);
    // Excel: PV зі ставкою −1 (нульовий дисконт-множник) — #DIV/0!.
    if (growth === 0) throw formulaError(FORMULA_ERRORS.DIV0);
    return financeResult(-(fv + pmt * (1 + rate * type) * (growth - 1) / rate) / growth);
  },
  FV: (a, ctx) => {
    const { rate, nper, third: pmt, fourth: pv, type } = financeArgs(a, ctx);
    if (rate === 0) return financeResult(-(pv + pmt * nper));
    const growth = financeGrowth(rate, nper);
    return financeResult(-(pv * growth + pmt * (1 + rate * type) * (growth - 1) / rate));
  },
  PMT: (a, ctx) => {
    const { rate, nper, third: pv, fourth: fv, type } = financeArgs(a, ctx);
    // Excel: нуль періодів і ставка ≤ −1 — #NUM!, а не ділення на нуль.
    if (nper === 0 || rate <= -1) throw formulaError(FORMULA_ERRORS.NUM);
    if (rate === 0) return financeResult(-(pv + fv) / nper);
    // Excel рахує PMT без переповнення: PMT(0,1;100000;1000) = −100, а крихітна ставка
    // не вироджується в ділення на нуль. Тому (1+rate)^nper − 1 беремо через expm1/log1p,
    // а при зростанні ділимо чисельник і знаменник на (1+rate)^nper.
    const logGrowth = nper * Math.log1p(rate);
    const factor = 1 + rate * type;
    if (logGrowth > 0) {
      const inverse = Math.exp(-logGrowth);
      return financeResult(-(rate * (pv + fv * inverse)) / (factor * -Math.expm1(-logGrowth)));
    }
    return financeResult(-(rate * (pv * Math.exp(logGrowth) + fv)) / (factor * Math.expm1(logGrowth)));
  }
};

// ---- Допоміжні функції для пошуку, тексту, дат ----
function fnError(code) { return formulaError(code); }

function requireArgs(a, min, max) {
  if (a.length < min || (max !== undefined && a.length > max)) throw fnError(FORMULA_ERRORS.VALUE);
}

function toText(v) {
  if (v === null || v === undefined) return '';
  return String(v);
}

// Порівняння для пошуку: число з числом, текст з текстом (без урахування регістру).
// null — типи несумісні (або клітинка порожня), такі клітинки пошук пропускає.
function lookupCompare(cell, key) {
  if (typeof key === 'number') {
    return typeof cell === 'number' ? Math.sign(cell - key) : null;
  }
  if (typeof cell !== 'string') return null;
  const a = cell.toLowerCase();
  const b = String(key).toLowerCase();
  return a < b ? -1 : a > b ? 1 : 0;
}

function lookupEquals(cell, key) {
  if (typeof key === 'number') return typeof cell === 'number' && cell === key;
  if (typeof cell !== 'string') return false;
  if (hasWildcard(key)) return wildcardToRegExp(key, true).test(cell);
  return cell.toLowerCase() === String(key).toLowerCase();
}

function lookupKey(ctx, node) {
  const v = ctx.evalScalar(node);
  return v === null || v === undefined ? 0 : v;
}

// Індекс точного збігу або -1.
function exactIndex(vector, key) {
  for (let i = 0; i < vector.length; i++) if (lookupEquals(vector[i], key)) return i;
  return -1;
}

// Найбільше значення ≤ key у відсортованому за зростанням списку.
function approxIndexAscending(vector, key) {
  let best = -1;
  for (let i = 0; i < vector.length; i++) {
    const c = lookupCompare(vector[i], key);
    if (c === null) continue;
    if (c <= 0) best = i; else break;
  }
  return best;
}

function transpose(matrix) {
  return matrix[0].map((_, c) => matrix.map(row => row[c]));
}

// VLOOKUP/HLOOKUP: matrix уже орієнтована так, що шукаємо в першому рядку.
function lookupInRows(a, ctx, byRow) {
  requireArgs(a, 3, 4);
  const key = lookupKey(ctx, a[0]);
  let table = ctx.matrix(a[1]);
  if (byRow) table = transpose(table); // HLOOKUP: перший рядок стає першим стовпцем
  const index = ctx.num(a[2]);
  const approx = a.length > 3 ? ctx.isTruthy(ctx.evalScalar(a[3])) : true;
  if (!Number.isFinite(index) || index < 1) throw fnError(FORMULA_ERRORS.VALUE);
  if (Math.floor(index) > table[0].length) throw fnError(FORMULA_ERRORS.REF);
  const firstColumn = table.map(row => row[0]);
  const found = approx ? approxIndexAscending(firstColumn, key) : exactIndex(firstColumn, key);
  if (found < 0) throw fnError(FORMULA_ERRORS.NA);
  return table[found][Math.floor(index) - 1];
}

// Спільна частина COUNTIFS/SUMIFS/AVERAGEIFS/MAXIFS/MINIFS: булевий масив збігів за всіма
// парами (діапазон; критерій), починаючи з аргументу firstPair.
function ifsMatches(a, ctx, firstPair) {
  if (a.length < firstPair + 2 || (a.length - firstPair) % 2 !== 0) throw fnError(FORMULA_ERRORS.VALUE);
  let matches = null;
  for (let i = firstPair; i < a.length; i += 2) {
    const range = ctx.collectValues([a[i]]);
    const pred = makeCriteriaPredicate(ctx.evalScalar(a[i + 1]));
    if (matches && matches.length !== range.length) throw fnError(FORMULA_ERRORS.VALUE);
    if (!matches) matches = range.map(() => true);
    for (let k = 0; k < range.length; k++) if (matches[k] && !pred(range[k])) matches[k] = false;
  }
  return matches;
}

function ifsNumbers(a, ctx) {
  const matches = ifsMatches(a, ctx, 1);
  const values = ctx.collectValues([a[0]]);
  if (values.length !== matches.length) throw fnError(FORMULA_ERRORS.VALUE);
  return values.filter((v, i) => matches[i] && isFormulaNumber(v));
}

// Значення, яке не є помилкою CIRC: IFERROR та ISERROR не маскують цикли.
function tryEvaluate(node, ctx) {
  const depth = calcDepth;
  try {
    return { value: ctx.evalScalar(node) };
  } catch (e) {
    const code = e && e.message;
    if (!(e && (e.isFormulaError || isFormulaErrorCode(code))) || code === FORMULA_ERRORS.CIRC) throw e;
    calcDepth = depth;
    return { error: code };
  }
}

// Округлення від нуля / до нуля з поправкою на двійкову похибку (2.3*100 = 229.99999999999997).
function roundDirected(n, digits, up) {
  const f = Math.pow(10, Math.trunc(digits));
  const x = Number((Math.abs(n) * f).toPrecision(15));
  const r = up ? Math.ceil(x) : Math.floor(x);
  const out = Math.sign(n) * r / f + 0;
  if (!Number.isFinite(out)) throw fnError(FORMULA_ERRORS.NUM);
  return out;
}

function roundHalfAway(n, decimals) {
  const sign = n < 0 ? -1 : 1;
  const x = Number((Math.abs(n) * Math.pow(10, decimals)).toPrecision(15));
  return sign * Math.round(x) / Math.pow(10, decimals);
}

function groupThousands(intText) {
  return intText.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

// Дати: серійний номер або текст ISO (рррр-мм-дд) / дд.мм.рррр.
function dateValueToSerial(v) {
  if (v === null || v === undefined || v === '') return 0;
  if (typeof v === 'number') {
    if (v < 0) throw fnError(FORMULA_ERRORS.NUM);
    return Math.floor(v);
  }
  const s = String(v).trim();
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s);
  let y, mo, d;
  if (m) { y = +m[1]; mo = +m[2]; d = +m[3]; }
  else if ((m = /^(\d{1,2})\.(\d{1,2})\.(\d{4})/.exec(s))) { d = +m[1]; mo = +m[2]; y = +m[3]; }
  else {
    const n = Number(s.replace(',', '.'));
    if (s !== '' && Number.isFinite(n)) return dateValueToSerial(n);
    throw fnError(FORMULA_ERRORS.VALUE);
  }
  const serial = ymdToSerial(y, mo, d);
  const check = new Date(DATE_EPOCH_UTC + serial * 86400000);
  if (check.getUTCMonth() + 1 !== mo || check.getUTCDate() !== d) throw fnError(FORMULA_ERRORS.VALUE);
  return serial;
}

function serialParts(serial) {
  const dt = new Date(DATE_EPOCH_UTC + serial * 86400000);
  return { y: dt.getUTCFullYear(), m: dt.getUTCMonth() + 1, d: dt.getUTCDate(), dow: dt.getUTCDay() };
}

// Підтримувані формати TEXT: 0, 0.00, #,##0, #,##0.00, 0%, 0.00%, dd.mm.yyyy, dd.mm.yy, yyyy-mm-dd.
function formatTextValue(value, format) {
  const fmt = String(format);
  const lower = fmt.toLowerCase();
  const dateFormats = { 'dd.mm.yyyy': 1, 'dd.mm.yy': 1, 'yyyy-mm-dd': 1 };
  if (dateFormats[lower]) {
    if (typeof value !== 'number') return toText(value);
    if (value < 0) throw fnError(FORMULA_ERRORS.VALUE);
    const p = serialParts(Math.floor(value));
    const dd = String(p.d).padStart(2, '0');
    const mm = String(p.m).padStart(2, '0');
    if (lower === 'dd.mm.yyyy') return `${dd}.${mm}.${p.y}`;
    if (lower === 'dd.mm.yy') return `${dd}.${mm}.${String(p.y).slice(-2)}`;
    return `${p.y}-${mm}-${dd}`;
  }
  const m = /^(#,##)?0(?:\.(0+))?(%)?$/.exec(fmt);
  if (!m) throw fnError(FORMULA_ERRORS.VALUE);
  if (typeof value !== 'number') return toText(value);
  const decimals = m[2] ? m[2].length : 0;
  const scaled = m[3] ? value * 100 : value;
  const rounded = roundHalfAway(scaled, decimals);
  let text = Math.abs(rounded).toFixed(decimals);
  if (m[1]) {
    const [intPart, frac] = text.split('.');
    text = groupThousands(intPart) + (frac !== undefined ? '.' + frac : '');
  }
  const negative = rounded < 0 && Number(text.replace(/,/g, '')) !== 0;
  return (negative ? '-' : '') + text + (m[3] ? '%' : '');
}

function flattenTexts(nodes, ctx) {
  return ctx.collectValues(nodes);
}

Object.assign(FORMULA_FUNCTIONS, {
  // ---- Пошук і посилання ----
  VLOOKUP: (a, ctx) => lookupInRows(a, ctx, false),
  HLOOKUP: (a, ctx) => lookupInRows(a, ctx, true),
  MATCH: (a, ctx) => {
    requireArgs(a, 2, 3);
    const key = lookupKey(ctx, a[0]);
    const matrix = ctx.matrix(a[1]);
    if (matrix.length > 1 && matrix[0].length > 1) throw fnError(FORMULA_ERRORS.NA);
    const vector = matrix.length === 1 ? matrix[0] : matrix.map(row => row[0]);
    const type = a.length > 2 ? ctx.num(a[2]) : 1;
    let found = -1;
    if (type === 0) found = exactIndex(vector, key);
    else if (type > 0) found = approxIndexAscending(vector, key);
    else {
      for (let i = 0; i < vector.length; i++) {
        const c = lookupCompare(vector[i], key);
        if (c === null) continue;
        if (c >= 0) found = i; else break;
      }
    }
    if (found < 0) throw fnError(FORMULA_ERRORS.NA);
    return found + 1;
  },
  INDEX: (a, ctx) => {
    requireArgs(a, 2, 3);
    const matrix = ctx.matrix(a[0]);
    const rows = matrix.length;
    const cols = matrix[0].length;
    let row = Math.trunc(ctx.num(a[1]));
    let col = a.length > 2 ? Math.trunc(ctx.num(a[2])) : null;
    if (row < 0 || (col !== null && col < 0)) throw fnError(FORMULA_ERRORS.VALUE);
    if (col === null) {
      // Один індекс: у рядку-векторі це номер стовпця, у стовпці — номер рядка.
      if (rows === 1) { col = row; row = 1; }
      else if (cols === 1) col = 1;
      else throw fnError(FORMULA_ERRORS.VALUE); // цілий рядок — масив, не скаляр
    }
    if (row === 0 || col === 0) throw fnError(FORMULA_ERRORS.VALUE);
    if (row > rows || col > cols) throw fnError(FORMULA_ERRORS.REF);
    return matrix[row - 1][col - 1];
  },

  // ---- Умовні агрегати ----
  COUNTIFS: (a, ctx) => ifsMatches(a, ctx, 0).filter(Boolean).length,
  SUMIFS: (a, ctx) => ifsNumbers(a, ctx).reduce((x, y) => x + y, 0),
  AVERAGEIFS: (a, ctx) => {
    const v = ifsNumbers(a, ctx);
    if (!v.length) throw fnError(FORMULA_ERRORS.DIV0);
    return v.reduce((x, y) => x + y, 0) / v.length;
  },
  MAXIFS: (a, ctx) => { const v = ifsNumbers(a, ctx); return v.length ? Math.max(...v) : 0; },
  MINIFS: (a, ctx) => { const v = ifsNumbers(a, ctx); return v.length ? Math.min(...v) : 0; },

  // ---- Помилки і логіка ----
  IFERROR: (a, ctx) => {
    requireArgs(a, 2, 2);
    const r = tryEvaluate(a[0], ctx);
    return 'error' in r ? ctx.evalScalar(a[1]) : r.value;
  },
  IFNA: (a, ctx) => {
    requireArgs(a, 2, 2);
    const r = tryEvaluate(a[0], ctx);
    if (r.error === FORMULA_ERRORS.NA) return ctx.evalScalar(a[1]);
    if ('error' in r) throw fnError(r.error);
    return r.value;
  },
  ISBLANK: (a, ctx) => {
    requireArgs(a, 1, 1);
    const r = tryEvaluate(a[0], ctx);
    return !('error' in r) && (r.value === null || r.value === undefined) ? 1 : 0;
  },
  ISNUMBER: (a, ctx) => {
    requireArgs(a, 1, 1);
    const r = tryEvaluate(a[0], ctx);
    return !('error' in r) && isFormulaNumber(r.value) ? 1 : 0;
  },
  ISTEXT: (a, ctx) => {
    requireArgs(a, 1, 1);
    const r = tryEvaluate(a[0], ctx);
    return !('error' in r) && typeof r.value === 'string' ? 1 : 0;
  },
  ISERROR: (a, ctx) => { requireArgs(a, 1, 1); return 'error' in tryEvaluate(a[0], ctx) ? 1 : 0; },
  ISNA: (a, ctx) => { requireArgs(a, 1, 1); return tryEvaluate(a[0], ctx).error === FORMULA_ERRORS.NA ? 1 : 0; },
  NA: () => { throw fnError(FORMULA_ERRORS.NA); },
  TRUE: () => 1,
  FALSE: () => 0,

  // ---- Рейтинг і порядкова статистика ----
  RANK: (a, ctx) => {
    requireArgs(a, 2, 3);
    const n = ctx.num(a[0]);
    const values = numericValues([a[1]], ctx);
    const ascending = a.length > 2 && ctx.num(a[2]) !== 0;
    if (!values.includes(n)) throw fnError(FORMULA_ERRORS.NA);
    return 1 + values.filter(v => (ascending ? v < n : v > n)).length;
  },
  LARGE: (a, ctx) => {
    requireArgs(a, 2, 2);
    const v = numericValues([a[0]], ctx).sort((x, y) => y - x);
    const k = Math.ceil(ctx.num(a[1]));
    if (k < 1 || k > v.length) throw fnError(FORMULA_ERRORS.NUM);
    return v[k - 1];
  },
  SMALL: (a, ctx) => {
    requireArgs(a, 2, 2);
    const v = numericValues([a[0]], ctx).sort((x, y) => x - y);
    const k = Math.ceil(ctx.num(a[1]));
    if (k < 1 || k > v.length) throw fnError(FORMULA_ERRORS.NUM);
    return v[k - 1];
  },
  COUNTBLANK: (a, ctx) => {
    requireArgs(a, 1, 1);
    return ctx.collectValues(a).filter(v => v === null || v === undefined || v === '').length;
  },

  // ---- Округлення та математика ----
  ROUNDUP: (a, ctx) => { requireArgs(a, 1, 2); return roundDirected(ctx.num(a[0]), a.length > 1 ? ctx.num(a[1]) : 0, true); },
  ROUNDDOWN: (a, ctx) => { requireArgs(a, 1, 2); return roundDirected(ctx.num(a[0]), a.length > 1 ? ctx.num(a[1]) : 0, false); },
  TRUNC: (a, ctx) => { requireArgs(a, 1, 2); return roundDirected(ctx.num(a[0]), a.length > 1 ? ctx.num(a[1]) : 0, false); },
  SIGN: (a, ctx) => { requireArgs(a, 1, 1); return Math.sign(ctx.num(a[0])) + 0; },
  PRODUCT: (a, ctx) => {
    const v = numericValues(a, ctx);
    return v.length ? v.reduce((x, y) => x * y, 1) : 0;
  },
  SUMPRODUCT: (a, ctx) => {
    requireArgs(a, 1);
    const matrices = a.map(node => ctx.matrix(node));
    const rows = matrices[0].length;
    const cols = matrices[0][0].length;
    if (matrices.some(m => m.length !== rows || m[0].length !== cols)) throw fnError(FORMULA_ERRORS.VALUE);
    let sum = 0;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        let product = 1;
        for (const m of matrices) product *= isFormulaNumber(m[r][c]) ? m[r][c] : 0; // текст рахується як 0
        sum += product;
      }
    }
    return sum;
  },
  RAND: () => Math.random(),
  RANDBETWEEN: (a, ctx) => {
    requireArgs(a, 2, 2);
    const low = Math.ceil(ctx.num(a[0]));
    const high = Math.floor(ctx.num(a[1]));
    if (low > high) throw fnError(FORMULA_ERRORS.NUM);
    return low + Math.floor(Math.random() * (high - low + 1));
  },
  PI: () => Math.PI,
  EXP: (a, ctx) => { requireArgs(a, 1, 1); return Math.exp(ctx.num(a[0])); },
  LN: (a, ctx) => {
    requireArgs(a, 1, 1);
    const v = ctx.num(a[0]);
    if (v <= 0) throw fnError(FORMULA_ERRORS.NUM);
    return Math.log(v);
  },
  LOG10: (a, ctx) => {
    requireArgs(a, 1, 1);
    const v = ctx.num(a[0]);
    if (v <= 0) throw fnError(FORMULA_ERRORS.NUM);
    return Math.log10(v);
  },
  LOG: (a, ctx) => {
    requireArgs(a, 1, 2);
    const v = ctx.num(a[0]);
    const base = a.length > 1 ? ctx.num(a[1]) : 10;
    if (v <= 0 || base <= 0) throw fnError(FORMULA_ERRORS.NUM);
    if (base === 1) throw fnError(FORMULA_ERRORS.DIV0);
    // Для основи 10 і 2 беремо точні log10/log2, щоб LOG(1000) було рівно 3.
    if (base === 10) return Math.log10(v);
    if (base === 2) return Math.log2(v);
    return Math.log(v) / Math.log(base);
  },

  // ---- Текст ----
  LEN: (a, ctx) => { requireArgs(a, 1, 1); return toText(ctx.evalScalar(a[0])).length; },
  LEFT: (a, ctx) => {
    requireArgs(a, 1, 2);
    const n = a.length > 1 ? Math.trunc(ctx.num(a[1])) : 1;
    if (n < 0) throw fnError(FORMULA_ERRORS.VALUE);
    return toText(ctx.evalScalar(a[0])).slice(0, n);
  },
  RIGHT: (a, ctx) => {
    requireArgs(a, 1, 2);
    const n = a.length > 1 ? Math.trunc(ctx.num(a[1])) : 1;
    if (n < 0) throw fnError(FORMULA_ERRORS.VALUE);
    const s = toText(ctx.evalScalar(a[0]));
    return n === 0 ? '' : s.slice(Math.max(0, s.length - n));
  },
  MID: (a, ctx) => {
    requireArgs(a, 3, 3);
    const s = toText(ctx.evalScalar(a[0]));
    const start = Math.trunc(ctx.num(a[1]));
    const n = Math.trunc(ctx.num(a[2]));
    if (start < 1 || n < 0) throw fnError(FORMULA_ERRORS.VALUE);
    return s.substr(start - 1, n);
  },
  CONCAT: (a, ctx) => { requireArgs(a, 1); return flattenTexts(a, ctx).map(toText).join(''); },
  CONCATENATE: (a, ctx) => { requireArgs(a, 1); return a.map(node => toText(ctx.evalScalar(node))).join(''); },
  TEXTJOIN: (a, ctx) => {
    requireArgs(a, 3);
    const delimiter = toText(ctx.evalScalar(a[0]));
    const ignoreEmpty = ctx.isTruthy(ctx.evalScalar(a[1]));
    let parts = flattenTexts(a.slice(2), ctx).map(toText);
    if (ignoreEmpty) parts = parts.filter(p => p !== '');
    return parts.join(delimiter);
  },
  UPPER: (a, ctx) => { requireArgs(a, 1, 1); return toText(ctx.evalScalar(a[0])).toUpperCase(); },
  LOWER: (a, ctx) => { requireArgs(a, 1, 1); return toText(ctx.evalScalar(a[0])).toLowerCase(); },
  PROPER: (a, ctx) => {
    requireArgs(a, 1, 1);
    return toText(ctx.evalScalar(a[0])).replace(/\p{L}+/gu, w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase());
  },
  TRIM: (a, ctx) => {
    requireArgs(a, 1, 1);
    return toText(ctx.evalScalar(a[0])).replace(/ +/g, ' ').replace(/^ | $/g, '');
  },
  SUBSTITUTE: (a, ctx) => {
    requireArgs(a, 3, 4);
    const text = toText(ctx.evalScalar(a[0]));
    const oldText = toText(ctx.evalScalar(a[1]));
    const newText = toText(ctx.evalScalar(a[2]));
    const instance = a.length > 3 ? Math.trunc(ctx.num(a[3])) : 0;
    if (a.length > 3 && instance < 1) throw fnError(FORMULA_ERRORS.VALUE);
    if (oldText === '') return text;
    if (!instance) return text.split(oldText).join(newText);
    let from = -1;
    for (let i = 0; i < instance; i++) {
      from = text.indexOf(oldText, from + 1);
      if (from < 0) return text;
    }
    return text.slice(0, from) + newText + text.slice(from + oldText.length);
  },
  REPLACE: (a, ctx) => {
    requireArgs(a, 4, 4);
    const text = toText(ctx.evalScalar(a[0]));
    const start = Math.trunc(ctx.num(a[1]));
    const n = Math.trunc(ctx.num(a[2]));
    const insert = toText(ctx.evalScalar(a[3]));
    if (start < 1 || n < 0) throw fnError(FORMULA_ERRORS.VALUE);
    return text.slice(0, start - 1) + insert + text.slice(start - 1 + n);
  },
  FIND: (a, ctx) => {
    requireArgs(a, 2, 3);
    const find = toText(ctx.evalScalar(a[0]));
    const within = toText(ctx.evalScalar(a[1]));
    const start = a.length > 2 ? Math.trunc(ctx.num(a[2])) : 1;
    if (start < 1 || start > within.length + (find === '' ? 1 : 0)) throw fnError(FORMULA_ERRORS.VALUE);
    const at = within.indexOf(find, start - 1);
    if (at < 0) throw fnError(FORMULA_ERRORS.VALUE);
    return at + 1;
  },
  SEARCH: (a, ctx) => {
    requireArgs(a, 2, 3);
    const find = toText(ctx.evalScalar(a[0]));
    const within = toText(ctx.evalScalar(a[1]));
    const start = a.length > 2 ? Math.trunc(ctx.num(a[2])) : 1;
    if (start < 1 || start > within.length + (find === '' ? 1 : 0)) throw fnError(FORMULA_ERRORS.VALUE);
    const m = wildcardToRegExp(find, false).exec(within.slice(start - 1));
    if (!m) throw fnError(FORMULA_ERRORS.VALUE);
    return m.index + start;
  },
  REPT: (a, ctx) => {
    requireArgs(a, 2, 2);
    const s = toText(ctx.evalScalar(a[0]));
    const n = Math.trunc(ctx.num(a[1]));
    if (n < 0 || s.length * n > 32767) throw fnError(FORMULA_ERRORS.VALUE);
    return s.repeat(n);
  },
  EXACT: (a, ctx) => {
    requireArgs(a, 2, 2);
    return toText(ctx.evalScalar(a[0])) === toText(ctx.evalScalar(a[1])) ? 1 : 0;
  },
  TEXT: (a, ctx) => {
    requireArgs(a, 2, 2);
    return formatTextValue(ctx.evalScalar(a[0]), toText(ctx.evalScalar(a[1])));
  },

  // ---- Дата ----
  YEAR: (a, ctx) => { requireArgs(a, 1, 1); return serialParts(dateValueToSerial(ctx.evalScalar(a[0]))).y; },
  MONTH: (a, ctx) => { requireArgs(a, 1, 1); return serialParts(dateValueToSerial(ctx.evalScalar(a[0]))).m; },
  DAY: (a, ctx) => { requireArgs(a, 1, 1); return serialParts(dateValueToSerial(ctx.evalScalar(a[0]))).d; },
  WEEKDAY: (a, ctx) => {
    requireArgs(a, 1, 2);
    const dow = serialParts(dateValueToSerial(ctx.evalScalar(a[0]))).dow; // 0 = неділя
    const type = a.length > 1 ? ctx.num(a[1]) : 1;
    if (type === 1) return dow + 1;
    if (type === 2) return (dow + 6) % 7 + 1;
    if (type === 3) return (dow + 6) % 7;
    throw fnError(FORMULA_ERRORS.NUM);
  },
  DATEDIF: (a, ctx) => {
    requireArgs(a, 3, 3);
    const start = dateValueToSerial(ctx.evalScalar(a[0]));
    const end = dateValueToSerial(ctx.evalScalar(a[1]));
    const unit = toText(ctx.evalScalar(a[2])).toLowerCase();
    if (start > end) throw fnError(FORMULA_ERRORS.NUM);
    const s = serialParts(start);
    const e = serialParts(end);
    const months = (e.y - s.y) * 12 + e.m - s.m - (e.d < s.d ? 1 : 0);
    switch (unit) {
      case 'd': return end - start;
      case 'm': return months;
      case 'y': return Math.floor(months / 12);
      case 'ym': return months % 12;
      default: throw fnError(FORMULA_ERRORS.NUM);
    }
  }
});

FORMULA_FUNCTIONS['RANK.EQ'] = FORMULA_FUNCTIONS.RANK;

window.TablesFormulaFunctions = { FORMULA_FUNCTIONS, isFormulaNumber };
