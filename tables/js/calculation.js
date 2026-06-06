// ---- Calculation ----
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
        } catch (e) {
          const msg = e?.message || '❌ Помилка у формулі';
          input.value = msg;
          td.classList.add('error-cell');
          announce(`Помилка у клітинці ${id}: ${msg}`);
          input.setAttribute('aria-invalid', 'true');
          td.title = msg + '\nПриклад формули: =A1+B1 або =SUM(A1:A5)';
        }
      } else {
        if (!isEditingThisCell) input.value = formatDisplayValue(raw, td);
      }
    }
  }

  const fb = document.getElementById('formulaBar');
  if (fb && activeId) fb.value = cellData[activeId] || '';
  updateSelectionStats();
}

window.TablesCalculation = {
  recalculateAll
};
