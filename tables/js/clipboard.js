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

// Якщо передано clipboardData з нативної події copy/cut, пишемо в нього (без дозволу
// navigator.clipboard); інакше — navigator.clipboard з запасним варіантом.
function copySelectionToClipboard(clipboardData) {
  const b = getBounds();
  const cells = [];
  for (let r = b.rMin; r <= b.rMax; r++) {
    const row = [];
    for (let c = b.cMin; c <= b.cMax; c++) {
      row.push(String(cellData[getCellId(c, r)] ?? ''));
    }
    cells.push(row);
  }
  // Об'єднання всередині виділення копіюються відносно його лівого верхнього кута.
  const merges = sheetMerges
    .filter(merge => merge[0] >= b.cMin && merge[2] <= b.cMax && merge[1] >= b.rMin && merge[3] <= b.rMax)
    .map(merge => [merge[0] - b.cMin, merge[1] - b.rMin, merge[2] - b.cMin, merge[3] - b.rMin]);
  internalClipboard = { startC: b.cMin, startR: b.rMin, cells, merges };

  const tsv = serializeSelectionToTsv();
  internalClipboardKey = normalizeTsv(tsv);

  if (clipboardData?.setData) {
    clipboardData.setData('text/plain', tsv);
  } else if (navigator.clipboard?.writeText) {
    navigator.clipboard.writeText(tsv).catch(() => fallbackCopyText(tsv));
  } else {
    fallbackCopyText(tsv);
  }
}

// Нативні події copy/cut: клітинки (не текст усередині клітинки чи іншого поля).
function isCellClipboardTarget() {
  const el = document.activeElement;
  if (!el || el === document.body || !(el.tagName === 'INPUT' || el.tagName === 'TEXTAREA')) return true;
  if (!el.classList.contains('cell-input')) return false;
  return el.selectionStart === el.selectionEnd;
}

function handleNativeClipboardEvent(e, cut) {
  if (e.defaultPrevented || !isCellClipboardTarget()) return;
  e.preventDefault();
  copySelectionToClipboard(e.clipboardData);
  if (cut) deleteSelection();
  nativeClipboardHandled = true;
}

// Меню: execCommand запускає ту саму нативну подію; navigator.clipboard — лише запасний шлях.
let nativeClipboardHandled = false;
function runClipboardCommand(kind) {
  nativeClipboardHandled = false;
  try { document.execCommand(kind); } catch (_) { /* запасний шлях нижче */ }
  if (nativeClipboardHandled) return;
  copySelectionToClipboard();
  if (kind === 'cut') deleteSelection();
}

function initNativeClipboard() {
  document.addEventListener('copy', e => handleNativeClipboardEvent(e, false));
  document.addEventListener('cut', e => handleNativeClipboardEvent(e, true));
  // Вставка поза клітинкою (у клітинках працює її власний обробник paste).
  document.addEventListener('paste', e => {
    if (e.defaultPrevented) return;
    const el = document.activeElement;
    if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA')) return;
    const text = e.clipboardData?.getData('text/plain');
    if (!text) return;
    e.preventDefault();
    pasteToGrid(text, active.c, active.r);
  });
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
  const mergesBefore = JSON.stringify(sheetMerges);
  applyTsvToGridData(text, startC, startR);
  if (JSON.stringify(sheetMerges) !== mergesBefore) rebuildGrid();

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
      // Приховані клітинки об'єднань лишаються порожніми.
      if (r < 1 || r > ROWS || c < 0 || c >= COL_COUNT || isMergeCovered(sheetMerges, c, r)) continue;
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

  // Вставлений діапазон замінює об'єднання, які зачіпає, скопійованими.
  const area = [startC, startR, startC + colCount - 1, startR + rowCount - 1];
  const pastedMerges = (clip.merges || [])
    .map(merge => [merge[0] + startC, merge[1] + startR, merge[2] + startC, merge[3] + startR])
    .filter(merge => merge[2] < COL_COUNT && merge[3] <= ROWS);
  if (pastedMerges.length || sheetMerges.some(merge => mergesIntersect(merge, area))) {
    sheetMerges = [...sheetMerges.filter(merge => !mergesIntersect(merge, area)), ...pastedMerges];
  }

  for (let rr = 0; rr < rowCount; rr++) {
    const cols = clip.cells[rr];
    for (let cc = 0; cc < cols.length; cc++) {
      const r = startR + rr;
      const c = startC + cc;
      if (r < 1 || r > ROWS || c < 0 || c >= COL_COUNT || isMergeCovered(sheetMerges, c, r)) continue;
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
  initNativeClipboard,
  isInternalPaste,
  pasteToGrid,
  runClipboardCommand,
  serializeSelectionToTsv
};
