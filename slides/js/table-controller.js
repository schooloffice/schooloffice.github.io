import {
  applyTableStylePreset,
  clearTableRange,
  clearTableRangeStyle,
  copyTableRange,
  createTableElement,
  deleteTableColumn,
  deleteTableRow,
  getTableMergeAt,
  getTableStylePresetKey,
  insertTableColumn,
  insertTableRow,
  mergeTableRange,
  pasteTableRange,
  resizeTable,
  setTableCellStyle,
  setTableRangeStyle,
  setTableTrackWeights,
  splitTableCell,
  tableColumnHasData,
  TABLE_LIMITS,
  tableRangeIntersectsMerge,
  tableResizeLosesData,
  tableRowHasData,
  TABLE_STYLE_PRESETS
} from './table-element.js';
import { getCurrentSlide, getSelectedElement, state } from './state.js';
import { $, clamp, createNode, debounce } from './utils.js';

function createOption(value, text, selected = false) {
  return createNode('option', { text, properties: { value, selected } });
}

function createNumberField(id, min, max, value, step = 1) {
  return createNode('input', {
    id,
    className: 'input-like',
    attributes: { type: 'number', min, max, step },
    properties: { value }
  });
}

function createCheckbox(id, checked = false) {
  return createNode('input', { id, attributes: { type: 'checkbox' }, properties: { checked } });
}

function createSelect(id, options, selected) {
  return createNode('select', { id, className: 'input-like' },
    options.map(([value, text]) => createOption(value, text, value === selected))
  );
}

