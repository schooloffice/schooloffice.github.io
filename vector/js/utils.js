'use strict';

window.ArtVector = window.ArtVector || {};

window.ArtVector.utils = {
  $(id) {
    return document.getElementById(id);
  },

  $$(selector, root = document) {
    return Array.from(root.querySelectorAll(selector));
  },

  uid(prefix = 'obj') {
    return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
  },

  clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  },

  snap(value, step) {
    return Math.round(value / step) * step;
  },

  escapeHtml(value = '') {
    return String(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  },

  deepClone(value) {
    return JSON.parse(JSON.stringify(value));
  },

  normalizeRect(x1, y1, x2, y2) {
    return {
      x: Math.min(x1, x2),
      y: Math.min(y1, y2),
      w: Math.abs(x2 - x1),
      h: Math.abs(y2 - y1)
    };
  },

  downloadText(text, fileName, mime = 'application/json;charset=utf-8') {
    const blob = new Blob([text], { type: mime });
    this.downloadBlob(blob, fileName);
  },

  downloadBlob(blob, fileName) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  },

  hexToRgb(hex) {
    let normalized = String(hex || '').replace('#', '').trim();
    if (normalized === 'none') return null;
    if (normalized.length === 3) normalized = normalized.split('').map((char) => char + char).join('');
    if (normalized.length !== 6) return { r: 31, g: 41, b: 55 };
    return {
      r: parseInt(normalized.slice(0, 2), 16),
      g: parseInt(normalized.slice(2, 4), 16),
      b: parseInt(normalized.slice(4, 6), 16)
    };
  },

  rgbToHex(r, g, b) {
    const toHex = (value) => this.clamp(Number(value), 0, 255).toString(16).padStart(2, '0');
    return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
  },

  getSvgPoint(event, svg, width, height) {
    const rect = svg.getBoundingClientRect();
    return {
      x: this.clamp((event.clientX - rect.left) * (width / rect.width), 0, width),
      y: this.clamp((event.clientY - rect.top) * (height / rect.height), 0, height)
    };
  },

  distance(a, b) {
    const dx = a.x - b.x;
    const dy = a.y - b.y;
    return Math.sqrt(dx * dx + dy * dy);
  },

  pointsBounds(points = []) {
    if (!points.length) return { x: 0, y: 0, w: 0, h: 0 };
    const xs = points.map((item) => item.x);
    const ys = points.map((item) => item.y);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);
    return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
  },

  scalePoints(points, fromBounds, toBounds) {
    const scaleX = fromBounds.w === 0 ? 1 : toBounds.w / fromBounds.w;
    const scaleY = fromBounds.h === 0 ? 1 : toBounds.h / fromBounds.h;
    return points.map((point) => ({
      x: toBounds.x + (point.x - fromBounds.x) * scaleX,
      y: toBounds.y + (point.y - fromBounds.y) * scaleY
    }));
  },

  serializeLines(text) {
    const lines = String(text || '').replace(/\r/g, '').split('\n');
    return lines.length ? lines : ['Текст'];
  },

  fileToText(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ''));
      reader.onerror = reject;
      reader.readAsText(file);
    });
  }
};
