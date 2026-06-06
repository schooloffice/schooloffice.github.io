// ---- Grid build / rebuild ----
function rebuildGrid() {
  ensureCellWithinBounds();

  const hRow = document.getElementById('headRow');
  const bRows = document.getElementById('bodyRows');
  const colgroup = document.getElementById('colgroup');

  if (!hRow || !bRows || !colgroup) {
    console.error('Grid elements not found');
    return;
  }

  // Recompute COLS (in case col count changed)
  COLS = buildCols(COL_COUNT);

  // Init missing widths
  for (let c = 0; c < COL_COUNT; c++) {
    if (!colWidths[c]) colWidths[c] = 80;
  }

  // Clear
  hRow.innerHTML = '';
  bRows.innerHTML = '';
  colgroup.innerHTML = '';

  // Colgroup (0 = row header)
  colEls = [];
  const colRowHeader = document.createElement('col');
  colRowHeader.style.width = '50px';
  colgroup.appendChild(colRowHeader);
  colEls.push(colRowHeader);

  for (let c = 0; c < COL_COUNT; c++) {
    const col = document.createElement('col');
    colgroup.appendChild(col);
    colEls.push(col);
  }

  // Header corner
  // ARIA — таблиця для скрінрідерів
  const table = document.getElementById('grid');
  if (table) {
    table.setAttribute('role', 'grid');
    table.setAttribute('aria-label', 'Таблиця даних. Використовуй стрілки для навігації, Enter або F2 для редагування.');
  }

  const thCorner = document.createElement('th');
  thCorner.className = 'row-header';
  thCorner.textContent = '#';
  thCorner.title = 'Виділити все';
  thCorner.setAttribute('scope', 'col');
  thCorner.addEventListener('mousedown', (e) => {
    if (e.button !== 0) return;
    selStart = { c: 0, r: 1 };
    selEnd = { c: COL_COUNT - 1, r: ROWS };
    setActive(active.c, active.r, activeId, { keepSelection: true });
    renderSel();
  });
  hRow.appendChild(thCorner);

  // Column headers
  for (let c = 0; c < COL_COUNT; c++) {
    const th = document.createElement('th');
    th.classList.add('col-header');
    th.textContent = COLS[c];
    th.dataset.col = String(c);
    th.setAttribute('scope', 'col');
    th.setAttribute('aria-label', `Колонка ${COLS[c]}. Клацни, щоб виділити всю колонку.`);

    const handle = document.createElement('div');
    handle.className = 'resize-handle';
    handle.addEventListener('mousedown', (e) => TablesColumnSizing.startResize(e, c));
    th.appendChild(handle);

    th.addEventListener('mousedown', (e) => {
      const rect = th.getBoundingClientRect();
      const distanceFromRight = rect.right - e.clientX;
      if (distanceFromRight <= 10) return; // resize handle area
      if (e.button !== 0) return;
      // select column
      selStart = { c, r: 1 };
      selEnd = { c, r: ROWS };
      setActive(c, active.r, getCellId(c, active.r), { keepSelection: true });
      renderSel();
    });

    th.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      selStart = { c, r: 1 };
      selEnd = { c, r: ROWS };
      setActive(c, active.r, getCellId(c, active.r), { keepSelection: true });
      renderSel();
      openHeaderContextMenu('col', c, e.clientX, e.clientY);
    });

    hRow.appendChild(th);
  }

  // Body
  cellTd = Array.from({ length: ROWS + 1 }, () => Array(COL_COUNT).fill(null));
  cellInp = Array.from({ length: ROWS + 1 }, () => Array(COL_COUNT).fill(null));

  for (let r = 1; r <= ROWS; r++) {
    const tr = document.createElement('tr');

    const rowTh = document.createElement('th');
    rowTh.textContent = String(r);
    rowTh.className = 'row-header';
    rowTh.title = `Виділити рядок ${r}`;
    rowTh.setAttribute('scope', 'row');
    rowTh.setAttribute('aria-label', `Рядок ${r}. Клацни, щоб виділити весь рядок.`);
    rowTh.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return;
      selStart = { c: 0, r };
      selEnd = { c: COL_COUNT - 1, r };
      setActive(active.c, r, getCellId(active.c, r), { keepSelection: true });
      renderSel();
    });
    rowTh.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      selStart = { c: 0, r };
      selEnd = { c: COL_COUNT - 1, r };
      setActive(active.c, r, getCellId(active.c, r), { keepSelection: true });
      renderSel();
      openHeaderContextMenu('row', r, e.clientX, e.clientY);
    });
    tr.appendChild(rowTh);

    for (let c = 0; c < COL_COUNT; c++) {
      const td = document.createElement('td');
      const id = getCellId(c, r);
      td.dataset.id = id;
      td.dataset.c = String(c);
      td.dataset.r = String(r);

      // apply saved styles
      const styleStr = cellStyles[id];
      if (styleStr) {
        styleStringToClassList(styleStr).forEach(cls => td.classList.add(cls));
      }

      const inp = document.createElement('input');
      inp.id = `inp_${id}`;
      inp.className = 'cell-input';
      inp.autocomplete = 'off';
      inp.setAttribute('role', 'gridcell');
      inp.setAttribute('aria-label', `Клітинка ${id}`);
      inp.setAttribute('aria-colindex', String(c + 2)); // +2: col1 = row-header
      inp.setAttribute('aria-rowindex', String(r + 1)); // +1: row1 = col-headers

      // Selection
      td.addEventListener('mousedown', (e) => {
        if (!isResizing) startSel(e, c, r, id);
      });
      td.addEventListener('mouseenter', () => {
        if (!isResizing) updateSel(c, r);
      });

      // Editing
      inp.addEventListener('focus', () => {
        if (!isSelecting && !isResizing) {
          setActive(c, r, id);
          // Cell always shows computed result; formula bar shows the raw formula.
          // User can press F2 or click formula bar to edit the formula directly.
        }
      });

      // F2 switches cell to formula-edit mode (shows raw formula in cell)
      inp.addEventListener('keydown', (ev) => {
        if (ev.key === 'F2') {
          const raw = cellData[id];
          if (String(raw || '').startsWith('=')) {
            inp.value = raw;
            try { inp.setSelectionRange(inp.value.length, inp.value.length); } catch (_) { }
          }
        }
      });

      inp.addEventListener('input', (e) => {
        const v = String(e.target.value || '');
        if (v.length > 200) {
          e.target.value = v.substring(0, 200);
        }
        cellData[id] = e.target.value;
        setDirty(true);

        if (activeId === id) {
          const fb = document.getElementById('formulaBar');
          if (fb) fb.value = e.target.value;
        }
      });

      inp.addEventListener('keydown', (e) => handleKey(e, c, r));
      inp.addEventListener('blur', () => {
        // commit on blur
        recalculateAll();
        persistStateToStorage();
        setSaveBadge();
        saveToHistory();
      });

      inp.addEventListener('paste', (e) => {
        // multi-cell paste (tabs/newlines) into grid
        const text = e.clipboardData?.getData('text/plain');
        if (!text) return;
        if (text.includes('\t') || text.includes('\n') || text.includes('\r')) {
          e.preventDefault();
          pasteToGrid(text, active.c, active.r);
        }
      });

      td.appendChild(inp);
      tr.appendChild(td);

      cellTd[r][c] = td;
      cellInp[r][c] = inp;
    }

    bRows.appendChild(tr);
  }

  // Apply widths via colgroup
  applyColWidths();

  // Metrics (for insert + hover)
  try {
    const cornerRect = thCorner.getBoundingClientRect();
    metrics.rowHeaderW = Math.round(cornerRect.width) || 50;
    metrics.headerH = Math.round(cornerRect.height) || 40;
    const td0 = cellTd[1]?.[0];
    if (td0) {
      const tdRect = td0.getBoundingClientRect();
      metrics.rowH = Math.round(tdRect.height) || 45;
    }
  } catch (_) { }

  // Restore selection visuals
  ensureCellWithinBounds();
  renderSel();

  // Populate raw values (computed will be shown after recalc)
  for (let r = 1; r <= ROWS; r++) {
    for (let c = 0; c < COL_COUNT; c++) {
      const id = getCellId(c, r);
      const inp = cellInp[r][c];
      if (!inp) continue;
      const raw = cellData[id];
      if (raw === undefined || raw === null || raw === '') {
        inp.value = '';
      } else {
        inp.value = raw;
      }
    }
  }
}

