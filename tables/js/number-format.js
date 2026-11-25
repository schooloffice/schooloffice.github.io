// ---- Number formats (Формат клітинок) ----
// Формат числа — це лише СПОСІБ ПОКАЗУ: збережене значення й формули лишаються числами.
// Формат зберігається в cellStyles поряд з іншими класами оформлення як службовий клас
// `style-nf-…` (тому він сам їде в історію, чернетки, .arttab, сортування й зсув рядків):
//   style-nf-num-<d>[-t]            числовий, d знаків, -t — з пропуском між тисячами
//   style-nf-cur-<d>-<uah|usd|eur>  грошовий (символ після числа)
//   style-nf-pct-<d>                відсотковий
//   style-nf-date-<dmy|dmmmy|dmmmmy|dmyhm>   дата / дата і час
//   style-nf-time-<hm|hms>          час
//   style-nf-frac-<1|2>             дробовий: # ?/? або # ??/??
//   style-nf-sci-<d>                експоненційний: 0,00E+00
//   style-nf-text                   текстовий (@): значення показується як введено
// Загальний формат — відсутність такого класу. Старі класи style-num-* лишаються дійсними.
// Код нижче написано за описом кодів формату в ECMA-376 (розд. 18.8.30–18.8.31).
(function (root) {
  'use strict';

  const TOKEN_PREFIX = 'style-nf-';
  const NBSP = ' '; // як у toLocaleString('uk-UA') — розділювач тисяч і пропуск перед ₴ та %
  const MAX_DECIMALS = 10;
  const CURRENCY_SYMBOLS = { uah: '₴', usd: '$', eur: '€' };
  const MONTHS_SHORT = ['січ', 'лют', 'бер', 'кві', 'тра', 'чер', 'лип', 'сер', 'вер', 'жов', 'лис', 'гру'];
  const MONTHS_LONG = ['січня', 'лютого', 'березня', 'квітня', 'травня', 'червня', 'липня', 'серпня', 'вересня', 'жовтня', 'листопада', 'грудня'];
  const DATE_PATTERNS = ['dmy', 'dmmmy', 'dmmmmy', 'dmyhm'];
  const TIME_PATTERNS = ['hm', 'hms'];
  const EPOCH_UTC = Date.UTC(1899, 11, 30); // серіали, сумісні з Excel
  const MAX_SERIAL = 2958465;               // 31.12.9999
  const TOKEN_RE = /^style-nf-(?:num-(\d{1,2})(-t)?|cur-(\d{1,2})-(uah|usd|eur)|pct-(\d{1,2})|date-(dmy|dmmmy|dmmmmy|dmyhm)|time-(hm|hms)|frac-([12])|sci-(\d{1,2})|text)$/;

  // Старі класи: показ лишається таким, яким був, але для панелі й XLSX вони мають рівні нових.
  const LEGACY_TOKENS = {
    'style-num-int': 'style-nf-num-0',
    'style-num-fixed2': 'style-nf-num-2-t',
    'style-num-percent': 'style-nf-pct-0',
    'style-num-currency-uah': 'style-nf-cur-2-uah',
    'style-num-date': 'style-nf-date-dmy',
    'style-num-datetime': 'style-nf-date-dmyhm'
  };

  const CATEGORIES = [
    { id: 'general', label: 'Загальний' },
    { id: 'number', label: 'Числовий' },
    { id: 'currency', label: 'Грошовий' },
    { id: 'percent', label: 'Відсотковий' },
    { id: 'date', label: 'Дата' },
    { id: 'time', label: 'Час' },
    { id: 'fraction', label: 'Дробовий' },
    { id: 'scientific', label: 'Експоненційний' },
    { id: 'text', label: 'Текстовий' }
  ];

  function clampDecimals(value, fallback = 2) {
    const n = Math.floor(Number(value));
    return Number.isFinite(n) ? Math.max(0, Math.min(MAX_DECIMALS, n)) : fallback;
  }

  // ---- Специфікація ⇄ службовий клас ----
  function parseToken(token) {
    const m = TOKEN_RE.exec(String(token || ''));
    if (!m) return null;
    const decimals = value => Number(value);
    // Не більше 10 знаків після коми (як у діалозі); токен без нормалізованого вигляду відхиляємо.
    if ([m[1], m[3], m[5], m[9]].some(value => value !== undefined && (Number(value) > MAX_DECIMALS || (value.length > 1 && value[0] === '0')))) return null;
    if (m[1] !== undefined) return { kind: 'number', decimals: decimals(m[1]), thousands: !!m[2] };
    if (m[3] !== undefined) return { kind: 'currency', decimals: decimals(m[3]), currency: m[4] };
    if (m[5] !== undefined) return { kind: 'percent', decimals: decimals(m[5]) };
    if (m[6] !== undefined) return { kind: 'date', pattern: m[6] };
    if (m[7] !== undefined) return { kind: 'time', pattern: m[7] };
    if (m[8] !== undefined) return { kind: 'fraction', digits: Number(m[8]) };
    if (m[9] !== undefined) return { kind: 'scientific', decimals: decimals(m[9]) };
    return { kind: 'text' };
  }

  function isToken(token) {
    return !!parseToken(token);
  }

  // '' — Загальний (клас не потрібен).
  function tokenOf(spec) {
    if (!spec) return '';
    switch (spec.kind) {
      case 'number': return `${TOKEN_PREFIX}num-${clampDecimals(spec.decimals)}${spec.thousands ? '-t' : ''}`;
      case 'currency': return `${TOKEN_PREFIX}cur-${clampDecimals(spec.decimals)}-${CURRENCY_SYMBOLS[spec.currency] ? spec.currency : 'uah'}`;
      case 'percent': return `${TOKEN_PREFIX}pct-${clampDecimals(spec.decimals, 0)}`;
      case 'date': return `${TOKEN_PREFIX}date-${DATE_PATTERNS.includes(spec.pattern) ? spec.pattern : 'dmy'}`;
      case 'time': return `${TOKEN_PREFIX}time-${TIME_PATTERNS.includes(spec.pattern) ? spec.pattern : 'hm'}`;
      case 'fraction': return `${TOKEN_PREFIX}frac-${spec.digits === 2 ? 2 : 1}`;
      case 'scientific': return `${TOKEN_PREFIX}sci-${clampDecimals(spec.decimals)}`;
      case 'text': return `${TOKEN_PREFIX}text`;
      default: return '';
    }
  }

  // Усі класи формату числа в рядку/списку класів (нові й старі) — щоб їх замінювати.
  function isFormatClass(cls) {
    return isToken(cls) || Object.prototype.hasOwnProperty.call(LEGACY_TOKENS, cls);
  }

  function classNames(source) {
    if (!source) return [];
    if (typeof source === 'string') return source.split(/\s+/).filter(Boolean);
    return Array.from(source);
  }

  // Токен формату з рядка стилю або classList; старі класи перетворюються на еквівалент.
  function tokenFromClasses(source) {
    const list = classNames(source);
    const own = list.find(isToken);
    if (own) return own;
    const legacy = list.find(cls => Object.prototype.hasOwnProperty.call(LEGACY_TOKENS, cls));
    return legacy ? LEGACY_TOKENS[legacy] : '';
  }

  function specFromClasses(source) {
    return parseToken(tokenFromClasses(source));
  }

  // ---- Показ ----
  function toNumber(value) {
    if (typeof value === 'number') return value;
    const text = String(value ?? '').trim();
    if (text === '') return NaN;
    return Number(text.replace(',', '.'));
  }

  // Округлення «від нуля» за десятковим записом (1,005 → 1,01), без помилок двійкових дробів.
  function roundDecimal(abs, digits) {
    const text = String(abs);
    if (/e/i.test(text)) return abs;
    return Number(`${Math.round(Number(`${text}e${digits}`))}e-${digits}`);
  }

  function groupThousands(intText) {
    return intText.replace(/\B(?=(\d{3})+(?!\d))/g, NBSP);
  }

  // Число з комою й (за потреби) пропусками між тисячами; null — число завелике для запису.
  function decimalText(abs, decimals, thousands) {
    if (!Number.isFinite(abs) || abs >= 1e21) return null;
    const [int, frac = ''] = roundDecimal(abs, decimals).toFixed(decimals).split('.');
    return (thousands ? groupThousands(int) : int) + (frac ? `,${frac}` : '');
  }

  function signed(num, text) {
    return num < 0 && /[1-9]/.test(text) ? `-${text}` : text;
  }

  function formatNumber(num, spec) {
    const body = decimalText(Math.abs(num), spec.decimals, spec.thousands);
    return body === null ? null : signed(num, body);
  }

  function formatCurrency(num, spec) {
    const body = decimalText(Math.abs(num), spec.decimals, true);
    return body === null ? null : `${signed(num, body)}${NBSP}${CURRENCY_SYMBOLS[spec.currency] || '₴'}`;
  }

  function formatPercent(num, spec) {
    const abs = Math.abs(num);
    const text = String(abs);
    const scaled = /e/i.test(text) ? abs * 100 : Number(`${text}e2`); // зсув коми без похибки
    const body = decimalText(scaled, spec.decimals, false);
    return body === null ? null : `${signed(num, body)}${NBSP}%`;
  }

  function formatScientific(num, spec) {
    if (!Number.isFinite(num)) return null;
    const [mantissa, exponent] = Math.abs(num).toExponential(spec.decimals).split('e');
    const exp = Number(exponent);
    const body = `${mantissa.replace('.', ',')}E${exp < 0 ? '-' : '+'}${String(Math.abs(exp)).padStart(2, '0')}`;
    return num < 0 ? `-${body}` : body;
  }

  // Найближчий дріб із знаменником до 9 (# ?/?) або до 99 (# ??/??).
  function formatFraction(num, spec) {
    const abs = Math.abs(num);
    if (!Number.isFinite(abs) || abs >= 1e15) return null;
    const maxDen = spec.digits === 2 ? 99 : 9;
    let whole = Math.floor(abs);
    const part = abs - whole;
    let bestN = 0;
    let bestD = 1;
    let bestErr = part;
    for (let d = 2; d <= maxDen; d++) {
      const n = Math.round(part * d);
      const err = Math.abs(part - n / d);
      if (n > 0 && n < d && err < bestErr - 1e-12) { bestN = n; bestD = d; bestErr = err; }
    }
    if (1 - part < bestErr) { whole += 1; bestN = 0; } // 0,97 ближче до 1, ніж до будь-якого дробу
    const sign = num < 0 && (whole > 0 || bestN > 0) ? '-' : '';
    if (bestN === 0) return `${sign}${whole}`;
    return `${sign}${whole > 0 ? `${whole} ` : ''}${bestN}/${bestD}`;
  }

  function isoToSerial(text) {
    const m = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?$/.exec(text);
    if (!m) return NaN;
    return (Date.UTC(+m[1], +m[2] - 1, +m[3]) - EPOCH_UTC) / 86400000 + (+(m[4] || 0) * 3600 + +(m[5] || 0) * 60 + +(m[6] || 0)) / 86400;
  }

  function dateParts(serial) {
    if (!Number.isFinite(serial) || serial < 0 || serial > MAX_SERIAL) return null;
    const total = Math.round(serial * 86400);
    const day = Math.floor(total / 86400);
    const sec = total - day * 86400;
    const dt = new Date(EPOCH_UTC + day * 86400000);
    return { y: dt.getUTCFullYear(), m: dt.getUTCMonth(), d: dt.getUTCDate(), hh: Math.floor(sec / 3600), mm: Math.floor(sec / 60) % 60, ss: sec % 60 };
  }

  const pad2 = n => String(n).padStart(2, '0');

  function formatDate(serial, spec) {
    const p = dateParts(serial);
    if (!p) return null;
    switch (spec.pattern) {
      case 'dmmmy': return `${p.d} ${MONTHS_SHORT[p.m]} ${p.y}`;
      case 'dmmmmy': return `${p.d} ${MONTHS_LONG[p.m]} ${p.y}`;
      case 'dmyhm': return `${pad2(p.d)}.${pad2(p.m + 1)}.${p.y} ${pad2(p.hh)}:${pad2(p.mm)}`;
      default: return `${pad2(p.d)}.${pad2(p.m + 1)}.${p.y}`;
    }
  }

  function formatTime(serial, spec) {
    const p = dateParts(serial);
    if (!p) return null;
    return spec.pattern === 'hms' ? `${pad2(p.hh)}:${pad2(p.mm)}:${pad2(p.ss)}` : `${pad2(p.hh)}:${pad2(p.mm)}`;
  }

  // Рядок для показу в клітинці. Те, що не є числом (текст, коди помилок), лишається як є.
  function format(spec, value) {
    const raw = String(value ?? '');
    if (!spec || raw.trim() === '') return raw;
    if (spec.kind === 'text') return raw;
    let num = toNumber(value);
    if (!Number.isFinite(num) && (spec.kind === 'date' || spec.kind === 'time')) num = isoToSerial(raw.trim());
    if (!Number.isFinite(num)) return raw;
    let text = null;
    switch (spec.kind) {
      case 'number': text = formatNumber(num, spec); break;
      case 'currency': text = formatCurrency(num, spec); break;
      case 'percent': text = formatPercent(num, spec); break;
      case 'date': text = formatDate(num, spec); break;
      case 'time': text = formatTime(num, spec); break;
      case 'fraction': text = formatFraction(num, spec); break;
      case 'scientific': text = formatScientific(num, spec); break;
      default: break;
    }
    return text === null ? raw : text;
  }

  // Для діалогу: категорія та її параметри за специфікацією.
  function categoryOf(spec) {
    return spec ? ({ number: 'number', currency: 'currency', percent: 'percent', date: 'date', time: 'time', fraction: 'fraction', scientific: 'scientific', text: 'text' })[spec.kind] || 'general' : 'general';
  }

  // ---- XLSX: специфікація → numFmtId / formatCode ----
  const zeros = n => (n > 0 ? `.${'0'.repeat(n)}` : '');

  function toExcel(spec) {
    if (!spec) return { id: 0, code: 'General' };
    switch (spec.kind) {
      case 'number': {
        const d = clampDecimals(spec.decimals);
        if (!spec.thousands) return d === 0 ? { id: 1, code: '0' } : d === 2 ? { id: 2, code: '0.00' } : { id: null, code: `0${zeros(d)}` };
        return d === 0 ? { id: 3, code: '#,##0' } : d === 2 ? { id: 4, code: '#,##0.00' } : { id: null, code: `#,##0${zeros(d)}` };
      }
      case 'currency': return { id: null, code: `#,##0${zeros(clampDecimals(spec.decimals))}" ${CURRENCY_SYMBOLS[spec.currency] || '₴'}"` };
      case 'percent': {
        const d = clampDecimals(spec.decimals, 0);
        return d === 0 ? { id: 9, code: '0%' } : d === 2 ? { id: 10, code: '0.00%' } : { id: null, code: `0${zeros(d)}%` };
      }
      case 'date': return { id: null, code: ({ dmy: 'dd\\.mm\\.yyyy', dmmmy: 'd\\ mmm\\ yyyy', dmmmmy: 'd\\ mmmm\\ yyyy', dmyhm: 'dd\\.mm\\.yyyy\\ hh:mm' })[spec.pattern] || 'dd\\.mm\\.yyyy' };
      case 'time': return { id: null, code: spec.pattern === 'hms' ? 'hh:mm:ss' : 'hh:mm' };
      case 'fraction': return spec.digits === 2 ? { id: 13, code: '# ??/??' } : { id: 12, code: '# ?/?' };
      case 'scientific': {
        const d = clampDecimals(spec.decimals);
        return d === 2 ? { id: 11, code: '0.00E+00' } : { id: null, code: `0${zeros(d)}E+00` };
      }
      case 'text': return { id: 49, code: '@' };
      default: return { id: 0, code: 'General' };
    }
  }

  // ---- XLSX: numFmtId / formatCode → специфікація ----
  const BUILTIN_TOKENS = {
    1: 'style-nf-num-0', 2: 'style-nf-num-2', 3: 'style-nf-num-0-t', 4: 'style-nf-num-2-t',
    5: 'style-nf-cur-0-usd', 6: 'style-nf-cur-0-usd', 7: 'style-nf-cur-2-usd', 8: 'style-nf-cur-2-usd',
    9: 'style-nf-pct-0', 10: 'style-nf-pct-2', 11: 'style-nf-sci-2', 12: 'style-nf-frac-1', 13: 'style-nf-frac-2',
    14: 'style-nf-date-dmy', 15: 'style-nf-date-dmmmy', 20: 'style-nf-time-hm', 21: 'style-nf-time-hms',
    22: 'style-nf-date-dmyhm', 37: 'style-nf-num-0-t', 38: 'style-nf-num-0-t', 39: 'style-nf-num-2-t', 40: 'style-nf-num-2-t',
    41: 'style-nf-num-0-t', 42: 'style-nf-cur-0-usd', 43: 'style-nf-num-2-t', 44: 'style-nf-cur-2-usd',
    46: 'style-nf-time-hms', 48: 'style-nf-sci-1', 49: 'style-nf-text'
  };
  // Локалізовані формати дати Excel (залежать від мови Windows): показуємо як ДД.ММ.РРРР.
  const LOCALE_DATE_IDS = new Set([27, 28, 29, 30, 31, 34, 35, 36, 50, 51, 52, 53, 54, 55, 56, 57, 58]);

  function currencyCode(symbol) {
    const s = String(symbol || '').trim();
    if (s === '₴' || /^грн\.?$/i.test(s) || /^UAH$/i.test(s)) return 'uah';
    if (s === '$' || /^USD$/i.test(s)) return 'usd';
    if (s === '€' || /^EUR$/i.test(s)) return 'eur';
    return '';
  }

  // Перша секція коду формату без кольорів, ширинних символів і умов.
  function scanFormatCode(code) {
    const source = String(code || '');
    const chars = [];
    const literals = [];
    let currency = '';
    let unsupported = false;
    for (let i = 0; i < source.length; i++) {
      const ch = source[i];
      if (ch === ';') break;
      if (ch === '"') {
        const end = source.indexOf('"', i + 1);
        const text = end < 0 ? source.slice(i + 1) : source.slice(i + 1, end);
        literals.push(text);
        i = end < 0 ? source.length : end;
      } else if (ch === '\\') {
        if (i + 1 < source.length) literals.push(source[i + 1]);
        i++;
      } else if (ch === '_' || ch === '*') {
        i++;
      } else if (ch === '[') {
        const end = source.indexOf(']', i);
        const inner = end < 0 ? source.slice(i + 1) : source.slice(i + 1, end);
        i = end < 0 ? source.length : end;
        if (inner[0] === '$') literals.push(inner.slice(1).split('-')[0]);
        else if (/^(red|blue|green|black|white|cyan|magenta|yellow|color\s*\d+)$/i.test(inner)) continue;
        else unsupported = true; // умова [>100] або тривалість [h]
      } else {
        chars.push(ch);
      }
    }
    const spaceless = literals.filter(text => text.trim() !== '');
    for (const text of spaceless) {
      const found = currencyCode(text);
      if (found && !currency) currency = found;
    }
    const foreignLiteral = spaceless.some(text => !currencyCode(text));
    return { chars: chars.join(''), currency, foreignLiteral, unsupported };
  }

  function dateTimeToken(chars) {
    const text = chars.toLowerCase();
    const runs = [];
    for (let i = 0; i < text.length;) {
      const ch = text[i];
      if (!'ymdhs'.includes(ch)) { i++; continue; }
      let j = i;
      while (text[j] === ch) j++;
      runs.push({ ch, len: j - i });
      i = j;
    }
    // m після h або перед s — хвилини, інакше місяць.
    runs.forEach((run, index) => {
      if (run.ch !== 'm') return;
      if (runs[index - 1]?.ch === 'h' || runs[index + 1]?.ch === 's') run.ch = 'n';
    });
    const find = ch => runs.filter(run => run.ch === ch);
    const years = find('y');
    const months = find('m');
    const days = find('d');
    const hours = find('h');
    const minutes = find('n');
    const seconds = find('s');
    const single = list => list.length <= 1;
    if (!single(years) || !single(months) || !single(days) || !single(hours) || !single(minutes) || !single(seconds)) return null;
    const hasDate = years.length || months.length || days.length;
    if (hasDate) {
      if (!years.length || !months.length || !days.length) return null;
      if (![2, 4].includes(years[0].len) || days[0].len > 2) return null;
      const hasTime = hours.length || minutes.length || seconds.length;
      if (hasTime && !(hours.length && minutes.length && !seconds.length && months[0].len <= 2)) return null;
      if (months[0].len <= 2) return hasTime ? 'style-nf-date-dmyhm' : 'style-nf-date-dmy';
      return months[0].len === 3 ? 'style-nf-date-dmmmy' : months[0].len === 4 ? 'style-nf-date-dmmmmy' : null;
    }
    if (hours.length && minutes.length && hours[0].len <= 2) return seconds.length ? 'style-nf-time-hms' : 'style-nf-time-hm';
    return null;
  }

  function numericToken(scan) {
    const text = scan.chars.replace(/[\s()+-]/g, '');
    if (/e[+-]/i.test(scan.chars)) {
      const mantissa = text.split(/e/i)[0];
      const m = /^[#0?]*(?:\.([#0?]*))?$/.exec(mantissa);
      return m && !scan.currency && !scan.foreignLiteral && (m[1] || '').length <= MAX_DECIMALS ? `style-nf-sci-${(m[1] || '').length}` : null;
    }
    if (text.includes('/')) {
      const m = /^[#0?]*[#0?]\/([#0?]+)$/.exec(text);
      if (!m || scan.currency || scan.foreignLiteral || m[1].length > 2) return null;
      return `style-nf-frac-${m[1].length}`;
    }
    const percent = text.includes('%');
    const m = /^([#0?,]*[#0?])(?:\.([#0?]*))?$/.exec(text.replace('%', ''));
    if (!m || text.split('%').length > 2 || scan.foreignLiteral) return null;
    const decimals = (m[2] || '').length;
    if (decimals > MAX_DECIMALS) return null;
    if (percent) return scan.currency ? null : `style-nf-pct-${decimals}`;
    if (scan.currency) return `style-nf-cur-${decimals}-${scan.currency}`;
    return `style-nf-num-${decimals}${m[1].includes(',') ? '-t' : ''}`;
  }

  // { token } — відомий формат; { unknown } — код, який ПЛЮС не вміє (показуємо як Загальний);
  // {} — Загальний.
  function fromExcel(id, code) {
    const fmtId = Number(id) || 0;
    const custom = String(code || '');
    if (!custom) {
      if (fmtId === 0) return {};
      if (BUILTIN_TOKENS[fmtId]) return { token: BUILTIN_TOKENS[fmtId] };
      if (LOCALE_DATE_IDS.has(fmtId)) return { token: 'style-nf-date-dmy' };
      return fmtId >= 164 ? {} : { unknown: `№${fmtId}` };
    }
    if (/^general$/i.test(custom.trim())) return {};
    if (/(?:^|[^\\])(?:AM\/PM|A\/P)/i.test(custom)) return { unknown: custom };
    const scan = scanFormatCode(custom);
    if (scan.unsupported) return { unknown: custom };
    if (scan.chars.trim() === '@') return { token: 'style-nf-text' };
    const token = /[ymdhs]/i.test(scan.chars.replace(/e[+-]/gi, '')) ? dateTimeToken(scan.chars) : numericToken(scan);
    return token && isToken(token) ? { token } : { unknown: custom };
  }

  const api = {
    CATEGORIES,
    CURRENCY_SYMBOLS,
    DATE_PATTERNS,
    LEGACY_TOKENS,
    MAX_DECIMALS,
    TIME_PATTERNS,
    TOKEN_PREFIX,
    categoryOf,
    format,
    fromExcel,
    isFormatClass,
    isToken,
    parseToken,
    specFromClasses,
    toExcel,
    tokenFromClasses,
    tokenOf
  };
  root.TablesNumberFormat = api;
}(typeof globalThis !== 'undefined' ? globalThis : this));
