import { STAGE_HEIGHT, STAGE_WIDTH } from './constants.js';
import { normalizeChart } from './chart-element.js';
import { normalizeTable } from './table-element.js';

const PPTX_WIDTH = 13.333;
const PPTX_HEIGHT = 7.5;
const PPTX_BUNDLE_URL = new URL('../../vendor/pptxgenjs/pptxgen.bundle.js', import.meta.url).href;
let pptxLibraryPromise = null;
const FONT_FACE = {
  sans: 'Arial',
  serif: 'Georgia',
  mono: 'Courier New',
  rounded: 'Comic Sans MS'
};
const NAMED_COLORS = {
  black: '000000',
  white: 'FFFFFF',
  red: 'FF0000',
  green: '008000',
  blue: '0000FF',
  yellow: 'FFFF00',
  orange: 'FFA500',
  purple: '800080',
  pink: 'FFC0CB',
  gray: '808080',
  grey: '808080',
  brown: 'A52A2A',
  cyan: '00FFFF',
  magenta: 'FF00FF',
  navy: '000080',
  teal: '008080',
  lime: '00FF00',
  maroon: '800000',
  olive: '808000',
  silver: 'C0C0C0',
  gold: 'FFD700'
};

function position(element) {
  return {
    x: element.x / STAGE_WIDTH * PPTX_WIDTH,
    y: element.y / STAGE_HEIGHT * PPTX_HEIGHT,
    w: element.w / STAGE_WIDTH * PPTX_WIDTH,
    h: element.h / STAGE_HEIGHT * PPTX_HEIGHT
  };
}

function pxToPt(value) {
  return Math.max(1, Number(value || 0) * 0.75);
}

function channelToHex(value) {
  return Math.max(0, Math.min(255, Math.round(Number(value) || 0))).toString(16).padStart(2, '0');
}

function hslToHex(hue, saturation, lightness) {
  const h = ((Number(hue) % 360) + 360) % 360 / 360;
  const s = Math.max(0, Math.min(100, Number(saturation))) / 100;
  const l = Math.max(0, Math.min(100, Number(lightness))) / 100;
  const channel = offset => {
    const k = (offset + h * 12) % 12;
    return l - s * Math.min(l, 1 - l) * Math.max(-1, Math.min(k - 3, 9 - k, 1));
  };
  return [channel(0), channel(8), channel(4)].map(value => channelToHex(value * 255)).join('').toUpperCase();
}

