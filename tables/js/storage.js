'use strict';

// ---- Shared IndexedDB storage adapter ----
const STORAGE_KEYS = {
  meta: 'kom_meta',
  data: 'kom_data',
  widths: 'kom_widths',
  styles: 'kom_styles',
  cond: 'kom_cond',
  sheets: 'kom_sheets'
};
const STORAGE_LEGACY_KEYS = Object.values(STORAGE_KEYS);
const STORAGE_DEBOUNCE_MS = 250;
let storageTimer = 0;
let latestStorageSnapshot = null;

function safeGetItem(key) {
  try { return localStorage.getItem(key); }
  catch { return null; }
}

function safeSetItem(key, value) {
  try {
    localStorage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

function safeParseJSON(value, fallback) {
  if (typeof value !== 'string' || !value) return fallback;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' ? parsed : fallback;
  } catch {
    return fallback;
  }
}

function readLegacyTablesDraft() {
  const storedSheets = safeParseJSON(safeGetItem(STORAGE_KEYS.sheets), null);
  if (storedSheets && Array.isArray(storedSheets.sheets) && storedSheets.sheets.length) {
    return {
      schemaVersion: 1,
      savedAt: 0,
      revision: 0,
      payload: { sheets: storedSheets.sheets, activeSheet: storedSheets.activeSheet }
    };
  }

  const hasLegacy = STORAGE_LEGACY_KEYS.some(key => safeGetItem(key) !== null);
  if (!hasLegacy) return null;
  const meta = safeParseJSON(safeGetItem(STORAGE_KEYS.meta), null);
  return {
    schemaVersion: 1,
    savedAt: 0,
    revision: 0,
    payload: {
      activeSheet: 0,
      sheets: [{
        name: 'Аркуш1',
        cellData: safeParseJSON(safeGetItem(STORAGE_KEYS.data), null),
        cellStyles: safeParseJSON(safeGetItem(STORAGE_KEYS.styles), null),
        colWidths: safeParseJSON(safeGetItem(STORAGE_KEYS.widths), null),
        condRules: safeParseJSON(safeGetItem(STORAGE_KEYS.cond), null),
        rows: meta?.rows,
        cols: meta?.cols
      }]
    }
  };
}

const tablesDraftStore = window.OfficeStorage.createDraftStore({
  app: 'tables',
  key: 'tables',
  fallbackKey: 'office_draft_tables_v1',
  legacyKeys: STORAGE_LEGACY_KEYS,
  readLegacy: readLegacyTablesDraft
});

function normalizeStoragePayload(payload) {
  if (!payload || !Array.isArray(payload.sheets) || !payload.sheets.length) return false;
  sheets = payload.sheets.map(normalizeSheet);
  const requested = Number(payload.activeSheet) || 0;
  activeSheet = Math.max(0, Math.min(sheets.length - 1, requested));
  loadGlobalsFromSheet(activeSheet);
  return true;
}

async function loadStateFromStorage() {
  let payload = null;
  try { payload = await tablesDraftStore.load(); }
  catch { payload = null; }
  if (normalizeStoragePayload(payload)) return true;

  sheets = [normalizeSheet({ name: 'Аркуш1' })];
  activeSheet = 0;
  loadGlobalsFromSheet(activeSheet);
  return false;
}

function createStorageSnapshot() {
  syncActiveSheetFromGlobals();
  return JSON.parse(JSON.stringify({ sheets, activeSheet }));
}

function estimateStorageSize(obj) {
  return JSON.stringify(obj).length * 2;
}

function persistStateToStorage() {
  latestStorageSnapshot = createStorageSnapshot();
  clearTimeout(storageTimer);
  storageTimer = setTimeout(() => {
    storageTimer = 0;
    tablesDraftStore.save(latestStorageSnapshot).catch(() => {});
  }, STORAGE_DEBOUNCE_MS);
}

function flushStateToStorage() {
  clearTimeout(storageTimer);
  storageTimer = 0;
  latestStorageSnapshot = createStorageSnapshot();
  return tablesDraftStore.save(latestStorageSnapshot).catch(() => false);
}

function clearStateFromStorage() {
  clearTimeout(storageTimer);
  storageTimer = 0;
  latestStorageSnapshot = null;
  return tablesDraftStore.clear();
}

document.addEventListener('visibilitychange', () => {
  if (document.hidden) flushStateToStorage();
});
window.addEventListener('pagehide', flushStateToStorage);

window.TablesStorage = {
  estimateStorageSize,
  loadStateFromStorage,
  persistStateToStorage,
  flushStateToStorage,
  clearStateFromStorage,
  safeGetItem,
  safeParseJSON,
  safeSetItem,
  getStatus: tablesDraftStore.getStatus
};
