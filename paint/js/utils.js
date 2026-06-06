'use strict';

window.ArtMalyunky = window.ArtMalyunky || {};

window.ArtMalyunky.utils = {
  $(id) {
    return document.getElementById(id);
  },

  $$(selector, root = document) {
    return Array.from(root.querySelectorAll(selector));
  },

  clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  },

  uid(prefix = 'obj') {
    return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
  },

  hexToRgb(hex) {
    let normalized = String(hex || '').replace('#', '').trim();
    if (normalized.length === 3) {
      normalized = normalized.split('').map((char) => char + char).join('');
    }
    if (normalized.length !== 6) {
      return { r: 31, g: 41, b: 55 };
    }
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

  byteToBinary(value) {
    return this.clamp(Number(value), 0, 255).toString(2).padStart(8, '0');
  },

  downloadDataUrl(dataUrl, fileName) {
    const link = document.createElement('a');
    link.href = dataUrl;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    link.remove();
  },

  createCanvas(width, height) {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    return canvas;
  },

  debounce(fn, delay = 160) {
    let timeoutId = null;
    return (...args) => {
      clearTimeout(timeoutId);
      timeoutId = window.setTimeout(() => fn(...args), delay);
    };
  },

  deepClone(value) {
    return JSON.parse(JSON.stringify(value));
  },

  normalizeRect(x1, y1, x2, y2) {
    return {
      x: Math.min(x1, x2),
      y: Math.min(y1, y2),
      w: Math.abs(x2 - x1),
      h: Math.abs(y2 - y1),
      flipX: x2 < x1,
      flipY: y2 < y1
    };
  },

  withMinSize(rect, minSize = 12) {
    return {
      ...rect,
      w: Math.max(minSize, rect.w),
      h: Math.max(minSize, rect.h)
    };
  },

  shuffle(array) {
    const copy = [...array];
    for (let i = copy.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      [copy[i], copy[j]] = [copy[j], copy[i]];
    }
    return copy;
  }
};
