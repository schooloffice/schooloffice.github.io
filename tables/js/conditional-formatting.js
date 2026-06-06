'use strict';

// ---- Conditional formatting (умовне форматування) ----
// Правило: { range:[cMin,rMin,cMax,rMax], op, v1, v2, fill }
// Підсвічує клітинки за числовою умовою (напр. оцінки < 4 — червоним).

const COND_OPS = {
  gt: { label: 'більше ніж', needs2: false },
  ge: { label: 'більше або дорівнює', needs2: false },
  lt: { label: 'менше ніж', needs2: false },
  le: { label: 'менше або дорівнює', needs2: false },
  eq: { label: 'дорівнює', needs2: false },
  ne: { label: 'не дорівнює', needs2: false },
  between: { label: 'між', needs2: true }
};

const COND_FILL_SWATCHES = ['#fee2e2', '#fef9c3', '#dcfce7', '#dbeafe', '#ffedd5', '#fce7f3'];

let condSelectedFill = COND_FILL_SWATCHES[0];
let condStyledCells = [];
let condWired = false;

function condRuleMatches(rule, num) {
  if (typeof num !== 'number' || !Number.isFinite(num)) return false;
  const a = Number(rule.v1);
  switch (rule.op) {
    case 'gt': return num > a;
    case 'ge': return num >= a;
    case 'lt': return num < a;
    case 'le': return num <= a;
    case 'eq': return num === a;
    case 'ne': return num !== a;
    case 'between': {
      const b = Number(rule.v2);
      return num >= Math.min(a, b) && num <= Math.max(a, b);
    }
    default: return false;
  }
}

function condCellNumber(id) {
  const raw = cellData[id];
  if (raw === undefined || raw === null || String(raw).trim() === '') return null;
  const s = String(raw);
  let n;
  if (s.startsWith('=')) {
    try { calcDepth = 0; n = Number(evaluateFormula(s.substring(1))); }
    catch (_) { return null; }
  } else {
    n = Number(s.replace(',', '.'));
  }
  return Number.isFinite(n) ? n : null;
}

// Накладає умовну заливку (inline !important, щоб перемогти style-bg-* класи).
function applyConditionalFormatting() {
  for (const td of condStyledCells) td.style.removeProperty('background-color');
  condStyledCells = [];

  for (const rule of condRules) {
    const [cMin, rMin, cMax, rMax] = rule.range;
    for (let r = rMin; r <= rMax; r++) {
      for (let c = cMin; c <= cMax; c++) {
        if (c < 0 || c >= COL_COUNT || r < 1 || r > ROWS) continue;
        const num = condCellNumber(getCellId(c, r));
        if (num === null || !condRuleMatches(rule, num)) continue;
        const td = cellTd[r]?.[c];
        if (td) {
          td.style.setProperty('background-color', rule.fill, 'important');
          condStyledCells.push(td);
        }
      }
    }
  }
}

function addRule(rule) {
  condRules.push(rule);
  applyConditionalFormatting();
}

function removeCondRule(index) {
  condRules.splice(index, 1);
  applyConditionalFormatting();
  persistStateToStorage();
  setDirty(true);
  renderCondRuleList();
}

function clearCondRules() {
  condRules = [];
  applyConditionalFormatting();
  persistStateToStorage();
  setDirty(true);
  renderCondRuleList();
}

// ---- UI ----
function ruleDescription(rule) {
  const [cMin, rMin, cMax, rMax] = rule.range;
  const from = COLS[cMin] + rMin;
  const to = COLS[cMax] + rMax;
  const rangeStr = from === to ? from : `${from}:${to}`;
  const op = COND_OPS[rule.op]?.label || rule.op;
  const valStr = rule.op === 'between' ? `${rule.v1}…${rule.v2}` : rule.v1;
  return `${rangeStr}: ${op} ${valStr}`;
}

