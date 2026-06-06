'use strict';

// ---- Storage load/save (DOM-free except storage events) ----
let storageAvailable = true;

const STORAGE_KEYS = {
  meta: 'kom_meta',
  data: 'kom_data',
  widths: 'kom_widths',
  styles: 'kom_styles'
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
  const meta = safeParseJSON(safeGetItem(STORAGE_KEYS.meta), null);
  if (meta && (meta.rows || meta.cols)) {
    setGridSize(meta.rows ?? ROWS, meta.cols ?? COL_COUNT);
  }

  const d = safeParseJSON(safeGetItem(STORAGE_KEYS.data), null);
  if (d) cellData = d;

  const w = safeParseJSON(safeGetItem(STORAGE_KEYS.widths), null);
  if (w) colWidths = w;

  const s = safeParseJSON(safeGetItem(STORAGE_KEYS.styles), null);
  if (s) cellStyles = s;
}

function estimateStorageSize(obj) {
  return JSON.stringify(obj).length * 2;
}

function persistStateToStorage() {
  const payload = {
    meta: { rows: ROWS, cols: COL_COUNT },
    data: cellData,
    widths: colWidths,
    styles: cellStyles
  };
  const totalBytes = estimateStorageSize(payload);

  if (totalBytes > STORAGE_MAX_BYTES) {
    window.dispatchEvent(new CustomEvent('storage-overflow', { detail: { bytes: totalBytes } }));
    return;
  }

  safeSetItem(STORAGE_KEYS.meta, JSON.stringify(payload.meta));
  safeSetItem(STORAGE_KEYS.data, JSON.stringify(payload.data));
  safeSetItem(STORAGE_KEYS.widths, JSON.stringify(payload.widths));
  safeSetItem(STORAGE_KEYS.styles, JSON.stringify(payload.styles));

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
