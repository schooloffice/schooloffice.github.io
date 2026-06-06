// ---- Workbook file I/O ----
const WORKBOOK_MAX_SHEETS = 50;
const WORKBOOK_MAX_TEXT_CHARS = 5 * 1024 * 1024;
const WORKBOOK_MAX_NAME_LEN = 100;
const SHEET_MAX_NAME_LEN = 31;
const CELL_KEY_RE = /^([A-Z]+)(\d+)$/;
const ALLOWED_COND_OPS = new Set(['gt', 'ge', 'lt', 'le', 'eq', 'ne', 'between']);
const ALLOWED_STYLE_CLASSES = new Set([
  'style-text-bold', 'style-text-italic', 'style-text-underline', 'style-text-strike', 'style-text-default',
  'style-border-all',
  ...TEXT_COLOR_CLASSES,
  ...FILL_COLOR_CLASSES,
  ...ALIGN_CLASSES,
  ...NUMBER_FORMAT_CLASSES
]);

function workbookObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label}: очікувався об'єкт`);
  return value;
}

function validateSheetName(value, usedNames, index) {
  const name = String(value || '').trim();
  if (!name || name.length > SHEET_MAX_NAME_LEN || /[!':]/.test(name)) {
    throw new Error(`Некоректна назва аркуша ${index + 1}`);
  }
  const key = name.toLowerCase();
  if (usedNames.has(key)) throw new Error(`Назви аркушів мають бути унікальними: ${name}`);
  usedNames.add(key);
  return name;
}

function validateCellKey(key, rows, cols, label) {
  const match = CELL_KEY_RE.exec(String(key || '').toUpperCase());
  const col = match ? colToIndex(match[1]) : -1;
  const row = match ? Number(match[2]) : -1;
  if (!match || col < 0 || col >= cols || row < 1 || row > rows) throw new Error(`${label}: некоректна адреса ${key}`);
  return match[1] + row;
}

function validateCellData(value, rows, cols) {
  const src = workbookObject(value || {}, 'Дані клітинок');
  const out = {};
  for (const key of Object.keys(src)) {
    const id = validateCellKey(key, rows, cols, 'Дані клітинок');
    const raw = src[key];
    if (!['string', 'number', 'boolean'].includes(typeof raw)) throw new Error(`Клітинка ${id}: недопустиме значення`);
    const text = String(raw);
    if (text.length > MAX_CELL_LEN) throw new Error(`Клітинка ${id}: значення задовге`);
    if (text !== '') out[id] = text;
  }
  return out;
}

function validateCellStyles(value, rows, cols) {
  const src = workbookObject(value || {}, 'Стилі клітинок');
  const out = {};
  for (const key of Object.keys(src)) {
    const id = validateCellKey(key, rows, cols, 'Стилі клітинок');
    if (typeof src[key] !== 'string') throw new Error(`Стиль ${id}: очікувався текст`);
    const classes = src[key].split(/\s+/).filter(Boolean);
    if (classes.some(cls => !ALLOWED_STYLE_CLASSES.has(cls))) throw new Error(`Стиль ${id}: недопустимий клас`);
    if (classes.length) out[id] = [...new Set(classes)].join(' ');
  }
  return out;
}

function validateColumnWidths(value, cols) {
  const src = workbookObject(value || {}, 'Ширини колонок');
  const out = {};
  for (const key of Object.keys(src)) {
    const col = Number(key);
    const width = Number(src[key]);
    if (!Number.isInteger(col) || col < 0 || col >= cols || !Number.isFinite(width)) {
      throw new Error('Некоректна ширина колонки');
    }
    out[col] = Math.max(50, Math.min(500, width));
  }
  return out;
}

function validateCondRules(value, rows, cols) {
  if (value == null) return [];
  if (!Array.isArray(value) || value.length > 200) throw new Error('Некоректні правила умовного форматування');
  return value.map((rule, index) => {
    workbookObject(rule, `Правило ${index + 1}`);
    if (!Array.isArray(rule.range) || rule.range.length !== 4) throw new Error(`Правило ${index + 1}: некоректний діапазон`);
    const range = rule.range.map(Number);
    const [cMin, rMin, cMax, rMax] = range;
    if (!range.every(Number.isInteger) || cMin < 0 || cMax < cMin || cMax >= cols || rMin < 1 || rMax < rMin || rMax > rows) {
      throw new Error(`Правило ${index + 1}: діапазон поза аркушем`);
    }
    if (!ALLOWED_COND_OPS.has(rule.op)) throw new Error(`Правило ${index + 1}: невідома умова`);
    const v1 = Number(rule.v1);
    const v2 = rule.op === 'between' ? Number(rule.v2) : null;
    if (!Number.isFinite(v1) || (rule.op === 'between' && !Number.isFinite(v2))) throw new Error(`Правило ${index + 1}: некоректне число`);
    const fill = String(rule.fill || '');
    if (!/^#[0-9a-f]{6}$/i.test(fill)) throw new Error(`Правило ${index + 1}: некоректний колір`);
    return { range, op: rule.op, v1, v2, fill };
  });
}

function validateWorkbookSheet(value, usedNames, index) {
  const sheet = workbookObject(value, `Аркуш ${index + 1}`);
  const rows = Math.max(1, Math.min(500, Number(sheet.rows) || DEFAULT_ROWS));
  const cols = Math.max(1, Math.min(200, Number(sheet.cols) || DEFAULT_COL_COUNT));
  return {
    name: validateSheetName(sheet.name, usedNames, index),
    cellData: validateCellData(sheet.cellData, rows, cols),
    cellStyles: validateCellStyles(sheet.cellStyles, rows, cols),
    colWidths: validateColumnWidths(sheet.colWidths, cols),
    condRules: validateCondRules(sheet.condRules, rows, cols),
    rows,
    cols
  };
}

function validateWorkbookPayload(payload) {
  workbookObject(payload, 'Файл');
  if (payload.type && payload.type !== 'art-tables-workbook') throw new Error('Це не файл ПЛЮС Таблиць');
  if (payload.version != null && ![1, 2].includes(Number(payload.version))) throw new Error('Непідтримувана версія файлу');

  const usedNames = new Set();
  let validatedSheets;
  if (Array.isArray(payload.sheets)) {
    if (payload.sheets.length < 1 || payload.sheets.length > WORKBOOK_MAX_SHEETS) {
      throw new Error(`Некоректна кількість аркушів (максимум ${WORKBOOK_MAX_SHEETS})`);
    }
    validatedSheets = payload.sheets.map((sheet, index) => validateWorkbookSheet(sheet, usedNames, index));
  } else {
    validatedSheets = [validateWorkbookSheet({
      name: 'Аркуш1',
      cellData: payload.cellData,
      cellStyles: payload.cellStyles,
      colWidths: payload.colWidths,
      condRules: payload.condRules,
      rows: payload.rows,
      cols: payload.cols
    }, usedNames, 0)];
  }

  const active = Number(payload.activeSheet);
  return {
    name: String(payload.name || DEFAULT_WORKBOOK_NAME).slice(0, WORKBOOK_MAX_NAME_LEN),
    activeSheet: Number.isInteger(active) ? Math.max(0, Math.min(validatedSheets.length - 1, active)) : 0,
    sheets: validatedSheets
  };
}

function exportWorkbook() {
  syncActiveSheetFromGlobals();
  const payload = {
    type: 'art-tables-workbook',
    version: 2,
    name: workbookName,
    activeSheet,
    sheets
  };

  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${normalizeFileName(workbookName)}.arttab`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  setSaveBadge();
}

function triggerWorkbookImport() {
  const input = document.getElementById('workbookFileInput');
  if (!input) return;
  if (window.OfficeUI?.openFilePicker?.(input)) return;
  input.value = '';
  input.click();
}

function importWorkbookText(text) {
  try {
    if (String(text || '').length > WORKBOOK_MAX_TEXT_CHARS) throw new Error('Файл .arttab завеликий (максимум 5 МБ)');
    const payload = validateWorkbookPayload(JSON.parse(text));

    saveToHistory();

    workbookName = normalizeFileName(payload.name || DEFAULT_WORKBOOK_NAME);
    updateFileNameUi();

    sheets = payload.sheets;
    activeSheet = payload.activeSheet;
    rowFilter = null;
    loadGlobalsFromSheet(activeSheet);

    rebuildGrid();
    recalculateAll();
    renderSheetTabs();
    persistStateToStorage();
    persistUiState();
    setSaveBadge();
    saveToHistory();
  } catch (e) {
    showInfoModal(`Не вдалося відкрити файл: ${e?.message || 'помилка читання'}`);
  }
}

window.TablesWorkbookFile = {
  exportWorkbook,
  importWorkbookText,
  triggerWorkbookImport,
  validateWorkbookPayload
};
