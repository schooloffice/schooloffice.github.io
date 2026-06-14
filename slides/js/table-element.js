import { LIMITS } from './constants.js';
import { clamp, uid } from './utils.js';

export const TABLE_LIMITS = {
  MIN_ROWS: 1,
  MAX_ROWS: 20,
  MIN_COLS: 1,
  MAX_COLS: 10,
  MAX_MERGES: 100,
  MAX_CELL_LENGTH: 2000,
  MIN_TRACK_WEIGHT: 0.25,
  MAX_TRACK_WEIGHT: 4
};

const DEFAULT_TABLE_STYLE = {
  headerRow: true,
  headerFill: '#2563eb',
  headerColor: '#ffffff',
  bodyFill: '#ffffff',
  altFill: '#eff6ff',
  textColor: '#111827',
  borderColor: '#94a3b8',
  fontSize: 20
};

export const TABLE_STYLE_PRESETS = {
  blue: {
    headerFill: '#2563eb',
    altFill: '#eff6ff',
    borderColor: '#94a3b8'
  },
  green: {
    headerFill: '#15803d',
    altFill: '#f0fdf4',
    borderColor: '#86efac'
  },
  orange: {
    headerFill: '#c2410c',
    altFill: '#fff7ed',
    borderColor: '#fdba74'
  },
  gray: {
    headerFill: '#334155',
    altFill: '#f1f5f9',
    borderColor: '#94a3b8'
  }
};

function safeColor(value, fallback) {
  return typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value) ? value : fallback;
}

function safeCell(value) {
  return typeof value === 'string' ? value.slice(0, Math.min(LIMITS.MAX_TEXT_LENGTH, TABLE_LIMITS.MAX_CELL_LENGTH)) : '';
}

function safeTrackWeight(value) {
  return Number.isFinite(value) ? clamp(value, TABLE_LIMITS.MIN_TRACK_WEIGHT, TABLE_LIMITS.MAX_TRACK_WEIGHT) : 1;
}

