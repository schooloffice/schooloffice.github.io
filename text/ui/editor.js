'use strict';
/* ui/editor.js — full refactor: pages, image resize, safe tables */

const ArtEditor = (() => {
  const MAX_TEXT_FILE_BYTES = 5 * 1024 * 1024;
  const MAX_DOCX_FILE_BYTES = 20 * 1024 * 1024;
  const MAX_IMAGE_FILE_BYTES = 8 * 1024 * 1024;
  const MAX_IMAGE_PIXELS = 16_777_216;
  const SPELLCHECK_PREF_KEY = 'office_text_spellcheck';
  const DOCUMENT_MIME_TYPES = {
    txt: new Set(['', 'text/plain']),
    rtf: new Set(['', 'application/rtf', 'text/rtf', 'text/richtext', 'application/x-rtf']),
    docx: new Set(['', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'application/octet-stream'])
  };
  const IMAGE_MIME_BY_EXTENSION = {
    png: new Set(['', 'image/png']),
    jpg: new Set(['', 'image/jpeg']),
    jpeg: new Set(['', 'image/jpeg']),
    gif: new Set(['', 'image/gif']),
    webp: new Set(['', 'image/webp'])
  };
  let _editor = null;
  let _announcer = null;
  let _layoutQueued = 0;
  let _layoutTimer = 0;
  let _layoutLock = false;
  let _selectedImage = null;
  let _resizeState = null;
  let _historyTimer = 0;
  let _documentRevision = 0;
  let _splitCounter = 0;

  function init(editorEl, announcerEl) {
    _editor = editorEl;
    _announcer = announcerEl;

    _editor.addEventListener('beforeinput', _handleBeforeInput);
    _editor.addEventListener('input', _handleInput);
    _editor.addEventListener('keydown', _handleKeydown);
    _editor.addEventListener('click', _handleClick);
    _editor.addEventListener('contextmenu', _handleTableContextMenu);
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
      _repaginate(true);
      _updateFileName();
      _updateStatusBar();
      _updatePageNumbers();
      _updateEmptyState();
      // Відновлена геометрія ставить у чергу перекомпонування без збереження виділення;
      // замінюємо його своїм, з маркерами, щоб відновлене виділення не загубилося.
      _queueRepaginate(true);
      ArtToolbar.updateState();
    });
    ArtHistory.setRestorer((html, selection) => _setDocumentHTML(html, { trusted: true, selection }));

    document.addEventListener('selectionchange', () => {
      if (_editor.contains(document.activeElement) || document.activeElement === _editor) _updateTableContext();
    });
    document.addEventListener('pointermove', _handlePointerMove);
    document.addEventListener('pointerup', _handlePointerUp);
    document.addEventListener('pointerdown', e => {
      if (!e.target.closest('.table-context-menu, #tableMenuButton')) hideTableMenu();
    });
    document.addEventListener('click', e => {
      if (!e.target.closest('.art-image-block')) clearSelectedImage();
    });
    document.getElementById('tableContextMenu')?.addEventListener('keydown', _handleTableMenuKeydown);

    ArtState.on('change:dirty', dirty => {
      const dot = document.getElementById('dirtyDot');
      if (dot) dot.style.display = dirty ? 'inline-block' : 'none';
    });
    ArtState.on('change:orientation', _applyOrientation);
    ArtState.on('change:zoom', _applyZoom);
    ArtState.on('change:spellcheck', _applySpellcheck);
    ArtState.on('change', change => {
      if (['fileName', 'fileFormat', 'orientation', 'pageSize', 'margins', 'headerFooter'].includes(change?.key)) {
        _documentRevision += 1;
      }
    });

    document.getElementById('fileInput')?.addEventListener('change', _handleFileOpen);
    document.getElementById('imageInput')?.addEventListener('change', _handleImageInsert);
    window.addEventListener('resize', () => {
      hideTableMenu();
      _queueRepaginate(false);
    });
    window.addEventListener('beforeunload', e => {
      if (ArtState.isDirty()) { e.preventDefault(); e.returnValue = ''; }
    });

    _buildEmptyDocument();
    _applyOrientation(ArtState.get('orientation'));
    _applyZoom(ArtState.get('zoom'));
    ArtState.set('spellcheck', _readSpellcheckPref());
    _applySpellcheck(ArtState.get('spellcheck'));
    _updateFileName();
    _syncView();
    ArtSelection.focusEditor(_editor);
  }

  function newDoc() {
    _documentRevision += 1;
    clearFindHighlights();
    clearSelectedImage();
    ArtState.resetDocument?.();
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
    _documentRevision += 1;
    try {
      _validateDocumentFile(file, ext);
      let result;
      if (ext === 'txt') result = await ArtTxt.importTxt(file);
      else if (ext === 'rtf') result = await ArtRtf.importRtf(file);
      else if (ext === 'docx') result = await ArtDocx.importDocx(file);
      else return ArtModals.info('Непідтримуваний формат', `Файл .${ext} не підтримується.`);

      clearFindHighlights();
      clearSelectedImage();
      ArtState.resetDocument?.();
      // Колонтитули, які адаптер формату прочитав із файлу (зараз RTF).
      if (result.meta.headerFooter) ArtState.set('headerFooter', ArtState.normalizeHeaderFooter(result.meta.headerFooter));
      _setDocumentHTML(result.html);
      ArtState.set('fileName', _stripExt(file.name));
      ArtState.set('fileFormat', result.meta.format);
      ArtHistory.init(_editor);
      ArtHistory.markSaved();
      _updateFileName();
      _syncView();
      // notices — конкретні втрати, про які адаптер знає точно; warnings — загальні повідомлення конвертера.
      const notices = [...(result.meta.notices || [])];
      if (result.meta.warnings?.length) notices.push('Деяке форматування могло бути спрощено.');
      if (notices.length) {
        ArtModals.info('Файл відкрито з застереженнями', notices.join(' '));
      }
      _announce(`Файл ${file.name} відкрито`);
    } catch (err) {
      ArtModals.info('Помилка відкриття', err.message || String(err));
    }
  }

  // Набір спрощень .docx, який користувач уже підтвердив у цій сесії: Ctrl+S
  // не питає щоразу, а нове спрощення знову показується до збереження.
  let _acknowledgedDocxLimits = '';

  async function saveAs(format, { limitsConfirmed = false } = {}) {
    ArtModals.close('modalSave');
    const html = _getExportHTML();
    if (format === 'docx' && !limitsConfirmed) {
      const notes = ArtDocx.describeExportLimits?.(html) || [];
      const signature = notes.join('\n');
      if (notes.length && signature !== _acknowledgedDocxLimits) {
        ArtModals.confirm(
          `У .docx частину оформлення буде спрощено:\n• ${notes.join('\n• ')}\n\nДокумент на екрані й чернетка не зміняться.`,
          () => {
            _acknowledgedDocxLimits = signature;
            saveAs('docx', { limitsConfirmed: true });
          },
          null,
          { yesText: 'Зберегти .docx' }
        );
        return;
      }
    }
    try {
      let blob, ext;
      if (format === 'txt') {
        blob = new Blob([ArtTxt.exportTxt(html)], { type: 'text/plain;charset=utf-8' });
        ext = 'txt';
      } else if (format === 'rtf') {
        blob = new Blob([ArtRtf.exportRtf(html, ArtState.documentSnapshot?.() || {})], { type: 'application/rtf;charset=utf-8' });
        ext = 'rtf';
      } else if (format === 'docx') {
        blob = await ArtDocx.exportDocx(html, ArtState.documentSnapshot?.() || {
          orientation: ArtState.get('orientation'),
          pageSize: ArtState.get('pageSize'),
          margins: ArtState.get('margins')
        });
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

  function setOrientation(value) {
    if (value === ArtState.get('orientation')) return;
    ArtState.set('orientation', value);
    ArtHistory.pushNow?.();
  }

  // Зовнішня зміна геометрії сторінки (поля, розмір паперу) вимагає повного
  // перекомпонування — але без збереження позиції каретки маркерами.
  function refreshLayout() { _queueRepaginate(false); }
  function setZoom(value) { ArtState.set('zoom', value); }
  function setSpellcheck(enabled) { ArtState.set('spellcheck', !!enabled); }
  function toggleSpellcheck() { setSpellcheck(!ArtState.get('spellcheck')); }

  // Правопис перевіряє сам браузер словником браузера чи ОС. Атрибут стоїть на
  // єдиному editing host: сторінки, нові аркуші й клітинки його успадковують.
  // Це налаштування вигляду — не документ, тож undo і позначку змін не зачіпає.
  function _applySpellcheck(enabled) {
    const on = !!enabled;
    _editor.spellcheck = on;
    document.querySelectorAll('[data-action="toggle-spellcheck"]').forEach(item => {
      item.classList.toggle('checked', on);
      item.setAttribute('aria-checked', String(on));
    });
    try { localStorage.setItem(SPELLCHECK_PREF_KEY, on ? 'on' : 'off'); } catch { }
  }

  function _readSpellcheckPref() {
    try { return localStorage.getItem(SPELLCHECK_PREF_KEY) !== 'off'; } catch { return true; }
  }

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

  // ── Явний розрив сторінки ─────────────────────────────────────────────
  // Логічна форма — <hr style="break-after: page">: тег і style проходять санітайзер,
  // тож той самий розрив живе в історії, чернетці й файлі.
  function _isPageBreak(node) {
    return !!node && node.nodeType === Node.ELEMENT_NODE && node.tagName === 'HR'
      && (node.style.breakAfter === 'page' || node.style.pageBreakAfter === 'always');
  }

  function _createPageBreak() {
    const hr = document.createElement('hr');
    hr.style.breakAfter = 'page';
    return hr;
  }

  // Ctrl+Enter або «Вставка → Розрив сторінки»: текст після каретки починається з нового аркуша.
  function insertPageBreak() {
    // Поточне виділення в документі важливіше за запам'ятоване: Ctrl+Enter натискають там,
    // де стоїть каретка. Із меню фокус уже поза документом — тоді відновлюємо збережене.
    let range = ArtSelection.getRange(_editor);
    if (!range) {
      ArtSelection.focusEditor(_editor);
      range = ArtSelection.getRange(_editor);
    }
    if (!range) return false;
    ArtHistory.pushNow();
    if (!range.collapsed) range.deleteContents();

    const node = range.startContainer.nodeType === Node.ELEMENT_NODE ? range.startContainer : range.startContainer.parentElement;
    const page = node?.closest('.page-content');
    if (!page) return false;
    const block = [...page.children].find(child => child === node || child.contains(node)) || null;
    const pageBreak = _createPageBreak();
    let next;

    const before = range.cloneRange();
    if (block) before.setStart(block, 0);
    const caretAtBlockStart = !!block && !before.toString().replace(/​/g, '').trim()
      && !before.cloneContents().querySelector('img');

    if (block && ENTER_BLOCKS.includes(block.tagName) && !node.closest('table, li') && caretAtBlockStart) {
      // Каретка на початку абзацу: розрив стає перед ним, без порожнього абзацу.
      block.before(pageBreak);
      next = block;
    } else if (block && ENTER_BLOCKS.includes(block.tagName) && !node.closest('table, li')) {
      // Як Enter: половина абзацу після каретки переходить за розрив.
      const tail = range.cloneRange();
      tail.setEnd(block, block.childNodes.length);
      const rest = tail.extractContents();
      next = document.createElement(block.tagName === 'BLOCKQUOTE' ? 'blockquote' : 'p');
      next.appendChild(rest);
      if (!_hasMeaningfulContent(next)) next.innerHTML = '<br>';
      if (!_hasMeaningfulContent(block)) block.innerHTML = '<br>';
      block.after(pageBreak, next);
      _detachSplitTail(block, next);
    } else {
      // Таблиця, список або зображення не розрізаються: розрив ставимо після блока.
      next = document.createElement('p');
      next.innerHTML = '<br>';
      const anchor = block || page.lastElementChild;
      if (anchor) anchor.after(pageBreak, next);
      else page.append(pageBreak, next);
    }

    const caret = document.createRange();
    caret.selectNodeContents(next);
    caret.collapse(true);
    ArtSelection.restore(caret);
    ArtSelection.remember(_editor);
    _editor.dispatchEvent(new Event('input', { bubbles: true }));
    ArtHistory.pushNow();
    return true;
  }

  function _previousLogicalBlock(block) {
    let candidate = block.previousElementSibling;
    while (candidate?.classList.contains('art-sel-marker')) candidate = candidate.previousElementSibling;
    if (candidate) return candidate;
    const pages = ArtSelection.getPageContents(_editor);
    const index = pages.indexOf(block.parentElement);
    return index > 0 ? pages[index - 1].lastElementChild : null;
  }

  function _nextLogicalBlock(block) {
    let candidate = block.nextElementSibling;
    while (candidate?.classList.contains('art-sel-marker')) candidate = candidate.nextElementSibling;
    if (candidate) return candidate;
    const pages = ArtSelection.getPageContents(_editor);
    const index = pages.indexOf(block.parentElement);
    return index > -1 && index < pages.length - 1 ? pages[index + 1].firstElementChild : null;
  }

  // Сусідній блок (і через межу аркуша), якщо каретка стоїть на самому початку блока
  // (backward) або в самому його кінці; інакше — порожнє значення.
  function _blockAcrossCaretEdge(backward) {
    const range = ArtSelection.getRange(_editor);
    if (!range || !range.collapsed) return null;
    const node = range.startContainer.nodeType === Node.ELEMENT_NODE ? range.startContainer : range.startContainer.parentElement;
    const page = node?.closest('.page-content');
    if (!page || node.closest('table, li')) return null;
    const block = [...page.children].find(child => child === node || child.contains(node));
    if (!block || _isPageBreak(block)) return null;

    const probe = document.createRange();
    probe.selectNodeContents(block);
    if (backward) probe.setEnd(range.startContainer, range.startOffset);
    else probe.setStart(range.startContainer, range.startOffset);
    if (probe.toString().replace(/​/g, '').length) return false;

    return backward ? _previousLogicalBlock(block) : _nextLogicalBlock(block);
  }

  // Backspace на початку блока одразу після розриву або Delete у кінці блока перед ним
  // прибирає сам розрив, навіть якщо він стоїть на попередньому аркуші.
  function _removeAdjacentPageBreak(backward) {
    const neighbour = _blockAcrossCaretEdge(backward);
    if (!_isPageBreak(neighbour)) return false;
    ArtHistory.pushNow();
    neighbour.remove();
    _editor.dispatchEvent(new Event('input', { bubbles: true }));
    ArtHistory.pushNow();
    return true;
  }

  // Усе, що стоїть після явного розриву, починається з наступного аркуша.
  function _moveAfterPageBreak(current, index) {
    const blocks = [...current.children];
    const breakIndex = blocks.findIndex(_isPageBreak);
    if (breakIndex === -1 || breakIndex === blocks.length - 1) return false;
    const next = _getPageContent(_getOrCreatePage(index + 1));
    for (let i = blocks.length - 1; i > breakIndex; i -= 1) next.prepend(blocks[i]);
    _cleanupPage(current);
    _cleanupPage(next);
    return true;
  }

  // ── Зміст (C2в) ─────────────────────────────────────────────────────────
  // Зміст — абзаци верхнього рівня з позначкою data-art-toc (title, 1–4, empty): пагінація
  // переносить їх як звичайні абзаци, а назва й пункти не є H1–H4, тож зміст не включає себе.
  // На аркушах пункти незмінні (contenteditable="false") і перебудовуються лише командою.
  // Номери сторінок беруться з поточної розкладки аркушів; застарілий зміст позначається.
  const TOC_HEADINGS = new Set(['H1', 'H2', 'H3', 'H4']);
  const TOC_ZWSP = String.fromCharCode(0x200B);
  const TOC_TAB = String.fromCharCode(9);

  function _isTocBlock(node) {
    return !!node && node.nodeType === Node.ELEMENT_NODE && node.hasAttribute('data-art-toc');
  }

  function _tocBlocks() {
    return [..._editor.querySelectorAll('.page-content > [data-art-toc]')];
  }

  function _tocItems() {
    return _tocBlocks().filter(block => /^[1-4]$/.test(block.getAttribute('data-art-toc')));
  }

  function _tocText(raw) {
    return String(raw || '').split(TOC_ZWSP).join('').replace(/\s+/g, ' ').trim().slice(0, 300);
  }

  // Заголовки H1–H4 верхнього рівня з номером аркуша, на якому вони починаються.
  // Частини заголовка, розрізаного сторінкою, — один пункт.
  function _collectTocHeadings() {
    const headings = [];
    const bySplit = new Map();
    _getPages().forEach((page, index) => {
      [...(_getPageContent(page)?.children || [])].forEach(block => {
        if (!TOC_HEADINGS.has(block.tagName)) return;
        const splitId = block.getAttribute('data-art-split');
        const head = splitId ? bySplit.get(splitId) : null;
        if (head) {
          head.raw += block.textContent || '';
          return;
        }
        const entry = { level: Number(block.tagName.slice(1)), raw: block.textContent || '', page: index + 1 };
        if (splitId) bySplit.set(splitId, entry);
        headings.push(entry);
      });
    });
    return headings
      .map(entry => ({ level: entry.level, text: _tocText(entry.raw), page: entry.page }))
      .filter(entry => entry.text);
  }

  function _createTocBlock(kind, text, page) {
    const block = document.createElement('p');
    block.setAttribute('data-art-toc', kind);
    block.setAttribute('contenteditable', 'false');
    if (page === undefined) {
      block.textContent = text;
      return block;
    }
    const label = document.createElement('span');
    label.textContent = text;
    const number = document.createElement('span');
    number.textContent = String(page);
    // Табуляція між назвою й номером — для TXT і копіювання; на аркуші її не видно.
    block.append(label, document.createTextNode(TOC_TAB), number);
    return block;
  }

  function _buildTocBlocks(headings) {
    const blocks = [_createTocBlock('title', 'Зміст')];
    if (!headings.length) blocks.push(_createTocBlock('empty', 'Заголовків H1–H4 ще немає. Додайте їх і оновіть зміст.'));
    headings.forEach(entry => blocks.push(_createTocBlock(String(entry.level), entry.text, entry.page)));
    return blocks;
  }

  // contenteditable не проходить санітайзер і не входить у документ, тож ставимо його на аркушах.
  function _lockTocBlocks() {
    _tocBlocks().forEach(block => block.setAttribute('contenteditable', 'false'));
  }

  // Зміст сам займає місце й може зсунути заголовки: перекомпоновуємо й звіряємо номери,
  // доки вони не встояться.
  function _numberTocFromLayout() {
    for (let pass = 0; pass < 4; pass += 1) {
      _repaginate(true);
      const headings = _collectTocHeadings();
      const items = _tocItems();
      if (items.length !== headings.length) return false;
      let changed = false;
      items.forEach((item, index) => {
        const number = item.lastElementChild;
        if (number && number.textContent !== String(headings[index].page)) {
          number.textContent = String(headings[index].page);
          changed = true;
        }
      });
      if (!changed) return true;
    }
    return false;
  }

  // Зміст, що вже не відповідає заголовкам чи аркушам, лише позначаємо (атрибут верстки,
  // серіалізатор його знімає): тихо змінювати документ без команди не можна.
  function _markStaleToc() {
    const blocks = _tocBlocks();
    if (!blocks.length) return;
    const expected = _collectTocHeadings().map(entry => `${entry.level}|${entry.text}|${entry.page}`).join('\n');
    const actual = _tocItems().map(item => (
      `${item.getAttribute('data-art-toc')}|${_tocText(item.firstElementChild?.textContent)}|${_tocText(item.lastElementChild?.textContent)}`
    )).join('\n');
    const title = blocks.find(block => block.getAttribute('data-art-toc') === 'title') || blocks[0];
    blocks.forEach(block => { if (block !== title) block.removeAttribute('data-art-toc-stale'); });
    title.toggleAttribute('data-art-toc-stale', expected !== actual);
  }

  function _tocInsertionBlock() {
    let range = ArtSelection.getRange(_editor);
    if (!range) {
      ArtSelection.focusEditor(_editor);
      range = ArtSelection.getRange(_editor);
    }
    const node = range
      ? (range.startContainer.nodeType === Node.ELEMENT_NODE ? range.startContainer : range.startContainer.parentElement)
      : null;
    const page = node?.closest('.page-content');
    if (page && node === page) {
      const child = page.childNodes[range.startOffset];
      if (child?.nodeType === Node.ELEMENT_NODE) return child;
    } else if (page) {
      const block = [...page.children].find(child => child === node || child.contains(node));
      if (block) return block;
    }
    const pages = ArtSelection.getPageContents(_editor);
    return pages[pages.length - 1]?.lastElementChild || null;
  }

  function _finishTocChange(caretBlock) {
    if (caretBlock?.isConnected) {
      const caret = document.createRange();
      caret.selectNodeContents(caretBlock);
      caret.collapse(true);
      ArtSelection.restore(caret);
      ArtSelection.remember(_editor);
    }
    _numberTocFromLayout();
    _editor.dispatchEvent(new Event('input', { bubbles: true }));
    ArtHistory.pushNow();
  }

  // Один зміст на документ: повторна команда оновлює наявний.
  function insertToc() {
    if (_tocBlocks().length) return updateToc();
    const anchor = _tocInsertionBlock();
    if (!anchor) return false;
    ArtHistory.pushNow();
    const blocks = _buildTocBlocks(_collectTocHeadings());
    const emptyParagraph = ['P', 'DIV'].includes(anchor.tagName) && !_isTocBlock(anchor)
      && !_tocText(anchor.textContent) && !anchor.querySelector('img,table,hr');
    if (emptyParagraph) anchor.replaceWith(...blocks);
    else anchor.before(...blocks);
    let next = _nextLogicalBlock(blocks[blocks.length - 1]);
    if (!next) {
      next = document.createElement('p');
      next.innerHTML = '<br>';
      blocks[blocks.length - 1].after(next);
    }
    _finishTocChange(next);
    _announce('Зміст вставлено');
    return true;
  }

  function updateToc() {
    const existing = _tocBlocks();
    if (!existing.length) {
      ArtModals.info('Змісту ще немає', 'Щоб додати зміст із заголовків H1–H4, виберіть «Вставка → Зміст».');
      return false;
    }
    ArtHistory.pushNow();
    existing[0].before(..._buildTocBlocks(_collectTocHeadings()));
    existing.forEach(block => block.remove());
    _finishTocChange(null);
    _announce('Зміст оновлено');
    return true;
  }

  function removeToc() {
    const existing = _tocBlocks();
    if (!existing.length) return false;
    ArtHistory.pushNow();
    const next = _nextLogicalBlock(existing[existing.length - 1]);
    existing.forEach(block => block.remove());
    _finishTocChange(next && !_isTocBlock(next) ? next : null);
    _announce('Зміст видалено');
    return true;
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
    try {
      _validateImageFile(file);
      const dimensions = await _readImageDimensions(file);
      if (!dimensions.width || !dimensions.height || dimensions.width * dimensions.height > MAX_IMAGE_PIXELS) {
        throw new Error('Зображення має забагато пікселів. Максимум — 16 777 216 пікселів.');
      }
      const dataUrl = await _readFileAsDataUrl(file);
      ArtSelection.restoreLast(_editor);
      ArtToolbar.run(() => ArtSelection.insertImage(_editor, dataUrl, file.name.replace(/\.[^.]+$/, '')));
      _queueRepaginate(false);
      _announce(`Зображення ${file.name} вставлено`);
    } catch (error) {
      ArtModals.info('Зображення не вставлено', error.message || String(error));
    }
  }

  function _handleBeforeInput() {
    ArtSelection.remember(_editor);
  }

  function _handleInput(e) {
    if (_layoutLock) return;

    _documentRevision += 1;
    ArtState.setDirty(true);
    ArtSelection.remember(_editor);
    _queueRepaginate(true);

    clearTimeout(_historyTimer);
    const inputType = e?.inputType || '';
    const delay = /^delete|^history|insertParagraph/.test(inputType) ? 0 : 180;
    _historyTimer = setTimeout(() => ArtHistory.pushNow(), delay);
  }

  function _handleKeydown(e) {
    if ((e.key === 'F10' && e.shiftKey) || e.key === 'ContextMenu') {
      const cell = _caretCell();
      if (cell) {
        e.preventDefault();
        const rect = cell.getBoundingClientRect();
        _showTableMenu(rect.left + Math.min(32, rect.width / 2), rect.bottom + 4, true);
        return;
      }
    }

    if ((e.key === 'Delete' || e.key === 'Backspace') && _selectedImage) {
      e.preventDefault();
      _removeSelectedImage();
      return;
    }

    // Текст не зливається з пунктом змісту: зміст змінюють лише його команди.
    if ((e.key === 'Delete' || e.key === 'Backspace') && _isTocBlock(_blockAcrossCaretEdge(e.key === 'Backspace'))) {
      e.preventDefault();
      _announce('Зміст змінюється командами «Оновити зміст» і «Видалити зміст»');
      return;
    }

    if ((e.key === 'Delete' || e.key === 'Backspace') && _removeAdjacentPageBreak(e.key === 'Backspace')) {
      e.preventDefault();
      return;
    }

    // Ctrl+Enter обробляємо тут, до звичайного Enter: інакше вставився б ще й абзац.
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      insertPageBreak();
      return;
    }

    if (e.key === 'Tab' && _handleTableTab(e)) {
      ArtHistory.pushNow();
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
      return;
    }

    if (e.key === 'Enter' && _handleParagraphEnter(e)) {
      ArtHistory.pushNow();
    }
  }

  // Tab у таблиці ходить по клітинках, як у Word: у останній клітинці додається
  // новий рядок. Логічна таблиця може бути розрізана сторінками, тому клітинки
  // збираємо з усіх її частин.
  function _handleTableTab(e) {
    const cell = _caretCell();
    if (!cell) return false;

    e.preventDefault();
    const cells = _logicalTableCells(cell.closest('table'));
    const index = cells.indexOf(cell);

    if (e.shiftKey) {
      if (index > 0) _placeCaretInCell(cells[index - 1]);
      return true;
    }

    if (index > -1 && index < cells.length - 1) {
      _placeCaretInCell(cells[index + 1]);
      return true;
    }

    const row = cell.closest('tr');
    const newRow = _createEmptyRowLike(row);
    row.after(newRow);
    _placeCaretInCell(newRow.firstElementChild);
    _editor.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  }

  // ── Дії над таблицею (компактна кнопка + контекстне меню) ──────────────
  const COLUMN_WIDTH_STEP = 24;
  const MIN_COLUMN_WIDTH = 48;

  function tableAction(action) {
    let cell = _caretCell();
    // Фокус із клавіатурного меню не повинен втрачати останню клітинку.
    if (!cell) {
      ArtSelection.restoreLast(_editor);
      cell = _caretCell();
    }
    if (!cell) return false;

    hideTableMenu();

    const parts = _logicalTableParts(cell.closest('table'));
    const row = cell.closest('tr');
    const columnIndex = cell.cellIndex;

    if (_logicalTableHasMergedCells(parts) && action !== 'table-delete') {
      ArtModals.info(
        'Об’єднані клітинки',
        'Зміна рядків, колонок або їхньої ширини для таблиць з об’єднаними клітинками поки недоступна. Вміст таблиці залишено без змін.'
      );
      return false;
    }

    if (action === 'table-delete') {
      ArtModals.confirm('Видалити всю таблицю?', () => {
        _deleteTable(parts);
        _finishTableAction();
      });
      return true;
    }

    switch (action) {
      case 'row-above': _insertRow(row, 'beforebegin'); break;
      case 'row-below': _insertRow(row, 'afterend'); break;
      case 'row-delete': _deleteRow(parts, row); break;
      case 'column-left': _insertColumn(parts, columnIndex); break;
      case 'column-right': _insertColumn(parts, columnIndex + 1); break;
      case 'column-delete': _deleteColumn(parts, columnIndex); break;
      case 'column-wider': _resizeColumn(parts, columnIndex, COLUMN_WIDTH_STEP); break;
      case 'column-narrower': _resizeColumn(parts, columnIndex, -COLUMN_WIDTH_STEP); break;
      case 'column-auto': _resizeColumn(parts, columnIndex, null); break;
      default: return false;
    }

    _finishTableAction();
    return true;
  }

  function _finishTableAction() {
    _editor.dispatchEvent(new Event('input', { bubbles: true }));
    requestAnimationFrame(() => {
      ArtHistory.pushNow();
      _updateTableContext();
      ArtToolbar.updateState();
    });
  }

  function _insertRow(row, position) {
    const fresh = _createEmptyRowLike(row);
    row.insertAdjacentElement(position, fresh);
    _placeCaretInCell(fresh.firstElementChild);
    _announce(position === 'beforebegin' ? 'Рядок додано вище' : 'Рядок додано нижче');
  }

  function _deleteRow(parts, row) {
    const dataRows = _logicalRows(parts);
    if (dataRows.length <= 1) return _deleteTable(parts);

    const index = dataRows.indexOf(row);
    const fallback = dataRows[index + 1] || dataRows[index - 1];
    row.remove();
    _placeCaretInCell(fallback?.firstElementChild);
    _announce('Рядок видалено');
  }

  function _insertColumn(parts, index) {
    _allRows(parts).forEach(row => {
      const reference = row.children[index] || null;
      const source = row.children[Math.min(index, row.children.length - 1)];
      const fresh = document.createElement(source?.tagName === 'TH' ? 'th' : 'td');
      fresh.innerHTML = '<br>';
      row.insertBefore(fresh, reference);
    });
    _announce('Колонку додано');
  }

  function _deleteColumn(parts, index) {
    const columns = _allRows(parts)[0]?.children.length || 0;
    if (columns <= 1) return _deleteTable(parts);

    let neighbour = null;
    _allRows(parts).forEach(row => {
      const target = row.children[index];
      if (!target) return;
      neighbour = neighbour || row.children[index + 1] || row.children[index - 1];
      target.remove();
    });
    _placeCaretInCell(neighbour);
    _announce('Колонку видалено');
  }

  function _resizeColumn(parts, index, delta) {
    const rows = _allRows(parts);
    if (delta === null) {
      rows.forEach(row => row.children[index]?.style.removeProperty('width'));
      _announce('Ширину колонки скинуто');
      return;
    }

    // Ширину міряємо один раз до змін: інакше кожна наступна клітинка читала б
    // уже перелаштовану колонку й отримувала свій розмір.
    const reference = rows.find(row => row.children[index])?.children[index];
    if (!reference) return;
    const width = Math.max(MIN_COLUMN_WIDTH, Math.round(reference.getBoundingClientRect().width + delta));
    rows.forEach(row => {
      const target = row.children[index];
      if (target) target.style.width = width + 'px';
    });
    _announce('Ширину колонки змінено');
  }

  function _deleteTable(parts) {
    const page = parts[0].closest('.page-content');
    const fallback = parts[0].previousElementSibling || parts[parts.length - 1].nextElementSibling;
    parts.forEach(part => part.remove());
    if (page) _cleanupPage(page);
    const target = fallback && _editor.contains(fallback) ? fallback : _getPageContent(_getPages()[0])?.firstElementChild;
    if (target) {
      const range = document.createRange();
      range.selectNodeContents(target);
      range.collapse(true);
      ArtSelection.restore(range);
      ArtSelection.remember(_editor);
    }
    _announce('Таблицю видалено');
  }

  function _allRows(parts) {
    return parts.flatMap(part => [...part.querySelectorAll('tr:not([data-art-table-repeat])')]);
  }

  function _logicalRows(parts) {
    return parts.flatMap(part => [...part.querySelectorAll('tr:not([data-art-table-repeat])')]);
  }

  function _updateTableContext() {
    const entry = document.getElementById('tableToolbarEntry');
    const menu = document.getElementById('tableContextMenu');
    if (!entry || !menu) return;
    const cell = _caretCell();
    entry.hidden = !cell;
    if (!cell) hideTableMenu();
    const merged = cell ? _logicalTableHasMergedCells(_logicalTableParts(cell.closest('table'))) : false;
    menu.querySelectorAll('[data-table-action]').forEach(button => {
      if (!button.dataset.defaultTitle) button.dataset.defaultTitle = button.title || '';
      const unavailable = merged && button.dataset.tableAction !== 'table-delete';
      button.disabled = unavailable;
      button.setAttribute('aria-disabled', String(unavailable));
      button.title = unavailable
        ? 'Недоступно для таблиці з об’єднаними клітинками'
        : button.dataset.defaultTitle;
    });
  }

  function toggleTableMenu(anchor, { focusFirst = false } = {}) {
    const menu = document.getElementById('tableContextMenu');
    if (!menu) return false;
    if (!menu.hidden) {
      hideTableMenu();
      return true;
    }

    ArtSelection.restoreLast(_editor);
    if (!_caretCell()) return false;
    _updateTableContext();
    const rect = anchor?.getBoundingClientRect?.();
    if (!rect) return false;
    _showTableMenu(rect.left, rect.bottom + 6, focusFirst);
    return true;
  }

  function _handleTableContextMenu(e) {
    const cell = e.target.closest?.('th,td');
    if (!cell || !_editor.contains(cell)) {
      hideTableMenu();
      return;
    }

    e.preventDefault();
    if (_caretCell() !== cell) _placeCaretInCell(cell);
    ArtSelection.remember(_editor);
    _updateTableContext();
    _showTableMenu(e.clientX, e.clientY, false);
  }

  function _showTableMenu(clientX, clientY, focusFirst) {
    const menu = document.getElementById('tableContextMenu');
    const button = document.getElementById('tableMenuButton');
    if (!menu || !_caretCell()) return false;

    menu.hidden = false;
    button?.setAttribute('aria-expanded', 'true');
    const width = menu.offsetWidth || 238;
    const height = menu.offsetHeight || 420;
    const left = Math.min(clientX, window.innerWidth - width - 8);
    const top = Math.min(clientY, window.innerHeight - height - 8);
    menu.style.left = `${Math.max(8, left)}px`;
    menu.style.top = `${Math.max(8, top)}px`;
    if (focusFirst) _tableMenuItems(menu)[0]?.focus();
    return true;
  }

  function hideTableMenu({ restoreEditorFocus = false } = {}) {
    const menu = document.getElementById('tableContextMenu');
    const button = document.getElementById('tableMenuButton');
    if (menu) menu.hidden = true;
    button?.setAttribute('aria-expanded', 'false');
    if (restoreEditorFocus) ArtSelection.focusEditor(_editor);
  }

  function _tableMenuItems(menu) {
    return [...menu.querySelectorAll('[role="menuitem"]:not([disabled])')];
  }

  function _handleTableMenuKeydown(e) {
    const menu = e.currentTarget;
    const items = _tableMenuItems(menu);
    const index = items.indexOf(document.activeElement);
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      items[(index + 1) % items.length]?.focus();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      items[(index - 1 + items.length) % items.length]?.focus();
    } else if (e.key === 'Home') {
      e.preventDefault();
      items[0]?.focus();
    } else if (e.key === 'End') {
      e.preventDefault();
      items[items.length - 1]?.focus();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      hideTableMenu({ restoreEditorFocus: true });
    } else if (e.key === 'Tab') {
      hideTableMenu();
    }
  }

  function _caretCell() {
    const range = ArtSelection.getRange(_editor);
    if (!range) return null;
    const node = range.startContainer.nodeType === 1 ? range.startContainer : range.startContainer.parentElement;
    const cell = node?.closest?.('th,td');
    if (!cell || !_editor.contains(cell)) return null;
    const repeatedRow = cell.closest('tr[data-art-table-repeat]');
    if (!repeatedRow) return cell;

    const parts = _logicalTableParts(cell.closest('table'));
    const original = _tableHeaderRow(parts[0]);
    return original?.cells?.[cell.cellIndex] || null;
  }

  function _logicalTableHasMergedCells(parts) {
    return parts.some(part => [...part.querySelectorAll('th,td')].some(cell => cell.colSpan > 1 || cell.rowSpan > 1));
  }

  function _logicalTableCells(table) {
    if (!table) return [];
    return _logicalTableParts(table)
      .flatMap(part => [...part.querySelectorAll('tr:not([data-art-table-repeat]) > th, tr:not([data-art-table-repeat]) > td')]);
  }

  function _logicalTableParts(table) {
    const parts = [table];
    while (parts[0].dataset.artTablePart === 'continued') {
      const prev = _blockBefore(parts[0]);
      if (prev?.tagName !== 'TABLE') break;
      parts.unshift(prev);
    }
    for (;;) {
      const next = _blockAfter(parts[parts.length - 1]);
      if (next?.tagName !== 'TABLE' || next.dataset.artTablePart !== 'continued') break;
      parts.push(next);
    }
    return parts;
  }

  function _blockAfter(block) {
    if (block.nextElementSibling) return block.nextElementSibling;
    const nextPage = block.closest('.page')?.nextElementSibling;
    return nextPage ? _getPageContent(nextPage)?.firstElementChild || null : null;
  }

  function _blockBefore(block) {
    if (block.previousElementSibling) return block.previousElementSibling;
    const prevPage = block.closest('.page')?.previousElementSibling;
    return prevPage ? _getPageContent(prevPage)?.lastElementChild || null : null;
  }

  function _createEmptyRowLike(row) {
    const clone = document.createElement('tr');
    [...row.children].forEach(cell => {
      const fresh = document.createElement('td');
      if (cell.colSpan > 1) fresh.colSpan = cell.colSpan;
      fresh.innerHTML = '<br>';
      clone.appendChild(fresh);
    });
    return clone;
  }

  function _placeCaretInCell(cell) {
    if (!cell) return;
    const range = document.createRange();
    range.selectNodeContents(cell);
    range.collapse(true);
    ArtSelection.restore(range);
    ArtSelection.remember(_editor);
    _scrollCaretIntoView();
  }

  // Chrome після Enter у кінці заповненого аркуша лишає карету на рівні блоків
  // (батько — сам аркуш). Така позиція не переживає перекомпонування сторінок,
  // тому новий абзац створюємо самі й одразу ставимо карету всередину нього.
  const ENTER_BLOCKS = ['P', 'H1', 'H2', 'H3', 'H4', 'BLOCKQUOTE'];

  function _handleParagraphEnter(e) {
    const range = ArtSelection.getRange(_editor);
    if (!range || !range.collapsed) return false;

    const node = range.startContainer.nodeType === 1 ? range.startContainer : range.startContainer.parentElement;
    if (!node || node.closest('table, li')) return false;

    const page = node.closest('.page-content');
    if (!page) return false;

    const block = [...page.children].find(child => child === node || child.contains(node));
    if (!block || !ENTER_BLOCKS.includes(block.tagName)) return false;

    e.preventDefault();

    const tail = range.cloneRange();
    tail.setEnd(block, block.childNodes.length);
    const rest = tail.extractContents();

    // Після заголовка Word починає звичайний абзац — робимо так само.
    const next = document.createElement(block.tagName === 'BLOCKQUOTE' ? 'blockquote' : 'p');
    next.appendChild(rest);
    if (!_hasMeaningfulContent(next)) next.innerHTML = '<br>';
    if (!_hasMeaningfulContent(block)) block.innerHTML = '<br>';
    block.insertAdjacentElement('afterend', next);
    _detachSplitTail(block, next);

    const caret = document.createRange();
    caret.selectNodeContents(next);
    caret.collapse(true);
    ArtSelection.restore(caret);
    ArtSelection.remember(_editor);

    _editor.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
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
    content.dataset.placeholder = 'Почни вводити текст…';
    content.setAttribute('aria-label', 'Сторінка документа');
    page.appendChild(content);
    page.appendChild(_createPageChrome());
    return page;
  }

  // Шар колонтитулів аркуша: порожній і неінтерактивний, текст малює CSS (див. ui/page.js).
  function _createPageChrome() {
    const chrome = document.createElement('div');
    chrome.className = 'page-chrome';
    chrome.setAttribute('aria-hidden', 'true');
    chrome.contentEditable = 'false';
    return chrome;
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

  // trusted — логічний знімок історії з пам'яті (форма редагування, без санітайзера);
  // інакше HTML недовірений (файл, чернетка) і проходить санітайзер.
  // selection — логічні якорі: застосовуються до одного аркуша до пагінації, а
  // перекомпонування зберігає їх маркерами.
  function _setDocumentHTML(html, { trusted = false, selection = null } = {}) {
    _editor.innerHTML = '';
    const page = _createPage();
    _editor.appendChild(page);
    const content = _getPageContent(page);
    content.innerHTML = trusted ? (html || '<p><br></p>') : ArtSanitize.clean(html || '<p><br></p>');
    const range = selection ? ArtDocumentModel.resolveSelection(content, selection) : null;
    if (range) {
      ArtSelection.restore(range);
      ArtSelection.remember(_editor);
    }
    _upgradeImageBlocks();
    _normalizePages();
    _repaginate(!!range);
    ArtSelection.focusEditor(_editor);
  }

  // У файл іде логічний документ (див. core/document-model.js) у переносній формі.
  function _getExportHTML() {
    return ArtDocumentModel.serialize(_editor, { portable: true }).html;
  }

  function _queueRepaginate(preserveSelection = true) {
    cancelAnimationFrame(_layoutQueued);
    clearTimeout(_layoutTimer);
    const run = () => {
      cancelAnimationFrame(_layoutQueued);
      clearTimeout(_layoutTimer);
      _layoutQueued = 0;
      _layoutTimer = 0;
      _repaginate(preserveSelection);
    };
    // У прихованій вкладці requestAnimationFrame не викликається, тож дублюємо
    // таймером: спрацьовує той, хто перший, другий одразу скасовується.
    _layoutQueued = requestAnimationFrame(run);
    _layoutTimer = setTimeout(run, 32);
  }
  function _saveSelectionMarkers() {
    const range = ArtSelection.getRange(_editor);
    if (!range) return null;

    // Після перерваної попередньої пагінації службових маркерів у документі
    // лишатися не повинно.
    _clearSelectionMarkers();

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
    if (!start) {
      _clearSelectionMarkers();
      return;
    }

    try {
      const range = document.createRange();
      const blockCaret = !end ? _blockLevelCaretTarget(start) : null;
      if (end) {
        range.setStartAfter(start);
        range.setEndBefore(end);
      } else if (blockCaret) {
        // Каретка стояла між абзацами (Chrome так робить після Enter у кінці
        // сторінки). Ставимо її всередину сусіднього абзацу, інакше браузер
        // сам поверне її в кінець попереднього — і новий абзац зникне.
        range.selectNodeContents(blockCaret.block);
        range.collapse(blockCaret.atStart);
      } else {
        range.setStartAfter(start);
        range.collapse(true);
      }

      start.remove();
      end?.remove();
      // Увесь документ має один editing host; Range визначає активну сторінку.
      if (document.activeElement !== _editor) _editor.focus({ preventScroll: true });
      ArtSelection.restore(range);
      ArtSelection.remember(_editor);
      _scrollCaretIntoView();
    } finally {
      _clearSelectionMarkers();
    }
  }

  function _clearSelectionMarkers() {
    _editor.querySelectorAll('.art-sel-marker').forEach(marker => marker.remove());
  }

  // Каретка на рівні блоків (батько — сам аркуш) не переживає перекомпонування:
  // повертаємо її в сусідній абзац.
  function _blockLevelCaretTarget(marker) {
    const parent = marker.parentElement;
    if (!parent || !parent.classList.contains('page-content')) return null;
    const next = marker.nextElementSibling;
    if (next) return { block: next, atStart: true };
    const prev = marker.previousElementSibling;
    // У порожньому абзаці позиція після <br> для браузера некоректна —
    // він відкидає карету в попередній блок. Тому ставимо її на початок.
    if (prev) return { block: prev, atStart: !(prev.textContent || '').trim() };
    return null;
  }

  function _scrollCaretIntoView() {
    const scroller = _editor.closest('.editor-scroll');
    const range = ArtSelection.getRange(_editor);
    if (!scroller || !range) return;

    let rect = range.getBoundingClientRect();
    if (!rect || (!rect.height && !rect.top)) {
      const node = range.startContainer;
      const el = node.nodeType === 1 ? node : node.parentElement;
      rect = el?.getBoundingClientRect() || null;
    }
    if (!rect || (!rect.height && !rect.top)) return;

    const view = scroller.getBoundingClientRect();
    const margin = 32;
    if (rect.top < view.top + margin) scroller.scrollTop -= view.top + margin - rect.top;
    else if (rect.bottom > view.bottom - margin) scroller.scrollTop += rect.bottom - view.bottom + margin;
  }

  function _repaginate(preserveSelection = true) {
    if (_layoutLock) return;
    _layoutLock = true;
    let incomplete = false;
    try {
      incomplete = _runPagination(preserveSelection);
    } catch (err) {
      console.error('[text] помилка розбиття на сторінки', err);
    } finally {
      // Замок обовʼязково знімаємо: інакше одна помилка назавжди зупиняє
      // розбиття на сторінки і документ росте однією стрічкою.
      _layoutLock = false;
    }
    // Великий документ (вставка, відкритий .docx) не вміщається в один прохід:
    // ліміт перестановок захищає від зависання, тож доганяємо наступним кадром.
    if (incomplete) _queueRepaginate(preserveSelection);
    else _editor.dispatchEvent(new Event('art:paginated'));
  }

  function _runPagination(preserveSelection) {
    const markers = preserveSelection ? _saveSelectionMarkers() : null;
    try {
      _normalizePages();

      let pages = _getPages();
      let layoutGuard = 0;
      let guardHit = false;
      for (let i = 0; i < pages.length; i++) {
        const current = _getPageContent(pages[i]);
        if (_moveAfterPageBreak(current, i)) pages = _getPages();
        while (_isOverflowing(current)) {
          if (++layoutGuard > 250) { guardHit = true; break; }
          const oversize = _unsplittableOversizeBlock(current);
          if (oversize) {
            _showOversizeBlock(current, oversize);
            break;
          }
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

      _dropEmptyTableContinuations();
      _removeTrailingEmptyPages();
      _editor.querySelectorAll('[data-art-flow-tail]').forEach(el => el.removeAttribute('data-art-flow-tail'));
      _updatePageNumbers();
      _markStaleToc();
      _updateEmptyState();
      _updateStatusBar();
      _updateTableContext();

      return guardHit;
    } finally {
      if (markers) _restoreSelectionMarkers();
      // Під час розрахунку могла тимчасово з'явитися порожня наступна сторінка,
      // яку до відновлення каретки утримував службовий marker.
      _removeTrailingEmptyPages();
      _updatePageNumbers();
      _updateEmptyState();
    }
  }

  function _moveOverflowToNext(current, next) {
    if (!current || !next) return false;
    const blocks = [...current.children];
    if (!blocks.length) return false;

    // Переносимо одразу весь «хвіст», що вийшов за нижню межу аркуша: інакше
    // великий документ вимагав би сотні окремих перестановок з перерахунком
    // розкладки після кожної.
    const limit = current.getBoundingClientRect().bottom;
    let index = blocks.findIndex(block => block.getBoundingClientRect().bottom > limit + 1);
    if (index === -1) index = blocks.length - 1;

    const first = blocks[index];

    // Продовження розрізаного блока стає на початок наступного аркуша, тож
    // блоки під ним переносимо туди заздалегідь: інакше, коли коротша частина
    // звільнить місце, вони опинилися б між частиною та продовженням.
    const splitFirst = () => {
      _moveBlocksToNext(next, blocks, index + 1);
      return _splitBlock(current, first, next);
    };

    // Блок, вищий за саму сторінку, переносити немає сенсу — на наступній він
    // так само не вміститься. Такий ділимо на місці.
    if (_isTallerThanPage(first, current) && splitFirst()) return true;

    if (index === 0) {
      if (splitFirst()) return true;
      if (blocks.length === 1) {
        _showOversizeBlock(current, first);
        return false;
      }
      index = 1;
    } else if (index === blocks.length - 1 &&
               _isTallerThanPage(first, current) &&
               blocks.slice(0, index).every(block => !_hasMeaningfulContent(block))) {
      // Неподільний блок вищий за аркуш, а перед ним лише порожні абзаци:
      // перенесення дало б порожню сторінку й той самий обріз нижче.
      _showOversizeBlock(current, first);
      return false;
    }

    _moveBlocksToNext(next, blocks, index);
    _cleanupPage(current);
    _cleanupPage(next);
    return true;
  }

  // Частина блока, яку цим же проходом уже перенесли на наступну сторінку,
  // стоїть на її початку — решта хвоста має лягти ПІСЛЯ неї, а не перед.
  // Але власне продовження переносного блока має лишитися ПІСЛЯ нього: інакше частина
  // таблиці чи абзацу, що не вмістилася, стала б позаду свого продовження.
  function _moveBlocksToNext(next, blocks, fromIndex) {
    const head = blocks[fromIndex];
    let anchor = null;
    let node = next.firstElementChild;
    while (node && node.hasAttribute('data-art-flow-tail') && !_isContinuationOf(node, head)) {
      anchor = node;
      node = node.nextElementSibling;
    }
    for (let i = blocks.length - 1; i >= fromIndex; i--) {
      if (anchor) anchor.after(blocks[i]);
      else next.prepend(blocks[i]);
    }
  }

  function _splitBlock(current, block, next) {
    return _splitTableBlock(current, block, next)
      || _splitListBlock(current, block, next)
      || _splitTextBlock(current, block, next);
  }

  function _isTallerThanPage(block, pageContent) {
    if (!block || !pageContent) return false;
    return block.getBoundingClientRect().height > pageContent.clientHeight + 1;
  }

  function _unsplittableOversizeBlock(pageContent) {
    const blocks = [...(pageContent?.children || [])];
    const block = blocks.find(item => item.getBoundingClientRect().bottom > pageContent.getBoundingClientRect().bottom + 1);
    if (!block || !_isTallerThanPage(block, pageContent) || block.tagName !== 'TABLE') return null;
    if (blocks.slice(0, blocks.indexOf(block)).some(_hasMeaningfulContent)) return null;

    const body = block.tBodies[0] || block;
    const rows = [...body.rows];
    const headerRow = _tableHeaderRow(block);
    const dataRows = rows.length - (headerRow && rows[0] === headerRow ? 1 : 0);
    const hasRowspan = [...block.querySelectorAll('th,td')].some(cell => cell.rowSpan > 1);
    return hasRowspan || dataRows < 2 ? block : null;
  }

  // Таблиця ділиться по рядках; на продовженні повторюється рядок заголовків,
  // як у Word. Продовження позначаємо, щоб зшити його назад при перекомпонуванні
  // та при експорті.
  function _splitTableBlock(current, block, next) {
    if (!block || block.tagName !== 'TABLE') return false;
    // Rowspan не можна фізично рознести між двома таблицями без побудови
    // повної координатної сітки. Лишаємо таку таблицю одним неподільним блоком.
    if ([...block.querySelectorAll('th,td')].some(cell => cell.rowSpan > 1)) return false;

    const body = block.tBodies[0] || block;
    const rows = [...body.rows];
    const headerRow = _tableHeaderRow(block);
    const firstBodyIndex = headerRow && rows[0] === headerRow ? 1 : 0;
    if (rows.length - firstBodyIndex < 2) return false;

    const limit = current.getBoundingClientRect().bottom;
    let splitIndex = rows.findIndex(row => row.getBoundingClientRect().bottom > limit + 1);
    if (splitIndex === -1) return false;
    if (splitIndex <= firstBodyIndex) splitIndex = firstBodyIndex + 1;
    if (splitIndex >= rows.length) return false;

    const clone = block.cloneNode(false);
    clone.dataset.artTablePart = 'continued';
    const cloneBody = document.createElement('tbody');
    clone.appendChild(cloneBody);

    if (headerRow) {
      const repeat = headerRow.cloneNode(true);
      repeat.dataset.artTableRepeat = '1';
      repeat.setAttribute('contenteditable', 'false');
      repeat.setAttribute('aria-hidden', 'true');
      cloneBody.appendChild(repeat);
    }
    rows.slice(splitIndex).forEach(row => cloneBody.appendChild(row));

    clone.setAttribute('data-art-flow-tail', '1');
    next.prepend(clone);
    _cleanupPage(current);
    _cleanupPage(next);
    return true;
  }

  // Продовження, у якому лишився тільки повторений заголовок, — це порожній
  // хвіст після видалення рядків; він не має тримати за собою сторінку.
  function _dropEmptyTableContinuations() {
    _editor.querySelectorAll('table[data-art-table-part]').forEach(table => {
      if (table.querySelector('tr:not([data-art-table-repeat])')) return;
      const page = table.closest('.page-content');
      table.remove();
      if (page) _cleanupPage(page);
    });
  }

  function _tableHeaderRow(table) {
    const head = table.tHead?.rows?.[0];
    if (head) return head;
    const firstRow = (table.tBodies[0] || table).rows?.[0];
    return firstRow?.querySelector('th') ? firstRow : null;
  }

  function _pullFromNextIfFits(current, next) {
    if (!current || !next) return false;
    if (current.hasAttribute('data-art-oversize') || next.hasAttribute('data-art-oversize')) return false;
    // Аркуш із явним розривом закінчується на ньому: нічого не підтягуємо.
    if ([...current.children].some(_isPageBreak)) return false;
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
    _ensureSplitId(block);
    const clone = block.cloneNode(false);
    while (_isOverflowing(current) && block.children.length > 1) {
      clone.prepend(block.lastElementChild);
    }
    if (!clone.children.length) return false;
    clone.setAttribute('data-art-flow-tail', '1');
    next.prepend(clone);
    _cleanupPage(current);
    _cleanupPage(next);
    return true;
  }

  function _splitTextBlock(current, block, next) {
    // Пункт змісту не ділиться: він переходить на наступний аркуш цілим.
    if (!block || _isTocBlock(block) || !['P', 'DIV', 'H1', 'H2', 'H3', 'H4', 'BLOCKQUOTE'].includes(block.tagName)) return false;
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

    _ensureSplitId(block);
    const clone = block.cloneNode(false);
    clone.appendChild(fragment);
    if (!_hasMeaningfulContent(block)) block.innerHTML = '<br>';
    clone.setAttribute('data-art-flow-tail', '1');
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

  // Частини одного блока, розрізаного сторінками, мають спільний data-art-split. Він
  // переживає перекомпонування: коли частини знову опиняються поруч, вони зшиваються,
  // а серіалізатор завжди віддає їх одним блоком.
  function _newSplitId() {
    _splitCounter += 1;
    return `s${Date.now().toString(36)}${_splitCounter.toString(36)}`;
  }

  function _isContinuationOf(node, head) {
    if (!node || !head) return false;
    if (head.tagName === 'TABLE') {
      return node.tagName === 'TABLE' && node.dataset.artTablePart === 'continued';
    }
    return !!head.dataset.artSplit && node.tagName === head.tagName && node.dataset.artSplit === head.dataset.artSplit;
  }

  function _ensureSplitId(block) {
    if (!block.dataset.artSplit) block.dataset.artSplit = _newSplitId();
  }

  // Enter у частині розрізаного блока: друга половина й усі наступні частини того самого
  // блока стають окремим логічним абзацом, а попередні частини лишаються разом.
  function _detachSplitTail(block, next) {
    const id = block.dataset.artSplit;
    if (!id) return;
    const fresh = _newSplitId();
    next.dataset.artSplit = fresh;
    _editor.querySelectorAll('[data-art-split]').forEach(node => {
      if (node !== next && node.dataset.artSplit === id
        && (next.compareDocumentPosition(node) & Node.DOCUMENT_POSITION_FOLLOWING)) {
        node.dataset.artSplit = fresh;
      }
    });
  }

  function _cleanupPage(pageContent) {
    if (!pageContent) return;
    [...pageContent.childNodes].forEach(node => {
      if (node.nodeType === Node.TEXT_NODE && !(node.textContent || '').trim()) node.remove();
    });
    _mergeAdjacentLists(pageContent);
    _mergeAdjacentTables(pageContent);
    ArtDocumentModel.mergeSplitParts(pageContent);
    if (![...pageContent.children].length) {
      const p = document.createElement('p');
      p.innerHTML = '<br>';
      pageContent.appendChild(p);
    }
  }

  // Продовження таблиці з наступної сторінки зшиваємо назад, коли рядки знову
  // вміщаються разом; повторений рядок заголовків при цьому зникає.
  function _mergeAdjacentTables(container) {
    let node = container.firstElementChild;
    while (node && node.nextElementSibling) {
      const next = node.nextElementSibling;
      if (node.tagName === 'TABLE' && next.tagName === 'TABLE' && next.dataset.artTablePart === 'continued') {
        const body = node.tBodies[0] || node;
        [...(next.tBodies[0] || next).rows].forEach(row => {
          if (row.dataset.artTableRepeat) row.remove();
          else body.appendChild(row);
        });
        next.remove();
      } else {
        node = next;
      }
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
      if (_isPageEmpty(content) && !_holdsCaret(content)) pages[i].remove();
      else break;
    }
    if (!_getPages().length) _editor.appendChild(_createPage());
  }

  // Порожня сторінка, у якій стоїть курсор, — це новий абзац, який користувач
  // щойно почав унизу заповненого аркуша. Її видаляти не можна.
  function _holdsCaret(pageContent) {
    if (!pageContent) return false;
    if (pageContent.querySelector('.art-sel-marker')) return true;
    const range = ArtSelection.getRange(_editor);
    return !!range && (pageContent.contains(range.startContainer) || pageContent.contains(range.endContainer));
  }

  function _isPageEmpty(pageContent) {
    if (!pageContent) return true;
    // Аркуш, з якого підтягнули останній блок, лишається зовсім без елементів — він порожній.
    if (!pageContent.firstElementChild) return !(pageContent.textContent || '').trim();
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
    _lockTocBlocks();
    _getPages().forEach(page => {
      const content = _getPageContent(page);
      if (!content) page.prepend(_createPage().firstElementChild);
      if (!page.querySelector(':scope > .page-chrome')) page.appendChild(_createPageChrome());
      page.removeAttribute('data-art-oversize');
      page.removeAttribute('title');
      content?.removeAttribute('data-art-oversize');
    });
  }

  // Деякі структури не можна безпечно розрізати (наприклад, один дуже високий
  // рядок або rowspan через багато рядків). У такому разі збільшуємо віртуальний
  // аркуш замість того, щоб обрізати вміст через overflow:hidden.
  function _showOversizeBlock(pageContent, block) {
    if (!pageContent || !block) return;
    pageContent.dataset.artOversize = 'true';
    const page = pageContent.closest('.page');
    if (page) {
      page.dataset.artOversize = 'true';
      page.title = 'Цей блок вищий за один аркуш і показаний повністю';
    }
  }

  function _isOverflowing(pageContent) {
    if (!pageContent) return false;
    if (pageContent.scrollHeight > pageContent.clientHeight + 1) return true;
    // scrollHeight майже не зростає від порожнього абзацу в кінці аркуша,
    // тож для такого випадку окремо звіряємо нижню межу останнього блока.
    let last = pageContent.lastElementChild;
    while (last && last.classList.contains('art-sel-marker')) last = last.previousElementSibling;
    if (!last || _hasMeaningfulContent(last)) return false;
    return last.offsetTop + last.offsetHeight > pageContent.clientHeight + 1;
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

  // Пошук і заміна — у ui/find.js; редактор лише скидає їх під час зміни документа.
  function clearFindHighlights() {
    ArtFind.reset();
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

  function _validateDocumentFile(file, extension) {
    const allowedMimes = DOCUMENT_MIME_TYPES[extension];
    if (!allowedMimes) throw new Error(`Файл .${extension || '?'} не підтримується.`);
    if (!allowedMimes.has(String(file.type || '').toLowerCase())) {
      throw new Error('Тип файлу не відповідає його розширенню.');
    }
    const maxBytes = extension === 'docx' ? MAX_DOCX_FILE_BYTES : MAX_TEXT_FILE_BYTES;
    if (file.size > maxBytes) {
      const limitMiB = Math.round(maxBytes / 1024 / 1024);
      throw new Error(`Файл завеликий. Максимальний розмір для .${extension} — ${limitMiB} MiB.`);
    }
  }

  function _validateImageFile(file) {
    const extension = String(file.name || '').split('.').pop().toLowerCase();
    const allowedMimes = IMAGE_MIME_BY_EXTENSION[extension];
    if (!allowedMimes || !allowedMimes.has(String(file.type || '').toLowerCase())) {
      throw new Error('Підтримуються лише PNG, JPEG, GIF і WebP із коректним типом файлу.');
    }
    if (file.size > MAX_IMAGE_FILE_BYTES) {
      throw new Error('Зображення завелике. Максимальний розмір — 8 MiB.');
    }
  }

  async function _readImageDimensions(file) {
    if (typeof createImageBitmap === 'function') {
      try {
        const bitmap = await createImageBitmap(file);
        const dimensions = { width: bitmap.width, height: bitmap.height };
        bitmap.close?.();
        return dimensions;
      } catch {
        // Старі браузери та окремі формати переходять до локального Image fallback.
      }
    }

    const objectUrl = URL.createObjectURL(file);
    try {
      return await new Promise((resolve, reject) => {
        const image = new Image();
        image.onload = () => resolve({ width: image.naturalWidth, height: image.naturalHeight });
        image.onerror = () => reject(new Error('Не вдалося декодувати зображення.'));
        image.src = objectUrl;
      });
    } finally {
      URL.revokeObjectURL(objectUrl);
    }
  }

  function _readFileAsDataUrl(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ''));
      reader.onerror = () => reject(new Error('Не вдалося прочитати зображення.'));
      reader.readAsDataURL(file);
    });
  }

  // Чернетка v2: логічний потік у переносній формі й логічні якорі виділення.
  // v1 (той самий HTML без якорів) відкривається як і раніше.
  function getDraftPayload() {
    const documentState = ArtState.documentSnapshot?.() || {};
    const logical = ArtDocumentModel.serialize(_editor, { portable: true, range: ArtSelection.getRange(_editor) });
    return {
      version: 2,
      fileName: String(ArtState.get('fileName') || 'Без назви'),
      fileFormat: String(ArtState.get('fileFormat') || 'artdoc'),
      document: {
        orientation: documentState.orientation || 'portrait',
        margins: { ...(documentState.margins || {}) },
        pageSize: documentState.pageSize || 'a4',
        headerFooter: ArtState.normalizeHeaderFooter(documentState.headerFooter)
      },
      html: String(logical.html),
      selection: logical.selection
    };
  }

  function restoreDraft(payload) {
    if (!payload || ![1, 2].includes(payload.version) || typeof payload.html !== 'string') {
      throw new Error('unsupported-text-draft');
    }
    const documentState = payload.document || {};
    const orientation = ['portrait', 'landscape'].includes(documentState.orientation)
      ? documentState.orientation : 'portrait';
    const pageSize = ['a4', 'a5', 'letter'].includes(documentState.pageSize)
      ? documentState.pageSize : 'a4';
    const margins = Object.fromEntries(['top', 'right', 'bottom', 'left'].map(side => {
      const value = Number(documentState.margins?.[side]);
      return [side, Number.isFinite(value) && value >= 0 && value <= 10 ? value : undefined];
    }).filter(([, value]) => value !== undefined));

    clearFindHighlights();
    clearSelectedImage();
    ArtHistory.suspend(() => {
      // restoreDocument нормалізує колонтитули з чернетки як недовірені дані.
      ArtState.restoreDocument({ orientation, pageSize, margins, headerFooter: documentState.headerFooter });
      _setDocumentHTML(payload.html, { selection: payload.version === 2 ? payload.selection : null });
      ArtState.set('fileName', String(payload.fileName || 'Без назви').slice(0, 160));
      ArtState.set('fileFormat', String(payload.fileFormat || 'artdoc').slice(0, 20));
    });
    ArtHistory.init(_editor);
    ArtState.setDirty(true);
    _documentRevision += 1;
    _updateFileName();
    _syncView();
    ArtSelection.focusEditor(_editor);
    _announce('Локальну чернетку відновлено');
    return true;
  }

  function clearDocument() {
    newDoc();
  }

  function getDocumentRevision() {
    return _documentRevision;
  }

  function _stripExt(name) { return name.replace(/\.[^.]+$/, '') || name; }

  function _announce(msg) {
    if (!_announcer) return;
    _announcer.textContent = '';
    requestAnimationFrame(() => _announcer.textContent = msg);
  }

  return {
    init, newDoc, saveAs, setOrientation, setZoom, hasSelectedImage, setSelectedImageLayout,
    insertTable, insertPageBreak, insertToc, updateToc, removeToc, tableAction, toggleTableMenu, hideTableMenu, refreshLayout, openImageDialog, clearFindHighlights, editFileName,
    getDraftPayload, restoreDraft, clearDocument, getDocumentRevision, setSpellcheck, toggleSpellcheck,
    MAX_TEXT_FILE_BYTES, MAX_DOCX_FILE_BYTES, MAX_IMAGE_FILE_BYTES, MAX_IMAGE_PIXELS,
    // Логічний (не сторінковий) HTML документа — те, що йде у файл.
    // Відкрито для поведінкових тестів експорту.
    getExportHTML: _getExportHTML
  };
})();