// ---- Selection ----
function startSel(e, c, r, id) {
  if (e.button !== 0) return;

  const bar = document.getElementById('formulaBar');
  if (bar && document.activeElement === bar && String(bar.value || '').startsWith('=')) {
    // Insert cell ref into formula bar
    e.preventDefault();
    e.stopPropagation();
    TablesFormulaBar.insertChar(id);
    return;
  }

  isSelecting = true;
  selStart = { c, r };
  selEnd = { c, r };
  setActive(c, r, id);
  renderSel();
}

function updateSel(c, r) {
  if (!isSelecting) return;
  selEnd = { c, r };
  renderSel();
}

function setActive(c, r, id, opts = {}) {
  active = { c, r };
  activeId = id;

  const ref = document.getElementById('activeCellRef');
  if (ref) ref.innerText = id;
  // Повідомляємо скрінрідер про активну клітинку
  const cellVal = cellData[id] || '';
  announce(`Клітинка ${id}. ${cellVal ? 'Значення: ' + cellVal : 'Порожня'}`);

  const fb = document.getElementById('formulaBar');
  if (fb) fb.value = cellData[id] || '';

  if (!opts.keepSelection && !isSelecting) {
    selStart = selEnd = { c, r };
  }
  renderSel();
}

function renderSel() {
  // clear previous marks
  for (const td of markedCells) {
    td.classList.remove('selected-cell', 'in-range');
  }
  markedCells = [];
  document.querySelectorAll('.row-header.header-selected, .col-header.header-selected').forEach(el => el.classList.remove('header-selected'));

  const b = getBounds();

  for (let r = b.rMin; r <= b.rMax; r++) {
    const row = cellTd[r];
    if (!row) continue;
    for (let c = b.cMin; c <= b.cMax; c++) {
      const td = row[c];
      if (!td) continue;
      td.classList.add('in-range');
      markedCells.push(td);
    }
  }

  const aTd = cellTd[active.r]?.[active.c];
  if (aTd) {
    aTd.classList.add('selected-cell');
    if (!markedCells.includes(aTd)) markedCells.push(aTd);
  }

  const wholeRows = b.cMin === 0 && b.cMax === COL_COUNT - 1;
  const wholeCols = b.rMin === 1 && b.rMax === ROWS;
  if (wholeRows) {
    for (let rr = b.rMin; rr <= b.rMax; rr++) {
      document.querySelector(`#bodyRows > tr:nth-child(${rr}) > .row-header`)?.classList.add('header-selected');
    }
  }
  if (wholeCols) {
    for (let cc = b.cMin; cc <= b.cMax; cc++) {
      document.querySelector(`th.col-header[data-col="${cc}"]`)?.classList.add('header-selected');
    }
  }

  updateSelectionStats();
  updateToolbarState();
}

