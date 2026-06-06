// ---- Insert rows/cols ----
function getWholeRowSelectionRange() {
  const b = getBounds();
  return (b.cMin === 0 && b.cMax === COL_COUNT - 1) ? { start: b.rMin, end: b.rMax } : null;
}

function getWholeColSelectionRange() {
  const b = getBounds();
  return (b.rMin === 1 && b.rMax === ROWS) ? { start: b.cMin, end: b.cMax } : null;
}

function finishStructureChange() {
  rebuildGrid();
  recalculateAll();
  persistStateToStorage();
  initFileNameUi();
  initMenusAndToolbar();
  restoreUiState();
  setSaveBadge();
  saveToHistory();
}

function insertRow(atRow, count = 1) {
  const rowAt = clamp(atRow, 1, ROWS + 1);
  const amount = Math.max(1, Number(count) || 1);

  const newData = {};
  const newStyles = {};

  for (const key of Object.keys(cellData)) {
    const p = parseCellId(key);
    if (!p) continue;
    const newR = (p.r >= rowAt) ? (p.r + amount) : p.r;
    newData[`${p.col}${newR}`] = cellData[key];
  }

  for (const key of Object.keys(cellStyles)) {
    const p = parseCellId(key);
    if (!p) continue;
    const newR = (p.r >= rowAt) ? (p.r + amount) : p.r;
    newStyles[`${p.col}${newR}`] = cellStyles[key];
  }

  for (const k of Object.keys(newData)) {
    const v = newData[k];
    if (String(v || '').startsWith('=')) newData[k] = shiftFormulaRefs(v, { rowAt, rowDelta: amount });
  }

  if (active.r >= rowAt) active.r += amount;
  if (selStart.r >= rowAt) selStart.r += amount;
  if (selEnd.r >= rowAt) selEnd.r += amount;

  cellData = newData;
  cellStyles = newStyles;
  setGridSize(ROWS + amount, COL_COUNT);
  finishStructureChange();
}

function deleteRow(atRow, count = 1) {
  if (ROWS <= 1) {
    showInfoModal('Не можна видалити останній рядок.');
    return;
  }

  const rowAt = clamp(atRow, 1, ROWS);
  const amount = Math.max(1, Math.min(Number(count) || 1, ROWS - rowAt + 1));
  if (amount >= ROWS) {
    showInfoModal('Не можна видалити всі рядки.');
    return;
  }

  const deleteFrom = rowAt;
  const deleteTo = rowAt + amount - 1;
  const newData = {};
  const newStyles = {};

  for (const key of Object.keys(cellData)) {
    const p = parseCellId(key);
    if (!p) continue;
    if (p.r >= deleteFrom && p.r <= deleteTo) continue;
    const newR = p.r > deleteTo ? (p.r - amount) : p.r;
    newData[`${p.col}${newR}`] = cellData[key];
  }

  for (const key of Object.keys(cellStyles)) {
    const p = parseCellId(key);
    if (!p) continue;
    if (p.r >= deleteFrom && p.r <= deleteTo) continue;
    const newR = p.r > deleteTo ? (p.r - amount) : p.r;
    newStyles[`${p.col}${newR}`] = cellStyles[key];
  }

  for (const k of Object.keys(newData)) {
    const v = newData[k];
    if (String(v || '').startsWith('=')) newData[k] = shiftFormulaRefs(v, { rowAt: deleteFrom, rowDelta: -amount });
  }

  active.r = clamp(active.r > deleteTo ? active.r - amount : active.r, 1, ROWS - amount);
  selStart.r = clamp(selStart.r > deleteTo ? selStart.r - amount : selStart.r, 1, ROWS - amount);
  selEnd.r = clamp(selEnd.r > deleteTo ? selEnd.r - amount : selEnd.r, 1, ROWS - amount);

  cellData = newData;
  cellStyles = newStyles;
  setGridSize(ROWS - amount, COL_COUNT);
  finishStructureChange();
}

