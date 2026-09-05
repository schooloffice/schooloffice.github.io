'use strict';

// ---- Спільний словник між ПЛЮС Таблицями і XLSX ----
// Обидва напрями (експорт і імпорт) читають ці таблиці, щоб мапінг не розповзся.
// Словник стилів у Таблицях закритий (див. ALLOWED_STYLE_CLASSES у workbook-file.js),
// тому повне покриття тут досяжне, а не приблизне.

// Кольори тексту: клас → RGB (як у tables/style.css).
const XLSX_TEXT_COLORS = {
  'style-text-slate': '334155',
  'style-text-red': 'DC2626',
  'style-text-orange': 'EA580C',
  'style-text-amber': 'D97706',
  'style-text-green': '16A34A',
  'style-text-teal': '0F766E',
  'style-text-blue': '2563EB',
  'style-text-indigo': '4F46E5',
  'style-text-purple': '7C3AED',
  'style-text-pink': 'DB2777',
  'style-text-brown': '92400E'
};

// Кольори заливки: клас → RGB.
const XLSX_FILL_COLORS = {
  'style-bg-yellow': 'FEF9C3',
  'style-bg-green': 'DCFCE7',
  'style-bg-red': 'FEE2E2',
  'style-bg-blue': 'DBEAFE',
  'style-bg-indigo': 'E0E7FF',
  'style-bg-purple': 'EDE9FE',
  'style-bg-pink': 'FCE7F3',
  'style-bg-orange': 'FFEDD5',
  'style-bg-gray': 'F1F5F9',
  'style-bg-teal': 'CCFBF1'
};

// Формати чисел: клас → код формату XLSX.
// Коди локале-нейтральні: роздільники Excel підставляє за локаллю користувача.
//
// Відсотки свідомо '0.00%', а не '0.##%': Excel показує роздільник дробу навіть
// тоді, коли необов'язкові розряди порожні, тож '0.##%' дає «85,%» замість «85%».
// Перевірено на Excel 16.0.
const XLSX_NUMBER_FORMATS = {
  'style-num-int': '0',
  'style-num-fixed2': '#,##0.00',
  'style-num-percent': '0.00%',
  'style-num-currency-uah': '#,##0.00" ₴"',
  'style-num-date': 'DD.MM.YYYY',
  'style-num-datetime': 'DD.MM.YYYY HH:MM'
};

// Вбудовані numFmtId, які не треба оголошувати в <numFmts>.
const XLSX_BUILTIN_NUMBER_FORMATS = {
  '0': 1,
  '#,##0.00': 4,
  '0.00%': 10
};

// Мінімальна ширина колонки (в символах Excel), щоб формат не показувався як ####.
const XLSX_MIN_FORMAT_WIDTHS = {
  'style-num-date': 11,
  'style-num-datetime': 17,
  'style-num-currency-uah': 13
};

const XLSX_ALIGNMENTS = {
  'style-align-left': 'left',
  'style-align-center': 'center',
  'style-align-right': 'right'
};

// Умовне форматування: наш op → оператор cfRule.
const XLSX_COND_OPERATORS = {
  gt: 'greaterThan',
  ge: 'greaterThanOrEqual',
  lt: 'lessThan',
  le: 'lessThanOrEqual',
  eq: 'equal',
  ne: 'notEqual',
  between: 'between'
};

// Наші аліаси, яких немає в Excel → канонічні назви Excel.
// Без цього =AVG(A1:A5) відкриється в Excel як #NAME?.
const XLSX_FUNCTION_ALIASES = {
  AVG: 'AVERAGE',
  POW: 'POWER',
  CEIL: 'CEILING'
};

// #CIRC! — власний код ПЛЮС Таблиць; в Excel такого літерала немає.
const XLSX_ERROR_ALIASES = {
  '#CIRC!': '#REF!'
};

function invertMap(map) {
  const out = {};
  for (const key of Object.keys(map)) out[map[key]] = key;
  return out;
}

