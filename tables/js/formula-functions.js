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
  TRUE: () => 1,
  FALSE: () => 0,
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

  ROUNDUP: (a, ctx) => roundAwayOrToward(a, ctx, Math.ceil, Math.floor),
  ROUNDDOWN: (a, ctx) => roundAwayOrToward(a, ctx, Math.floor, Math.ceil),

  // Дати (повертають серійний номер; формат «Дата» показує DD.MM.YYYY)
  TODAY: () => todaySerial(),
  NOW: () => nowSerial(),
  DATE: (a, ctx) => ymdToSerial(ctx.num(a[0]), ctx.num(a[1]), ctx.num(a[2])),

  // ---- Обробка помилок ----
  // IFERROR обчислює перший аргумент ліниво: у цьому й сенс — підмінити
  // помилку запасним значенням, як в Excel.
  // Циклічне посилання свідомо НЕ ловимо: це структурна помилка учня, і
  // сховати її під запасним значенням означало б зробити її невидимою.
  IFERROR: (a, ctx) => {
    if (a.length < 2) throw formulaError(FORMULA_ERRORS.VALUE);
    try {
      return ctx.evalScalar(a[0]);
    } catch (e) {
      if (e && e.message === FORMULA_ERRORS.CIRC) throw e;
      return ctx.evalScalar(a[1]);
    }
  },

  // ---- Пошук і підстановка ----
  // VLOOKUP(шукане; таблиця; номер_стовпця; [наближено])
  // Останній аргумент за замовчуванням TRUE — так само, як в Excel, щоб
  // імпортовані книги рахувалися однаково.
  VLOOKUP: (a, ctx) => {
    if (a.length < 3) throw formulaError(FORMULA_ERRORS.VALUE);
    const needle = ctx.evalScalar(a[0]);
    const grid = ctx.collectMatrix(a[1]);
    const colIndex = Math.trunc(ctx.num(a[2]));
    const approximate = a.length > 3 ? ctx.isTruthy(ctx.evalScalar(a[3])) : true;

    if (colIndex < 1) throw formulaError(FORMULA_ERRORS.VALUE);
    if (colIndex > grid.cols) throw formulaError(FORMULA_ERRORS.REF);

    const rowIndex = findLookupRow(needle, r => grid.get(r, 0), grid.rows, approximate ? 1 : 0);
    if (rowIndex < 0) throw formulaError(FORMULA_ERRORS.NA);
    return grid.get(rowIndex, colIndex - 1);
  },

  // MATCH(шукане; діапазон; [тип]) → позиція від 1.
  // Тип: 1 (за зростанням, за замовчуванням), 0 (точний), -1 (за спаданням).
  MATCH: (a, ctx) => {
    if (a.length < 2) throw formulaError(FORMULA_ERRORS.VALUE);
    const needle = ctx.evalScalar(a[0]);
    const grid = ctx.collectMatrix(a[1]);
    const matchType = a.length > 2 ? Math.trunc(ctx.num(a[2])) : 1;

    // Діапазон для MATCH одновимірний: або рядок, або стовпець.
    if (grid.rows > 1 && grid.cols > 1) throw formulaError(FORMULA_ERRORS.NA);
    const length = grid.rows > 1 ? grid.rows : grid.cols;
    const at = i => (grid.rows > 1 ? grid.get(i, 0) : grid.get(0, i));

    const index = findLookupRow(needle, at, length, matchType);
    if (index < 0) throw formulaError(FORMULA_ERRORS.NA);
    return index + 1;
  },

  // INDEX(діапазон; номер_рядка; [номер_стовпця]) — нумерація від 1.
  // Для одновимірного діапазону досить одного номера.
  INDEX: (a, ctx) => {
    if (a.length < 2) throw formulaError(FORMULA_ERRORS.VALUE);
    const grid = ctx.collectMatrix(a[0]);
    const first = Math.trunc(ctx.num(a[1]));
    const second = a.length > 2 ? Math.trunc(ctx.num(a[2])) : null;

    let row;
    let col;
    if (second === null && (grid.rows === 1 || grid.cols === 1)) {
      // Один номер уздовж єдиного виміру.
      row = grid.rows === 1 ? 1 : first;
      col = grid.rows === 1 ? first : 1;
    } else {
      row = first;
      col = second === null ? 1 : second;
    }

    if (row < 1 || col < 1 || row > grid.rows || col > grid.cols) {
      throw formulaError(FORMULA_ERRORS.REF);
    }
    return grid.get(row - 1, col - 1);
  },

  // RANK(число; діапазон; [порядок]) — 0 або пропущено: за спаданням.
  // Однакові значення отримують однаковий ранг, як в Excel.
  RANK: (a, ctx) => {
    if (a.length < 2) throw formulaError(FORMULA_ERRORS.VALUE);
    const target = ctx.num(a[0]);
    const values = numericValues([a[1]], ctx);
    const ascending = a.length > 2 && ctx.num(a[2]) !== 0;

    if (!values.includes(target)) throw formulaError(FORMULA_ERRORS.NA);
    const better = values.filter(v => (ascending ? v < target : v > target)).length;
    return better + 1;
  },

  // ---- Текстові ----
  LEN: (a, ctx) => ctx.text(a[0]).length,
  LEFT: (a, ctx) => {
    const count = a.length > 1 ? Math.trunc(ctx.num(a[1])) : 1;
    if (count < 0) throw formulaError(FORMULA_ERRORS.VALUE);
    return ctx.text(a[0]).slice(0, count);
  },
  RIGHT: (a, ctx) => {
    const count = a.length > 1 ? Math.trunc(ctx.num(a[1])) : 1;
    if (count < 0) throw formulaError(FORMULA_ERRORS.VALUE);
    const text = ctx.text(a[0]);
    return count === 0 ? '' : text.slice(Math.max(0, text.length - count));
  },
  MID: (a, ctx) => {
    if (a.length < 3) throw formulaError(FORMULA_ERRORS.VALUE);
    const start = Math.trunc(ctx.num(a[1]));
    const count = Math.trunc(ctx.num(a[2]));
    if (start < 1 || count < 0) throw formulaError(FORMULA_ERRORS.VALUE);
    return ctx.text(a[0]).slice(start - 1, start - 1 + count);
  },
  // CONCAT приймає й діапазони (як у сучасному Excel); CONCATENATE лишаємо
  // аліасом, бо саме ця назва досі в підручниках.
  CONCAT: (a, ctx) => ctx.collectValues(a).map(v => (v === null ? '' : String(v))).join(''),
  CONCATENATE: (a, ctx) => FORMULA_FUNCTIONS.CONCAT(a, ctx)
};