function normalizeCellStyle(value) {
  const source = value && typeof value === 'object' ? value : {};
  const style = {};
  if (typeof source.fill === 'string' && /^#[0-9a-f]{6}$/i.test(source.fill)) style.fill = source.fill;
  if (typeof source.color === 'string' && /^#[0-9a-f]{6}$/i.test(source.color)) style.color = source.color;
  if (typeof source.bold === 'boolean') style.bold = source.bold;
  if (['left', 'center', 'right'].includes(source.align)) style.align = source.align;
  if (['top', 'middle', 'bottom'].includes(source.valign)) style.valign = source.valign;
  return style;
}

function patchCellStyle(current, patch) {
  const next = { ...normalizeCellStyle(current) };
  const cleanPatch = normalizeCellStyle(patch);
  Object.keys(cleanPatch).forEach(key => { next[key] = cleanPatch[key]; });
  return next;
}

function normalizeRange(table, range) {
  const next = normalizeTable(table);
  if (!range) return { table: next, top: 0, bottom: -1, left: 0, right: -1 };
  return {
    table: next,
    top: clamp(Math.min(range.startRow, range.endRow), 0, next.rows - 1),
    bottom: clamp(Math.max(range.startRow, range.endRow), 0, next.rows - 1),
    left: clamp(Math.min(range.startCol, range.endCol), 0, next.cols - 1),
    right: clamp(Math.max(range.startCol, range.endCol), 0, next.cols - 1)
  };
}

function normalizeMerge(value, rows, cols) {
  if (!value || typeof value !== 'object') return null;
  const top = clamp(Number.isInteger(value.top) ? value.top : 0, 0, rows - 1);
  const left = clamp(Number.isInteger(value.left) ? value.left : 0, 0, cols - 1);
  const bottom = clamp(Number.isInteger(value.bottom) ? value.bottom : top, top, rows - 1);
  const right = clamp(Number.isInteger(value.right) ? value.right : left, left, cols - 1);
  return bottom > top || right > left ? { top, bottom, left, right } : null;
}

function rangesIntersect(a, b) {
  return a.top <= b.bottom && a.bottom >= b.top && a.left <= b.right && a.right >= b.left;
}

export function normalizeTable(table) {
  const source = table && typeof table === 'object' ? table : {};
  const rows = clamp(Number.isInteger(source.rows) ? source.rows : 3, TABLE_LIMITS.MIN_ROWS, TABLE_LIMITS.MAX_ROWS);
  const cols = clamp(Number.isInteger(source.cols) ? source.cols : 4, TABLE_LIMITS.MIN_COLS, TABLE_LIMITS.MAX_COLS);
  const incoming = Array.isArray(source.cells) ? source.cells : [];
  const cells = Array.from({ length: rows }, (_, row) =>
    Array.from({ length: cols }, (_, col) => safeCell(incoming[row]?.[col]))
  );
  const incomingStyles = Array.isArray(source.cellStyles) ? source.cellStyles : [];
  const cellStyles = Array.from({ length: rows }, (_, row) =>
    Array.from({ length: cols }, (_, col) => normalizeCellStyle(incomingStyles[row]?.[col]))
  );
  const rowWeights = Array.from({ length: rows }, (_, row) => safeTrackWeight(source.rowWeights?.[row]));
  const columnWeights = Array.from({ length: cols }, (_, col) => safeTrackWeight(source.columnWeights?.[col]));
  const merges = [];
  (Array.isArray(source.merges) ? source.merges.slice(0, TABLE_LIMITS.MAX_MERGES) : []).forEach(value => {
    const merge = normalizeMerge(value, rows, cols);
    if (merge && !merges.some(existing => rangesIntersect(existing, merge))) merges.push(merge);
  });
  // Канонічна модель зберігає вміст об'єднаної області лише в anchor-комірці.
  // Це не дає пошкодженому імпорту приховати текст, який з'явиться після split.
  merges.forEach(merge => {
    for (let row = merge.top; row <= merge.bottom; row += 1) {
      for (let col = merge.left; col <= merge.right; col += 1) {
        if (row !== merge.top || col !== merge.left) cells[row][col] = '';
      }
    }
  });
  const style = source.style && typeof source.style === 'object' ? source.style : {};
  return {
    rows,
    cols,
    cells,
    cellStyles,
    rowWeights,
    columnWeights,
    merges,
    style: {
      headerRow: style.headerRow !== false,
      headerFill: safeColor(style.headerFill, DEFAULT_TABLE_STYLE.headerFill),
      headerColor: safeColor(style.headerColor, DEFAULT_TABLE_STYLE.headerColor),
      bodyFill: safeColor(style.bodyFill, DEFAULT_TABLE_STYLE.bodyFill),
      altFill: safeColor(style.altFill, DEFAULT_TABLE_STYLE.altFill),
      textColor: safeColor(style.textColor, DEFAULT_TABLE_STYLE.textColor),
      borderColor: safeColor(style.borderColor, DEFAULT_TABLE_STYLE.borderColor),
      fontSize: clamp(Number.isFinite(style.fontSize) ? style.fontSize : DEFAULT_TABLE_STYLE.fontSize, 10, 72)
    }
  };
}

export function resizeTable(table, rows, cols) {
  const current = normalizeTable(table);
  if (current.merges.length && (rows !== current.rows || cols !== current.cols)) return current;
  return normalizeTable({ ...current, rows, cols, cells: current.cells, cellStyles: current.cellStyles });
}

export function applyTableStylePreset(table, presetKey) {
  const preset = TABLE_STYLE_PRESETS[presetKey] || TABLE_STYLE_PRESETS.blue;
  return normalizeTable({ ...table, style: { ...table?.style, ...preset } });
}

export function getTableStylePresetKey(table) {
  // Пресет володіє лише переліченими в ньому кольорами. Окремі налаштування
  // таблиці (заголовок, шрифт, body fill тощо) не повинні скидати його в custom.
  const style = normalizeTable(table).style;
  return Object.entries(TABLE_STYLE_PRESETS).find(([, preset]) =>
    Object.entries(preset).every(([field, value]) => style[field] === value)
  )?.[0] || null;
}

// Текст комірки через доменний сетер (валідація меж + ліміт довжини), щоб модель
// не редагувалася напряму з рендерера. Мутує наявну таблицю, повертає очищене.
export function setTableCellText(table, row, col, text) {
  if (!Array.isArray(table?.cells?.[row]) || table.cells[row][col] === undefined) return '';
  const value = safeCell(typeof text === 'string' ? text : '').replace(/\r/g, '');
  table.cells[row][col] = value;
  return value;
}

// Трансформація merge-діапазонів при вставці/видаленні треку. Зсув для треків
// поза діапазоном, ріст/усадка — коли трек перетинає сам діапазон. Невалідні
// (1×1, поза межами) відсіює normalizeTable → normalizeMerge.
function shiftMergeOnInsert(start, end, at) {
  if (at <= start) return { start: start + 1, end: end + 1 };
  if (at <= end) return { start, end: end + 1 };
  return { start, end };
}

function shiftMergeOnDelete(start, end, at) {
  if (at < start) return { start: start - 1, end: end - 1 };
  if (at <= end) return { start, end: end - 1 };
  return { start, end };
}

function mapRowMerge(merge, mapper) {
  const r = mapper(merge.top, merge.bottom);
  return { ...merge, top: r.start, bottom: r.end };
}

function mapColMerge(merge, mapper) {
  const c = mapper(merge.left, merge.right);
  return { ...merge, left: c.start, right: c.end };
}

// Видалення треку всередині одно-трекового merge схлопує його (start>end). Такі
// прибираємо ДО нормалізації, бо normalizeMerge через clamp «воскресив» би їх.
function dropCollapsedMerges(merges) {
  return merges.filter(merge => merge.top <= merge.bottom && merge.left <= merge.right);
}

export function insertTableRow(table, index) {
  const next = normalizeTable(table);
  if (next.rows >= TABLE_LIMITS.MAX_ROWS) return next;
  const at = clamp(Number.isInteger(index) ? index : next.rows, 0, next.rows);
  next.cells.splice(at, 0, Array(next.cols).fill(''));
  next.cellStyles.splice(at, 0, Array.from({ length: next.cols }, () => ({})));
  next.rowWeights.splice(at, 0, next.rowWeights[Math.min(at, next.rows - 1)] || 1);
  next.rows += 1;
  next.merges = dropCollapsedMerges(next.merges.map(merge => mapRowMerge(merge, (top, bottom) => shiftMergeOnInsert(top, bottom, at))));
  return normalizeTable(next);
}

export function deleteTableRow(table, index) {
  const next = normalizeTable(table);
  if (next.rows <= TABLE_LIMITS.MIN_ROWS) return next;
  const at = clamp(Number.isInteger(index) ? index : next.rows - 1, 0, next.rows - 1);
  next.merges.forEach(merge => {
    if (at === merge.top && merge.bottom > merge.top) {
      next.cells[merge.top + 1][merge.left] = next.cells[merge.top][merge.left];
      next.cellStyles[merge.top + 1][merge.left] = next.cellStyles[merge.top][merge.left];
    }
  });
  next.cells.splice(at, 1);
  next.cellStyles.splice(at, 1);
  next.rowWeights.splice(at, 1);
  next.rows -= 1;
  next.merges = dropCollapsedMerges(next.merges.map(merge => mapRowMerge(merge, (top, bottom) => shiftMergeOnDelete(top, bottom, at))));
  return normalizeTable(next);
}

export function insertTableColumn(table, index) {
  const next = normalizeTable(table);
  if (next.cols >= TABLE_LIMITS.MAX_COLS) return next;
  const at = clamp(Number.isInteger(index) ? index : next.cols, 0, next.cols);
  next.cells.forEach(row => row.splice(at, 0, ''));
  next.cellStyles.forEach(row => row.splice(at, 0, {}));
  next.columnWeights.splice(at, 0, next.columnWeights[Math.min(at, next.cols - 1)] || 1);
  next.cols += 1;
  next.merges = dropCollapsedMerges(next.merges.map(merge => mapColMerge(merge, (left, right) => shiftMergeOnInsert(left, right, at))));
  return normalizeTable(next);
}

export function deleteTableColumn(table, index) {
  const next = normalizeTable(table);
  if (next.cols <= TABLE_LIMITS.MIN_COLS) return next;
  const at = clamp(Number.isInteger(index) ? index : next.cols - 1, 0, next.cols - 1);
  next.merges.forEach(merge => {
    if (at === merge.left && merge.right > merge.left) {
      next.cells[merge.top][merge.left + 1] = next.cells[merge.top][merge.left];
      next.cellStyles[merge.top][merge.left + 1] = next.cellStyles[merge.top][merge.left];
    }
  });
  next.cells.forEach(row => row.splice(at, 1));
  next.cellStyles.forEach(row => row.splice(at, 1));
  next.columnWeights.splice(at, 1);
  next.cols -= 1;
  next.merges = dropCollapsedMerges(next.merges.map(merge => mapColMerge(merge, (left, right) => shiftMergeOnDelete(left, right, at))));
  return normalizeTable(next);
}

export function setTableCellStyle(table, row, col, style) {
  const next = normalizeTable(table);
  if (!next.cellStyles[row]?.[col]) return next;
  next.cellStyles[row][col] = patchCellStyle(next.cellStyles[row][col], style);
  return next;
}

export function setTableTrackWeights(table, row, col, rowWeight, columnWeight) {
  const next = normalizeTable(table);
  if (next.rowWeights[row] === undefined || next.columnWeights[col] === undefined) return next;
  next.rowWeights[row] = safeTrackWeight(rowWeight);
  next.columnWeights[col] = safeTrackWeight(columnWeight);
  return next;
}

export function tableRangeIntersectsMerge(table, range) {
  const { table: next, top, bottom, left, right } = normalizeRange(table, range);
  return next.merges.some(merge => rangesIntersect(merge, { top, bottom, left, right }));
}

export function getTableMergeAt(table, row, col) {
  const next = normalizeTable(table);
  return next.merges.find(merge => row >= merge.top && row <= merge.bottom && col >= merge.left && col <= merge.right) || null;
}

export function mergeTableRange(table, range) {
  const { table: next, top, bottom, left, right } = normalizeRange(table, range);
  const merge = { top, bottom, left, right };
  if ((top === bottom && left === right) || next.merges.some(existing => rangesIntersect(existing, merge))) return next;
  const content = [];
  for (let row = top; row <= bottom; row += 1) {
    for (let col = left; col <= right; col += 1) {
      if (next.cells[row][col]) content.push(next.cells[row][col]);
      if (row !== top || col !== left) next.cells[row][col] = '';
    }
  }
  const joined = content.join('\n');
  if (joined.length > TABLE_LIMITS.MAX_CELL_LENGTH) return normalizeTable(table);
  next.cells[top][left] = joined;
  next.merges.push(merge);
  return next;
}

export function splitTableCell(table, row, col) {
  const next = normalizeTable(table);
  const index = next.merges.findIndex(merge => row >= merge.top && row <= merge.bottom && col >= merge.left && col <= merge.right);
  if (index < 0) return next;
  next.merges.splice(index, 1);
  return next;
}

export function setTableRangeStyle(table, range, style) {
  const { table: next, top, bottom, left, right } = normalizeRange(table, range);
  for (let row = top; row <= bottom; row += 1) {
    for (let col = left; col <= right; col += 1) {
      next.cellStyles[row][col] = patchCellStyle(next.cellStyles[row][col], style);
    }
  }
  return next;
}

export function clearTableRangeStyle(table, range) {
  const { table: next, top, bottom, left, right } = normalizeRange(table, range);
  for (let row = top; row <= bottom; row += 1) {
    for (let col = left; col <= right; col += 1) next.cellStyles[row][col] = {};
  }
  return next;
}

export function copyTableRange(table, range) {
  const { table: next, top, bottom, left, right } = normalizeRange(table, range);
  const rows = Math.max(0, bottom - top + 1);
  const cols = Math.max(0, right - left + 1);
  return {
    rows,
    cols,
    cells: Array.from({ length: rows }, (_, row) =>
      Array.from({ length: cols }, (_, col) => next.cells[top + row][left + col])
    ),
    cellStyles: Array.from({ length: rows }, (_, row) =>
      Array.from({ length: cols }, (_, col) => ({ ...next.cellStyles[top + row][left + col] }))
    )
  };
}

export function clearTableRange(table, range) {
  const { table: next, top, bottom, left, right } = normalizeRange(table, range);
  for (let row = top; row <= bottom; row += 1) {
    for (let col = left; col <= right; col += 1) next.cells[row][col] = '';
  }
  return next;
}

export function pasteTableRange(table, startRow, startCol, payload) {
  const next = normalizeTable(table);
  if (!payload || !Number.isInteger(payload.rows) || !Number.isInteger(payload.cols) || payload.rows < 1 || payload.cols < 1) return next;
  const source = normalizeTable({
    rows: payload.rows,
    cols: payload.cols,
    cells: payload.cells,
    cellStyles: payload.cellStyles
  });
  const top = clamp(Number.isInteger(startRow) ? startRow : 0, 0, next.rows - 1);
  const left = clamp(Number.isInteger(startCol) ? startCol : 0, 0, next.cols - 1);
  const rows = Math.min(source.rows, next.rows - top);
  const cols = Math.min(source.cols, next.cols - left);
  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      next.cells[top + row][left + col] = source.cells[row][col];
      next.cellStyles[top + row][left + col] = { ...source.cellStyles[row][col] };
    }
  }
  return next;
}

