// ---- Charts ----
// Дані діаграми читаємо з МОДЕЛІ (getCellValueByIndex), а не з полів сітки:
// у полі стоїть відформатований текст («85,00%», «125,50 ₴», «8,50»), який
// parseFloat розбирає неправильно. Модель дає справжнє число.
//
// Витягнуте джерело зберігаємо окремо від самої діаграми, щоб зміна типу
// перемальовувала з даних. Для точкової потрібні пари (x, y), тож рядки
// читаємо цілими — інакше пропуск в одному стовпці зсунув би відповідність.

const CHART_PALETTE = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#6366f1', '#14b8a6'];

// { rows: [{ label, values: [number|null, ...] }], seriesLabels: [...], hasNumericFirstColumn }
let chartSource = null;

function chartCellValue(col, row) {
  try {
    return getCellValueByIndex(col, row);
  } catch (e) {
    return null; // клітинка з помилкою формули не має ламати побудову
  }
}

function isChartNumber(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

function isChartText(value) {
  return typeof value === 'string' && value.trim() !== '';
}

// Розбирає виділення на шапку, стовпець підписів і числові ряди.
function extractChartSource() {
  const b = getBounds();
  const colCount = b.cMax - b.cMin + 1;

  const grid = [];
  for (let r = b.rMin; r <= b.rMax; r++) {
    const row = [];
    for (let c = b.cMin; c <= b.cMax; c++) row.push(chartCellValue(c, r));
    grid.push(row);
  }

  // Рядок шапки: у першому рядку немає жодного числа, а нижче числа є.
  const hasHeader = grid.length > 1 &&
    !grid[0].some(isChartNumber) &&
    grid[0].some(isChartText) &&
    grid.slice(1).some(row => row.some(isChartNumber));
  const bodyStart = hasHeader ? 1 : 0;
  const body = grid.slice(bodyStart);

  // Стовпець підписів: перший стовпець без чисел, але з текстом.
  const firstColumn = body.map(row => row[0]);
  const labelColumnUsed = colCount > 1 &&
    !firstColumn.some(isChartNumber) &&
    firstColumn.some(isChartText);

  const valueColumns = [];
  for (let i = labelColumnUsed ? 1 : 0; i < colCount; i++) valueColumns.push(i);

  const seriesLabels = valueColumns.map(i => {
    const header = hasHeader ? grid[0][i] : null;
    return isChartText(header) ? String(header).trim() : COLS[b.cMin + i];
  });

  const rows = body.map((row, index) => ({
    label: labelColumnUsed && isChartText(row[0])
      ? String(row[0]).trim()
      : `Рядок ${b.rMin + bodyStart + index}`,
    values: valueColumns.map(i => (isChartNumber(row[i]) ? row[i] : null))
  })).filter(row => row.values.some(v => v !== null));

  return {
    rows,
    seriesLabels,
    // Точкова діаграма потребує числового X — це перший з числових стовпців.
    hasNumericFirstColumn: !labelColumnUsed
  };
}

function makeChart() {
  recalculateAll();
  const source = extractChartSource();

  if (!source.rows.length) {
    showInfoModal('Виділіть клітинки з числами!');
    return;
  }

  chartSource = source;
  openModal('chartModal');
  updateChartTypeButtons();
  renderChartFromSource();
}

// Чому точкову не можна побудувати з цього виділення.
// Порожній рядок означає «можна».
function scatterBlockReason(source) {
  if (!source.hasNumericFirstColumn) {
    return 'Для точкової діаграми перший стовпець має містити числа — це значення X. ' +
      'Виділіть два стовпці чисел без підписів.';
  }
  if (source.seriesLabels.length < 2) {
    return 'Точкова діаграма показує залежність між двома величинами. ' +
      'Виділіть щонайменше два стовпці чисел: перший — X, другий — Y.';
  }
  return '';
}

function showChartNote(text) {
  const note = document.getElementById('chartNote');
  const wrap = document.querySelector('.chart-canvas-wrap');
  if (note) {
    note.textContent = text || '';
    note.hidden = !text;
  }
  if (wrap) wrap.hidden = !!text;
}

function renderChartFromSource() {
  if (!chartSource) return;

  const canvas = document.getElementById('theChart');
  if (!canvas) return;

  if (chartObj) { chartObj.destroy(); chartObj = null; }

  if (chartType === 'scatter') {
    const reason = scatterBlockReason(chartSource);
    if (reason) { showChartNote(reason); return; }
  }
  showChartNote('');

  chartObj = new Chart(canvas.getContext('2d'), chartType === 'scatter'
    ? buildScatterConfig(chartSource)
    : buildCategoryConfig(chartSource));
}

// Стовпчики / лінія / кругова: підписи по осі категорій, стовпці — ряди.
function buildCategoryConfig(source) {
  const isPie = chartType === 'pie';
  const labels = source.rows.map(row => row.label);

  const datasets = source.seriesLabels.map((label, i) => ({
    label,
    data: source.rows.map(row => row.values[i]),
    backgroundColor: isPie
      ? CHART_PALETTE
      : CHART_PALETTE[i % CHART_PALETTE.length],
    borderColor: chartType === 'line' ? CHART_PALETTE[i % CHART_PALETTE.length] : undefined,
    borderWidth: 1,
    tension: 0.4
  }));

  return {
    type: chartType,
    data: { labels, datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: datasets.length > 1 || isPie } },
      scales: isPie ? {} : { y: { beginAtZero: true } }
    }
  };
}

// Точкова: перший числовий стовпець — X, кожен наступний — окремий ряд Y.
// Точку беремо лише там, де є обидва числа: неповна пара спотворила б залежність.
function buildScatterConfig(source) {
  const xLabel = source.seriesLabels[0];

  const datasets = source.seriesLabels.slice(1).map((label, i) => ({
    label,
    data: source.rows
      .filter(row => row.values[0] !== null && row.values[i + 1] !== null)
      .map(row => ({ x: row.values[0], y: row.values[i + 1] })),
    backgroundColor: CHART_PALETTE[i % CHART_PALETTE.length],
    borderColor: CHART_PALETTE[i % CHART_PALETTE.length],
    pointRadius: 5,
    pointHoverRadius: 7
  }));

  return {
    type: 'scatter',
    data: { datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: datasets.length > 1 } },
      scales: {
        // beginAtZero тут свідомо немає: у лабораторній роботі важливий
        // діапазон самих вимірів, а не відстань до нуля.
        x: { type: 'linear', position: 'bottom', title: { display: true, text: xLabel } },
        y: { title: { display: true, text: datasets.length === 1 ? datasets[0].label : '' } }
      }
    }
  };
}

function updateChartTypeButtons() {
  document.querySelectorAll('[data-chart-type]').forEach(btn => {
    const active = btn.dataset.chartType === chartType;
    btn.classList.toggle('active', active);
    btn.setAttribute('aria-pressed', active ? 'true' : 'false');
  });
}

function setChartType(t) {
  chartType = t;
  updateChartTypeButtons();
  renderChartFromSource();
}

window.TablesCharts = {
  makeChart,
  setChartType,
  extractChartSource,
  buildCategoryConfig,
  buildScatterConfig,
  scatterBlockReason,
  updateChartTypeButtons
};
