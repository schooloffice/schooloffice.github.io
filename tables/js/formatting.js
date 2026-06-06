// ---- Formatting ----
function applyStyleToSelection(fn) {
  const b = getBounds();
  for (let r = b.rMin; r <= b.rMax; r++) {
    for (let c = b.cMin; c <= b.cMax; c++) {
      const td = cellTd[r]?.[c];
      if (td) {
        fn(td);
        const id = getCellId(c, r);
        const styleStr = extractStyleStringFromTd(td);
        if (styleStr) cellStyles[id] = styleStr;
        else delete cellStyles[id];
      }
    }
  }

  persistStateToStorage();
  setSaveBadge();
  saveToHistory();
}

function toggleStyle(cls) {
  applyStyleToSelection(td => td.classList.toggle(cls));
}

function cycleColor() {
  const colors = ['style-bg-yellow', 'style-bg-green', 'style-bg-red', ''];
  applyStyleToSelection(td => {
    let curr = -1;
    colors.forEach((c, i) => { if (c && td.classList.contains(c)) curr = i; });
    colors.forEach(c => { if (c) td.classList.remove(c); });
    const next = colors[(curr + 1) % colors.length];
    if (next) td.classList.add(next);
  });
}

function autoFitColumns() {
  const b = getBounds();
  const colsToFit = [];
  for (let c = b.cMin; c <= b.cMax; c++) colsToFit.push(c);
  if (colsToFit.length === 0) return;

  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');

  const sampleInput = document.querySelector('.cell-input');
  let font = '700 16px Nunito';
  if (sampleInput) {
    const cs = getComputedStyle(sampleInput);
    font = `${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
  }
  ctx.font = font;

  colsToFit.forEach(cIdx => {
    let maxWidth = 0;

    const th = document.querySelector(`th[data-col="${cIdx}"]`);
    if (th) maxWidth = Math.max(maxWidth, ctx.measureText(th.innerText || '').width);

    for (let r = 1; r <= ROWS; r++) {
      const inp = cellInp[r]?.[cIdx];
      if (!inp) continue;
      const text = String(inp.value || '');
      if (!text) continue;
      maxWidth = Math.max(maxWidth, ctx.measureText(text).width);
    }

    const padding = 32;
    const finalWidth = Math.min(Math.max(80, Math.ceil(maxWidth + padding)), 420);
    colWidths[cIdx] = finalWidth;
  });

  applyColWidths();
  persistStateToStorage();
  setSaveBadge();
  saveToHistory();
}

window.TablesFormatting = {
  applyStyleToSelection,
  autoFitColumns,
  cycleColor,
  toggleStyle
};
