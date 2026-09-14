// ---- Selection actions ----
function deleteSelection() {
  const b = getBounds();
  for (let c = b.cMin; c <= b.cMax; c++) {
    for (let r = b.rMin; r <= b.rMax; r++) {
      const id = getCellId(c, r);
      delete cellData[id];
      const inp = cellInp[r]?.[c];
      if (inp) inp.value = '';
    }
  }

  const fb = document.getElementById('formulaBar');
  if (fb) fb.value = '';

  recalculateAll();
  persistStateToStorage();
  setSaveBadge();
  saveToHistory();
}

function applyFunc(name) {
  recalculateAll();

  const b = getBounds();
  if (b.cMin === b.cMax && b.rMin === b.rMax) {
    showInfoModal('Виділіть більше однієї клітинки!');
    return;
  }

  let tC = b.cMin;
  let tR = b.rMax + 1;
  if (b.rMin === b.rMax && b.cMax > b.cMin) {
    tC = b.cMax + 1;
    tR = b.rMin;
  }

  ensureGridSize(Math.max(ROWS, tR), Math.max(COL_COUNT, tC + 1));

  if (tC >= COL_COUNT || tR > ROWS) {
    showInfoModal('Немає місця для результату.');
    return;
  }

  const range = `${COLS[b.cMin]}${b.rMin}:${COLS[b.cMax]}${b.rMax}`;
  const targetId = getCellId(tC, tR);

  cellData[targetId] = `=${name}(${range})`;

  recalculateAll();
  persistStateToStorage();
  setSaveBadge();
  saveToHistory();

  focusGridCell(tC, tR);
}

// ---- Об'єднання клітинок ----
function commitMergeChange(message) {
  rebuildGrid();
  recalculateAll();
  persistStateToStorage();
  setDirty(true);
  saveToHistory();
  announce(message);
}

function selectionLabel(b) {
  const from = getCellId(b.cMin, b.rMin);
  const to = getCellId(b.cMax, b.rMax);
  return from === to ? from : `${from}:${to}`;
}

function mergeSelection() {
  const b = getBounds();
  const range = [b.cMin, b.rMin, b.cMax, b.rMax];
  if (b.cMin === b.cMax && b.rMin === b.rMax) {
    showInfoModal("Для об'єднання виділіть щонайменше дві клітинки.");
    return false;
  }
  if (sheetMerges.filter(merge => !mergesIntersect(merge, range)).length >= MERGE_MAX_PER_SHEET) {
    showInfoModal(`На аркуші може бути не більше ${MERGE_MAX_PER_SHEET} об'єднань.`);
    return false;
  }
  const anchorId = getCellId(b.cMin, b.rMin);
  const filled = [];
  for (let r = b.rMin; r <= b.rMax; r++) {
    for (let c = b.cMin; c <= b.cMax; c++) {
      const id = getCellId(c, r);
      if (id !== anchorId && String(cellData[id] ?? '') !== '') filled.push(id);
    }
  }
  const apply = () => {
    for (let r = b.rMin; r <= b.rMax; r++) {
      for (let c = b.cMin; c <= b.cMax; c++) {
        const id = getCellId(c, r);
        if (id === anchorId) continue;
        delete cellData[id];
        delete cellStyles[id];
      }
    }
    sheetMerges = mergeBounds(sheetMerges, b);
    selStart = { c: b.cMin, r: b.rMin };
    selEnd = { c: b.cMax, r: b.rMax };
    active = { c: b.cMin, r: b.rMin };
    activeId = anchorId;
    commitMergeChange(`Клітинки ${selectionLabel(b)} об'єднано`);
  };
  if (!filled.length) {
    apply();
    return true;
  }
  // Як у табличних редакторах, лишається значення лівої верхньої клітинки; Undo повертає решту.
  askConfirm(`Після об'єднання ${selectionLabel(b)} лишиться тільки значення лівої верхньої клітинки ${anchorId}. Значення інших заповнених клітинок (${filled.length}) буде видалено — Ctrl+Z поверне їх.`, apply, "Об'єднати");
  return true;
}

function unmergeSelection() {
  const b = getBounds();
  const range = [b.cMin, b.rMin, b.cMax, b.rMax];
  if (!sheetMerges.some(merge => mergesIntersect(merge, range))) {
    showInfoModal("У виділенні немає об'єднаних клітинок.");
    return false;
  }
  sheetMerges = unmergeBounds(sheetMerges, b);
  commitMergeChange(`Клітинки ${selectionLabel(b)} роз'єднано`);
  return true;
}

// Кнопка панелі: виділення рівно з одного об'єднання роз'єднує, інакше — об'єднує.
function toggleMergeSelection() {
  const b = getBounds();
  const exact = sheetMerges.some(merge => merge[0] === b.cMin && merge[1] === b.rMin && merge[2] === b.cMax && merge[3] === b.rMax);
  return exact ? unmergeSelection() : mergeSelection();
}

function listMerges() {
  return JSON.parse(JSON.stringify(sheetMerges));
}

window.TablesSelectionActions = {
  applyFunc,
  deleteSelection,
  listMerges,
  mergeSelection,
  selectionBounds: () => getBounds(),
  toggleMergeSelection,
  unmergeSelection
};
