'use strict';
/* ui/editor.js — full refactor: pages, image resize, safe tables */

const ArtEditor = (() => {
  let _editor = null;
  let _announcer = null;
  let _findState = { query: '', index: -1, matches: [] };
  let _layoutQueued = 0;
  let _layoutTimer = 0;
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
      _syncView();
      ArtToolbar.updateState();
    });

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
    _updateFileName();
    _syncView();
    ArtSelection.focusEditor(_editor);
  }

  function newDoc() {
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
    try {
      let result;
      if (ext === 'txt') result = await ArtTxt.importTxt(file);
      else if (ext === 'rtf') result = await ArtRtf.importRtf(file);
      else if (ext === 'docx') result = await ArtDocx.importDocx(file);
      else return ArtModals.info('Непідтримуваний формат', `Файл .${ext} не підтримується.`);

      clearFindHighlights();
      clearSelectedImage();
      ArtState.resetDocument?.();
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
      _warnAboutFormatLimits(format, html);
    } catch (err) {
      ArtModals.info('Помилка збереження', err.message || String(err));
    }
  }

  // Чесно попереджаємо про спрощення, а не мовчки втрачаємо оформлення.
  function _warnAboutFormatLimits(format, html) {
    const notes = format === 'docx' ? (ArtDocx.describeExportLimits?.(html) || []) : [];
    if (!notes.length) return;
    ArtModals.info(
      'Збережено з застереженнями',
      `Документ збережено, але деяке оформлення спрощено:\n• ${notes.join('\n• ')}`
    );
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

    if (action === 'table-delete') {
      ArtModals.confirm('Видалити всю таблицю?', () => {
        _deleteTable(parts);
        _finishTableAction();
      });
      return true;
    }

    // Об'єднання зшиває частини розрізаної таблиці, тож далі працюємо з тим,
    // що лишилось, а не зі старим списком частин.
    if (action === 'cell-merge') {
      if (!_mergeSelectedCells(cell)) return false;
      _finishTableAction();
      return true;
    }
    if (action === 'cell-split') {
      if (!_splitSelectedCell(cell)) return false;
      _finishTableAction();
      return true;
    }

    // Колонку визначаємо через сітку: cellIndex рахує клітинки в DOM і збиває
    // координати, щойно в таблиці з'являється хоч одне об'єднання.
    const model = _tableGrid(parts);
    const position = _cellPosition(model, cell);
    const columnIndex = position ? position.col : cell.cellIndex;

    switch (action) {
      case 'row-above': _insertRow(row, 'beforebegin', parts); break;
      case 'row-below': _insertRow(row, 'afterend', parts); break;
      case 'row-delete': _deleteRow(parts, row); break;
      case 'column-left': _insertColumn(parts, columnIndex); break;
      case 'column-right': _insertColumn(parts, columnIndex + (position ? position.colSpan : 1)); break;
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

  // Новий рядок будуємо за сіткою: там, де крізь місце вставки проходить
  // клітинка з rowspan, вона просто стає на рядок вищою, а нової клітинки
  // в цій колонці не з'являється.
  function _insertRowByGrid(parts, row, position) {
    const model = _tableGrid(parts);
    const rowIndex = model.rows.indexOf(row);
    if (rowIndex < 0) return null;

    // Куди дивитись, щоб зрозуміти, що перетинає лінію вставки.
    const probeRow = position === 'beforebegin' ? rowIndex : rowIndex + 1;
    const fresh = document.createElement('tr');
    const stretched = new Set();

    for (let c = 0; c < model.columnCount; c++) {
      const above = _gridAt(model, probeRow - 1, c);
      const below = probeRow < model.grid.length ? _gridAt(model, probeRow, c) : null;
      const crossing = above && below && above.cell === below.cell;

      if (crossing) {
        if (!stretched.has(above.cell)) { above.cell.rowSpan = above.rowSpan + 1; stretched.add(above.cell); }
        continue;
      }

      // Новий рядок завжди рядок даних, тож td — навіть під шапкою з th.
      const sample = (below || above);
      const cell = document.createElement('td');
      if (sample && sample.colSpan > 1 && sample.anchorCol === c) {
        cell.colSpan = sample.colSpan;
        c += sample.colSpan - 1;
      }
      cell.innerHTML = '<br>';
      fresh.appendChild(cell);
    }

    row.insertAdjacentElement(position, fresh);
    return fresh;
  }

  function _insertRow(row, position, parts) {
    const fresh = _insertRowByGrid(parts || _logicalTableParts(row.closest('table')), row, position)
      || _createEmptyRowLike(row);
    if (!fresh.parentElement) row.insertAdjacentElement(position, fresh);
    _placeCaretInCell(fresh.firstElementChild);
    _announce(position === 'beforebegin' ? 'Рядок додано вище' : 'Рядок додано нижче');
  }

  // Видалення рядка з об'єднаннями: клітинку, що тягнеться згори, вкорочуємо;
  // клітинку, яка починається саме тут і йде нижче, переносимо в наступний
  // рядок — інакше зник би і той її вміст, що належить іншим рядкам.
  function _deleteRow(parts, row) {
    const model = _tableGrid(parts);
    if (model.rows.length <= 1) return _deleteTable(parts);

    const index = model.rows.indexOf(row);
    if (index < 0) return;
    const nextRow = model.rows[index + 1] || null;
    const handled = new Set();

    for (let c = 0; c < model.columnCount; c++) {
      const slot = _gridAt(model, index, c);
      if (!slot || handled.has(slot.cell)) continue;
      handled.add(slot.cell);
      if (slot.rowSpan <= 1) continue;

      slot.cell.rowSpan = slot.rowSpan - 1;
      if (slot.anchorRow === index && nextRow) {
        // Клітинка мусить «переїхати» на рядок нижче, зберігши свою колонку.
        nextRow.insertBefore(slot.cell, _domReferenceForColumn(model, nextRow, c, slot.cell));
      }
    }

    const fallback = nextRow || model.rows[index - 1];
    row.remove();
    _placeCaretInCell(fallback?.firstElementChild);
    _announce('Рядок видалено');
  }

  // Вставка колонки з урахуванням об'єднань: якщо позицію займає клітинка,
  // розтягнута по горизонталі, її треба розширити, а не додавати сусідню —
  // інакше об'єднана шапка «поїде» відносно даних під нею.
  function _insertColumn(parts, index) {
    const model = _tableGrid(parts);
    const widened = new Set();

    model.rows.forEach((row, r) => {
      const slot = _gridAt(model, r, index);
      const spansAcross = slot && slot.anchorCol < index && slot.anchorCol + slot.colSpan > index;

      if (spansAcross) {
        if (!widened.has(slot.cell)) { slot.cell.colSpan = slot.colSpan + 1; widened.add(slot.cell); }
        return;
      }

      const sample = slot ? slot.cell : row.lastElementChild;
      const fresh = document.createElement(sample?.tagName === 'TH' ? 'th' : 'td');
      fresh.innerHTML = '<br>';

      // Клітинку з rowspan, що тягнеться згори, не дублюємо в кожному рядку.
      if (slot && slot.anchorRow < r) {
        const reference = _domReferenceForColumn(model, row, index - 1, null);
        row.insertBefore(fresh, reference);
        return;
      }
      row.insertBefore(fresh, slot && slot.cell.parentElement === row ? slot.cell : null);
    });

    _announce('Колонку додано');
  }

  // Видалення колонки: клітинку, розтягнуту на кілька колонок, звужуємо, а не
  // видаляємо — інакше зникла б і та її частина, що лежить в інших колонках.
  function _deleteColumn(parts, index) {
    const model = _tableGrid(parts);
    if (model.columnCount <= 1) return _deleteTable(parts);

    const handled = new Set();
    let neighbour = null;

    for (let r = 0; r < model.grid.length; r++) {
      const slot = _gridAt(model, r, index);
      if (!slot || handled.has(slot.cell)) continue;
      handled.add(slot.cell);

      const sideSlot = _gridAt(model, r, index + 1) || _gridAt(model, r, index - 1);
      if (sideSlot && sideSlot.cell !== slot.cell) neighbour = neighbour || sideSlot.cell;

      if (slot.colSpan > 1) slot.cell.colSpan = slot.colSpan - 1;
      else slot.cell.remove();
    }

    _pruneUncoveredRows(parts);
    _placeCaretInCell(neighbour);
    _announce('Колонку видалено');
  }

  // Ширину задаємо лише клітинкам, які займають рівно цю одну колонку:
  // об'єднана по горизонталі клітинка описує кілька колонок одразу, тож її
  // ширина нічого не каже про конкретну.
  function _resizeColumn(parts, index, delta) {
    const model = _tableGrid(parts);
    const targets = [];
    const seen = new Set();

    for (let r = 0; r < model.grid.length; r++) {
      const slot = _gridAt(model, r, index);
      if (!slot || seen.has(slot.cell) || slot.colSpan > 1) continue;
      seen.add(slot.cell);
      targets.push(slot.cell);
    }
    if (!targets.length) return;

    if (delta === null) {
      targets.forEach(cell => cell.style.removeProperty('width'));
      _announce('Ширину колонки скинуто');
      return;
    }

    // Ширину міряємо один раз до змін: інакше кожна наступна клітинка читала б
    // уже перелаштовану колонку й отримувала свій розмір.
    const width = Math.max(MIN_COLUMN_WIDTH, Math.round(targets[0].getBoundingClientRect().width + delta));
    targets.forEach(cell => { cell.style.width = width + 'px'; });
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


  function _logicalRows(parts) {
    return parts.flatMap(part => [...part.querySelectorAll('tr:not([data-art-table-repeat])')]);
  }

  // ---- Координатна сітка таблиці ----
  // Без неї (рядок, колонка) не визначає клітинку однозначно: colspan і rowspan
  // зсувають усе, що йде далі. Сітка розкладає таблицю на клітинки так, що
  // grid[r][c] завжди вказує на ту клітинку, яка займає цю позицію, а anchor
  // каже, чи саме тут вона починається.
  function _tableGrid(parts) {
    const rows = _logicalRows(parts);
    const grid = rows.map(() => []);

    rows.forEach((row, r) => {
      let c = 0;
      [...row.children].forEach(cell => {
        while (grid[r][c]) c++; // позиція вже зайнята spans із попередніх рядків
        const colSpan = Math.max(1, cell.colSpan || 1);
        const rowSpan = Math.max(1, cell.rowSpan || 1);
        for (let dr = 0; dr < rowSpan && r + dr < rows.length; dr++) {
          for (let dc = 0; dc < colSpan; dc++) {
            grid[r + dr][c + dc] = { cell, anchorRow: r, anchorCol: c, rowSpan, colSpan };
          }
        }
        c += colSpan;
      });
    });

    const columnCount = grid.reduce((max, line) => Math.max(max, line.length), 0);
    return { parts, rows, grid, columnCount };
  }

  function _gridAt(model, r, c) {
    return model.grid[r] ? model.grid[r][c] || null : null;
  }

  // Позиція клітинки в сітці (за її якорем).
  function _cellPosition(model, cell) {
    for (let r = 0; r < model.grid.length; r++) {
      for (let c = 0; c < model.columnCount; c++) {
        const slot = _gridAt(model, r, c);
        if (slot && slot.cell === cell && slot.anchorRow === r && slot.anchorCol === c) {
          return { row: r, col: c, rowSpan: slot.rowSpan, colSpan: slot.colSpan };
        }
      }
    }
    return null;
  }

  // Прямокутник клітинок, яких торкається виділення. Розширюємо його, доки
  // всередину не потраплять цілі об'єднані клітинки: не можна злити «половину»
  // вже об'єднаної клітинки.
  function _cellOf(node) {
    const element = node && node.nodeType === 1 ? node : node?.parentElement;
    const cell = element?.closest?.('th,td');
    return cell && _editor.contains(cell) ? cell : null;
  }

  function _selectedCellRect(model) {
    const range = ArtSelection.getRange(_editor);

    // Прямокутник будуємо за ДВОМА кутами виділення, а не за всім, що Range
    // перетинає: лінійний DOM-Range від B1 до B3 проходить і через C1, і через
    // A3, тож «перетнуті» клітинки дали б усю таблицю замість одного стовпця.
    const corners = [];
    if (range) {
      const start = _cellOf(range.startContainer);
      const end = _cellOf(range.endContainer);
      if (start) corners.push(start);
      if (end && end !== start) corners.push(end);
    }
    if (!corners.length) {
      const caret = _caretCell();
      if (caret) corners.push(caret);
    }
    if (!corners.length) return null;

    let r1 = Infinity, c1 = Infinity, r2 = -1, c2 = -1;
    corners.forEach(cell => {
      const pos = _cellPosition(model, cell);
      if (!pos) return;
      r1 = Math.min(r1, pos.row);
      c1 = Math.min(c1, pos.col);
      r2 = Math.max(r2, pos.row + pos.rowSpan - 1);
      c2 = Math.max(c2, pos.col + pos.colSpan - 1);
    });
    if (r2 < 0) return null;

    // Розширюємо, доки прямокутник не стане замкненим щодо наявних об'єднань.
    for (let guard = 0; guard < 40; guard++) {
      let grew = false;
      for (let r = r1; r <= r2; r++) {
        for (let c = c1; c <= c2; c++) {
          const slot = _gridAt(model, r, c);
          if (!slot) continue;
          if (slot.anchorRow < r1) { r1 = slot.anchorRow; grew = true; }
          if (slot.anchorCol < c1) { c1 = slot.anchorCol; grew = true; }
          if (slot.anchorRow + slot.rowSpan - 1 > r2) { r2 = slot.anchorRow + slot.rowSpan - 1; grew = true; }
          if (slot.anchorCol + slot.colSpan - 1 > c2) { c2 = slot.anchorCol + slot.colSpan - 1; grew = true; }
        }
      }
      if (!grew) break;
    }

    return { r1, c1, r2, c2 };
  }

  // Об'єднання не може перетнути межу частин розрізаної таблиці: клітинка
  // не буває одночасно у двох <table>. Тому спершу зшиваємо частини назад —
  // пагінація розріже їх заново там, де це можливо.
  function _joinTableParts(parts) {
    if (parts.length < 2) return parts;
    const first = parts[0];
    const body = first.tBodies[0] || first;
    parts.slice(1).forEach(part => {
      [...(part.tBodies[0] || part).rows].forEach(row => {
        if (row.dataset.artTableRepeat) row.remove();
        else body.appendChild(row);
      });
      const page = part.closest('.page-content');
      part.remove();
      if (page) _cleanupPage(page);
    });
    first.removeAttribute('data-art-flow-tail');
    return [first];
  }

  function _mergeSelectedCells(cell) {
    let parts = _logicalTableParts(cell.closest('table'));
    if (parts.length > 1) parts = _joinTableParts(parts);

    const model = _tableGrid(parts);
    const rect = _selectedCellRect(model);
    if (!rect) return false;

    if (rect.r1 === rect.r2 && rect.c1 === rect.c2) {
      ArtModals.info('Об’єднання клітинок', 'Виділи дві або більше сусідні клітинки, які треба об’єднати.');
      return false;
    }

    const anchorSlot = _gridAt(model, rect.r1, rect.c1);
    if (!anchorSlot) return false;
    const anchor = anchorSlot.cell;

    // Збираємо вміст у порядку читання; порожні клітинки не додають порожніх абзаців.
    const seen = new Set();
    const pieces = [];
    for (let r = rect.r1; r <= rect.r2; r++) {
      for (let c = rect.c1; c <= rect.c2; c++) {
        const slot = _gridAt(model, r, c);
        if (!slot || seen.has(slot.cell)) continue;
        seen.add(slot.cell);
        const html = slot.cell.innerHTML.trim();
        if (html && html !== '<br>') pieces.push(html);
      }
    }

    seen.forEach(target => { if (target !== anchor) target.remove(); });

    anchor.colSpan = rect.c2 - rect.c1 + 1;
    anchor.rowSpan = rect.r2 - rect.r1 + 1;
    anchor.innerHTML = pieces.length ? pieces.join('<br>') : '<br>';

    _pruneUncoveredRows(parts);
    _placeCaretInCell(anchor);
    _announce(`Об’єднано клітинок: ${seen.size}`);
    return true;
  }

  // Рядок без власних клітинок допустимий, поки його накриває чийсь rowspan.
  // Якщо не накриває — це порожній залишок після об'єднання, і він має зникнути.
  function _pruneUncoveredRows(parts) {
    const model = _tableGrid(parts);
    model.rows.forEach((row, r) => {
      if (row.children.length) return;
      const covered = model.grid[r]?.some(slot => slot && slot.cell.isConnected);
      if (!covered) row.remove();
    });
  }

  function _splitSelectedCell(cell) {
    const parts = _logicalTableParts(cell.closest('table'));
    const model = _tableGrid(parts);
    const pos = _cellPosition(model, cell);
    if (!pos) return false;

    if (pos.rowSpan <= 1 && pos.colSpan <= 1) {
      ArtModals.info('Розділення клітинки', 'Ця клітинка не об’єднана — розділяти нічого.');
      return false;
    }

    const { row, col, rowSpan, colSpan } = pos;
    cell.colSpan = 1;
    cell.rowSpan = 1;

    // Тег беремо з того рядка, куди клітинка повертається: об'єднана шапка,
    // що звисала в рядки даних, не повинна перетворити їх на заголовкові.
    const tagFor = tr => {
      const sibling = tr.querySelector('th,td');
      if (sibling && sibling !== cell) return sibling.tagName === 'TH' ? 'th' : 'td';
      return cell.tagName === 'TH' ? 'th' : 'td';
    };

    // Повертаємо на місце клітинки, які об'єднання поглинуло. Ідемо з кінця,
    // щоб вставка не зсувала позиції, які ще не обробили.
    for (let r = row + rowSpan - 1; r >= row; r--) {
      const tr = model.rows[r];
      if (!tr) continue;
      for (let c = col + colSpan - 1; c >= col; c--) {
        if (r === row && c === col) continue;
        const fresh = document.createElement(tagFor(tr));
        fresh.innerHTML = '<br>';
        const reference = _domReferenceForColumn(model, tr, c, cell);
        tr.insertBefore(fresh, reference);
      }
    }

    _placeCaretInCell(cell);
    _announce('Клітинку розділено');
    return true;
  }

  // Куди в DOM-рядку вставити клітинку, щоб вона опинилась у колонці col.
  // Орієнтуємось на першу клітинку рядка, чия колонка більша за потрібну.
  function _domReferenceForColumn(model, tr, col, ignore) {
    const rowIndex = model.rows.indexOf(tr);
    if (rowIndex < 0) return null;
    for (let c = col + 1; c < model.columnCount; c++) {
      const slot = _gridAt(model, rowIndex, c);
      if (!slot || slot.cell === ignore) continue;
      if (slot.cell.parentElement === tr) return slot.cell;
    }
    return null;
  }

  function _updateTableContext() {
    const entry = document.getElementById('tableToolbarEntry');
    const menu = document.getElementById('tableContextMenu');
    if (!entry || !menu) return;
    const cell = _caretCell();
    entry.hidden = !cell;
    if (!cell) hideTableMenu();
    // Операції рядків і колонок працюють з об'єднаннями через координатну
    // сітку, тож блокувати їх більше не треба. Лишається одне обмеження:
    // «Розділити» має сенс лише для вже об'єднаної клітинки.
    const splittable = !!cell && (cell.colSpan > 1 || cell.rowSpan > 1);
    menu.querySelectorAll('[data-table-action]').forEach(button => {
      if (!button.dataset.defaultTitle) button.dataset.defaultTitle = button.title || '';
      const unavailable = button.dataset.tableAction === 'cell-split' && !splittable;
      button.disabled = unavailable;
      button.setAttribute('aria-disabled', String(unavailable));
      button.title = unavailable
        ? 'Ця клітинка не об’єднана'
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

    // У файл іде логічний документ: розрізані сторінками таблиці зшиваємо назад,
    // повторені заголовки прибираємо.
    _mergeAdjacentTables(temp);
    temp.querySelectorAll('tr[data-art-table-repeat]').forEach(row => row.remove());
    temp.querySelectorAll('table[data-art-table-part]').forEach(table => table.removeAttribute('data-art-table-part'));

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

    // Блок, вищий за саму сторінку, переносити немає сенсу — на наступній він
    // так само не вміститься. Такий ділимо на місці.
    if (_isTallerThanPage(first, current) && _splitBlock(current, first, next)) return true;

    if (index === 0) {
      if (_splitBlock(current, first, next)) return true;
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
  function _moveBlocksToNext(next, blocks, fromIndex) {
    let anchor = null;
    let node = next.firstElementChild;
    while (node && node.hasAttribute('data-art-flow-tail')) {
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
    clone.setAttribute('data-art-flow-tail', '1');
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

  function _cleanupPage(pageContent) {
    if (!pageContent) return;
    [...pageContent.childNodes].forEach(node => {
      if (node.nodeType === Node.TEXT_NODE && !(node.textContent || '').trim()) node.remove();
    });
    _mergeAdjacentLists(pageContent);
    _mergeAdjacentTables(pageContent);
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
    const settings = ArtState.normalizePageNumbers(ArtState.get('pageNumbers'));
    const pages = _getPages();

    pages.forEach((page, index) => {
      page.dataset.pageNumber = `${index + 1}`;
      // data-page-label — те, що реально малює CSS. Порожній рядок означає
      // «без номера», тож вимкнена нумерація нічого не друкує.
      const hidden = !settings.enabled || (settings.skipFirst && index === 0);
      page.dataset.pageLabel = hidden ? '' : `${index + 1}`;
    });

    const wrap = document.querySelector('.pages-wrap');
    if (wrap) wrap.dataset.pageNumberPosition = settings.position;

    _updatePageStatus(pages.length);
  }

  // Номер сторінки в рядку стану — навігаційна підказка, яка не залежить
  // від того, чи нумерує учень сторінки в самому документі.
  function _updatePageStatus(total) {
    const el = document.getElementById('statusPage');
    if (!el) return;
    const pages = _getPages();
    const count = total ?? pages.length;
    const active = _getActivePage();
    const index = active ? pages.indexOf(active) : -1;
    el.textContent = `${index >= 0 ? index + 1 : 1} з ${count || 1}`;
  }

  function _getActivePage() {
    const selection = window.getSelection();
    const node = selection && selection.rangeCount ? selection.getRangeAt(0).startContainer : null;
    const element = node && node.nodeType === 1 ? node : node?.parentElement;
    return element?.closest?.('.page') || _getPages()[0] || null;
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

  function _setFindStatus(text) {
    const status = document.getElementById('findStatus');
    if (status) status.textContent = text || '';
  }

  // Готує підсвітку під запит. Повертає кількість збігів.
  function _ensureMatches(query) {
    if (_findState.query !== query) {
      clearFindHighlights();
      _findState = { query, index: -1, matches: [] };
      _findState.matches = _collectMatches(query);
      _paintMatches();
    }
    return _findState.matches.length;
  }

  function findNext(query) {
    query = String(query || '').trim();
    if (!query) return;
    if (!_ensureMatches(query)) {
      _setFindStatus('Нічого не знайдено.');
      return;
    }
    _setFindStatus(`Знайдено збігів: ${_findState.matches.length}.`);
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
      parent.normalize();
    });
    _findState = { query: '', index: -1, matches: [] };
  }

  // Підміняє один <mark> текстом заміни. Порожня заміна = видалення знайденого.
  function _replaceMark(mark, replacement) {
    const parent = mark.parentNode;
    if (!parent) return;
    if (replacement) parent.insertBefore(document.createTextNode(replacement), mark);
    parent.removeChild(mark);
    parent.normalize();
  }

  // Після заміни довжина тексту змінилась, тож стару розкладку й старі
  // позиції збігів тримати не можна: перебудовуємо і те, і те.
  function _afterReplace(query, message) {
    const restore = query ? String(query) : '';
    _findState = { query: '', index: -1, matches: [] };
    _editor.dispatchEvent(new Event('input', { bubbles: true }));
    _syncView();
    ArtHistory.pushNow?.();
    if (restore) _ensureMatches(restore);
    _setFindStatus(message);
  }

  function replaceCurrent(query, replacement) {
    query = String(query || '').trim();
    if (!query) return;
    replacement = String(replacement ?? '');

    if (!_ensureMatches(query)) {
      _setFindStatus('Нічого не знайдено.');
      return;
    }

    const marks = [..._editor.querySelectorAll('mark.search-hit')];
    // Замінюємо поточний виділений збіг, а без нього — перший.
    const index = marks.findIndex(mark => mark.classList.contains('current'));
    const target = marks[index >= 0 ? index : 0];
    if (!target) return;

    _replaceMark(target, replacement);
    const left = Math.max(0, marks.length - 1);
    _afterReplace(left ? query : '', '');

    // Переходимо до наступного збігу, як у Word, і лише після цього пишемо
    // підсумок — інакше findNext затер би повідомлення про заміну.
    if (left) findNext(query);
    _setFindStatus(left
      ? `Замінено 1. Залишилось збігів: ${left}.`
      : 'Замінено 1. Більше збігів немає.');
  }

  function replaceAll(query, replacement) {
    query = String(query || '').trim();
    if (!query) return;
    replacement = String(replacement ?? '');

    if (!_ensureMatches(query)) {
      _setFindStatus('Нічого не знайдено.');
      return;
    }

    const marks = [..._editor.querySelectorAll('mark.search-hit')];
    marks.forEach(mark => _replaceMark(mark, replacement));
    _afterReplace('', `Замінено збігів: ${marks.length}.`);
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
    insertTable, tableAction, toggleTableMenu, hideTableMenu, refreshLayout, openImageDialog,
    findNext, replaceCurrent, replaceAll, clearFindHighlights, editFileName,
    // Логічний (не сторінковий) HTML документа — те, що йде у файл.
    // Відкрито для поведінкових тестів експорту.
    getExportHTML: _getExportHTML
  };
})();
