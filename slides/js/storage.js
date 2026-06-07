import { STORAGE_KEY } from './constants.js';

// Чернетка зберігається в IndexedDB (structured clone): на відміну від
// localStorage, воно тримає великі презентації з data-URL зображеннями і не
// обмежене ~5 МБ. Якщо IDB недоступний (приватний режим, блокування,
// timeout) — м'яко відкочуємось на localStorage, щоб редактор усе одно зберігав
// невеликі чернетки. Один і той самий ключ слугує і для legacy-міграції.
const DB_NAME = 'plus_slides';
const DB_VERSION = 1;
const STORE = 'drafts';
const DRAFT_KEY = 'current';
const LS_KEY = STORAGE_KEY;
const OPEN_TIMEOUT_MS = 1000;

let backendPromise = null;
let operationQueue = Promise.resolve();

function enqueue(operation) {
  const result = operationQueue.then(operation, operation);
  // Помилка однієї операції має повернутися її викликачеві, але не блокувати
  // наступні save/load/clear. Черга також гарантує, що clear після запущеного
  // autosave виконається останнім і чернетка не з'явиться знову.
  operationQueue = result.catch(() => {});
  return result;
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
    }, OPEN_TIMEOUT_MS);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    request.onsuccess = () => {
      if (settled) {
        request.result.close();
        return;
      }
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

function idbBackend(db) {
  return {
    kind: 'idb',
    get: () => new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly');
      const request = tx.objectStore(STORE).get(DRAFT_KEY);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    }),
    set: data => new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(data, DRAFT_KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error || new Error('IndexedDB transaction aborted'));
    }),
    del: () => new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).delete(DRAFT_KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error || new Error('IndexedDB transaction aborted'));
    })
  };
}

function localBackend() {
  return {
    kind: 'local',
    get: async () => {
      const raw = localStorage.getItem(LS_KEY);
      return raw ? JSON.parse(raw) : undefined;
    },
    set: async data => { localStorage.setItem(LS_KEY, JSON.stringify(data)); },
    del: async () => { localStorage.removeItem(LS_KEY); }
  };
}

function getBackend() {
  if (!backendPromise) {
    backendPromise = openIdb().then(idbBackend).catch(() => localBackend());
  }
  return backendPromise;
}

function readLegacyLocal() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

// Зберігає чернетку. Помилки (зокрема quota) ПРОКИДАЄ далі, щоб автозбереження
// показало попередження, не ламаючи редактор.
export async function saveDraft(data) {
  return enqueue(async () => {
    const backend = await getBackend();
    await backend.set(data);
  });
}

// Повертає збережену чернетку або null. Для IDB-бекенда, якщо сховище порожнє,
// мігрує стару localStorage-чернетку в IDB і прибирає legacy-ключ.
export async function loadDraft() {
  return enqueue(async () => {
    const backend = await getBackend();
    let value;
    try {
      value = await backend.get();
    } catch {
      value = undefined;
    }
    if (value !== undefined && value !== null) return value;

    if (backend.kind === 'idb') {
      const legacy = readLegacyLocal();
      if (legacy) {
        try { await backend.set(legacy); } catch {}
        try { localStorage.removeItem(LS_KEY); } catch {}
        return legacy;
      }
    }
    return null;
  });
}

// Повертає true, якщо чернетку справді видалено (для чесного звіту в UI).
export async function clearDraft() {
  return enqueue(async () => {
    let ok = true;
    try {
      const backend = await getBackend();
      await backend.del();
    } catch {
      ok = false;
    }
    // Прибираємо й legacy-ключ незалежно від активного бекенда.
    try { localStorage.removeItem(LS_KEY); } catch { ok = false; }
    return ok;
  });
}
