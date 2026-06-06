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

  const inp = cellInp[tR]?.[tC];
  if (inp) inp.focus();
}

window.TablesSelectionActions = {
  applyFunc,
  deleteSelection
};
