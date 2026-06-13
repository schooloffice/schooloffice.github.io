import { FONT_FAMILY_CSS, LINE_SHAPE_TYPES, STAGE_HEIGHT, STAGE_WIDTH, TEXT_SHAPE_TYPES } from './constants.js';
import { createTextContainer, setTextContainerContent } from './text-list.js';

function normalizeCropFractions(crop) {
  const c = crop && typeof crop === 'object' ? crop : {};
  const f = value => (Number.isFinite(value) ? Math.min(Math.max(value, 0), 0.9) : 0);
  return { l: f(c.l), t: f(c.t), r: f(c.r), b: f(c.b) };
}

function appendShape(svg, element, forThumb = false) {
  const strokeWidth = forThumb ? '8' : '10';
  let shape;
  const isLine = LINE_SHAPE_TYPES.includes(element.shape);
  if (isLine) {
    svg.setAttribute('preserveAspectRatio', 'none');
    shape = document.createElementNS('http://www.w3.org/2000/svg', element.shape === 'arrow' ? 'path' : 'line');
    shape.setAttribute('data-shape-kind', element.shape);
    shape.setAttribute('stroke-linecap', 'round');
    shape.setAttribute('vector-effect', 'non-scaling-stroke');
    if (element.shape === 'arrow') {
      shape.setAttribute('d', 'M 4 50 H 92 M 78 30 L 96 50 L 78 70');
      shape.setAttribute('stroke-linejoin', 'round');
    } else {
      shape.setAttribute('x1', '4');
      shape.setAttribute('y1', '50');
      shape.setAttribute('x2', '96');
      shape.setAttribute('y2', '50');
    }
  } else if (element.shape === 'circle') {
    shape = document.createElementNS('http://www.w3.org/2000/svg', 'ellipse');
    shape.setAttribute('cx', '50%');
    shape.setAttribute('cy', '50%');
    shape.setAttribute('rx', '48%');
    shape.setAttribute('ry', '48%');
  } else if (element.shape === 'triangle') {
    shape = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
    shape.setAttribute('points', '50,4 96,96 4,96');
  } else {
    shape = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    shape.setAttribute('x', '2%');
    shape.setAttribute('y', '2%');
    shape.setAttribute('width', '96%');
    shape.setAttribute('height', '96%');
    shape.setAttribute('rx', forThumb ? '6' : '12');
    shape.setAttribute('ry', forThumb ? '6' : '12');
  }
  shape.setAttribute('fill', isLine ? 'none' : (element.style.fill || '#dbeafe'));
  shape.setAttribute('stroke', element.style.stroke || '#1d4ed8');
  shape.setAttribute('stroke-width', isLine ? '6' : strokeWidth);
  svg.appendChild(shape);
}

function applyTextSnapshotStyles(node, element, { showPlaceholder = false } = {}) {
  const isVisiblePlaceholder = !!element.isPlaceholder && showPlaceholder;
  node.style.margin = '0';
  node.style.padding = element.style.listType === 'none' ? '8px' : '8px 8px 8px 1.55em';
  node.style.whiteSpace = 'pre-wrap';
  node.style.wordBreak = 'break-word';
  node.style.lineHeight = String(element.style.lineHeight || 1.15);
  node.style.fontSize = `${element.style.fontSize || 28}px`;
  node.style.fontFamily = FONT_FAMILY_CSS[element.style.fontFamily] || 'inherit';
  node.style.fontWeight = element.style.bold ? '700' : '400';
  node.style.fontStyle = isVisiblePlaceholder ? 'normal' : (element.style.italic ? 'italic' : 'normal');
  node.style.textDecoration = isVisiblePlaceholder ? 'none' : (element.style.underline ? 'underline' : 'none');
  node.style.textAlign = element.style.align || 'left';
  node.style.color = isVisiblePlaceholder ? '#94a3b8' : (element.style.color || '#111827');
  node.classList.toggle('is-placeholder', isVisiblePlaceholder);
  setTextContainerContent(node, element.isPlaceholder && !showPlaceholder ? '' : element.content, element.style.listType);
}

