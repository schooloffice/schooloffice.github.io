'use strict';

// ---- Table model config and shared state ----
const DEFAULT_ROWS = 60;
const DEFAULT_COL_COUNT = 30; // A..AD
const MAX_CALC_DEPTH = 60;
const MAX_CELL_LEN = 200;

let ROWS = DEFAULT_ROWS;
let COL_COUNT = DEFAULT_COL_COUNT;
let COLS = buildCols(COL_COUNT);

// Глобали = «активний аркуш». Усі аркуші зберігаються в sheets[].
let cellData = {};
let colWidths = {};
let cellStyles = {};
let condRules = []; // умовне форматування: [{ range:[cMin,rMin,cMax,rMax], op, v1, v2, fill }]

let sheets = [];      // [{ name, cellData, cellStyles, colWidths, condRules, rows, cols }]
let activeSheet = 0;

function makeSheet(name) {
  return {
    name: name || 'Аркуш',
    cellData: {},
    cellStyles: {},
    colWidths: {},
    condRules: [],
    rows: DEFAULT_ROWS,
    cols: DEFAULT_COL_COUNT
  };
}

function normalizeSheet(s) {
  return {
    name: String(s?.name || 'Аркуш'),
    cellData: s?.cellData && typeof s.cellData === 'object' ? s.cellData : {},
    cellStyles: s?.cellStyles && typeof s.cellStyles === 'object' ? s.cellStyles : {},
    colWidths: s?.colWidths && typeof s.colWidths === 'object' ? s.colWidths : {},
    condRules: Array.isArray(s?.condRules) ? s.condRules : [],
    rows: Math.max(1, Math.min(500, Number(s?.rows) || DEFAULT_ROWS)),
    cols: Math.max(1, Math.min(200, Number(s?.cols) || DEFAULT_COL_COUNT))
  };
}

// Записати поточні глобали в активний аркуш (перед перемиканням/збереженням).
function syncActiveSheetFromGlobals() {
  const s = sheets[activeSheet];
  if (!s) return;
  s.cellData = cellData;
  s.cellStyles = cellStyles;
  s.colWidths = colWidths;
  s.condRules = condRules;
  s.rows = ROWS;
  s.cols = COL_COUNT;
}

// Завантажити аркуш i в глобали (без перебудови сітки — це робить UI-шар).
function loadGlobalsFromSheet(i) {
  const s = sheets[i];
  if (!s) return;
  activeSheet = i;
  cellData = s.cellData || {};
  cellStyles = s.cellStyles || {};
  colWidths = s.colWidths || {};
  condRules = Array.isArray(s.condRules) ? s.condRules : [];
  setGridSize(s.rows || DEFAULT_ROWS, s.cols || DEFAULT_COL_COUNT);
}

function findSheetByName(name) {
  const n = String(name || '').trim().toLowerCase();
  return sheets.find(s => String(s.name).trim().toLowerCase() === n) || null;
}

let calcDepth = 0;
let history = [];
let historyIndex = -1;

// ---- Standard formula error codes (Excel/Sheets-сумісні) ----
// Учень має впізнавати ці коди так само, як у «дорослих» табличних процесорах.
const FORMULA_ERRORS = {
  DIV0: '#DIV/0!',  // ділення на нуль
  REF: '#REF!',     // хибне посилання (активується у Хвилі 1)
  NAME: '#NAME?',   // невідома назва функції
  VALUE: '#VALUE!', // невідповідний тип даних
  NUM: '#NUM!',     // некоректне число
  CIRC: '#CIRC!'    // циклічне посилання
};

const FORMULA_ERROR_HINTS = {
  '#DIV/0!': 'Ділення на нуль. Перевірте, щоб дільник не був 0 чи порожнім.',
  '#REF!': 'Хибне посилання на клітинку (поза межами таблиці або видалене).',
  '#NAME?': 'Невідома назва функції. Перевірте правопис, напр. AVERAGE, SUM.',
  '#VALUE!': 'Невідповідний тип даних — у формулі очікувалося число.',
  '#NUM!': 'Некоректне число: завелике значення або недопустима операція.',
  '#CIRC!': 'Циклічне посилання: формула прямо чи опосередковано вказує сама на себе.'
};

const FORMULA_ERROR_CODES = Object.values(FORMULA_ERRORS);

// Кидаємо Error, повідомлення якого і є кодом — так клітинка показує сам код,
// а підказку (title) формуємо з FORMULA_ERROR_HINTS.
function formulaError(code) {
  const err = new Error(code);
  err.isFormulaError = true;
  return err;
}

function isFormulaErrorCode(value) {
  return FORMULA_ERROR_CODES.includes(String(value));
}

function formulaErrorHint(code) {
  return FORMULA_ERROR_HINTS[String(code)] || '';
}

function setGridSize(rows, colCount) {
  ROWS = Math.max(1, Math.min(500, Number(rows) || 1));
  COL_COUNT = Math.max(1, Math.min(200, Number(colCount) || 1));
  COLS = buildCols(COL_COUNT);
}

window.TablesModel = {
  setGridSize,
  formulaError,
  formulaErrorHint,
  isFormulaErrorCode,
  FORMULA_ERRORS
};
