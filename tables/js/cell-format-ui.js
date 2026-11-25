// ---- Cell formatting UI / status ----
function replaceStyleGroup(classes, nextClass = '') {
  applyStyleToSelection(td => {
    classes.forEach(cls => td.classList.remove(cls));
    if (nextClass) td.classList.add(nextClass);
  });
  closeAllPalettes();
  updateToolbarState();
}

function applyTextColorClass(cls) { replaceStyleGroup(TEXT_COLOR_CLASSES.concat(['style-text-default']), cls); }
function clearTextColorStyles() { replaceStyleGroup(TEXT_COLOR_CLASSES.concat(['style-text-default']), ''); }
function applyFillColorClass(cls) { replaceStyleGroup(FILL_COLOR_CLASSES, cls); }
function clearFillStyles() { replaceStyleGroup(FILL_COLOR_CLASSES, ''); }
function applyAlignmentClass(cls) { replaceStyleGroup(ALIGN_CLASSES, cls); }

// Формат числа лише змінює показ: cellData і формули не чіпаємо. Усе виділення — один крок історії.
function applyNumberFormatToken(token) {
  const nf = window.TablesNumberFormat;
  const next = nf?.isToken(token) ? token : '';
  applyStyleToSelection(td => {
    Array.from(td.classList).filter(cls => NUMBER_FORMAT_CLASSES.includes(cls) || nf?.isToken(cls)).forEach(cls => td.classList.remove(cls));
    if (next) td.classList.add(next);
  });
  closeAllPalettes();
  recalculateAll();
  updateToolbarState();
}

// Значення панелі: '' — Загальний, токен формату, '__more' — відкрити діалог.
function applyNumberFormat(value) {
  const v = String(value || '');
  if (v === '__more') { openCellFormatDialog(); updateToolbarState(); return; }
  if (v === '__custom') { updateToolbarState(); return; }
  applyNumberFormatToken(window.TablesNumberFormat?.LEGACY_TOKENS[v] || v);
}

function applyToggleClass(cls) {
  applyStyleToSelection(td => td.classList.toggle(cls));
  updateToolbarState();
}

