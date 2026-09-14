'use strict';

// ---- Діаграми на аркуші ----
// Модель — sheetCharts активного аркуша (chart-model.js). Тут: створення з виділення, малювання
// Chart.js у плаваючих рамках над сіткою, переміщення, розмір, тип, назва й видалення.
// Позицію рамки рахуємо від будь-якої намальованої клітинки за ширинами колонок і кроком рядків:
// велика сітка рендериться вікном, і клітинки якоря може не бути в DOM.

const CHART_COLORS = ['#2563eb', '#16a34a', '#d97706', '#dc2626', '#7c3aed', '#0f766e', '#db2777', '#4f46e5', '#92400e', '#334155', '#0891b2', '#65a30d'];
const CHART_TYPE_TOOLS = [
  { type: 'bar', icon: 'fa-chart-column', label: 'Стовпчики' },
  { type: 'line', icon: 'fa-chart-line', label: 'Лінія' },
  { type: 'pie', icon: 'fa-chart-pie', label: 'Кругова' }
];
const CHART_EMPTY_TEXT = 'Дані діаграми видалено. Скасуйте зміну (Ctrl+Z) або видаліть діаграму.';
const chartViews = new Map(); // id → { frame, title, canvas, empty, chart, key }
let chartLayer = null;
let editingChartTitleId = null;
let chartPointer = null;

function chartCellValue(col, row) {
  if (col < 0 || col >= COL_COUNT || row < 1 || row > ROWS) return '';
  return getCalculatedCellValue(getCellId(col, row));
}

function findSheetChart(id) {
  return sheetCharts.find(chart => chart.id === id) || null;
}

function focusedChartId() {
  return document.activeElement?.closest?.('.sheet-chart')?.dataset.chartId || sheetCharts[sheetCharts.length - 1]?.id || '';
}

function chartColumnWidth(col) {
  return Number(colWidths[col]) || 80;
}

// Точка відліку за DOM: заголовки колонок дають реальні межі колонок (min-width заголовка
// робить колонку ширшою за colWidths), перший видимий заголовок рядка — рядок і крок рядків
// (клітинка не годиться: об'єднана може займати кілька рядків).
function chartGridOrigin() {
  if (!gridWrap) return null;
  const wrapRect = gridWrap.getBoundingClientRect();
  const columns = new Map();
  let minColumnWidth = 0;
  document.querySelectorAll('#headRow th.col-header').forEach(th => {
    const rect = th.getBoundingClientRect();
    if (!rect.width) return;
    columns.set(Number(th.dataset.col), rect.left - wrapRect.left + gridWrap.scrollLeft);
    minColumnWidth = minColumnWidth || parseFloat(getComputedStyle(th).minWidth) || 0;
  });
  const origin = { columns, minColumnWidth, row: 1, top: metrics.headerH || 32, rowHeight: metrics.rowH || 30 };
  const rowHeaders = document.querySelectorAll('#bodyRows th.row-header');
  for (let index = 0; index < rowHeaders.length; index++) {
    const rect = rowHeaders[index].getBoundingClientRect();
    if (!rect.height) continue; // рядок сховано фільтром
    const row = Number(rowHeaders[index].dataset.row);
    const nextHeader = rowHeaders[index + 1];
    const next = Number(nextHeader?.dataset.row) === row + 1 ? nextHeader.getBoundingClientRect() : null;
    origin.row = row;
    origin.top = rect.top - wrapRect.top + gridWrap.scrollTop;
    origin.rowHeight = (next?.height ? next.top - rect.top : rect.height) || origin.rowHeight;
    break;
  }
  return origin;
}

function chartGridColumnWidth(col, origin) {
  return Math.max(chartColumnWidth(col), origin.minColumnWidth);
}

