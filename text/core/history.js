'use strict';
/* core/history.js — undo/redo з відновленням виділення */

const ArtHistory = (() => {
  const MAX_HISTORY_ENTRIES = 80;
  const MAX_HISTORY_BYTES = 24 * 1024 * 1024;
  let _stack = [];
  let _index = -1;
  let _historyBytes = 0;
  let _editor = null;
  let _lastSaved = '';
  let _suspended = false;
  let _cb = null;
  // Редактор відновлює логічний знімок сам: створює аркуш, вміст і виділення,
  // а потім перекомпоновує сторінки.
  let _restorer = null;

  function init(editor) {
    _editor = editor;
    _stack = [];
    _index = -1;
    _historyBytes = 0;
    pushNow();
    _lastSaved = _snapshotKey(_stack[_index]);
    ArtState.setDirty(false);
  }

  // Знімок — логічний потік документа (без аркушів, повторених рядків і маркерів)
  // та логічні якорі виділення, а не сторінковий DOM.
  function snapshot() {
    const logical = ArtDocumentModel.serialize(_editor, { range: ArtSelection.getRange(_editor) });
    return {
      html: logical.html,
      selection: logical.selection,
      document: ArtState.documentSnapshot?.() || null
    };
  }

  function _estimateBytes(entry) {
    if (!entry) return 0;
    const selection = entry.selection ? JSON.stringify(entry.selection) : '';
    const documentState = entry.document ? JSON.stringify(entry.document) : '';
    return ((entry.html || '').length + selection.length + documentState.length) * 2;
  }

  function _recountBytes() {
    _historyBytes = _stack.reduce((sum, entry) => sum + (entry._bytes || _estimateBytes(entry)), 0);
  }

  // Відкидаються лише старші кроки. Поточний знімок лишається навіть тоді, коли сам
  // перевищує бюджет: це стан документа, від якого рахуються dirty й undo.
  function _trimToLimits() {
    while ((_stack.length > MAX_HISTORY_ENTRIES || _historyBytes > MAX_HISTORY_BYTES) && _index > 0) {
      const removed = _stack.shift();
      _historyBytes -= removed?._bytes || _estimateBytes(removed);
      _index -= 1;
    }
  }

  // Знімки вже канонічні, тож пагінація не дає «нового» кроку й не робить документ зміненим.
  function _snapshotKey(entry) {
    if (!entry) return '';
    return JSON.stringify({ html: entry.html, document: entry.document || null });
  }

  function pushNow() {
    if (!_editor || _suspended) return;
    const snap = snapshot();
    if (_stack[_index] && _snapshotKey(_stack[_index]) === _snapshotKey(snap)) {
      const previousBytes = _stack[_index]._bytes || _estimateBytes(_stack[_index]);
      _stack[_index].selection = snap.selection;
      _stack[_index]._bytes = _estimateBytes(_stack[_index]);
      _historyBytes += _stack[_index]._bytes - previousBytes;
      _trimToLimits();
      _notify();
      return;
    }
    _stack = _stack.slice(0, _index + 1);
    _recountBytes();
    snap._bytes = _estimateBytes(snap);
    _stack.push(snap);
    _index = _stack.length - 1;
    _historyBytes += snap._bytes;
    _trimToLimits();
    ArtState.setDirty(_snapshotKey(snap) !== _lastSaved);
    _notify();
  }

  function undo() {
    if (_index <= 0) return;
    _index -= 1;
    _restore(_stack[_index]);
  }

  function redo() {
    if (_index >= _stack.length - 1) return;
    _index += 1;
    _restore(_stack[_index]);
  }

  function _restore(entry) {
    if (!_editor || !entry) return;
    _suspended = true;
    try {
      ArtState.restoreDocument?.(entry.document || undefined);
      if (_restorer) {
        _restorer(entry.html, entry.selection);
      } else {
        const content = _editor.querySelector('.page-content') || _editor;
        content.innerHTML = entry.html;
      }
    } finally {
      _suspended = false;
    }
    ArtState.setDirty(_snapshotKey(entry) !== _lastSaved);
    _editor.dispatchEvent(new Event('art:restored'));
    _notify();
  }

  function canUndo() { return _index > 0; }
  function canRedo() { return _index < _stack.length - 1; }

  function markSaved() {
    _lastSaved = _editor ? _snapshotKey(snapshot()) : '';
    ArtState.setDirty(false);
    _notify();
  }

  function suspend(fn) {
    _suspended = true;
    try { fn?.(); } finally { _suspended = false; }
  }

  function onButtonsUpdate(fn) { _cb = fn; }
  function _notify() { _cb?.(); }
  function setRestorer(fn) { _restorer = typeof fn === 'function' ? fn : null; }

  // Копія поточного знімка (для перевірок і діагностики).
  function current() {
    const entry = _stack[_index];
    if (!entry) return null;
    return {
      html: entry.html,
      selection: entry.selection ? JSON.parse(JSON.stringify(entry.selection)) : null,
      document: entry.document ? JSON.parse(JSON.stringify(entry.document)) : null
    };
  }

  function getStats() {
    return {
      entries: _stack.length,
      bytes: _historyBytes,
      maxEntries: MAX_HISTORY_ENTRIES,
      maxBytes: MAX_HISTORY_BYTES
    };
  }

  return { init, pushNow, undo, redo, canUndo, canRedo, markSaved, suspend, onButtonsUpdate, getStats, setRestorer, current };
})();