export function tableResizeLosesData(table, rows, cols) {
  const current = normalizeTable(table);
  const nextRows = clamp(Number.isInteger(rows) ? rows : current.rows, TABLE_LIMITS.MIN_ROWS, TABLE_LIMITS.MAX_ROWS);
  const nextCols = clamp(Number.isInteger(cols) ? cols : current.cols, TABLE_LIMITS.MIN_COLS, TABLE_LIMITS.MAX_COLS);
  return current.rowWeights.some((weight, rowIndex) => rowIndex >= nextRows && weight !== 1) ||
    current.columnWeights.some((weight, colIndex) => colIndex >= nextCols && weight !== 1) ||
    current.cells.some((row, rowIndex) => row.some((value, colIndex) =>
    (rowIndex >= nextRows || colIndex >= nextCols) &&
    (value.length > 0 || Object.keys(current.cellStyles[rowIndex][colIndex]).length > 0)
  ));
}

export function tableRowHasData(table, row) {
  const current = normalizeTable(table);
  const at = clamp(Number.isInteger(row) ? row : current.rows - 1, 0, current.rows - 1);
  return current.rowWeights[at] !== 1 ||
    current.cells[at].some((value, col) => value.length > 0 || Object.keys(current.cellStyles[at][col]).length > 0);
}

