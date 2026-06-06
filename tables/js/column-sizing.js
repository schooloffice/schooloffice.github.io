// ---- Column sizing ----
function startResize(e, colIdx) {
  e.preventDefault();
  e.stopPropagation();
  isResizing = true;
  resizeCol = {
    idx: colIdx,
    startX: e.clientX,
    startWidth: colWidths[colIdx] || 80
  };
}

function resizeColumn(e) {
  if (!resizeCol) return;
  const diff = e.clientX - resizeCol.startX;
  const newWidth = Math.max(50, resizeCol.startWidth + diff);
  colWidths[resizeCol.idx] = newWidth;
  applyColWidths();
  persistStateToStorage();
  setSaveBadge();
}

function applyColWidths() {
  for (let c = 0; c < COL_COUNT; c++) {
    const width = colWidths[c] || 80;
    const colEl = colEls[c + 1];
    if (colEl) colEl.style.width = width + 'px';
  }
}

window.TablesColumnSizing = {
  applyColWidths,
  resizeColumn,
  startResize
};
