'use strict';

// ---- Columns: A..Z, AA.. and reference helpers ----
function indexToCol(idx) {
  let n = Number(idx);
  if (!Number.isFinite(n) || n < 0) return 'A';
  let s = '';
  while (n >= 0) {
    s = String.fromCharCode((n % 26) + 65) + s;
    n = Math.floor(n / 26) - 1;
  }
  return s;
}

function colToIndex(label) {
  const str = String(label || '').toUpperCase().trim();
  if (!/^[A-Z]+$/.test(str)) return -1;
  let n = 0;
  for (let i = 0; i < str.length; i++) {
    n = n * 26 + (str.charCodeAt(i) - 64);
  }
  return n - 1;
}

function buildCols(count) {
  const n = Math.max(1, Math.min(200, Number(count) || 1));
  const arr = [];
  for (let i = 0; i < n; i++) arr.push(indexToCol(i));
  return arr;
}

function isCellReference(value) {
  return /^[A-Z]+\d+$/.test(String(value || '').trim().toUpperCase());
}

function resolveRawCellValue(ref) {
  const key = String(ref || '').trim().toUpperCase();
  return cellData[key];
}

function expandRange(c1, r1, c2, r2) {
  const list = [];
  const ci1 = colToIndex(c1);
  const ci2 = colToIndex(c2);
  if (ci1 < 0 || ci2 < 0) return list;

  const cMin = Math.min(ci1, ci2);
  const cMax = Math.max(ci1, ci2);
  const rMin = Math.min(r1, r2);
  const rMax = Math.max(r1, r2);

  for (let c = cMin; c <= cMax; c++) {
    for (let r = rMin; r <= rMax; r++) {
      if (c >= 0 && c < COL_COUNT && r >= 1 && r <= ROWS) {
        list.push(indexToCol(c) + r);
      }
    }
  }
  return list;
}

// Перебудовує формулу з токенів, застосовуючи transformRef до кожного посилання.
function stringifyFormulaTokens(tokens, transformRef) {
  let out = '=';
  for (const t of tokens) {
    switch (t.type) {
      case 'eof': break;
      case 'num': out += (t.text != null ? t.text : String(t.value)); break;
      case 'str': out += '"' + t.value + '"'; break;
      case 'err': out += t.value; break;
      case 'name': out += t.value; break;
      case 'op': out += t.value; break;
      case 'ref': out += transformRef(t); break;
      default: break;
    }
  }
  return out;
}

function refTokenToString(colIdx, rowNum, colAbs, rowAbs) {
  const c = Math.max(0, colIdx);
  const r = Math.max(1, rowNum);
  return (colAbs ? '$' : '') + indexToCol(c) + (rowAbs ? '$' : '') + r;
}

// Префікс аркуша для друку посилання (у лапках, якщо є нестандартні символи).
function sheetRefPrefix(name) {
  const s = String(name);
  return (/^[A-Za-z_Ѐ-ӿ][A-Za-z0-9_Ѐ-ӿ]*$/.test(s) ? s : `'${s}'`) + '!';
}

// Чи стосується посилання аркуша, де змінюється структура?
function refTargetsModifiedSheet(t, modSheetLower, local) {
  return t.sheet ? (String(t.sheet).trim().toLowerCase() === modSheetLower) : local;
}

function structuralShiftCoordinate(value, at, delta) {
  if (at === null || delta === 0) return { value, deleted: false };
  if (delta > 0) return { value: value >= at ? value + delta : value, deleted: false };

  const deleteTo = at - delta - 1;
  if (value >= at && value <= deleteTo) return { value, deleted: true };
  return { value: value > deleteTo ? value + delta : value, deleted: false };
}

function structuralShiftInterval(a, b, at, delta) {
  if (at === null || delta === 0) return { a, b, deleted: false };

  const forward = a <= b;
  let lo = Math.min(a, b);
  let hi = Math.max(a, b);

  if (delta > 0) {
    if (lo >= at) {
      lo += delta;
      hi += delta;
    } else if (hi >= at) {
      hi += delta;
    }
  } else {
    const deleteTo = at - delta - 1;
    if (hi < at) {
      // interval is before the deleted block
    } else if (lo > deleteTo) {
      lo += delta;
      hi += delta;
    } else {
      const keptBefore = lo < at;
      const keptAfter = hi > deleteTo;
      if (!keptBefore && !keptAfter) return { a, b, deleted: true };
      lo = keptBefore ? lo : at;
      hi = keptAfter ? hi + delta : at - 1;
    }
  }

  return forward ? { a: lo, b: hi, deleted: false } : { a: hi, b: lo, deleted: false };
}

function formatRefToken(t, col, row, sheet = t.sheet) {
  return (sheet ? sheetRefPrefix(sheet) : '') + refTokenToString(col, row, t.colAbs, t.rowAbs);
}

function shiftStructuralRef(t, opts, effectiveSheet) {
  const target = refTargetsModifiedSheet(
    Object.assign({}, t, { sheet: effectiveSheet }),
    opts.modSheet,
    opts.local
  );
  if (!target) return formatRefToken(t, t.col, t.row);

  const row = structuralShiftCoordinate(t.row, opts.rowAt, opts.rowDelta);
  const col = structuralShiftCoordinate(t.col, opts.colAt, opts.colDelta);
  if (row.deleted || col.deleted) return '#REF!';
  return formatRefToken(t, col.value, row.value);
}