export function tableColumnHasData(table, col) {
  const current = normalizeTable(table);
  const at = clamp(Number.isInteger(col) ? col : current.cols - 1, 0, current.cols - 1);
  return current.columnWeights[at] !== 1 ||
    current.cells.some((row, rowIndex) => row[at].length > 0 || Object.keys(current.cellStyles[rowIndex][at]).length > 0);
}

export function createTableElement(rows = 3, cols = 4, overrides = {}) {
  return {
    id: uid(),
    type: 'table',
    shape: null,
    x: 180,
    y: 150,
    w: 600,
    h: 240,
    z: 1,
    rotation: 0,
    content: '',
    table: normalizeTable({ rows, cols }),
    style: {},
    ...overrides,
    table: normalizeTable(overrides.table || { rows, cols })
  };
}

export function createTableNode(element, {
  editable = false,
  onBeginEdit,
  onCellInput,
  onEndEdit,
  onSelect,
  onSelectCell,
  onArrowNav,
  selectionRange
} = {}) {
  const table = normalizeTable(element.table);
  const node = document.createElement('div');
  node.className = `slide-table${editable ? ' editable' : ''}`;
  node.style.setProperty('--table-cols', String(table.cols));
  node.style.setProperty('--table-rows', String(table.rows));
  node.style.setProperty('--table-border', table.style.borderColor);
  node.style.setProperty('--table-header-fill', table.style.headerFill);
  node.style.setProperty('--table-header-color', table.style.headerColor);
  node.style.setProperty('--table-body-fill', table.style.bodyFill);
  node.style.setProperty('--table-alt-fill', table.style.altFill);
  node.style.setProperty('--table-text-color', table.style.textColor);
  node.style.setProperty('--table-font-size', `${table.style.fontSize}px`);
  node.style.width = '100%';
  node.style.height = '100%';
  node.style.display = 'grid';
  node.style.gridTemplateColumns = table.columnWeights.map(weight => `minmax(0, ${weight}fr)`).join(' ');
  node.style.gridTemplateRows = table.rowWeights.map(weight => `minmax(0, ${weight}fr)`).join(' ');
  node.style.overflow = 'hidden';
  node.style.border = `1px solid ${table.style.borderColor}`;
  node.style.background = table.style.bodyFill;
  node.style.color = table.style.textColor;
  node.style.fontSize = `${table.style.fontSize}px`;
  node.style.lineHeight = '1.15';
  node.style.boxSizing = 'border-box';
  node.setAttribute('role', 'grid');
  node.setAttribute('aria-rowcount', String(table.rows));
  node.setAttribute('aria-colcount', String(table.cols));

  table.cells.forEach((row, rowIndex) => {
    row.forEach((value, colIndex) => {
      const merge = table.merges.find(item => rowIndex >= item.top && rowIndex <= item.bottom && colIndex >= item.left && colIndex <= item.right);
      if (merge && (rowIndex !== merge.top || colIndex !== merge.left)) return;
      const cell = document.createElement('div');
      const header = table.style.headerRow && rowIndex === 0;
      const alternate = !header && rowIndex % 2 === 0;
      const cellStyle = table.cellStyles[rowIndex][colIndex];
      const selected = selectionRange &&
        rowIndex >= Math.min(selectionRange.startRow, selectionRange.endRow) &&
        rowIndex <= Math.max(selectionRange.startRow, selectionRange.endRow) &&
        colIndex >= Math.min(selectionRange.startCol, selectionRange.endCol) &&
        colIndex <= Math.max(selectionRange.startCol, selectionRange.endCol);
      cell.className = `slide-table-cell${header ? ' header' : ''}${alternate ? ' alternate' : ''}${selected ? ' range-selected' : ''}`;
      cell.dataset.row = String(rowIndex);
      cell.dataset.col = String(colIndex);
      if (merge) {
        cell.style.gridRow = `${merge.top + 1} / ${merge.bottom + 2}`;
        cell.style.gridColumn = `${merge.left + 1} / ${merge.right + 2}`;
        cell.setAttribute('aria-rowspan', String(merge.bottom - merge.top + 1));
        cell.setAttribute('aria-colspan', String(merge.right - merge.left + 1));
      }
      cell.textContent = value;
      cell.style.minWidth = '0';
      cell.style.minHeight = '0';
      cell.style.padding = '6px 8px';
      cell.style.overflow = 'hidden';
      cell.style.borderRight = `1px solid ${table.style.borderColor}`;
      cell.style.borderBottom = `1px solid ${table.style.borderColor}`;
      cell.style.background = cellStyle.fill || (header ? table.style.headerFill : (alternate ? table.style.altFill : table.style.bodyFill));
      cell.style.color = cellStyle.color || (header ? table.style.headerColor : table.style.textColor);
      const bold = typeof cellStyle.bold === 'boolean' ? cellStyle.bold : header;
      cell.style.fontWeight = bold ? '700' : '400';
      cell.style.textAlign = cellStyle.align || 'left';
      cell.style.display = 'grid';
      cell.style.alignContent = { top: 'start', middle: 'center', bottom: 'end' }[cellStyle.valign] || 'start';
      cell.style.whiteSpace = 'pre-wrap';
      cell.style.wordBreak = 'break-word';
      cell.style.boxSizing = 'border-box';
      cell.setAttribute('role', 'gridcell');
      cell.setAttribute('aria-label', `Комірка ${rowIndex + 1}, ${colIndex + 1}`);
      cell.setAttribute('aria-rowindex', String(rowIndex + 1));
      cell.setAttribute('aria-colindex', String(colIndex + 1));
      if (editable) {
        let selectedByPointer = false;
        cell.contentEditable = 'plaintext-only';
        cell.spellcheck = false;
        cell.addEventListener('pointerdown', event => {
          event.stopPropagation();
          selectedByPointer = true;
          onSelect?.();
          onSelectCell?.(rowIndex, colIndex, event.shiftKey);
        });
        cell.addEventListener('focus', () => {
          onSelect?.();
          if (!selectedByPointer) onSelectCell?.(rowIndex, colIndex, false);
          selectedByPointer = false;
          onBeginEdit?.();
        });
        cell.addEventListener('paste', event => {
          event.preventDefault();
          insertPlainTextAtSelection(cell, event.clipboardData?.getData('text/plain') || '');
          onCellInput?.(rowIndex, colIndex, normalizeEditableCell(cell), cell);
        });
        cell.addEventListener('input', () => onCellInput?.(rowIndex, colIndex, normalizeEditableCell(cell), cell));
        cell.addEventListener('blur', () => onEndEdit?.());
        cell.addEventListener('keydown', event => {
          const arrowDir = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right' }[event.key];
          if (arrowDir && onArrowNav) {
            // У порожній комірці Shift+стрілка розширює діапазон. У комірці з
            // текстом лишаємо стандартне keyboard-виділення; Ctrl/Meta+Shift
            // явно перемикає цю комбінацію на діапазон комірок.
            if (event.shiftKey && (!(cell.textContent || '').length || event.ctrlKey || event.metaKey)) {
              event.preventDefault();
              onArrowNav(rowIndex, colIndex, arrowDir, true);
              return;
            }
            const edge = caretEdge(cell);
            const atBoundary = ((arrowDir === 'left' || arrowDir === 'up') && edge.atStart) ||
              ((arrowDir === 'right' || arrowDir === 'down') && edge.atEnd);
            if (atBoundary) {
              // На межі тексту: Shift розширює діапазон комірок, без Shift — перехід.
              event.preventDefault();
              onArrowNav(rowIndex, colIndex, arrowDir, event.shiftKey);
            }
            return;
          }
          if (event.key === 'Enter') {
            event.preventDefault();
            insertPlainTextAtSelection(cell, '\n');
            onCellInput?.(rowIndex, colIndex, normalizeEditableCell(cell), cell);
            return;
          }
          if (event.key !== 'Tab') return;
          const cells = Array.from(node.querySelectorAll('.slide-table-cell'));
          const index = cells.indexOf(cell);
          const nextIndex = event.shiftKey ? index - 1 : index + 1;
          if (!cells[nextIndex]) return;
          event.preventDefault();
          cells[nextIndex].focus();
        });
      }
      node.appendChild(cell);
    });
  });
  return node;
}

