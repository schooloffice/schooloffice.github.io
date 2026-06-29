'use strict';

window.ArtMalyunky = window.ArtMalyunky || {};

(() => {
  const { state, utils, constants } = window.ArtMalyunky;

  const canvasApi = {
    canvas: null,
    ctx: null,
    guideCanvas: null,
    guideCtx: null,
    objectLayer: null,
    selectionCanvas: null,
    selectionCtx: null,
    stage: null,
    stageWrap: null,

    init({ canvas, guideCanvas, objectLayer, selectionCanvas, stage, stageWrap }) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d', { willReadFrequently: true });
      this.guideCanvas = guideCanvas;
      this.guideCtx = guideCanvas.getContext('2d');
      this.objectLayer = objectLayer;
      this.selectionCanvas = selectionCanvas;
      this.selectionCtx = selectionCanvas ? selectionCanvas.getContext('2d') : null;
      this.stage = stage;
      this.stageWrap = stageWrap;
      this.setDocumentSize(state.document.width, state.document.height, { clear: true });
      this.fitDocumentToViewport();
      this.renderObjects();
      this.drawGuides();
    },

    // Розмір документа — єдине джерело правди. Backing store полотна = пікселі документа
    // і НЕ залежить від розміру контейнера. Resize вікна впливає лише на zoom через viewport.
    setDocumentSize(width, height, { clear = true, background, transparent } = {}) {
      const w = utils.clamp(Math.round(width), constants.MIN_DOC_DIMENSION, constants.MAX_DOC_DIMENSION);
      const h = utils.clamp(Math.round(height), constants.MIN_DOC_DIMENSION, constants.MAX_DOC_DIMENSION);

      if (typeof background === 'string') state.document.background = background;
      if (typeof transparent === 'boolean') state.document.transparent = transparent;

      state.document.width = w;
      state.document.height = h;

      this.canvas.width = w;
      this.canvas.height = h;
      this.guideCanvas.width = w;
      this.guideCanvas.height = h;
      this.objectLayer.style.width = `${w}px`;
      this.objectLayer.style.height = `${h}px`;
      if (this.selectionCanvas) {
        this.selectionCanvas.width = w;
        this.selectionCanvas.height = h;
      }
      // Зміна розміру документа робить попереднє виділення невалідним.
      state.selection = null;

      if (clear) this.fillBackground();
      this.applyDisplaySize();
      this.drawGuides();
    },

    // Зміна розміру полотна користувачем зі збереженням наявного растру (crop або розширення).
    resizeDocument(width, height, { scale = false, smooth = true } = {}) {
      this.flattenSelection();
      const previous = utils.createCanvas(this.canvas.width, this.canvas.height);
      previous.getContext('2d').drawImage(this.canvas, 0, 0);
      const prevW = this.canvas.width;
      const prevH = this.canvas.height;
      this.setDocumentSize(width, height, { clear: true });
      if (scale) {
        this.ctx.imageSmoothingEnabled = !!smooth;
        this.ctx.imageSmoothingQuality = smooth ? 'high' : 'low';
        this.ctx.drawImage(previous, 0, 0, prevW, prevH, 0, 0, this.canvas.width, this.canvas.height);
        this.ctx.imageSmoothingEnabled = true;
      } else {
        this.ctx.drawImage(previous, 0, 0);
      }
      this.renderObjects();
    },

    // Колір пікселя під точкою (для піпетки).
    pickColor(x, y) {
      const px = utils.clamp(Math.floor(x), 0, this.canvas.width - 1);
      const py = utils.clamp(Math.floor(y), 0, this.canvas.height - 1);
      const data = this.ctx.getImageData(px, py, 1, 1).data;
      return utils.rgbToHex(data[0], data[1], data[2]);
    },

    // Запікає тимчасові об'єкти (фігури/штампи) у растр — крок до raster-first моделі.
    // Трансформації документа працюють по пласкому растру, тож спершу зводимо об'єкти.
    flattenObjects() {
      if (!state.objects.length) return;
      this.renderObjectsToCanvas(this.ctx, state.objects);
      state.objects = [];
      state.selectedObjectId = null;
      state.pendingObject = null;
      this.renderObjects();
    },

    rotate90(direction = 'cw') {
      this.flattenSelection();
      this.flattenObjects();
      const source = utils.createCanvas(this.canvas.width, this.canvas.height);
      source.getContext('2d').drawImage(this.canvas, 0, 0);
      const prevW = this.canvas.width;
      const prevH = this.canvas.height;
      this.setDocumentSize(prevH, prevW, { clear: true });
      this.ctx.save();
      if (direction === 'cw') {
        this.ctx.translate(this.canvas.width, 0);
        this.ctx.rotate(Math.PI / 2);
      } else {
        this.ctx.translate(0, this.canvas.height);
        this.ctx.rotate(-Math.PI / 2);
      }
      this.ctx.drawImage(source, 0, 0);
      this.ctx.restore();
      this.fitDocumentToViewport();
    },

    rotate180() {
      this.flattenSelection();
      this.flattenObjects();
      const source = utils.createCanvas(this.canvas.width, this.canvas.height);
      source.getContext('2d').drawImage(this.canvas, 0, 0);
      this.fillBackground();
      this.ctx.save();
      this.ctx.translate(this.canvas.width, this.canvas.height);
      this.ctx.rotate(Math.PI);
      this.ctx.drawImage(source, 0, 0);
      this.ctx.restore();
    },

    flip(axis = 'horizontal') {
      this.flattenSelection();
      this.flattenObjects();
      const source = utils.createCanvas(this.canvas.width, this.canvas.height);
      source.getContext('2d').drawImage(this.canvas, 0, 0);
      this.fillBackground();
      this.ctx.save();
      if (axis === 'horizontal') {
        this.ctx.translate(this.canvas.width, 0);
        this.ctx.scale(-1, 1);
      } else {
        this.ctx.translate(0, this.canvas.height);
        this.ctx.scale(1, -1);
      }
      this.ctx.drawImage(source, 0, 0);
      this.ctx.restore();
    },

    // === Прямокутне виділення растру ===
    pointInSelection(point) {
      const sel = state.selection;
      return !!sel && point.x >= sel.x && point.x <= sel.x + sel.w
        && point.y >= sel.y && point.y <= sel.y + sel.h;
    },

    // Очищає прямокутну ділянку до фону документа (білий або прозорий).
    clearRegion(x, y, w, h) {
      this.ctx.save();
      this.ctx.globalCompositeOperation = 'source-over';
      this.ctx.globalAlpha = 1;
      this.ctx.clearRect(x, y, w, h);
      if (!state.document.transparent) {
        this.ctx.fillStyle = state.document.background || '#ffffff';
        this.ctx.fillRect(x, y, w, h);
      }
      this.ctx.restore();
    },

    // «Піднімає» пікселі під виділенням у плаваючий буфер і очищає джерело.
    liftSelection() {
      const sel = state.selection;
      if (!sel || sel.floating || sel.w < 1 || sel.h < 1) return;
      const buffer = utils.createCanvas(sel.w, sel.h);
      buffer.getContext('2d').drawImage(this.canvas, sel.x, sel.y, sel.w, sel.h, 0, 0, sel.w, sel.h);
      sel.floating = buffer;
      this.clearRegion(sel.x, sel.y, sel.w, sel.h);
    },

    drawSelectionOverlay() {
      const ctx = this.selectionCtx;
      if (!ctx) return;
      ctx.clearRect(0, 0, this.selectionCanvas.width, this.selectionCanvas.height);
      const sel = state.selection;
      if (!sel) return;
      const x = Math.round(sel.x);
      const y = Math.round(sel.y);
      const w = Math.round(sel.w);
      const h = Math.round(sel.h);
      if (sel.floating) ctx.drawImage(sel.floating, x, y);
      ctx.save();
      ctx.strokeStyle = 'rgba(37, 99, 235, .95)';
      ctx.lineWidth = 1;
      ctx.setLineDash([5, 4]);
      ctx.strokeRect(x + 0.5, y + 0.5, Math.max(0, w - 1), Math.max(0, h - 1));
      ctx.restore();
    },

    // Запікає плаваюче виділення в растр. Повертає true, якщо растр змінився.
    flattenSelection() {
      const sel = state.selection;
      let changed = false;
      if (sel && sel.floating) {
        this.ctx.drawImage(sel.floating, Math.round(sel.x), Math.round(sel.y));
        changed = true;
      }
      state.selection = null;
      this.drawSelectionOverlay();
      return changed;
    },

    clearSelection() {
      state.selection = null;
      this.drawSelectionOverlay();
    },

    copySelectionToBuffer() {
      const sel = state.selection;
      if (!sel || sel.w < 1 || sel.h < 1) return null;
      const buffer = utils.createCanvas(sel.w, sel.h);
      const ctx = buffer.getContext('2d');
      if (sel.floating) ctx.drawImage(sel.floating, 0, 0);
      else ctx.drawImage(this.canvas, sel.x, sel.y, sel.w, sel.h, 0, 0, sel.w, sel.h);
      return buffer;
    },

    deleteSelection() {
      const sel = state.selection;
      if (!sel) return;
      // Якщо вже піднято — джерело очищене ще при lift; інакше очищаємо зараз.
      if (!sel.floating) this.clearRegion(sel.x, sel.y, sel.w, sel.h);
      state.selection = null;
      this.drawSelectionOverlay();
    },

    // Обрізає документ до прямокутного виділення.
    cropToSelection() {
      const sel = state.selection;
      if (!sel || sel.w < 3 || sel.h < 3) return false;
      const rect = { x: Math.round(sel.x), y: Math.round(sel.y), w: Math.round(sel.w), h: Math.round(sel.h) };
      this.flattenSelection();
      this.flattenObjects();
      const region = utils.createCanvas(rect.w, rect.h);
      region.getContext('2d').drawImage(this.canvas, rect.x, rect.y, rect.w, rect.h, 0, 0, rect.w, rect.h);
      this.setDocumentSize(rect.w, rect.h, { clear: true });
      this.ctx.drawImage(region, 0, 0);
      this.fitDocumentToViewport();
      return true;
    },

    // Вставляє буфер як нове виділення (пікселі одразу в растрі + маркер для переміщення).
    pasteBuffer(buffer) {
      if (!buffer) return;
      this.flattenSelection();
      const w = Math.min(buffer.width, this.canvas.width);
      const h = Math.min(buffer.height, this.canvas.height);
      this.ctx.drawImage(buffer, 0, 0);
      state.selection = { x: 0, y: 0, w, h, floating: null };
      this.drawSelectionOverlay();
    },

    fillBackground() {
      this.ctx.save();
      this.ctx.globalCompositeOperation = 'source-over';
      this.ctx.globalAlpha = 1;
      this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
      if (!state.document.transparent) {
        this.ctx.fillStyle = state.document.background || '#ffffff';
        this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
      }
      this.ctx.restore();
    },

    // Розмір ПРЕДСТАВЛЕННЯ документа = пікселі документа × zoom. Backing store не чіпаємо.
    applyDisplaySize() {
      if (!this.stage) return;
      const { width, height } = state.document;
      const zoom = state.viewport.zoom;
      this.stage.style.width = `${Math.round(width * zoom)}px`;
      this.stage.style.height = `${Math.round(height * zoom)}px`;
      // Прозорий документ показує checkerboard замість білого фону.
      this.stage.classList.toggle('transparent-doc', !!state.document.transparent);
      this.objectLayer.style.transformOrigin = 'top left';
      this.objectLayer.style.transform = `scale(${zoom})`;
    },

    fitDocumentToViewport() {
      if (!this.stageWrap) return;
      const padding = constants.STAGE_PADDING * 2;
      const availW = Math.max(1, this.stageWrap.clientWidth - padding);
      const availH = Math.max(1, this.stageWrap.clientHeight - padding);
      const raw = Math.min(availW / state.document.width, availH / state.document.height);
      state.viewport.zoom = utils.clamp(raw, constants.MIN_ZOOM, constants.MAX_ZOOM);
      state.viewport.fitMode = 'fit';
      this.applyDisplaySize();
      this.centerScroll();
    },

    // Викликається на resize вікна: лише перераховує fit-zoom, НІКОЛИ не змінює пікселі документа.
    refit() {
      if (state.viewport.fitMode === 'fit') {
        this.fitDocumentToViewport();
      } else {
        this.applyDisplaySize();
      }
    },

    setZoom(zoom, { fitMode = 'custom' } = {}) {
      state.viewport.zoom = utils.clamp(zoom, constants.MIN_ZOOM, constants.MAX_ZOOM);
      state.viewport.fitMode = fitMode;
      this.applyDisplaySize();
    },

    getZoom() {
      return state.viewport.zoom;
    },

    nextZoom(direction) {
      const levels = constants.ZOOM_LEVELS;
      const z = state.viewport.zoom;
      if (direction > 0) {
        return levels.find((level) => level > z + 1e-4) ?? constants.MAX_ZOOM;
      }
      const lower = levels.filter((level) => level < z - 1e-4);
      return lower.length ? lower[lower.length - 1] : constants.MIN_ZOOM;
    },

    zoomIn() {
      this.setZoom(this.nextZoom(1));
    },

    zoomOut() {
      this.setZoom(this.nextZoom(-1));
    },

    zoomTo100() {
      this.setZoom(1);
    },

    // Зум із прив'язкою до точки під курсором (Ctrl + колесо).
    zoomAtPoint(factor, clientX, clientY) {
      const prevZoom = state.viewport.zoom;
      const nextZoom = utils.clamp(prevZoom * factor, constants.MIN_ZOOM, constants.MAX_ZOOM);
      if (Math.abs(nextZoom - prevZoom) < 1e-4) return;
      const anchor = this.clientToDoc(clientX, clientY);
      this.setZoom(nextZoom);
      if (!this.stageWrap) return;
      const after = this.docToClient(anchor.x, anchor.y);
      this.stageWrap.scrollLeft += after.x - clientX;
      this.stageWrap.scrollTop += after.y - clientY;
    },

    centerScroll() {
      const wrap = this.stageWrap;
      if (!wrap) return;
      wrap.scrollLeft = Math.max(0, (wrap.scrollWidth - wrap.clientWidth) / 2);
      wrap.scrollTop = Math.max(0, (wrap.scrollHeight - wrap.clientHeight) / 2);
    },

    clearAll() {
      this.fillBackground();
      state.objects = [];
      state.selectedObjectId = null;
      state.pendingObject = null;
      state.selection = null;
      this.renderObjects();
      this.drawSelectionOverlay();
    },

    // Єдине джерело правди для перетворення координат viewport <-> документ.
    clientToDoc(clientX, clientY) {
      const rect = this.canvas.getBoundingClientRect();
      return {
        x: (clientX - rect.left) * (this.canvas.width / rect.width),
        y: (clientY - rect.top) * (this.canvas.height / rect.height)
      };
    },

    docToClient(docX, docY) {
      const rect = this.canvas.getBoundingClientRect();
      return {
        x: rect.left + docX * (rect.width / this.canvas.width),
        y: rect.top + docY * (rect.height / this.canvas.height)
      };
    },

    getPointerPosition(event) {
      const point = this.clientToDoc(event.clientX, event.clientY);
      return {
        x: utils.clamp(Math.round(point.x), 0, this.canvas.width),
        y: utils.clamp(Math.round(point.y), 0, this.canvas.height)
      };
    },

    activeStrokeColor() {
      return state.activeColor || state.currentColor;
    },

    activeShapeFillColor() {
      return state.backgroundColor || constants.DEFAULT_BG_COLOR;
    },

    shapeStrokeColor(obj) {
      return utils.sanitizeHexColor(obj.strokeColor || obj.color, constants.DEFAULT_COLOR);
    },

    shapeFillColor(obj) {
      return utils.sanitizeHexColor(obj.fillColor || obj.color, constants.DEFAULT_BG_COLOR);
    },

    setRasterStyle() {
      const brush = constants.BRUSHES[state.currentBrush] || constants.BRUSHES.pencil;
      const color = this.activeStrokeColor();
      this.ctx.strokeStyle = color;
      this.ctx.fillStyle = color;
      this.ctx.lineWidth = Math.max(1, state.currentSize * brush.sizeMultiplier);
      this.ctx.lineCap = brush.lineCap;
      this.ctx.lineJoin = 'round';
      this.ctx.globalAlpha = utils.clamp((state.currentOpacity / 100) * brush.opacityMultiplier, 0.05, 1);
    },

    drawFreehand(x, y) {
      const brush = constants.BRUSHES[state.currentBrush] || constants.BRUSHES.pencil;
      if (brush.spray) {
        this.spray(x, y);
        return;
      }
      this.ctx.save();
      this.setRasterStyle();
      this.ctx.beginPath();
      this.ctx.moveTo(state.lastX, state.lastY);
      this.ctx.lineTo(x, y);
      this.ctx.stroke();
      this.ctx.restore();
    },

    erase(x, y) {
      this.ctx.save();
      this.ctx.globalAlpha = 1;
      if (state.document.transparent) {
        // На прозорому документі гумка реально очищає alpha, а не малює фоном.
        this.ctx.globalCompositeOperation = 'destination-out';
        this.ctx.strokeStyle = 'rgba(0,0,0,1)';
      } else {
        this.ctx.globalCompositeOperation = 'source-over';
        this.ctx.strokeStyle = state.document.background || '#ffffff';
      }
      this.ctx.lineWidth = Math.max(4, state.currentSize * 1.2);
      this.ctx.lineCap = 'round';
      this.ctx.lineJoin = 'round';
      this.ctx.beginPath();
      this.ctx.moveTo(state.lastX, state.lastY);
      this.ctx.lineTo(x, y);
      this.ctx.stroke();
      this.ctx.restore();
    },

    // Запікає текст у растр (raster-first: текстовий overlay лише до підтвердження).
    drawText({ text, x, y, fontSize, fontFamily, bold, italic, color, opacity }) {
      const value = String(text == null ? '' : text);
      if (!value) return;
      const ctx = this.ctx;
      ctx.save();
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = utils.clamp((Number(opacity) || 100) / 100, 0.05, 1);
      ctx.fillStyle = utils.sanitizeHexColor(color, constants.DEFAULT_COLOR);
      ctx.textBaseline = 'top';
      const size = Math.max(1, Number(fontSize) || constants.DEFAULT_FONT_SIZE);
      const weight = bold ? '700 ' : '';
      const slant = italic ? 'italic ' : '';
      ctx.font = `${slant}${weight}${size}px ${fontFamily || constants.DEFAULT_FONT_FAMILY}`;
      const lineHeight = size * 1.2;
      value.split('\n').forEach((line, index) => ctx.fillText(line, x, y + index * lineHeight));
      ctx.restore();
    },

    spray(x, y) {
      this.ctx.save();
      this.setRasterStyle();
      const radius = Math.max(8, state.currentSize * 3);
      const density = Math.max(8, Math.ceil(state.currentSize * 3));
      for (let i = 0; i < density; i += 1) {
        const angle = Math.random() * Math.PI * 2;
        const distance = Math.sqrt(Math.random()) * radius;
        const px = x + distance * Math.cos(angle);
        const py = y + distance * Math.sin(angle);
        this.ctx.beginPath();
        this.ctx.arc(px, py, 1.1, 0, Math.PI * 2);
        this.ctx.fill();
      }
      this.ctx.restore();
    },

    floodFill(startX, startY) {
      if (!this.isInBounds(startX, startY)) return;
      const imageData = this.ctx.getImageData(0, 0, this.canvas.width, this.canvas.height);
      const data = imageData.data;
      const width = this.canvas.width;
      const height = this.canvas.height;
      const startIndex = (startY * width + startX) * 4;
      const target = {
        r: data[startIndex],
        g: data[startIndex + 1],
        b: data[startIndex + 2],
        a: data[startIndex + 3]
      };
      const fill = utils.hexToRgb(this.activeStrokeColor());
      if (target.r === fill.r && target.g === fill.g && target.b === fill.b && target.a === 255) return;

      const visited = new Uint8Array(width * height);
      const stack = [[startX, startY]];
      while (stack.length) {
        const [x, y] = stack.pop();
        const key = y * width + x;
        if (visited[key]) continue;
        const index = key * 4;
        if (!this.colorMatches(data, index, target)) continue;
        let left = x;
        let right = x;
        while (left > 0 && this.colorMatches(data, (y * width + (left - 1)) * 4, target)) left -= 1;
        while (right < width - 1 && this.colorMatches(data, (y * width + (right + 1)) * 4, target)) right += 1;
        for (let px = left; px <= right; px += 1) {
          const pos = y * width + px;
          const pxIndex = pos * 4;
          data[pxIndex] = fill.r;
          data[pxIndex + 1] = fill.g;
          data[pxIndex + 2] = fill.b;
          data[pxIndex + 3] = Math.round(255 * (state.currentOpacity / 100));
          visited[pos] = 1;
          if (y > 0) {
            const up = (y - 1) * width + px;
            if (!visited[up] && this.colorMatches(data, up * 4, target)) stack.push([px, y - 1]);
          }
          if (y < height - 1) {
            const down = (y + 1) * width + px;
            if (!visited[down] && this.colorMatches(data, down * 4, target)) stack.push([px, y + 1]);
          }
        }
      }
      this.ctx.putImageData(imageData, 0, 0);
    },

    colorMatches(data, index, target, tolerance = 12) {
      return Math.abs(data[index] - target.r) <= tolerance
        && Math.abs(data[index + 1] - target.g) <= tolerance
        && Math.abs(data[index + 2] - target.b) <= tolerance
        && Math.abs(data[index + 3] - target.a) <= tolerance;
    },

    isInBounds(x, y) {
      return x >= 0 && x < this.canvas.width && y >= 0 && y < this.canvas.height;
    },

    decodeImage(dataUrl) {
      return new Promise((resolve, reject) => {
        const image = new Image();
        image.onload = () => resolve(image);
        image.onerror = () => reject(new Error('image-decode-failed'));
        image.src = dataUrl;
      });
    },

    // Рахує цільовий розмір імпорту з безпечними лімітами (сторона + кількість пікселів).
    // `scaled: true`, якщо зображення доведеться зменшити.
    planImageImport(image) {
      const naturalW = image.naturalWidth || image.width || 1;
      const naturalH = image.naturalHeight || image.height || 1;
      let scale = Math.min(1, constants.MAX_DOC_DIMENSION / naturalW, constants.MAX_DOC_DIMENSION / naturalH);
      if (naturalW * scale * naturalH * scale > constants.MAX_DOC_PIXELS) {
        scale = Math.min(scale, Math.sqrt(constants.MAX_DOC_PIXELS / (naturalW * naturalH)));
      }
      return {
        naturalW,
        naturalH,
        targetW: Math.max(constants.MIN_DOC_DIMENSION, Math.round(naturalW * scale)),
        targetH: Math.max(constants.MIN_DOC_DIMENSION, Math.round(naturalH * scale)),
        scaled: scale < 1
      };
    },

    // Робить зображення новим документом заданого розміру.
    placeImageAsDocument(image, targetW, targetH) {
      this.setDocumentSize(targetW, targetH, { clear: true });
      this.ctx.drawImage(image, 0, 0, targetW, targetH);
      this.fitDocumentToViewport();
    },

    exportMergedCanvas({ flatten = true } = {}) {
      const composite = utils.createCanvas(this.canvas.width, this.canvas.height);
      const ctx = composite.getContext('2d');
      if (flatten) {
        ctx.fillStyle = state.document.background || '#ffffff';
        ctx.fillRect(0, 0, composite.width, composite.height);
      }
      ctx.drawImage(this.canvas, 0, 0);
      this.renderObjectsToCanvas(ctx, state.objects);
      return composite;
    },

    exportImage(mime = 'image/png', quality = 0.92) {
      // PNG зберігає прозорість для прозорого документа; JPG не має alpha — завжди фон.
      const flatten = mime !== 'image/png' || !state.document.transparent;
      return this.exportMergedCanvas({ flatten }).toDataURL(mime, quality);
    },

    // Снапшот історії: растр як offscreen-canvas (СИНХРОННО, без PNG-кодування й async-декоду).
    snapshot() {
      const raster = utils.createCanvas(this.canvas.width, this.canvas.height);
      raster.getContext('2d').drawImage(this.canvas, 0, 0);
      return {
        width: state.document.width,
        height: state.document.height,
        background: state.document.background,
        transparent: state.document.transparent,
        raster,
        objects: utils.deepClone(state.objects),
        bytes: this.canvas.width * this.canvas.height * 4
      };
    },

    restoreSnapshot(snapshot) {
      if (!snapshot) return;
      if (snapshot.width && snapshot.height) {
        this.setDocumentSize(snapshot.width, snapshot.height, {
          clear: false,
          background: snapshot.background,
          transparent: snapshot.transparent
        });
      }
      this.fillBackground();
      if (snapshot.raster) this.ctx.drawImage(snapshot.raster, 0, 0);
      state.objects = utils.deepClone(snapshot.objects || []);
      state.pendingObject = null;
      state.selectedObjectId = null;
      state.selection = null;
      this.renderObjects();
      this.drawSelectionOverlay();
    },

    // Серіалізований стан для чернетки/проєкту (JSON-safe; растр як dataURL).
    toSerializable() {
      return {
        document: { ...state.document },
        raster: this.canvas.toDataURL('image/png'),
        objects: utils.deepClone(state.objects),
        settings: {
          currentTool: state.currentTool,
          currentBrush: state.currentBrush,
          currentShape: state.currentShape,
          currentStamp: state.currentStamp,
          currentColor: state.currentColor,
          backgroundColor: state.backgroundColor,
          currentSize: state.currentSize,
          currentOpacity: state.currentOpacity,
          currentFontSize: state.currentFontSize,
          currentFontFamily: state.currentFontFamily,
          currentBold: state.currentBold,
          currentItalic: state.currentItalic,
          guideMode: state.guideMode
        }
      };
    },

    async restoreSerializable(data) {
      if (!data) return;
      const doc = data.document || {};
      if (doc.width && doc.height) {
        this.setDocumentSize(doc.width, doc.height, {
          clear: false,
          background: doc.background,
          transparent: doc.transparent
        });
      }
      await this.restoreRasterFromDataUrl(typeof data.raster === 'string' ? data.raster : null);
      state.objects = utils.deepClone(data.objects || []);
      const settings = data.settings || {};
      if (constants.TOOLS[settings.currentTool]) state.currentTool = settings.currentTool;
      if (constants.BRUSHES[settings.currentBrush]) state.currentBrush = settings.currentBrush;
      if (constants.SHAPES[settings.currentShape]) state.currentShape = settings.currentShape;
      if (constants.STAMP_POOL.includes(settings.currentStamp)) state.currentStamp = settings.currentStamp;
      state.currentColor = utils.sanitizeHexColor(settings.currentColor, state.currentColor);
      state.backgroundColor = utils.sanitizeHexColor(settings.backgroundColor, state.backgroundColor);
      state.currentSize = utils.clamp(Math.round(Number(settings.currentSize) || state.currentSize), 1, 96);
      state.currentOpacity = utils.clamp(Math.round(Number(settings.currentOpacity) || state.currentOpacity), 1, 100);
      state.currentFontSize = utils.clamp(Math.round(Number(settings.currentFontSize) || state.currentFontSize), 8, 200);
      if (constants.FONT_FAMILIES.some((font) => font.value === settings.currentFontFamily)) {
        state.currentFontFamily = settings.currentFontFamily;
      }
      state.currentBold = !!settings.currentBold;
      state.currentItalic = !!settings.currentItalic;
      if (constants.GUIDE_LABELS[settings.guideMode]) state.guideMode = settings.guideMode;
      state.pendingObject = null;
      state.selectedObjectId = null;
      state.selection = null;
      this.renderObjects();
      this.drawSelectionOverlay();
    },

    async restoreRasterFromDataUrl(dataUrl) {
      this.fillBackground();
      if (!dataUrl) return;
      await new Promise((resolve, reject) => {
        const image = new Image();
        image.onload = () => {
          this.ctx.drawImage(image, 0, 0);
          resolve();
        };
        image.onerror = reject;
        image.src = dataUrl;
      });
    },

    createPendingShape(x1, y1, x2, y2) {
      const rect = utils.normalizeRect(x1, y1, x2, y2);
      state.pendingObject = {
        id: utils.uid('shape'),
        kind: 'shape',
        shape: state.currentShape,
        x: rect.x,
        y: rect.y,
        w: rect.w,
        h: rect.h,
        flipX: rect.flipX,
        flipY: rect.flipY,
        color: this.activeStrokeColor(),
        strokeColor: this.activeStrokeColor(),
        fillColor: this.activeShapeFillColor(),
        opacity: state.currentOpacity,
        strokeWidth: state.currentSize
      };
      this.renderObjects();
    },

    updatePendingShape(x1, y1, x2, y2) {
      if (!state.pendingObject) return;
      const rect = utils.normalizeRect(x1, y1, x2, y2);
      Object.assign(state.pendingObject, rect, {
        color: this.activeStrokeColor(),
        strokeColor: this.activeStrokeColor(),
        fillColor: this.activeShapeFillColor(),
        opacity: state.currentOpacity,
        strokeWidth: state.currentSize,
        shape: state.currentShape
      });
      this.renderObjects();
    },

    createPendingStamp(x1, y1, x2, y2) {
      const rect = utils.normalizeRect(x1, y1, x2, y2);
      state.pendingObject = {
        id: utils.uid('stamp'),
        kind: 'stamp',
        stamp: state.currentStamp,
        x: rect.x,
        y: rect.y,
        w: rect.w,
        h: rect.h,
        opacity: state.currentOpacity
      };
      this.renderObjects();
    },

    updatePendingStamp(x1, y1, x2, y2) {
      if (!state.pendingObject) return;
      const rect = utils.normalizeRect(x1, y1, x2, y2);
      Object.assign(state.pendingObject, rect, {
        stamp: state.currentStamp,
        opacity: state.currentOpacity
      });
      this.renderObjects();
    },

    commitPendingObject() {
      if (!state.pendingObject) return null;
      const obj = utils.deepClone(state.pendingObject);
      if (obj.kind === 'shape') {
        obj.w = Math.max(12, obj.w);
        obj.h = Math.max(12, obj.h);
      } else {
        obj.w = Math.max(48, obj.w || 0);
        obj.h = Math.max(48, obj.h || 0);
      }
      state.objects.push(obj);
      state.selectedObjectId = obj.id;
      state.pendingObject = null;
      this.renderObjects();
      return obj;
    },

    cancelPendingObject() {
      state.pendingObject = null;
      this.renderObjects();
    },

    getObjectById(id) {
      return state.objects.find((item) => item.id === id) || null;
    },

    updateObject(id, patch) {
      const obj = this.getObjectById(id);
      if (!obj) return null;
      Object.assign(obj, patch);
      this.renderObjects();
      return obj;
    },

    deleteSelectedObject() {
      if (!state.selectedObjectId) return false;
      const before = state.objects.length;
      state.objects = state.objects.filter((item) => item.id !== state.selectedObjectId);
      state.selectedObjectId = null;
      state.pendingObject = null;
      this.renderObjects();
      return state.objects.length !== before;
    },

    deselectObject() {
      state.selectedObjectId = null;
      this.renderObjects();
    },

    renderObjects() {
      if (!this.objectLayer) return;
      const all = [...state.objects];
      if (state.pendingObject) all.push(state.pendingObject);
      this.objectLayer.innerHTML = all.map((obj) => this.objectMarkup(obj)).join('');
    },

    objectMarkup(obj) {
      const isSelected = obj.id === state.selectedObjectId && obj.id !== state.pendingObject?.id;
      // Числові координати приводимо до Number, текст/id — escape: значення можуть прийти з імпортованого проєкту.
      const id = utils.escapeHtml(obj.id);
      const left = Number(obj.x) || 0;
      const top = Number(obj.y) || 0;
      const width = Math.max(1, Number(obj.w) || 1);
      const height = Math.max(1, Number(obj.h) || 1);
      const style = `left:${left}px;top:${top}px;width:${width}px;height:${height}px;opacity:${utils.clamp((Number(obj.opacity) || 100) / 100, 0.05, 1)};`;
      const handles = isSelected
        ? constants.RESIZE_HANDLES.map((handle) => `<button type="button" class="resize-handle ${handle}" data-handle="${handle}" aria-label="Змінити розмір"></button>`).join('')
        : '';

      if (obj.kind === 'stamp') {
        const fontSize = Math.max(26, Math.min(width, height) * 0.82);
        return `
          <div class="art-object art-stamp ${isSelected ? 'selected' : ''}" data-id="${id}" data-kind="stamp" style="${style}">
            <div class="object-body" data-drag-object="${id}">
              <span class="stamp-content" style="font-size:${fontSize}px">${utils.escapeHtml(obj.stamp || constants.DEFAULT_STAMP)}</span>
            </div>
            ${handles}
          </div>`;
      }

      return `
        <div class="art-object art-shape ${isSelected ? 'selected' : ''}" data-id="${id}" data-kind="shape" style="${style}">
          <div class="object-body" data-drag-object="${id}">
            ${this.shapeSvgMarkup(obj)}
          </div>
          ${handles}
        </div>`;
    },

    shapeSvgMarkup(obj) {
      const color = this.shapeStrokeColor(obj);
      const strokeWidth = Math.max(1, Number(obj.strokeWidth) || 2);
      const opacity = utils.clamp((Number(obj.opacity) || 100) / 100, 0.05, 1);
      const common = `stroke="${color}" stroke-width="${strokeWidth}" stroke-linecap="round" stroke-linejoin="round" opacity="${opacity}"`;
      const fillColor = this.shapeFillColor(obj);
      const transparentFill = 'fill="none"';
      const solidFill = `fill="${fillColor}" fill-opacity="${opacity}"`;
      const x1 = obj.flipX ? 100 : 0;
      const y1 = obj.flipY ? 100 : 0;
      const x2 = obj.flipX ? 0 : 100;
      const y2 = obj.flipY ? 0 : 100;
      const arrowPath = this.buildArrowSvgPath(x1, y1, x2, y2);
      const trianglePoints = obj.flipY ? '50,96 6,4 94,4' : '50,4 94,96 6,96';

      let inner = '';
      switch (obj.shape) {
        case 'line':
          inner = `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" ${common} ${transparentFill}></line>`;
          break;
        case 'rect':
          inner = `<rect x="3" y="3" width="94" height="94" rx="2" ${common} ${transparentFill}></rect>`;
          break;
        case 'rect-filled':
          inner = `<rect x="3" y="3" width="94" height="94" rx="2" ${common} ${solidFill}></rect>`;
          break;
        case 'circle':
          inner = `<ellipse cx="50" cy="50" rx="47" ry="47" ${common} ${transparentFill}></ellipse>`;
          break;
        case 'circle-filled':
          inner = `<ellipse cx="50" cy="50" rx="47" ry="47" ${common} ${solidFill}></ellipse>`;
          break;
        case 'triangle':
          inner = `<polygon points="${trianglePoints}" ${common} ${transparentFill}></polygon>`;
          break;
        case 'star':
          inner = `<path d="M50 4 L61 37 L96 37 L68 57 L79 92 L50 71 L21 92 L32 57 L4 37 L39 37 Z" ${common} ${transparentFill}></path>`;
          break;
        case 'heart':
          inner = `<path d="M50 92 C18 70 6 53 6 33 C6 16 20 6 33 6 C42 6 48 12 50 18 C52 12 58 6 67 6 C80 6 94 16 94 33 C94 53 82 70 50 92 Z" ${common} ${transparentFill}></path>`;
          break;
        case 'arrow':
          inner = `<path d="${arrowPath}" ${common} ${transparentFill}></path>`;
          break;
        default:
          inner = `<line x1="0" y1="0" x2="100" y2="100" ${common}></line>`;
          break;
      }

      return `<svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">${inner}</svg>`;
    },

    buildArrowSvgPath(x1, y1, x2, y2) {
      const angle = Math.atan2(y2 - y1, x2 - x1);
      const head = 16;
      const side = Math.PI / 7;
      const hx1 = x2 - head * Math.cos(angle - side);
      const hy1 = y2 - head * Math.sin(angle - side);
      const hx2 = x2 - head * Math.cos(angle + side);
      const hy2 = y2 - head * Math.sin(angle + side);
      return `M ${x1} ${y1} L ${x2} ${y2} M ${x2} ${y2} L ${hx1} ${hy1} M ${x2} ${y2} L ${hx2} ${hy2}`;
    },

    renderObjectsToCanvas(ctx, objects) {
      objects.forEach((obj) => {
        ctx.save();
        ctx.globalAlpha = utils.clamp((obj.opacity || 100) / 100, 0.05, 1);
        if (obj.kind === 'stamp') {
          const fontSize = Math.max(28, Math.min(obj.w, obj.h) * 0.82);
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.font = `${fontSize}px "Segoe UI Emoji", "Apple Color Emoji", "Noto Color Emoji", sans-serif`;
          ctx.fillText(obj.stamp || constants.DEFAULT_STAMP, obj.x + obj.w / 2, obj.y + obj.h / 2);
          ctx.restore();
          return;
        }
        ctx.strokeStyle = this.shapeStrokeColor(obj);
        ctx.fillStyle = this.shapeFillColor(obj);
        ctx.lineWidth = Math.max(1, obj.strokeWidth || 2);
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        this.drawCanvasShape(ctx, obj);
        ctx.restore();
      });
    },

    drawCanvasShape(ctx, obj) {
      const left = obj.x;
      const top = obj.y;
      const right = obj.x + obj.w;
      const bottom = obj.y + obj.h;
      const x1 = obj.flipX ? right : left;
      const y1 = obj.flipY ? bottom : top;
      const x2 = obj.flipX ? left : right;
      const y2 = obj.flipY ? top : bottom;
      const centerX = left + obj.w / 2;
      const centerY = top + obj.h / 2;

      switch (obj.shape) {
        case 'line':
          ctx.beginPath();
          ctx.moveTo(x1, y1);
          ctx.lineTo(x2, y2);
          ctx.stroke();
          break;
        case 'rect':
          ctx.strokeRect(left, top, obj.w, obj.h);
          break;
        case 'rect-filled':
          ctx.fillRect(left, top, obj.w, obj.h);
          ctx.strokeRect(left, top, obj.w, obj.h);
          break;
        case 'circle':
        case 'circle-filled': {
          ctx.beginPath();
          ctx.ellipse(centerX, centerY, obj.w / 2, obj.h / 2, 0, 0, Math.PI * 2);
          if (obj.shape === 'circle-filled') ctx.fill();
          ctx.stroke();
          break;
        }
        case 'triangle':
          ctx.beginPath();
          if (obj.flipY) {
            ctx.moveTo(centerX, bottom);
            ctx.lineTo(left, top);
            ctx.lineTo(right, top);
          } else {
            ctx.moveTo(centerX, top);
            ctx.lineTo(right, bottom);
            ctx.lineTo(left, bottom);
          }
          ctx.closePath();
          ctx.stroke();
          break;
        case 'star':
          this.drawStar(ctx, centerX, centerY, obj.w / 2, obj.h / 2);
          break;
        case 'heart':
          this.drawHeart(ctx, left, top, obj.w, obj.h);
          break;
        case 'arrow':
          this.drawArrow(ctx, x1, y1, x2, y2, Math.max(12, (obj.strokeWidth || 2) * 3));
          break;
        default:
          break;
      }
    },

    drawStar(ctx, cx, cy, rx, ry) {
      const spikes = 5;
      const outer = Math.min(rx, ry);
      const inner = outer * 0.5;
      let angle = -Math.PI / 2;
      const step = Math.PI / spikes;
      ctx.beginPath();
      for (let i = 0; i < spikes * 2; i += 1) {
        const radius = i % 2 === 0 ? outer : inner;
        const px = cx + radius * Math.cos(angle);
        const py = cy + radius * Math.sin(angle);
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
        angle += step;
      }
      ctx.closePath();
      ctx.stroke();
    },

    drawHeart(ctx, left, top, width, height) {
      const centerX = left + width / 2;
      const bottom = top + height;
      const topHeight = height * 0.3;
      ctx.beginPath();
      ctx.moveTo(centerX, bottom);
      ctx.bezierCurveTo(centerX - width / 2, bottom - topHeight, left, top + topHeight * 1.5, centerX, top + topHeight);
      ctx.bezierCurveTo(left + width, top + topHeight * 1.5, centerX + width / 2, bottom - topHeight, centerX, bottom);
      ctx.closePath();
      ctx.stroke();
    },

    drawArrow(ctx, x1, y1, x2, y2, head) {
      const angle = Math.atan2(y2 - y1, x2 - x1);
      const side = Math.PI / 7;
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.lineTo(x2 - head * Math.cos(angle - side), y2 - head * Math.sin(angle - side));
      ctx.moveTo(x2, y2);
      ctx.lineTo(x2 - head * Math.cos(angle + side), y2 - head * Math.sin(angle + side));
      ctx.stroke();
    },

    drawGuides() {
      const ctx = this.guideCtx;
      if (!ctx) return;
      ctx.clearRect(0, 0, this.guideCanvas.width, this.guideCanvas.height);
      if (state.guideMode === 'none') return;
      ctx.save();
      ctx.strokeStyle = state.guideMode === 'grid' ? 'rgba(59,130,246,.18)' : 'rgba(217,119,6,.18)';
      ctx.lineWidth = 1;
      if (state.guideMode === 'grid') {
        const step = 24;
        for (let x = step; x < this.guideCanvas.width; x += step) {
          ctx.beginPath();
          ctx.moveTo(x + 0.5, 0);
          ctx.lineTo(x + 0.5, this.guideCanvas.height);
          ctx.stroke();
        }
        for (let y = step; y < this.guideCanvas.height; y += step) {
          ctx.beginPath();
          ctx.moveTo(0, y + 0.5);
          ctx.lineTo(this.guideCanvas.width, y + 0.5);
          ctx.stroke();
        }
      } else {
        const step = 32;
        for (let y = step; y < this.guideCanvas.height; y += step) {
          ctx.beginPath();
          ctx.moveTo(0, y + 0.5);
          ctx.lineTo(this.guideCanvas.width, y + 0.5);
          ctx.stroke();
        }
      }
      ctx.restore();
    }
  };

  window.ArtMalyunky.canvasApi = canvasApi;
})();
