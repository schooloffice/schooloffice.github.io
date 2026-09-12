'use strict';
/* core/storage.js — autosave і відновлення локальної чернетки Text */

const ArtTextStorage = (() => {
  const MAX_DRAFT_BYTES = 8 * 1024 * 1024;
  const AUTOSAVE_DELAY_MS = 300;
  const store = window.OfficeStorage.createDraftStore({
    app: 'text',
    key: 'text',
    fallbackKey: 'office_draft_text_v1'
  });

  let _editor = null;
  let _timer = 0;
  let _restoring = false;
  let _sizeWarningShown = false;

  function serializedBytes(payload) {
    const json = JSON.stringify(payload);
    return typeof TextEncoder === 'function'
      ? new TextEncoder().encode(json).byteLength
      : json.length * 2;
  }

  function reportSizeError(bytes) {
    const message = `Чернетка займає ${Math.ceil(bytes / 1024 / 1024)} MiB і перевищує локальний ліміт 8 MiB.`;
    window.dispatchEvent(new CustomEvent('office:storage-error', {
      detail: { app: 'text', operation: 'size-limit', message }
    }));
    if (_sizeWarningShown) return;
    _sizeWarningShown = true;
    showDialog({
      title: 'Чернетка завелика для автозбереження',
      message: `${message} Завантажте документ як файл, щоб не втратити роботу.`,
      primaryText: 'Завантажити .docx',
      secondaryText: 'Закрити'
    }).then(choice => {
      if (choice === 'primary') _editor?.saveAs?.('docx');
    });
  }

  async function saveSnapshot() {
    if (!_editor || _restoring) return false;
    const snapshot = _editor.getDraftPayload();
    const bytes = serializedBytes(snapshot);
    if (bytes > MAX_DRAFT_BYTES) {
      reportSizeError(bytes);
      return false;
    }
    _sizeWarningShown = false;
    try {
      await store.save(snapshot);
      return true;
    } catch {
      return false;
    }
  }

  function schedule() {
    if (!_editor || _restoring) return;
    clearTimeout(_timer);
    _timer = setTimeout(() => {
      _timer = 0;
      saveSnapshot();
    }, AUTOSAVE_DELAY_MS);
  }

  function saveNow() {
    clearTimeout(_timer);
    _timer = 0;
    return saveSnapshot();
  }

  function showDialog({ title, message, primaryText, secondaryText }) {
    return new Promise(resolve => {
      const overlay = document.createElement('div');
      overlay.className = 'modal-overlay office-storage-confirm';
      overlay.setAttribute('aria-hidden', 'true');

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
      const secondary = document.createElement('button');
      secondary.type = 'button';
      secondary.className = 'office-button';
      secondary.textContent = secondaryText;
      const primary = document.createElement('button');
      primary.type = 'button';
      primary.className = 'office-button';
      primary.textContent = primaryText;
      actions.append(secondary, primary);
      panel.append(heading, body, actions);
      overlay.appendChild(panel);
      document.body.appendChild(overlay);

      let settled = false;
      function finish(choice) {
        if (settled) return;
        settled = true;
        window.OfficeUI?.closeModal?.(overlay, { restoreFocus: false });
        overlay.remove();
        resolve(choice);
      }
      secondary.addEventListener('click', () => finish('secondary'));
      primary.addEventListener('click', () => finish('primary'));
      overlay.addEventListener('click', event => {
        if (event.target === overlay) finish('dismissed');
      });
      overlay.addEventListener('keydown', event => {
        if (event.key === 'Escape') finish('dismissed');
      });

      if (window.OfficeUI?.openModal) window.OfficeUI.openModal(overlay, { focus: true });
      else {
        overlay.classList.add('active');
        overlay.setAttribute('aria-hidden', 'false');
        primary.focus();
      }
    });
  }

  async function offerDraft(draft, bootRevision) {
    const choice = await showDialog({
      title: 'Знайдено локальну чернетку',
      message: 'Відновити незавершений текстовий документ чи видалити цю чернетку?',
      primaryText: 'Відновити',
      secondaryText: 'Видалити'
    });
    if (choice === 'secondary') {
      await store.clear();
      return;
    }
    if (choice !== 'primary') return;
    if (_editor.getDocumentRevision() !== bootRevision) {
      ArtModals.info('Чернетку не відновлено', 'Після запуску вже було відкрито або змінено інший документ.');
      return;
    }
    _restoring = true;
    try {
      _editor.restoreDraft(draft);
    } catch (error) {
      await store.clear();
      ArtModals.info('Пошкоджена чернетка', 'Чернетку не вдалося відновити, тому редактор відкрито з порожнім документом.');
    } finally {
      _restoring = false;
    }
  }

  async function init(editorFacade) {
    _editor = editorFacade;
    const editorHost = document.getElementById('editor');
    editorHost?.addEventListener('input', schedule);
    ArtState.on('change', change => {
      if (['fileName', 'fileFormat', 'orientation', 'pageSize', 'margins', 'headerFooter', 'columns'].includes(change?.key)) schedule();
    });
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) saveNow();
    });
    window.addEventListener('pagehide', saveNow);

    const bootRevision = _editor.getDocumentRevision();
    let draft = null;
    try {
      draft = await store.load();
    } catch {
      return;
    }
    if (!draft || _editor.getDocumentRevision() !== bootRevision) return;
    await offerDraft(draft, bootRevision);
  }

  function clear() {
    clearTimeout(_timer);
    _timer = 0;
    return store.clear();
  }

  function flush() {
    return _timer ? saveNow() : store.flush();
  }

  return {
    init,
    schedule,
    saveNow,
    clear,
    flush,
    getStatus: store.getStatus,
    MAX_DRAFT_BYTES
  };
})();
