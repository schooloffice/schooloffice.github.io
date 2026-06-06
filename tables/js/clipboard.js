// ---- Clipboard / paste ----
// Внутрішній буфер тримає СИРІ значення (включно з формулами) і походження
// виділення. В ОС-буфер пишемо обчислені значення (зручно для зовнішніх програм).
// При вставці, якщо текст збігається з нашим буфером, відновлюємо формули зі
// зсувом відносних посилань; інакше — звичайна вставка тексту.
let internalClipboard = null;   // { startC, startR, cells: string[][] }
let internalClipboardKey = '';  // нормалізований TSV, записаний в ОС-буфер при копіюванні

function normalizeTsv(text) {
  return String(text || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n').replace(/\n+$/, '');
}

function copySelectionToClipboard() {
  const b = getBounds();
  const cells = [];
  for (let r = b.rMin; r <= b.rMax; r++) {
    const row = [];
    for (let c = b.cMin; c <= b.cMax; c++) {
      row.push(String(cellData[getCellId(c, r)] ?? ''));
    }
    cells.push(row);
  }
  internalClipboard = { startC: b.cMin, startR: b.rMin, cells };

  const tsv = serializeSelectionToTsv();
  internalClipboardKey = normalizeTsv(tsv);

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

// Чи збігається текст для вставки з нашим внутрішнім буфером (копіювали в застосунку).
function isInternalPaste(text) {
  return internalClipboard !== null
    && internalClipboardKey !== ''
    && normalizeTsv(text) === internalClipboardKey;
}

function pasteToGrid(text, startC, startR) {
  applyTsvToGridData(text, startC, startR);

  recalculateAll();
  persistStateToStorage();
  setSaveBadge();
  saveToHistory();
}

function applyTsvToGridData(text, startC, startR) {
  if (isInternalPaste(text)) {
    applyInternalClipboard(startC, startR);
    return;
  }

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
      cellData[getCellId(c, r)] = data[rr][cc];
    }
  }
}

// Внутрішня вставка: відновлюємо формули зі зсувом відносних посилань.
function applyInternalClipboard(startC, startR) {
  const clip = internalClipboard;
  const rowDelta = startR - clip.startR;
  const colDelta = startC - clip.startC;
  const rowCount = clip.cells.length;
  const colCount = Math.max(...clip.cells.map(r => r.length));

  ensureGridSize(startR + rowCount - 1, startC + colCount);

  for (let rr = 0; rr < rowCount; rr++) {
    const cols = clip.cells[rr];
    for (let cc = 0; cc < cols.length; cc++) {
      const r = startR + rr;
      const c = startC + cc;
      if (r < 1 || r > ROWS || c < 0 || c >= COL_COUNT) continue;
      const raw = cols[cc];
      cellData[getCellId(c, r)] = String(raw).startsWith('=')
        ? offsetFormulaRefs(raw, rowDelta, colDelta)
        : raw;
    }
  }
}

window.TablesClipboard = {
  applyTsvToGridData,
  copySelectionToClipboard,
  fallbackCopyText,
  isInternalPaste,
  pasteToGrid,
  serializeSelectionToTsv
};