function shiftStructuralRange(start, end, opts) {
  const inheritedSheet = end.sheet || start.sheet || null;
  const target = refTargetsModifiedSheet(
    Object.assign({}, start, { sheet: start.sheet || inheritedSheet }),
    opts.modSheet,
    opts.local
  );
  if (!target) {
    return formatRefToken(start, start.col, start.row) + ':' +
      formatRefToken(end, end.col, end.row);
  }

  const rows = structuralShiftInterval(start.row, end.row, opts.rowAt, opts.rowDelta);
  const cols = structuralShiftInterval(start.col, end.col, opts.colAt, opts.colDelta);
  if (rows.deleted || cols.deleted) return '#REF!';

  return formatRefToken(start, cols.a, rows.a) + ':' +
    formatRefToken(end, cols.b, rows.b);
}

// Зсуває посилання при ВСТАВЦІ/ВИДАЛЕННІ рядків чи колонок.
// Семантика Excel: при зміні структури абсолютні посилання ТЕЖ зсуваються
// (маркери $ зберігаються); $ блокує зсув лише при копіюванні (offsetFormulaRefs).
// Посилання на видалені клітинки стають #REF!. opts.sheet — назва зміненого
// аркуша, opts.local — чи формула живе на ньому (для безпрефіксних посилань).
function shiftFormulaRefs(formula, opts) {
  const raw = String(formula || '');
  if (!raw.startsWith('=')) return raw;

  const rowAt = Number.isFinite(opts?.rowAt) ? opts.rowAt : null;
  const colAt = Number.isFinite(opts?.colAt) ? opts.colAt : null;
  const rowDelta = Number.isFinite(opts?.rowDelta) ? opts.rowDelta : 0;
  const colDelta = Number.isFinite(opts?.colDelta) ? opts.colDelta : 0;
  const modSheet = opts?.sheet ? String(opts.sheet).trim().toLowerCase() : null;
  const local = !!opts?.local;

  let tokens;
  try {
    tokens = tokenizeFormula(raw.slice(1));
  } catch (_) {
    return raw;
  }

  const shiftOpts = { rowAt, colAt, rowDelta, colDelta, modSheet, local };
  let result = '=';
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t.type === 'eof') continue;

    if (t.type === 'ref' && tokens[i + 1]?.type === 'op' && tokens[i + 1].value === ':' && tokens[i + 2]?.type === 'ref') {
      result += shiftStructuralRange(t, tokens[i + 2], shiftOpts);
      i += 2;
      continue;
    }

    if (t.type === 'ref') {
      result += shiftStructuralRef(t, shiftOpts, t.sheet || null);
      continue;
    }

    result += stringifyFormulaTokens([t]).slice(1);
  }
  return result;
}

// Перейменовує префікс аркуша в посиланнях (oldName → newName).
function renameSheetRefs(formula, oldName, newName) {
  const raw = String(formula || '');
  if (!raw.startsWith('=')) return raw;
  const oldN = String(oldName).trim().toLowerCase();

  let tokens;
  try {
    tokens = tokenizeFormula(raw.slice(1));
  } catch (_) {
    return raw;
  }

  return stringifyFormulaTokens(tokens, (t) => {
    const sheet = (t.sheet && String(t.sheet).trim().toLowerCase() === oldN) ? newName : t.sheet;
    return (sheet ? sheetRefPrefix(sheet) : '') + refTokenToString(t.col, t.row, t.colAbs, t.rowAbs);
  });
}

// Перетворює посилання на видалений аркуш у #REF!, щоб вони не «ожили»,
// якщо згодом буде створено новий аркуш із такою самою назвою.
function deleteSheetRefs(formula, deletedName) {
  const raw = String(formula || '');
  if (!raw.startsWith('=')) return raw;
  const deleted = String(deletedName || '').trim().toLowerCase();

  let tokens;
  try {
    tokens = tokenizeFormula(raw.slice(1));
  } catch (_) {
    return raw;
  }

  let result = '=';
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t.type === 'eof') continue;

    if (t.type === 'ref' && tokens[i + 1]?.type === 'op' && tokens[i + 1].value === ':' && tokens[i + 2]?.type === 'ref') {
      const end = tokens[i + 2];
      const rangeSheet = String(t.sheet || end.sheet || '').trim().toLowerCase();
      result += rangeSheet === deleted
        ? '#REF!'
        : formatRefToken(t, t.col, t.row) + ':' + formatRefToken(end, end.col, end.row);
      i += 2;
      continue;
    }

    if (t.type === 'ref') {
      result += String(t.sheet || '').trim().toLowerCase() === deleted
        ? '#REF!'
        : formatRefToken(t, t.col, t.row);
      continue;
    }

    result += stringifyFormulaTokens([t]).slice(1);
  }
  return result;
}

// Зсуває ВСІ відносні посилання на сталу дельту (для копіювання/автозаповнення).
// Абсолютні виміри ($) лишаються незмінними.
function offsetFormulaRefs(formula, rowDelta, colDelta) {
  const raw = String(formula || '');
  if (!raw.startsWith('=')) return raw;

  const dRow = Number.isFinite(rowDelta) ? rowDelta : 0;
  const dCol = Number.isFinite(colDelta) ? colDelta : 0;

  let tokens;
  try {
    tokens = tokenizeFormula(raw.slice(1));
  } catch (_) {
    return raw;
  }

  return stringifyFormulaTokens(tokens, (t) => {
    const cIdx = t.colAbs ? t.col : t.col + dCol;
    const rNum = t.rowAbs ? t.row : t.row + dRow;
    const refStr = refTokenToString(cIdx, rNum, t.colAbs, t.rowAbs);
    return t.sheet ? sheetRefPrefix(t.sheet) + refStr : refStr;
  });
}

window.TablesAddressing = {
  buildCols,
  colToIndex,
  expandRange,
  indexToCol,
  isCellReference,
  deleteSheetRefs,
  offsetFormulaRefs,
  renameSheetRefs,
  resolveRawCellValue,
  shiftFormulaRefs
};
