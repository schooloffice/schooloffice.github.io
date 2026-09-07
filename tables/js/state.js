// ---- UI State ----
let selStart = { c: 0, r: 1 };
let selEnd = { c: 0, r: 1 };
let active = { c: 0, r: 1 };
let activeId = 'A1';

let isSelecting = false;
let isResizing = false;
let resizeCol = null;

// Autofill (маркер заповнення)
let isFilling = false;
let fillSource = null; // {cMin,cMax,rMin,rMax}
let fillTarget = null; // {cMin,cMax,rMin,rMax}

// Row filter (фільтр за стовпцем) — транзитивний, у файл не зберігається
let rowFilter = null; // { col, op, v1, v2 }

let markedCells = [];

let chartObj = null;
let chartType = 'bar';

let confirmFn = null;

let gridWrap = null;
let insertColBtn = null;
let insertRowBtn = null;
let hoverInsertColAt = null; // 0..COL_COUNT
let hoverInsertRowAt = null; // 1..ROWS+1

let metrics = { rowHeaderW: 50, headerH: 32, rowH: 30 };
let headerMenuState = null;

// Cache for fast access
let cellTd = [];  // [r][c]
let cellInp = []; // [r][c]
let colEls = [];  // colgroup <col> elements (0 = row header)

const MAX_HISTORY = 50;

const WORKBOOK_STORAGE_KEY = 'art_tables_workbook_name';
const UI_STORAGE_KEY = 'art_tables_ui';
const DEFAULT_WORKBOOK_NAME = 'таблиця';
const TEXT_COLOR_CLASSES = ['style-text-slate','style-text-red','style-text-orange','style-text-amber','style-text-green','style-text-teal','style-text-blue','style-text-indigo','style-text-purple','style-text-pink','style-text-brown'];
const FILL_COLOR_CLASSES = ['style-bg-yellow','style-bg-green','style-bg-red','style-bg-blue','style-bg-indigo','style-bg-purple','style-bg-pink','style-bg-orange','style-bg-gray','style-bg-teal'];
const ALIGN_CLASSES = ['style-align-left','style-align-center','style-align-right'];
const NUMBER_FORMAT_CLASSES = ['style-num-int','style-num-fixed2','style-num-percent','style-num-currency-uah','style-num-date','style-num-datetime'];

let workbookName = DEFAULT_WORKBOOK_NAME;
let currentZoom = 100;
let menusInitialized = false;

// ---- Helpers ----
function getCellId(cIdx, r) {
  return `${COLS[cIdx]}${r}`;
}

function parseCellId(id) {
  const m = /^([A-Z]+)(\d+)$/.exec(String(id || '').toUpperCase());
  if (!m) return null;
  return { cIdx: colToIndex(m[1]), r: parseInt(m[2], 10), col: m[1] };
}

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

function getBounds() {
  return {
    cMin: Math.min(selStart.c, selEnd.c),
    cMax: Math.max(selStart.c, selEnd.c),
    rMin: Math.min(selStart.r, selEnd.r),
    rMax: Math.max(selStart.r, selEnd.r)
  };
}

function ensureCellWithinBounds() {
  active.c = clamp(active.c, 0, COL_COUNT - 1);
  active.r = clamp(active.r, 1, ROWS);
  selStart.c = clamp(selStart.c, 0, COL_COUNT - 1);
  selEnd.c = clamp(selEnd.c, 0, COL_COUNT - 1);
  selStart.r = clamp(selStart.r, 1, ROWS);
  selEnd.r = clamp(selEnd.r, 1, ROWS);
  activeId = getCellId(active.c, active.r);
}

function styleStringToClassList(str) {
  const s = String(str || '').trim();
  if (!s) return [];
  return s
    .split(/\s+/)
    .map(x => x.trim())
    .filter(x => x.startsWith('style-'));
}

function extractStyleStringFromTd(td) {
  if (!td) return '';
  const styles = [];
  td.classList.forEach(cls => {
    if (cls.startsWith('style-')) styles.push(cls);
  });
  return styles.join(' ');
}

// Три стани бейджа, а не два. «Збережено» тут завжди означало б неправду:
// таблиця живе в браузерній чернетці, а файл користувач зберігає сам через
// експорт. Тому успіх називаємо чернеткою, а невдалий запис показуємо як
// невдалий, а не як збереження (аудит F07).
const SAVE_BADGE_STYLES = {
  dirty: { background: '#fff7ed', borderColor: '#fed7aa', color: '#c2410c' },
  saved: { background: '#ecfdf5', borderColor: '#bbf7d0', color: '#0f766e' },
  failed: { background: '#fef2f2', borderColor: '#fecaca', color: '#b91c1c' }
};

