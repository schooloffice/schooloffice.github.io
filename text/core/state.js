'use strict';
/* core/state.js — стан документа. Жодного DOM. */

const ArtState = (() => {
  const _state = {
    fileName:    'документ',
    fileFormat:  'docx',
    dirty:       false,
    orientation: 'portrait',   // 'portrait' | 'landscape'
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
    if (_state[key] === value) return;
    _state[key] = value;
    emit('change', { key, value });
    emit(`change:${key}`, value);
  }

  function setDirty(val) { set('dirty', val); }
  function isDirty()     { return _state.dirty; }

  function snapshot() { return { ..._state }; }

  return { on, get, set, setDirty, isDirty, snapshot };
})();