// ---- XML helpers ----
function xmlEscape(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

// XML 1.0 забороняє більшість керуючих символів. Учнівський текст із
// пошкодженого джерела не повинен зробити файл нечитабельним.
function xmlSafeText(value) {
  // XML 1.0 дозволяє з керуючих символів лише tab, LF і CR. Текст із
  // пошкодженого джерела не повинен зробити весь файл нечитабельним.
  let out = '';
  for (const ch of String(value ?? '')) {
    const code = ch.codePointAt(0);
    if (code < 0x20 && code !== 0x09 && code !== 0x0A && code !== 0x0D) continue;
    out += ch;
  }
  return out;
}

// ---- Ширини колонок ----
// Excel міряє ширину в символах, ми — у пікселях. Стандартне наближення
// для шрифту 11pt: width = (px - 5) / 7.
function pxToExcelWidth(px) {
  const value = (Number(px) - 5) / 7;
  if (!Number.isFinite(value)) return null;
  return Math.round(Math.max(1, Math.min(255, value)) * 100) / 100;
}

function excelWidthToPx(width) {
  const value = Number(width) * 7 + 5;
  if (!Number.isFinite(value)) return null;
  return Math.round(Math.max(50, Math.min(500, value)));
}

// ---- Серіалізація формули з AST у синтаксис Excel ----
// Свідомо йдемо через AST, а не через заміну в рядку: лише так коректно
// нормалізуються роздільник аргументів (; → ,), аліаси функцій і дужки.
const PRECEDENCE = {
  '=': 1, '<>': 1, '<': 1, '>': 1, '<=': 1, '>=': 1,
  '+': 2, '-': 2,
  '*': 3, '/': 3
};

function refToA1(node, withSheet) {
  const col = (typeof indexToCol === 'function') ? indexToCol(node.col) : columnLetters(node.col);
  const cell = `${node.colAbs ? '$' : ''}${col}${node.rowAbs ? '$' : ''}${node.row}`;
  if (!withSheet || !node.sheet) return cell;
  return `${quoteSheetName(node.sheet)}!${cell}`;
}

function columnLetters(index) {
  let n = Number(index);
  let out = '';
  do {
    out = String.fromCharCode(65 + (n % 26)) + out;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return out;
}

function quoteSheetName(name) {
  const s = String(name);
  return /^[A-Za-z_Ѐ-ӿ][A-Za-z0-9_Ѐ-ӿ]*$/.test(s) ? s : `'${s.replace(/'/g, "''")}'`;
}

function astToExcelFormula(node) {
  switch (node?.type) {
    case 'num':
      return node.text != null ? String(node.text) : String(node.value);

    case 'str':
      return `"${String(node.value).replace(/"/g, '""')}"`;

    case 'bool':
      return node.value ? 'TRUE' : 'FALSE';

    case 'err':
      return XLSX_ERROR_ALIASES[node.value] || node.value;

    case 'ref':
      return refToA1(node, true);

    case 'range':
      // Excel ставить префікс аркуша лише перед початком діапазону.
      return `${refToA1(node.start, true)}:${refToA1(node.end, false)}`;

    case 'unary':
      if (node.op === '%post') return `${wrap(node.operand, 5)}%`;
      return `${node.op}${wrap(node.operand, 4)}`;

    case 'binary': {
      const prec = PRECEDENCE[node.op] || 1;
      const left = wrap(node.left, prec);
      // Для віднімання й ділення правий операнд однакового пріоритету
      // потребує дужок: a-(b-c) не дорівнює a-b-c.
      const rightNeedsParens = (node.op === '-' || node.op === '/');
      const right = wrap(node.right, rightNeedsParens ? prec + 1 : prec);
      return `${left}${node.op}${right}`;
    }

    case 'call': {
      const name = excelFunctionName(node);
      return `${name}(${node.args.map(astToExcelFormula).join(',')})`;
    }

    default:
      throw new Error('Невідомий вузол формули');
  }
}

// CONCAT з'явився лише в Excel 2019/365 — у старіших збірках він дає #NAME?
// (перевірено на Excel 16.0). CONCATENATE розуміють усі версії, але він не
// приймає діапазон: там, де діапазон є, лишаємо CONCAT, бо CONCATENATE дав би
// тихо неправильну відповідь замість помітної помилки.
function excelFunctionName(node) {
  if (node.name === 'CONCAT' && !node.args.some(arg => arg && arg.type === 'range')) {
    return 'CONCATENATE';
  }
  return XLSX_FUNCTION_ALIASES[node.name] || node.name;
}

function wrap(node, minPrecedence) {
  const text = astToExcelFormula(node);
  const prec = nodePrecedence(node);
  return prec < minPrecedence ? `(${text})` : text;
}

function nodePrecedence(node) {
  if (node?.type === 'binary') return PRECEDENCE[node.op] || 1;
  if (node?.type === 'unary') return node.op === '%post' ? 5 : 4;
  return 99;
}

// Перекласти формулу ПЛЮС Таблиць (без '=') у формулу Excel.
// Якщо розібрати не вдалося — повертає null, викликач збереже текст як є.
function toExcelFormula(source) {
  try {
    const parse = window.TablesFormulaParser?.parseFormula;
    if (!parse) return null;
    return astToExcelFormula(parse(String(source)));
  } catch (e) {
    return null;
  }
}

window.TablesXlsxFormat = {
  XLSX_TEXT_COLORS,
  XLSX_FILL_COLORS,
  XLSX_NUMBER_FORMATS,
  XLSX_BUILTIN_NUMBER_FORMATS,
  XLSX_MIN_FORMAT_WIDTHS,
  XLSX_ALIGNMENTS,
  XLSX_COND_OPERATORS,
  XLSX_FUNCTION_ALIASES,
  TEXT_COLORS_BY_RGB: invertMap(XLSX_TEXT_COLORS),
  FILL_COLORS_BY_RGB: invertMap(XLSX_FILL_COLORS),
  NUMBER_CLASSES_BY_CODE: invertMap(XLSX_NUMBER_FORMATS),
  COND_OPS_BY_XLSX: invertMap(XLSX_COND_OPERATORS),
  xmlEscape,
  xmlSafeText,
  pxToExcelWidth,
  excelWidthToPx,
  columnLetters,
  quoteSheetName,
  toExcelFormula,
  astToExcelFormula
};
