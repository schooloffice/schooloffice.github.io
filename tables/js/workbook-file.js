// ---- Workbook file I/O ----
function exportWorkbook() {
  const payload = {
    type: 'art-tables-workbook',
    version: 1,
    name: workbookName,
    rows: ROWS,
    cols: COL_COUNT,
    cellData,
    cellStyles,
    colWidths
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
    setGridSize(payload.rows || DEFAULT_ROWS, payload.cols || DEFAULT_COL_COUNT);
    cellData = payload.cellData && typeof payload.cellData === 'object' ? payload.cellData : {};
    cellStyles = payload.cellStyles && typeof payload.cellStyles === 'object' ? payload.cellStyles : {};
    colWidths = payload.colWidths && typeof payload.colWidths === 'object' ? payload.colWidths : {};

    rebuildGrid();
    recalculateAll();
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
