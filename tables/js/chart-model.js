'use strict';

// ---- Діаграми аркуша: модель без DOM ----
// Діаграма: { id, type, title, categories, series:[{ name, values }], anchor:[col,row], size:[w,h] }.
// categories і values — одновимірні діапазони [cMin,rMin,cMax,rMax] того самого аркуша,
// name — клітинка [col,row] з назвою ряду. Порожній series означає, що структурна зміна
// видалила дані: діаграма лишається з повідомленням, доки її не видалять або не скасують зміну.

const CHART_TYPES = ['bar', 'line', 'pie'];
const CHART_MAX_PER_SHEET = 20;
const CHART_MAX_SERIES = 12;
const CHART_MAX_POINTS = 500;
const CHART_MAX_TITLE = 120;
const CHART_DEFAULT_SIZE = [480, 300];
const CHART_MIN_SIZE = [240, 160];
const CHART_MAX_SIZE = [1600, 1000];
// Межі моделі аркуша (setGridSize).
const CHART_GRID_MAX_ROWS = 500;
const CHART_GRID_MAX_COLS = 200;
const CHART_ID_RE = /^[A-Za-z0-9_-]{1,40}$/;

function chartIntegers(value, length) {
  if (!Array.isArray(value) || value.length !== length) return null;
  const numbers = value.map(Number);
  return numbers.every(Number.isInteger) ? numbers : null;
}

function chartRangeError(range, rows, cols) {
  const [cMin, rMin, cMax, rMax] = range;
  if (cMin < 0 || cMax < cMin || cMax >= cols || rMin < 1 || rMax < rMin || rMax > rows) return 'діапазон поза аркушем';
  if (cMin !== cMax && rMin !== rMax) return 'діапазон має бути одним рядком або однією колонкою';
  if (Math.max(cMax - cMin, rMax - rMin) + 1 > CHART_MAX_POINTS) return `забагато точок (максимум ${CHART_MAX_POINTS})`;
  return '';
}

function clampChartSize(value, axis) {
  const number = Number(value);
  const size = Number.isFinite(number) ? number : CHART_DEFAULT_SIZE[axis];
  return Math.round(Math.max(CHART_MIN_SIZE[axis], Math.min(CHART_MAX_SIZE[axis], size)));
}

function uniqueChartId(usedIds) {
  let index = 1;
  while (usedIds.has(`chart${index}`)) index += 1;
  return `chart${index}`;
}

// Нормалізована діаграма або рядок із причиною відмови. id перевіряє normalizeSheetCharts.
function normalizeChartEntry(raw, rows, cols) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return "очікувався об'єкт";
  const type = String(raw.type ?? '');
  if (!CHART_TYPES.includes(type)) return `невідомий тип «${type}»`;
  const title = String(raw.title ?? '');
  if (title.length > CHART_MAX_TITLE) return `назва задовга (максимум ${CHART_MAX_TITLE} символів)`;
  let categories = null;
  if (raw.categories != null) {
    categories = chartIntegers(raw.categories, 4);
    const error = categories ? chartRangeError(categories, rows, cols) : 'некоректний діапазон';
    if (error) return `категорії: ${error}`;
  }
  if (!Array.isArray(raw.series) || raw.series.length > CHART_MAX_SERIES) return `ряди: очікувався список до ${CHART_MAX_SERIES}`;
  const series = [];
  for (let index = 0; index < raw.series.length; index++) {
    const item = raw.series[index];
    const values = chartIntegers(item?.values, 4);
    const error = values ? chartRangeError(values, rows, cols) : 'некоректний діапазон значень';
    if (error) return `ряд ${index + 1}: ${error}`;
    let name = null;
    if (item.name != null) {
      name = chartIntegers(item.name, 2);
      if (!name || name[0] < 0 || name[0] >= cols || name[1] < 1 || name[1] > rows) return `ряд ${index + 1}: клітинка назви поза аркушем`;
    }
    series.push({ name, values });
  }
  const anchor = chartIntegers(raw.anchor, 2);
  if (!anchor || anchor[0] < 0 || anchor[0] >= cols || anchor[1] < 1 || anchor[1] > rows) return 'якір поза аркушем';
  if (!Array.isArray(raw.size) || raw.size.length !== 2 || !raw.size.every(value => Number.isFinite(Number(value)))) return 'некоректний розмір';
  const id = CHART_ID_RE.test(String(raw.id ?? '')) ? String(raw.id) : '';
  return { id, type, title, categories, series, anchor, size: [clampChartSize(raw.size[0], 0), clampChartSize(raw.size[1], 1)] };
}

