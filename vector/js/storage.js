'use strict';

window.ArtVector = window.ArtVector || {};

// Чернетка зберігається в IndexedDB (structured clone, без ~5 МБ ліміту
// localStorage — векторний малюнок з довгими pen-контурами легко його
// перевищує). Якщо IDB недоступний/зависає (приватний режим; headless
// virtual-time, де open успішний, але транзакції не завершують колбеки),
// м'яко працюємо через localStorage. Кожен запис має позначку часу, тож
// завантаження завжди обирає НОВІШУ копію з обох сховищ.
// Патерн портовано з paint/js/storage.js.
(() => {
  const { constants } = window.ArtVector;

  const DB_NAME = 'plus_vector';
  const DB_VERSION = 1;
  const STORE = 'drafts';
  const DRAFT_KEY = 'current';
  const LS_KEY = constants.STORAGE_KEY;
  const OP_TIMEOUT_MS = 1000;

  let dbPromise = null;
  let idbUsable = true;
  let operationQueue = Promise.resolve();

  // Послідовне виконання операцій: помилка однієї повертається її викликачеві,
  // але не блокує наступних.
  function enqueue(operation) {
    const result = operationQueue.then(operation, operation);
    operationQueue = result.catch(() => {});
    return result;
  }

  function withTimeout(promise, ms) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('idb-op-timeout')), ms);
      promise.then(
        (value) => { clearTimeout(timer); resolve(value); },
        (error) => { clearTimeout(timer); reject(error); }
      );
    });
  }

  function openIdb() {
    return new Promise((resolve, reject) => {
      let settled = false;
      let request;
      try {
        request = indexedDB.open(DB_NAME, DB_VERSION);
      } catch (error) {
        reject(error);
        return;
      }
      const timer = setTimeout(() => {
        if (!settled) { settled = true; reject(new Error('idb-open-timeout')); }
      }, OP_TIMEOUT_MS);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
      };
      request.onsuccess = () => {
        if (settled) { request.result.close(); return; }
        settled = true;
        clearTimeout(timer);
        resolve(request.result);
      };
      request.onerror = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(request.error);
      };
    });
  }

  function getDb() {
    if (!dbPromise) dbPromise = openIdb();
    return dbPromise;
  }

  async function idbRead() {
    if (!idbUsable) return null;
    try {
      const db = await getDb();
      return await withTimeout(new Promise((resolve, reject) => {
        const tx = db.transaction(STORE, 'readonly');
        const request = tx.objectStore(STORE).get(DRAFT_KEY);
        request.onsuccess = () => resolve(request.result || null);
        request.onerror = () => reject(request.error);
      }), OP_TIMEOUT_MS);
    } catch {
      idbUsable = false;
      return null;
    }
  }

  async function idbWrite(record) {
    const db = await getDb();
    try {
      await withTimeout(new Promise((resolve, reject) => {
        const tx = db.transaction(STORE, 'readwrite');
        tx.objectStore(STORE).put(record, DRAFT_KEY);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error || new Error('IndexedDB transaction aborted'));
      }), OP_TIMEOUT_MS);
    } catch (error) {
      idbUsable = false;
      throw error;
    }
  }

  async function idbDelete() {
    if (!idbUsable) return false;
    try {
      const db = await getDb();
      await withTimeout(new Promise((resolve, reject) => {
        const tx = db.transaction(STORE, 'readwrite');
        tx.objectStore(STORE).delete(DRAFT_KEY);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error || new Error('IndexedDB transaction aborted'));
      }), OP_TIMEOUT_MS);
      return true;
    } catch {
      idbUsable = false;
      return false;
    }
  }

  function localRead() {
    try {
      const raw = localStorage.getItem(LS_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }

  function localWrite(record) {
    localStorage.setItem(LS_KEY, JSON.stringify(record));
  }

  function localDelete() {
    try { localStorage.removeItem(LS_KEY); } catch { /* best-effort */ }
  }

  function isRecord(value) {
    return !!value && typeof value === 'object' && typeof value.savedAt === 'number' && 'payload' in value;
  }

  // Старі (legacy) чернетки зберігалися без обгортки — трактуємо як найдавніші.
  function toRecord(value) {
    if (isRecord(value)) return value;
    return value ? { savedAt: 0, payload: value } : null;
  }

  function chooseNewerDraftRecord(idbRecord, localRecord) {
    if (!idbRecord) return localRecord;
    if (!localRecord) return idbRecord;
    if (idbRecord.savedAt !== localRecord.savedAt) {
      return idbRecord.savedAt > localRecord.savedAt ? idbRecord : localRecord;
    }
    if (localRecord.payload === null) return localRecord;
    if (idbRecord.payload === null) return idbRecord;
    return idbRecord;
  }

  // Зберігає чернетку. Помилки (зокрема quota) ПРОКИДАЄ далі, щоб автозбереження
  // могло відреагувати, не ламаючи редактор.
  function saveDraft(data) {
    return enqueue(async () => {
      const record = { savedAt: Date.now(), payload: data };
      if (idbUsable) {
        try {
          await idbWrite(record);
          localDelete();
          return;
        } catch {
          // IDB зависнув/впав — пишемо у localStorage (quota прокидається далі).
        }
      }
      localWrite(record);
    });
  }

  // Повертає НОВІШУ збережену чернетку з обох сховищ (або null).
  function loadDraft() {
    return enqueue(async () => {
      const idbRecord = toRecord(await idbRead());
      const localRecord = toRecord(localRead());
      const chosen = chooseNewerDraftRecord(idbRecord, localRecord);
      return chosen ? chosen.payload : null;
    });
  }

  // Прибирає чернетку з обох сховищ; пише tombstone, якщо IDB прибрати не вдалося.
  function clearDraft() {
    return enqueue(async () => {
      const idbCleared = await idbDelete();
      if (idbCleared) {
        try {
          localStorage.removeItem(LS_KEY);
          return true;
        } catch {
          return false;
        }
      }
      try {
        localStorage.setItem(LS_KEY, JSON.stringify({ savedAt: Date.now(), payload: null }));
        return true;
      } catch {
        return false;
      }
    });
  }

  window.ArtVector.vectorStorage = { saveDraft, loadDraft, clearDraft, chooseNewerDraftRecord };
})();
