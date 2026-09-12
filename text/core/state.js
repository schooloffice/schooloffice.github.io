'use strict';
/* core/state.js — стан документа. Жодного DOM. */

const ArtState = (() => {
  const HEADER_FOOTER_TEXT_MAX = 120;
  const PAGE_NUMBER_POSITIONS = Object.freeze(['none', 'footer', 'header']);
  const DEFAULT_DOCUMENT = Object.freeze({
    orientation: 'portrait',
    pageSize: 'a4',
    margins: Object.freeze({ top: 2, right: 1.5, bottom: 2, left: 3 }),
    // Колонки першого розділу (1–3); інші розділи тримають свою кількість на розриві розділу.
    columns: 1,
    // Колонтитули всього документа: рядок угорі, рядок унизу й місце номера сторінки.
    headerFooter: Object.freeze({ header: '', footer: '', pageNumber: 'none' })
  });

  const _state = {
    fileName:    'документ',
    fileFormat:  'docx',
    dirty:       false,
    orientation: DEFAULT_DOCUMENT.orientation,   // 'portrait' | 'landscape'
    pageSize:    DEFAULT_DOCUMENT.pageSize,       // 'a4' | 'a5' | 'letter'
    margins:     { ...DEFAULT_DOCUMENT.margins }, // см, як у шкільних роботах
    headerFooter: { ...DEFAULT_DOCUMENT.headerFooter },
    columns:     DEFAULT_DOCUMENT.columns,
    zoom:        100,           // %
    spellcheck:  true,          // перевірка правопису браузером — вигляд, не документ
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
      margins: { ..._state.margins },
      headerFooter: { ..._state.headerFooter },
      columns: _state.columns
    };
  }

  // Кількість колонок із недовіреного джерела: ціле від 1 до 3, інакше одна колонка.
  function normalizeColumns(value) {
    const number = Math.round(Number(value));
    return Number.isFinite(number) && number >= 1 ? Math.min(3, number) : 1;
  }

  // Колонтитули приходять і з чернетки та файлів, тож приводимо їх до безпечної форми:
  // один рядок звичайного тексту без керівних символів і відоме місце номера сторінки.
  function normalizeHeaderFooter(value) {
    const source = value && typeof value === 'object' ? value : {};
    const text = raw => Array.from((typeof raw === 'string' ? raw : '').replace(/\s+/g, ' ').trim())
      .filter(ch => ch.charCodeAt(0) >= 32 && ch.charCodeAt(0) !== 127)
      .slice(0, HEADER_FOOTER_TEXT_MAX)
      .join('')
      .trim();
    return {
      header: text(source.header),
      footer: text(source.footer),
      pageNumber: PAGE_NUMBER_POSITIONS.includes(source.pageNumber) ? source.pageNumber : 'none'
    };
  }

  function restoreDocument(next = DEFAULT_DOCUMENT) {
    set('pageSize', next.pageSize || DEFAULT_DOCUMENT.pageSize);
    set('orientation', next.orientation || DEFAULT_DOCUMENT.orientation);
    set('margins', { ...DEFAULT_DOCUMENT.margins, ...(next.margins || {}) });
    set('headerFooter', normalizeHeaderFooter(next.headerFooter));
    set('columns', normalizeColumns(next.columns));
  }

  function resetDocument() { restoreDocument(DEFAULT_DOCUMENT); }

  return {
    on, get, set, setDirty, isDirty, snapshot,
    documentSnapshot, restoreDocument, resetDocument,
    normalizeHeaderFooter, normalizeColumns, HEADER_FOOTER_TEXT_MAX, PAGE_NUMBER_POSITIONS
  };
})();
