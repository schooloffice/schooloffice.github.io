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

function shiftFormulaRefs(formula, opts) {
  const raw = String(formula || '');
  if (!raw.startsWith('=')) return raw;

  const rowAt = Number.isFinite(opts?.rowAt) ? opts.rowAt : null;
  const colAt = Number.isFinite(opts?.colAt) ? opts.colAt : null;
  const rowDelta = Number.isFinite(opts?.rowDelta) ? opts.rowDelta : 0;
  const colDelta = Number.isFinite(opts?.colDelta) ? opts.colDelta : 0;

  const shiftRef = (colLabel, rowStr) => {
    let cIdx = colToIndex(colLabel);
    let rNum = parseInt(rowStr, 10);
    if (rowAt !== null && rNum >= rowAt) rNum += rowDelta;
    if (colAt !== null && cIdx >= colAt) cIdx += colDelta;
    cIdx = Math.max(0, cIdx);
    rNum = Math.max(1, rNum);
    return indexToCol(cIdx) + rNum;
  };

  let out = raw.replace(/\b([A-Z]+)(\d+)\s*:\s*([A-Z]+)(\d+)\b/g, (m, c1, r1, c2, r2) => {
    const a = shiftRef(c1, r1);
    const b = shiftRef(c2, r2);
    return a + ':' + b;
  });

  out = out.replace(/\b([A-Z]+)(\d+)\b/g, (m, c, r) => shiftRef(c, r));
  return out;
}

window.TablesAddressing = {
  buildCols,
  colToIndex,
  expandRange,
  indexToCol,
  isCellReference,
  resolveRawCellValue,
  shiftFormulaRefs
};
