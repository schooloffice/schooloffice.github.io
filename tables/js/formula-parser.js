'use strict';

// ---- Formula parser primitives ----
function safeMathEval(expr) {
  const src = String(expr || '').trim();
  let pos = 0;

  function peek() { return src[pos] || ''; }
  function eat(ch) {
    if (src[pos] === ch) { pos++; return true; }
    return false;
  }
  function skipSpaces() { while (src[pos] === ' ') pos++; }

  function parseExpr() {
    return parseAddSub();
  }

  function parseAddSub() {
    let left = parseMulDiv();
    skipSpaces();
    while (peek() === '+' || peek() === '-') {
      const op = src[pos++];
      const right = parseMulDiv();
      left = op === '+' ? left + right : left - right;
      skipSpaces();
    }
    return left;
  }

  function parseMulDiv() {
    let left = parseUnary();
    skipSpaces();
    while (peek() === '*' || peek() === '/') {
      const op = src[pos++];
      const right = parseUnary();
      if (op === '/' && right === 0) throw new Error('Division by zero');
      left = op === '*' ? left * right : left / right;
      skipSpaces();
    }
    return left;
  }

  function parseUnary() {
    skipSpaces();
    if (peek() === '-') { pos++; return -parseUnary(); }
    if (peek() === '+') { pos++; return parseUnary(); }
    return parsePrimary();
  }

  function parsePrimary() {
    skipSpaces();
    if (peek() === '(') {
      pos++;
      const val = parseExpr();
      skipSpaces();
      if (!eat(')')) throw new Error('Missing closing parenthesis');
      return val;
    }

    let numStr = '';
    while (/[\d.]/.test(peek())) numStr += src[pos++];
    if (numStr !== '') {
      const n = parseFloat(numStr);
      if (!isFinite(n)) throw new Error('Invalid number');
      return n;
    }
    throw new Error('Unknown character in formula: ' + (peek() || 'end of input'));
  }

  const result = parseExpr();
  skipSpaces();
  if (pos < src.length) throw new Error('Unexpected characters in formula');
  return result;
}

function splitFormulaArgs(argsStr) {
  const src = String(argsStr || '');
  const parts = [];
  let current = '';
  let depth = 0;

  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (ch === '(') depth++;
    if (ch === ')') depth = Math.max(0, depth - 1);

    if ((ch === ',' || ch === ';') && depth === 0) {
      parts.push(current.trim());
      current = '';
      continue;
    }
    current += ch;
  }

  if (current.trim() || src.includes(',') || src.includes(';')) parts.push(current.trim());
  return parts.filter((part, idx, arr) => part !== '' || (arr.length === 1 && idx === 0));
}

window.TablesFormulaParser = {
  safeMathEval,
  splitFormulaArgs
};
