// ---- Clipboard / paste ----
function copySelectionToClipboard() {
  const tsv = serializeSelectionToTsv();

  if (navigator.clipboard?.writeText) {
    navigator.clipboard.writeText(tsv).catch(() => fallbackCopyText(tsv));
  } else {
    fallbackCopyText(tsv);
  }
}

function serializeSelectionToTsv() {
  const b = getBounds();
  const rows = [];
  for (let r = b.rMin; r <= b.rMax; r++) {
    const cols = [];
    for (let c = b.cMin; c <= b.cMax; c++) {
      const id = getCellId(c, r);
      const raw = cellData[id] ?? '';
      // Copy computed results, not raw formulas.
      let val;
      if (String(raw).startsWith('=')) {
        const inp = cellInp[r]?.[c];
        val = inp ? inp.value : raw;
      } else {
        val = raw;
      }
      cols.push(String(val));
    }
    rows.push(cols.join('\t'));
  }
  return rows.join('\n');
}

function fallbackCopyText(text) {
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.style.position = 'fixed';
  ta.style.left = '-9999px';
  document.body.appendChild(ta);
  ta.select();
  try { document.execCommand('copy'); } catch (_) { }
  ta.remove();
}

function pasteToGrid(text, startC, startR) {
  applyTsvToGridData(text, startC, startR);

  recalculateAll();
  persistStateToStorage();
  setSaveBadge();
  saveToHistory();
}

function applyTsvToGridData(text, startC, startR) {
  const lines = String(text || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
  if (lines.length && lines[lines.length - 1] === '') lines.pop();

  const data = lines.map(line => line.split('\t'));
  const rowCount = data.length;
  const colCount = Math.max(...data.map(r => r.length));

  ensureGridSize(startR + rowCount - 1, startC + colCount);

  for (let rr = 0; rr < rowCount; rr++) {
    for (let cc = 0; cc < data[rr].length; cc++) {
      const r = startR + rr;
      const c = startC + cc;
      if (r < 1 || r > ROWS || c < 0 || c >= COL_COUNT) continue;
      const id = getCellId(c, r);
      cellData[id] = data[rr][cc];
    }
  }
}

window.TablesClipboard = {
  applyTsvToGridData,
  copySelectionToClipboard,
  fallbackCopyText,
  pasteToGrid,
  serializeSelectionToTsv
};
