// ---- Calculation ----
// Тип даних клітинки для вирівнювання за замовчуванням (число → праворуч).
function applyCellType(td, value) {
  td.classList.remove('cell-type-number', 'cell-type-text');
  const s = String(value ?? '').trim();
  if (s === '') return;
  const isNumber = Number.isFinite(Number(s.replace(',', '.')));
  td.classList.add(isNumber ? 'cell-type-number' : 'cell-type-text');
}

function recalculateAll() {
  for (let r = 1; r <= ROWS; r++) {
    for (let c = 0; c < COL_COUNT; c++) {
      const id = getCellId(c, r);
      const raw = cellData[id];
      const input = cellInp[r]?.[c];
      const td = cellTd[r]?.[c];
      if (!input || !td) continue;

      td.classList.remove('error-cell');

      const isEditingThisCell = (document.activeElement === input);

      if (raw === undefined || raw === null || raw === '') {
        if (!isEditingThisCell) input.value = '';
        applyCellType(td, '');
        continue;
      }

      if (String(raw).startsWith('=')) {
        if (isEditingThisCell) continue;
        try {
          calcDepth = 0;
          const val = evaluateFormula(String(raw).substring(1));
          input.value = formatDisplayValue(val, td);
          input.removeAttribute('aria-invalid');
          td.removeAttribute('title');
          applyCellType(td, val);
        } catch (e) {
          const code = e?.message || '#VALUE!';
          const hint = (window.TablesModel?.formulaErrorHint?.(code)) ||
            'Перевірте формулу. Приклад: =A1+B1 або =SUM(A1:A5)';
          input.value = code;
          td.classList.add('error-cell');
          announce(`Помилка у клітинці ${id}: ${code} — ${hint}`);
          input.setAttribute('aria-invalid', 'true');
          td.title = `${code} — ${hint}`;
          applyCellType(td, '');
        }
      } else {
        if (!isEditingThisCell) input.value = formatDisplayValue(raw, td);
        applyCellType(td, raw);
      }
    }
  }

  applyConditionalFormatting();
  if (typeof applyRowFilter === 'function') applyRowFilter();

  const fb = document.getElementById('formulaBar');
  if (fb && activeId) fb.value = cellData[activeId] || '';
  updateSelectionStats();
}

window.TablesCalculation = {
  recalculateAll
};