function color(value, fallback = '000000') {
  const source = String(value || '').trim();
  const hex = source.match(/^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i)?.[1];
  if (hex?.length === 3) return hex.split('').map(char => char + char).join('').toUpperCase();
  if (hex) return hex.slice(0, 6).toUpperCase();
  const rgb = source.match(/^rgba?\(\s*([0-9.]+)[,\s]+([0-9.]+)[,\s]+([0-9.]+)/i);
  if (rgb) return `${channelToHex(rgb[1])}${channelToHex(rgb[2])}${channelToHex(rgb[3])}`.toUpperCase();
  const hsl = source.match(/^hsla?\(\s*([-0-9.]+)(?:deg)?[,\s]+([0-9.]+)%[,\s]+([0-9.]+)%/i);
  if (hsl) return hslToHex(hsl[1], hsl[2], hsl[3]);
  return NAMED_COLORS[source.toLowerCase()] || fallback;
}

function fill(value, fallback = 'FFFFFF') {
  return String(value || '').toLowerCase() === 'transparent'
    ? { color: fallback, transparency: 100 }
    : { color: color(value, fallback) };
}

function hyperlink(link, slideNumberById) {
  if (link?.kind === 'url') return { url: link.href };
  if (link?.kind === 'slide' && slideNumberById.has(link.slideId)) {
    return { slide: slideNumberById.get(link.slideId) };
  }
  return undefined;
}

function textValue(element, report) {
  const value = element.isPlaceholder ? '' : String(element.content || '');
  if (!value || element.style?.listType === 'none') return value;
  report.warnings.add('Маркеровані й нумеровані списки експортовано як звичайний текст із префіксами.');
  return value.split('\n').map((line, index) =>
    element.style.listType === 'number' ? `${index + 1}. ${line}` : `• ${line}`
  ).join('\n');
}

function textOptions(element, slideNumberById, report) {
  const style = element.style || {};
  return {
    ...position(element),
    rotate: element.rotation || 0,
    fontFace: FONT_FACE[style.fontFamily] || FONT_FACE.sans,
    fontSize: pxToPt(style.fontSize || 28),
    color: color(style.color, '111827'),
    bold: !!style.bold,
    italic: !!style.italic,
    underline: !!style.underline,
    align: style.align || 'left',
    valign: 'top',
    margin: 0.08,
    breakLine: false,
    fit: 'shrink',
    transparency: element.isPlaceholder ? 100 : 0,
    hyperlink: hyperlink(element.link, slideNumberById),
    lineSpacingMultiple: Number(style.lineHeight || 1.15)
  };
}

function shapeType(pptx, shape) {
  return {
    rect: pptx.ShapeType.rect,
    circle: pptx.ShapeType.ellipse,
    triangle: pptx.ShapeType.triangle,
    line: pptx.ShapeType.line,
    arrow: pptx.ShapeType.line
  }[shape] || pptx.ShapeType.rect;
}

function shapeOptions(element, slideNumberById) {
  const options = {
    ...position(element),
    rotate: element.rotation || 0,
    fill: fill(element.style?.fill, 'DBEAFE'),
    line: {
      color: color(element.style?.stroke, '1D4ED8'),
      width: element.shape === 'line' || element.shape === 'arrow' ? 2 : 1
    },
    hyperlink: hyperlink(element.link, slideNumberById)
  };
  if (element.shape === 'arrow') options.line.endArrowType = 'triangle';
  if (element.shape === 'line' || element.shape === 'arrow') delete options.fill;
  return options;
}

function addText(slide, element, slideNumberById, report) {
  const value = textValue(element, report);
  if (!value) {
    report.skippedPlaceholders += element.isPlaceholder ? 1 : 0;
    return;
  }
  slide.addText(value, textOptions(element, slideNumberById, report));
  report.exportedElements += 1;
}

function addShape(slide, element, pptx, slideNumberById, report) {
  const options = shapeOptions(element, slideNumberById);
  const value = textValue(element, report);
  if (value && !['line', 'arrow'].includes(element.shape)) {
    slide.addText(value, {
      ...textOptions(element, slideNumberById, report),
      shape: shapeType(pptx, element.shape),
      fill: options.fill,
      line: options.line,
      valign: 'mid'
    });
  } else {
    slide.addShape(shapeType(pptx, element.shape), options);
  }
  report.exportedElements += 1;
}

function addImage(slide, element, slideNumberById, report) {
  if (!element.content || element.isPlaceholder) {
    report.skippedPlaceholders += 1;
    return;
  }
  if (!element.content.startsWith('data:image/')) {
    report.skippedUnsupported += 1;
    report.warnings.add('Зовнішні URL-зображення не переносяться у PPTX; вставте їх у проєкт як локальні дані.');
    return;
  }
  if (element.crop && Object.values(element.crop).some(value => Number(value) > 0)) {
    report.warnings.add('Кадрування зображень у PPTX наближене до рамки об’єкта.');
  }
  if (element.style?.objectFit === 'contain') {
    report.warnings.add('Режим «вписати» для зображень у PPTX може відрізнятися від редактора.');
  }
  slide.addImage({
    data: element.content,
    ...position(element),
    rotate: element.rotation || 0,
    transparency: Math.round((1 - Number(element.style?.opacity ?? 1)) * 100),
    altText: element.alt || '',
    hyperlink: hyperlink(element.link, slideNumberById)
  });
  report.exportedElements += 1;
}

function mergeAt(table, row, col) {
  return table.merges.find(item => row >= item.top && row <= item.bottom && col >= item.left && col <= item.right);
}

function tableRows(table) {
  return table.cells.map((row, rowIndex) => {
    const result = [];
    row.forEach((value, colIndex) => {
      const merge = mergeAt(table, rowIndex, colIndex);
      if (merge && (merge.top !== rowIndex || merge.left !== colIndex)) return;
      const cellStyle = table.cellStyles[rowIndex][colIndex];
      const header = table.style.headerRow && rowIndex === 0;
      const alternate = !header && rowIndex % 2 === 0;
      const options = {
        fill: fill(cellStyle.fill || (header ? table.style.headerFill : (alternate ? table.style.altFill : table.style.bodyFill))),
        color: color(cellStyle.color || (header ? table.style.headerColor : table.style.textColor)),
        bold: typeof cellStyle.bold === 'boolean' ? cellStyle.bold : header,
        align: cellStyle.align || 'left',
        valign: cellStyle.valign || 'top',
        margin: 0.04,
        border: { color: color(table.style.borderColor), pt: 0.75 }
      };
      if (merge) {
        options.rowspan = merge.bottom - merge.top + 1;
        options.colspan = merge.right - merge.left + 1;
      }
      result.push({ text: value, options });
    });
    return result;
  });
}

function weightedSizes(weights, total) {
  const sum = weights.reduce((value, weight) => value + weight, 0) || 1;
  return weights.map(weight => weight / sum * total);
}

function addTable(slide, element, report) {
  const table = normalizeTable(element.table);
  const box = position(element);
  slide.addTable(tableRows(table), {
    ...box,
    fontFace: FONT_FACE.sans,
    fontSize: pxToPt(table.style.fontSize),
    colW: weightedSizes(table.columnWeights, box.w),
    rowH: weightedSizes(table.rowWeights, box.h),
    autoFit: false,
    margin: 0.04
  });
  if (element.rotation) report.warnings.add('Поворот таблиць не підтримується у PPTX-експорті.');
  report.exportedElements += 1;
}

function addChart(slide, element, pptx, report) {
  const chart = normalizeChart(element.chart);
  const chartType = {
    column: pptx.ChartType.bar,
    line: pptx.ChartType.line,
    pie: pptx.ChartType.pie
  }[chart.type];
  const data = chart.series.map(series => ({
    name: series.name,
    labels: chart.categories,
    values: series.values
  }));
  slide.addChart(chartType, data, {
    ...position(element),
    barDir: chart.type === 'column' ? 'col' : undefined,
    showTitle: !!chart.title,
    title: chart.title,
    showLegend: chart.showLegend,
    legendPos: 'b',
    showValue: false,
    showCategoryName: chart.type === 'pie',
    chartColors: ['2563EB', 'DC2626', '16A34A', 'F59E0B', '7C3AED', '0891B2', 'DB2777', '65A30D']
  });
  if (element.rotation) report.warnings.add('Поворот діаграм не підтримується у PPTX-експорті.');
  report.exportedElements += 1;
}

function addElement(slide, element, pptx, slideNumberById, report) {
  if (element.groupId) report.warnings.add('Групування об’єктів не переноситься у PPTX; об’єкти залишаються окремо редагованими.');
  if (element.link && (element.type === 'table' || element.type === 'chart')) {
    report.warnings.add('Гіперпосилання на таблицях і діаграмах не переносяться у PPTX.');
  }
  if (element.type === 'text') addText(slide, element, slideNumberById, report);
  else if (element.type === 'shape') addShape(slide, element, pptx, slideNumberById, report);
  else if (element.type === 'image') addImage(slide, element, slideNumberById, report);
  else if (element.type === 'table') addTable(slide, element, report);
  else if (element.type === 'chart') addChart(slide, element, pptx, report);
  else report.skippedUnsupported += 1;
}

export function buildPptxPresentation(fileName, slides, PptxCtor = globalThis.PptxGenJS) {
  if (typeof PptxCtor !== 'function') throw new Error('PptxGenJS is unavailable');
  const pptx = new PptxCtor();
  pptx.layout = 'LAYOUT_WIDE';
  pptx.author = 'Офіс ПЛЮС';
  pptx.company = 'Офіс ПЛЮС';
  pptx.subject = 'Презентація ПЛЮС Слайди';
  pptx.title = fileName || 'Презентація';
  pptx.lang = 'uk-UA';

  const report = {
    slideCount: slides.length,
    exportedElements: 0,
    skippedPlaceholders: 0,
    skippedUnsupported: 0,
    warnings: new Set()
  };
  const slideNumberById = new Map(slides.map((slide, index) => [slide.id, index + 1]));

  slides.forEach(source => {
    const slide = pptx.addSlide();
    slide.background = { color: color(source.background, 'FFFFFF') };
    [...source.elements].sort((a, b) => (a.z || 1) - (b.z || 1))
      .forEach(element => addElement(slide, element, pptx, slideNumberById, report));
    if (source.notes && typeof slide.addNotes === 'function') slide.addNotes(source.notes);
    if (source.transition?.type && source.transition.type !== 'none') {
      report.warnings.add('Переходи між слайдами не переносяться у PPTX.');
    }
  });

  return { presentation: pptx, report: { ...report, warnings: [...report.warnings] } };
}

export function loadPptxLibrary() {
  if (typeof globalThis.PptxGenJS === 'function') return Promise.resolve(globalThis.PptxGenJS);
  if (pptxLibraryPromise) return pptxLibraryPromise;
  pptxLibraryPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = PPTX_BUNDLE_URL;
    script.async = true;
    script.onload = () => typeof globalThis.PptxGenJS === 'function'
      ? resolve(globalThis.PptxGenJS)
      : reject(new Error('PptxGenJS did not initialize'));
    script.onerror = () => reject(new Error('PptxGenJS bundle could not be loaded'));
    document.head.appendChild(script);
  }).catch(error => {
    pptxLibraryPromise = null;
    throw error;
  });
  return pptxLibraryPromise;
}

export async function exportPresentationPptx(fileName, slides, PptxCtor = null) {
  const Ctor = PptxCtor || await loadPptxLibrary();
  const { presentation, report } = buildPptxPresentation(fileName, slides, Ctor);
  await presentation.writeFile({ fileName: `${fileName || 'presentation'}.pptx`, compression: true });
  return report;
}
