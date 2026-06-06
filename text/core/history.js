'use strict';
/* core/history.js — undo/redo з відновленням виділення */

const ArtHistory = (() => {
  const MAX = 150;
  let _stack = [];
  let _index = -1;
  let _editor = null;
  let _lastSaved = '';
  let _suspended = false;
  let _cb = null;

  function init(editor) {
    _editor = editor;
    _stack = [];
    _index = -1;
    pushNow();
    _lastSaved = editor.innerHTML;
    ArtState.setDirty(false);
  }

  function snapshot() {
    return {
      html: _editor.innerHTML,
      selection: ArtSelection.serializeSelection(_editor)
    };
  }

  function pushNow() {
    if (!_editor || _suspended) return;
    const snap = snapshot();
    if (_stack[_index] && _stack[_index].html === snap.html) {
      _stack[_index].selection = snap.selection;
      _notify();
      return;
    }
    _stack = _stack.slice(0, _index + 1);
    _stack.push(snap);
    if (_stack.length > MAX) _stack.shift();
    _index = _stack.length - 1;
    ArtState.setDirty(_editor.innerHTML !== _lastSaved);
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
    _editor.innerHTML = entry.html;
    ArtSelection.restoreSerializedSelection(_editor, entry.selection);
    _suspended = false;
    ArtState.setDirty(_editor.innerHTML !== _lastSaved);
    _editor.dispatchEvent(new Event('art:restored'));
    _notify();
  }

  function canUndo() { return _index > 0; }
  function canRedo() { return _index < _stack.length - 1; }

  function markSaved() {
    _lastSaved = _editor?.innerHTML ?? '';
    ArtState.setDirty(false);
    _notify();
  }

  function suspend(fn) {
    _suspended = true;
    try { fn?.(); } finally { _suspended = false; }
  }

  function onButtonsUpdate(fn) { _cb = fn; }
  function _notify() { _cb?.(); }

  return { init, pushNow, undo, redo, canUndo, canRedo, markSaved, suspend, onButtonsUpdate };
})();