export function createTableController({
  elementDomMap,
  findElementById,
  markDirty,
  pushHistory,
  renderCurrentSlideWorkspace,
  renderSlideList,
  renderSlideThumbnail,
  setStatusRight,
  showConfirmModal,
  showInfoModal,
  showModal
}) {
  let activeCell = null;
  let selectionRange = null;
  let clipboard = null;
  const pendingThumbnailSlideIds = new Set();
  const flushThumbnails = debounce(() => {
    const slideIds = [...pendingThumbnailSlideIds];
    pendingThumbnailSlideIds.clear();
    slideIds.forEach(slideId => {
      if (!renderSlideThumbnail(slideId)) renderSlideList();
    });
  }, 200);

  function scheduleThumbnail(slideId = state.currentSlideId) {
    if (!slideId) return;
    pendingThumbnailSlideIds.add(slideId);
    flushThumbnails();
  }

  function clearSelection() {
    activeCell = null;
    selectionRange = null;
    elementDomMap.forEach(node => node.querySelectorAll('.slide-table-cell.range-selected').forEach(cell => cell.classList.remove('range-selected')));
  }

  function normalizeSelection() {
    const slide = getCurrentSlide();
    const element = slide?.elements.find(item => item.id === activeCell?.elementId && item.type === 'table');
    if (!element || state.selectedElementIds.length !== 1 || state.selectedElementIds[0] !== element.id) {
      clearSelection();
      return;
    }
    const rows = element.table.rows;
    const cols = element.table.cols;
    activeCell = {
      elementId: element.id,
      row: clamp(activeCell.row, 0, rows - 1),
      col: clamp(activeCell.col, 0, cols - 1)
    };
    if (selectionRange?.elementId !== element.id) {
      selectionRange = { elementId: element.id, startRow: activeCell.row, endRow: activeCell.row, startCol: activeCell.col, endCol: activeCell.col };
      return;
    }
    selectionRange = {
      elementId: element.id,
      startRow: clamp(selectionRange.startRow, 0, rows - 1),
      endRow: clamp(selectionRange.endRow, 0, rows - 1),
      startCol: clamp(selectionRange.startCol, 0, cols - 1),
      endCol: clamp(selectionRange.endCol, 0, cols - 1)
    };
  }

  function selectionChanged(ids) {
    if (ids.length !== 1 || ids[0] !== activeCell?.elementId) clearSelection();
  }

  function selectCell(elementId, row, col, extend = false) {
    if (extend && selectionRange?.elementId === elementId) {
      selectionRange = { ...selectionRange, endRow: row, endCol: col };
    } else {
      selectionRange = { elementId, startRow: row, endRow: row, startCol: col, endCol: col };
    }
    activeCell = { elementId, row, col };
    elementDomMap.get(elementId)?.querySelectorAll('.slide-table-cell').forEach(cell => {
      const cellRow = Number(cell.dataset.row);
      const cellCol = Number(cell.dataset.col);
      const selected = cellRow >= Math.min(selectionRange.startRow, selectionRange.endRow) &&
        cellRow <= Math.max(selectionRange.startRow, selectionRange.endRow) &&
        cellCol >= Math.min(selectionRange.startCol, selectionRange.endCol) &&
        cellCol <= Math.max(selectionRange.startCol, selectionRange.endCol);
      cell.classList.toggle('range-selected', selected);
    });
  }

  function navigateCell(elementId, row, col, dir, extend) {
    const element = findElementById(elementId);
    if (element?.type !== 'table') return;
    const table = element.table;
    if (extend) {
      if (selectionRange?.elementId !== elementId) selectCell(elementId, row, col, false);
      const dr = dir === 'up' ? -1 : dir === 'down' ? 1 : 0;
      const dc = dir === 'left' ? -1 : dir === 'right' ? 1 : 0;
      selectCell(
        elementId,
        clamp(selectionRange.endRow + dr, 0, table.rows - 1),
        clamp(selectionRange.endCol + dc, 0, table.cols - 1),
        true
      );
      return;
    }
    const target = tableNavTarget(table, row, col, dir);
    selectCell(elementId, target.row, target.col, false);
    elementDomMap.get(elementId)?.querySelector(`.slide-table-cell[data-row="${target.row}"][data-col="${target.col}"]`)?.focus({ preventScroll: true });
  }

  function tableNavTarget(table, row, col, dir) {
    const merge = getTableMergeAt(table, row, col);
    let nextRow = row;
    let nextCol = col;
    if (dir === 'up') nextRow = (merge ? merge.top : row) - 1;
    else if (dir === 'down') nextRow = (merge ? merge.bottom : row) + 1;
    else if (dir === 'left') nextCol = (merge ? merge.left : col) - 1;
    else if (dir === 'right') nextCol = (merge ? merge.right : col) + 1;
    nextRow = clamp(nextRow, 0, table.rows - 1);
    nextCol = clamp(nextCol, 0, table.cols - 1);
    const targetMerge = getTableMergeAt(table, nextRow, nextCol);
    return targetMerge ? { row: targetMerge.top, col: targetMerge.left } : { row: nextRow, col: nextCol };
  }

  function focusActiveCellPreservingRange() {
    if (!activeCell || !selectionRange) return;
    const active = { ...activeCell };
    const range = { ...selectionRange };
    const cell = elementDomMap.get(active.elementId)?.querySelector(`.slide-table-cell[data-row="${active.row}"][data-col="${active.col}"]`);
    if (!cell) return;
    cell.focus({ preventScroll: true });
    activeCell = active;
    selectionRange = range;
    selectCell(range.elementId, range.startRow, range.startCol);
    selectCell(range.elementId, range.endRow, range.endCol, true);
    activeCell = active;
  }

  function getActiveRange() {
    const element = findElementById(activeCell?.elementId);
    if (element?.type !== 'table' || selectionRange?.elementId !== element.id) return null;
    return {
      element,
      range: selectionRange,
      count: (Math.abs(selectionRange.endRow - selectionRange.startRow) + 1) *
        (Math.abs(selectionRange.endCol - selectionRange.startCol) + 1)
    };
  }

  function copySelectedRange() {
    const selected = getActiveRange();
    if (!selected || selected.count < 2) return false;
    if (tableRangeIntersectsMerge(selected.element.table, selected.range)) {
      setStatusRight('Спочатку розділіть об’єднані комірки для копіювання діапазону');
      return false;
    }
    clipboard = copyTableRange(selected.element.table, selected.range);
    setStatusRight(`Скопійовано ${selected.count} комірок`);
    return true;
  }

  function clearSelectedRange() {
    const selected = getActiveRange();
    if (!selected || selected.count < 2) return false;
    if (tableRangeIntersectsMerge(selected.element.table, selected.range)) {
      setStatusRight('Спочатку розділіть об’єднані комірки для очищення діапазону');
      return false;
    }
    const next = clearTableRange(selected.element.table, selected.range);
    if (JSON.stringify(next.cells) === JSON.stringify(selected.element.table.cells)) return true;
    pushHistory();
    selected.element.table = next;
    renderCurrentSlideWorkspace();
    focusActiveCellPreservingRange();
    markDirty(`Очищено ${selected.count} комірок`);
    return true;
  }

  function pasteCopiedRange() {
    const selected = getActiveRange();
    if (!selected || !clipboard) return false;
    const { row, col } = activeCell;
    const targetRange = {
      startRow: row,
      endRow: Math.min(selected.element.table.rows - 1, row + clipboard.rows - 1),
      startCol: col,
      endCol: Math.min(selected.element.table.cols - 1, col + clipboard.cols - 1)
    };
    if (tableRangeIntersectsMerge(selected.element.table, targetRange)) {
      setStatusRight('Спочатку розділіть об’єднані комірки для вставлення діапазону');
      return false;
    }
    const next = pasteTableRange(selected.element.table, row, col, clipboard);
    if (JSON.stringify(next) === JSON.stringify(selected.element.table)) return true;
    pushHistory();
    selected.element.table = next;
    selectionRange = {
      elementId: selected.element.id,
      startRow: row,
      endRow: Math.min(next.rows - 1, row + clipboard.rows - 1),
      startCol: col,
      endCol: Math.min(next.cols - 1, col + clipboard.cols - 1)
    };
    renderCurrentSlideWorkspace();
    focusActiveCellPreservingRange();
    markDirty('Вставлено діапазон комірок');
    return true;
  }

  function showTableModal(mode = 'insert') {
    const current = mode === 'edit' ? getSelectedElement() : null;
    if (mode === 'edit' && current?.type !== 'table') {
      showInfoModal('Змінити таблицю', 'Виберіть одну таблицю.');
      return;
    }
    const table = current?.table;
    const currentPreset = table ? getTableStylePresetKey(table) : 'blue';
    const names = { blue: 'Синій', green: 'Зелений', orange: 'Помаранчевий', gray: 'Сірий' };
    const rowsField = createNumberField('tableRowsField', TABLE_LIMITS.MIN_ROWS, TABLE_LIMITS.MAX_ROWS, table?.rows || 3);
    const colsField = createNumberField('tableColsField', TABLE_LIMITS.MIN_COLS, TABLE_LIMITS.MAX_COLS, table?.cols || 4);
    const headerField = createNode('input', {
      id: 'tableHeaderField',
      attributes: { type: 'checkbox' },
      properties: { checked: table?.style?.headerRow !== false }
    });
    const styleField = createNode('select', { id: 'tableStyleField', className: 'input-like' });
    if (table && !currentPreset) styleField.appendChild(createOption('custom', 'Власний', true));
    Object.keys(TABLE_STYLE_PRESETS).forEach(key => styleField.appendChild(createOption(key, names[key], key === currentPreset)));
    const bodyNode = createNode('div', { className: 'form-grid table-form' },
      createNode('label', {}, 'Рядки ', rowsField),
      createNode('label', {}, 'Стовпці ', colsField),
      createNode('label', { className: 'checkbox-row' }, headerField, ' Перший рядок — заголовок'),
      createNode('label', { className: 'table-style-field' }, 'Стиль ', styleField)
    );
    if (mode === 'edit') {
      bodyNode.appendChild(createNode('label', {
        id: 'tableResizeWarning',
        className: 'checkbox-row destructive-warning hidden'
      }, createNode('input', { id: 'tableResizeConfirmField', attributes: { type: 'checkbox' } }), ' Видалити обрізані заповнені комірки та їх форматування'));
    }
    showModal({
      title: mode === 'edit' ? 'Змінити таблицю' : 'Вставити таблицю',
      text: 'Оберіть кількість рядків і стовпців. Під час зміни розміру текст зберігається в межах нової таблиці.',
      bodyNode,
      confirmText: mode === 'edit' ? 'Застосувати' : 'Вставити',
      cancelText: 'Скасувати',
      onConfirm: () => {
        const rows = clamp(Math.round(Number($('#tableRowsField').value)), TABLE_LIMITS.MIN_ROWS, TABLE_LIMITS.MAX_ROWS);
        const cols = clamp(Math.round(Number($('#tableColsField').value)), TABLE_LIMITS.MIN_COLS, TABLE_LIMITS.MAX_COLS);
        const headerRow = $('#tableHeaderField').checked;
        const preset = $('#tableStyleField').value;
        if (mode === 'edit') {
          if (current.table.merges?.length && (rows !== current.table.rows || cols !== current.table.cols)) {
            showInfoModal('Змінити розмір таблиці', 'Спочатку розділіть об’єднані комірки. Зміна структури таблиці з об’єднаннями поки не підтримується.');
            return false;
          }
          if (tableResizeLosesData(current.table, rows, cols) && !$('#tableResizeConfirmField').checked) {
            $('#tableResizeWarning').classList.remove('hidden');
            return false;
          }
          const resized = resizeTable(current.table, rows, cols);
          const next = preset === 'custom' ? resized : applyTableStylePreset(resized, preset);
          next.style.headerRow = headerRow;
          if (JSON.stringify(next) === JSON.stringify(current.table)) return;
          pushHistory();
          current.table = next;
          renderCurrentSlideWorkspace();
          markDirty('Таблицю змінено');
          return;
        }
        pushHistory();
        const slide = getCurrentSlide();
        const element = createTableElement(rows, cols, {
          z: slide.elements.length + 1,
          table: applyTableStylePreset({ rows, cols, style: { headerRow } }, preset)
        });
        slide.elements.push(element);
        state.selectedElementIds = [element.id];
        renderCurrentSlideWorkspace();
        markDirty('Додано таблицю');
        requestAnimationFrame(() => elementDomMap.get(element.id)?.querySelector('.slide-table-cell')?.focus());
      }
    });
  }

  function changeStructure(action) {
    const element = getSelectedElement();
    if (element?.type !== 'table' || activeCell?.elementId !== element.id) {
      showInfoModal('Змінити таблицю', 'Спочатку виберіть комірку таблиці.');
      return;
    }
    const { row, col } = activeCell;
    const operations = {
      'row-before': () => insertTableRow(element.table, row),
      'row-after': () => insertTableRow(element.table, row + 1),
      'row-delete': () => deleteTableRow(element.table, row),
      'col-before': () => insertTableColumn(element.table, col),
      'col-after': () => insertTableColumn(element.table, col + 1),
      'col-delete': () => deleteTableColumn(element.table, col)
    };
    const next = operations[action]?.();
    if (!next || JSON.stringify(next) === JSON.stringify(element.table)) return;
    const applyChange = () => {
      pushHistory();
      element.table = next;
      activeCell = { elementId: element.id, row: clamp(row, 0, next.rows - 1), col: clamp(col, 0, next.cols - 1) };
      selectionRange = { elementId: element.id, startRow: activeCell.row, endRow: activeCell.row, startCol: activeCell.col, endCol: activeCell.col };
      renderCurrentSlideWorkspace();
      markDirty('Структуру таблиці змінено');
    };
    const losesData = action === 'row-delete'
      ? tableRowHasData(element.table, row)
      : action === 'col-delete' && tableColumnHasData(element.table, col);
    if (losesData) {
      showConfirmModal({
        title: action === 'row-delete' ? 'Видалити заповнений рядок?' : 'Видалити заповнений стовпець?',
        text: 'Комірки, їх форматування та налаштований розмір буде видалено. Дію можна скасувати через Undo.',
        confirmText: 'Видалити',
        onConfirm: applyChange
      });
      return;
    }
    applyChange();
  }

  function mergeSelectedCells() {
    const selected = getActiveRange();
    if (!selected || selected.count < 2) {
      showInfoModal('Об’єднати комірки', 'Виділіть прямокутний діапазон із двох або більше комірок.');
      return;
    }
    if (tableRangeIntersectsMerge(selected.element.table, selected.range)) {
      showInfoModal('Об’єднати комірки', 'Виділений діапазон перетинає вже об’єднані комірки. Спочатку розділіть їх.');
      return;
    }
    const top = Math.min(selected.range.startRow, selected.range.endRow);
    const left = Math.min(selected.range.startCol, selected.range.endCol);
    const next = mergeTableRange(selected.element.table, selected.range);
    if (JSON.stringify(next) === JSON.stringify(selected.element.table)) {
      showInfoModal('Об’єднати комірки', `Сумарний текст завеликий для однієї комірки. Скоротіть його до ${TABLE_LIMITS.MAX_CELL_LENGTH} символів.`);
      return;
    }
    pushHistory();
    selected.element.table = next;
    activeCell = { elementId: selected.element.id, row: top, col: left };
    selectionRange = { elementId: selected.element.id, startRow: top, endRow: top, startCol: left, endCol: left };
    renderCurrentSlideWorkspace();
    focusActiveCellPreservingRange();
    markDirty('Комірки об’єднано');
  }

  function splitActiveCell() {
    const selected = getActiveRange();
    if (!selected) return;
    const merge = getTableMergeAt(selected.element.table, activeCell.row, activeCell.col);
    if (!merge) {
      showInfoModal('Розділити комірки', 'Активна комірка не об’єднана.');
      return;
    }
    pushHistory();
    selected.element.table = splitTableCell(selected.element.table, activeCell.row, activeCell.col);
    selectionRange = { elementId: selected.element.id, startRow: merge.top, endRow: merge.bottom, startCol: merge.left, endCol: merge.right };
    renderCurrentSlideWorkspace();
    focusActiveCellPreservingRange();
    markDirty('Комірки розділено');
  }

  function showCellFormatModal() {
    const element = getSelectedElement();
    if (element?.type !== 'table' || activeCell?.elementId !== element.id) {
      showInfoModal('Формат комірки', 'Спочатку виберіть комірку таблиці.');
      return;
    }
    const { row, col } = activeCell;
    const range = selectionRange?.elementId === element.id
      ? selectionRange
      : { startRow: row, endRow: row, startCol: col, endCol: col };
    const selectedCount = (Math.abs(range.endRow - range.startRow) + 1) * (Math.abs(range.endCol - range.startCol) + 1);
    const style = element.table.cellStyles?.[row]?.[col] || {};
    const tableStyle = element.table.style;
    const header = tableStyle.headerRow && row === 0;
    const alternate = !header && row % 2 === 0;
    const effective = {
      fill: style.fill || (header ? tableStyle.headerFill : (alternate ? tableStyle.altFill : tableStyle.bodyFill)),
      color: style.color || (header ? tableStyle.headerColor : tableStyle.textColor),
      bold: typeof style.bold === 'boolean' ? style.bold : header,
      align: style.align || 'left',
      valign: style.valign || 'top'
    };
    const fillField = createNode('input', { id: 'tableCellFillField', className: 'input-like color-input', attributes: { type: 'color' }, properties: { value: effective.fill } });
    const colorField = createNode('input', { id: 'tableCellColorField', className: 'input-like color-input', attributes: { type: 'color' }, properties: { value: effective.color } });
    const alignField = createSelect('tableCellAlignField', [['left', 'Ліворуч'], ['center', 'По центру'], ['right', 'Праворуч']], effective.align);
    const valignField = createSelect('tableCellVAlignField', [['top', 'Вгорі'], ['middle', 'Посередині'], ['bottom', 'Внизу']], effective.valign);
    const boldField = createCheckbox('tableCellBoldField', effective.bold);
    const bodyNode = createNode('div', { className: 'form-grid table-cell-format' },
      createNode('label', {}, 'Заливка ', fillField),
      createNode('label', {}, 'Колір тексту ', colorField),
      createNode('label', {}, 'Вирівнювання ', alignField),
      createNode('label', {}, 'По вертикалі ', valignField),
      createNode('label', { className: 'checkbox-row' }, boldField, ' Жирний текст')
    );
    if (selectedCount > 1) {
      bodyNode.appendChild(createNode('fieldset', { className: 'table-range-properties' },
        createNode('legend', { text: 'Застосувати до всього діапазону' }),
        createNode('label', {}, createCheckbox('tableApplyFillField'), ' заливку'),
        createNode('label', {}, createCheckbox('tableApplyColorField'), ' колір тексту'),
        createNode('label', {}, createCheckbox('tableApplyAlignField'), ' вирівнювання'),
        createNode('label', {}, createCheckbox('tableApplyVAlignField'), ' вертикальне вирівнювання'),
        createNode('label', {}, createCheckbox('tableApplyBoldField'), ' жирність')
      ));
    }
    bodyNode.appendChild(createNode('label', { className: 'checkbox-row' }, createCheckbox('tableCellClearField'), ' Очистити власне форматування й успадкувати стиль таблиці'));
    showModal({
      title: selectedCount > 1 ? `Формат діапазону (${selectedCount} комірок)` : `Формат комірки ${row + 1}, ${col + 1}`,
      text: selectedCount > 1 ? 'Налаштування застосовуються до всього виділеного прямокутника.' : 'Налаштування застосовуються лише до активної комірки.',
      bodyNode,
      confirmText: 'Застосувати',
      cancelText: 'Скасувати',
      onMount: () => {
        if (selectedCount <= 1) return;
        [
          ['tableCellFillField', 'tableApplyFillField'],
          ['tableCellColorField', 'tableApplyColorField'],
          ['tableCellAlignField', 'tableApplyAlignField'],
          ['tableCellVAlignField', 'tableApplyVAlignField'],
          ['tableCellBoldField', 'tableApplyBoldField']
        ].forEach(([controlId, applyId]) => $(`#${controlId}`).addEventListener('input', () => { $(`#${applyId}`).checked = true; }));
      },
      onConfirm: () => {
        const clearStyle = $('#tableCellClearField').checked;
        const requested = {};
        if (selectedCount > 1) {
          if ($('#tableApplyFillField').checked) requested.fill = $('#tableCellFillField').value;
          if ($('#tableApplyColorField').checked) requested.color = $('#tableCellColorField').value;
          if ($('#tableApplyAlignField').checked) requested.align = $('#tableCellAlignField').value;
          if ($('#tableApplyVAlignField').checked) requested.valign = $('#tableCellVAlignField').value;
          if ($('#tableApplyBoldField').checked) requested.bold = $('#tableCellBoldField').checked;
        } else {
          if ($('#tableCellFillField').value !== effective.fill) requested.fill = $('#tableCellFillField').value;
          if ($('#tableCellColorField').value !== effective.color) requested.color = $('#tableCellColorField').value;
          if ($('#tableCellAlignField').value !== effective.align) requested.align = $('#tableCellAlignField').value;
          if ($('#tableCellVAlignField').value !== effective.valign) requested.valign = $('#tableCellVAlignField').value;
          if ($('#tableCellBoldField').checked !== effective.bold) requested.bold = $('#tableCellBoldField').checked;
        }
        if (!clearStyle && Object.keys(requested).length === 0) return;
        const next = clearStyle
          ? clearTableRangeStyle(element.table, range)
          : selectedCount > 1
            ? setTableRangeStyle(element.table, range, requested)
            : setTableCellStyle(element.table, row, col, requested);
        if (JSON.stringify(next) === JSON.stringify(element.table)) return;
        pushHistory();
        element.table = next;
        renderCurrentSlideWorkspace();
        markDirty('Формат комірки змінено');
      }
    });
  }

  function showTrackSizeModal() {
    const element = getSelectedElement();
    if (element?.type !== 'table' || activeCell?.elementId !== element.id) {
      showInfoModal('Розмір рядка та стовпця', 'Спочатку виберіть комірку таблиці.');
      return;
    }
    const { row, col } = activeCell;
    const rowPercent = Math.round((element.table.rowWeights?.[row] || 1) * 100);
    const columnPercent = Math.round((element.table.columnWeights?.[col] || 1) * 100);
    const bodyNode = createNode('div', { className: 'form-grid table-form' },
      createNode('label', {}, 'Висота рядка, % ', createNumberField('tableRowWeightField', 25, 400, rowPercent, 5)),
      createNode('label', {}, 'Ширина стовпця, % ', createNumberField('tableColumnWeightField', 25, 400, columnPercent, 5))
    );
    showModal({
      title: `Розмір рядка ${row + 1} та стовпця ${col + 1}`,
      text: 'Задайте відносний розмір. 100% — стандартний; таблиця зберігає пропорції під час масштабування.',
      bodyNode,
      confirmText: 'Застосувати',
      cancelText: 'Скасувати',
      onConfirm: () => {
        const rowValue = $('#tableRowWeightField').value.trim();
        const columnValue = $('#tableColumnWeightField').value.trim();
        const requestedRowWeight = rowValue ? Number(rowValue) / 100 : element.table.rowWeights[row];
        const requestedColumnWeight = columnValue ? Number(columnValue) / 100 : element.table.columnWeights[col];
        const rowWeight = clamp(Number.isFinite(requestedRowWeight) ? requestedRowWeight : element.table.rowWeights[row], TABLE_LIMITS.MIN_TRACK_WEIGHT, TABLE_LIMITS.MAX_TRACK_WEIGHT);
        const columnWeight = clamp(Number.isFinite(requestedColumnWeight) ? requestedColumnWeight : element.table.columnWeights[col], TABLE_LIMITS.MIN_TRACK_WEIGHT, TABLE_LIMITS.MAX_TRACK_WEIGHT);
        const next = setTableTrackWeights(element.table, row, col, rowWeight, columnWeight);
        if (JSON.stringify(next) === JSON.stringify(element.table)) return;
        pushHistory();
        element.table = next;
        renderCurrentSlideWorkspace();
        markDirty('Розмір рядка та стовпця змінено');
      }
    });
  }

  return {
    changeStructure,
    clearClipboard: () => { clipboard = null; },
    clearSelectedRange,
    clearSelection,
    copySelectedRange,
    getActiveCell: () => activeCell,
    getActiveRange,
    getSelectionRange: () => selectionRange,
    hasClipboard: () => !!clipboard,
    isActiveForElement: element => element?.type === 'table' && activeCell?.elementId === element.id,
    mergeSelectedCells,
    navigateCell,
    normalizeSelection,
    pasteCopiedRange,
    scheduleThumbnail,
    selectCell,
    selectionChanged,
    showCellFormatModal,
    showTableModal,
    showTrackSizeModal,
    splitActiveCell
  };
}
