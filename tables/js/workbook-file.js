// ---- Workbook file I/O ----
function exportWorkbook() {
  syncActiveSheetFromGlobals();
  const payload = {
    type: 'art-tables-workbook',
    version: 2,
    name: workbookName,
    activeSheet,
    sheets
  };

  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${normalizeFileName(workbookName)}.arttab`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  setSaveBadge();
}

function triggerWorkbookImport() {
  const input = document.getElementById('workbookFileInput');
  if (!input) return;
  if (window.OfficeUI?.openFilePicker?.(input)) return;
  input.value = '';
  input.click();
}

function importWorkbookText(text) {
  try {
    const payload = JSON.parse(text);
    if (!payload || typeof payload !== 'object') throw new Error('Некоректний файл');

    saveToHistory();

    workbookName = normalizeFileName(payload.name || DEFAULT_WORKBOOK_NAME);
    updateFileNameUi();

    if (Array.isArray(payload.sheets) && payload.sheets.length) {
      sheets = payload.sheets.map(normalizeSheet);
      activeSheet = Math.max(0, Math.min(sheets.length - 1, Number(payload.activeSheet) || 0));
    } else {
      // Старий формат v1 (один аркуш)
      sheets = [normalizeSheet({
        name: 'Аркуш1',
        cellData: payload.cellData,
        cellStyles: payload.cellStyles,
        colWidths: payload.colWidths,
        condRules: payload.condRules,
        rows: payload.rows,
        cols: payload.cols
      })];
      activeSheet = 0;
    }
    rowFilter = null;
    loadGlobalsFromSheet(activeSheet);

    rebuildGrid();
    recalculateAll();
    renderSheetTabs();
    persistStateToStorage();
    persistUiState();
    setSaveBadge();
    saveToHistory();
  } catch (e) {
    showInfoModal(`Не вдалося відкрити файл: ${e?.message || 'помилка читання'}`);
  }
}

window.TablesWorkbookFile = {
  exportWorkbook,
  importWorkbookText,
  triggerWorkbookImport
};
