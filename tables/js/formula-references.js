'use strict';

// ---- Formula references and conditions ----
function resolveExpressionValue(value) {
  const src = String(value || '').trim();
  if (src === '') return 0;
  if (isCellReference(src)) return resolveValue(src);
  if (!isNaN(src)) return parseFloat(src);

  const expanded = src
    .replace(/(\d+(?:\.\d+)?)%/g, (m, n) => String(parseFloat(n) / 100))
    .replace(/\b([A-Z]+)(\d+)\b/g, (m, c, r) => String(resolveValue(c + r)));
  return safeMathEval(expanded);
}

function evaluateCondition(condition) {
  const src = String(condition || '').trim();
  if (src === '') return false;

  const match = /^(.+?)(>=|<=|<>|!=|=|>|<)(.+)$/.exec(src);
  if (!match) return resolveExpressionValue(src) !== 0;

  const left = resolveExpressionValue(match[1]);
  const op = match[2];
  const right = resolveExpressionValue(match[3]);

  if (op === '>=') return left >= right;
  if (op === '<=') return left <= right;
  if (op === '>') return left > right;
  if (op === '<') return left < right;
  if (op === '=') return left === right;
  return left !== right;
}

function resolveValue(ref) {
  const trimmed = String(ref || '').trim();
  if (trimmed === '') return 0;

  if (!isNaN(trimmed)) return parseFloat(trimmed);

  const m = /^([A-Z]+)(\d+)$/.exec(trimmed.toUpperCase());
  if (!m) return 0;

  const cIdx = colToIndex(m[1]);
  const rNum = parseInt(m[2], 10);
  if (cIdx < 0 || cIdx >= COL_COUNT || rNum < 1 || rNum > ROWS) return 0;

  const key = m[1] + rNum;
  const raw = cellData[key];
  if (raw === undefined || raw === null || raw === '') return 0;

  if (String(raw).startsWith('=')) {
    return evaluateFormula(String(raw).substring(1));
  }

  const normalized = String(raw).replace(',', '.');
  const num = parseFloat(normalized);
  return isNaN(num) ? 0 : num;
}

window.TablesFormulaReferences = {
  evaluateCondition,
  resolveExpressionValue,
  resolveValue
};
