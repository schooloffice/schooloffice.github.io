import { DEFAULT_SHAPE_STYLE, FONT_FAMILY_CSS, LINE_SHAPE_TYPES } from './constants.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

export function appendShapeGraphic(svg, element, { rectRadius = 12, shapeStrokeWidth = 8 } = {}) {
  const isLine = LINE_SHAPE_TYPES.includes(element.shape);
  let shape;

  if (isLine) {
    svg.setAttribute('preserveAspectRatio', 'none');
    shape = document.createElementNS(SVG_NS, element.shape === 'arrow' ? 'path' : 'line');
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
    shape = document.createElementNS(SVG_NS, 'ellipse');
    shape.setAttribute('cx', '50%');
    shape.setAttribute('cy', '50%');
    shape.setAttribute('rx', '48%');
    shape.setAttribute('ry', '48%');
  } else if (element.shape === 'triangle') {
    shape = document.createElementNS(SVG_NS, 'polygon');
    shape.setAttribute('points', '50,4 96,96 4,96');
  } else {
    shape = document.createElementNS(SVG_NS, 'rect');
    shape.setAttribute('x', '2%');
    shape.setAttribute('y', '2%');
    shape.setAttribute('width', '96%');
    shape.setAttribute('height', '96%');
    shape.setAttribute('rx', String(rectRadius));
    shape.setAttribute('ry', String(rectRadius));
  }

  shape.setAttribute('fill', isLine ? 'none' : (element.style.fill || DEFAULT_SHAPE_STYLE.fill));
  shape.setAttribute('stroke', element.style.stroke || DEFAULT_SHAPE_STYLE.stroke);
  shape.setAttribute('stroke-width', isLine ? '6' : String(shapeStrokeWidth));
  svg.appendChild(shape);
  return shape;
}

export function applyTextVisualStyles(node, element, { visiblePlaceholder = !!element.isPlaceholder } = {}) {
  node.style.fontSize = `${element.style.fontSize || 28}px`;
  node.style.color = visiblePlaceholder ? '#94a3b8' : (element.style.color || '#111827');
  node.style.fontWeight = element.style.bold ? '700' : '400';
  node.style.fontFamily = FONT_FAMILY_CSS[element.style.fontFamily] || 'inherit';
  node.style.lineHeight = String(element.style.lineHeight || 1.15);
  node.style.fontStyle = visiblePlaceholder ? 'normal' : (element.style.italic ? 'italic' : 'normal');
  node.style.textDecoration = visiblePlaceholder ? 'none' : (element.style.underline ? 'underline' : 'none');
  node.style.textAlign = element.style.align || 'left';
  node.classList.toggle('is-placeholder', visiblePlaceholder);
}
