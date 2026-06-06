// ---- Sorting ----
function compareSortValues(a, b, desc = false) {
  const na = Number(String(a).replace(',', '.'));
  const nb = Number(String(b).replace(',', '.'));
  let result;
  if (Number.isFinite(na) && Number.isFinite(nb)) result = na - nb;
  else result = String(a).localeCompare(String(b), 'uk', { numeric: true, sensitivity: 'base' });
  return desc ? -result : result;
}

function sortSelection(desc = false) {
  const b = getBounds();
  if (b.rMin === b.rMax) {
    showInfoModal('Для сортування виділи кілька рядків.');
    return;
  }

  const rows = [];
  for (let r = b.rMin; r <= b.rMax; r++) {
    const rowData = [];
    const rowStyles = [];
    for (let c = b.cMin; c <= b.cMax; c++) {
      const id = getCellId(c, r);
      rowData.push(cellData[id] ?? '');
      rowStyles.push(cellStyles[id] ?? '');
    }
    const keyValue = cellInp[r]?.[b.cMin]?.value ?? rowData[0] ?? '';
    rows.push({ keyValue, rowData, rowStyles });
  }

  rows.sort((a, b2) => compareSortValues(a.keyValue, b2.keyValue, desc));

  rows.forEach((row, rowOffset) => {
    const r = b.rMin + rowOffset;
    for (let c = b.cMin; c <= b.cMax; c++) {
      const id = getCellId(c, r);
      const idx = c - b.cMin;
      const value = row.rowData[idx];
      const style = row.rowStyles[idx];
      if (value === '') delete cellData[id];
      else cellData[id] = value;
      if (style) cellStyles[id] = style;
      else delete cellStyles[id];
    }
  });

  rebuildGrid();
  recalculateAll();
  persistStateToStorage();
  setSaveBadge();
  saveToHistory();
}

window.TablesSorting = {
  compareSortValues,
  sortSelection
};
