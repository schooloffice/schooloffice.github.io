import { clamp, uid } from './utils.js';

export const CHART_TYPES = ['column', 'line', 'pie'];
export const CHART_LIMITS = {
  MAX_CATEGORIES: 12,
  MAX_SERIES: 4,
  MAX_LABEL_LENGTH: 40,
  MAX_TITLE_LENGTH: 120,
  MAX_ABS_VALUE: 1000000000
};
export const CHART_COLORS = [
  '#2563eb', '#dc2626', '#16a34a', '#f59e0b',
  '#7c3aed', '#0891b2', '#db2777', '#65a30d',
  '#ea580c', '#4f46e5', '#0d9488', '#9333ea'
];

const DEFAULT_CHART = {
  type: 'column',
  title: 'Діаграма',
  showLegend: true,
  categories: ['Категорія 1', 'Категорія 2', 'Категорія 3'],
  series: [{ name: 'Ряд 1', values: [4, 7, 5] }]
};

function safeLabel(value, fallback = '') {
  return typeof value === 'string' ? value.trim().slice(0, CHART_LIMITS.MAX_LABEL_LENGTH) : fallback;
}

function safeValue(value) {
  const number = Number(value);
  return Number.isFinite(number) ? clamp(number, -CHART_LIMITS.MAX_ABS_VALUE, CHART_LIMITS.MAX_ABS_VALUE) : 0;
}

export function normalizeChart(chart) {
  const source = chart && typeof chart === 'object' ? chart : {};
  const incomingCategories = Array.isArray(source.categories) ? source.categories : DEFAULT_CHART.categories;
  const categories = incomingCategories.slice(0, CHART_LIMITS.MAX_CATEGORIES).map((value, index) => safeLabel(value, `Категорія ${index + 1}`));
  if (!categories.length) categories.push('Категорія 1');
  const incomingSeries = Array.isArray(source.series) ? source.series : DEFAULT_CHART.series;
  const series = incomingSeries.slice(0, CHART_LIMITS.MAX_SERIES).map((item, index) => ({
    name: safeLabel(item?.name, `Ряд ${index + 1}`) || `Ряд ${index + 1}`,
    values: categories.map((_, valueIndex) => safeValue(item?.values?.[valueIndex]))
  }));
  if (!series.length) series.push({ name: 'Ряд 1', values: categories.map(() => 0) });
  return {
    type: CHART_TYPES.includes(source.type) ? source.type : DEFAULT_CHART.type,
    title: typeof source.title === 'string' ? source.title.trim().slice(0, CHART_LIMITS.MAX_TITLE_LENGTH) : DEFAULT_CHART.title,
    showLegend: source.showLegend !== false,
    categories,
    series
  };
}

export function createChartElement(overrides = {}) {
  return {
    id: uid(),
    type: 'chart',
    shape: null,
    x: 180,
    y: 120,
    w: 600,
    h: 340,
    z: 1,
    rotation: 0,
    content: '',
    chart: normalizeChart(overrides.chart),
    style: {},
    ...overrides,
    chart: normalizeChart(overrides.chart)
  };
}

export function chartToDelimitedText(chart) {
  const clean = normalizeChart(chart);
  const header = ['Категорія', ...clean.series.map(item => item.name)].join(';');
  const rows = clean.categories.map((category, index) =>
    [category, ...clean.series.map(item => String(item.values[index]))].join(';')
  );
  return [header, ...rows].join('\n');
}

export function chartFromDelimitedText(text, base = {}) {
  const lines = String(text || '').split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  if (lines.length < 2) return null;
  const cells = lines.map(line => line.split(';').map(value => value.trim()));
  const seriesNames = cells[0].slice(1, CHART_LIMITS.MAX_SERIES + 1);
  if (!seriesNames.length) return null;
  const rows = cells.slice(1, CHART_LIMITS.MAX_CATEGORIES + 1);
  const categories = rows.map((row, index) => safeLabel(row[0], `Категорія ${index + 1}`));
  const series = seriesNames.map((name, seriesIndex) => ({
    name: safeLabel(name, `Ряд ${seriesIndex + 1}`) || `Ряд ${seriesIndex + 1}`,
    values: rows.map(row => safeValue(row[seriesIndex + 1]))
  }));
  return normalizeChart({ ...base, categories, series });
}

export function createChartNode(element) {
  const chart = normalizeChart(element.chart);
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.classList.add('slide-chart');
  svg.setAttribute('viewBox', '0 0 600 340');
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', chart.title || 'Діаграма');
  svg.style.width = '100%';
  svg.style.height = '100%';
  appendText(svg, chart.title, 300, 25, { size: 19, weight: '700', anchor: 'middle' });
  if (chart.type === 'pie') renderPie(svg, chart);
  else renderCartesian(svg, chart);
  if (chart.showLegend) renderLegend(svg, chart);
  return svg;
}

