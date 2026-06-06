'use strict';
/* ui/editor.js — full refactor: pages, image resize, safe tables */

const ArtEditor = (() => {
  let _editor = null;
  let _announcer = null;
  let _findState = { query: '', index: -1, matches: [] };
  let _layoutQueued = 0;
  let _layoutLock = false;
  let _selectedImage = null;
  let _resizeState = null;
  let _historyTimer = 0;

  function init(editorEl, announcerEl) {
    _editor = editorEl;
    _announcer = announcerEl;

    _editor.addEventListener('beforeinput', _handleBeforeInput);
    _editor.addEventListener('input', _handleInput);
    _editor.addEventListener('keydown', _handleKeydown);
    _editor.addEventListener('click', _handleClick);
    _editor.addEventListener('pointerdown', _handlePointerDown);
    _editor.addEventListener('mouseup', () => {
      ArtToolbar.updateState();
      ArtSelection.remember(_editor);
    });
    _editor.addEventListener('keyup', () => {
      ArtToolbar.updateState();
      ArtSelection.remember(_editor);
    });
    _editor.addEventListener('art:restored', () => {
      _normalizePages();
      _syncView();
      ArtToolbar.updateState();
    });

    document.addEventListener('pointermove', _handlePointerMove);
    document.addEventListener('pointerup', _handlePointerUp);
    document.addEventListener('click', e => {
      if (!e.target.closest('.art-image-block')) clearSelectedImage();
    });

    ArtState.on('change:dirty', dirty => {
      const dot = document.getElementById('dirtyDot');
      if (dot) dot.style.display = dirty ? 'inline-block' : 'none';
    });
    ArtState.on('change:orientation', _applyOrientation);
    ArtState.on('change:zoom', _applyZoom);

    document.getElementById('fileInput')?.addEventListener('change', _handleFileOpen);
    document.getElementById('imageInput')?.addEventListener('change', _handleImageInsert);
    window.addEventListener('resize', () => _queueRepaginate(false));
    window.addEventListener('beforeunload', e => {
      if (ArtState.isDirty()) { e.preventDefault(); e.returnValue = ''; }
    });

    _buildEmptyDocument();
    _applyOrientation(ArtState.get('orientation'));
    _applyZoom(ArtState.get('zoom'));
    _updateFileName();
    _syncView();
    ArtSelection.focusEditor(_editor);
  }

  function newDoc() {
    clearFindHighlights();
    clearSelectedImage();
    _buildEmptyDocument();
    ArtState.set('fileName', 'документ');
    ArtState.set('fileFormat', 'docx');
    ArtHistory.init(_editor);
    ArtHistory.markSaved();
    _updateFileName();
    _syncView();
    ArtSelection.focusEditor(_editor);
    _announce('Новий документ');
  }

  async function _handleFileOpen(e) {
    const file = e.target.files[0];
    if (!file) return;
    e.target.value = '';
    const ext = file.name.split('.').pop().toLowerCase();
    try {
      let result;
      if (ext === 'txt') result = await ArtTxt.importTxt(file);
      else if (ext === 'rtf') result = await ArtRtf.importRtf(file);
      else if (ext === 'docx') result = await ArtDocx.importDocx(file);
      else return ArtModals.info('Непідтримуваний формат', `Файл .${ext} не підтримується.`);

      clearFindHighlights();
      clearSelectedImage();
      _setDocumentHTML(result.html);
      ArtState.set('fileName', _stripExt(file.name));
      ArtState.set('fileFormat', result.meta.format);
      ArtHistory.init(_editor);
      ArtHistory.markSaved();
      _updateFileName();
      _syncView();
      if (result.meta.warnings?.length) {
        ArtModals.info('Файл відкрито з застереженнями', 'Деяке форматування могло бути спрощено.');
      }
      _announce(`Файл ${file.name} відкрито`);
    } catch (err) {
      ArtModals.info('Помилка відкриття', err.message || String(err));
    }
  }

  async function saveAs(format) {
    ArtModals.close('modalSave');
    const html = _getExportHTML();
    try {
      let blob, ext;
      if (format === 'txt') {
        blob = new Blob([ArtTxt.exportTxt(html)], { type: 'text/plain;charset=utf-8' });
        ext = 'txt';
      } else if (format === 'rtf') {
        blob = new Blob([ArtRtf.exportRtf(html)], { type: 'application/rtf;charset=utf-8' });
        ext = 'rtf';
      } else if (format === 'docx') {
        blob = await ArtDocx.exportDocx(html, { orientation: ArtState.get('orientation') });
        ext = 'docx';
      } else return;
      _download(blob, `${ArtState.get('fileName')}.${ext}`);
      ArtState.set('fileFormat', format);
      ArtHistory.markSaved();
      _flashSaved();
      _announce(`Збережено як ${ArtState.get('fileName')}.${ext}`);
    } catch (err) {
      ArtModals.info('Помилка збереження', err.message || String(err));
    }
  }

  function setOrientation(value) { ArtState.set('orientation', value); }
  function setZoom(value) { ArtState.set('zoom', value); }

  function _applyOrientation(value) {
    const pages = document.querySelector('.pages-wrap');
    if (pages) pages.dataset.orientation = value;
    _queueRepaginate(false);
    document.querySelectorAll('[data-action^="orient-"]').forEach(item => {
      item.classList.toggle('checked', item.dataset.action === `orient-${value}`);
    });
  }

  function _applyZoom(pct) {
    const wrap = document.querySelector('.pages-wrap');
    if (wrap) wrap.style.setProperty('--zoom', pct / 100);
    document.querySelectorAll('[data-action^="zoom-"]').forEach(item => {
      item.classList.toggle('checked', item.dataset.action === `zoom-${pct}`);
    });
    const badge = document.getElementById('zoomBadge');
    if (badge) badge.textContent = `${pct}%`;
  }

  function insertTable(rows, cols) {
    ArtModals.close('modalTable');
    const safeRows = Math.max(1, Math.min(50, Number(rows) || 1));
    const safeCols = Math.max(1, Math.min(20, Number(cols) || 1));

    ArtSelection.focusEditor(_editor);
    const table = document.createElement('table');
    const tbody = document.createElement('tbody');
    for (let r = 0; r < safeRows; r++) {
      const tr = document.createElement('tr');
      for (let c = 0; c < safeCols; c++) {
        const cell = document.createElement(r === 0 ? 'th' : 'td');
        cell.innerHTML = '<br>';
        tr.appendChild(cell);
      }
      tbody.appendChild(tr);
    }
    table.appendChild(tbody);
    ArtSelection.insertBlockNode(_editor, table, { insertParagraphAfter: true });

    const firstCell = table.querySelector('th,td');
    if (firstCell) {
      const range = document.createRange();
      range.selectNodeContents(firstCell);
      range.collapse(true);
      ArtSelection.restore(range);
    }

    _editor.dispatchEvent(new Event('input', { bubbles: true }));
    requestAnimationFrame(() => {
      ArtHistory.pushNow();
      ArtToolbar.updateState();
    });
  }

  function openImageDialog() {
    ArtSelection.remember(_editor);
    const input = document.getElementById('imageInput');
    window.OfficeUI?.openFilePicker?.(input) || input?.click();
  }

  async function _handleImageInsert(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';
    const reader = new FileReader();
    reader.onload = () => {
      ArtSelection.restoreLast(_editor);
      ArtToolbar.run(() => ArtSelection.insertImage(_editor, String(reader.result), file.name.replace(/\.[^.]+$/, '')));
      _queueRepaginate(false);
      _announce(`Зображення ${file.name} вставлено`);
    };
    reader.readAsDataURL(file);
  }

  function _handleBeforeInput() {
    ArtSelection.remember(_editor);
  }

  function _handleInput(e) {
    if (_layoutLock) return;

    ArtState.setDirty(true);
    ArtSelection.remember(_editor);
    _queueRepaginate(true);

    clearTimeout(_historyTimer);
    const inputType = e?.inputType || '';
    const delay = /^delete|^history|insertParagraph/.test(inputType) ? 0 : 180;
    _historyTimer = setTimeout(() => ArtHistory.pushNow(), delay);
  }

  function _handleKeydown(e) {
    if ((e.key === 'Delete' || e.key === 'Backspace') && _selectedImage) {
      e.preventDefault();
      _removeSelectedImage();
      return;
    }

    if (e.key === 'Tab') {
      e.preventDefault();
      ArtSelection.insertText(_editor, '    ');
      ArtHistory.pushNow();
      return;
    }

    if (e.key === 'Enter' && e.shiftKey) {
      e.preventDefault();
      ArtSelection.insertHTML(_editor, '<br>');
      ArtHistory.pushNow();
      return;
    }

    if (e.key === 'Enter' && _handleListEnter(e)) {
      ArtHistory.pushNow();
    }
  }

  function _handleListEnter(e) {
    const range = ArtSelection.getRange(_editor);
    if (!range) return false;
    let node = range.startContainer.nodeType === 1 ? range.startContainer : range.startContainer.parentElement;
    const li = node?.closest?.('li');
    if (!li || !_editor.contains(li) || !range.collapsed) return false;
    const plain = (li.textContent || '').replace(/​/g, '').trim();
    e.preventDefault();
    if (!plain) {
      const list = li.parentElement;
      const p = document.createElement('p');
      p.innerHTML = '<br>';
      if (list.nextSibling) list.parentNode.insertBefore(p, list.nextSibling);
      else list.parentNode.appendChild(p);
      li.remove();
      if (!list.children.length) list.remove();
      ArtSelection.normalizeEditor(_editor);
      const range2 = document.createRange();
      range2.selectNodeContents(p);
      range2.collapse(true);
      ArtSelection.restore(range2);
      _queueRepaginate(true);
      return true;
    }
    const newLi = document.createElement('li');
    newLi.innerHTML = '<br>';
    li.insertAdjacentElement('afterend', newLi);
    const range2 = document.createRange();
    range2.selectNodeContents(newLi);
    range2.collapse(true);
    ArtSelection.restore(range2);
    _queueRepaginate(true);
    return true;
  }

  function _handleClick(e) {
    const figure = e.target.closest('.art-image-block');
    if (figure) {
      e.preventDefault();
      selectImage(figure);
      return;
    }
    clearSelectedImage();
  }

  function _handlePointerDown(e) {
    const handle = e.target.closest('.art-image-handle');
    if (!handle) return;
    const figure = handle.closest('.art-image-block');
    const frame = figure?.querySelector('.art-image-frame');
    const img = figure?.querySelector('img');
    const pageContent = figure?.closest('.page-content');
    if (!figure || !frame || !img || !pageContent) return;

    e.preventDefault();
    e.stopPropagation();
    selectImage(figure);

    const rect = frame.getBoundingClientRect();
    _resizeState = {
      figure,
      frame,
      img,
      dir: handle.dataset.dir || 'se',
      startX: e.clientX,
      startWidth: rect.width,
      ratio: (img.naturalWidth && img.naturalHeight) ? (img.naturalWidth / img.naturalHeight) : Math.max(rect.width / Math.max(rect.height, 1), 1),
      maxWidth: Math.max(pageContent.clientWidth, 120)
    };
  }

  function _handlePointerMove(e) {
    if (!_resizeState) return;
    const { frame, dir, startX, startWidth, ratio, maxWidth } = _resizeState;
    const horizontal = dir.includes('w') ? (startX - e.clientX) : (e.clientX - startX);
    const width = Math.max(80, Math.min(maxWidth, startWidth + horizontal));
    frame.style.width = `${Math.round(width)}px`;
    _resizeState.figure.style.width = `${Math.round(width)}px`;
    if (ratio > 0) frame.style.height = `${Math.round(width / ratio)}px`;
  }

  function _handlePointerUp() {
    if (!_resizeState) return;
    _resizeState.frame.style.height = '';
    _resizeState = null;
    _queueRepaginate(false);
    ArtState.setDirty(true);
    ArtHistory.pushNow();
  }

  function selectImage(figure) {
    if (!figure) return;
    clearSelectedImage();
    _selectedImage = figure;
    figure.classList.add('is-selected');
  }

  function clearSelectedImage() {
    if (_selectedImage) _selectedImage.classList.remove('is-selected');
    _selectedImage = null;
  }

  function _removeSelectedImage() {
    const figure = _selectedImage;
    if (!figure) return;
    const page = figure.closest('.page-content');
    const fallback = figure.nextElementSibling || figure.previousElementSibling || page;
    figure.remove();
    clearSelectedImage();
    _normalizePages();
    if (fallback && fallback !== page) {
      const range = document.createRange();
      range.selectNodeContents(fallback);
      range.collapse(false);
      ArtSelection.restore(range);
    } else {
      ArtSelection.focusEditor(_editor);
    }
    _editor.dispatchEvent(new Event('input', { bubbles: true }));
  }
  function hasSelectedImage() {
    return !!_selectedImage;
  }

  function setSelectedImageLayout(mode) {
    if (!_selectedImage) return false;

    _selectedImage.classList.remove(
      'img-align-left',
      'img-align-center',
      'img-align-right',
      'img-wrap-left',
      'img-wrap-right'
    );

    if (mode === 'left') _selectedImage.classList.add('img-align-left');
    else if (mode === 'center') _selectedImage.classList.add('img-align-center');
    else if (mode === 'right') _selectedImage.classList.add('img-align-right');
    else if (mode === 'wrap-left') _selectedImage.classList.add('img-wrap-left');
    else if (mode === 'wrap-right') _selectedImage.classList.add('img-wrap-right');

    _editor.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  }

  function _buildEmptyDocument() {
    _editor.innerHTML = '';
    _editor.appendChild(_createPage());
    _normalizePages();
    _updatePageNumbers();
    _updateEmptyState();
  }

  function _createPage() {
    const page = document.createElement('div');
    page.className = 'page';
    const content = document.createElement('div');
    content.className = 'page-content';
    content.contentEditable = 'true';
    content.spellcheck = true;
    content.dataset.placeholder = 'Почни вводити текст…';
    content.setAttribute('aria-label', 'Сторінка документа');
    page.appendChild(content);
    return page;
  }

  function _getPages() { return [..._editor.querySelectorAll('.page')]; }
  function _getPageContent(page) { return page?.querySelector('.page-content') || null; }

  function _getOrCreatePage(index) {
    const pages = _getPages();
    if (pages[index]) return pages[index];
    const page = _createPage();
    _editor.appendChild(page);
    return page;
  }

  function _setDocumentHTML(html) {
    _editor.innerHTML = '';
    const page = _createPage();
    _editor.appendChild(page);
    const content = _getPageContent(page);
    content.innerHTML = ArtSanitize.clean(html || '<p><br></p>');
    _upgradeImageBlocks();
    _normalizePages();
    _repaginate(false);
    ArtSelection.focusEditor(_editor);
  }

  function _getExportHTML() {
    const temp = document.createElement('div');
    ArtSelection.getPageContents(_editor).forEach(content => {
      [...content.childNodes].forEach(node => temp.appendChild(node.cloneNode(true)));
    });

    temp.querySelectorAll('mark.search-hit').forEach(mark => {
      const parent = mark.parentNode;
      while (mark.firstChild) parent.insertBefore(mark.firstChild, mark);
      mark.remove();
    });

    temp.querySelectorAll('figure.art-image-block').forEach(figure => {
      const img = figure.querySelector('img');
      const frame = figure.querySelector('.art-image-frame');
      if (!img) return figure.remove();

      const cleanImg = img.cloneNode(true);
      const width = parseFloat(frame?.style.width || figure.style.width || 0);
      if (width) cleanImg.style.width = `${Math.round(width)}px`;

      if (figure.classList.contains('img-align-left')) {
        cleanImg.style.cssText += ';display:block;margin:.85rem 0 .85rem 0;';
      }
      if (figure.classList.contains('img-align-center')) {
        cleanImg.style.cssText += ';display:block;margin:.85rem auto;';
      }
      if (figure.classList.contains('img-align-right')) {
        cleanImg.style.cssText += ';display:block;margin:.85rem 0 .85rem auto;';
      }
      if (figure.classList.contains('img-wrap-left')) {
        cleanImg.style.cssText += ';float:left;margin:.2rem 1rem .6rem 0;';
      }
      if (figure.classList.contains('img-wrap-right')) {
        cleanImg.style.cssText += ';float:right;margin:.2rem 0 .6rem 1rem;';
      }

      cleanImg.removeAttribute('class');
      figure.replaceWith(cleanImg);
    });

    return temp.innerHTML.trim() || '<p><br></p>';
  }

  function _queueRepaginate(preserveSelection = true) {
    cancelAnimationFrame(_layoutQueued);
    _layoutQueued = requestAnimationFrame(() => _repaginate(preserveSelection));
  }
  function _saveSelectionMarkers() {
    const range = ArtSelection.getRange(_editor);
    if (!range) return null;

    const start = document.createElement('span');
    start.dataset.artSel = 'start';
    start.className = 'art-sel-marker';

    if (range.collapsed) {
      const caret = range.cloneRange();
      caret.collapse(true);
      caret.insertNode(start);
      return { collapsed: true };
    }

    const end = document.createElement('span');
    end.dataset.artSel = 'end';
    end.className = 'art-sel-marker';

    const endRange = range.cloneRange();
    endRange.collapse(false);
    endRange.insertNode(end);

    const startRange = range.cloneRange();
    startRange.collapse(true);
    startRange.insertNode(start);

    return { collapsed: false };
  }

  function _restoreSelectionMarkers() {
    const start = _editor.querySelector('.art-sel-marker[data-art-sel="start"]');
    const end = _editor.querySelector('.art-sel-marker[data-art-sel="end"]');
    if (!start) return;

    const range = document.createRange();
    if (end) {
      range.setStartAfter(start);
      range.setEndBefore(end);
    } else {
      range.setStartAfter(start);
      range.collapse(true);
    }

    start.remove();
    end?.remove();
    ArtSelection.restore(range);
    ArtSelection.remember(_editor);
  }

  function _repaginate(preserveSelection = true) {
    if (_layoutLock) return;
    _layoutLock = true;

    const markers = preserveSelection ? _saveSelectionMarkers() : null;
    _normalizePages();

    let pages = _getPages();
    let layoutGuard = 0;
    for (let i = 0; i < pages.length; i++) {
      const current = _getPageContent(pages[i]);
      while (_isOverflowing(current)) {
        if (++layoutGuard > 250) break;
        const next = _getPageContent(_getOrCreatePage(i + 1));
        if (!_moveOverflowToNext(current, next)) break;
        pages = _getPages();
      }
    }

    pages = _getPages();
    for (let i = 0; i < pages.length - 1; i++) {
      const current = _getPageContent(pages[i]);
      const next = _getPageContent(pages[i + 1]);
      let pullGuard = 0;
      while (_pullFromNextIfFits(current, next)) {
        if (++pullGuard > 250) break;
        if (!_getPages()[i + 1]) break;
      }
    }

    _removeTrailingEmptyPages();
    _updatePageNumbers();
    _updateEmptyState();
    _updateStatusBar();

    if (markers) _restoreSelectionMarkers();
    _layoutLock = false;
  }

  function _moveOverflowToNext(current, next) {
    if (!current || !next) return false;
    const blocks = [...current.children];
    if (!blocks.length) return false;
    const last = blocks[blocks.length - 1];

    if (blocks.length === 1) {
      if (_splitListBlock(current, last, next)) return true;
      if (_splitTextBlock(current, last, next)) return true;
      return false;
    }

    next.prepend(last);
    _cleanupPage(current);
    _cleanupPage(next);
    return true;
  }

  function _pullFromNextIfFits(current, next) {
    if (!current || !next) return false;
    if (_isPageEmpty(next)) return false;
    const first = next.firstElementChild;
    if (!first) return false;
    current.appendChild(first);
    if (_isOverflowing(current)) {
      current.removeChild(first);
      next.prepend(first);
      return false;
    }
    _mergeAdjacentLists(current);
    _cleanupPage(current);
    return true;
  }

  function _splitListBlock(current, block, next) {
    if (!block || !['UL', 'OL'].includes(block.tagName) || block.children.length < 2) return false;
    const clone = block.cloneNode(false);
    while (_isOverflowing(current) && block.children.length > 1) {
      clone.prepend(block.lastElementChild);
    }
    if (!clone.children.length) return false;
    next.prepend(clone);
    _cleanupPage(current);
    _cleanupPage(next);
    return true;
  }

  function _splitTextBlock(current, block, next) {
    if (!block || !['P', 'DIV', 'H1', 'H2', 'H3', 'H4', 'BLOCKQUOTE'].includes(block.tagName)) return false;
    const totalChars = _countTextChars(block);
    if (totalChars < 2) return false;

    const originalHTML = block.innerHTML;
    let low = 1;
    let high = totalChars - 1;
    let best = null;

    while (low <= high) {
      const mid = Math.floor((low + high) / 2);
      block.innerHTML = originalHTML;
      const frag = _extractFromChar(block, mid);
      if (!frag || !_hasMeaningfulContent(block)) {
        block.innerHTML = originalHTML;
        high = mid - 1;
        continue;
      }
      if (_isOverflowing(current)) high = mid - 1;
      else {
        best = mid;
        low = mid + 1;
      }
      block.innerHTML = originalHTML;
    }

    if (best === null) {
      block.innerHTML = originalHTML;
      return false;
    }

    block.innerHTML = originalHTML;
    const splitAt = _snapSplitIndex(block, best);
    const fragment = _extractFromChar(block, splitAt);
    if (!fragment || !_fragmentHasMeaningfulContent(fragment)) {
      block.innerHTML = originalHTML;
      return false;
    }

    const clone = block.cloneNode(false);
    clone.appendChild(fragment);
    if (!_hasMeaningfulContent(block)) block.innerHTML = '<br>';
    next.prepend(clone);
    _cleanupPage(current);
    _cleanupPage(next);
    return true;
  }

  function _extractFromChar(block, charIndex) {
    const point = _pointFromCharOffset(block, charIndex);
    if (!point) return null;
    const range = document.createRange();
    range.selectNodeContents(block);
    range.setStart(point.node, point.offset);
    return range.extractContents();
  }

  function _pointFromCharOffset(root, offset) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
    let seen = 0;
    let node;
    let lastNode = null;
    while ((node = walker.nextNode())) {
      lastNode = node;
      const len = node.textContent.length;
      if (offset <= seen + len) return { node, offset: Math.max(0, offset - seen) };
      seen += len;
    }
    return lastNode ? { node: lastNode, offset: lastNode.textContent.length } : null;
  }

  function _snapSplitIndex(block, index) {
    const text = block.textContent || '';
    let i = Math.max(1, Math.min(index, text.length - 1));
    while (i > 1 && !/\s|[.,!?;:)]/.test(text[i - 1])) i -= 1;
    return Math.max(1, i);
  }

  function _countTextChars(node) {
    return (node.textContent || '').replace(/\u200B/g, '').length;
  }

  function _fragmentHasMeaningfulContent(fragment) {
    return !!(fragment.textContent || '').trim() || !!fragment.querySelector?.('img,table,hr,li');
  }

  function _hasMeaningfulContent(node) {
    return !!(node.textContent || '').trim() || !!node.querySelector?.('img,table,hr,li');
  }

  function _cleanupPage(pageContent) {
    if (!pageContent) return;
    [...pageContent.childNodes].forEach(node => {
      if (node.nodeType === Node.TEXT_NODE && !(node.textContent || '').trim()) node.remove();
    });
    _mergeAdjacentLists(pageContent);
    if (![...pageContent.children].length) {
      const p = document.createElement('p');
      p.innerHTML = '<br>';
      pageContent.appendChild(p);
    }
  }

  function _mergeAdjacentLists(container) {
    let node = container.firstElementChild;
    while (node && node.nextElementSibling) {
      const next = node.nextElementSibling;
      if (['UL', 'OL'].includes(node.tagName) && node.tagName === next.tagName) {
        while (next.firstElementChild) node.appendChild(next.firstElementChild);
        next.remove();
      } else {
        node = next;
      }
    }
  }

  function _removeTrailingEmptyPages() {
    const pages = _getPages();
    for (let i = pages.length - 1; i > 0; i--) {
      const content = _getPageContent(pages[i]);
      if (_isPageEmpty(content)) pages[i].remove();
      else break;
    }
    if (!_getPages().length) _editor.appendChild(_createPage());
  }

  function _isPageEmpty(pageContent) {
    if (!pageContent) return true;
    if (pageContent.children.length !== 1) return false;
    const only = pageContent.firstElementChild;
    if (!only) return true;
    return ['P', 'DIV'].includes(only.tagName) && !((only.textContent || '').trim()) && !only.querySelector('img,table,hr');
  }

  function _upgradeImageBlocks() {
    _editor.querySelectorAll('.page-content img').forEach(img => {
      if (img.closest('.art-image-block')) return;
      const figure = document.createElement('figure');
      figure.className = 'art-image-block';
      figure.setAttribute('contenteditable', 'false');
      figure.tabIndex = -1;

      const frame = document.createElement('div');
      frame.className = 'art-image-frame';
      const desiredWidth = parseFloat(img.style.width || img.getAttribute('width') || '0') || Math.min(420, img.naturalWidth || 420);
      frame.style.width = `${Math.round(desiredWidth)}px`;
      frame.style.maxWidth = '100%';

      const cleanImg = img.cloneNode(true);
      cleanImg.style.width = '100%';
      cleanImg.removeAttribute('width');
      cleanImg.removeAttribute('height');
      frame.appendChild(cleanImg);

      ['nw', 'ne', 'sw', 'se'].forEach(dir => {
        const handle = document.createElement('button');
        handle.type = 'button';
        handle.className = 'art-image-handle';
        handle.dataset.dir = dir;
        handle.setAttribute('aria-label', 'Змінити розмір зображення');
        frame.appendChild(handle);
      });

      figure.appendChild(frame);
      const parent = img.parentElement;
      img.replaceWith(figure);
      if (parent && ['P', 'DIV'].includes(parent.tagName) && !(parent.textContent || '').trim() && parent.children.length === 1 && parent.firstElementChild === figure) {
        parent.replaceWith(figure);
      }
    });
  }

  function _normalizePages() {
    if (!_getPages().length) _editor.appendChild(_createPage());
    _upgradeImageBlocks();
    ArtSelection.normalizeEditor(_editor);
    _getPages().forEach(page => {
      const content = _getPageContent(page);
      if (!content) page.appendChild(_createPage().firstElementChild);
    });
  }

  function _isOverflowing(pageContent) {
    return pageContent && pageContent.scrollHeight > pageContent.clientHeight + 1;
  }

  function _updatePageNumbers() {
    _getPages().forEach((page, index) => page.dataset.pageNumber = `${index + 1}`);
  }

  function _updateEmptyState() {
    const pages = _getPages();
    pages.forEach((page, index) => {
      const content = _getPageContent(page);
      content.dataset.empty = String(index === 0 && pages.length === 1 && _isPageEmpty(content));
    });
  }

  function _syncView() {
    _repaginate(false);
    _updateFileName();
    _updateStatusBar();
    _updatePageNumbers();
    _updateEmptyState();
  }

  function findNext(query) {
    query = String(query || '').trim();
    if (!query) return;
    if (_findState.query !== query) {
      _findState = { query, index: -1, matches: [] };
      clearFindHighlights();
      _findState.matches = _collectMatches(query);
      _paintMatches();
    }
    if (!_findState.matches.length) {
      ArtModals.info('Пошук', 'Нічого не знайдено.');
      return;
    }
    _findState.index = (_findState.index + 1) % _findState.matches.length;
    const target = _editor.querySelectorAll('mark.search-hit')[_findState.index];
    if (!target) return;
    _editor.querySelectorAll('mark.search-hit.current').forEach(el => el.classList.remove('current'));
    target.classList.add('current');
    const range = document.createRange();
    range.selectNodeContents(target);
    ArtSelection.restore(range);
    target.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }

  function _collectMatches(query) {
    const textNodes = [];
    const walker = document.createTreeWalker(_editor, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        return node.parentElement?.closest('mark.search-hit') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT;
      }
    });
    let n;
    while ((n = walker.nextNode())) if ((n.textContent || '').trim()) textNodes.push(n);
    const matches = [];
    const q = query.toLowerCase();
    textNodes.forEach(node => {
      let from = 0;
      const lower = node.textContent.toLowerCase();
      while (true) {
        const idx = lower.indexOf(q, from);
        if (idx === -1) break;
        matches.push({ node, start: idx, end: idx + q.length });
        from = idx + q.length;
      }
    });
    return matches;
  }

  function _paintMatches() {
    [..._findState.matches].reverse().forEach(match => {
      const range = document.createRange();
      range.setStart(match.node, match.start);
      range.setEnd(match.node, match.end);
      const mark = document.createElement('mark');
      mark.className = 'search-hit';
      try { range.surroundContents(mark); } catch { }
    });
  }

  function clearFindHighlights() {
    if (!_editor) return;
    _editor.querySelectorAll('mark.search-hit').forEach(mark => {
      const parent = mark.parentNode;
      while (mark.firstChild) parent.insertBefore(mark.firstChild, mark);
      parent.removeChild(mark);
    });
    _findState = { query: '', index: -1, matches: [] };
  }

  function editFileName() {
    const span = document.getElementById('fileName');
    if (!span) return;
    const input = document.createElement('input');
    input.type = 'text';
    input.value = ArtState.get('fileName');
    input.className = 'filename-input';
    input.setAttribute('aria-label', 'Назва файлу');
    span.replaceWith(input);
    input.focus();
    input.select();
    function commit() {
      const val = input.value.trim() || 'документ';
      ArtState.set('fileName', val);
      input.replaceWith(span);
      span.textContent = val;
    }
    input.addEventListener('blur', commit);
    input.addEventListener('keydown', e => {
      if (e.key === 'Enter') { e.preventDefault(); commit(); }
      if (e.key === 'Escape') { input.replaceWith(span); }
    });
  }

  function _updateFileName() {
    const el = document.getElementById('fileName');
    if (el) el.textContent = ArtState.get('fileName');
  }

  function _updateStatusBar() {
    const text = _editor.textContent || '';
    const words = text.trim() ? text.trim().split(/\s+/).length : 0;
    const chars = text.replace(/\u200B/g, '').length;
    document.getElementById('statusWords').textContent = words;
    document.getElementById('statusChars').textContent = chars;
  }

  function _flashSaved() {
    const badge = document.getElementById('savedBadge');
    if (!badge) return;
    badge.style.opacity = '1';
    setTimeout(() => badge.style.opacity = '0', 2500);
  }

  function _download(blob, name) {
    const url = URL.createObjectURL(blob);
    const a = Object.assign(document.createElement('a'), { href: url, download: name });
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function _stripExt(name) { return name.replace(/\.[^.]+$/, '') || name; }

  function _announce(msg) {
    if (!_announcer) return;
    _announcer.textContent = '';
    requestAnimationFrame(() => _announcer.textContent = msg);
  }

  return {
    init, newDoc, saveAs, setOrientation, setZoom, hasSelectedImage, setSelectedImageLayout,
    insertTable, openImageDialog, findNext, clearFindHighlights, editFileName
  };
})();
