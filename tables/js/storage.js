'use strict';

// ---- Storage load/save (DOM-free except storage events) ----
let storageAvailable = true;

const STORAGE_KEYS = {
  meta: 'kom_meta',
  data: 'kom_data',
  widths: 'kom_widths',
  styles: 'kom_styles',
  cond: 'kom_cond',
  sheets: 'kom_sheets'
};

const STORAGE_WARN_BYTES = 3 * 1024 * 1024;
const STORAGE_MAX_BYTES = 4.5 * 1024 * 1024;

function safeSetItem(key, value) {
  if (!storageAvailable) return;
  try {
    localStorage.setItem(key, value);
  } catch (e) {
    storageAvailable = false;
    console.warn('SessionStorage disabled:', e);
  }
}

function safeGetItem(key) {
  if (!storageAvailable) return null;
  try {
    return localStorage.getItem(key);
  } catch (e) {
    storageAvailable = false;
    console.warn('SessionStorage disabled:', e);
    return null;
  }
}

function safeParseJSON(value, fallback) {
  if (typeof value !== 'string' || !value) return fallback;
  try {
    const parsed = JSON.parse(value);
    return (parsed && typeof parsed === 'object') ? parsed : fallback;
  } catch (e) {
    console.warn('Broken JSON in storage:', e);
    return fallback;
  }
}

function loadStateFromStorage() {
  const sv = safeParseJSON(safeGetItem(STORAGE_KEYS.sheets), null);
  if (sv && Array.isArray(sv.sheets) && sv.sheets.length) {
    sheets = sv.sheets.map(normalizeSheet);
    const ai = Number(sv.activeSheet) || 0;
    activeSheet = Math.max(0, Math.min(sheets.length - 1, ai));
  } else {
    // Старий однолистовий формат → міграція в один аркуш
    const meta = safeParseJSON(safeGetItem(STORAGE_KEYS.meta), null);
    sheets = [normalizeSheet({
      name: 'Аркуш1',
      cellData: safeParseJSON(safeGetItem(STORAGE_KEYS.data), null),
      cellStyles: safeParseJSON(safeGetItem(STORAGE_KEYS.styles), null),
      colWidths: safeParseJSON(safeGetItem(STORAGE_KEYS.widths), null),
      condRules: safeParseJSON(safeGetItem(STORAGE_KEYS.cond), null),
      rows: meta?.rows,
      cols: meta?.cols
    })];
    activeSheet = 0;
  }
  loadGlobalsFromSheet(activeSheet);
}

function estimateStorageSize(obj) {
  return JSON.stringify(obj).length * 2;
}

function persistStateToStorage() {
  syncActiveSheetFromGlobals();
  const json = JSON.stringify({ sheets, activeSheet });
  const totalBytes = json.length * 2;

  if (totalBytes > STORAGE_MAX_BYTES) {
    window.dispatchEvent(new CustomEvent('storage-overflow', { detail: { bytes: totalBytes } }));
    return;
  }

  safeSetItem(STORAGE_KEYS.sheets, json);

  if (totalBytes > STORAGE_WARN_BYTES) {
    window.dispatchEvent(new CustomEvent('storage-warning', { detail: { bytes: totalBytes } }));
  }
}

window.TablesStorage = {
  estimateStorageSize,
  loadStateFromStorage,
  persistStateToStorage,
  safeGetItem,
  safeParseJSON,
  safeSetItem
};