function renderCartesian(svg, chart) {
  const plot = { x: 58, y: 48, w: 510, h: chart.showLegend ? 225 : 250 };
  const values = chart.series.flatMap(item => item.values);
  const min = Math.min(0, ...values);
  const max = Math.max(0, ...values);
  const span = max - min || 1;
  const yFor = value => plot.y + plot.h - ((value - min) / span) * plot.h;
  appendLine(svg, plot.x, plot.y, plot.x, plot.y + plot.h, '#94a3b8');
  appendLine(svg, plot.x, yFor(0), plot.x + plot.w, yFor(0), '#94a3b8');
  chart.categories.forEach((category, index) => {
    const center = plot.x + (index + 0.5) * (plot.w / chart.categories.length);
    appendText(svg, shortenAxisLabel(category, chart.categories.length), center, plot.y + plot.h + 18, { size: 11, anchor: 'middle' });
  });
  if (chart.type === 'column') {
    const groupWidth = plot.w / chart.categories.length;
    const barWidth = Math.max(3, Math.min(34, (groupWidth * 0.72) / chart.series.length));
    chart.series.forEach((series, seriesIndex) => {
      series.values.forEach((value, categoryIndex) => {
        const x = plot.x + categoryIndex * groupWidth + (groupWidth - barWidth * chart.series.length) / 2 + seriesIndex * barWidth;
        const zeroY = yFor(0);
        const valueY = yFor(value);
        appendRect(svg, x, Math.min(zeroY, valueY), barWidth - 2, Math.max(1, Math.abs(zeroY - valueY)), CHART_COLORS[seriesIndex]);
      });
    });
    return;
  }
  chart.series.forEach((series, seriesIndex) => {
    const points = series.values.map((value, index) => ({
      x: plot.x + (index + 0.5) * (plot.w / chart.categories.length),
      y: yFor(value)
    }));
    const polyline = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
    polyline.setAttribute('points', points.map(point => `${point.x},${point.y}`).join(' '));
    polyline.setAttribute('fill', 'none');
    polyline.setAttribute('stroke', CHART_COLORS[seriesIndex]);
    polyline.setAttribute('stroke-width', '3');
    svg.appendChild(polyline);
    points.forEach(point => appendCircle(svg, point.x, point.y, 4, CHART_COLORS[seriesIndex]));
  });
}

function renderPie(svg, chart) {
  const values = chart.series[0].values.map(value => Math.max(0, value));
  const total = values.reduce((sum, value) => sum + value, 0);
  if (!total) {
    appendText(svg, 'Немає додатних даних', 300, 170, { size: 18, anchor: 'middle' });
    return;
  }
  let angle = -Math.PI / 2;
  values.forEach((value, index) => {
    if (!value) return;
    const next = angle + (value / total) * Math.PI * 2;
    const large = next - angle > Math.PI ? 1 : 0;
    const x1 = 250 + Math.cos(angle) * 105;
    const y1 = 170 + Math.sin(angle) * 105;
    const x2 = 250 + Math.cos(next) * 105;
    const y2 = 170 + Math.sin(next) * 105;
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', `M 250 170 L ${x1} ${y1} A 105 105 0 ${large} 1 ${x2} ${y2} Z`);
    path.setAttribute('fill', CHART_COLORS[index % CHART_COLORS.length]);
    path.setAttribute('stroke', '#ffffff');
    path.setAttribute('stroke-width', '2');
    svg.appendChild(path);
    angle = next;
  });
}

function renderLegend(svg, chart) {
  const items = chart.type === 'pie'
    ? chart.categories.map((name, index) => ({ name, color: CHART_COLORS[index % CHART_COLORS.length] }))
    : chart.series.map((item, index) => ({ name: item.name, color: CHART_COLORS[index] }));
  items.forEach((item, index) => {
    const x = chart.type === 'pie' ? 365 + Math.floor(index / 6) * 115 : 70 + index * 125;
    const y = chart.type === 'pie' ? 68 + (index % 6) * 36 : 320;
    appendRect(svg, x, y - 10, 12, 12, item.color);
    appendText(svg, shortenLabel(item.name), x + 18, y, { size: 11 });
  });
}

function shortenLabel(value) {
  return value.length > 14 ? `${value.slice(0, 13)}…` : value;
}

function shortenAxisLabel(value, categoryCount) {
  const limit = categoryCount > 8 ? 5 : categoryCount > 5 ? 8 : 14;
  return value.length > limit ? `${value.slice(0, limit - 1)}…` : value;
}

function appendText(svg, value, x, y, { size = 12, weight = '400', anchor = 'start' } = {}) {
  const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
  text.textContent = value;
  text.setAttribute('x', String(x));
  text.setAttribute('y', String(y));
  text.setAttribute('font-size', String(size));
  text.setAttribute('font-weight', weight);
  text.setAttribute('text-anchor', anchor);
  text.setAttribute('fill', '#111827');
  svg.appendChild(text);
}

function appendLine(svg, x1, y1, x2, y2, color) {
  const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
  line.setAttribute('x1', String(x1)); line.setAttribute('y1', String(y1));
  line.setAttribute('x2', String(x2)); line.setAttribute('y2', String(y2));
  line.setAttribute('stroke', color);
  svg.appendChild(line);
}

function appendRect(svg, x, y, width, height, color) {
  const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
  rect.setAttribute('x', String(x)); rect.setAttribute('y', String(y));
  rect.setAttribute('width', String(width)); rect.setAttribute('height', String(height));
  rect.setAttribute('fill', color);
  svg.appendChild(rect);
}

function appendCircle(svg, cx, cy, r, color) {
  const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
  circle.setAttribute('cx', String(cx)); circle.setAttribute('cy', String(cy));
  circle.setAttribute('r', String(r)); circle.setAttribute('fill', color);
  svg.appendChild(circle);
}
