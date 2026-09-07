'use strict';

// ---- Storage load/save (DOM-free except storage events) ----
//
// Запис у localStorage може не вдатися: квота вичерпана, сховище заблоковане
// політикою браузера, приватне вікно. Раніше помилка ковталася, прапорець
// `storageAvailable` назавжди вимикав усі наступні спроби, а бейдж усе одно
// показував «Збережено ✓» (аудит F07). Тепер кожна операція повертає результат,
// спроби не вимикаються назавжди, а UI бачить, що саме сталося.
let storageFailureStreak = 0;

function noteStorageFailure(error) {
  // Шумимо в консоль лише на першій невдачі поспіль: під час набору тексту
  // запис іде часто, і повторювані винятки нічого не додають.
  if (storageFailureStreak === 0) console.warn('Локальне сховище недоступне:', error);
  storageFailureStreak++;
}

function noteStorageSuccess() {
  storageFailureStreak = 0;
}

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
  try {
    localStorage.setItem(key, value);
    noteStorageSuccess();
    return { ok: true };
  } catch (e) {
    noteStorageFailure(e);
    return { ok: false, error: e };
  }
}

function safeGetItem(key) {
  try {
    const value = localStorage.getItem(key);
    noteStorageSuccess();
    return value;
  } catch (e) {
    noteStorageFailure(e);
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

// Результат останньої спроби записати чернетку. Бейдж читає саме його, тому
// не може повідомити про успіх там, де запису не було (аудит F07).
let lastPersistResult = { ok: true, reason: '' };

function getLastPersistResult() {
  return lastPersistResult;
}

function persistStateToStorage() {
  syncActiveSheetFromGlobals();
  const json = JSON.stringify({ sheets, activeSheet });
  const totalBytes = json.length * 2;

  // Власний розмір — лише дешевий запобіжник: він не знає, скільки місця
  // зайняли інші дані цього origin. Остаточну відповідь дає сам запис.
  if (totalBytes > STORAGE_MAX_BYTES) {
    lastPersistResult = { ok: false, reason: 'too-large' };
    window.dispatchEvent(new CustomEvent('storage-overflow', { detail: { bytes: totalBytes } }));
    return lastPersistResult;
  }

  const written = safeSetItem(STORAGE_KEYS.sheets, json);
  lastPersistResult = written.ok ? { ok: true, reason: '' } : { ok: false, reason: 'blocked' };

  if (!written.ok) {
    window.dispatchEvent(new CustomEvent('storage-blocked', { detail: { error: written.error } }));
    return lastPersistResult;
  }

  if (totalBytes > STORAGE_WARN_BYTES) {
    window.dispatchEvent(new CustomEvent('storage-warning', { detail: { bytes: totalBytes } }));
  }
  return lastPersistResult;
}

window.TablesStorage = {
  estimateStorageSize,
  getLastPersistResult,
  loadStateFromStorage,
  persistStateToStorage,
  safeGetItem,
  safeParseJSON,
  safeSetItem
};
