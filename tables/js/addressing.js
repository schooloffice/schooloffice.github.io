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

// Згортає діапазон у #REF!, якщо хоч один кінець став #REF!.
const REF_SIDE = "(?:'[^']*'!|[A-Za-z0-9_\\u0400-\\u04FF]+!)?(?:\\$?[A-Za-z]+\\$?\\d+|#REF!)";
const REF_RANGE_RE = new RegExp(REF_SIDE + '\\s*:\\s*' + REF_SIDE, 'g');

// Чи стосується посилання аркуша, де змінюється структура?
function refTargetsModifiedSheet(t, modSheetLower, local) {
  return t.sheet ? (String(t.sheet).trim().toLowerCase() === modSheetLower) : local;
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

  let broke = false;
  let result = stringifyFormulaTokens(tokens, (t) => {
    if (!refTargetsModifiedSheet(t, modSheet, local)) {
      return (t.sheet ? sheetRefPrefix(t.sheet) : '') + refTokenToString(t.col, t.row, t.colAbs, t.rowAbs);
    }

    let cIdx = t.col;
    let rNum = t.row;

    if (rowAt !== null) {
      if (rowDelta < 0) {
        const delTo = rowAt - rowDelta - 1;
        if (rNum >= rowAt && rNum <= delTo) { broke = true; return '#REF!'; }
        if (rNum > delTo) rNum += rowDelta;
      } else if (rNum >= rowAt) {
        rNum += rowDelta;
      }
    }

    if (colAt !== null) {
      if (colDelta < 0) {
        const delTo = colAt - colDelta - 1;
        if (cIdx >= colAt && cIdx <= delTo) { broke = true; return '#REF!'; }
        if (cIdx > delTo) cIdx += colDelta;
      } else if (cIdx >= colAt) {
        cIdx += colDelta;
      }
    }

    return (t.sheet ? sheetRefPrefix(t.sheet) : '') + refTokenToString(cIdx, rNum, t.colAbs, t.rowAbs);
  });

  if (broke) result = result.replace(REF_RANGE_RE, m => (m.includes('#REF!') ? '#REF!' : m));
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
  offsetFormulaRefs,
  renameSheetRefs,
  resolveRawCellValue,
  shiftFormulaRefs
};
