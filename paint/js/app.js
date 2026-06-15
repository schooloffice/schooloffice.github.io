'use strict';

window.ArtMalyunky = window.ArtMalyunky || {};
window.PaintApp = window.PaintApp || {};

(() => {
  const { constants, state, utils, canvasApi, ui } = window.ArtMalyunky;
  const paintDocument = window.ArtMalyunky.paintDocument.createPaintDocument({ markDirty, markSaved, pushUndo });
  const objectInteractions = window.ArtMalyunky.objectInteractions.createPaintObjectInteractions({ markDirty, pushUndo });

  function markDirty() {
    state.unsavedChanges = true;
    ui.updateDirtyUI();
    paintDocument.autosaveDraft();
  }

  function markSaved() {
    state.unsavedChanges = false;
    ui.updateDirtyUI();
    ui.flashSavedBadge();
    paintDocument.autosaveDraft();
  }

  function pushUndo() {
    state.undoStack.push(canvasApi.snapshot());
    state.redoStack.length = 0;
    enforceHistoryBudget();
  }

  // Обмежуємо історію і за кількістю, і за пам'яттю (canvas-снапшоти важать width*height*4).
  function enforceHistoryBudget() {
    let total = state.undoStack.reduce((sum, snap) => sum + (snap.bytes || 0), 0);
    while (state.undoStack.length > 1
      && (state.undoStack.length > constants.MAX_UNDO || total > constants.HISTORY_MAX_BYTES)) {
      const removed = state.undoStack.shift();
      total -= (removed.bytes || 0);
    }
  }

  // Відновлення синхронне: растр зберігається як offscreen-canvas, без async Image-декоду.
  function applyHistorySnapshot(snapshot) {
    state.suppressAutosave = true;
    canvasApi.restoreSnapshot(snapshot);
    state.suppressAutosave = false;
    ui.updateCanvasInfo(state.canvasWidth, state.canvasHeight);
    ui.updateZoomUI();
    ui.updateDetailStatus();
    paintDocument.autosaveDraft();
  }

  function undo() {
    if (!state.undoStack.length) return;
    state.redoStack.push(canvasApi.snapshot());
    applyHistorySnapshot(state.undoStack.pop());
    markDirty();
  }

  function redo() {
    if (!state.redoStack.length) return;
    state.undoStack.push(canvasApi.snapshot());
    applyHistorySnapshot(state.redoStack.pop());
    markDirty();
  }

  function setTool(toolName) {
    state.currentTool = toolName;
    ui.updateToolUI();
    paintDocument.autosaveDraft();
  }

  function setBrush(brushName) {
    state.currentBrush = brushName;
    state.currentTool = 'brush';
    ui.renderBrushes();
    ui.updateToolUI();
    paintDocument.autosaveDraft();
  }

  function setShape(shapeName) {
    state.currentShape = shapeName;
    state.currentTool = 'shapes';
    ui.updateShapeUI();
    ui.updateToolUI();
    paintDocument.autosaveDraft();
  }

  function setStamp(stamp) {
    state.currentStamp = stamp;
    state.currentTool = 'stamps';
    ui.updateStampUI();
    ui.updateToolUI();
    paintDocument.autosaveDraft();
  }

  function setGuide(mode) {
    state.guideMode = mode;
    ui.updateGuideUI();
    canvasApi.drawGuides();
    paintDocument.autosaveDraft();
  }

  function setColor(hex) {
    state.currentColor = hex;
    ui.updateColorUI();
    paintDocument.autosaveDraft();
  }

  function setSize(value) {
    state.currentSize = utils.clamp(Number(value), 1, 48);
    ui.updateSizeUI();
    paintDocument.autosaveDraft();
  }

  function setOpacity(value) {
    state.currentOpacity = utils.clamp(Number(value), 1, 100);
    ui.updateOpacityUI();
    paintDocument.autosaveDraft();
  }

  async function clearCanvasWithConfirm() {
    const okay = await ui.showConfirmModal('Очистити полотно?', 'Усі мазки, фігури та штампи буде видалено.', '🧹', 'Очистити');
    if (!okay) return;
    pushUndo();
    canvasApi.clearAll();
    ui.updateDetailStatus();
    markDirty();
  }

  async function newDrawing() {
    if (state.unsavedChanges) {
      const proceed = await ui.showConfirmModal('Створити новий малюнок?', 'Незбережені зміни буде втрачено.', '🖼️', 'Створити');
      if (!proceed) return;
    }
    const choice = await ui.showDocumentDialog({
      title: 'Новий малюнок',
      confirmText: 'Створити',
      width: constants.DEFAULT_DOC_WIDTH,
      height: constants.DEFAULT_DOC_HEIGHT
    });
    if (!choice) return;
    state.undoStack.length = 0;
    state.redoStack.length = 0;
    canvasApi.setDocumentSize(choice.width, choice.height, {
      clear: true,
      background: choice.background,
      transparent: choice.transparent
    });
    canvasApi.clearAll();
    canvasApi.fitDocumentToViewport();
    state.fileName = constants.DEFAULT_FILE_NAME;
    ui.updateFileNameUI();
    ui.updateCanvasInfo(state.canvasWidth, state.canvasHeight);
    ui.updateZoomUI();
    state.unsavedChanges = false;
    ui.updateDirtyUI();
    ui.updateDetailStatus();
    paintDocument.autosaveDraft();
  }

  function applyZoomChange() {
    ui.updateZoomUI();
    paintDocument.autosaveDraft();
  }

  function zoomIn() {
    canvasApi.zoomIn();
    applyZoomChange();
  }

  function zoomOut() {
    canvasApi.zoomOut();
    applyZoomChange();
  }

  function zoomTo100() {
    canvasApi.zoomTo100();
    applyZoomChange();
  }

  function fitToWindow() {
    canvasApi.fitDocumentToViewport();
    ui.updateCanvasInfo(state.canvasWidth, state.canvasHeight);
    applyZoomChange();
  }

  async function resizeCanvasDialog() {
    const choice = await ui.showDocumentDialog({
      title: 'Розмір полотна',
      confirmText: 'Застосувати',
      width: state.document.width,
      height: state.document.height,
      transparent: state.document.transparent
    });
    if (!choice) return;
    pushUndo();
    state.document.transparent = choice.transparent;
    state.document.background = choice.background;
    canvasApi.resizeDocument(choice.width, choice.height, { scale: false });
    canvasApi.fitDocumentToViewport();
    ui.updateCanvasInfo(state.canvasWidth, state.canvasHeight);
    ui.updateZoomUI();
    markDirty();
  }

  function runOfficeCommand(command) {
    return window.OfficeShell?.runCommand?.(command) || false;
  }

  function createShellCommands() {
    return {
      new: newDrawing,
      open: paintDocument.importImage,
      save: () => paintDocument.saveImage('png'),
      undo: undo,
      redo: redo
    };
  }

  function handleMenuAction(action) {
    switch (action) {
      case 'new-drawing':
        runOfficeCommand('new') || newDrawing();
        break;
      case 'import-image':
        runOfficeCommand('open') || paintDocument.importImage();
        break;
      case 'save-png':
        runOfficeCommand('save') || paintDocument.saveImage('png');
        break;
      case 'save-jpg':
        paintDocument.saveImage('jpg');
        break;
      case 'print':
        paintDocument.printImage();
        break;
      case 'undo':
        runOfficeCommand('undo') || undo();
        break;
      case 'redo':
        runOfficeCommand('redo') || redo();
        break;
      case 'delete-selected':
        objectInteractions.deleteSelectedObject();
        break;
      case 'clear-canvas':
        clearCanvasWithConfirm();
        break;
      case 'guide-none':
        setGuide('none');
        break;
      case 'guide-grid':
        setGuide('grid');
        break;
      case 'guide-lines':
        setGuide('lines');
        break;
      case 'fit-canvas':
        fitToWindow();
        break;
      case 'zoom-in':
        zoomIn();
        break;
      case 'zoom-out':
        zoomOut();
        break;
      case 'zoom-100':
        zoomTo100();
        break;
      case 'resize-canvas':
        resizeCanvasDialog();
        break;
      case 'show-shortcuts':
        ui.showInfoModal('Клавіатурні скорочення', 'B — пензлик\nE — гумка\nF — заливка\nG — фігури\nT — штампи\nDelete / Backspace — видалити вибраний об\'єкт\n[ / ] — менша або більша товщина\nCtrl+Z — скасувати\nCtrl+Y — повернути\nCtrl+S — зберегти PNG\nCtrl+N — новий малюнок\nEsc — закрити меню або зняти виділення', '⌨️');
        break;
      case 'show-about':
        ui.showInfoModal('Про ПЛЮС Малюнки', 'ПЛЮС Малюнки — графічний редактор у стилі вашого офісного набору. Основна палітра завжди видима, пензлик має кілька режимів, а фігури й штампи можна пересувати та змінювати за розміром.', '🎨');
        break;
      default:
        break;
    }
    ui.closeMenus();
  }

  function beginRasterStroke(point, event) {
    state.isDrawing = true;
    state.pointerId = event.pointerId ?? null;
    state.startX = point.x;
    state.startY = point.y;
    state.lastX = point.x;
    state.lastY = point.y;

    if (state.currentTool === 'fill') {
      pushUndo();
      canvasApi.floodFill(Math.floor(point.x), Math.floor(point.y));
      state.isDrawing = false;
      markDirty();
      return;
    }

    if (state.currentTool === 'brush' || state.currentTool === 'eraser') {
      pushUndo();
      if (state.currentTool === 'brush') canvasApi.drawFreehand(point.x, point.y);
      else canvasApi.erase(point.x, point.y);
    }
  }

  function beginObjectCreation(point, event) {
    state.isDrawing = true;
    state.pointerId = event.pointerId ?? null;
    state.startX = point.x;
    state.startY = point.y;
    pushUndo();
    if (state.currentTool === 'shapes') canvasApi.createPendingShape(point.x, point.y, point.x, point.y);
    if (state.currentTool === 'stamps') canvasApi.createPendingStamp(point.x, point.y, point.x, point.y);
  }

  function moveCanvasInteraction(point) {
    if (!state.isDrawing) return;

    if (state.currentTool === 'brush') {
      canvasApi.drawFreehand(point.x, point.y);
      state.lastX = point.x;
      state.lastY = point.y;
      return;
    }

    if (state.currentTool === 'eraser') {
      canvasApi.erase(point.x, point.y);
      state.lastX = point.x;
      state.lastY = point.y;
      return;
    }

    if (state.currentTool === 'shapes') {
      canvasApi.updatePendingShape(state.startX, state.startY, point.x, point.y);
      return;
    }

    if (state.currentTool === 'stamps') {
      canvasApi.updatePendingStamp(state.startX, state.startY, point.x, point.y);
    }
  }

  function finishCanvasInteraction(point) {
    if (!state.isDrawing) return;

    if (state.currentTool === 'brush' || state.currentTool === 'eraser') {
      state.isDrawing = false;
      markDirty();
      return;
    }

    if (state.currentTool === 'shapes') {
      const obj = canvasApi.commitPendingObject();
      state.isDrawing = false;
      if (obj) {
        objectInteractions.selectObject(obj.id);
        markDirty();
      }
      return;
    }

    if (state.currentTool === 'stamps') {
      const pending = state.pendingObject;
      if (pending && pending.w < 8 && pending.h < 8) {
        Object.assign(pending, {
          x: utils.clamp(point.x - 36, 0, state.canvasWidth - 72),
          y: utils.clamp(point.y - 36, 0, state.canvasHeight - 72),
          w: 72,
          h: 72
        });
      }
      const obj = canvasApi.commitPendingObject();
      state.isDrawing = false;
      if (obj) {
        objectInteractions.selectObject(obj.id);
        markDirty();
      }
    }
  }

  function bindCanvas() {
    const canvas = ui.elements.drawingCanvas;
    const objectLayer = ui.elements.objectLayer;
    const stageWrap = ui.elements.canvasStageWrap;
    let spacePanning = false;
    let panOrigin = null;

    canvas.addEventListener('pointerdown', (event) => {
      if (event.button !== undefined && event.button !== 0) return;
      if (spacePanning) return;
      const point = canvasApi.getPointerPosition(event);
      state.lastPointer = point;
      ui.updateCoords(point.x, point.y);
      objectInteractions.deselectObject();
      if (state.currentTool === 'shapes' || state.currentTool === 'stamps') beginObjectCreation(point, event);
      else beginRasterStroke(point, event);
    });

    canvas.addEventListener('pointermove', (event) => {
      const point = canvasApi.getPointerPosition(event);
      state.lastPointer = point;
      ui.updateCoords(point.x, point.y);
      moveCanvasInteraction(point);
    });

    document.addEventListener('pointermove', (event) => {
      if (state.objectInteraction) {
        const point = canvasApi.getPointerPosition(event);
        state.lastPointer = point;
        ui.updateCoords(point.x, point.y);
        objectInteractions.updateObjectInteraction(point);
      }
    });

    document.addEventListener('pointerup', (event) => {
      const point = canvasApi.getPointerPosition(event);
      state.lastPointer = point;
      ui.updateCoords(point.x, point.y);
      finishCanvasInteraction(point);
      objectInteractions.finishObjectInteraction();
    });

    document.addEventListener('pointercancel', () => {
      state.isDrawing = false;
      canvasApi.cancelPendingObject();
      objectInteractions.finishObjectInteraction();
    });

    objectLayer.addEventListener('pointerdown', (event) => {
      const handle = event.target.closest('.resize-handle');
      const objectNode = event.target.closest('.art-object');
      if (!objectNode) return;
      event.preventDefault();
      event.stopPropagation();
      const point = canvasApi.getPointerPosition(event);
      if (handle) {
        objectInteractions.startObjectResize(objectNode.dataset.id, handle.dataset.handle, point);
      } else {
        objectInteractions.startObjectMove(objectNode.dataset.id, point);
      }
    });

    objectLayer.addEventListener('click', (event) => {
      const objectNode = event.target.closest('.art-object');
      if (!objectNode) return;
      event.stopPropagation();
      objectInteractions.selectObject(objectNode.dataset.id);
    });

    // Ctrl + колесо → зум із прив'язкою до курсора; просто колесо → нативний скрол (pan).
    stageWrap.addEventListener('wheel', (event) => {
      if (!(event.ctrlKey || event.metaKey)) return;
      event.preventDefault();
      const factor = event.deltaY < 0 ? 1.1 : 1 / 1.1;
      canvasApi.zoomAtPoint(factor, event.clientX, event.clientY);
      applyZoomChange();
    }, { passive: false });

    // Тимчасовий pan: утримання Space або середня кнопка миші.
    const isTextField = (target) => !!target && target.matches?.('input, textarea, [contenteditable="true"]');
    document.addEventListener('keydown', (event) => {
      if (event.code === 'Space' && !event.repeat && !isTextField(event.target)) {
        spacePanning = true;
        stageWrap.classList.add('panning');
      }
    });
    document.addEventListener('keyup', (event) => {
      if (event.code === 'Space') {
        spacePanning = false;
        panOrigin = null;
        stageWrap.classList.remove('panning');
      }
    });
    stageWrap.addEventListener('pointerdown', (event) => {
      if (!spacePanning && event.button !== 1) return;
      event.preventDefault();
      panOrigin = { x: event.clientX, y: event.clientY, left: stageWrap.scrollLeft, top: stageWrap.scrollTop };
      stageWrap.setPointerCapture?.(event.pointerId);
    });
    stageWrap.addEventListener('pointermove', (event) => {
      if (!panOrigin) return;
      stageWrap.scrollLeft = panOrigin.left - (event.clientX - panOrigin.x);
      stageWrap.scrollTop = panOrigin.top - (event.clientY - panOrigin.y);
    });
    const endPan = (event) => {
      if (!panOrigin) return;
      panOrigin = null;
      stageWrap.releasePointerCapture?.(event.pointerId);
    };
    stageWrap.addEventListener('pointerup', endPan);
    stageWrap.addEventListener('pointercancel', endPan);
  }

  function bindUi() {
    ui.elements.toolSwitches.forEach((button) => {
      button.addEventListener('click', () => {
        setTool(button.dataset.tool);
      });
    });

    ui.elements.brushGrid.addEventListener('pointerdown', (event) => {
      const option = event.target.closest('.brush-option[data-brush]');
      if (!option) return;
      event.preventDefault();
      event.stopPropagation();
      setBrush(option.dataset.brush);
      ui.closePickers();
    });

    ui.elements.shapeGrid.addEventListener('pointerdown', (event) => {
      const option = event.target.closest('.shape-option[data-shape]');
      if (!option) return;
      event.preventDefault();
      event.stopPropagation();
      setShape(option.dataset.shape);
      ui.closePickers();
    });

    ui.elements.stampGrid.addEventListener('pointerdown', (event) => {
      const option = event.target.closest('.stamp-option[data-stamp]');
      if (!option) return;
      event.preventDefault();
      event.stopPropagation();
      setStamp(option.dataset.stamp);
      ui.closePickers();
    });

    ui.elements.colorPalette.addEventListener('pointerdown', (event) => {
      const swatch = event.target.closest('.color-swatch[data-hex]');
      if (!swatch) return;
      event.preventDefault();
      setColor(swatch.dataset.hex);
    });

    document.addEventListener('click', (event) => {
      const menuItem = event.target.closest('.menu-item[data-action]');
      if (menuItem) {
        handleMenuAction(menuItem.dataset.action);
        return;
      }

      const toolbarAction = event.target.closest('.rail-btn[data-action], .zoom-btn[data-action]');
      if (toolbarAction) {
        handleMenuAction(toolbarAction.dataset.action);
        return;
      }

      const guideBtn = event.target.closest('.segmented-btn[data-guide]');
      if (guideBtn) {
        setGuide(guideBtn.dataset.guide);
      }
    });

    ui.elements.shuffleStampsBtn.addEventListener('click', () => {
      ui.renderStamps();
      ui.updateStampUI();
      paintDocument.autosaveDraft();
    });

    ui.elements.nativeColorPicker.addEventListener('input', (event) => {
      setColor(event.target.value);
    });

    ['redSlider', 'greenSlider', 'blueSlider'].forEach((key) => {
      ui.elements[key].addEventListener('input', () => ui.previewMixerColor());
    });

    ui.elements.applyMixerBtn.addEventListener('click', () => {
      setColor(ui.elements.hexValue.textContent);
    });

    ui.elements.sizeSlider.addEventListener('input', (event) => setSize(event.target.value));
    ui.elements.opacitySlider.addEventListener('input', (event) => setOpacity(event.target.value));

    ui.elements.importFileInput.addEventListener('change', (event) => {
      paintDocument.handleImportedFile(event.target.files[0]);
      event.target.value = '';
    });

    document.addEventListener('click', (event) => {
      if (event.target.id === 'fileName') {
        ui.beginRename(() => {
          ui.updateFileNameUI();
          paintDocument.autosaveDraft();
        });
      }
    });

    document.addEventListener('keydown', (event) => {
      if (!ui.elements.modalOverlay.classList.contains('hidden')) return;
      if (event.target.matches('input[type="text"], input[type="range"], input[type="color"]')) return;

      if (event.ctrlKey || event.metaKey) {
        switch (event.key.toLowerCase()) {
          case 'z':
            event.preventDefault();
            runOfficeCommand('undo') || undo();
            return;
          case 'y':
            event.preventDefault();
            runOfficeCommand('redo') || redo();
            return;
          case 's':
            event.preventDefault();
            runOfficeCommand('save') || paintDocument.saveImage('png');
            return;
          case 'n':
            event.preventDefault();
            runOfficeCommand('new') || newDrawing();
            return;
          case 'p':
            event.preventDefault();
            paintDocument.printImage();
            return;
          case '0':
            event.preventDefault();
            zoomTo100();
            return;
          case '=':
          case '+':
            event.preventDefault();
            zoomIn();
            return;
          case '-':
          case '_':
            event.preventDefault();
            zoomOut();
            return;
          default:
            break;
        }
      }

      switch (event.key.toLowerCase()) {
        case 'b':
          setTool('brush');
          break;
        case 'e':
          setTool('eraser');
          break;
        case 'f':
          setTool('fill');
          break;
        case 'g':
          setTool('shapes');
          break;
        case 't':
          setTool('stamps');
          break;
        case '[':
          setSize(state.currentSize - 1);
          break;
        case ']':
          setSize(state.currentSize + 1);
          break;
        case 'escape':
          ui.closeMenus();
          ui.closePickers();
          ui.elements.advancedColorPanel?.classList.add('hidden');
          ui.elements.advancedColorBtn?.classList.remove('active');
          objectInteractions.deselectObject();
          canvasApi.cancelPendingObject();
          state.isDrawing = false;
          break;
        case 'backspace':
        case 'delete':
          if (state.selectedObjectId) {
            event.preventDefault();
            objectInteractions.deleteSelectedObject();
          }
          break;
        default:
          break;
      }
    });

    window.addEventListener('resize', utils.debounce(() => {
      // Resize вікна НЕ змінює пікселі документа — лише перераховує fit-zoom.
      canvasApi.refit();
      ui.updateCanvasInfo(state.canvasWidth, state.canvasHeight);
      ui.updateZoomUI();
    }, 120));

    window.addEventListener('beforeunload', (event) => {
      paintDocument.autosaveDraft();
      if (state.unsavedChanges) {
        event.preventDefault();
        event.returnValue = '';
      }
    });
  }

  async function initPaintEditor() {
    ui.init();
    canvasApi.init({
      canvas: ui.elements.drawingCanvas,
      guideCanvas: ui.elements.guideCanvas,
      objectLayer: ui.elements.objectLayer,
      stage: ui.elements.canvasStage,
      stageWrap: ui.elements.canvasStageWrap
    });
    ui.updateCanvasInfo(state.canvasWidth, state.canvasHeight);
    ui.updateZoomUI();
    bindCanvas();
    bindUi();
    await paintDocument.restoreDraftIfAny();
    canvasApi.fitDocumentToViewport();
    ui.updateZoomUI();
    ui.updateCanvasInfo(state.canvasWidth, state.canvasHeight);
    canvasApi.drawGuides();
  }

  window.PaintApp.boot = () =>
    window.OfficeShell?.bootEditor?.({
      source: 'paint',
      commands: createShellCommands,
      boot: initPaintEditor
    }) ?? (window.OfficeUI?.registerCommands?.(createShellCommands(), { source: 'paint' }), initPaintEditor());
})();
