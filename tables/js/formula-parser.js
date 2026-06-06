'use strict';

// ---- Formula tokenizer + parser → AST ----
// Замість послідовних String.replace будуємо дерево розбору. Це дає коректне
// вкладення функцій, абсолютні посилання ($A$1) і однозначні коди помилок.
//
// Вузли AST:
//   { type:'num', value }
//   { type:'str', value }
//   { type:'ref', col, row, colAbs, rowAbs }   // col — індекс із 0
//   { type:'range', start:refNode, end:refNode }
//   { type:'unary', op:'-'|'+'|'%post', operand }
//   { type:'binary', op, left, right }
//   { type:'call', name, args:[node] }

function tokenizeFormula(src) {
  const s = String(src || '');
  const n = s.length;
  const tokens = [];
  let i = 0;

  const isDigit = ch => ch >= '0' && ch <= '9';
  const isLetter = ch => (ch >= 'A' && ch <= 'Z') || (ch >= 'a' && ch <= 'z');
  const isCyr = ch => ch >= 'Ѐ' && ch <= 'ӿ';
  const isNameStart = ch => isLetter(ch) || isCyr(ch) || ch === '_';

  const CROSS_SHEET_RE = /^([A-Za-z_Ѐ-ӿ][A-Za-z0-9_Ѐ-ӿ]*)!(\$?)([A-Za-z]+)(\$?)(\d+)/;
  const QUOTED_SHEET_RE = /^'([^']+)'!(\$?)([A-Za-z]+)(\$?)(\d+)/;
  const PLAIN_REF_RE = /^(\$?)([A-Za-z]+)(\$?)(\d+)/;

  while (i < n) {
    const ch = s[i];

    if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r') { i++; continue; }

    // Рядковий літерал "..."
    if (ch === '"') {
      let j = i + 1;
      let str = '';
      while (j < n && s[j] !== '"') { str += s[j]; j++; }
      if (j >= n) throw new Error('Unterminated string');
      tokens.push({ type: 'str', value: str });
      i = j + 1;
      continue;
    }

    // Число
    if (isDigit(ch) || (ch === '.' && isDigit(s[i + 1]))) {
      let j = i;
      while (j < n && isDigit(s[j])) j++;
      if (s[j] === '.') { j++; while (j < n && isDigit(s[j])) j++; }
      tokens.push({ type: 'num', value: parseFloat(s.slice(i, j)), text: s.slice(i, j) });
      i = j;
      continue;
    }

    // Міжаркушеве посилання з лапками: 'Назва аркуша'!A1
    if (ch === "'") {
      const q = QUOTED_SHEET_RE.exec(s.slice(i));
      if (q) {
        tokens.push({ type: 'ref', sheet: q[1], col: colToIndex(q[3]), row: parseInt(q[5], 10), colAbs: q[2] === '$', rowAbs: q[4] === '$' });
        i += q[0].length;
        continue;
      }
      throw new Error('Unexpected character: ' + ch);
    }

    // Посилання на клітинку (можливо з $ та префіксом аркуша Назва!A1)
    if (ch === '$' || isNameStart(ch)) {
      const cs = CROSS_SHEET_RE.exec(s.slice(i));
      if (cs) {
        tokens.push({ type: 'ref', sheet: cs[1], col: colToIndex(cs[3]), row: parseInt(cs[5], 10), colAbs: cs[2] === '$', rowAbs: cs[4] === '$' });
        i += cs[0].length;
        continue;
      }

      const refMatch = PLAIN_REF_RE.exec(s.slice(i));
      if (refMatch) {
        tokens.push({
          type: 'ref',
          col: colToIndex(refMatch[2]),
          row: parseInt(refMatch[4], 10),
          colAbs: refMatch[1] === '$',
          rowAbs: refMatch[3] === '$'
        });
        i += refMatch[0].length;
        continue;
      }

      // Назва (функція або ідентифікатор)
      let j = i;
      while (j < n && (isLetter(s[j]) || isCyr(s[j]) || s[j] === '_' || isDigit(s[j]))) j++;
      tokens.push({ type: 'name', value: s.slice(i, j).toUpperCase() });
      i = j;
      continue;
    }

    // Двознакові оператори порівняння
    const two = s.slice(i, i + 2);
    if (two === '>=' || two === '<=' || two === '<>' || two === '!=') {
      tokens.push({ type: 'op', value: two === '!=' ? '<>' : two });
      i += 2;
      continue;
    }

    // Однознакові оператори / пунктуація
    if ('+-*/(),;:%<>='.includes(ch)) {
      tokens.push({ type: 'op', value: ch });
      i++;
      continue;
    }

    throw new Error('Unexpected character: ' + ch);
  }

  tokens.push({ type: 'eof' });
  return tokens;
}

function parseFormula(src) {
  const tokens = tokenizeFormula(src);
  let pos = 0;
  const peek = () => tokens[pos];
  const next = () => tokens[pos++];
  const isOp = v => peek().type === 'op' && peek().value === v;
  const eatOp = v => { if (isOp(v)) { pos++; return true; } return false; };
  const expectOp = v => { if (!eatOp(v)) throw new Error('Expected ' + v); };

  function parseExpr() { return parseComparison(); }

  function parseComparison() {
    let left = parseAdditive();
    while (peek().type === 'op' && ['=', '<>', '<', '>', '<=', '>='].includes(peek().value)) {
      const op = next().value;
      left = { type: 'binary', op, left, right: parseAdditive() };
    }
    return left;
  }

  function parseAdditive() {
    let left = parseMultiplicative();
    while (isOp('+') || isOp('-')) {
      const op = next().value;
      left = { type: 'binary', op, left, right: parseMultiplicative() };
    }
    return left;
  }

  function parseMultiplicative() {
    let left = parseUnary();
    while (isOp('*') || isOp('/')) {
      const op = next().value;
      left = { type: 'binary', op, left, right: parseUnary() };
    }
    return left;
  }

  function parseUnary() {
    if (isOp('-') || isOp('+')) {
      const op = next().value;
      return { type: 'unary', op, operand: parseUnary() };
    }
    return parsePostfix();
  }

  function parsePostfix() {
    let node = parsePrimary();
    while (isOp('%')) { next(); node = { type: 'unary', op: '%post', operand: node }; }
    return node;
  }

  function parsePrimary() {
    const t = peek();

    if (t.type === 'num') { next(); return { type: 'num', value: t.value }; }
    if (t.type === 'str') { next(); return { type: 'str', value: t.value }; }

    if (isOp('(')) {
      next();
      const e = parseExpr();
      expectOp(')');
      return e;
    }

    if (t.type === 'ref') {
      next();
      if (isOp(':')) {
        next();
        if (peek().type !== 'ref') throw new Error('Expected cell after :');
        return { type: 'range', start: t, end: next() };
      }
      return t;
    }

    if (t.type === 'name') {
      next();
      if (isOp('(')) {
        next();
        const args = [];
        if (!isOp(')')) {
          args.push(parseExpr());
          while (eatOp(',') || eatOp(';')) args.push(parseExpr());
        }
        expectOp(')');
        return { type: 'call', name: t.value, args };
      }
      // Гола назва без "(" — невідомий ідентифікатор
      throw formulaError(FORMULA_ERRORS.NAME);
    }

    throw new Error('Unexpected token');
  }

  const ast = parseExpr();
  if (peek().type !== 'eof') throw new Error('Unexpected trailing tokens');
  return ast;
}

window.TablesFormulaParser = { parseFormula, tokenizeFormula };
