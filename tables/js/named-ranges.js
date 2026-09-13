'use strict';

// ---- Іменовані діапазони книги ----
// Запис: { name, sheet, range:[cMin,rMin,cMax,rMax] }. Перша версія — лише імена рівня книги
// на прямокутний діапазон одного аркуша; іменовані формули, об'єднання діапазонів та імена
// рівня аркуша не підтримуються. Ім'я, чиї клітинки видалено, лишається в списку зламаним
// (range = null; sheet = null, якщо видалено аркуш), а формули з ним показують #REF!.
// У формулі ім'я — окремий вузол AST, який рушій розв'язує в посилання; текст формули
// переписується лише на рівні токенів.

const NAMED_RANGE_MAX_COUNT = 100;
const NAMED_RANGE_MAX_LENGTH = 60;
const NAMED_RANGE_NAME_RE = /^[A-Za-z_Ѐ-ӿ][A-Za-z0-9_Ѐ-ӿ]*$/;
// Латинські літери з цифрою на початку токенізатор читає як адресу клітинки (A1, Tax2024).
const NAMED_RANGE_CELL_LIKE_RE = /^[A-Za-z]+\d/;
const NAMED_RANGE_RESERVED = new Set(['TRUE', 'FALSE', 'R', 'C']);
// Межі моделі аркуша (setGridSize): зсув не може вивести ім'я за них.
const NAMED_RANGE_GRID_MAX_ROWS = 500;
const NAMED_RANGE_GRID_MAX_COLS = 200;

let namedRangeEditingIndex = -1;
let namedRangeDeletingIndex = -1;
let namedRangesDialogWired = false;

function namedRangeKey(name) {
  return String(name ?? '').trim().toUpperCase();
}

function namedRangeSheetKey(name) {
  return String(name ?? '').trim().toLowerCase();
}

// Порожній рядок — ім'я допустиме; інакше пояснення українською.
function namedRangeNameError(name, names = workbookNames, exceptIndex = -1) {
  const text = String(name ?? '');
  if (!text.trim()) return "Введіть ім'я діапазону.";
  if (text.length > NAMED_RANGE_MAX_LENGTH) return `Ім'я задовге: максимум ${NAMED_RANGE_MAX_LENGTH} символів.`;
  if (!NAMED_RANGE_NAME_RE.test(text)) return "Ім'я має починатися з літери або _ і містити лише літери, цифри та _, без пробілів.";
  const key = namedRangeKey(text);
  if (NAMED_RANGE_CELL_LIKE_RE.test(text) || NAMED_RANGE_RESERVED.has(key)) return `«${text}» схоже на адресу клітинки або логічне значення.`;
  if (Object.prototype.hasOwnProperty.call(FORMULA_FUNCTIONS, key)) return `«${text}» — це назва функції.`;
  const list = Array.isArray(names) ? names : [];
  const clash = list.findIndex((entry, index) => index !== exceptIndex && namedRangeKey(entry?.name) === key);
  if (clash >= 0) return `Ім'я «${list[clash].name}» уже є в книзі.`;
  return '';
}

// Excel вимагає лапок і для назв аркушів, схожих на адресу клітинки.
function namedRangeSheetPrefix(sheetName) {
  const name = String(sheetName);
  return NAMED_RANGE_CELL_LIKE_RE.test(name) ? `'${name}'!` : sheetRefPrefix(name);
}

function namedRangeAddress(entry) {
  if (!entry?.sheet || !Array.isArray(entry.range)) return FORMULA_ERRORS.REF;
  const [cMin, rMin, cMax, rMax] = entry.range;
  const start = `$${indexToCol(cMin)}$${rMin}`;
  const end = `$${indexToCol(cMax)}$${rMax}`;
  return namedRangeSheetPrefix(entry.sheet) + (start === end ? start : `${start}:${end}`);
}

function findNamedRange(name, names = workbookNames) {
  const key = namedRangeKey(name);
  return (Array.isArray(names) ? names : []).find(entry => namedRangeKey(entry?.name) === key) || null;
}

// Синтетичний вузол AST: абсолютне посилання або діапазон на аркуші імені.
function resolveNamedRangeNode(name, names = workbookNames) {
  const entry = findNamedRange(name, names);
  if (!entry) throw formulaError(FORMULA_ERRORS.NAME);
  if (!entry.sheet || !Array.isArray(entry.range)) throw formulaError(FORMULA_ERRORS.REF);
  const [cMin, rMin, cMax, rMax] = entry.range;
  const ref = (col, row) => ({ type: 'ref', sheet: entry.sheet, col, row, colAbs: true, rowAbs: true });
  if (cMin === cMax && rMin === rMax) return ref(cMin, rMin);
  return { type: 'range', start: ref(cMin, rMin), end: ref(cMax, rMax) };
}