function insertColumn(atCol, count = 1) {
  const colAt = clamp(atCol, 0, COL_COUNT);
  const amount = Math.max(1, Number(count) || 1);

  const newData = {};
  const newStyles = {};

  for (const key of Object.keys(cellData)) {
    const p = parseCellId(key);
    if (!p) continue;
    const newC = (p.cIdx >= colAt) ? (p.cIdx + amount) : p.cIdx;
    newData[`${indexToCol(newC)}${p.r}`] = cellData[key];
  }

  for (const key of Object.keys(cellStyles)) {
    const p = parseCellId(key);
    if (!p) continue;
    const newC = (p.cIdx >= colAt) ? (p.cIdx + amount) : p.cIdx;
    newStyles[`${indexToCol(newC)}${p.r}`] = cellStyles[key];
  }

  const newWidths = {};
  for (const k of Object.keys(colWidths)) {
    const idx = parseInt(k, 10);
    if (!Number.isFinite(idx)) continue;
    const newIdx = (idx >= colAt) ? (idx + amount) : idx;
    newWidths[newIdx] = colWidths[k];
  }
  for (let i = 0; i < amount; i++) newWidths[colAt + i] = newWidths[colAt + i] || 80;
  colWidths = newWidths;

  for (const k of Object.keys(newData)) {
    const v = newData[k];
    if (String(v || '').startsWith('=')) newData[k] = shiftFormulaRefs(v, { colAt, colDelta: amount });
  }

  if (active.c >= colAt) active.c += amount;
  if (selStart.c >= colAt) selStart.c += amount;
  if (selEnd.c >= colAt) selEnd.c += amount;

  cellData = newData;
  cellStyles = newStyles;
  setGridSize(ROWS, COL_COUNT + amount);
  finishStructureChange();
}

function deleteColumn(atCol, count = 1) {
  if (COL_COUNT <= 1) {
    showInfoModal('Не можна видалити останню колонку.');
    return;
  }

  const colAt = clamp(atCol, 0, COL_COUNT - 1);
  const amount = Math.max(1, Math.min(Number(count) || 1, COL_COUNT - colAt));
  if (amount >= COL_COUNT) {
    showInfoModal('Не можна видалити всі колонки.');
    return;
  }

  const deleteFrom = colAt;
  const deleteTo = colAt + amount - 1;
  const newData = {};
  const newStyles = {};

  for (const key of Object.keys(cellData)) {
    const p = parseCellId(key);
    if (!p) continue;
    if (p.cIdx >= deleteFrom && p.cIdx <= deleteTo) continue;
    const newC = p.cIdx > deleteTo ? (p.cIdx - amount) : p.cIdx;
    newData[`${indexToCol(newC)}${p.r}`] = cellData[key];
  }

  for (const key of Object.keys(cellStyles)) {
    const p = parseCellId(key);
    if (!p) continue;
    if (p.cIdx >= deleteFrom && p.cIdx <= deleteTo) continue;
    const newC = p.cIdx > deleteTo ? (p.cIdx - amount) : p.cIdx;
    newStyles[`${indexToCol(newC)}${p.r}`] = cellStyles[key];
  }

  const newWidths = {};
  for (const k of Object.keys(colWidths)) {
    const idx = parseInt(k, 10);
    if (!Number.isFinite(idx)) continue;
    if (idx >= deleteFrom && idx <= deleteTo) continue;
    const newIdx = idx > deleteTo ? (idx - amount) : idx;
    newWidths[newIdx] = colWidths[k];
  }
  colWidths = newWidths;

  for (const k of Object.keys(newData)) {
    const v = newData[k];
    if (String(v || '').startsWith('=')) newData[k] = shiftFormulaRefs(v, { colAt: deleteFrom, colDelta: -amount });
  }

  active.c = clamp(active.c > deleteTo ? active.c - amount : active.c, 0, COL_COUNT - amount - 1);
  selStart.c = clamp(selStart.c > deleteTo ? selStart.c - amount : selStart.c, 0, COL_COUNT - amount - 1);
  selEnd.c = clamp(selEnd.c > deleteTo ? selEnd.c - amount : selEnd.c, 0, COL_COUNT - amount - 1);

  cellData = newData;
  cellStyles = newStyles;
  setGridSize(ROWS, COL_COUNT - amount);
  finishStructureChange();
}

