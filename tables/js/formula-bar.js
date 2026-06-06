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

// Чиста логіка циклу F4: A1 → $A$1 → A$1 → $A1 → A1.
// Повертає { value, caret } або null, якщо під курсором немає посилання.
function computeReferenceCycle(value, pos) {
  const src = String(value || '');
  if (!src.startsWith('=')) return null;

  const caret = Number.isFinite(pos) ? pos : src.length;
  const re = /\$?[A-Za-z]+\$?\d+/g;
  let m;
  let target = null;
  while ((m = re.exec(src)) !== null) {
    const start = m.index;
    const end = start + m[0].length;
    if (caret >= start && caret <= end) { target = { text: m[0], start, end }; break; }
  }
  if (!target) return null;

  const parts = /^(\$?)([A-Za-z]+)(\$?)(\d+)$/.exec(target.text);
  if (!parts) return null;

  let colAbs = parts[1] === '$';
  let rowAbs = parts[3] === '$';
  const col = parts[2].toUpperCase();
  const row = parts[4];

  if (!colAbs && !rowAbs) { colAbs = true; rowAbs = true; }
  else if (colAbs && rowAbs) { colAbs = false; rowAbs = true; }
  else if (!colAbs && rowAbs) { colAbs = true; rowAbs = false; }
  else { colAbs = false; rowAbs = false; }

  const newRef = (colAbs ? '$' : '') + col + (rowAbs ? '$' : '') + row;
  const newVal = src.slice(0, target.start) + newRef + src.slice(target.end);
  return { value: newVal, caret: target.start + newRef.length };
}

// Застосовує цикл F4 до фокусованого поля (рядок формул або клітинка) і синхронізує.
function cycleReferenceType(input) {
  if (!input) return false;
  const result = computeReferenceCycle(input.value, input.selectionStart);
  if (!result || result.value.length > 200) return false;

  input.value = result.value;
  cellData[activeId] = result.value;
  if (typeof setDirty === 'function') setDirty(true);

  const bar = document.getElementById('formulaBar');
  const cellInput = cellInp[active.r]?.[active.c];
  if (input === bar) {
    if (cellInput && document.activeElement === cellInput) cellInput.value = result.value;
  } else if (bar) {
    bar.value = result.value;
  }

  input.focus();
  input.setSelectionRange(result.caret, result.caret);
  return true;
}

window.TablesFormulaBar = {
  insertChar,
  computeReferenceCycle,
  cycleReferenceType
};