function isNamedRangeToken(token, key) {
  return token.type === 'name' && !token.call && token.value === key;
}

function formulaNameTokens(formula) {
  const raw = String(formula || '');
  if (!raw.startsWith('=')) return null;
  try { return tokenizeFormula(raw.slice(1)); } catch { return null; }
}

// Перейменування імені у формулі: лише токени-імена, не рядки й не виклики функцій.
function renameNameInFormula(formula, oldName, newName) {
  const raw = String(formula || '');
  const tokens = formulaNameTokens(raw);
  const oldKey = namedRangeKey(oldName);
  if (!tokens || !tokens.some(token => isNamedRangeToken(token, oldKey))) return raw;
  const renamed = tokens.map(token => (isNamedRangeToken(token, oldKey)
    ? Object.assign({}, token, { value: namedRangeKey(newName), text: String(newName) })
    : token));
  return stringifyFormulaTokens(renamed, token => formatRefToken(token, token.col, token.row));
}

function countNamedRangeUsages(name) {
  syncActiveSheetFromGlobals();
  const key = namedRangeKey(name);
  let count = 0;
  for (const sheet of sheets) {
    for (const value of Object.values(sheet.cellData || {})) {
      if (formulaNameTokens(value)?.some(token => isNamedRangeToken(token, key))) count++;
    }
  }
  return count;
}

// Вставка/видалення рядків і колонок на аркуші sheetName (семантика як у посилань $A$1).
function shiftNamedRanges(sheetName, opts) {
  const key = namedRangeSheetKey(sheetName);
  workbookNames = workbookNames.map(entry => {
    if (!entry.sheet || !Array.isArray(entry.range) || namedRangeSheetKey(entry.sheet) !== key) return entry;
    const [cMin, rMin, cMax, rMax] = entry.range;
    const rows = structuralShiftInterval(rMin, rMax, opts.rowAt ?? null, opts.rowDelta ?? 0);
    const cols = structuralShiftInterval(cMin, cMax, opts.colAt ?? null, opts.colDelta ?? 0);
    if (rows.deleted || cols.deleted || rows.a > NAMED_RANGE_GRID_MAX_ROWS || cols.a >= NAMED_RANGE_GRID_MAX_COLS) {
      return Object.assign({}, entry, { range: null });
    }
    const range = [cols.a, rows.a, Math.min(cols.b, NAMED_RANGE_GRID_MAX_COLS - 1), Math.min(rows.b, NAMED_RANGE_GRID_MAX_ROWS)];
    return Object.assign({}, entry, { range });
  });
}

function renameNamedRangeSheet(oldName, newName) {
  const key = namedRangeSheetKey(oldName);
  workbookNames = workbookNames.map(entry => (entry.sheet && namedRangeSheetKey(entry.sheet) === key
    ? Object.assign({}, entry, { sheet: newName })
    : entry));
}

function deleteNamedRangeSheet(sheetName) {
  const key = namedRangeSheetKey(sheetName);
  workbookNames = workbookNames.map(entry => (entry.sheet && namedRangeSheetKey(entry.sheet) === key
    ? Object.assign({}, entry, { sheet: null, range: null })
    : entry));
}

// Нормалізований запис або рядок із причиною відмови.
function normalizeNamedRangeEntry(raw, sheetList, accepted) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return "очікувався об'єкт";
  const name = String(raw.name ?? '');
  const nameError = namedRangeNameError(name, accepted);
  if (nameError) return `${name || 'без імені'}: ${nameError}`;
  if (raw.sheet == null) {
    return raw.range == null ? { name, sheet: null, range: null } : `${name}: діапазон без аркуша`;
  }
  const sheet = (Array.isArray(sheetList) ? sheetList : []).find(item => namedRangeSheetKey(item?.name) === namedRangeSheetKey(raw.sheet));
  if (!sheet) return `${name}: немає аркуша «${raw.sheet}»`;
  if (raw.range == null) return { name, sheet: sheet.name, range: null };
  if (!Array.isArray(raw.range) || raw.range.length !== 4) return `${name}: некоректний діапазон`;
  const range = raw.range.map(Number);
  const [cMin, rMin, cMax, rMax] = range;
  const rows = Math.max(1, Math.min(NAMED_RANGE_GRID_MAX_ROWS, Number(sheet.rows) || DEFAULT_ROWS));
  const cols = Math.max(1, Math.min(NAMED_RANGE_GRID_MAX_COLS, Number(sheet.cols) || DEFAULT_COL_COUNT));
  if (!range.every(Number.isInteger) || cMin < 0 || cMax < cMin || cMax >= cols || rMin < 1 || rMax < rMin || rMax > rows) {
    return `${name}: діапазон поза аркушем «${sheet.name}»`;
  }
  return { name, sheet: sheet.name, range };
}

