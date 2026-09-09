(function (root, factory) {
  'use strict';
  root.FlowchartsSvgExport = factory();
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const NS = 'http://www.w3.org/2000/svg';
  const XLINK = 'http://www.w3.org/1999/xlink';

  function svgEl(name, attrs = {}) {
    const el = document.createElementNS(NS, name);
    Object.entries(attrs).forEach(([key, value]) => el.setAttribute(key, String(value)));
    return el;
  }

  function luminance(hex) {
    const value = String(hex || '').replace('#', '');
    if (!/^[0-9a-f]{6}$/i.test(value)) return 255;
    const [r, g, b] = [0, 2, 4].map(i => parseInt(value.slice(i, i + 2), 16));
    return 0.299 * r + 0.587 * g + 0.114 * b;
  }

  function wrapText(value, maxChars) {
    const paragraphs = String(value || '').split(/\r?\n/);
    const lines = [];
    paragraphs.forEach(paragraph => {
      const words = paragraph.trim().split(/\s+/).filter(Boolean);
      if (!words.length) { lines.push(''); return; }
      let line = '';
      words.forEach(word => {
        if (!line) line = word;
        else if ((line + ' ' + word).length <= maxChars) line += ' ' + word;
        else { lines.push(line); line = word; }
      });
      if (line) lines.push(line);
    });
    return lines.slice(0, 8);
  }

  function addText(parent, value, x, y, width, options = {}) {
    const size = options.size || 15;
    const lineHeight = size * 1.22;
    const lines = wrapText(value, Math.max(6, Math.floor(width / (size * 0.58))));
    const text = svgEl('text', {
      x, y: y - ((lines.length - 1) * lineHeight) / 2,
      'text-anchor': 'middle', 'dominant-baseline': 'middle',
      'font-family': 'Arial, sans-serif', 'font-size': size,
      'font-weight': options.bold ? 700 : 500, fill: options.fill || '#172033'
    });
    lines.forEach((line, index) => {
      const tspan = svgEl('tspan', { x, dy: index === 0 ? 0 : lineHeight });
      tspan.textContent = line;
      text.appendChild(tspan);
    });
    parent.appendChild(text);
    return text;
  }

  function addShape(group, shape) {
    const x = Number(shape.left) || 0;
    const y = Number(shape.top) || 0;
    const w = Math.max(24, Number(shape.width) || (shape.type === 'connector' ? 54 : 160));
    const h = Math.max(24, Number(shape.height) || (shape.type === 'decision' ? 110 : 74));
    const cx = x + w / 2;
    const cy = y + h / 2;
    const fill = /^#[0-9a-f]{6}$/i.test(shape.color || '') ? shape.color : '#dbeafe';
    const common = { fill, stroke: '#24324a', 'stroke-width': 2, 'stroke-linejoin': 'round' };
    let body;
    if (shape.type === 'start-end') {
      body = svgEl('ellipse', { ...common, cx, cy, rx: w / 2, ry: h / 2 });
    } else if (shape.type === 'decision') {
      body = svgEl('polygon', { ...common, points: `${cx},${y} ${x + w},${cy} ${cx},${y + h} ${x},${cy}` });
    } else if (shape.type === 'input-output') {
      const skew = Math.min(w * 0.2, h * 0.45);
      body = svgEl('polygon', { ...common, points: `${x + skew},${y} ${x + w},${y} ${x + w - skew},${y + h} ${x},${y + h}` });
    } else if (shape.type === 'connector') {
      const r = Math.min(w, h) / 2;
      body = svgEl('ellipse', { ...common, cx, cy, rx: r, ry: r });
    } else {
      body = svgEl('rect', { ...common, x, y, width: w, height: h, rx: shape.type === 'process' ? 3 : 0 });
    }
    group.appendChild(body);
    if (shape.type === 'subroutine') {
      group.appendChild(svgEl('path', { d: `M ${x + 13} ${y} V ${y + h} M ${x + w - 13} ${y} V ${y + h}`, fill: 'none', stroke: '#24324a', 'stroke-width': 2 }));
    }
    addText(group, shape.textRaw || '', cx, cy, Math.max(30, w - (shape.type === 'decision' ? w * 0.38 : 24)), {
      fill: luminance(fill) < 145 ? '#ffffff' : '#172033'
    });
  }

  function pathD(points) {
    return (points || []).map((point, index) => `${index ? 'L' : 'M'} ${Number(point.x) || 0} ${Number(point.y) || 0}`).join(' ');
  }

  function midpoint(points) {
    if (!points?.length) return { x: 0, y: 0 };
    if (points.length === 1) return points[0];
    let total = 0;
    const lengths = [];
    for (let i = 1; i < points.length; i++) { const len = Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y); lengths.push(len); total += len; }
    let target = total / 2;
    for (let i = 0; i < lengths.length; i++) {
      if (target <= lengths[i]) {
        const t = lengths[i] ? target / lengths[i] : 0;
        return { x: points[i].x + (points[i + 1].x - points[i].x) * t, y: points[i].y + (points[i + 1].y - points[i].y) * t };
      }
      target -= lengths[i];
    }
    return points[points.length - 1];
  }

  function boundsOf(data) {
    const xs = [], ys = [];
    (data.shapes || []).forEach(shape => {
      const x = Number(shape.left) || 0, y = Number(shape.top) || 0;
      const w = Number(shape.width) || (shape.type === 'connector' ? 54 : 160);
      const h = Number(shape.height) || (shape.type === 'decision' ? 110 : 74);
      xs.push(x, x + w); ys.push(y, y + h);
    });
    (data.connections || []).forEach(conn => (conn.points || []).forEach(point => { xs.push(Number(point.x) || 0); ys.push(Number(point.y) || 0); }));
    if (!xs.length) return null;
    return { minX: Math.min(...xs), minY: Math.min(...ys), maxX: Math.max(...xs), maxY: Math.max(...ys) };
  }

  function createSvg(data, options = {}) {
    if (!data?.shapes?.length) throw new Error('Спочатку додай хоча б один блок.');
    const pad = Number(options.padding) || 48;
    const title = String(data.diagramTitle || '').trim();
    const box = boundsOf(data);
    const titleSpace = title ? 54 : 0;
    const minX = box.minX - pad;
    const minY = box.minY - pad - titleSpace;
    const width = Math.max(1, Math.ceil(box.maxX - box.minX + pad * 2));
    const height = Math.max(1, Math.ceil(box.maxY - box.minY + pad * 2 + titleSpace));
    const svg = svgEl('svg', { xmlns: NS, version: '1.1', viewBox: `${minX} ${minY} ${width} ${height}`, width, height, role: 'img' });
    svg.setAttributeNS('http://www.w3.org/2000/xmlns/', 'xmlns:xlink', XLINK);
    const titleEl = svgEl('title'); titleEl.textContent = title || 'Блок-схема'; svg.appendChild(titleEl);
    svg.appendChild(svgEl('rect', { x: minX, y: minY, width, height, fill: options.background || '#fafbff' }));
    const defs = svgEl('defs');
    const marker = svgEl('marker', { id: 'arrowhead', viewBox: '0 0 10 10', refX: 9, refY: 5, markerWidth: 8, markerHeight: 8, orient: 'auto-start-reverse' });
    marker.appendChild(svgEl('path', { d: 'M 0 0 L 10 5 L 0 10 z', fill: '#334155' })); defs.appendChild(marker); svg.appendChild(defs);
    if (title) addText(svg, title, (box.minX + box.maxX) / 2, box.minY - 40, width - pad * 2, { size: 24, bold: true });
    const connections = svgEl('g', { 'aria-label': 'З’єднання' });
    (data.connections || []).forEach(conn => {
      if (!conn.points || conn.points.length < 2) return;
      connections.appendChild(svgEl('path', { d: pathD(conn.points), fill: 'none', stroke: '#334155', 'stroke-width': 2.5, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'marker-end': 'url(#arrowhead)' }));
      const label = conn.label ?? (conn.type === 'yes' ? 'Так' : conn.type === 'no' ? 'Ні' : '');
      if (label) { const p = midpoint(conn.points); addText(connections, label, p.x, p.y - 11, 120, { size: 13, bold: true }); }
    });
    svg.appendChild(connections);
    const shapes = svgEl('g', { 'aria-label': 'Блоки' });
    data.shapes.forEach(shape => { const group = svgEl('g', { 'data-shape-id': shape.id || '' }); addShape(group, shape); shapes.appendChild(group); });
    svg.appendChild(shapes);
    return svg;
  }

  function serialize(data, options) {
    return '<?xml version="1.0" encoding="UTF-8"?>\n' + new XMLSerializer().serializeToString(createSvg(data, options));
  }

  function download(data, filename, options) {
    const blob = new Blob([serialize(data, options)], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a'); link.href = url; link.download = `${filename || 'блок-схема'}.svg`;
    document.body.appendChild(link); link.click(); link.remove(); URL.revokeObjectURL(url);
  }

  return { createSvg, serialize, download, wrapText };
}));
