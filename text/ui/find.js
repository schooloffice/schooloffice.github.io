'use strict';
/* ui/find.js — пошук і заміна буквального тексту в документі */

const ArtFind = (() => {
  const ZWSP = '​';
  // Збіг не перетинає межу абзацу, пункту списку чи клітинки таблиці.
  const UNIT_SELECTOR = 'td,th,li,p,h1,h2,h3,h4,blockquote,div';
  // Повторені пагінатором заголовки таблиць і маркери каретки не є текстом документа.
  const SKIP_SELECTOR = 'tr[data-art-table-repeat], .art-sel-marker, [aria-hidden="true"]';
  // Розрив рядка чи зображення всередині абзацу розділяє слова.
  const BREAK_TAGS = new Set(['BR', 'IMG', 'HR', 'FIGURE']);
  const MAX_PAINTED = 2000;
  const HIGHLIGHT_ALL = 'art-find';
  const HIGHLIGHT_CURRENT = 'art-find-current';

  let _editor = null;
  let _current = -1;
  let _currentKey = '';
  let _selfEdit = false;
  let _liveTimer = 0;

  function init(editor) {
    _editor = editor;
    // Після редагування старий номер збігу недійсний: наступний пошук іде від каретки.
    _editor.addEventListener('input', () => {
      if (!_selfEdit) _current = -1;
    });
    _editor.addEventListener('art:restored', () => {
      _current = -1;
      _refreshIfOpen();
    });
    // Пагінація переставляє вузли, тож підсвітку перебудовуємо з нового DOM.
    _editor.addEventListener('art:paginated', _refreshIfOpen);
    document.addEventListener('office:overlayclose', event => {
      if (event.detail?.modal?.id === 'modalFind') {
        _current = -1;
        clearHighlights();
      }
    });
    _bindDialog();
  }

  function _el(id) {
    return document.getElementById(id);
  }

  function _bindDialog() {
    const live = () => {
      clearTimeout(_liveTimer);
      _liveTimer = setTimeout(() => {
        _current = -1;
        const options = _dialogOptions();
        refresh(options.query, options);
      }, 150);
    };
    _el('findInput')?.addEventListener('input', live);
    _el('findMatchCase')?.addEventListener('change', live);
    _el('findInput')?.addEventListener('keydown', event => {
      if (event.key !== 'Enter') return;
      event.preventDefault();
      _runDialog('find');
    });
    _el('replaceInput')?.addEventListener('keydown', event => {
      if (event.key !== 'Enter') return;
      event.preventDefault();
      _runDialog('replace');
    });
    document.querySelector('[data-find-next]')?.addEventListener('click', () => _runDialog('find'));
    document.querySelector('[data-replace-one]')?.addEventListener('click', () => _runDialog('replace'));
    document.querySelector('[data-replace-all]')?.addEventListener('click', () => _runDialog('replace-all'));
  }

  function _dialogOptions() {
    return {
      query: _el('findInput')?.value || '',
      replacement: _el('replaceInput')?.value || '',
      matchCase: !!_el('findMatchCase')?.checked
    };
  }

  function _runDialog(action) {
    clearTimeout(_liveTimer);
    const options = _dialogOptions();
    if (action === 'replace') return replaceCurrent(options.query, options.replacement, options);
    if (action === 'replace-all') return replaceAll(options.query, options.replacement, options);
    return findNext(options.query, options);
  }

  function open(mode = 'find') {
    if (_editor) ArtSelection.remember(_editor);
    const find = _el('findInput');
    const replace = _el('replaceInput');
    [find, replace].forEach(input => input?.removeAttribute('data-autofocus'));
    (mode === 'replace' && replace ? replace : find)?.setAttribute('data-autofocus', '');
    ArtModals.open('modalFind');
    _current = -1;
    const options = _dialogOptions();
    if (options.query) refresh(options.query, options);
    else _setStatus('');
  }

  function _isOpen() {
    return !!_el('modalFind')?.classList.contains('active');
  }

  function _refreshIfOpen() {
    if (!_isOpen()) return;
    const options = _dialogOptions();
    refresh(options.query, options);
  }

  function _key(query, matchCase) {
    return JSON.stringify([String(query), !!matchCase]);
  }

  // Текст кожного блока разом із відповідністю позицій символів вузлам DOM.
  function _units() {
    const units = [];
    const byElement = new Map();
    let lastUnit = null;
    ArtSelection.getPageContents(_editor).forEach(content => {
      const walker = document.createTreeWalker(content, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT, {
        acceptNode(node) {
          if (node.nodeType === Node.TEXT_NODE) return NodeFilter.FILTER_ACCEPT;
          if (node.matches(SKIP_SELECTOR)) return NodeFilter.FILTER_REJECT;
          return BREAK_TAGS.has(node.tagName) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP;
        }
      });
      let node;
      while ((node = walker.nextNode())) {
        const element = node.parentElement?.closest(UNIT_SELECTOR) || content;
        let unit = byElement.get(element);
        if (!unit) {
          unit = { text: '', segments: [] };
          byElement.set(element, unit);
          units.push(unit);
        } else if (unit !== lastUnit && unit.text) {
          // Хвіст пункту після вкладеного списку не зливається з початком пункту.
          unit.text += '\n';
        }
        lastUnit = unit;
        if (node.nodeType !== Node.TEXT_NODE) {
          unit.text += '\n';
          continue;
        }
        const data = node.data;
        let clean = data;
        let map = null;
        if (data.includes(ZWSP)) {
          clean = '';
          map = [];
          for (let i = 0; i < data.length; i++) {
            if (data[i] === ZWSP) continue;
            map.push(i);
            clean += data[i];
          }
        }
        if (!clean) continue;
        unit.segments.push({ node, start: unit.text.length, length: clean.length, map });
        unit.text += clean;
      }
    });
    return units;
  }

  // Регістр згортаємо посимвольно, щоб позиції в згорнутому й сирому тексті збігалися.
  function _fold(text, matchCase) {
    if (matchCase) return text;
    let folded = '';
    for (let i = 0; i < text.length; i++) {
      const lower = text[i].toLocaleLowerCase('uk');
      folded += lower.length === 1 ? lower : text[i];
    }
    return folded;
  }

  function _point(unit, index, isEnd) {
    const target = isEnd ? index - 1 : index;
    let low = 0;
    let high = unit.segments.length - 1;
    while (low <= high) {
      const mid = (low + high) >> 1;
      const segment = unit.segments[mid];
      if (target < segment.start) high = mid - 1;
      else if (target >= segment.start + segment.length) low = mid + 1;
      else {
        const offset = segment.map ? segment.map[target - segment.start] : target - segment.start;
        return { node: segment.node, offset: isEnd ? offset + 1 : offset };
      }
    }
    return null;
  }

  function _compareMatches(a, b) {
    if (a.startNode === b.startNode) return a.startOffset - b.startOffset;
    return a.startNode.compareDocumentPosition(b.startNode) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1;
  }

  function collect(query, { matchCase = false } = {}) {
    query = String(query ?? '');
    if (!_editor || !query || /[\r\n]/.test(query)) return [];
    const needle = _fold(query, matchCase);
    const matches = [];
    _units().forEach(unit => {
      const haystack = _fold(unit.text, matchCase);
      let from = 0;
      while (true) {
        const index = haystack.indexOf(needle, from);
        if (index === -1) break;
        const start = _point(unit, index, false);
        const end = _point(unit, index + needle.length, true);
        if (start && end) {
          matches.push({ startNode: start.node, startOffset: start.offset, endNode: end.node, endOffset: end.offset });
        }
        from = index + needle.length;
      }
    });
    return matches.sort(_compareMatches);
  }

  function _range(match) {
    const range = document.createRange();
    range.setStart(match.startNode, match.startOffset);
    range.setEnd(match.endNode, match.endOffset);
    return range;
  }

  function _highlightSupported() {
    return typeof CSS !== 'undefined' && !!CSS.highlights && typeof Highlight === 'function';
  }

  // Підсвітка не змінює DOM: у файл, чернетку й історію вона не потрапляє.
  function _paint(matches, current) {
    if (!_highlightSupported()) return;
    const all = new Highlight();
    matches.slice(0, MAX_PAINTED).forEach((match, index) => {
      if (index !== current) all.add(_range(match));
    });
    CSS.highlights.set(HIGHLIGHT_ALL, all);
    if (matches[current]) {
      const active = new Highlight(_range(matches[current]));
      active.priority = 1;
      CSS.highlights.set(HIGHLIGHT_CURRENT, active);
    } else {
      CSS.highlights.delete(HIGHLIGHT_CURRENT);
    }
  }

  function clearHighlights() {
    if (!_highlightSupported()) return;
    CSS.highlights.delete(HIGHLIGHT_ALL);
    CSS.highlights.delete(HIGHLIGHT_CURRENT);
  }

  function paintedCount() {
    if (!_highlightSupported()) return 0;
    return (CSS.highlights.get(HIGHLIGHT_ALL)?.size || 0) + (CSS.highlights.get(HIGHLIGHT_CURRENT)?.size || 0);
  }

  function _anchor() {
    const saved = _editor?._artSavedRange;
    if (!saved || !_editor.contains(saved.endContainer)) return null;
    const anchor = saved.cloneRange();
    anchor.collapse(false);
    return anchor;
  }

  function _firstAfter(matches, anchor) {
    if (!anchor) return 0;
    const index = matches.findIndex(match => {
      try {
        return anchor.comparePoint(match.startNode, match.startOffset) >= 0;
      } catch {
        return false;
      }
    });
    return index === -1 ? 0 : index;
  }

  function _select(match) {
    const range = _range(match);
    ArtSelection.restore(range);
    _editor._artSavedRange = range.cloneRange();
    match.startNode.parentElement?.scrollIntoView?.({ block: 'center' });
  }

  function _setStatus(text) {
    const status = _el('findStatus');
    if (status) status.textContent = text;
  }

  function _report(result) {
    const parts = [];
    if (result.empty) parts.push('Введіть текст для пошуку.');
    else {
      if (result.replaced !== undefined) parts.push(`Замінено: ${result.replaced}.`);
      if (!result.total) parts.push(result.replaced ? 'Більше збігів немає.' : 'Нічого не знайдено.');
      else if (result.current >= 0) parts.push(`Збіг ${result.current + 1} з ${result.total}.`);
      else parts.push(`Збігів: ${result.total}.`);
    }
    _setStatus(parts.join(' '));
    return { total: 0, current: -1, ...result };
  }

  function _empty() {
    _current = -1;
    clearHighlights();
    return _report({ empty: true });
  }

  function refresh(query, options = {}) {
    if (!query) {
      clearHighlights();
      _setStatus('');
      return { total: 0, current: -1 };
    }
    const matches = collect(query, options);
    if (_currentKey !== _key(query, options.matchCase) || _current >= matches.length) _current = -1;
    _paint(matches, _current);
    return _report({ total: matches.length, current: _current });
  }

  function findNext(query, options = {}) {
    if (!query) return _empty();
    const matches = collect(query, options);
    const key = _key(query, options.matchCase);
    if (!matches.length) {
      _current = -1;
      clearHighlights();
      return _report({ total: 0, current: -1 });
    }
    const next = _current >= 0 && _currentKey === key
      ? (_current + 1) % matches.length
      : _firstAfter(matches, _anchor());
    _current = next;
    _currentKey = key;
    _select(matches[next]);
    _paint(matches, next);
    return _report({ total: matches.length, current: next });
  }

  // Вставлений текст отримує оформлення першого символу збігу: він пишеться в той самий текстовий вузол.
  function _replaceMatch(match, text) {
    const { startNode, startOffset, endNode, endOffset } = match;
    if (startNode === endNode) {
      startNode.replaceData(startOffset, endOffset - startOffset, text);
    } else {
      startNode.replaceData(startOffset, startNode.length - startOffset, text);
      const tail = document.createRange();
      tail.setStart(startNode, startOffset + text.length);
      tail.setEnd(endNode, endOffset);
      tail.deleteContents();
    }
    const cell = startNode.parentElement?.closest('td,th,li');
    if (cell && !cell.textContent.replaceAll(ZWSP, '') && !cell.querySelector('br,img,table,hr')) {
      cell.appendChild(document.createElement('br'));
    }
    const after = document.createRange();
    after.setStart(startNode, Math.min(startOffset + text.length, startNode.length));
    after.collapse(true);
    return after;
  }

  function _commit() {
    _selfEdit = true;
    try {
      ArtSelection.normalizeEditor(_editor);
      _editor.dispatchEvent(new Event('input', { bubbles: true }));
    } finally {
      _selfEdit = false;
    }
    // Знімок одразу: уся операція — один крок undo; пагінація логічний документ не змінює.
    ArtHistory.pushNow();
  }

  function replaceCurrent(query, replacement = '', options = {}) {
    if (!query) return _empty();
    const matches = collect(query, options);
    const key = _key(query, options.matchCase);
    const match = _current >= 0 && _currentKey === key ? matches[_current] : null;
    // Як у Word: перше натискання лише показує збіг, який буде замінено.
    if (!match) return findNext(query, options);

    ArtHistory.pushNow();
    const after = _replaceMatch(match, String(replacement ?? ''));
    _commit();

    const rest = collect(query, options);
    if (!rest.length) {
      _current = -1;
      clearHighlights();
      ArtSelection.restore(after);
      _editor._artSavedRange = after.cloneRange();
      return _report({ total: 0, current: -1, replaced: 1 });
    }
    const next = _firstAfter(rest, after);
    _current = next;
    _currentKey = key;
    _select(rest[next]);
    _paint(rest, next);
    return _report({ total: rest.length, current: next, replaced: 1 });
  }

  function replaceAll(query, replacement = '', options = {}) {
    if (!query) return _empty();
    const matches = collect(query, options);
    if (!matches.length) {
      _current = -1;
      clearHighlights();
      return _report({ total: 0, current: -1, replaced: 0 });
    }

    ArtHistory.pushNow();
    const text = String(replacement ?? '');
    // Від кінця документа: позиції попередніх збігів лишаються дійсними.
    let after = null;
    for (let i = matches.length - 1; i >= 0; i--) after = _replaceMatch(matches[i], text);
    if (after) {
      ArtSelection.restore(after);
      _editor._artSavedRange = after.cloneRange();
    }
    _commit();

    _current = -1;
    const rest = collect(query, options);
    _paint(rest, -1);
    return _report({ total: rest.length, current: -1, replaced: matches.length });
  }

  function reset() {
    clearTimeout(_liveTimer);
    _current = -1;
    _currentKey = '';
    clearHighlights();
    _setStatus('');
  }

  return { init, open, collect, refresh, findNext, replaceCurrent, replaceAll, reset, clearHighlights, paintedCount };
})();