// strict — для файлів .arttab (помилка зупиняє відкриття); інакше некоректні записи
// відкидаються (чернетка, історія).
function normalizeNamedRanges(value, sheetList, { strict = false } = {}) {
  if (value == null) return [];
  if (!Array.isArray(value)) {
    if (strict) throw new Error('Некоректний список іменованих діапазонів');
    return [];
  }
  if (strict && value.length > NAMED_RANGE_MAX_COUNT) {
    throw new Error(`Забагато іменованих діапазонів (максимум ${NAMED_RANGE_MAX_COUNT})`);
  }
  const out = [];
  value.slice(0, NAMED_RANGE_MAX_COUNT).forEach((raw, index) => {
    const entry = normalizeNamedRangeEntry(raw, sheetList, out);
    if (typeof entry !== 'string') out.push(entry);
    else if (strict) throw new Error(`Іменований діапазон ${index + 1}: ${entry}`);
  });
  return out;
}

function listNamedRanges() {
  return workbookNames.map(entry => ({ name: entry.name, sheet: entry.sheet, range: Array.isArray(entry.range) ? entry.range.slice() : null }));
}

function commitNamedRangeChange() {
  recalculateAll();
  persistStateToStorage();
  setDirty(true);
  saveToHistory();
  renderNamedRangeList();
}

function defineNamedRange(name, sheetName, range) {
  const text = String(name ?? '').trim();
  const nameError = namedRangeNameError(text);
  if (nameError) return nameError;
  if (workbookNames.length >= NAMED_RANGE_MAX_COUNT) return `У книзі може бути не більше ${NAMED_RANGE_MAX_COUNT} імен.`;
  syncActiveSheetFromGlobals();
  const entry = normalizeNamedRangeEntry({ name: text, sheet: sheetName, range }, sheets, workbookNames);
  if (typeof entry === 'string') return entry;
  workbookNames = [...workbookNames, entry];
  commitNamedRangeChange();
  return '';
}

function renameNamedRange(index, newName) {
  const entry = workbookNames[index];
  if (!entry) return "Ім'я не знайдено.";
  const text = String(newName ?? '').trim();
  const nameError = namedRangeNameError(text, workbookNames, index);
  if (nameError) return nameError;
  if (text !== entry.name) {
    syncActiveSheetFromGlobals();
    // cellData активного аркуша — той самий об'єкт, тож глобали оновлюються разом з аркушем.
    for (const sheet of sheets) {
      const data = sheet.cellData || {};
      for (const key of Object.keys(data)) {
        if (String(data[key] || '').startsWith('=')) data[key] = renameNameInFormula(data[key], entry.name, text);
      }
    }
    workbookNames = workbookNames.map((item, i) => (i === index ? Object.assign({}, item, { name: text }) : item));
  }
  namedRangeEditingIndex = -1;
  commitNamedRangeChange();
  return '';
}

function deleteNamedRange(index) {
  if (!workbookNames[index]) return false;
  workbookNames = workbookNames.filter((_, i) => i !== index);
  namedRangeDeletingIndex = -1;
  namedRangeEditingIndex = -1;
  commitNamedRangeChange();
  return true;
}

// ---- Діалог «Дані → Іменовані діапазони» ----
function selectionNamedRangeTarget() {
  const bounds = getBounds();
  return { sheet: sheets[activeSheet]?.name, range: [bounds.cMin, bounds.rMin, bounds.cMax, bounds.rMax] };
}

function showNamedRangeError(message) {
  const el = document.getElementById('namedRangeError');
  if (el) el.textContent = message || '';
}

function namedRangeButton(action, index, label, className, icon) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = className;
  button.dataset.namedRangeAction = action;
  button.dataset.index = String(index);
  button.setAttribute('aria-label', label);
  if (icon) {
    const glyph = document.createElement('i');
    glyph.className = `fa-solid ${icon}`;
    button.appendChild(glyph);
  } else {
    button.textContent = label;
  }
  return button;
}

