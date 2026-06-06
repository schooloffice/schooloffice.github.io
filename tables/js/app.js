window.TablesApp = window.TablesApp || {};

function runOfficeCommand(command) {
  return window.OfficeShell?.runCommand?.(command) || false;
}

function createShellCommands() {
  return {
    new: () => askConfirm('Створити нову таблицю? Поточні дані буде очищено.', clearAll, 'Створити'),
    open: triggerWorkbookImport,
    save: exportWorkbook,
    undo: undo,
    redo: redo
  };
}

// ---- Init ----
function initTablesEditor() {
  // Стан завантажується в logic.js при старті з localStorage (зберігається між сесіями)

  // bigger default grid (але без втрати даних)
  if (ROWS < 60 || COL_COUNT < 30) {
    setGridSize(Math.max(ROWS, 60), Math.max(COL_COUNT, 30));
  }


  gridWrap = document.getElementById('gridWrap');
  insertColBtn = document.getElementById('insertColBtn');
  insertRowBtn = document.getElementById('insertRowBtn');

  rebuildGrid();
  recalculateAll();
  persistStateToStorage();
  initFileNameUi();
  initMenusAndToolbar();
  restoreUiState();
  window.OfficeShell?.registerCommands?.('tables', createShellCommands()) ||
    window.OfficeUI?.registerCommands?.(createShellCommands(), { source: 'tables' });

  // formula bar
  const fb = document.getElementById('formulaBar');
  if (fb) {
    fb.addEventListener('input', (e) => {
      const v = String(e.target.value || '');
      if (v.length > 200) e.target.value = v.substring(0, 200);
      cellData[activeId] = e.target.value;
      setDirty(true);
      // mirror to cell if currently editing
      const inp = cellInp[active.r]?.[active.c];
      if (inp && document.activeElement === inp) inp.value = e.target.value;
    });

    fb.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        recalculateAll();
        persistStateToStorage();
        setSaveBadge();
        saveToHistory();
        const inp = cellInp[active.r]?.[active.c];
        if (inp) inp.focus();
      }
    });
  }

  // global mouse
  document.addEventListener('mouseup', () => {
    isSelecting = false;
    if (isResizing) {
      isResizing = false;
      resizeCol = null;
      saveToHistory();
    }
  });

  document.addEventListener('mousemove', (e) => {
    if (isResizing && resizeCol !== null) TablesColumnSizing.resizeColumn(e);
  });

  // insert hover
  if (gridWrap) {
    gridWrap.addEventListener('mousemove', TablesStructure.updateInsertHover);
    gridWrap.addEventListener('mouseleave', TablesStructure.hideInsertButtons);
    gridWrap.addEventListener('scroll', TablesStructure.hideInsertButtons);
  }

  if (insertColBtn) {
    insertColBtn.addEventListener('mousedown', (e) => e.preventDefault());
    insertColBtn.addEventListener('click', (e) => {
      e.preventDefault();
      if (hoverInsertColAt === null) return;
      TablesStructure.insertColumn(hoverInsertColAt);
      TablesStructure.hideInsertButtons();
    });
  }

  if (insertRowBtn) {
    insertRowBtn.addEventListener('mousedown', (e) => e.preventDefault());
    insertRowBtn.addEventListener('click', (e) => {
      e.preventDefault();
      if (hoverInsertRowAt === null) return;
      TablesStructure.insertRow(hoverInsertRowAt);
      TablesStructure.hideInsertButtons();
    });
  }

  document.addEventListener('focusin', (e) => {
    const inp = e.target;
    if (!(inp instanceof HTMLInputElement) || !inp.classList.contains('cell-input')) return;
    const td = inp.closest('td[data-id]');
    const id = td?.dataset.id;
    if (!id) return;
    const raw = cellData[id];
    if (raw !== undefined && raw !== null && raw !== '' && !String(raw).startsWith('=')) {
      inp.value = raw;
    }
  });

  // keyboard shortcuts
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeHeaderContextMenu();
    // Undo/redo
    if (e.ctrlKey || e.metaKey) {
      if (e.key.toLowerCase() === 'z' && !e.shiftKey) {
        e.preventDefault();
        runOfficeCommand('undo') || undo();
        return;
      }
      if (e.key.toLowerCase() === 'y' || (e.key.toLowerCase() === 'z' && e.shiftKey)) {
        e.preventDefault();
        runOfficeCommand('redo') || redo();
        return;
      }
      if (e.key.toLowerCase() === 's') {
        e.preventDefault();
        runOfficeCommand('save') || exportWorkbook();
        return;
      }
      if (e.key.toLowerCase() === 'n') {
        e.preventDefault();
        if (runOfficeCommand('new')) return;
        askConfirm('Створити нову таблицю? Поточні дані буде очищено.', clearAll);
        return;
      }
      if (e.key.toLowerCase() === 'o') {
        e.preventDefault();
        runOfficeCommand('open') || triggerWorkbookImport();
        return;
      }
      if (e.key.toLowerCase() === 'p') {
        e.preventDefault();
        window.print();
        return;
      }
      if (e.key.toLowerCase() === 'c') {
        const activeEl = document.activeElement;
        if (activeEl && (activeEl.tagName === 'INPUT' || activeEl.tagName === 'TEXTAREA')) {
          return; // allow normal copy in input fields
        }
        e.preventDefault();
        copySelectionToClipboard();
        return;
      }
      // Ctrl+V — вставити в активну клітинку якщо жодна не у фокусі
      if (e.key.toLowerCase() === 'v') {
        const activeEl = document.activeElement;
        if (!activeEl || (activeEl.tagName !== 'INPUT' && activeEl.tagName !== 'TEXTAREA')) {
          e.preventDefault();
          navigator.clipboard?.readText().then(text => {
            if (text) pasteToGrid(text, active.c, active.r);
          }).catch(() => {}); // тихо ігноруємо якщо немає дозволу
        }
        return;
      }
    }

    // Delete / Backspace (avoid when formula bar or cell active)
    if (e.key === 'Delete' || e.key === 'Backspace') {
      const activeEl = document.activeElement;
      if (activeEl && (activeEl.id === 'formulaBar' || activeEl.classList?.contains('cell-input'))) return;
      e.preventDefault();
      deleteSelection();
    }
  });

  // CSV import
  const csvInput = document.getElementById('csvFileInput');
  if (csvInput) {
    csvInput.addEventListener('change', () => {
      const file = csvInput.files?.[0];
      if (!file) return;

      // Обмеження розміру файлу: 2 МБ
      if (file.size > 2 * 1024 * 1024) {
        showInfoModal('❌ Файл CSV завеликий (максимум 2 МБ). Будь ласка, оберіть менший файл.');
        csvInput.value = '';
        return;
      }

      const reader = new FileReader();
      reader.onload = () => {
        const text = String(reader.result || '');
        const rows = parseCSV(text);

        // Обмеження рядків/колонок
        if (rows.length > 500) {
          showInfoModal(`❌ Файл CSV має ${rows.length} рядків — це забагато (максимум 500).`);
          csvInput.value = '';
          return;
        }
        const cCount = rows.reduce((m, r) => Math.max(m, r.length), 0);
        if (cCount > 200) {
          showInfoModal(`❌ Файл CSV має ${cCount} колонок — це забагато (максимум 200).`);
          csvInput.value = '';
          return;
        }

        askConfirm(`Імпортувати CSV і перезаписати таблицю?\nРозмір: ${rows.length}×${cCount}`, () => {
          importCSVText(text);
        });
      };
      reader.readAsText(file);
    });
  }

  const workbookInput = document.getElementById('workbookFileInput');
  if (workbookInput) {
    workbookInput.addEventListener('change', () => {
      const file = workbookInput.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => importWorkbookText(String(reader.result || ''));
      reader.readAsText(file);
    });
  }

  // Confirm modal YES
  const yesBtn = document.getElementById('confirmBtnYes');
  if (yesBtn) {
    yesBtn.addEventListener('click', () => {
      if (typeof confirmFn === 'function') confirmFn();
      closeModal('confirmModal');
    });
  }

  // Initial selection
  ensureCellWithinBounds();
  setActive(active.c, active.r, activeId);

  // Initial history
  saveToHistory();
  setSaveBadge();
  updateSelectionStats();

  // ---- Storage overflow/warning events ----
  window.addEventListener('storage-overflow', (e) => {
    const mb = (e.detail.bytes / 1024 / 1024).toFixed(1);
    showInfoModal(`⚠️ Таблиця завелика (${mb} МБ) — автозбереження заблоковано!
Збережи дані вручну через кнопку "Зберегти CSV".`);
  });

  window.addEventListener('storage-warning', (e) => {
    const mb = (e.detail.bytes / 1024 / 1024).toFixed(1);
    const badge = document.getElementById('saveBadge');
    if (badge) {
      badge.textContent = `⚠️ Багато даних (${mb} МБ)`;
      badge.style.color = '#f59e0b';
      badge.style.opacity = 1;
      setTimeout(() => {
        badge.style.opacity = 0;
        badge.textContent = 'Збережено';
        badge.style.color = '';
      }, 3000);
    }
  });

  // ---- Touch support (планшети / телефони) ----
  initTouchSupport();
}

