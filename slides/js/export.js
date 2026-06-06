import { STAGE_HEIGHT, STAGE_WIDTH } from './constants.js';

function appendShape(svg, element, forThumb = false) {
  const strokeWidth = forThumb ? '8' : '10';
  let shape;
  if (element.shape === 'circle') {
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
  shape.setAttribute('fill', element.style.fill || '#dbeafe');
  shape.setAttribute('stroke', element.style.stroke || '#1d4ed8');
  shape.setAttribute('stroke-width', strokeWidth);
  svg.appendChild(shape);
}

function buildElementNode(element, forThumb = false) {
  const node = document.createElement('div');
  node.style.position = 'absolute';
  node.style.left = `${element.x}px`;
  node.style.top = `${element.y}px`;
  node.style.width = `${element.w}px`;
  node.style.height = `${element.h}px`;
  node.style.zIndex = String(element.z || 1);
  node.style.overflow = 'visible';
  node.style.transform = `rotate(${element.rotation || 0}deg)`;
  node.style.transformOrigin = 'center center';

  if (element.type === 'text') {
    node.style.padding = '8px';
    node.style.whiteSpace = 'pre-wrap';
    node.style.wordBreak = 'break-word';
    node.style.lineHeight = '1.15';
    node.style.fontSize = `${element.style.fontSize || 28}px`;
    node.style.fontWeight = element.style.bold ? '900' : '700';
    node.style.fontStyle = element.style.italic ? 'italic' : 'normal';
    node.style.textDecoration = element.style.underline ? 'underline' : 'none';
    node.style.textAlign = element.style.align || 'left';
    node.style.color = element.style.color || '#111827';
    node.textContent = element.content || '';
  }

  if (element.type === 'image') {
    const img = document.createElement('img');
    img.src = element.content;
    img.style.width = '100%';
    img.style.height = '100%';
    img.style.objectFit = 'cover';
    node.appendChild(img);
  }

  if (element.type === 'shape') {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('width', '100%');
    svg.setAttribute('height', '100%');
    svg.setAttribute('viewBox', '0 0 100 100');
    appendShape(svg, element, forThumb);
    node.appendChild(svg);
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