// ---- Keyboard / clipboard ----
function commitCell() {
  recalculateAll();
  persistStateToStorage();
  setSaveBadge();
  saveToHistory();
}

function handleKey(e, c, r) {
  const inp = cellInp[r]?.[c];

  // Escape — скасувати редагування, відновити попереднє значення
  if (e.key === 'Escape') {
    e.preventDefault();
    const saved = history[historyIndex];
    if (saved) {
      const prevData = safeParseJSON(saved.cellData, {});
      const id = getCellId(c, r);
      const prev = prevData[id] ?? '';
      cellData[id] = prev;
      if (inp) inp.value = prev;
      const fb = document.getElementById('formulaBar');
      if (fb && activeId === id) fb.value = prev;
    }
    inp?.blur();
    return;
  }

  if (e.key === 'Enter') {
    e.preventDefault();
    commitCell();
    const nextInp = cellInp[Math.min(r + 1, ROWS)]?.[c];
    if (nextInp) nextInp.focus();
    return;
  }

  if (e.key === 'Tab') {
    e.preventDefault();
    commitCell();
    const nextC = e.shiftKey ? Math.max(c - 1, 0) : Math.min(c + 1, COL_COUNT - 1);
    const nextInp = cellInp[r]?.[nextC];
    if (nextInp) nextInp.focus();
    return;
  }

  // Навігація стрілками (тільки якщо клітинка не редагується або курсор на краю)
  const isAtStart = !inp || inp.selectionStart === 0;
  const isAtEnd   = !inp || inp.selectionStart === inp.value.length;

  if (e.key === 'ArrowDown') {
    e.preventDefault();
    commitCell();
    cellInp[Math.min(r + 1, ROWS)]?.[c]?.focus();
    return;
  }
  if (e.key === 'ArrowUp') {
    e.preventDefault();
    commitCell();
    cellInp[Math.max(r - 1, 1)]?.[c]?.focus();
    return;
  }
  if (e.key === 'ArrowRight' && isAtEnd) {
    e.preventDefault();
    commitCell();
    cellInp[r]?.[Math.min(c + 1, COL_COUNT - 1)]?.focus();
    return;
  }
  if (e.key === 'ArrowLeft' && isAtStart) {
    e.preventDefault();
    commitCell();
    cellInp[r]?.[Math.max(c - 1, 0)]?.focus();
    return;
  }
}

function ensureGridSize(minRows, minCols) {
  const needRows = Math.max(ROWS, Number(minRows) || ROWS);
  const needCols = Math.max(COL_COUNT, Number(minCols) || COL_COUNT);

  if (needRows === ROWS && needCols === COL_COUNT) return;

  setGridSize(needRows, needCols);
  rebuildGrid();
}
