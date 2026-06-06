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
        if (isFilling) { updateFill(c, r); return; }
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
        // Багатоклітинкова вставка (таби/переноси) або внутрішня вставка формул.
        const text = e.clipboardData?.getData('text/plain');
        if (!text) return;
        const multiCell = text.includes('\t') || text.includes('\n') || text.includes('\r');
        if (multiCell || TablesClipboard.isInternalPaste(text)) {
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
  positionFillHandle();
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

// ---- Autofill (маркер заповнення) ----
let fillHandleEl = null;
let fillPreviewCells = [];

function rangeAsc(a, b) { const out = []; for (let i = a; i <= b; i++) out.push(i); return out; }
function rangeDesc(a, b) { const out = []; for (let i = a; i >= b; i--) out.push(i); return out; }

function isPlainNumberRaw(raw) {
  const s = String(raw ?? '').trim();
  if (s === '' || s.startsWith('=')) return false;
  return Number.isFinite(Number(s.replace(',', '.')));
}

function formatFillNumber(n) {
  if (!Number.isFinite(n)) return '';
  return Number.isInteger(n) ? String(n) : String(parseFloat(n.toFixed(10)));
}

// Чисте обчислення значення для позиції seqIndex у послідовності заповнення.
// seqIndex 0..len-1 — джерело; >= len — цільові клітинки.
// Числова доріжка → арифметична прогресія; інакше — повтор зразка (для формул
// зсув посилань робить уже застосунок за patternIndex).
function computeFillRaw(sourceRaws, seqIndex) {
  const src = sourceRaws.map(v => String(v ?? ''));
  const len = src.length;
  if (len === 0) return { type: 'pattern', patternIndex: 0, raw: '' };

  if (src.every(isPlainNumberRaw)) {
    const vals = src.map(s => Number(s.replace(',', '.')));
    const step = len >= 2 ? vals[len - 1] - vals[len - 2] : 0;
    const value = vals[len - 1] + step * (seqIndex - (len - 1));
    return { type: 'num', raw: formatFillNumber(value) };
  }

  const patternIndex = ((seqIndex % len) + len) % len;
  return { type: 'pattern', patternIndex, raw: src[patternIndex] };
}

function fillLane(sourceRaws, sourceIds, targetIds, sourcePositions, targetPositions, axisRow) {
  const len = sourceRaws.length;
  for (let t = 0; t < targetIds.length; t++) {
    const seqIndex = len + t;
    const res = computeFillRaw(sourceRaws, seqIndex);
    const targetId = targetIds[t];

    let raw;
    if (res.type === 'num') {
      raw = res.raw;
    } else if (String(res.raw).startsWith('=')) {
      const delta = targetPositions[t] - sourcePositions[res.patternIndex];
      raw = axisRow ? offsetFormulaRefs(res.raw, delta, 0) : offsetFormulaRefs(res.raw, 0, delta);
    } else {
      raw = res.raw;
    }

    if (raw === '' || raw == null) delete cellData[targetId];
    else cellData[targetId] = raw;

    // Формат теж тягнемо за зразком
    const styleSrcId = sourceIds[seqIndex % len];
    const style = cellStyles[styleSrcId];
    if (style) cellStyles[targetId] = style;
    else delete cellStyles[targetId];
  }
}

// Застосовує автозаповнення з src-діапазону в розширений target (рівно один напрям).
function applyAutoFill(src, target) {
  let axis, dir;
  if (target.rMax > src.rMax) { axis = 'v'; dir = 1; }
  else if (target.rMin < src.rMin) { axis = 'v'; dir = -1; }
  else if (target.cMax > src.cMax) { axis = 'h'; dir = 1; }
  else if (target.cMin < src.cMin) { axis = 'h'; dir = -1; }
  else return false;

  if (axis === 'v') {
    const srcRows = dir === 1 ? rangeAsc(src.rMin, src.rMax) : rangeDesc(src.rMax, src.rMin);
    const tgtRows = dir === 1 ? rangeAsc(src.rMax + 1, target.rMax) : rangeDesc(src.rMin - 1, target.rMin);
    for (let c = src.cMin; c <= src.cMax; c++) {
      fillLane(
        srcRows.map(r => cellData[getCellId(c, r)]),
        srcRows.map(r => getCellId(c, r)),
        tgtRows.map(r => getCellId(c, r)),
        srcRows, tgtRows, true
      );
    }
  } else {
    const srcCols = dir === 1 ? rangeAsc(src.cMin, src.cMax) : rangeDesc(src.cMax, src.cMin);
    const tgtCols = dir === 1 ? rangeAsc(src.cMax + 1, target.cMax) : rangeDesc(src.cMin - 1, target.cMin);
    for (let r = src.rMin; r <= src.rMax; r++) {
      fillLane(
        srcCols.map(c => cellData[getCellId(c, r)]),
        srcCols.map(c => getCellId(c, r)),
        tgtCols.map(c => getCellId(c, r)),
        srcCols, tgtCols, false
      );
    }
  }
  return true;
}

function positionFillHandle() {
  if (!gridWrap) return;
  if (!fillHandleEl) {
    fillHandleEl = document.createElement('div');
    fillHandleEl.className = 'fill-handle';
    fillHandleEl.title = 'Перетягни, щоб заповнити';
    fillHandleEl.addEventListener('mousedown', startFill);
    gridWrap.appendChild(fillHandleEl);
  }

  const b = getBounds();
  const td = cellTd[b.rMax]?.[b.cMax];
  if (!td) { fillHandleEl.style.display = 'none'; return; }

  const cellRect = td.getBoundingClientRect();
  const wrapRect = gridWrap.getBoundingClientRect();
  fillHandleEl.style.display = 'block';
  fillHandleEl.style.left = (cellRect.right - wrapRect.left + gridWrap.scrollLeft) + 'px';
  fillHandleEl.style.top = (cellRect.bottom - wrapRect.top + gridWrap.scrollTop) + 'px';
}

function startFill(e) {
  if (e.button !== 0) return;
  e.preventDefault();
  e.stopPropagation();
  const b = getBounds();
  fillSource = { cMin: b.cMin, cMax: b.cMax, rMin: b.rMin, rMax: b.rMax };
  fillTarget = { ...fillSource };
  isFilling = true;
}

function updateFill(c, r) {
  if (!isFilling || !fillSource) return;
  const s = fillSource;
  const vOver = r > s.rMax ? r - s.rMax : (r < s.rMin ? s.rMin - r : 0);
  const hOver = c > s.cMax ? c - s.cMax : (c < s.cMin ? s.cMin - c : 0);

  if (vOver === 0 && hOver === 0) {
    fillTarget = { ...s };
  } else if (vOver >= hOver) {
    fillTarget = {
      cMin: s.cMin, cMax: s.cMax,
      rMin: r < s.rMin ? r : s.rMin,
      rMax: r > s.rMax ? r : s.rMax
    };
  } else {
    fillTarget = {
      rMin: s.rMin, rMax: s.rMax,
      cMin: c < s.cMin ? c : s.cMin,
      cMax: c > s.cMax ? c : s.cMax
    };
  }
  renderFillPreview();
}

function renderFillPreview() {
  for (const td of fillPreviewCells) td.classList.remove('fill-preview');
  fillPreviewCells = [];
  if (!fillTarget || !fillSource) return;

  const t = fillTarget;
  const s = fillSource;
  for (let r = t.rMin; r <= t.rMax; r++) {
    for (let c = t.cMin; c <= t.cMax; c++) {
      if (r >= s.rMin && r <= s.rMax && c >= s.cMin && c <= s.cMax) continue;
      const td = cellTd[r]?.[c];
      if (td) { td.classList.add('fill-preview'); fillPreviewCells.push(td); }
    }
  }
}

function finishFill() {
  if (!isFilling) return;
  isFilling = false;

  for (const td of fillPreviewCells) td.classList.remove('fill-preview');
  fillPreviewCells = [];

  const did = fillTarget && applyAutoFill(fillSource, fillTarget);
  if (did) {
    selStart = { c: fillTarget.cMin, r: fillTarget.rMin };
    selEnd = { c: fillTarget.cMax, r: fillTarget.rMax };
    setActive(active.c, active.r, activeId, { keepSelection: true });
    recalculateAll();
    persistStateToStorage();
    setDirty(true);
    saveToHistory();
    renderSel();
  }

  fillSource = null;
  fillTarget = null;
}
