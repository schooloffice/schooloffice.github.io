// ---- UI State ----
let selStart = { c: 0, r: 1 };
let selEnd = { c: 0, r: 1 };
let active = { c: 0, r: 1 };
let activeId = 'A1';

let isSelecting = false;
let isResizing = false;
let resizeCol = null;

let markedCells = [];

let chartObj = null;
let chartType = 'bar';

let confirmFn = null;

let gridWrap = null;
let insertColBtn = null;
let insertRowBtn = null;
let hoverInsertColAt = null; // 0..COL_COUNT
let hoverInsertRowAt = null; // 1..ROWS+1

let metrics = { rowHeaderW: 50, headerH: 38, rowH: 40 };
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
const NUMBER_FORMAT_CLASSES = ['style-num-int','style-num-fixed2','style-num-percent','style-num-currency-uah'];

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

function setDirty(flag = true, label = 'Є зміни…') {
  const badge = document.getElementById('saveBadge');
  const dot = document.getElementById('dirtyDot');
  if (dot) dot.style.opacity = flag ? '1' : '0';
  if (!badge) return;
  badge.textContent = flag ? label : 'Збережено ✓';
  badge.style.background = flag ? '#fff7ed' : '#ecfdf5';
  badge.style.borderColor = flag ? '#fed7aa' : '#bbf7d0';
  badge.style.color = flag ? '#c2410c' : '#0f766e';
}

function setSaveBadge() {
  setDirty(false);
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
  return {
    rows: ROWS,
    colCount: COL_COUNT,
    cellData: JSON.stringify(cellData),
    colWidths: JSON.stringify(colWidths),
    cellStyles: JSON.stringify(cellStyles)
  };
}

function statesEqual(a, b) {
  return !!a && !!b &&
    a.rows === b.rows &&
    a.colCount === b.colCount &&
    a.cellData === b.cellData &&
    a.colWidths === b.colWidths &&
    a.cellStyles === b.cellStyles;
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

  cellData = safeParseJSON(state.cellData, {});
  colWidths = safeParseJSON(state.colWidths, {});
  cellStyles = safeParseJSON(state.cellStyles, {});

  setGridSize(state.rows, state.colCount);
  rebuildGrid();
  recalculateAll();
  persistStateToStorage();
  initFileNameUi();
  initMenusAndToolbar();
  restoreUiState();
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