function normalizeEditableCell(cell) {
  const clean = safeCell(cell.textContent || '').replace(/\r/g, '');
  if (cell.childElementCount || cell.textContent !== clean) {
    cell.textContent = clean;
    placeCaretAtEnd(cell);
  }
  return clean;
}

function insertPlainTextAtSelection(cell, value) {
  const selection = window.getSelection();
  if (!selection?.rangeCount || !cell.contains(selection.anchorNode)) {
    cell.textContent = safeCell(`${cell.textContent || ''}${value}`).replace(/\r/g, '');
    placeCaretAtEnd(cell);
    return;
  }
  const range = selection.getRangeAt(0);
  range.deleteContents();
  const node = document.createTextNode(value.replace(/\r/g, ''));
  range.insertNode(node);
  range.setStartAfter(node);
  range.collapse(true);
  selection.removeAllRanges();
  selection.addRange(range);
}

// Чи каретка на самому початку/кінці тексту комірки (для переходу між комірками
// лише на межі). Згорнута позиція → зміщення в символах від початку комірки.
function caretEdge(cell) {
  const selection = window.getSelection();
  if (!selection || !selection.rangeCount) return { atStart: true, atEnd: true };
  const range = selection.getRangeAt(0);
  if (!range.collapsed || !cell.contains(range.startContainer)) return { atStart: false, atEnd: false };
  const probe = range.cloneRange();
  probe.selectNodeContents(cell);
  probe.setEnd(range.endContainer, range.endOffset);
  const offset = probe.toString().length;
  return { atStart: offset === 0, atEnd: offset === (cell.textContent || '').length };
}

function placeCaretAtEnd(cell) {
  const selection = window.getSelection();
  if (!selection) return;
  const range = document.createRange();
  range.selectNodeContents(cell);
  range.collapse(false);
  selection.removeAllRanges();
  selection.addRange(range);
}
