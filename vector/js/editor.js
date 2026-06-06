'use strict';

window.ArtVector = window.ArtVector || {};

(() => {
  const { state, utils, constants } = window.ArtVector;

  const editor = {
    elements: {},

    init(elements) {
      this.elements = elements;
      this.renderAll();
    },

    getObjectById(id) {
      return state.objects.find((item) => item.id === id) || null;
    },

    setObjects(objects) {
      state.objects = utils.deepClone(objects || []);
      state.selectedObjectId = null;
      state.draftObject = null;
      this.renderAll();
    },

    addObject(obj) {
      state.objects.push(utils.deepClone(obj));
      this.renderAll();
    },

    updateObject(id, patch) {
      const obj = this.getObjectById(id);
      if (!obj) return null;
      Object.assign(obj, patch);
      this.renderAll();
      return obj;
    },

    replaceObject(id, nextObject) {
      const index = state.objects.findIndex((item) => item.id === id);
      if (index === -1) return null;
      state.objects[index] = utils.deepClone(nextObject);
      this.renderAll();
      return state.objects[index];
    },

    deleteObject(id) {
      const before = state.objects.length;
      state.objects = state.objects.filter((item) => item.id !== id);
      if (state.selectedObjectId === id) state.selectedObjectId = null;
      this.renderAll();
      return state.objects.length !== before;
    },

    duplicateObject(id) {
      const obj = this.getObjectById(id);
      if (!obj) return null;
      const copy = utils.deepClone(obj);
      copy.id = utils.uid(obj.type);
      if (constants.RECT_LIKE_TYPES.includes(copy.type) || copy.type === 'text') {
        copy.x += 20;
        copy.y += 20;
      } else if (constants.LINE_TYPES.includes(copy.type)) {
        copy.x1 += 20; copy.x2 += 20;
        copy.y1 += 20; copy.y2 += 20;
      } else if (copy.type === 'pen') {
        copy.points = copy.points.map((point) => ({ x: point.x + 20, y: point.y + 20 }));
      }
      state.objects.push(copy);
      state.selectedObjectId = copy.id;
      this.renderAll();
      return copy;
    },

    bringToFront(id) {
      const index = state.objects.findIndex((item) => item.id === id);
      if (index < 0 || index === state.objects.length - 1) return false;
      const [obj] = state.objects.splice(index, 1);
      state.objects.push(obj);
      this.renderAll();
      return true;
    },

    sendToBack(id) {
      const index = state.objects.findIndex((item) => item.id === id);
      if (index <= 0) return false;
      const [obj] = state.objects.splice(index, 1);
      state.objects.unshift(obj);
      this.renderAll();
      return true;
    },

    setDraft(obj) {
      state.draftObject = obj ? utils.deepClone(obj) : null;
      this.renderAll();
    },

    clearDraft() {
      state.draftObject = null;
      this.renderAll();
    },

    commitDraft() {
      if (!state.draftObject) return null;
      const obj = utils.deepClone(state.draftObject);
      state.objects.push(obj);
      state.selectedObjectId = obj.id;
      state.draftObject = null;
      this.renderAll();
      return obj;
    },

    renderAll() {
      this.renderGuides();
      this.renderContent();
      this.renderSelection();
    },

    renderGuides() {
      const { canvasWidth, canvasHeight, guideMode } = state;
      let markup = '';
      if (guideMode === 'grid') {
        const lines = [];
        for (let x = constants.GRID_SIZE; x < canvasWidth; x += constants.GRID_SIZE) {
          lines.push(`<line x1="${x}" y1="0" x2="${x}" y2="${canvasHeight}" class="guide-line"></line>`);
        }
        for (let y = constants.GRID_SIZE; y < canvasHeight; y += constants.GRID_SIZE) {
          lines.push(`<line x1="0" y1="${y}" x2="${canvasWidth}" y2="${y}" class="guide-line"></line>`);
        }
        markup = `<g class="guide-grid">${lines.join('')}</g>`;
      } else if (guideMode === 'lines') {
        const lines = [];
        for (let y = 32; y < canvasHeight; y += 28) {
          lines.push(`<line x1="0" y1="${y}" x2="${canvasWidth}" y2="${y}" class="guide-line notebook-line"></line>`);
        }
        markup = `<g class="guide-lines">${lines.join('')}</g>`;
      }
      this.elements.guideLayer.innerHTML = markup;
    },

    renderContent() {
      const all = [...state.objects];
      if (state.draftObject) all.push(state.draftObject);
      this.elements.contentLayer.innerHTML = all.map((obj) => this.objectMarkup(obj)).join('');
    },

    renderSelection() {
      const selected = this.getObjectById(state.selectedObjectId);
      if (!selected) {
        this.elements.selectionLayer.innerHTML = '';
        return;
      }
      if (constants.LINE_TYPES.includes(selected.type)) {
        this.elements.selectionLayer.innerHTML = this.lineSelectionMarkup(selected);
        return;
      }
      const node = this.elements.contentLayer.querySelector(`[data-id="${selected.id}"]`);
      if (!node || typeof node.getBBox !== 'function') {
        this.elements.selectionLayer.innerHTML = '';
        return;
      }
      const box = node.getBBox();
      const pad = 8;
      const x = Math.max(0, box.x - pad);
      const y = Math.max(0, box.y - pad);
      const w = box.width + pad * 2;
      const h = box.height + pad * 2;
      const rect = `<rect class="selection-box" x="${x}" y="${y}" width="${w}" height="${h}" rx="4"></rect>`;
      if (selected.type === 'text') {
        this.elements.selectionLayer.innerHTML = `<g>${rect}</g>`;
        return;
      }
      const handles = [
        ['nw', x, y], ['n', x + w / 2, y], ['ne', x + w, y],
        ['e', x + w, y + h / 2], ['se', x + w, y + h], ['s', x + w / 2, y + h],
        ['sw', x, y + h], ['w', x, y + h / 2]
      ].map(([handle, cx, cy]) => `<rect class="selection-handle" data-handle="${handle}" x="${cx - 5}" y="${cy - 5}" width="10" height="10" rx="2"></rect>`).join('');
      this.elements.selectionLayer.innerHTML = `<g>${rect}${handles}</g>`;
    },

    lineSelectionMarkup(obj) {
      return `
        <g>
          <line class="selection-line" x1="${obj.x1}" y1="${obj.y1}" x2="${obj.x2}" y2="${obj.y2}"></line>
          <circle class="selection-endpoint" data-handle="line-start" cx="${obj.x1}" cy="${obj.y1}" r="6"></circle>
          <circle class="selection-endpoint" data-handle="line-end" cx="${obj.x2}" cy="${obj.y2}" r="6"></circle>
        </g>`;
    },

    objectMarkup(obj) {
      const selected = obj.id === state.selectedObjectId ? 'selected' : '';
      const common = `data-id="${obj.id}" class="vector-object ${selected}"`;
      switch (obj.type) {
        case 'rect':
          return `<g ${common}>${this.rectMarkup(obj)}</g>`;
        case 'ellipse':
          return `<g ${common}>${this.ellipseMarkup(obj)}</g>`;
        case 'triangle':
          return `<g ${common}>${this.polygonMarkup(obj, this.trianglePoints(obj))}</g>`;
        case 'diamond':
          return `<g ${common}>${this.polygonMarkup(obj, this.diamondPoints(obj))}</g>`;
        case 'star':
          return `<g ${common}>${this.polygonMarkup(obj, this.starPoints(obj))}</g>`;
        case 'line':
          return `<g ${common}>${this.lineMarkup(obj, false)}</g>`;
        case 'arrow':
          return `<g ${common}>${this.lineMarkup(obj, true)}</g>`;
        case 'pen':
          return `<g ${common}>${this.penMarkup(obj)}</g>`;
        case 'text':
          return `<g ${common}>${this.textMarkup(obj)}</g>`;
        default:
          return '';
      }
    },

    commonShapeAttrs(obj) {
      const fill = obj.fill && obj.fill !== 'none' ? obj.fill : 'none';
      return `stroke="${obj.stroke || '#1f2937'}" stroke-width="${obj.strokeWidth || 3}" fill="${fill}" opacity="${(obj.opacity || 100) / 100}" stroke-linecap="round" stroke-linejoin="round"`;
    },

    rectMarkup(obj) {
      return `<rect x="${obj.x}" y="${obj.y}" width="${obj.w}" height="${obj.h}" rx="4" ${this.commonShapeAttrs(obj)}></rect>`;
    },

    ellipseMarkup(obj) {
      return `<ellipse cx="${obj.x + obj.w / 2}" cy="${obj.y + obj.h / 2}" rx="${obj.w / 2}" ry="${obj.h / 2}" ${this.commonShapeAttrs(obj)}></ellipse>`;
    },

    polygonMarkup(obj, points) {
      return `<polygon points="${points}" ${this.commonShapeAttrs(obj)}></polygon>`;
    },

    lineMarkup(obj, withArrow) {
      const marker = withArrow ? 'marker-end="url(#arrowHead)"' : '';
      return `<line x1="${obj.x1}" y1="${obj.y1}" x2="${obj.x2}" y2="${obj.y2}" stroke="${obj.stroke || '#1f2937'}" stroke-width="${obj.strokeWidth || 3}" opacity="${(obj.opacity || 100) / 100}" stroke-linecap="round" ${marker} style="color:${obj.stroke || '#1f2937'}"></line>`;
    },

    penMarkup(obj) {
      const points = (obj.points || []).map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x} ${point.y}`).join(' ');
      return `<path d="${points}" stroke="${obj.stroke || '#1f2937'}" stroke-width="${obj.strokeWidth || 3}" fill="none" opacity="${(obj.opacity || 100) / 100}" stroke-linecap="round" stroke-linejoin="round"></path>`;
    },

    textMarkup(obj) {
      const lines = utils.serializeLines(obj.text);
      return `
        <text x="${obj.x}" y="${obj.y}" fill="${obj.fill && obj.fill !== 'none' ? obj.fill : (obj.stroke || '#1f2937')}" font-size="${obj.fontSize || 32}" font-family="'Nunito Sans', 'Nunito', sans-serif" font-weight="800" opacity="${(obj.opacity || 100) / 100}">
          ${lines.map((line, index) => `<tspan x="${obj.x}" dy="${index === 0 ? 0 : (obj.fontSize || 32) * 1.25}">${utils.escapeHtml(line || ' ')}</tspan>`).join('')}
        </text>`;
    },

    trianglePoints(obj) {
      return `${obj.x + obj.w / 2},${obj.y} ${obj.x + obj.w},${obj.y + obj.h} ${obj.x},${obj.y + obj.h}`;
    },

    diamondPoints(obj) {
      return `${obj.x + obj.w / 2},${obj.y} ${obj.x + obj.w},${obj.y + obj.h / 2} ${obj.x + obj.w / 2},${obj.y + obj.h} ${obj.x},${obj.y + obj.h / 2}`;
    },

    starPoints(obj) {
      const cx = obj.x + obj.w / 2;
      const cy = obj.y + obj.h / 2;
      const outer = Math.min(obj.w, obj.h) / 2;
      const inner = outer * 0.45;
      const points = [];
      for (let i = 0; i < 10; i += 1) {
        const angle = (-90 + i * 36) * Math.PI / 180;
        const radius = i % 2 === 0 ? outer : inner;
        const px = cx + radius * Math.cos(angle);
        const py = cy + radius * Math.sin(angle);
        points.push(`${px},${py}`);
      }
      return points.join(' ');
    },

    buildProjectPayload() {
      return {
        fileName: state.fileName,
        canvasWidth: state.canvasWidth,
        canvasHeight: state.canvasHeight,
        guideMode: state.guideMode,
        snapToGrid: state.snapToGrid,
        currentTool: state.currentTool,
        currentStroke: state.currentStroke,
        currentFill: state.currentFill,
        currentStrokeWidth: state.currentStrokeWidth,
        currentOpacity: state.currentOpacity,
        currentFontSize: state.currentFontSize,
        objects: utils.deepClone(state.objects)
      };
    },

    restoreProject(payload) {
      state.fileName = payload.fileName || constants.DEFAULT_FILE_NAME;
      state.canvasWidth = Number(payload.canvasWidth) || constants.DEFAULT_CANVAS_WIDTH;
      state.canvasHeight = Number(payload.canvasHeight) || constants.DEFAULT_CANVAS_HEIGHT;
      state.guideMode = payload.guideMode || 'grid';
      state.snapToGrid = typeof payload.snapToGrid === 'boolean' ? payload.snapToGrid : true;
      state.currentTool = payload.currentTool || 'select';
      state.currentStroke = payload.currentStroke || '#1f2937';
      state.currentFill = payload.currentFill || 'none';
      state.currentStrokeWidth = Number(payload.currentStrokeWidth) || 3;
      state.currentOpacity = Number(payload.currentOpacity) || 100;
      state.currentFontSize = Number(payload.currentFontSize) || 32;
      state.objects = utils.deepClone(payload.objects || []);
      state.selectedObjectId = null;
      state.draftObject = null;
      this.resizeArtboard(state.canvasWidth, state.canvasHeight);
      this.renderAll();
    },

    resizeArtboard(width, height) {
      this.elements.drawingSvg.setAttribute('width', width);
      this.elements.drawingSvg.setAttribute('height', height);
      this.elements.drawingSvg.setAttribute('viewBox', `0 0 ${width} ${height}`);
      const bg = this.elements.drawingSvg.querySelector('.board-bg');
      if (bg) {
        bg.setAttribute('width', width);
        bg.setAttribute('height', height);
      }
    },

    exportSvgMarkup() {
      const width = state.canvasWidth;
      const height = state.canvasHeight;
      const objectsMarkup = state.objects.map((obj) => this.objectMarkup(obj)).join('');
      return `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">\n  <defs>\n    <marker id="arrowHead" markerWidth="12" markerHeight="12" refX="10" refY="6" orient="auto" markerUnits="strokeWidth">\n      <path d="M0,0 L12,6 L0,12 z" fill="currentColor"/>\n    </marker>\n  </defs>\n  <rect width="100%" height="100%" fill="#ffffff"/>\n  ${objectsMarkup}\n</svg>`;
    },

    async exportPngBlob() {
      const svgMarkup = this.exportSvgMarkup();
      const blob = new Blob([svgMarkup], { type: 'image/svg+xml;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      try {
        const image = await new Promise((resolve, reject) => {
          const img = new Image();
          img.onload = () => resolve(img);
          img.onerror = reject;
          img.src = url;
        });
        const canvas = document.createElement('canvas');
        canvas.width = state.canvasWidth;
        canvas.height = state.canvasHeight;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(image, 0, 0);
        const pngBlob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png', 1));
        return pngBlob;
      } finally {
        URL.revokeObjectURL(url);
      }
    }
  };

  window.ArtVector.editor = editor;
})();
