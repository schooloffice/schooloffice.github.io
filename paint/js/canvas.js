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

    init({ canvas, guideCanvas, objectLayer }) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d', { willReadFrequently: true });
      this.guideCanvas = guideCanvas;
      this.guideCtx = guideCanvas.getContext('2d');
      this.objectLayer = objectLayer;
      this.resizeToContainer(true);
      this.clearToWhite();
      this.renderObjects();
      this.drawGuides();
    },

    resizeToContainer(initial = false) {
      if (!this.canvas) return;
      const stage = this.canvas.parentElement;
      const rect = stage.getBoundingClientRect();
      const width = Math.max(constants.DEFAULT_CANVAS_MIN_WIDTH, Math.floor(rect.width));
      const height = Math.max(constants.DEFAULT_CANVAS_MIN_HEIGHT, Math.floor(rect.height));

      const existingRaster = (!initial && this.canvas.width && this.canvas.height) ? (() => {
        const snapshot = utils.createCanvas(this.canvas.width, this.canvas.height);
        snapshot.getContext('2d').drawImage(this.canvas, 0, 0);
        return snapshot;
      })() : null;

      this.canvas.width = width;
      this.canvas.height = height;
      this.guideCanvas.width = width;
      this.guideCanvas.height = height;
      this.objectLayer.style.width = `${width}px`;
      this.objectLayer.style.height = `${height}px`;

      state.canvasWidth = width;
      state.canvasHeight = height;

      if (existingRaster) {
        this.ctx.clearRect(0, 0, width, height);
        this.ctx.fillStyle = '#ffffff';
        this.ctx.fillRect(0, 0, width, height);
        this.ctx.drawImage(existingRaster, 0, 0, width, height);
      } else {
        this.clearToWhite();
      }

      this.renderObjects();
      this.drawGuides();
    },

    clearToWhite() {
      this.ctx.save();
      this.ctx.globalCompositeOperation = 'source-over';
      this.ctx.globalAlpha = 1;
      this.ctx.fillStyle = '#ffffff';
      this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
      this.ctx.restore();
    },

    clearAll() {
      this.clearToWhite();
      state.objects = [];
      state.selectedObjectId = null;
      state.pendingObject = null;
      this.renderObjects();
    },

    getPointerPosition(event) {
      const rect = this.canvas.getBoundingClientRect();
      return {
        x: utils.clamp(Math.round((event.clientX - rect.left) * (this.canvas.width / rect.width)), 0, this.canvas.width),
        y: utils.clamp(Math.round((event.clientY - rect.top) * (this.canvas.height / rect.height)), 0, this.canvas.height)
      };
    },

    setRasterStyle() {
      const brush = constants.BRUSHES[state.currentBrush] || constants.BRUSHES.pencil;
      this.ctx.strokeStyle = state.currentColor;
      this.ctx.fillStyle = state.currentColor;
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
      this.ctx.globalCompositeOperation = 'source-over';
      this.ctx.globalAlpha = 1;
      this.ctx.strokeStyle = '#ffffff';
      this.ctx.lineWidth = Math.max(4, state.currentSize * 1.2);
      this.ctx.lineCap = 'round';
      this.ctx.lineJoin = 'round';
      this.ctx.beginPath();
      this.ctx.moveTo(state.lastX, state.lastY);
      this.ctx.lineTo(x, y);
      this.ctx.stroke();
      this.ctx.restore();
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
      const fill = utils.hexToRgb(state.currentColor);
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

    async loadImageFile(dataUrl) {
      await new Promise((resolve, reject) => {
        const image = new Image();
        image.onload = () => {
          const scale = Math.min(this.canvas.width / image.width, this.canvas.height / image.height, 1);
          const drawWidth = image.width * scale;
          const drawHeight = image.height * scale;
          const drawX = (this.canvas.width - drawWidth) / 2;
          const drawY = (this.canvas.height - drawHeight) / 2;
          this.ctx.drawImage(image, drawX, drawY, drawWidth, drawHeight);
          resolve();
        };
        image.onerror = reject;
        image.src = dataUrl;
      });
    },

    exportMergedCanvas() {
      const composite = utils.createCanvas(this.canvas.width, this.canvas.height);
      const ctx = composite.getContext('2d');
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, composite.width, composite.height);
      ctx.drawImage(this.canvas, 0, 0);
      this.renderObjectsToCanvas(ctx, state.objects);
      return composite;
    },

    exportImage(mime = 'image/png', quality = 0.92) {
      return this.exportMergedCanvas().toDataURL(mime, quality);
    },

    snapshot() {
      return {
        raster: this.canvas.toDataURL('image/png'),
        objects: utils.deepClone(state.objects)
      };
    },

    async restoreSnapshot(snapshot) {
      if (!snapshot) return;
      await this.restoreRasterFromDataUrl(snapshot.raster || null);
      state.objects = utils.deepClone(snapshot.objects || []);
      state.pendingObject = null;
      state.selectedObjectId = null;
      this.renderObjects();
    },

    async restoreRasterFromDataUrl(dataUrl) {
      this.clearToWhite();
      if (!dataUrl) return;
      await new Promise((resolve, reject) => {
        const image = new Image();
        image.onload = () => {
          this.ctx.drawImage(image, 0, 0, this.canvas.width, this.canvas.height);
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
        color: state.currentColor,
        opacity: state.currentOpacity,
        strokeWidth: state.currentSize
      };
      this.renderObjects();
    },

    updatePendingShape(x1, y1, x2, y2) {
      if (!state.pendingObject) return;
      const rect = utils.normalizeRect(x1, y1, x2, y2);
      Object.assign(state.pendingObject, rect, {
        color: state.currentColor,
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
      const style = `left:${obj.x}px;top:${obj.y}px;width:${Math.max(1, obj.w)}px;height:${Math.max(1, obj.h)}px;opacity:${utils.clamp((obj.opacity || 100) / 100, 0.05, 1)};`;
      const handles = isSelected
        ? constants.RESIZE_HANDLES.map((handle) => `<button type="button" class="resize-handle ${handle}" data-handle="${handle}" aria-label="Змінити розмір"></button>`).join('')
        : '';

      if (obj.kind === 'stamp') {
        const fontSize = Math.max(26, Math.min(obj.w, obj.h) * 0.82);
        return `
          <div class="art-object art-stamp ${isSelected ? 'selected' : ''}" data-id="${obj.id}" data-kind="stamp" style="${style}">
            <div class="object-body" data-drag-object="${obj.id}">
              <span class="stamp-content" style="font-size:${fontSize}px">${obj.stamp || constants.DEFAULT_STAMP}</span>
            </div>
            ${handles}
          </div>`;
      }

      return `
        <div class="art-object art-shape ${isSelected ? 'selected' : ''}" data-id="${obj.id}" data-kind="shape" style="${style}">
          <div class="object-body" data-drag-object="${obj.id}">
            ${this.shapeSvgMarkup(obj)}
          </div>
          ${handles}
        </div>`;
    },

    shapeSvgMarkup(obj) {
      const color = obj.color || constants.DEFAULT_COLOR;
      const strokeWidth = Math.max(1, obj.strokeWidth || 2);
      const opacity = utils.clamp((obj.opacity || 100) / 100, 0.05, 1);
      const common = `stroke="${color}" stroke-width="${strokeWidth}" stroke-linecap="round" stroke-linejoin="round" opacity="${opacity}"`;
      const fillColor = color;
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
        ctx.strokeStyle = obj.color || constants.DEFAULT_COLOR;
        ctx.fillStyle = obj.color || constants.DEFAULT_COLOR;
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