function renderCondRuleList() {
  const list = document.getElementById('condRuleList');
  if (!list) return;
  list.innerHTML = '';
  if (condRules.length === 0) {
    const li = document.createElement('li');
    li.className = 'cond-empty';
    li.textContent = 'Правил ще немає';
    list.appendChild(li);
    return;
  }
  condRules.forEach((rule, i) => {
    const li = document.createElement('li');
    li.className = 'cond-rule-item';

    const sw = document.createElement('span');
    sw.className = 'cond-swatch';
    sw.style.background = rule.fill;

    const txt = document.createElement('span');
    txt.className = 'cond-rule-text';
    txt.textContent = ruleDescription(rule);

    const del = document.createElement('button');
    del.className = 'cond-del';
    del.setAttribute('aria-label', 'Видалити правило');
    del.innerHTML = '<i class="fa-solid fa-trash-can"></i>';
    del.addEventListener('click', () => removeCondRule(i));

    li.append(sw, txt, del);
    list.appendChild(li);
  });
}

function buildCondSwatches() {
  const wrap = document.getElementById('condSwatches');
  if (!wrap) return;
  wrap.innerHTML = '';
  COND_FILL_SWATCHES.forEach(hex => {
    const btn = document.createElement('button');
    btn.className = 'cond-swatch-btn';
    btn.style.background = hex;
    btn.setAttribute('aria-label', 'Колір ' + hex);
    if (hex === condSelectedFill) btn.classList.add('selected');
    btn.addEventListener('click', () => {
      condSelectedFill = hex;
      wrap.querySelectorAll('.cond-swatch-btn').forEach(b => b.classList.remove('selected'));
      btn.classList.add('selected');
    });
    wrap.appendChild(btn);
  });
}

function toggleCondV2() {
  const op = document.getElementById('condOp')?.value;
  const needs2 = !!COND_OPS[op]?.needs2;
  const v2 = document.getElementById('condV2');
  const and = document.getElementById('condAnd');
  if (v2) v2.hidden = !needs2;
  if (and) and.hidden = !needs2;
}

function showCondError(msg) {
  const el = document.getElementById('condError');
  if (el) el.textContent = msg || '';
}

function onAddCondRule() {
  const op = document.getElementById('condOp')?.value || 'gt';
  const v1 = parseFloat(document.getElementById('condV1')?.value);
  if (!Number.isFinite(v1)) { showCondError('Вкажіть число для умови.'); return; }

  let v2 = null;
  if (COND_OPS[op]?.needs2) {
    v2 = parseFloat(document.getElementById('condV2')?.value);
    if (!Number.isFinite(v2)) { showCondError('Для умови «між» вкажіть друге число.'); return; }
  }

  const b = getBounds();
  addRule({ range: [b.cMin, b.rMin, b.cMax, b.rMax], op, v1, v2, fill: condSelectedFill });
  persistStateToStorage();
  setDirty(true);
  showCondError('');
  renderCondRuleList();
}

function wireCondModalOnce() {
  if (condWired) return;
  condWired = true;
  document.getElementById('condOp')?.addEventListener('change', toggleCondV2);
  document.getElementById('condAddBtn')?.addEventListener('click', onAddCondRule);
  document.getElementById('condClearBtn')?.addEventListener('click', clearCondRules);
}

function openCondFormatModal() {
  wireCondModalOnce();

  const b = getBounds();
  const label = document.getElementById('condRangeLabel');
  if (label) {
    const from = COLS[b.cMin] + b.rMin;
    const to = COLS[b.cMax] + b.rMax;
    label.textContent = from === to ? from : `${from}:${to}`;
  }

  buildCondSwatches();
  toggleCondV2();
  showCondError('');
  renderCondRuleList();
  openModal('condFormatModal');
}

window.TablesConditionalFormatting = {
  addRule,
  applyConditionalFormatting,
  clearCondRules,
  condRuleMatches,
  openCondFormatModal,
  removeCondRule
};