// Ліва межа колонки: з DOM, якщо колонка намальована, інакше від найближчої намальованої.
function chartLeftAt(col, origin) {
  if (origin.columns.has(col)) return origin.columns.get(col);
  const known = [...origin.columns.keys()];
  let reference = 0;
  let left = metrics.rowHeaderW || 50;
  if (known.length) {
    reference = known.reduce((best, c) => (Math.abs(c - col) < Math.abs(best - col) ? c : best), known[0]);
    left = origin.columns.get(reference);
  }
  for (let c = reference; c < col; c++) left += chartGridColumnWidth(c, origin);
  for (let c = col; c < reference; c++) left -= chartGridColumnWidth(c, origin);
  return left;
}

function chartTopAt(row, origin) {
  return origin.top + (row - origin.row) * origin.rowHeight;
}

// Найближча до точки межа клітинок — новий якір після перетягування.
function chartCellAt(x, y, origin) {
  let col = 0;
  let distance = Infinity;
  for (let c = 0; c < COL_COUNT; c++) {
    const next = Math.abs(chartLeftAt(c, origin) - x);
    if (next < distance) {
      distance = next;
      col = c;
    }
  }
  const row = clamp(origin.row + Math.round((y - origin.top) / origin.rowHeight), 1, ROWS);
  return [col, row];
}

function chartConfig(chart, data) {
  const isPie = chart.type === 'pie';
  const datasets = (isPie ? data.series.slice(0, 1) : data.series).map((item, index) => ({
    label: item.label,
    data: item.data,
    backgroundColor: isPie ? data.labels.map((_, point) => CHART_COLORS[point % CHART_COLORS.length]) : CHART_COLORS[index % CHART_COLORS.length],
    borderColor: isPie ? '#ffffff' : CHART_COLORS[index % CHART_COLORS.length],
    borderWidth: isPie ? 1 : 2,
    tension: 0.3
  }));
  return {
    type: chart.type,
    data: { labels: data.labels, datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      plugins: {
        title: { display: !!chart.title, text: chart.title },
        legend: { display: isPie || datasets.length > 1 }
      },
      scales: isPie ? {} : { y: { beginAtZero: true } }
    }
  };
}

function createChartButton(command, label, icon) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'sheet-chart-tool';
  button.dataset.chartCommand = command;
  button.title = label;
  button.setAttribute('aria-label', label);
  const glyph = document.createElement('i');
  glyph.className = `fa-solid ${icon}`;
  glyph.setAttribute('aria-hidden', 'true');
  button.appendChild(glyph);
  return button;
}

function createChartView() {
  const frame = document.createElement('div');
  frame.className = 'sheet-chart';
  frame.tabIndex = 0;
  frame.setAttribute('role', 'group');
  const bar = document.createElement('div');
  bar.className = 'sheet-chart-bar';
  const title = document.createElement('span');
  title.className = 'sheet-chart-title';
  const tools = document.createElement('div');
  tools.className = 'sheet-chart-tools';
  CHART_TYPE_TOOLS.forEach(tool => tools.appendChild(createChartButton(`type-${tool.type}`, tool.label, tool.icon)));
  tools.appendChild(createChartButton('rename', 'Змінити назву', 'fa-pen'));
  tools.appendChild(createChartButton('delete', 'Видалити діаграму', 'fa-trash-can'));
  bar.append(title, tools);
  const body = document.createElement('div');
  body.className = 'sheet-chart-body';
  const canvas = document.createElement('canvas');
  const empty = document.createElement('div');
  empty.className = 'sheet-chart-empty';
  empty.textContent = CHART_EMPTY_TEXT;
  empty.hidden = true;
  body.append(canvas, empty);
  const resize = document.createElement('div');
  resize.className = 'sheet-chart-resize';
  resize.setAttribute('aria-hidden', 'true');
  frame.append(bar, body, resize);
  frame.addEventListener('click', onChartFrameClick);
  frame.addEventListener('keydown', onChartFrameKeydown);
  bar.addEventListener('pointerdown', event => startChartPointer(event, 'move'));
  resize.addEventListener('pointerdown', event => startChartPointer(event, 'resize'));
  return { frame, title, canvas, empty, chart: null, key: '' };
}

