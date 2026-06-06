'use strict';

// ---- Sheets (аркуші) UI + orchestration ----

function switchToSheet(i) {
  if (i < 0 || i >= sheets.length || i === activeSheet) return;
  syncActiveSheetFromGlobals();
  rowFilter = null;
  loadGlobalsFromSheet(i);
  active = { c: 0, r: 1 };
  activeId = 'A1';
  selStart = { c: 0, r: 1 };
  selEnd = { c: 0, r: 1 };
  rebuildGrid();
  recalculateAll();
  renderSheetTabs();
  renderSel();
  persistStateToStorage();
  setDirty(true);
}

function addSheet() {
  syncActiveSheetFromGlobals();
  let n = sheets.length + 1;
  let name = 'Аркуш' + n;
  while (findSheetByName(name)) { n++; name = 'Аркуш' + n; }
  sheets.push(makeSheet(name));
  switchToSheet(sheets.length - 1);
  saveToHistory();
}

function renameSheet(i, newName) {
  const name = String(newName || '').trim();
  if (!name) { renderSheetTabs(); return; }
  const clash = sheets.some((s, idx) => idx !== i && String(s.name).trim().toLowerCase() === name.toLowerCase());
  if (clash) { showInfoModal('Аркуш із такою назвою вже існує.'); renderSheetTabs(); return; }
  sheets[i].name = name;
  renderSheetTabs();
  persistStateToStorage();
  setDirty(true);
  saveToHistory();
}

function deleteSheet(i) {
  if (sheets.length <= 1) { showInfoModal('Не можна видалити єдиний аркуш.'); return; }
  askConfirm(`Видалити аркуш «${sheets[i].name}»? Дані буде втрачено.`, () => {
    syncActiveSheetFromGlobals();
    sheets.splice(i, 1);
    if (activeSheet > i) activeSheet--;
    else if (activeSheet === i) activeSheet = Math.min(i, sheets.length - 1);
    rowFilter = null;
    loadGlobalsFromSheet(activeSheet);
    active = { c: 0, r: 1 };
    activeId = 'A1';
    selStart = { c: 0, r: 1 };
    selEnd = { c: 0, r: 1 };
    rebuildGrid();
    recalculateAll();
    renderSheetTabs();
    renderSel();
    persistStateToStorage();
    setDirty(true);
    saveToHistory();
  }, 'Видалити');
}

function promptRenameSheet(i) {
  const bar = document.getElementById('sheetTabs');
  const tab = bar?.children[i];
  if (!tab) return;
  const input = document.createElement('input');
  input.className = 'sheet-tab-input';
  input.value = sheets[i].name;
  input.maxLength = 31;
  let done = false;
  const commit = () => { if (done) return; done = true; renameSheet(i, input.value); };
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); commit(); }
    else if (e.key === 'Escape') { done = true; renderSheetTabs(); }
  });
  input.addEventListener('blur', commit);
  tab.replaceWith(input);
  input.focus();
  input.select();
}

function renderSheetTabs() {
  const bar = document.getElementById('sheetTabs');
  if (!bar) return;
  bar.innerHTML = '';

  sheets.forEach((s, i) => {
    const tab = document.createElement('button');
    tab.className = 'sheet-tab' + (i === activeSheet ? ' active' : '');
    tab.textContent = s.name;
    tab.title = 'Клік — перейти · подвійний клік — перейменувати · права кнопка — видалити';
    tab.addEventListener('click', () => switchToSheet(i));
    tab.addEventListener('dblclick', () => promptRenameSheet(i));
    tab.addEventListener('contextmenu', (e) => { e.preventDefault(); deleteSheet(i); });
    bar.appendChild(tab);
  });

  const add = document.createElement('button');
  add.className = 'sheet-tab-add';
  add.textContent = '+';
  add.title = 'Додати аркуш';
  add.setAttribute('aria-label', 'Додати аркуш');
  add.addEventListener('click', addSheet);
  bar.appendChild(add);
}

window.TablesSheets = {
  addSheet,
  deleteSheet,
  promptRenameSheet,
  renameSheet,
  renderSheetTabs,
  switchToSheet
};