// ROUNDUP округлює від нуля, ROUNDDOWN — до нуля; для від'ємних чисел
// напрямок дзеркальний, тому обидві дії приходять параметрами.
function roundAwayOrToward(argNodes, ctx, positiveRound, negativeRound) {
  const value = ctx.num(argNodes[0]);
  const digits = argNodes.length > 1 ? Math.trunc(ctx.num(argNodes[1])) : 0;
  const factor = Math.pow(10, digits);
  const scaled = value * factor;
  const rounded = scaled >= 0 ? positiveRound(scaled) : negativeRound(scaled);
  return rounded / factor;
}

// Спільний пошук для VLOOKUP і MATCH.
// matchType 0 — точний збіг; 1 — найбільше значення ≤ шуканого (дані за
// зростанням); -1 — найменше значення ≥ шуканого (дані за спаданням).
// Повертає індекс від 0 або -1.
function findLookupRow(needle, valueAt, length, matchType) {
  if (matchType === 0) {
    for (let i = 0; i < length; i++) {
      if (looseEquals(valueAt(i), needle)) return i;
    }
    return -1;
  }

  let best = -1;
  for (let i = 0; i < length; i++) {
    const current = valueAt(i);
    if (current === null) continue;
    const cmp = compareLookupValues(current, needle);
    if (cmp === null) continue;
    if (matchType > 0 ? cmp <= 0 : cmp >= 0) best = i;
    else break; // дані відсортовані, далі шукати немає сенсу
  }
  return best;
}

// Порівняння як в Excel: числа з числами, інакше текст без урахування регістру.
function compareLookupValues(a, b) {
  const an = valueToNumberOrNull(a);
  const bn = valueToNumberOrNull(b);
  if (an !== null && bn !== null) return an === bn ? 0 : (an < bn ? -1 : 1);
  if (an !== null || bn !== null) return null; // різні типи — не порівнюємо
  const as = String(a ?? '').toLowerCase();
  const bs = String(b ?? '').toLowerCase();
  return as === bs ? 0 : (as < bs ? -1 : 1);
}

function looseEquals(a, b) {
  const cmp = compareLookupValues(a, b);
  return cmp === 0;
}

window.TablesFormulaFunctions = { FORMULA_FUNCTIONS, isFormulaNumber };