function syncChartTitle(view, chart) {
  const editing = editingChartTitleId === chart.id;
  let input = view.frame.querySelector('.sheet-chart-title-input');
  view.title.textContent = chart.title || 'Діаграма';
  view.title.hidden = editing;
  if (editing && !input) {
    input = document.createElement('input');
    input.type = 'text';
    input.className = 'sheet-chart-title-input';
    input.maxLength = CHART_MAX_TITLE;
    input.value = chart.title;
    input.setAttribute('aria-label', 'Назва діаграми');
    input.addEventListener('keydown', onChartTitleKeydown);
    input.addEventListener('blur', () => finishChartTitle(chart.id, input, true));
    view.title.after(input);
    input.focus();
    input.select();
  } else if (!editing && input) {
    input.remove();
  }
}

function positionChartView(view, chart, origin) {
  view.frame.style.left = `${Math.round(chartLeftAt(chart.anchor[0], origin))}px`;
  view.frame.style.top = `${Math.round(chartTopAt(chart.anchor[1], origin))}px`;
  view.frame.style.width = `${chart.size[0]}px`;
  view.frame.style.height = `${chart.size[1]}px`;
}

function updateChartView(view, chart, origin) {
  const { frame } = view;
  frame.dataset.chartId = chart.id;
  positionChartView(view, chart, origin);
  const typeLabel = CHART_TYPE_TOOLS.find(tool => tool.type === chart.type)?.label || chart.type;
  frame.setAttribute('aria-label', `Діаграма «${chart.title || 'без назви'}», ${typeLabel.toLowerCase()}. Стрілки — перемістити, Shift+стрілки — змінити розмір, Delete — видалити.`);
  frame.querySelectorAll('[data-chart-command^="type-"]').forEach(button => {
    button.setAttribute('aria-pressed', String(button.dataset.chartCommand === `type-${chart.type}`));
  });
  syncChartTitle(view, chart);

  const empty = !chart.series.length;
  view.empty.hidden = !empty;
  view.canvas.hidden = empty;
  if (empty) {
    view.chart?.destroy();
    view.chart = null;
    view.key = '';
    return;
  }
  const data = chartSeriesData(chart, chartCellValue);
  const key = JSON.stringify([chart.type, chart.title, chart.size, data]);
  if (view.chart && key === view.key) return;
  view.key = key;
  const config = chartConfig(chart, data);
  if (view.chart && view.chart.config.type === chart.type) {
    view.chart.data = config.data;
    view.chart.options = config.options;
    view.chart.update('none');
    view.chart.resize();
  } else {
    view.chart?.destroy();
    view.chart = typeof Chart === 'function' ? new Chart(view.canvas, config) : null;
  }
}

function ensureChartLayer() {
  if (!gridWrap) return null;
  if (!chartLayer || chartLayer.parentElement !== gridWrap) {
    chartLayer = document.createElement('div');
    chartLayer.className = 'sheet-chart-layer';
    gridWrap.appendChild(chartLayer);
  }
  return chartLayer;
}

function renderSheetCharts() {
  const layer = ensureChartLayer();
  if (!layer) return;
  const origin = chartGridOrigin();
  const alive = new Set();
  for (const chart of sheetCharts) {
    alive.add(chart.id);
    let view = chartViews.get(chart.id);
    if (!view) {
      view = createChartView();
      chartViews.set(chart.id, view);
      layer.appendChild(view.frame);
    }
    updateChartView(view, chart, origin);
  }
  for (const [id, view] of chartViews) {
    if (alive.has(id)) continue;
    view.chart?.destroy();
    view.frame.remove();
    chartViews.delete(id);
  }
}

// Лише позиції (зміна ширини колонки, масштаб) — без перерахунку даних.
function layoutSheetCharts() {
  if (!chartViews.size) return;
  const origin = chartGridOrigin();
  if (!origin) return;
  for (const chart of sheetCharts) {
    const view = chartViews.get(chart.id);
    if (view) positionChartView(view, chart, origin);
  }
}