function buildElementNode(element, forThumb = false) {
  const node = element.type === 'text' ? createTextContainer(element.style.listType) : document.createElement('div');
  node.style.position = 'absolute';
  node.style.left = `${element.x}px`;
  node.style.top = `${element.y}px`;
  node.style.width = `${element.w}px`;
  node.style.height = `${element.h}px`;
  node.style.zIndex = String(element.z || 1);
  node.style.overflow = 'visible';
  node.style.boxSizing = 'border-box';
  node.style.transform = `rotate(${element.rotation || 0}deg)`;
  node.style.transformOrigin = 'center center';

  if (element.type === 'text') {
    applyTextSnapshotStyles(node, element, { showPlaceholder: forThumb });
  }

  if (element.type === 'image') {
    // Кадрування: вікно з overflow:hidden показує підпрямокутник, а зображення
    // лишається розміром у повну рамку й зсувається (однаково зі сценою).
    const crop = normalizeCropFractions(element.crop);
    const visW = Math.max(0.0001, 1 - crop.l - crop.r);
    const visH = Math.max(0.0001, 1 - crop.t - crop.b);
    const win = document.createElement('div');
    win.style.position = 'absolute';
    win.style.overflow = 'hidden';
    win.style.left = `${crop.l * 100}%`;
    win.style.top = `${crop.t * 100}%`;
    win.style.width = `${visW * 100}%`;
    win.style.height = `${visH * 100}%`;
    const img = document.createElement('img');
    img.src = element.content;
    img.alt = element.alt || '';
    img.style.position = 'absolute';
    img.style.width = `${(1 / visW) * 100}%`;
    img.style.height = `${(1 / visH) * 100}%`;
    img.style.left = `${-(crop.l / visW) * 100}%`;
    img.style.top = `${-(crop.t / visH) * 100}%`;
    img.style.objectFit = element.style?.objectFit || 'cover';
    img.style.opacity = String(element.style?.opacity ?? 1);
    win.appendChild(img);
    node.appendChild(win);
  }

  if (element.type === 'shape') {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('width', '100%');
    svg.setAttribute('height', '100%');
    svg.setAttribute('viewBox', '0 0 100 100');
    appendShape(svg, element, forThumb);
    node.appendChild(svg);
    if (TEXT_SHAPE_TYPES.includes(element.shape) && element.content && (!element.isPlaceholder || forThumb)) {
      const text = createTextContainer(element.style.listType);
      text.className = 'shape-text-element';
      text.style.position = 'absolute';
      text.style.inset = '12%';
      text.style.width = '76%';
      text.style.height = '76%';
      text.style.display = element.style.listType === 'none' ? 'flex' : 'block';
      text.style.alignItems = 'center';
      text.style.justifyContent = 'center';
      text.style.overflow = 'hidden';
      applyTextSnapshotStyles(text, element, { showPlaceholder: forThumb });
      node.appendChild(text);
    }
  }

  return node;
}

export function createSlideSnapshot(slide) {
  const wrap = document.createElement('div');
  wrap.style.width = `${STAGE_WIDTH}px`;
  wrap.style.height = `${STAGE_HEIGHT}px`;
  wrap.style.position = 'relative';
  wrap.style.background = slide.background || '#ffffff';
  wrap.style.overflow = 'hidden';
  const elements = [...slide.elements].sort((a, b) => (a.z || 1) - (b.z || 1));
  elements.forEach(element => wrap.appendChild(buildElementNode(element, false)));
  return wrap;
}

export function createThumbSnapshot(slide) {
  const mini = document.createElement('div');
  mini.className = 'slide-thumb-mini';
  mini.style.background = slide.background || '#ffffff';
  const elements = [...slide.elements].sort((a, b) => (a.z || 1) - (b.z || 1));
  elements.forEach(element => {
    const node = buildElementNode(element, true);
    node.classList.add('slide-thumb-element');
    mini.appendChild(node);
  });
  return mini;
}

export async function exportPresentationPdf(fileName, slides) {
  const container = document.createElement('div');
  container.style.width = `${STAGE_WIDTH}px`;
  slides.forEach((slide, index) => {
    const page = createSlideSnapshot(slide);
    page.style.pageBreakAfter = index === slides.length - 1 ? 'auto' : 'always';
    container.appendChild(page);
  });

  await html2pdf()
    .from(container)
    .set({
      margin: 0,
      filename: `${fileName || 'presentation'}.pdf`,
      image: { type: 'jpeg', quality: 0.98 },
      html2canvas: { scale: 2, useCORS: true },
      jsPDF: { unit: 'px', format: [STAGE_WIDTH, STAGE_HEIGHT], orientation: 'landscape' }
    })
    .save();
}

export function printPresentation(fileName, slides) {
  const printWindow = window.open('', '_blank', 'width=1200,height=800');
  if (!printWindow) return false;

  const doc = printWindow.document;
  doc.open();
  doc.write('<!DOCTYPE html><html lang="uk"><head><meta charset="UTF-8"></head><body></body></html>');
  doc.close();
  doc.title = fileName || 'presentation';

  const style = doc.createElement('style');
  style.textContent = `body{margin:0;padding:24px;background:#e5e7eb;font-family:Arial,sans-serif}.page{width:${STAGE_WIDTH}px;height:${STAGE_HEIGHT}px;background:#fff;position:relative;overflow:hidden;margin:0 auto 24px;box-shadow:0 8px 24px rgba(0,0,0,.12);page-break-after:always}`;
  doc.head.appendChild(style);

  slides.forEach(slide => {
    const page = createSlideSnapshot(slide);
    page.className = 'page';
    doc.body.appendChild(doc.importNode(page, true));
  });

  printWindow.focus();
  printWindow.print();
  return true;
}