function initTouchSupport() {
  const tableEl = document.getElementById('grid');
  if (!tableEl) return;

  let touchStartC = null;
  let touchStartR = null;
  let lastTouchC   = null;
  let lastTouchR   = null;
  let isDragging   = false;
  let tapTimer     = null;
  let lastTapId    = null;
  const DRAG_THRESHOLD_PX = 10;
  let touchStartX  = 0;
  let touchStartY  = 0;

  // Визначаємо TD під пальцем за координатами
  function tdFromPoint(x, y) {
    // Ховаємо верхній шар, щоб elementFromPoint знайшов TD під ним
    const el = document.elementFromPoint(x, y);
    if (!el) return null;
    return el.closest('td[data-id]');
  }

  tableEl.addEventListener('touchstart', (e) => {
    const touch = e.touches[0];
    touchStartX = touch.clientX;
    touchStartY = touch.clientY;
    isDragging  = false;

    const td = tdFromPoint(touch.clientX, touch.clientY);
    if (!td) return;

    touchStartC = parseInt(td.dataset.c, 10);
    touchStartR = parseInt(td.dataset.r, 10);
    lastTouchC  = touchStartC;
    lastTouchR  = touchStartR;

    // Починаємо виділення одразу
    selStart = { c: touchStartC, r: touchStartR };
    selEnd   = { c: touchStartC, r: touchStartR };
    setActive(touchStartC, touchStartR, td.dataset.id, { keepSelection: true });
    renderSel();
  }, { passive: true });

  tableEl.addEventListener('touchmove', (e) => {
    const touch = e.touches[0];
    const dx = touch.clientX - touchStartX;
    const dy = touch.clientY - touchStartY;

    if (!isDragging && (Math.abs(dx) > DRAG_THRESHOLD_PX || Math.abs(dy) > DRAG_THRESHOLD_PX)) {
      isDragging = true;
    }

    if (!isDragging) return;

    const td = tdFromPoint(touch.clientX, touch.clientY);
    if (!td) return;

    const c = parseInt(td.dataset.c, 10);
    const r = parseInt(td.dataset.r, 10);

    // Оновлюємо виділення тільки якщо клітинка змінилась
    if (c === lastTouchC && r === lastTouchR) return;
    lastTouchC = c;
    lastTouchR = r;

    // Розтягуємо виділення від startCell до поточної
    selStart = { c: touchStartC, r: touchStartR };
    selEnd   = { c, r };
    renderSel();

    // Не дозволяємо скролити сторінку під час виділення
    e.preventDefault();
  }, { passive: false });

  tableEl.addEventListener('touchend', (e) => {
    if (isDragging) {
      // Завершили drag-виділення
      isDragging = false;
      return;
    }

    // Простий tap — фокус на клітинку + відкрити клавіатуру
    const touch = e.changedTouches[0];
    const td = tdFromPoint(touch.clientX, touch.clientY);
    if (!td) return;

    const c   = parseInt(td.dataset.c, 10);
    const r   = parseInt(td.dataset.r, 10);
    const id  = td.dataset.id;

    // Подвійний tap — редагування (якщо та сама клітинка)
    if (lastTapId === id) {
      clearTimeout(tapTimer);
      lastTapId = null;
      const inp = cellInp[r]?.[c];
      if (inp) {
        e.preventDefault();
        inp.focus();
        // Показуємо сиру формулу в режимі редагування
        const raw = cellData[id];
        if (raw !== undefined) inp.value = raw;
      }
      return;
    }

    lastTapId = id;
    tapTimer = setTimeout(() => { lastTapId = null; }, 400);

    selStart = { c, r };
    selEnd   = { c, r };
    setActive(c, r, id);
    renderSel();

    // На мобільному одним tapом відкриваємо клавіатуру
    const inp = cellInp[r]?.[c];
    if (inp) {
      e.preventDefault();
      inp.focus();
    }
  }, { passive: false });

  // Pinch-zoom — блокуємо тільки на таблиці
  tableEl.addEventListener('touchmove', (e) => {
    if (e.touches.length > 1) e.preventDefault();
  }, { passive: false });
}

window.TablesApp.boot = initTablesEditor;
window.initTablesApp = initTablesEditor;
