// ---- CSV ----
function exportCSV() {
  const b = getBounds();
  const multi = (b.cMin !== b.cMax) || (b.rMin !== b.rMax);

  // used range
  let cMax = 0;
  let rMax = 1;

  if (!multi) {
    for (const key of Object.keys(cellData)) {
      const p = parseCellId(key);
      if (!p) continue;
      if (cellData[key] === undefined || cellData[key] === null || cellData[key] === '') continue;
      cMax = Math.max(cMax, p.cIdx);
      rMax = Math.max(rMax, p.r);
    }
    cMax = Math.max(cMax, 0);
    rMax = Math.max(rMax, 1);
  }

  const out = [];
  const delim = ';'; // зручно для Excel (UA)

  const fromC = multi ? b.cMin : 0;
  const toC   = multi ? b.cMax : Math.min(cMax, COL_COUNT - 1);
  const fromR = multi ? b.rMin : 1;
  const toR   = multi ? b.rMax : Math.min(rMax, ROWS);

  for (let r = fromR; r <= toR; r++) {
    const row = [];
    for (let c = fromC; c <= toC; c++) {
      const id = getCellId(c, r);
      const raw = cellData[id] ?? '';
      // Експортуємо обчислене значення, а не формулу
      let val;
      if (String(raw).startsWith('=')) {
        const inp = cellInp[r]?.[c];
        val = inp ? inp.value : raw; // обчислений результат з DOM
      } else {
        val = raw;
      }
      row.push(escapeCSV(String(val ?? ''), delim));
    }
    out.push(row.join(delim));
  }

  const csv = out.join('\r\n');
  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8' }); // BOM для Excel
  const url = URL.createObjectURL(blob);

  const a = document.createElement('a');
  const dt = new Date();
  const stamp = dt.toISOString().slice(0, 19).replace(/[:T]/g, '-');
  a.href = url;
  a.download = `${normalizeFileName(workbookName)}_${stamp}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 500);
}

function escapeCSV(val, delim) {
  const s = String(val ?? '');
  if (s.includes('"')) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  if (s.includes(delim) || s.includes('\n') || s.includes('\r')) {
    return '"' + s + '"';
  }
  return s;
}

function triggerCSVImport() {
  const inp = document.getElementById('csvFileInput');
  if (!inp) return;
  inp.value = '';
  inp.click();
}

function parseCSV(text) {
  const src = String(text || '');
  const firstLine = src.split(/\r\n|\n|\r/)[0] || '';
  const commaCount = (firstLine.match(/,/g) || []).length;
  const semiCount = (firstLine.match(/;/g) || []).length;
  const delim = semiCount > commaCount ? ';' : ',';

  const rows = [];
  let row = [];
  let cur = '';
  let inQuotes = false;

  for (let i = 0; i < src.length; i++) {
    const ch = src[i];

    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          cur += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        cur += ch;
      }
      continue;
    }

    if (ch === '"') {
      inQuotes = true;
      continue;
    }

    if (ch === delim) {
      row.push(cur);
      cur = '';
      continue;
    }

    if (ch === '\n') {
      row.push(cur);
      rows.push(row);
      row = [];
      cur = '';
      continue;
    }

    if (ch === '\r') {
      // handle CRLF
      if (src[i + 1] === '\n') i++;
      row.push(cur);
      rows.push(row);
      row = [];
      cur = '';
      continue;
    }

    cur += ch;
  }

  row.push(cur);
  rows.push(row);

  // trim trailing empty rows
  while (rows.length && rows[rows.length - 1].every(v => v === '')) rows.pop();
  return rows;
}

function importCSVText(text) {
  // Зберігаємо поточний стан ДО перезапису — щоб undo міг відновити
  saveToHistory();

  const rows = parseCSV(text);
  const maxCols = rows.reduce((m, r) => Math.max(m, r.length), 0);
  const needRows = rows.length;

  ensureGridSize(Math.max(ROWS, needRows), Math.max(COL_COUNT, maxCols));

  // overwrite
  cellData = {};
  cellStyles = {};

  for (let r = 0; r < rows.length; r++) {
    for (let c = 0; c < rows[r].length; c++) {
      const id = getCellId(c, r + 1);
      const v = rows[r][c];
      if (v !== '') cellData[id] = v;
    }
  }

  rebuildGrid();
  recalculateAll();
  persistStateToStorage();
  initFileNameUi();
  initMenusAndToolbar();
  restoreUiState();
  setSaveBadge();
  saveToHistory();
}

// ---- Data utilities ----
function loadExample() {
  cellData = {
    'A1': 'Товар', 'B1': 'Ціна', 'C1': 'Кількість', 'D1': 'Разом',
    'A2': 'Ручка', 'B2': '15', 'C2': '2', 'D2': '=B2*C2',
    'A3': 'Зошит', 'B3': '10', 'C3': '5', 'D3': '=B3*C3',
    'A4': 'Гумка', 'B4': '5', 'C4': '1', 'D4': '=B4*C4',
    'A5': 'Олівець', 'B5': '8', 'C5': '3', 'D5': '=B5*C5',
    'C6': 'СУМА:', 'D6': '=SUM(D2:D5)',
    'C7': 'СЕРЕДНЄ:', 'D7': '=AVG(D2:D5)'
  };

  cellStyles = {};
  ensureGridSize(60, 30);
  rebuildGrid();
  recalculateAll();
  persistStateToStorage();
  initFileNameUi();
  initMenusAndToolbar();
  restoreUiState();
  setSaveBadge();
  saveToHistory();
  showInfoModal('Приклад завантажено! Спробуйте змінити кількість або додати нові товари.');
}

function clearAll() {
  cellData = {};
  cellStyles = {};
  colWidths = {};
  persistStateToStorage();
  rebuildGrid();
  recalculateAll();
  setSaveBadge();
  saveToHistory();
}
