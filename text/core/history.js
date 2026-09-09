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

  function init(editor) {
    _editor = editor;
    _stack = [];
    _index = -1;
    _historyBytes = 0;
    pushNow();
    _lastSaved = _snapshotKey(_stack[_index]);
    ArtState.setDirty(false);
  }

  function snapshot() {
    return {
      html: _editor.innerHTML,
      selection: ArtSelection.serializeSelection(_editor),
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

  function _trimToLimits() {
    while (_stack.length > MAX_HISTORY_ENTRIES || _historyBytes > MAX_HISTORY_BYTES) {
      const removed = _stack.shift();
      _historyBytes -= removed?._bytes || _estimateBytes(removed);
      _index -= 1;
    }
    if (_index < 0) {
      _stack = [];
      _index = -1;
      _historyBytes = 0;
    }
  }

  function _snapshotKey(entry) {
    if (!entry) return '';
    return JSON.stringify({ html: _logicalHTML(entry.html), document: entry.document || null });
  }

  // Пагінація змінює фізичні .page-обгортки, але не сам документ. Для dirty та
  // усунення дублів історії порівнюємо логічний потік без службових клонів.
  function _logicalHTML(html) {
    const source = document.createElement('div');
    source.innerHTML = html || '';
    const logical = document.createElement('div');
    const pageContents = [...source.querySelectorAll('.page-content')];
    const containers = pageContents.length ? pageContents : [source];
    containers.forEach(container => {
      [...container.childNodes].forEach(node => logical.appendChild(node.cloneNode(true)));
    });

    logical.querySelectorAll('.art-sel-marker, tr[data-art-table-repeat]').forEach(node => node.remove());
    logical.querySelectorAll('[data-art-flow-tail]').forEach(node => node.removeAttribute('data-art-flow-tail'));
    logical.querySelectorAll('.is-selected').forEach(node => node.classList.remove('is-selected'));
    logical.querySelectorAll('mark.search-hit').forEach(mark => mark.replaceWith(...mark.childNodes));

    let node = logical.firstElementChild;
    while (node) {
      const next = node.nextElementSibling;
      if (node.tagName === 'TABLE' && next?.tagName === 'TABLE' && next.dataset.artTablePart === 'continued') {
        const body = node.tBodies[0] || node;
        [...(next.tBodies[0] || next).rows].forEach(row => body.appendChild(row));
        next.remove();
        continue;
      }
      node = next;
    }
    logical.querySelectorAll('table[data-art-table-part]').forEach(table => table.removeAttribute('data-art-table-part'));
    return logical.innerHTML;
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
      _editor.innerHTML = entry.html;
      ArtSelection.restoreSerializedSelection(_editor, entry.selection);
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

  function getStats() {
    return {
      entries: _stack.length,
      bytes: _historyBytes,
      maxEntries: MAX_HISTORY_ENTRIES,
      maxBytes: MAX_HISTORY_BYTES
    };
  }

  return { init, pushNow, undo, redo, canUndo, canRedo, markSaved, suspend, onButtonsUpdate, getStats };
})();