function commitChartChange(message) {
  recalculateAll(); // малює діаграми
  persistStateToStorage();
  setDirty(true);
  saveToHistory();
  if (message) announce(message);
}

function makeChart() {
  recalculateAll();
  if (sheetCharts.length >= CHART_MAX_PER_SHEET) {
    showInfoModal(`На аркуші може бути не більше ${CHART_MAX_PER_SHEET} діаграм.`);
    return '';
  }
  const bounds = getBounds();
  const result = chartFromSelection(bounds, chartCellValue);
  if (result.error) {
    showInfoModal(result.error);
    return '';
  }
  const id = uniqueChartId(new Set(sheetCharts.map(chart => chart.id)));
  sheetCharts.push({
    id,
    type: 'bar',
    title: '',
    categories: result.categories,
    series: result.series,
    anchor: [Math.min(bounds.cMax + 2, COL_COUNT - 1), bounds.rMin],
    size: [...CHART_DEFAULT_SIZE]
  });
  commitChartChange('Діаграму додано поруч із даними');
  chartViews.get(id)?.frame.focus({ preventScroll: true });
  return id;
}

function setChartType(type, id = focusedChartId()) {
  const chart = findSheetChart(id);
  if (!chart || !CHART_TYPES.includes(type) || chart.type === type) return false;
  chart.type = type;
  commitChartChange(`Тип діаграми: ${CHART_TYPE_TOOLS.find(tool => tool.type === type).label.toLowerCase()}`);
  return true;
}

function setChartTitle(id, title) {
  const chart = findSheetChart(id);
  if (!chart) return false;
  const text = String(title ?? '').trim().slice(0, CHART_MAX_TITLE);
  if (chart.title === text) {
    renderSheetCharts();
    return false;
  }
  chart.title = text;
  commitChartChange(text ? `Назва діаграми: ${text}` : 'Назву діаграми прибрано');
  return true;
}

function moveChart(id, col, row) {
  const chart = findSheetChart(id);
  if (!chart) return false;
  const anchor = [clamp(Math.round(col), 0, COL_COUNT - 1), clamp(Math.round(row), 1, ROWS)];
  if (anchor[0] === chart.anchor[0] && anchor[1] === chart.anchor[1]) {
    renderSheetCharts();
    return false;
  }
  chart.anchor = anchor;
  commitChartChange(`Діаграму переміщено до ${getCellId(anchor[0], anchor[1])}`);
  return true;
}

function resizeChart(id, width, height) {
  const chart = findSheetChart(id);
  if (!chart) return false;
  const size = [clampChartSize(width, 0), clampChartSize(height, 1)];
  if (size[0] === chart.size[0] && size[1] === chart.size[1]) {
    renderSheetCharts();
    return false;
  }
  chart.size = size;
  commitChartChange(`Розмір діаграми ${size[0]}×${size[1]}`);
  return true;
}

function removeChart(id) {
  const index = sheetCharts.findIndex(chart => chart.id === id);
  if (index < 0) return false;
  sheetCharts.splice(index, 1);
  if (editingChartTitleId === id) editingChartTitleId = null;
  commitChartChange('Діаграму видалено');
  cellInp[active.r]?.[active.c]?.focus({ preventScroll: true });
  return true;
}

function runChartCommand(id, command) {
  if (command.startsWith('type-')) setChartType(command.slice(5), id);
  else if (command === 'rename') {
    editingChartTitleId = id;
    renderSheetCharts();
  } else if (command === 'delete') removeChart(id);
}

function onChartFrameClick(event) {
  const button = event.target.closest('[data-chart-command]');
  if (button) runChartCommand(event.currentTarget.dataset.chartId, button.dataset.chartCommand);
}

