'use strict';

// Windowing policy for large sheets. The workbook model always keeps all cells;
// this module only limits how many of them exist in the DOM at one time.
const TablesGridViewport = (() => {
  const FULL_RENDER_THRESHOLD = 10_000;
  const ROW_OVERSCAN = 5;
  const COL_OVERSCAN = 2;
  const ROW_HEADER_WIDTH = 50;
  let container = null;
  let onChange = null;
  let frame = 0;
  let lastKey = '';

  function configure(options = {}) {
    if (container === options.container) {
      onChange = options.onChange || onChange;
      return;
    }
    container = options.container || null;
    onChange = options.onChange || null;
    container?.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', schedule);
  }

  function isVirtualized(rows = ROWS, cols = COL_COUNT) {
    return rows * cols > FULL_RENDER_THRESHOLD;
  }

  function columnWidth(index) {
    return Number(colWidths[index]) || 80;
  }

  function columnOffset(index) {
    let width = 0;
    for (let c = 0; c < index; c += 1) width += columnWidth(c);
    return width;
  }

  function range(rows = ROWS, cols = COL_COUNT) {
    if (!isVirtualized(rows, cols) || !container) {
      return {
        virtualized: false,
        rowStart: 1, rowEnd: rows,
        colStart: 0, colEnd: cols - 1,
        topHeight: 0, bottomHeight: 0,
        leftWidth: 0, rightWidth: 0
      };
    }

    const rowHeight = Number(metrics?.rowH) || 30;
    const scrollTop = Math.max(0, container.scrollTop);
    const visibleRows = Math.max(1, Math.ceil(container.clientHeight / rowHeight));
    const rowStart = Math.max(1, Math.floor(scrollTop / rowHeight) + 1 - ROW_OVERSCAN);
    const rowEnd = Math.min(rows, rowStart + visibleRows + (ROW_OVERSCAN * 2));

    const contentLeft = Math.max(0, container.scrollLeft - ROW_HEADER_WIDTH);
    const contentRight = contentLeft + Math.max(1, container.clientWidth);
    let first = 0;
    let offset = 0;
    while (first < cols - 1 && offset + columnWidth(first) < contentLeft) {
      offset += columnWidth(first);
      first += 1;
    }
    let last = first;
    let right = offset + columnWidth(first);
    while (last < cols - 1 && right < contentRight) {
      last += 1;
      right += columnWidth(last);
    }
    const colStart = Math.max(0, first - COL_OVERSCAN);
    const colEnd = Math.min(cols - 1, last + COL_OVERSCAN);
    const leftWidth = columnOffset(colStart);
    const renderedRight = columnOffset(colEnd + 1);
    const totalWidth = columnOffset(cols);

    return {
      virtualized: true,
      rowStart, rowEnd, colStart, colEnd,
      topHeight: (rowStart - 1) * rowHeight,
      bottomHeight: Math.max(0, (rows - rowEnd) * rowHeight),
      leftWidth,
      rightWidth: Math.max(0, totalWidth - renderedRight)
    };
  }

  function key(value) {
    return [value.rowStart, value.rowEnd, value.colStart, value.colEnd].join(':');
  }

  function schedule() {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => {
      frame = 0;
      const next = range();
      const nextKey = key(next);
      if (nextKey === lastKey) return;
      lastKey = nextKey;
      onChange?.(next);
    });
  }

  function markRendered(value) {
    lastKey = key(value);
  }

  function reset() {
    lastKey = '';
  }

  function ensureCellVisible(row, col) {
    if (!container || !isVirtualized()) return false;
    const rowHeight = Number(metrics?.rowH) || 30;
    const top = (row - 1) * rowHeight;
    const bottom = top + rowHeight;
    const left = ROW_HEADER_WIDTH + columnOffset(col);
    const right = left + columnWidth(col);
    if (top < container.scrollTop) container.scrollTop = top;
    else if (bottom > container.scrollTop + container.clientHeight) {
      container.scrollTop = Math.max(0, bottom - container.clientHeight);
    }
    if (left < container.scrollLeft + ROW_HEADER_WIDTH) container.scrollLeft = Math.max(0, left - ROW_HEADER_WIDTH);
    else if (right > container.scrollLeft + container.clientWidth) {
      container.scrollLeft = Math.max(0, right - container.clientWidth);
    }
    return true;
  }

  return {
    FULL_RENDER_THRESHOLD,
    ROW_OVERSCAN,
    COL_OVERSCAN,
    configure,
    ensureCellVisible,
    isVirtualized,
    markRendered,
    range,
    reset
  };
})();

window.TablesGridViewport = TablesGridViewport;
