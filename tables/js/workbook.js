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

// Роздільники, які має сенс шукати у шкільному CSV. Порядок = пріоритет при
// однаковій узгодженості: у локалі з десятковою комою кома частіше є десятковим
// знаком, ніж роздільником полів, тож за нічиєї обираємо крапку з комою.
const CSV_DELIMITERS = [';', '\t', ','];
const CSV_SNIFF_RECORDS = 20;

function stripBom(text) {
  const src = String(text || '');
  return src.charCodeAt(0) === 0xFEFF ? src.slice(1) : src;
}

// Рахує роздільники ПОЗА лапками в перших записах. Старий варіант рахував коми
// й крапки з комою в першому рядку тексту, не дивлячись на лапки: «1,5;2,5»
// перетворювався на три поля 1 / 5;2 / 5 (аудит F12), а кома всередині лапок
// перетягувала вибір на свій бік.
function countDelimitersPerRecord(text, delim, maxRecords) {
  const counts = [];
  let inQuotes = false;
  let current = 0;

  for (let i = 0; i < text.length && counts.length < maxRecords; i++) {
    const ch = text[i];

    if (inQuotes) {
      if (ch !== '"') continue;
      if (text[i + 1] === '"') { i++; continue; }
      inQuotes = false;
      continue;
    }

    if (ch === '"') { inQuotes = true; continue; }
    if (ch === delim) { current++; continue; }

    if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      counts.push(current);
      current = 0;
    }
  }

  if (counts.length < maxRecords) counts.push(current);
  return counts;
}

// Справжній роздільник ділить файл рівно: та сама (і ненульова) кількість полів
// у більшості записів. Повертаємо, у скількох записах ця кількість повторилася.
function scoreDelimiter(counts) {
  const tally = new Map();
  for (const n of counts) {
    if (n > 0) tally.set(n, (tally.get(n) || 0) + 1);
  }

  let consistent = 0;
  for (const times of tally.values()) {
    if (times > consistent) consistent = times;
  }
  return consistent;
}

function detectCSVDelimiter(text) {
  const src = stripBom(text);
  let best = { delim: ',', consistent: 0 };
  for (const delim of CSV_DELIMITERS) {
    const consistent = scoreDelimiter(countDelimitersPerRecord(src, delim, CSV_SNIFF_RECORDS));
    if (consistent > best.consistent) best = { delim, consistent };
  }
  return best.consistent > 0 ? best.delim : ',';
}

function parseCSV(text, delimiter) {
  // BOM додають Excel і Google Sheets; без зняття він приклеювався до першої
  // клітинки і вона переставала збігатися із заголовком.
  const src = stripBom(text);
  const delim = CSV_DELIMITERS.includes(delimiter) ? delimiter : detectCSVDelimiter(src);

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

// ---- Діалог імпорту CSV ----
// Книга змінюється лише після того, як користувач побачив саме ті дані, що
// будуть імпортовані. Роздільник можна перевизначити: визначення за вмістом
// буває неоднозначним — напр. один рядок «1,5;2,5» однаково схожий на два
// числа з десятковою комою і на три поля.
const CSV_MAX_ROWS = 500;
const CSV_MAX_COLS = 200;
const CSV_PREVIEW_ROWS = 5;
const CSV_PREVIEW_COLS = 8;

let csvImportSource = '';

function openCsvImportDialog(text) {
  csvImportSource = String(text || '');
  const select = document.getElementById('csvDelimiterSelect');
  if (select) select.value = detectCSVDelimiter(csvImportSource);
  refreshCsvImportPreview();
  openModal('csvImportModal');
}

function currentCsvDelimiter() {
  const value = document.getElementById('csvDelimiterSelect')?.value;
  return CSV_DELIMITERS.includes(value) ? value : detectCSVDelimiter(csvImportSource);
}

function parsedCsvRows() {
  return parseCSV(csvImportSource, currentCsvDelimiter());
}

function csvImportProblem(rowCount, colCount) {
  if (!rowCount) return 'З таким роздільником у файлі не видно даних. Спробуйте інший.';
  if (rowCount > CSV_MAX_ROWS) return `Файл має ${rowCount} рядків — це забагато (максимум ${CSV_MAX_ROWS}).`;
  if (colCount > CSV_MAX_COLS) return `Файл має ${colCount} колонок — це забагато (максимум ${CSV_MAX_COLS}).`;
  return '';
}

function refreshCsvImportPreview() {
  const rows = parsedCsvRows();
  const cols = rows.reduce((m, r) => Math.max(m, r.length), 0);
  const problem = csvImportProblem(rows.length, cols);

  const summary = document.getElementById('csvImportSummary');
  if (summary) {
    summary.innerText = problem
      || `Буде імпортовано ${rows.length}×${cols}. Поточну таблицю буде перезаписано.`;
  }

  const confirmBtn = document.getElementById('csvImportConfirm');
  if (confirmBtn) confirmBtn.disabled = !!problem;

  const host = document.getElementById('csvImportPreview');
  if (!host) return;
  host.replaceChildren();

  const table = document.createElement('table');
  const shownCols = Math.min(cols, CSV_PREVIEW_COLS);
  for (const row of rows.slice(0, CSV_PREVIEW_ROWS)) {
    const tr = document.createElement('tr');
    for (let c = 0; c < shownCols; c++) {
      const td = document.createElement('td');
      td.textContent = row[c] ?? '';
      tr.appendChild(td);
    }
    table.appendChild(tr);
  }
  host.appendChild(table);
}

function confirmCsvImport() {
  const rows = parsedCsvRows();
  const cols = rows.reduce((m, r) => Math.max(m, r.length), 0);
  if (csvImportProblem(rows.length, cols)) return;

  closeModal('csvImportModal');
  importCSVRows(rows);
  csvImportSource = '';
}

function importCSVText(text, delimiter) {
  importCSVRows(parseCSV(text, delimiter));
}

function importCSVRows(parsedRows) {
  // Зберігаємо поточний стан ДО перезапису — щоб undo міг відновити
  saveToHistory();

  const rows = Array.isArray(parsedRows) ? parsedRows : [];
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
    'C7': 'СЕРЕДНЄ:', 'D7': '=AVERAGE(D2:D5)'
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
  sheets = [makeSheet('Аркуш1')];
  activeSheet = 0;
  rowFilter = null;
  loadGlobalsFromSheet(0);
  persistStateToStorage();
  rebuildGrid();
  recalculateAll();
  renderSheetTabs();
  setSaveBadge();
  saveToHistory();
}