// strict — для файлів .arttab (помилка зупиняє відкриття); інакше некоректні діаграми
// відкидаються, а повторні id замінюються (чернетка, історія).
function normalizeSheetCharts(value, rows, cols, { strict = false } = {}) {
  if (value == null) return [];
  if (!Array.isArray(value)) {
    if (strict) throw new Error('Некоректний список діаграм аркуша');
    return [];
  }
  if (strict && value.length > CHART_MAX_PER_SHEET) throw new Error(`Забагато діаграм на аркуші (максимум ${CHART_MAX_PER_SHEET})`);
  const usedIds = new Set();
  const out = [];
  value.slice(0, CHART_MAX_PER_SHEET).forEach((raw, index) => {
    const entry = normalizeChartEntry(raw, rows, cols);
    if (typeof entry === 'string') {
      if (strict) throw new Error(`Діаграма ${index + 1}: ${entry}`);
      return;
    }
    if (!entry.id || usedIds.has(entry.id)) {
      if (strict) throw new Error(`Діаграма ${index + 1}: некоректний або повторний id`);
      entry.id = uniqueChartId(usedIds);
    }
    usedIds.add(entry.id);
    out.push(entry);
  });
  return out;
}

function chartValueNumber(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  const text = String(value ?? '').trim();
  if (text === '') return null;
  const number = Number(text.replace(',', '.'));
  return Number.isFinite(number) ? number : null;
}

function chartValueIsText(value) {
  return String(value ?? '').trim() !== '' && chartValueNumber(value) === null;
}

function chartRangeCells(range) {
  const [cMin, rMin, cMax, rMax] = range;
  const cells = [];
  for (let r = rMin; r <= rMax; r++) {
    for (let c = cMin; c <= cMax; c++) cells.push([c, r]);
  }
  return cells;
}

// Діапазони нової діаграми з виділення. Перша колонка — категорії, якщо колонок дві або в ній
// є текст; текстовий перший рядок — назви рядів; кожна інша колонка — ряд значень.
// Діапазони записуються явно, тож пізніші зміни даних не переставляють ролі колонок.
function chartFromSelection(bounds, readValue) {
  const { cMin, cMax, rMin, rMax } = bounds;
  if (rMin === rMax) {
    const values = [cMin, rMin, cMax, rMin];
    if (!chartRangeCells(values).some(([c, r]) => chartValueNumber(readValue(c, r)) !== null)) return { error: 'Виділіть клітинки з числами!' };
    return { categories: null, series: [{ name: null, values }] };
  }
  const width = cMax - cMin + 1;
  let hasCategories = width === 2;
  for (let r = rMin + 1; width > 2 && r <= rMax && !hasCategories; r++) hasCategories = chartValueIsText(readValue(cMin, r));
  const firstValueCol = hasCategories ? cMin + 1 : cMin;
  if (cMax - firstValueCol + 1 > CHART_MAX_SERIES) return { error: `Для діаграми виділіть не більше ${CHART_MAX_SERIES} колонок значень.` };
  let header = false;
  for (let c = firstValueCol; c <= cMax && !header; c++) header = chartValueIsText(readValue(c, rMin));
  const dataStart = header ? rMin + 1 : rMin;
  let hasNumbers = false;
  const series = [];
  for (let c = firstValueCol; c <= cMax; c++) {
    for (let r = dataStart; r <= rMax && !hasNumbers; r++) hasNumbers = chartValueNumber(readValue(c, r)) !== null;
    series.push({ name: header ? [c, rMin] : null, values: [c, dataStart, c, rMax] });
  }
  if (!hasNumbers) return { error: 'Виділіть клітинки з числами!' };
  return { categories: hasCategories ? [cMin, dataStart, cMin, rMax] : null, series };
}

