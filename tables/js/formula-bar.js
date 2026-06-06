// ---- Formula bar helpers ----
function insertChar(char) {
  const bar = document.getElementById('formulaBar');
  if (!bar) return;

  let start = bar.selectionStart ?? bar.value.length;
  let end = bar.selectionEnd ?? bar.value.length;
  let val = bar.value;

  if (!val.startsWith('=')) {
    val = '=' + val;
    start++;
    end++;
  }

  const newVal = val.slice(0, start) + char + val.slice(end);
  if (newVal.length > 200) return;

  bar.value = newVal;
  cellData[activeId] = newVal;

  const inp = cellInp[active.r]?.[active.c];
  if (inp && document.activeElement === inp) inp.value = newVal;

  bar.focus();
  const newPos = start + String(char).length;
  bar.setSelectionRange(newPos, newPos);
}

window.TablesFormulaBar = {
  insertChar
};