function updateInsertHover(e) {
  if (!gridWrap || !insertColBtn || !insertRowBtn) return;
  if (isResizing || isSelecting) return hideInsertButtons();

  const wrapRect = gridWrap.getBoundingClientRect();
  const x = e.clientX - wrapRect.left;
  const y = e.clientY - wrapRect.top;
  const contentX = x + gridWrap.scrollLeft;
  const contentY = y + gridWrap.scrollTop;
  const tol = 6;
  const btnSize = 24;

  let sumX = metrics.rowHeaderW;
  const colBounds = [sumX];
  for (let c = 0; c < COL_COUNT; c++) {
    sumX += (colWidths[c] || 80);
    colBounds.push(sumX);
  }

  let sumY = metrics.headerH;
  const rowBounds = [sumY];
  for (let r = 1; r <= ROWS; r++) {
    sumY += metrics.rowH;
    rowBounds.push(sumY);
  }

  hoverInsertColAt = null;
  hoverInsertRowAt = null;

  if (contentY <= metrics.headerH + 2 && contentX > metrics.rowHeaderW + 6) {
    let bestIdx = null;
    let bestDist = 1e9;
    for (let i = 0; i < colBounds.length; i++) {
      const d = Math.abs(contentX - colBounds[i]);
      if (d < bestDist) { bestDist = d; bestIdx = i; }
    }
    if (bestIdx !== null && bestDist <= tol) {
      hoverInsertColAt = bestIdx;
      insertColBtn.style.left = `${colBounds[bestIdx] - gridWrap.scrollLeft - btnSize / 2}px`;
      insertColBtn.style.top = `${Math.max(4, Math.round((metrics.headerH - btnSize) / 2))}px`;
      insertColBtn.classList.remove('hidden');
    } else {
      insertColBtn.classList.add('hidden');
    }
  } else {
    insertColBtn.classList.add('hidden');
  }

  if (contentX <= metrics.rowHeaderW + 8 && contentY > metrics.headerH + 2) {
    let bestIdx = null;
    let bestDist = 1e9;
    for (let i = 0; i < rowBounds.length; i++) {
      const d = Math.abs(contentY - rowBounds[i]);
      if (d < bestDist) { bestDist = d; bestIdx = i; }
    }
    if (bestIdx !== null && bestDist <= tol) {
      hoverInsertRowAt = bestIdx + 1;
      insertRowBtn.style.left = `${Math.max(4, Math.round((metrics.rowHeaderW - btnSize) / 2))}px`;
      insertRowBtn.style.top = `${rowBounds[bestIdx] - gridWrap.scrollTop - btnSize / 2}px`;
      insertRowBtn.classList.remove('hidden');
    } else {
      insertRowBtn.classList.add('hidden');
    }
  } else {
    insertRowBtn.classList.add('hidden');
  }

  if (insertColBtn.classList.contains('hidden') && insertRowBtn.classList.contains('hidden')) {
    hoverInsertColAt = null;
    hoverInsertRowAt = null;
  }
}

function hideInsertButtons() {
  hoverInsertColAt = null;
  hoverInsertRowAt = null;
  if (insertColBtn) insertColBtn.classList.add('hidden');
  if (insertRowBtn) insertRowBtn.classList.add('hidden');
}

window.TablesStructure = {
  deleteColumn,
  deleteRow,
  finishStructureChange,
  getWholeColSelectionRange,
  getWholeRowSelectionRange,
  hideInsertButtons,
  insertColumn,
  insertRow,
  updateInsertHover
};
