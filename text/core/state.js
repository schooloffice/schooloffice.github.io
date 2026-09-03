'use strict';
/* core/state.js — стан документа. Жодного DOM. */

const ArtState = (() => {
  const DEFAULT_DOCUMENT = Object.freeze({
    orientation: 'portrait',
    pageSize: 'a4',
    margins: Object.freeze({ top: 2, right: 1.5, bottom: 2, left: 3 })
  });

  const _state = {
    fileName:    'документ',
    fileFormat:  'docx',
    dirty:       false,
    orientation: DEFAULT_DOCUMENT.orientation,   // 'portrait' | 'landscape'
    pageSize:    DEFAULT_DOCUMENT.pageSize,       // 'a4' | 'a5' | 'letter'
    margins:     { ...DEFAULT_DOCUMENT.margins }, // см, як у шкільних роботах
    zoom:        100,           // %
    fontFamily:  'Times New Roman',
    fontSize:    14,            // pt
  };

  const _listeners = {};

  function on(event, fn) {
    if (!_listeners[event]) _listeners[event] = [];
    _listeners[event].push(fn);
  }

  function emit(event, data) {
    (_listeners[event] || []).forEach(fn => fn(data));
  }

  function get(key) { return _state[key]; }

  function set(key, value) {
    if (_state[key] === value && typeof value !== 'object') return;
    _state[key] = value;
    emit('change', { key, value });
    emit(`change:${key}`, value);
  }

  function setDirty(val) { set('dirty', val); }
  function isDirty()     { return _state.dirty; }

  function snapshot() { return { ..._state }; }

  // Лише властивості, що є частиною документа. Масштаб і стан інтерфейсу
  // навмисно не потрапляють в Undo/Redo та перевірку незбережених змін.
  function documentSnapshot() {
    return {
      orientation: _state.orientation,
      pageSize: _state.pageSize,
      margins: { ..._state.margins }
    };
  }

  function restoreDocument(next = DEFAULT_DOCUMENT) {
    set('pageSize', next.pageSize || DEFAULT_DOCUMENT.pageSize);
    set('orientation', next.orientation || DEFAULT_DOCUMENT.orientation);
    set('margins', { ...DEFAULT_DOCUMENT.margins, ...(next.margins || {}) });
  }

  function resetDocument() { restoreDocument(DEFAULT_DOCUMENT); }

  return {
    on, get, set, setDirty, isDirty, snapshot,
    documentSnapshot, restoreDocument, resetDocument
  };
})();
