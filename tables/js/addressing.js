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

// Зсуває посилання при ВСТАВЦІ/ВИДАЛЕННІ рядків чи колонок (поріг rowAt/colAt).
// Працює через токенайзер (а не регексп), тому:
//   - поважає абсолютні маркери $ (абсолютний вимір не зсувається);
//   - не чіпає посилання всередині рядкових літералів ("A1" лишається текстом).
function shiftFormulaRefs(formula, opts) {
  const raw = String(formula || '');
  if (!raw.startsWith('=')) return raw;

  const rowAt = Number.isFinite(opts?.rowAt) ? opts.rowAt : null;
  const colAt = Number.isFinite(opts?.colAt) ? opts.colAt : null;
  const rowDelta = Number.isFinite(opts?.rowDelta) ? opts.rowDelta : 0;
  const colDelta = Number.isFinite(opts?.colDelta) ? opts.colDelta : 0;

  let tokens;
  try {
    tokens = tokenizeFormula(raw.slice(1));
  } catch (_) {
    return raw; // не псуємо те, що не вдалося розібрати
  }

  return stringifyFormulaTokens(tokens, (t) => {
    // Міжаркушеві посилання не зсуваються при зміні структури активного аркуша.
    if (t.sheet) return sheetRefPrefix(t.sheet) + refTokenToString(t.col, t.row, t.colAbs, t.rowAbs);
    let cIdx = t.col;
    let rNum = t.row;
    if (!t.rowAbs && rowAt !== null && rNum >= rowAt) rNum += rowDelta;
    if (!t.colAbs && colAt !== null && cIdx >= colAt) cIdx += colDelta;
    return refTokenToString(cIdx, rNum, t.colAbs, t.rowAbs);
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
  resolveRawCellValue,
  shiftFormulaRefs
};
