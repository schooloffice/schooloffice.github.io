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
function applyNumberFormat(cls) { replaceStyleGroup(NUMBER_FORMAT_CLASSES, cls); recalculateAll(); }

function applyToggleClass(cls) {
  applyStyleToSelection(td => td.classList.toggle(cls));
  updateToolbarState();
}

function formatDisplayValue(value, td) {
  const raw = String(value ?? '');
  if (raw.trim() === '') return '';

  const classes = td?.classList;
  const normalized = raw.replace(',', '.');
  const num = Number(normalized);
  const isNumeric = Number.isFinite(num) && normalized !== '';
  if (!isNumeric) return raw;

  if (classes?.contains('style-num-int')) return String(Math.round(num));
  if (classes?.contains('style-num-fixed2')) return num.toLocaleString('uk-UA', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (classes?.contains('style-num-percent')) return `${(num * 100).toLocaleString('uk-UA', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}%`;
  if (classes?.contains('style-num-currency-uah')) return num.toLocaleString('uk-UA', { style: 'currency', currency: 'UAH', maximumFractionDigits: 2 });
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
      if (String(raw).trim() !== '') count++;

      let num = NaN;
      if (String(raw).startsWith('=')) {
        try {
          num = Number(evaluateFormula(String(raw).substring(1)));
        } catch (_) {
          num = NaN;
        }
      } else {
        num = Number(String(raw).replace(',', '.'));
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
  const fmt = document.getElementById('numberFormatSelect');
  if (fmt) {
    const found = NUMBER_FORMAT_CLASSES.find(cls => td.classList.contains(cls)) || '';
    fmt.value = found;
  }
  updateUndoRedoButtons();
}

window.TablesCellFormatUi = {
  applyAlignmentClass,
  applyFillColorClass,
  applyNumberFormat,
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
