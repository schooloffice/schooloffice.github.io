(function () {
  'use strict';

  const DB_NAME = 'office_plus_drafts';
  const DB_VERSION = 1;
  const STORE_NAME = 'drafts';
  const DEFAULT_TIMEOUT_MS = 1200;
  const SCHEMA_VERSION = 1;
  const stores = new Map();
  const statuses = new Map();

  const KNOWN_DRAFTS = {
    text: { key: 'text', legacyKeys: [] },
    tables: { key: 'tables', legacyKeys: ['kom_meta', 'kom_data', 'kom_widths', 'kom_styles', 'kom_cond', 'kom_sheets'] },
    slides: { key: 'slides', legacyKeys: ['art_slides_v1'] },
    paint: { key: 'paint', legacyKeys: ['art_malyunky_draft_v2'] },
    vector: { key: 'vector', legacyKeys: ['art_vector_draft_v1'] },
    flowcharts: { key: 'flowcharts', legacyKeys: ['flowchart-designer-2-autosave'] }
  };

  let dbPromise = null;

  function clonePayload(payload) {
    if (typeof structuredClone === 'function') return structuredClone(payload);
    return JSON.parse(JSON.stringify(payload));
  }

  function withTimeout(promise, timeoutMs, operation) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`${operation}-timeout`)), timeoutMs);
      promise.then(
        value => { clearTimeout(timer); resolve(value); },
        error => { clearTimeout(timer); reject(error); }
      );
    });
  }

  function openDatabase(timeoutMs) {
    if (dbPromise) return dbPromise;
    dbPromise = withTimeout(new Promise((resolve, reject) => {
      let request;
      try {
        request = indexedDB.open(DB_NAME, DB_VERSION);
      } catch (error) {
        reject(error);
        return;
      }
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains(STORE_NAME)) {
          request.result.createObjectStore(STORE_NAME);
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error('indexeddb-open-failed'));
      request.onblocked = () => reject(new Error('indexeddb-open-blocked'));
    }), timeoutMs, 'indexeddb-open').catch(error => {
      dbPromise = null;
      throw error;
    });
    return dbPromise;
  }

  async function readIdb(key, timeoutMs) {
    const db = await openDatabase(timeoutMs);
    return withTimeout(new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const request = tx.objectStore(STORE_NAME).get(key);
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(request.error || tx.error || new Error('indexeddb-read-failed'));
      tx.onabort = () => reject(tx.error || new Error('indexeddb-read-aborted'));
    }), timeoutMs, 'indexeddb-read');
  }

  async function writeIdb(key, record, timeoutMs) {
    const db = await openDatabase(timeoutMs);
    return withTimeout(new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).put(record, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error || new Error('indexeddb-write-failed'));
      tx.onabort = () => reject(tx.error || new Error('indexeddb-write-aborted'));
    }), timeoutMs, 'indexeddb-write');
  }

  function normalizeRecord(value, decodeLegacy) {
    if (!value || typeof value !== 'object') return null;
    if (value.schemaVersion === SCHEMA_VERSION && Number.isFinite(value.revision) && 'payload' in value) {
      return value;
    }
    if (typeof decodeLegacy === 'function') {
      const decoded = decodeLegacy(value);
      if (decoded) return normalizeRecord(decoded);
    }
    if ('payload' in value && (typeof value.savedAt === 'number' || typeof value.savedAt === 'string')) {
      const savedAt = Number.isFinite(Number(value.savedAt)) ? Number(value.savedAt) : Date.parse(value.savedAt) || 0;
      return { schemaVersion: SCHEMA_VERSION, savedAt, revision: savedAt * 1000, payload: value.payload };
    }
    return { schemaVersion: SCHEMA_VERSION, savedAt: 0, revision: 0, payload: value };
  }

  function chooseNewerRecord(records) {
    return records.filter(Boolean).reduce((chosen, candidate) => {
      if (!chosen) return candidate;
      if (candidate.revision !== chosen.revision) return candidate.revision > chosen.revision ? candidate : chosen;
      if (candidate.savedAt !== chosen.savedAt) return candidate.savedAt > chosen.savedAt ? candidate : chosen;
      if (candidate.payload === null) return candidate;
      return chosen;
    }, null);
  }

  function localRead(key, decodeLegacy) {
    const raw = localStorage.getItem(key);
    return raw ? normalizeRecord(JSON.parse(raw), decodeLegacy) : null;
  }

  function localWrite(key, record) {
    localStorage.setItem(key, JSON.stringify(record));
  }

  function localRemove(keys) {
    keys.forEach(key => localStorage.removeItem(key));
  }

  function dispatchError(app, operation, error) {
    const message = error?.message || String(error || 'unknown-storage-error');
    window.dispatchEvent(new CustomEvent('office:storage-error', {
      detail: { app, operation, message }
    }));
  }

  function updateStatus(app, state, message = '') {
    const status = { app, state, message, updatedAt: Date.now() };
    statuses.set(app, status);
    window.dispatchEvent(new CustomEvent('office:storage-status', { detail: status }));
    return status;
  }

  function makeRecord(revision, payload) {
    return {
      schemaVersion: SCHEMA_VERSION,
      savedAt: Date.now(),
      revision,
      payload
    };
  }

  function createDraftStore(config = {}) {
    const app = String(config.app || '').trim();
    const key = String(config.key || app).trim();
    if (!app || !key) throw new TypeError('OfficeStorage.createDraftStore requires app and key.');
    const registryKey = `${app}:${key}`;
    if (stores.has(registryKey)) return stores.get(registryKey);

    const timeoutMs = Math.max(1000, Math.min(1500, Number(config.timeoutMs) || DEFAULT_TIMEOUT_MS));
    const fallbackKey = config.fallbackKey || `office_draft_${key}_v1`;
    const legacyKeys = Array.from(new Set([...(config.legacyKeys || []), fallbackKey]));
    let operationQueue = Promise.resolve();
    let revision = 0;
    let latestPayload;
    let degraded = false;
    let idbUsable = true;

    function enqueue(operation) {
      const result = operationQueue.then(operation, operation);
      operationQueue = result.catch(() => {});
      return result;
    }

    function nextRevision() {
      revision = Math.max(revision + 1, (Date.now() * 1000) + Math.floor(Math.random() * 1000));
      return revision;
    }

    async function readAllRecords() {
      const records = [];
      if (idbUsable) {
        try {
          records.push(await readIdb(key, timeoutMs));
        } catch (error) {
          idbUsable = false;
          degraded = true;
          dispatchError(app, 'load', error);
          records.push(null);
        }
      } else {
        records.push(null);
      }
      if (typeof config.readLegacy === 'function') {
        try {
          records.push(localRead(fallbackKey, config.decodeLegacy));
          records.push(normalizeRecord(config.readLegacy(), config.decodeLegacy));
        } catch (error) {
          dispatchError(app, 'load', error);
        }
      } else {
        for (const legacyKey of legacyKeys) {
          try {
            records.push(localRead(legacyKey, config.decodeLegacy));
          } catch (error) {
            dispatchError(app, 'load', error);
          }
        }
      }
      return records.map(record => normalizeRecord(record, config.decodeLegacy));
    }

    async function migrateRecord(record) {
      if (!record) return;
      if (idbUsable) {
        try {
          await writeIdb(key, record, timeoutMs);
          localRemove(legacyKeys);
          degraded = false;
          return;
        } catch (error) {
          idbUsable = false;
          degraded = true;
          dispatchError(app, 'migrate', error);
        }
      }
      try {
        localWrite(fallbackKey, record);
        localRemove(legacyKeys.filter(legacyKey => legacyKey !== fallbackKey));
      } catch (fallbackError) {
        dispatchError(app, 'migrate-fallback', fallbackError);
      }
    }

    function load() {
      return enqueue(async () => {
        const records = await readAllRecords();
        const chosen = chooseNewerRecord(records);
        if (!chosen) {
          updateStatus(app, degraded ? 'error' : 'saved');
          return null;
        }
        revision = Math.max(revision, Number(chosen.revision) || 0);
        latestPayload = chosen.payload === null ? null : clonePayload(chosen.payload);
        const idbRecord = records[0];
        if (!idbRecord || idbRecord.revision !== chosen.revision || legacyKeys.some(legacyKey => {
          try { return localStorage.getItem(legacyKey) !== null; } catch { return false; }
        })) {
          await migrateRecord(chosen);
        }
        updateStatus(app, degraded ? 'error' : 'saved');
        return chosen.payload === null ? null : clonePayload(chosen.payload);
      });
    }

    function save(payload) {
      latestPayload = clonePayload(payload);
      if (statuses.get(app)?.state !== 'error') updateStatus(app, 'saving');
      return enqueue(async () => {
        const record = makeRecord(nextRevision(), clonePayload(latestPayload));
        if (idbUsable) {
          try {
            await writeIdb(key, record, timeoutMs);
            localRemove(legacyKeys);
            degraded = false;
            updateStatus(app, 'saved');
            return record;
          } catch (error) {
            idbUsable = false;
            degraded = true;
            dispatchError(app, 'save', error);
          }
        }
        try {
          localWrite(fallbackKey, record);
        } catch (fallbackError) {
          dispatchError(app, 'save-fallback', fallbackError);
          updateStatus(app, 'error', fallbackError.message);
          throw fallbackError;
        }
        updateStatus(app, degraded ? 'error' : 'saved');
        return record;
      });
    }

    function clear() {
      latestPayload = null;
      updateStatus(app, 'saving');
      return enqueue(async () => {
        const tombstone = makeRecord(nextRevision(), null);
        let idbSaved = false;
        let localSaved = false;
        if (idbUsable) {
          try {
            await writeIdb(key, tombstone, timeoutMs);
            idbSaved = true;
          } catch (error) {
            idbUsable = false;
            degraded = true;
            dispatchError(app, 'clear', error);
          }
        }
        try {
          localRemove(legacyKeys);
          localWrite(fallbackKey, tombstone);
          localSaved = true;
        } catch (error) {
          dispatchError(app, 'clear-fallback', error);
        }
        if (!idbSaved && !localSaved) {
          updateStatus(app, 'error', 'draft-clear-failed');
          return false;
        }
        if (idbSaved) degraded = false;
        updateStatus(app, 'saved');
        return true;
      });
    }

    function flush() {
      return operationQueue;
    }

    function getStatus() {
      return statuses.get(app) || { app, state: 'saved', message: '', updatedAt: 0 };
    }

    const api = { load, save, clear, flush, getStatus };
    stores.set(registryKey, api);
    if (!statuses.has(app)) updateStatus(app, 'saved');
    return api;
  }

  async function clearAllKnownDrafts() {
    const results = await Promise.all(Object.entries(KNOWN_DRAFTS).map(async ([app, config]) => {
      const store = createDraftStore({ app, ...config });
      return { app, cleared: await store.clear() };
    }));
    return results.every(result => result.cleared);
  }

  function getDraftStatus(app) {
    if (app) return statuses.get(app) || null;
    return Object.fromEntries(statuses.entries());
  }

  function storageStatusLabel(state) {
    if (state === 'saving') return 'Зберігається…';
    if (state === 'error') return 'Не вдалося зберегти — завантажте файл';
    return 'Збережено локально';
  }

  function renderStorageStatus(status) {
    const statusbar = document.querySelector('.office-statusbar');
    if (!statusbar || !status?.app || status.app !== document.body?.dataset.officeService) return;
    let badge = statusbar.querySelector('[data-office-storage-status]');
    if (!badge) {
      badge = document.createElement('span');
      badge.className = 'office-storage-status';
      badge.dataset.officeStorageStatus = '';
      badge.setAttribute('aria-live', 'polite');
      statusbar.appendChild(badge);
    }
    badge.dataset.state = status.state;
    badge.textContent = storageStatusLabel(status.state);
  }

  function showConfirmation({ title, message, confirmText }) {
    return new Promise(resolve => {
      const modal = document.createElement('div');
      modal.className = 'modal-overlay office-storage-confirm';
      modal.setAttribute('aria-hidden', 'true');

      const panel = document.createElement('section');
      panel.className = 'modal-box office-storage-dialog';
      panel.setAttribute('role', 'alertdialog');
      panel.setAttribute('aria-modal', 'true');

      const heading = document.createElement('h2');
      heading.textContent = title;
      const body = document.createElement('p');
      body.textContent = message;
      const actions = document.createElement('div');
      actions.className = 'office-storage-actions';
      const cancel = document.createElement('button');
      cancel.type = 'button';
      cancel.className = 'office-button';
      cancel.textContent = 'Скасувати';
      const confirm = document.createElement('button');
      confirm.type = 'button';
      confirm.className = 'office-button office-storage-danger';
      confirm.textContent = confirmText;
      actions.append(cancel, confirm);
      panel.append(heading, body, actions);
      modal.appendChild(panel);
      document.body.appendChild(modal);

      let settled = false;
      const finish = value => {
        if (settled) return;
        settled = true;
        window.OfficeUI?.closeModal?.(modal);
        modal.remove();
        resolve(value);
      };
      cancel.addEventListener('click', () => finish(false));
      confirm.addEventListener('click', () => finish(true));
      modal.addEventListener('click', event => {
        if (event.target === modal) finish(false);
      });
      modal.addEventListener('keydown', event => {
        if (event.key === 'Escape') finish(false);
      });

      window.OfficeUI?.closeMenus?.();
      if (window.OfficeUI?.openModal) window.OfficeUI.openModal(modal, { focus: true });
      else {
        modal.classList.add('active');
        modal.setAttribute('aria-hidden', 'false');
        confirm.focus();
      }
    });
  }

  async function endCurrentSession() {
    const app = document.body?.dataset.officeService;
    const config = KNOWN_DRAFTS[app];
    if (!config) return;
    const confirmed = await showConfirmation({
      title: 'Завершити роботу на цьому ПК?',
      message: 'Спочатку завантажте потрібний файл. Після завершення локальну чернетку буде очищено, а редактор відкриє порожній документ.',
      confirmText: 'Завершити роботу'
    });
    if (!confirmed) return;
    const cleared = await createDraftStore({ app, ...config }).clear();
    if (cleared) window.location.reload();
  }

  async function clearAllDraftsFromLanding(trigger) {
    const first = await showConfirmation({
      title: 'Очистити всі локальні чернетки?',
      message: 'Переконайтеся, що потрібні документи завантажено як файли. Ця дія очистить чернетки всіх шести редакторів на цьому пристрої.',
      confirmText: 'Продовжити'
    });
    if (!first) return;
    const second = await showConfirmation({
      title: 'Підтвердьте очищення',
      message: 'Відновити очищені локальні чернетки буде неможливо. Офлайн-кеш застосунку залишиться на пристрої.',
      confirmText: 'Очистити всі чернетки'
    });
    if (!second) return;
    const cleared = await clearAllKnownDrafts();
    const result = document.querySelector('[data-office-clear-drafts-result]');
    if (result) result.textContent = cleared ? 'Усі локальні чернетки очищено.' : 'Не всі чернетки вдалося очистити.';
    trigger?.focus();
  }

  function bindStorageUi() {
    const app = document.body?.dataset.officeService;
    const status = app ? statuses.get(app) : null;
    if (status) renderStorageStatus(status);
    document.addEventListener('click', event => {
      const endSession = event.target.closest('[data-office-end-session]');
      if (endSession) {
        event.preventDefault();
        endCurrentSession();
        return;
      }
      const clearAll = event.target.closest('[data-office-clear-drafts]');
      if (clearAll) {
        event.preventDefault();
        clearAllDraftsFromLanding(clearAll);
      }
    });
  }

  window.addEventListener('office:storage-status', event => renderStorageStatus(event.detail));
  window.addEventListener('office:storage-error', event => {
    const detail = event.detail || {};
    if (!detail.app) return;
    if (statuses.get(detail.app)?.state !== 'error') {
      updateStatus(detail.app, 'error', detail.message || 'storage-error');
    }
  });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bindStorageUi, { once: true });
  else bindStorageUi();

  window.OfficeStorage = {
    createDraftStore,
    clearAllKnownDrafts,
    getDraftStatus
  };
}());