function renderNamedRangeList() {
  const list = document.getElementById('namedRangeList');
  if (!list) return;
  list.replaceChildren();
  if (!workbookNames.length) {
    const empty = document.createElement('li');
    empty.className = 'cond-empty';
    empty.textContent = 'Імен ще немає';
    list.appendChild(empty);
    return;
  }
  workbookNames.forEach((entry, index) => {
    const item = document.createElement('li');
    item.className = 'cond-rule-item named-range-item';
    if (index === namedRangeEditingIndex) {
      const input = document.createElement('input');
      input.type = 'text';
      input.className = 'cond-select named-range-input';
      input.value = entry.name;
      input.maxLength = NAMED_RANGE_MAX_LENGTH;
      input.setAttribute('aria-label', `Нове ім'я для ${entry.name}`);
      input.dataset.index = String(index);
      item.append(input,
        namedRangeButton('save', index, 'Зберегти', 'modal-primary-btn named-range-btn'),
        namedRangeButton('cancel', index, 'Скасувати', 'modal-secondary-btn named-range-btn'));
    } else if (index === namedRangeDeletingIndex) {
      const text = document.createElement('span');
      text.className = 'cond-rule-text';
      text.textContent = `Формул із «${entry.name}»: ${countNamedRangeUsages(entry.name)}. Після видалення вони покажуть #NAME?.`;
      item.append(text,
        namedRangeButton('confirm-delete', index, 'Видалити', 'modal-primary-btn named-range-btn'),
        namedRangeButton('cancel', index, 'Скасувати', 'modal-secondary-btn named-range-btn'));
    } else {
      const text = document.createElement('span');
      text.className = 'cond-rule-text';
      const title = document.createElement('strong');
      title.textContent = entry.name;
      const address = document.createElement('span');
      const broken = !entry.sheet || !Array.isArray(entry.range);
      address.className = broken ? 'named-range-address named-range-broken' : 'named-range-address';
      address.textContent = ` — ${namedRangeAddress(entry)}`;
      text.append(title, address);
      item.append(text,
        namedRangeButton('rename', index, `Перейменувати ${entry.name}`, 'cond-del named-range-edit', 'fa-pen'),
        namedRangeButton('delete', index, `Видалити ${entry.name}`, 'cond-del', 'fa-trash-can'));
    }
    list.appendChild(item);
  });
  list.querySelector('.named-range-input')?.focus();
}

function onNamedRangeListAction(action, index) {
  showNamedRangeError('');
  if (action === 'rename') {
    namedRangeEditingIndex = index;
    namedRangeDeletingIndex = -1;
  } else if (action === 'cancel') {
    namedRangeEditingIndex = -1;
    namedRangeDeletingIndex = -1;
  } else if (action === 'save') {
    const input = document.querySelector(`#namedRangeList .named-range-input[data-index="${index}"]`);
    const error = renameNamedRange(index, input?.value);
    if (error) { showNamedRangeError(error); return; }
    return;
  } else if (action === 'delete') {
    namedRangeEditingIndex = -1;
    if (workbookNames[index] && countNamedRangeUsages(workbookNames[index].name) === 0) {
      deleteNamedRange(index);
      return;
    }
    namedRangeDeletingIndex = index;
  } else if (action === 'confirm-delete') {
    deleteNamedRange(index);
    return;
  }
  renderNamedRangeList();
}

function onAddNamedRange() {
  const input = document.getElementById('namedRangeName');
  const target = selectionNamedRangeTarget();
  const error = defineNamedRange(input?.value, target.sheet, target.range);
  showNamedRangeError(error);
  if (error || !input) return;
  announce(`Ім'я ${input.value.trim()} додано для ${namedRangeAddress(target)}`);
  input.value = '';
}

function wireNamedRangesDialogOnce() {
  if (namedRangesDialogWired) return;
  namedRangesDialogWired = true;
  document.getElementById('namedRangeAddBtn')?.addEventListener('click', onAddNamedRange);
  document.getElementById('namedRangeName')?.addEventListener('keydown', event => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    onAddNamedRange();
  });
  const list = document.getElementById('namedRangeList');
  list?.addEventListener('click', event => {
    const button = event.target.closest('[data-named-range-action]');
    if (button) onNamedRangeListAction(button.dataset.namedRangeAction, Number(button.dataset.index));
  });
  list?.addEventListener('keydown', event => {
    const input = event.target.closest('.named-range-input');
    if (!input) return;
    if (event.key === 'Enter') { event.preventDefault(); onNamedRangeListAction('save', Number(input.dataset.index)); }
    else if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onNamedRangeListAction('cancel', Number(input.dataset.index)); }
  });
}

function openNamedRangesDialog() {
  wireNamedRangesDialogOnce();
  namedRangeEditingIndex = -1;
  namedRangeDeletingIndex = -1;
  const label = document.getElementById('namedRangeTarget');
  if (label) label.textContent = namedRangeAddress(selectionNamedRangeTarget());
  showNamedRangeError('');
  renderNamedRangeList();
  openModal('namedRangesModal');
}

window.TablesNamedRanges = {
  MAX_COUNT: NAMED_RANGE_MAX_COUNT,
  MAX_LENGTH: NAMED_RANGE_MAX_LENGTH,
  address: namedRangeAddress,
  define: defineNamedRange,
  list: listNamedRanges,
  nameError: namedRangeNameError,
  normalize: normalizeNamedRanges,
  openDialog: openNamedRangesDialog,
  remove: deleteNamedRange,
  rename: renameNamedRange,
  render: renderNamedRangeList,
  usages: countNamedRangeUsages
};