function paintSaveBadge(kind, text) {
  const badge = document.getElementById('saveBadge');
  const dot = document.getElementById('dirtyDot');
  if (dot) dot.style.opacity = kind === 'saved' ? '0' : '1';
  if (!badge) return;
  const style = SAVE_BADGE_STYLES[kind] || SAVE_BADGE_STYLES.dirty;
  badge.textContent = text;
  badge.style.background = style.background;
  badge.style.borderColor = style.borderColor;
  badge.style.color = style.color;
}

// Чи є в книзі робота, якої немає в жодному файлі. Чернетка в localStorage
// сюди не зараховується: вона живе лише в цьому браузері.
let workbookHasUnsavedFile = false;

function markWorkbookSavedToFile() { workbookHasUnsavedFile = false; }
function hasUnsavedWorkbookFile() { return workbookHasUnsavedFile; }

function setDirty(flag = true, label = 'Є зміни…') {
  if (flag) {
    workbookHasUnsavedFile = true;
    paintSaveBadge('dirty', label);
  } else {
    setSaveBadge();
  }
}

const PERSIST_FAILURE_LABELS = {
  'too-large': 'Забагато даних для чернетки',
  blocked: 'Не вдалося оновити чернетку'
};

function setSaveBadge() {
  // Стан беремо з результату останнього запису, а не з факту виклику: інакше
  // бейдж повідомляв би про успіх навіть тоді, коли сховище відмовило.
  const result = window.TablesStorage?.getLastPersistResult?.() || { ok: true };
  if (result.ok) paintSaveBadge('saved', 'Чернетку збережено ✓');
  else paintSaveBadge('failed', PERSIST_FAILURE_LABELS[result.reason] || PERSIST_FAILURE_LABELS.blocked);
}

// ---- Aria announcer для скрінрідерів ----
function announce(msg) {
  const el = document.getElementById('ariaAnnouncer');
  if (!el) return;
  el.textContent = '';
  // Невелика затримка, щоб скрінрідер точно прочитав
  setTimeout(() => { el.textContent = msg; }, 50);
}

// ---- History ----
function snapshotState() {
  syncActiveSheetFromGlobals();
  return {
    activeSheet,
    sheets: JSON.stringify(sheets)
  };
}

function statesEqual(a, b) {
  return !!a && !!b &&
    a.activeSheet === b.activeSheet &&
    a.sheets === b.sheets;
}

function saveToHistory() {
  const state = snapshotState();

  // skip duplicates
  const last = history[history.length - 1];
  if (statesEqual(last, state)) {
    updateUndoRedoButtons();
    return;
  }

  if (historyIndex < history.length - 1) {
    history = history.slice(0, historyIndex + 1);
  }

  history.push(state);
  if (history.length > MAX_HISTORY) {
    history.shift();
  }

  historyIndex = history.length - 1;
  updateUndoRedoButtons();
}

function restoreState(state) {
  if (!state) return;

  const parsed = safeParseJSON(state.sheets, null);
  if (Array.isArray(parsed) && parsed.length) {
    sheets = parsed.map(normalizeSheet);
  }
  activeSheet = Math.max(0, Math.min(sheets.length - 1, state.activeSheet || 0));
  rowFilter = null;
  loadGlobalsFromSheet(activeSheet);

  rebuildGrid();
  recalculateAll();
  persistStateToStorage();
  initFileNameUi();
  initMenusAndToolbar();
  restoreUiState();
  if (typeof renderSheetTabs === 'function') renderSheetTabs();
  setSaveBadge();
}

function undo() {
  if (historyIndex > 0) {
    historyIndex--;
    restoreState(history[historyIndex]);
    updateUndoRedoButtons();
  }
}

function redo() {
  if (historyIndex < history.length - 1) {
    historyIndex++;
    restoreState(history[historyIndex]);
    updateUndoRedoButtons();
  }
}

function updateUndoRedoButtons() {
  const canUndo = historyIndex > 0;
  const canRedo = historyIndex < history.length - 1;
  document.querySelectorAll('[data-action="undo"]').forEach(btn => btn.disabled = !canUndo);
  document.querySelectorAll('[data-action="redo"]').forEach(btn => btn.disabled = !canRedo);
}

