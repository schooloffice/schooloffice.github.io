import { STAGE_HEIGHT, STAGE_WIDTH, TEXT_SHAPE_TYPES } from './constants.js';
import { appendShapeGraphic, applyTextVisualStyles } from './element-rendering.js';
import { getCropGeometry } from './image-geometry.js';
import { createTextContainer, setTextContainerContent } from './text-list.js';

function appendShape(svg, element, forThumb = false) {
  appendShapeGraphic(svg, element, {
    rectRadius: forThumb ? 6 : 12,
    shapeStrokeWidth: forThumb ? 8 : 10
  });
}

function applyTextSnapshotStyles(node, element, { showPlaceholder = false } = {}) {
  const isVisiblePlaceholder = !!element.isPlaceholder && showPlaceholder;
  node.style.margin = '0';
  node.style.padding = element.style.listType === 'none' ? '8px' : '8px 8px 8px 1.55em';
  node.style.whiteSpace = 'pre-wrap';
  node.style.wordBreak = 'break-word';
  applyTextVisualStyles(node, element, { visiblePlaceholder: isVisiblePlaceholder });
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

  // Порожній image-placeholder: у мініатюрі — легка рамка-підказка, у PDF/print
  // (forThumb=false) — нічого (службовий слот не потрапляє у показ/друк).
  if (element.type === 'image' && (element.isPlaceholder || !element.content)) {
    if (forThumb) {
      node.style.border = '2px dashed #cbd5e1';
      node.style.borderRadius = '8px';
      node.style.boxSizing = 'border-box';
    }
    return node;
  }

  if (element.type === 'image') {
    // Кадрування: вікно з overflow:hidden показує підпрямокутник, а зображення
    // лишається розміром у повну рамку й зсувається (однаково зі сценою).
    const crop = getCropGeometry(element.crop);
    const win = document.createElement('div');
    win.style.position = 'absolute';
    win.style.overflow = 'hidden';
    win.style.left = `${crop.l * 100}%`;
    win.style.top = `${crop.t * 100}%`;
    win.style.width = `${crop.visibleWidth * 100}%`;
    win.style.height = `${crop.visibleHeight * 100}%`;
    const img = document.createElement('img');
    img.src = element.content;
    img.alt = element.alt || '';
    img.style.position = 'absolute';
    img.style.width = `${crop.imageWidth * 100}%`;
    img.style.height = `${crop.imageHeight * 100}%`;
    img.style.left = `${crop.imageLeft * 100}%`;
    img.style.top = `${crop.imageTop * 100}%`;
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
