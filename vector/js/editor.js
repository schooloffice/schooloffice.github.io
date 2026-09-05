'use strict';

window.ArtVector = window.ArtVector || {};

(() => {
  const { state, utils, constants } = window.ArtVector;

  const SVG_NS = 'http://www.w3.org/2000/svg';

  // Сцена будується вузлами DOM, а не рядковими шаблонами: значення з project-файлу
  // потрапляють у setAttribute/textContent, тож жоден рядок не може «вийти» з
  // атрибута й стати розміткою. Той самий шлях використовує й SVG-експорт.
  function svgEl(tag, attrs = {}) {
    const node = document.createElementNS(SVG_NS, tag);
    Object.entries(attrs).forEach(([key, value]) => {
      if (value === undefined || value === null || value === false) return;
      node.setAttribute(key, String(value));
    });
    return node;
  }

  function fragmentOf(nodes) {
    const fragment = document.createDocumentFragment();
    nodes.forEach((node) => { if (node) fragment.appendChild(node); });
    return fragment;
  }

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
      state.selectedObjectIds = [];
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
      state.selectedObjectIds = (state.selectedObjectIds || []).filter((item) => item !== id);
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
      } else if (constants.POINT_TYPES.includes(copy.type)) {
        copy.points = copy.points.map((point) => ({ x: point.x + 20, y: point.y + 20 }));
      }
      state.objects.push(copy);
      state.selectedObjectId = copy.id;
      state.selectedObjectIds = [copy.id];
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
      state.selectedObjectIds = [obj.id];
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
      const layer = this.elements.guideLayer;
      if (guideMode === 'grid') {
        const lines = [];
        for (let x = constants.GRID_SIZE; x < canvasWidth; x += constants.GRID_SIZE) {
          lines.push(svgEl('line', { x1: x, y1: 0, x2: x, y2: canvasHeight, class: 'guide-line' }));
        }
        for (let y = constants.GRID_SIZE; y < canvasHeight; y += constants.GRID_SIZE) {
          lines.push(svgEl('line', { x1: 0, y1: y, x2: canvasWidth, y2: y, class: 'guide-line' }));
        }
        const group = svgEl('g', { class: 'guide-grid' });
        group.appendChild(fragmentOf(lines));
        layer.replaceChildren(group);
        return;
      }
      if (guideMode === 'lines') {
        const lines = [];
        for (let y = 32; y < canvasHeight; y += 28) {
          lines.push(svgEl('line', { x1: 0, y1: y, x2: canvasWidth, y2: y, class: 'guide-line notebook-line' }));
        }
        const group = svgEl('g', { class: 'guide-lines' });
        group.appendChild(fragmentOf(lines));
        layer.replaceChildren(group);
        return;
      }
      layer.replaceChildren();
    },

    renderContent() {
      const all = [...state.objects];
      if (state.draftObject) all.push(state.draftObject);
      this.elements.contentLayer.replaceChildren(fragmentOf(all.map((obj) => this.objectNode(obj))));
    },

    // Пошук вузла обходом дітей замість CSS-селектора: id з файла не мусить
    // бути валідним селектором, щоб виділення працювало.
    findObjectNode(id) {
      if (!id) return null;
      return Array.from(this.elements.contentLayer.children).find((node) => node.dataset.id === id) || null;
    },

    // Спільна рамка кількох фігур. Рахуємо по вже намальованих вузлах, тож
    // працює однаково для прямокутників, ліній, контурів і тексту.
    selectionBounds(ids) {
      const pad = 8;
      let minX = Infinity; let minY = Infinity; let maxX = -Infinity; let maxY = -Infinity;

      ids.forEach((id) => {
        const node = this.findObjectNode(id);
        if (!node || typeof node.getBBox !== 'function') return;
        const box = node.getBBox();
        minX = Math.min(minX, box.x);
        minY = Math.min(minY, box.y);
        maxX = Math.max(maxX, box.x + box.width);
        maxY = Math.max(maxY, box.y + box.height);
      });

      if (minX === Infinity) return null;
      return {
        x: Math.max(0, minX - pad),
        y: Math.max(0, minY - pad),
        width: (maxX - minX) + pad * 2,
        height: (maxY - minY) + pad * 2
      };
    },

    renderSelection() {
      const layer = this.elements.selectionLayer;
      const ids = state.selectedObjectIds || [];

      // Кілька фігур: показуємо спільну рамку без маркерів. Тягнути розмір
      // групи одним рухом ми не вміємо, тож і маркери обіцяти не можна.
      if (ids.length > 1) {
        const box = this.selectionBounds(ids);
        if (!box) { layer.replaceChildren(); return; }
        const group = svgEl('g');
        group.appendChild(svgEl('rect', {
          class: 'selection-box multi', x: box.x, y: box.y, width: box.width, height: box.height, rx: 4
        }));
        layer.replaceChildren(group);
        return;
      }

      const selected = this.getObjectById(state.selectedObjectId);
      if (!selected) {
        layer.replaceChildren();
        return;
      }
      if (constants.LINE_TYPES.includes(selected.type)) {
        layer.replaceChildren(this.lineSelectionNode(selected));
        return;
      }
      const node = this.findObjectNode(selected.id);
      if (!node || typeof node.getBBox !== 'function') {
        layer.replaceChildren();
        return;
      }
      const box = node.getBBox();
      const pad = 8;
      const x = Math.max(0, box.x - pad);
      const y = Math.max(0, box.y - pad);
      const w = box.width + pad * 2;
      const h = box.height + pad * 2;
      const group = svgEl('g');
      group.appendChild(svgEl('rect', { class: 'selection-box', x, y, width: w, height: h, rx: 4 }));
      if (selected.type !== 'text') {
        const handles = [
          ['nw', x, y], ['n', x + w / 2, y], ['ne', x + w, y],
          ['e', x + w, y + h / 2], ['se', x + w, y + h], ['s', x + w / 2, y + h],
          ['sw', x, y + h], ['w', x, y + h / 2]
        ].map(([handle, cx, cy]) => svgEl('rect', {
          class: 'selection-handle',
          'data-handle': handle,
          x: cx - 5,
          y: cy - 5,
          width: 10,
          height: 10,
          rx: 2
        }));
        group.appendChild(fragmentOf(handles));
      }
      layer.replaceChildren(group);
    },

    lineSelectionNode(obj) {
      const group = svgEl('g');
      group.appendChild(svgEl('line', { class: 'selection-line', x1: obj.x1, y1: obj.y1, x2: obj.x2, y2: obj.y2 }));
      group.appendChild(svgEl('circle', { class: 'selection-endpoint', 'data-handle': 'line-start', cx: obj.x1, cy: obj.y1, r: 6 }));
      group.appendChild(svgEl('circle', { class: 'selection-endpoint', 'data-handle': 'line-end', cx: obj.x2, cy: obj.y2, r: 6 }));
      return group;
    },

    // forExport: у файл ідуть лише геометрія й стиль, без редакторських
    // data-id/класів виділення.
    objectNode(obj, { forExport = false } = {}) {
      if (!obj || typeof obj !== 'object') return null;
      const shape = this.shapeNode(obj);
      if (!shape) return null;
      const group = forExport
        ? svgEl('g')
        : svgEl('g', {
          'data-id': obj.id,
          class: (state.selectedObjectIds || []).includes(obj.id) ? 'vector-object selected' : 'vector-object'
        });
      group.appendChild(shape);
      return group;
    },

    shapeNode(obj) {
      switch (obj.type) {
        case 'rect':
          return this.rectNode(obj);
        case 'ellipse':
          return this.ellipseNode(obj);
        case 'triangle':
          return this.polygonNode(obj, this.trianglePoints(obj));
        case 'diamond':
          return this.polygonNode(obj, this.diamondPoints(obj));
        case 'star':
          return this.polygonNode(obj, this.starPoints(obj));
        case 'line':
          return this.lineNode(obj, false);
        case 'arrow':
          return this.lineNode(obj, true);
        case 'pen':
          return this.penNode(obj);
        case 'curve':
          return this.curveNode(obj);
        case 'text':
          return this.textNode(obj);
        default:
          return null;
      }
    },

    commonShapeAttrs(obj) {
      return {
        stroke: obj.stroke || '#1f2937',
        'stroke-width': obj.strokeWidth || 3,
        fill: obj.fill && obj.fill !== 'none' ? obj.fill : 'none',
        opacity: (obj.opacity ?? 100) / 100,
        'stroke-linecap': 'round',
        'stroke-linejoin': 'round'
      };
    },

    rectNode(obj) {
      return svgEl('rect', { x: obj.x, y: obj.y, width: obj.w, height: obj.h, rx: 4, ...this.commonShapeAttrs(obj) });
    },

    ellipseNode(obj) {
      return svgEl('ellipse', {
        cx: obj.x + obj.w / 2,
        cy: obj.y + obj.h / 2,
        rx: obj.w / 2,
        ry: obj.h / 2,
        ...this.commonShapeAttrs(obj)
      });
    },

    polygonNode(obj, points) {
      return svgEl('polygon', { points, ...this.commonShapeAttrs(obj) });
    },

    lineNode(obj, withArrow) {
      const stroke = obj.stroke || '#1f2937';
      const node = svgEl('line', {
        x1: obj.x1,
        y1: obj.y1,
        x2: obj.x2,
        y2: obj.y2,
        stroke,
        'stroke-width': obj.strokeWidth || 3,
        opacity: (obj.opacity ?? 100) / 100,
        'stroke-linecap': 'round',
        'marker-end': withArrow ? 'url(#arrowHead)' : undefined
      });
      // Маркер стрілки успадковує колір через currentColor.
      node.style.setProperty('color', stroke);
      return node;
    },

    // Згладжений сплайн через ті самі точки, що й в олівця. Контрольні точки
    // рахуємо за Catmull-Rom: крива гарантовано проходить через кожну задану
    // точку, тож намальоване не «відпливає» від руки учня.
    curvePath(points) {
      const list = points || [];
      if (list.length < 2) return '';
      if (list.length === 2) {
        return `M ${list[0].x} ${list[0].y} L ${list[1].x} ${list[1].y}`;
      }

      let d = `M ${list[0].x} ${list[0].y}`;
      for (let i = 0; i < list.length - 1; i += 1) {
        const p0 = list[i - 1] || list[i];
        const p1 = list[i];
        const p2 = list[i + 1];
        const p3 = list[i + 2] || p2;
        const c1x = p1.x + (p2.x - p0.x) / 6;
        const c1y = p1.y + (p2.y - p0.y) / 6;
        const c2x = p2.x - (p3.x - p1.x) / 6;
        const c2y = p2.y - (p3.y - p1.y) / 6;
        d += ` C ${c1x} ${c1y}, ${c2x} ${c2y}, ${p2.x} ${p2.y}`;
      }
      return d;
    },

    curveNode(obj) {
      return svgEl('path', {
        d: this.curvePath(obj.points),
        stroke: obj.stroke || '#1f2937',
        'stroke-width': obj.strokeWidth || 3,
        fill: obj.fill && obj.fill !== 'none' ? obj.fill : 'none',
        opacity: (obj.opacity ?? 100) / 100,
        'stroke-linecap': 'round',
        'stroke-linejoin': 'round'
      });
    },

    penNode(obj) {
      const d = (obj.points || []).map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x} ${point.y}`).join(' ');
      return svgEl('path', {
        d,
        stroke: obj.stroke || '#1f2937',
        'stroke-width': obj.strokeWidth || 3,
        fill: 'none',
        opacity: (obj.opacity ?? 100) / 100,
        'stroke-linecap': 'round',
        'stroke-linejoin': 'round'
      });
    },

    textNode(obj) {
      const fontSize = obj.fontSize || 32;
      const node = svgEl('text', {
        x: obj.x,
        y: obj.y,
        fill: obj.fill && obj.fill !== 'none' ? obj.fill : (obj.stroke || '#1f2937'),
        'font-size': fontSize,
        'font-family': "'Nunito Sans', 'Nunito', sans-serif",
        'font-weight': 800,
        opacity: (obj.opacity ?? 100) / 100
      });
      utils.serializeLines(obj.text).forEach((line, index) => {
        const tspan = svgEl('tspan', { x: obj.x, dy: index === 0 ? 0 : fontSize * 1.25 });
        tspan.textContent = line || ' ';
        node.appendChild(tspan);
      });
      return node;
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
      const { projectIo } = window.ArtVector;
      return {
        format: projectIo.PROJECT_FORMAT,
        version: projectIo.PROJECT_VERSION,
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
      state.selectedObjectIds = [];
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

    // Дерево будується тими самими вузлами, що й сцена, і серіалізується
    // XMLSerializer — екранування атрибутів і тексту робить браузер.
    exportSvgNode() {
      const width = state.canvasWidth;
      const height = state.canvasHeight;
      const svg = svgEl('svg', { width, height, viewBox: `0 0 ${width} ${height}` });

      const marker = svgEl('marker', {
        id: 'arrowHead',
        markerWidth: 12,
        markerHeight: 12,
        refX: 10,
        refY: 6,
        orient: 'auto',
        markerUnits: 'strokeWidth'
      });
      marker.appendChild(svgEl('path', { d: 'M0,0 L12,6 L0,12 z', fill: 'currentColor' }));
      const defs = svgEl('defs');
      defs.appendChild(marker);

      svg.appendChild(defs);
      svg.appendChild(svgEl('rect', { width: '100%', height: '100%', fill: '#ffffff' }));
      svg.appendChild(fragmentOf(state.objects.map((obj) => this.objectNode(obj, { forExport: true }))));
      return svg;
    },

    exportSvgMarkup() {
      const markup = new XMLSerializer().serializeToString(this.exportSvgNode());
      return `<?xml version="1.0" encoding="UTF-8"?>\n${markup}`;
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