function onChartFrameKeydown(event) {
  const frame = event.currentTarget;
  if (event.target !== frame) return;
  const chart = findSheetChart(frame.dataset.chartId);
  if (!chart) return;
  const steps = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
  if (steps[event.key]) {
    event.preventDefault();
    event.stopPropagation();
    const [dx, dy] = steps[event.key];
    if (event.shiftKey) resizeChart(chart.id, chart.size[0] + dx * 20, chart.size[1] + dy * 20);
    else moveChart(chart.id, chart.anchor[0] + dx, chart.anchor[1] + dy);
  } else if (event.key === 'Delete' || event.key === 'Backspace') {
    // Не даємо глобальному Delete очистити виділені клітинки під діаграмою.
    event.preventDefault();
    event.stopPropagation();
    removeChart(chart.id);
  }
}

function onChartTitleKeydown(event) {
  const input = event.currentTarget;
  const id = input.closest('.sheet-chart')?.dataset.chartId;
  // Delete, Backspace і скорочення в полі назви стосуються лише тексту.
  event.stopPropagation();
  if (event.key === 'Enter') {
    event.preventDefault();
    finishChartTitle(id, input, true);
  } else if (event.key === 'Escape') {
    event.preventDefault();
    finishChartTitle(id, input, false);
  }
}

function finishChartTitle(id, input, save) {
  if (editingChartTitleId !== id) return;
  editingChartTitleId = null;
  if (save) setChartTitle(id, input.value);
  else renderSheetCharts();
  chartViews.get(id)?.frame.focus({ preventScroll: true });
}

function startChartPointer(event, mode) {
  if (event.button !== 0 || event.target.closest('button, input')) return;
  const handle = event.currentTarget;
  const frame = handle.closest('.sheet-chart');
  const chart = findSheetChart(frame?.dataset.chartId);
  if (!chart) return;
  event.preventDefault();
  frame.focus({ preventScroll: true });
  chartPointer = {
    mode, id: chart.id, frame,
    startX: event.clientX, startY: event.clientY,
    left: frame.offsetLeft, top: frame.offsetTop,
    width: chart.size[0], height: chart.size[1], moved: false
  };
  handle.setPointerCapture?.(event.pointerId);
  handle.addEventListener('pointermove', moveChartPointer);
  handle.addEventListener('pointerup', endChartPointer);
  handle.addEventListener('pointercancel', endChartPointer);
}

function moveChartPointer(event) {
  const pointer = chartPointer;
  if (!pointer) return;
  const dx = event.clientX - pointer.startX;
  const dy = event.clientY - pointer.startY;
  if (Math.abs(dx) + Math.abs(dy) > 2) pointer.moved = true;
  if (pointer.mode === 'move') {
    pointer.frame.style.transform = `translate(${dx}px, ${dy}px)`;
  } else {
    pointer.frame.style.width = `${clampChartSize(pointer.width + dx, 0)}px`;
    pointer.frame.style.height = `${clampChartSize(pointer.height + dy, 1)}px`;
  }
}

function endChartPointer(event) {
  const handle = event.currentTarget;
  handle.removeEventListener('pointermove', moveChartPointer);
  handle.removeEventListener('pointerup', endChartPointer);
  handle.removeEventListener('pointercancel', endChartPointer);
  const pointer = chartPointer;
  chartPointer = null;
  if (!pointer) return;
  pointer.frame.style.transform = '';
  if (!pointer.moved || event.type === 'pointercancel') {
    renderSheetCharts();
    return;
  }
  const dx = event.clientX - pointer.startX;
  const dy = event.clientY - pointer.startY;
  if (pointer.mode === 'move') {
    const [col, row] = chartCellAt(pointer.left + dx, pointer.top + dy, chartGridOrigin());
    moveChart(pointer.id, col, row);
  } else {
    resizeChart(pointer.id, pointer.width + dx, pointer.height + dy);
  }
}

function listCharts() {
  return JSON.parse(JSON.stringify(sheetCharts));
}

function chartData(id) {
  const chart = findSheetChart(id);
  return chart ? { type: chart.type, title: chart.title, ...chartSeriesData(chart, chartCellValue) } : null;
}

window.TablesCharts = {
  chartData,
  layout: layoutSheetCharts,
  list: listCharts,
  makeChart,
  moveChart,
  removeChart,
  render: renderSheetCharts,
  resizeChart,
  setChartTitle,
  setChartType
};