function formatDisplayValue(value, td) {
  const raw = String(value ?? '');
  if (raw.trim() === '') return '';

  const classes = td?.classList;
  const nf = window.TablesNumberFormat;
  const ownToken = nf && classes ? Array.from(classes).find(cls => nf.isToken(cls)) : '';
  if (ownToken) return nf.format(nf.parseToken(ownToken), value);
  const normalized = raw.replace(',', '.');
  const num = Number(normalized);
  const isNumeric = Number.isFinite(num) && normalized !== '';
  if (!isNumeric) return raw;

  if (classes?.contains('style-num-int')) return String(Math.round(num));
  if (classes?.contains('style-num-fixed2')) return num.toLocaleString('uk-UA', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (classes?.contains('style-num-percent')) return `${(num * 100).toLocaleString('uk-UA', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}%`;
  if (classes?.contains('style-num-currency-uah')) return num.toLocaleString('uk-UA', { style: 'currency', currency: 'UAH', maximumFractionDigits: 2 });
  if (classes?.contains('style-num-date')) return serialToDateString(num, false);
  if (classes?.contains('style-num-datetime')) return serialToDateString(num, true);
  return raw;
}

function getSelectionStats() {
  const b = getBounds();
  let count = 0;
  let countNumbers = 0;
  let sum = 0;
  let min = Infinity;
  let max = -Infinity;

  for (let r = b.rMin; r <= b.rMax; r++) {
    for (let c = b.cMin; c <= b.cMax; c++) {
      const id = getCellId(c, r);
      const raw = cellData[id] ?? '';
      const trimmed = String(raw).trim();
      if (trimmed === '') continue;
      count++;

      let num = NaN;
      if (trimmed.startsWith('=')) {
        try {
          num = Number(evaluateFormula(trimmed.substring(1)));
        } catch (_) {
          num = NaN;
        }
      } else {
        num = Number(trimmed.replace(',', '.'));
      }

      if (Number.isFinite(num)) {
        countNumbers++;
        sum += num;
        min = Math.min(min, num);
        max = Math.max(max, num);
      }
    }
  }

  return {
    count,
    countNumbers,
    sum,
    avg: countNumbers ? sum / countNumbers : 0,
    min: countNumbers ? min : 0,
    max: countNumbers ? max : 0
  };
}

function updateSelectionStats() {
  const b = getBounds();
  const selectionInfo = document.getElementById('selectionInfo');
  const statsInfo = document.getElementById('statsInfo');
  if (selectionInfo) {
    const from = `${COLS[b.cMin]}${b.rMin}`;
    const to = `${COLS[b.cMax]}${b.rMax}`;
    selectionInfo.textContent = from === to ? `Виділення: ${from}` : `Виділення: ${from}:${to}`;
  }
  if (statsInfo) {
    const s = getSelectionStats();
    statsInfo.textContent = `Кількість: ${s.count} · Чисел: ${s.countNumbers} · Сума: ${Number(s.sum.toFixed(2)).toLocaleString('uk-UA')} · Середнє: ${Number(s.avg.toFixed(2)).toLocaleString('uk-UA')}`;
  }
}

function updateToolbarState() {
  const td = cellTd[active.r]?.[active.c];
  if (!td) return;
  const setPressed = (action, pressed) => {
    const selector = `[data-action="${action}"]`;
    if (window.OfficeUI?.setPressed) {
      window.OfficeUI.setPressed(selector, pressed);
      return;
    }
    document.querySelectorAll(selector).forEach(btn => {
      btn.classList.toggle('active', pressed);
      btn.setAttribute('aria-pressed', String(pressed));
    });
  };
  setPressed('style-bold', td.classList.contains('style-text-bold'));
  setPressed('style-italic', td.classList.contains('style-text-italic'));
  setPressed('style-underline', td.classList.contains('style-text-underline'));
  setPressed('style-strike', td.classList.contains('style-text-strike'));
  setPressed('align-left', td.classList.contains('style-align-left'));
  setPressed('align-center', !td.classList.contains('style-align-left') && !td.classList.contains('style-align-right') || td.classList.contains('style-align-center'));
  setPressed('align-right', td.classList.contains('style-align-right'));
  setPressed('merge-toggle', !!mergeAt(sheetMerges, active.c, active.r));
  const fmt = document.getElementById('numberFormatSelect');
  if (fmt) {
    const token = window.TablesNumberFormat?.tokenFromClasses(td.classList) || '';
    fmt.value = token;
    if (fmt.value !== token) fmt.value = '__custom';
  }
  updateUndoRedoButtons();
}

// ---- Діалог «Формат клітинок…» ----
const CELL_FORMAT_NOTES = {
  general: 'Загальний формат показує значення так, як воно введене.',
  number: 'Число з обраною кількістю знаків після коми; можна розділяти тисячі пропуском.',
  currency: 'Число з символом валюти після значення, тисячі розділено пропуском.',
  percent: 'Значення множиться на 100 і показується зі знаком %. Число 0,25 стане 25 %.',
  date: 'Дата зберігається числом (кількість днів від 30.12.1899) — змінюється лише показ.',
  time: 'Час зберігається як частка доби — змінюється лише показ.',
  fraction: 'Дріб до однієї або двох цифр у знаменнику. Число 1,5 стане 1 1/2.',
  scientific: 'Число у вигляді мантиси та степеня десяти: 12345 стане 1,23E+04.',
  text: 'Значення показується точно так, як введене (наприклад, 007 лишається 007).'
};
// Які рядки параметрів потрібні для категорії.
const CELL_FORMAT_ROWS = {
  decimals: ['number', 'currency', 'percent', 'scientific'],
  thousands: ['number'],
  currency: ['currency'],
  date: ['date'],
  time: ['time'],
  fraction: ['fraction']
};
let cellFormatSelectionLabel = '';

function cellFormatEl(id) { return document.getElementById(id); }

function readCellFormatSpec() {
  const category = cellFormatEl('cellFormatCategory')?.value || 'general';
  const decimals = Math.max(0, Math.min(10, Math.floor(Number(cellFormatEl('cellFormatDecimals')?.value))));
  const d = Number.isFinite(decimals) ? decimals : 2;
  switch (category) {
    case 'number': return { kind: 'number', decimals: d, thousands: !!cellFormatEl('cellFormatThousands')?.checked };
    case 'currency': return { kind: 'currency', decimals: d, currency: cellFormatEl('cellFormatCurrency')?.value || 'uah' };
    case 'percent': return { kind: 'percent', decimals: d };
    case 'date': return { kind: 'date', pattern: cellFormatEl('cellFormatDate')?.value || 'dmy' };
    case 'time': return { kind: 'time', pattern: cellFormatEl('cellFormatTime')?.value || 'hm' };
    case 'fraction': return { kind: 'fraction', digits: cellFormatEl('cellFormatFraction')?.value === '2' ? 2 : 1 };
    case 'scientific': return { kind: 'scientific', decimals: d };
    case 'text': return { kind: 'text' };
    default: return null;
  }
}

function writeCellFormatSpec(spec) {
  const nf = window.TablesNumberFormat;
  const set = (id, value) => { const el = cellFormatEl(id); if (el) el.value = value; };
  set('cellFormatCategory', nf.categoryOf(spec));
  set('cellFormatDecimals', String(spec?.decimals ?? (spec?.kind === 'percent' ? 0 : 2)));
  const thousands = cellFormatEl('cellFormatThousands');
  if (thousands) thousands.checked = !!spec?.thousands;
  set('cellFormatCurrency', spec?.currency || 'uah');
  set('cellFormatDate', spec?.kind === 'date' ? spec.pattern : 'dmy');
  set('cellFormatTime', spec?.kind === 'time' ? spec.pattern : 'hm');
  set('cellFormatFraction', String(spec?.digits === 2 ? 2 : 1));
}

function cellFormatSampleValue(category) {
  const current = String(getCalculatedCellValue(activeId) ?? '');
  if (current.trim() !== '') return { value: current, own: true };
  if (category === 'date' || category === 'time') {
    const base = typeof ymdToSerial === 'function' ? ymdToSerial(2026, 11, 25) : 46351;
    return { value: base + 0.5, own: false };
  }
  return { value: category === 'percent' ? 0.256 : category === 'fraction' ? 1.5 : 1234.5, own: false };
}

function syncCellFormatDialog() {
  const category = cellFormatEl('cellFormatCategory')?.value || 'general';
  document.querySelectorAll('#cellFormatModal [data-cf-row]').forEach(row => {
    row.hidden = !(CELL_FORMAT_ROWS[row.dataset.cfRow] || []).includes(category);
  });
  const note = cellFormatEl('cellFormatNote');
  if (note) note.textContent = CELL_FORMAT_NOTES[category] || '';
  const nf = window.TablesNumberFormat;
  const sample = cellFormatSampleValue(category);
  const preview = cellFormatEl('cellFormatPreview');
  if (preview) preview.textContent = nf.format(readCellFormatSpec(), sample.value) || '—';
  const hint = cellFormatEl('cellFormatPreviewHint');
  if (hint) hint.textContent = sample.own ? `Значення клітинки ${activeId}` : `Приклад (клітинка ${activeId} порожня)`;
}

function openCellFormatDialog() {
  const nf = window.TablesNumberFormat;
  if (!nf || !cellFormatEl('cellFormatModal')) return;
  const td = cellTd[active.r]?.[active.c];
  writeCellFormatSpec(nf.specFromClasses(td ? td.classList : cellStyles[activeId]));
  const b = getBounds();
  const from = `${COLS[b.cMin]}${b.rMin}`;
  const to = `${COLS[b.cMax]}${b.rMax}`;
  cellFormatSelectionLabel = from === to ? from : `${from}:${to}`;
  const target = cellFormatEl('cellFormatTarget');
  if (target) target.textContent = cellFormatSelectionLabel;
  syncCellFormatDialog();
  openModal('cellFormatModal');
  cellFormatEl('cellFormatCategory')?.focus();
}

function applyCellFormatDialog() {
  const nf = window.TablesNumberFormat;
  applyNumberFormatToken(nf.tokenOf(readCellFormatSpec()));
  closeModal('cellFormatModal');
  announce(`Формат клітинок ${cellFormatSelectionLabel} змінено`);
}

function initCellFormatDialog() {
  const modal = cellFormatEl('cellFormatModal');
  if (!modal || modal.dataset.cfBound) return;
  modal.dataset.cfBound = '1';
  ['cellFormatCategory', 'cellFormatDecimals', 'cellFormatThousands', 'cellFormatCurrency', 'cellFormatDate', 'cellFormatTime', 'cellFormatFraction']
    .forEach(id => {
      cellFormatEl(id)?.addEventListener('input', syncCellFormatDialog);
      cellFormatEl(id)?.addEventListener('change', syncCellFormatDialog);
    });
  cellFormatEl('cellFormatApply')?.addEventListener('click', applyCellFormatDialog);
  modal.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.target.matches?.('input')) {
      e.preventDefault();
      applyCellFormatDialog();
    }
  });
  // Ctrl+1 (Cmd+1) — як в Excel; у вкладці браузера це скорочення може бути зарезервоване самим браузером.
  document.addEventListener('keydown', (e) => {
    if (!(e.ctrlKey || e.metaKey) || e.altKey || e.shiftKey || (e.key !== '1' && e.code !== 'Digit1')) return;
    if (modal.classList.contains('active')) return;
    e.preventDefault();
    openCellFormatDialog();
  });
}

initCellFormatDialog();

window.TablesCellFormatUi = {
  applyAlignmentClass,
  applyFillColorClass,
  applyCellFormatDialog,
  applyNumberFormat,
  applyNumberFormatToken,
  openCellFormatDialog,
  applyTextColorClass,
  applyToggleClass,
  clearFillStyles,
  clearTextColorStyles,
  formatDisplayValue,
  getSelectionStats,
  replaceStyleGroup,
  updateSelectionStats,
  updateToolbarState
};