// Якір рухається разом із клітинками; якщо його рядок чи колонку видалено, стає на їхнє місце.
function shiftChartCoordinate(value, at, delta, min, max) {
  let next = value;
  if (Number.isFinite(at) && delta > 0 && value >= at) next = value + delta;
  if (Number.isFinite(at) && delta < 0) {
    const deleteTo = at - delta - 1;
    if (value > deleteTo) next = value + delta;
    else if (value >= at) next = at;
  }
  return Math.max(min, Math.min(max, next));
}

// Вставка/видалення рядків і колонок аркуша діаграми (семантика посилань $A$1).
// limits — розмір аркуша після зміни.
function shiftSheetCharts(charts, opts, limits = {}) {
  const maxRows = Math.min(CHART_GRID_MAX_ROWS, limits.rows ?? CHART_GRID_MAX_ROWS);
  const maxCols = Math.min(CHART_GRID_MAX_COLS, limits.cols ?? CHART_GRID_MAX_COLS);
  const shiftRange = ([cMin, rMin, cMax, rMax]) => {
    const rows = structuralShiftInterval(rMin, rMax, opts.rowAt ?? null, opts.rowDelta ?? 0);
    const cols = structuralShiftInterval(cMin, cMax, opts.colAt ?? null, opts.colDelta ?? 0);
    if (rows.deleted || cols.deleted || rows.a > maxRows || cols.a >= maxCols) return null;
    return [cols.a, rows.a, Math.min(cols.b, maxCols - 1), Math.min(rows.b, maxRows)];
  };
  return (charts || []).map(chart => {
    const series = chart.series.map(item => {
      const values = shiftRange(item.values);
      if (!values) return null;
      const name = item.name ? shiftRange([item.name[0], item.name[1], item.name[0], item.name[1]]) : null;
      return { name: name ? [name[0], name[1]] : null, values };
    }).filter(Boolean);
    return {
      ...chart,
      categories: chart.categories ? shiftRange(chart.categories) : null,
      series,
      anchor: [
        shiftChartCoordinate(chart.anchor[0], opts.colAt, opts.colDelta ?? 0, 0, maxCols - 1),
        shiftChartCoordinate(chart.anchor[1], opts.rowAt, opts.rowDelta ?? 0, 1, maxRows)
      ]
    };
  });
}

// Дані для малювання: підписи категорій і числа рядів (порожнє або текст — пропуск).
function chartSeriesData(chart, readValue) {
  const series = chart.series.map((item, index) => {
    const name = item.name ? String(readValue(item.name[0], item.name[1]) ?? '').trim() : '';
    return {
      label: name || `Ряд ${index + 1}`,
      data: chartRangeCells(item.values).map(([c, r]) => chartValueNumber(readValue(c, r)))
    };
  });
  const length = Math.max(0, ...series.map(item => item.data.length));
  const categoryCells = chart.categories ? chartRangeCells(chart.categories) : [];
  const labels = Array.from({ length }, (_, index) => {
    const cell = categoryCells[index];
    const text = cell ? String(readValue(cell[0], cell[1]) ?? '').trim() : '';
    return text || String(index + 1);
  });
  return { labels, series };
}

window.TablesChartModel = {
  CHART_DEFAULT_SIZE,
  CHART_MAX_PER_SHEET,
  CHART_MAX_SERIES,
  CHART_MAX_SIZE,
  CHART_MIN_SIZE,
  CHART_TYPES,
  chartFromSelection,
  chartRangeCells,
  chartSeriesData,
  chartValueNumber,
  clampChartSize,
  normalizeSheetCharts,
  shiftSheetCharts,
  uniqueChartId
};
