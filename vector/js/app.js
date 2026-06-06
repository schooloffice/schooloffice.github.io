'use strict';

window.ArtVector = window.ArtVector || {};
window.VectorApp = window.VectorApp || {};

(() => {
  const { constants, state, utils, editor, ui } = window.ArtVector;

  const autosaveDraft = debounce(() => {
    if (state.suppressAutosave) return;
    try {
      localStorage.setItem(constants.STORAGE_KEY, JSON.stringify(editor.buildProjectPayload()));
    } catch (error) {
      console.warn('Не вдалося зберегти чернетку.', error);
    }
  }, 220);

  function debounce(fn, delay = 180) {
    let timeoutId = null;
    return (...args) => {
      clearTimeout(timeoutId);
      timeoutId = window.setTimeout(() => fn(...args), delay);
    };
  }

  function markDirty() {
    state.unsavedChanges = true;
    ui.updateDirtyUI();
    autosaveDraft();
  }

  function markSaved() {
    state.unsavedChanges = false;
    ui.updateDirtyUI();
    ui.flashSavedBadge();
    autosaveDraft();
  }

  function pushUndo() {
    if (state.undoStack.length >= constants.MAX_UNDO) state.undoStack.shift();
    state.undoStack.push(editor.buildProjectPayload());
    state.redoStack.length = 0;
  }

  function restorePayload(payload) {
    state.suppressAutosave = true;
    editor.restoreProject(payload);
    state.suppressAutosave = false;
    ui.updateAll();
    autosaveDraft();
  }

  function undo() {
    if (!state.undoStack.length) return;
    state.redoStack.push(editor.buildProjectPayload());
    const snapshot = state.undoStack.pop();
    restorePayload(snapshot);
    markDirty();
  }

  function redo() {
    if (!state.redoStack.length) return;
    state.undoStack.push(editor.buildProjectPayload());
    const snapshot = state.redoStack.pop();
    restorePayload(snapshot);
    markDirty();
  }

  function setTool(toolName) {
    state.currentTool = toolName;
    ui.closeToolPickers();
    ui.updateToolUI();
    autosaveDraft();
  }

  function getSelectedObject() {
    if (!state.selectedObjectId) return null;
    return editor.getObjectById(state.selectedObjectId);
  }

  function selectObject(id) {
    state.selectedObjectId = id;
    editor.renderAll();
    ui.updateSelectionStatus(getSelectedObject());
  }

  function clearSelection() {
    state.selectedObjectId = null;
    editor.renderAll();
    ui.updateSelectionStatus(null);
  }

  function applySnap(value) {
    return state.snapToGrid ? utils.snap(value, constants.GRID_SIZE) : value;
  }

  function applySnapPoint(point) {
    return {
      x: applySnap(point.x),
      y: applySnap(point.y)
    };
  }

  function updateColor(hex) {
    if (state.currentColorTarget === 'stroke') {
      state.currentStroke = hex;
    } else {
      state.currentFill = hex;
    }
    applyStyleToSelection();
    ui.updateColorUI();
    editor.renderAll();
    autosaveDraft();
  }

  function setNoFill() {
    state.currentFill = 'none';
    state.currentColorTarget = 'fill';
    const selected = getSelectedObject();
    if (selected && canHaveFill(selected.type)) {
      pushUndo();
      selected.fill = 'none';
      editor.renderAll();
      markDirty();
    }
    ui.updateColorUI();
  }

  function canHaveFill(type) {
    return constants.RECT_LIKE_TYPES.includes(type) || type === 'text';
  }

  function applyStyleToSelection() {
    const selected = getSelectedObject();
    if (!selected) return;
    let changed = false;
    if (state.currentColorTarget === 'stroke' && selected.type !== 'text' && selected.stroke !== state.currentStroke) {
      pushUndo();
      selected.stroke = state.currentStroke;
      changed = true;
    }
    if (state.currentColorTarget === 'fill' && canHaveFill(selected.type) && selected.fill !== state.currentFill) {
      if (!changed) pushUndo();
      selected.fill = state.currentFill;
      changed = true;
    }
    if (selected.type === 'text' && state.currentColorTarget === 'stroke' && selected.stroke !== state.currentStroke) {
      if (!changed) pushUndo();
      selected.stroke = state.currentStroke;
      changed = true;
    }
    if (changed) {
      editor.renderAll();
      markDirty();
    }
  }

  function updateStrokeWidth(value) {
    state.currentStrokeWidth = utils.clamp(Number(value), 1, 18);
    const selected = getSelectedObject();
    if (selected && selected.type !== 'text') {
      pushUndo();
      selected.strokeWidth = state.currentStrokeWidth;
      editor.renderAll();
      markDirty();
    }
    ui.updateStrokeWidthUI();
    autosaveDraft();
  }

  function updateOpacity(value) {
    state.currentOpacity = utils.clamp(Number(value), 10, 100);
    const selected = getSelectedObject();
    if (selected) {
      pushUndo();
      selected.opacity = state.currentOpacity;
      editor.renderAll();
      markDirty();
    }
    ui.updateOpacityUI();
    autosaveDraft();
  }

  function updateFontSize(value) {
    state.currentFontSize = utils.clamp(Number(value), 12, 96);
    const selected = getSelectedObject();
    if (selected && selected.type === 'text') {
      pushUndo();
      selected.fontSize = state.currentFontSize;
      editor.renderAll();
      markDirty();
    }
    ui.updateFontSizeUI();
    autosaveDraft();
  }

  function setGuide(mode) {
    state.guideMode = mode;
    editor.renderAll();
    ui.updateGuideUI();
    autosaveDraft();
  }

  function toggleSnap() {
    state.snapToGrid = !state.snapToGrid;
    ui.updateSnapUI();
    autosaveDraft();
  }

  function setZoom(value) {
    state.zoom = utils.clamp(value, 0.5, 2);
    ui.updateZoomUI();
    ui.updateCanvasInfo();
  }

  function zoomIn() {
    const index = constants.ZOOM_STEPS.findIndex((step) => step >= state.zoom);
    const next = constants.ZOOM_STEPS[Math.min(constants.ZOOM_STEPS.length - 1, index + 1)] || 2;
    setZoom(next);
  }

  function zoomOut() {
    let index = constants.ZOOM_STEPS.findIndex((step) => step >= state.zoom);
    if (index === -1) index = constants.ZOOM_STEPS.length - 1;
    const next = constants.ZOOM_STEPS[Math.max(0, index - 1)] || 0.5;
    setZoom(next);
  }

  function zoomReset() {
    setZoom(1);
  }

  async function newProject() {
    if (state.unsavedChanges) {
      const okay = await ui.showConfirmModal('Створити новий проєкт?', 'Незбережені зміни буде втрачено.', '🆕', 'Створити');
      if (!okay) return;
    }
    state.fileName = constants.DEFAULT_FILE_NAME;
    state.objects = [];
    state.selectedObjectId = null;
    state.draftObject = null;
    state.undoStack.length = 0;
    state.redoStack.length = 0;
    state.currentTool = 'select';
    editor.resizeArtboard(state.canvasWidth, state.canvasHeight);
    editor.renderAll();
    state.unsavedChanges = false;
    ui.updateAll();
    autosaveDraft();
  }

  function saveProject() {
    const payload = JSON.stringify(editor.buildProjectPayload(), null, 2);
    utils.downloadText(payload, `${state.fileName || constants.DEFAULT_FILE_NAME}.json`);
    markSaved();
  }

  function openProject() {
    window.OfficeShell?.openFilePicker?.(ui.elements.projectFileInput) || ui.elements.projectFileInput.click();
  }

  async function handleProjectFile(file) {
    if (!file) return;
    try {
      const text = await utils.fileToText(file);
      const payload = JSON.parse(text);
      restorePayload(payload);
      state.undoStack.length = 0;
      state.redoStack.length = 0;
      state.unsavedChanges = false;
      ui.updateAll();
      markSaved();
    } catch (error) {
      console.error(error);
      ui.showInfoModal('Помилка відкриття', 'Не вдалося прочитати файл проєкту. Перевірте, чи це коректний JSON-файл редактора.', '⚠️');
    }
  }

  function exportSvg() {
    const markup = editor.exportSvgMarkup();
    utils.downloadText(markup, `${state.fileName || constants.DEFAULT_FILE_NAME}.svg`, 'image/svg+xml;charset=utf-8');
    markSaved();
  }

  async function exportPng() {
    try {
      const blob = await editor.exportPngBlob();
      if (!blob) throw new Error('PNG blob is empty');
      utils.downloadBlob(blob, `${state.fileName || constants.DEFAULT_FILE_NAME}.png`);
      markSaved();
    } catch (error) {
      console.error(error);
      ui.showInfoModal('Помилка експорту', 'Не вдалося сформувати PNG. Спробуйте ще раз.', '⚠️');
    }
  }

  async function printProject() {
    try {
      const blob = await editor.exportPngBlob();
      const url = URL.createObjectURL(blob);
      const printWindow = window.open('', '_blank', 'width=1000,height=800');
      if (!printWindow) throw new Error('Print window blocked');
      const doc = printWindow.document;
      const title = state.fileName || constants.DEFAULT_FILE_NAME;
      doc.open();
      doc.write('<!DOCTYPE html><html lang="uk"><head><meta charset="UTF-8"></head><body></body></html>');
      doc.close();
      doc.title = title;

      const style = doc.createElement('style');
      style.textContent = 'body{margin:0;padding:24px;display:grid;place-items:center;background:#f3f5f8}img{max-width:100%;height:auto;box-shadow:0 10px 30px rgba(0,0,0,.12)}';
      doc.head.appendChild(style);

      const image = doc.createElement('img');
      image.src = url;
      image.alt = title;
      doc.body.appendChild(image);

      printWindow.focus();
      printWindow.print();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
    } catch (error) {
      console.error(error);
      ui.showInfoModal('Друк заблоковано', 'Браузер не відкрив вікно друку. Дозвольте спливаючі вікна для цієї сторінки.', '⚠️');
    }
  }

  function deleteSelected() {
    const selected = getSelectedObject();
    if (!selected) return;
    pushUndo();
    editor.deleteObject(selected.id);
    ui.updateSelectionStatus(null);
    markDirty();
  }

  function duplicateSelected() {
    const selected = getSelectedObject();
    if (!selected) return;
    pushUndo();
    editor.duplicateObject(selected.id);
    ui.updateSelectionStatus(getSelectedObject());
    markDirty();
  }

  function bringFront() {
    const selected = getSelectedObject();
    if (!selected) return;
    pushUndo();
    if (editor.bringToFront(selected.id)) markDirty();
  }

  function sendBack() {
    const selected = getSelectedObject();
    if (!selected) return;
    pushUndo();
    if (editor.sendToBack(selected.id)) markDirty();
  }

  async function editSelectedText() {
    const selected = getSelectedObject();
    if (!selected || selected.type !== 'text') return;
    const value = await ui.showPromptModal('Редагувати текст', 'Змініть напис або вставте кілька рядків.', selected.text || '');
    if (value === false) return;
    pushUndo();
    selected.text = value.trim() || 'Текст';
    editor.renderAll();
    markDirty();
  }

  function copySelected() {
    const selected = getSelectedObject();
    if (!selected) return;
    state.clipboard = utils.deepClone(selected);
  }

  function pasteSelected() {
    if (!state.clipboard) return;
    pushUndo();
    const copy = utils.deepClone(state.clipboard);
    copy.id = utils.uid(copy.type);
    if (constants.RECT_LIKE_TYPES.includes(copy.type) || copy.type === 'text') {
      copy.x += 20; copy.y += 20;
    } else if (constants.LINE_TYPES.includes(copy.type)) {
      copy.x1 += 20; copy.x2 += 20; copy.y1 += 20; copy.y2 += 20;
    } else if (copy.type === 'pen') {
      copy.points = copy.points.map((point) => ({ x: point.x + 20, y: point.y + 20 }));
    }
    editor.addObject(copy);
    selectObject(copy.id);
    markDirty();
  }

  function createObjectFromTool(tool, point) {
    const snapped = applySnapPoint(point);
    if (tool === 'pen') {
      return {
        id: utils.uid('pen'),
        type: 'pen',
        points: [snapped],
        stroke: state.currentStroke,
        strokeWidth: state.currentStrokeWidth,
        opacity: state.currentOpacity
      };
    }

    if (tool === 'line' || tool === 'arrow') {
      return {
        id: utils.uid(tool),
        type: tool,
        x1: snapped.x,
        y1: snapped.y,
        x2: snapped.x,
        y2: snapped.y,
        stroke: state.currentStroke,
        strokeWidth: state.currentStrokeWidth,
        opacity: state.currentOpacity
      };
    }

    if (constants.RECT_LIKE_TYPES.includes(tool)) {
      return {
        id: utils.uid(tool),
        type: tool,
        x: snapped.x,
        y: snapped.y,
        w: 0,
        h: 0,
        stroke: state.currentStroke,
        fill: state.currentFill,
        strokeWidth: state.currentStrokeWidth,
        opacity: state.currentOpacity
      };
    }

    return null;
  }

  async function createTextAt(point) {
    const initial = 'Текст';
    const value = await ui.showPromptModal('Додати текст', 'Введіть напис для полотна.', initial);
    if (value === false) return;
    pushUndo();
    const snapped = applySnapPoint(point);
    const obj = {
      id: utils.uid('text'),
      type: 'text',
      x: snapped.x,
      y: snapped.y,
      text: value.trim() || initial,
      fill: state.currentFill,
      stroke: state.currentStroke,
      fontSize: state.currentFontSize,
      opacity: state.currentOpacity
    };
    editor.addObject(obj);
    selectObject(obj.id);
    markDirty();
  }

  function updateDraftObject(tool, origin, point) {
    const snappedPoint = applySnapPoint(point);
    const draft = state.draftObject;
    if (!draft) return;

    if (tool === 'pen') {
      const last = draft.points[draft.points.length - 1];
      if (!last || utils.distance(last, snappedPoint) >= 2) {
        draft.points.push(snappedPoint);
      }
      editor.renderAll();
      return;
    }

    if (tool === 'line' || tool === 'arrow') {
      draft.x2 = snappedPoint.x;
      draft.y2 = snappedPoint.y;
      editor.renderAll();
      return;
    }

    if (constants.RECT_LIKE_TYPES.includes(tool)) {
      const rect = utils.normalizeRect(origin.x, origin.y, snappedPoint.x, snappedPoint.y);
      draft.x = rect.x;
      draft.y = rect.y;
      draft.w = rect.w;
      draft.h = rect.h;
      editor.renderAll();
    }
  }

  function draftIsVisible(draft) {
    if (!draft) return false;
    if (draft.type === 'pen') return (draft.points || []).length > 1;
    if (constants.LINE_TYPES.includes(draft.type)) return Math.abs(draft.x2 - draft.x1) > 2 || Math.abs(draft.y2 - draft.y1) > 2;
    if (constants.RECT_LIKE_TYPES.includes(draft.type)) return draft.w >= constants.MIN_SHAPE_SIZE && draft.h >= constants.MIN_SHAPE_SIZE;
    return true;
  }

  function startDrawing(point) {
    const draft = createObjectFromTool(state.currentTool, point);
    if (!draft) return;
    pushUndo();
    state.interaction = {
      mode: 'draw',
      tool: state.currentTool,
      origin: applySnapPoint(point)
    };
    editor.setDraft(draft);
  }

  function startMove(point, objectId) {
    const obj = editor.getObjectById(objectId);
    if (!obj) return;
    pushUndo();
    selectObject(objectId);
    state.interaction = {
      mode: 'move',
      objectId,
      start: point,
      original: utils.deepClone(obj)
    };
  }

  function startResize(point, handle) {
    const obj = getSelectedObject();
    if (!obj) return;
    pushUndo();
    state.interaction = {
      mode: 'resize',
      objectId: obj.id,
      handle,
      start: point,
      original: utils.deepClone(obj)
    };
  }

  function moveObject(interaction, point) {
    const obj = editor.getObjectById(interaction.objectId);
    if (!obj) return;
    const dx = point.x - interaction.start.x;
    const dy = point.y - interaction.start.y;
    const snapDx = state.snapToGrid ? applySnap(interaction.original.type === 'pen' ? dx : dx) : dx;
    const snapDy = state.snapToGrid ? applySnap(interaction.original.type === 'pen' ? dy : dy) : dy;

    if (constants.RECT_LIKE_TYPES.includes(obj.type)) {
      obj.x = utils.clamp(interaction.original.x + snapDx, 0, state.canvasWidth - (obj.w || 0));
      obj.y = utils.clamp(interaction.original.y + snapDy, 0, state.canvasHeight - (obj.h || 0));
    } else if (obj.type === 'text') {
      obj.x = utils.clamp(interaction.original.x + snapDx, 0, state.canvasWidth);
      obj.y = utils.clamp(interaction.original.y + snapDy, 0, state.canvasHeight);
    } else if (constants.LINE_TYPES.includes(obj.type)) {
      obj.x1 = utils.clamp(interaction.original.x1 + snapDx, 0, state.canvasWidth);
      obj.y1 = utils.clamp(interaction.original.y1 + snapDy, 0, state.canvasHeight);
      obj.x2 = utils.clamp(interaction.original.x2 + snapDx, 0, state.canvasWidth);
      obj.y2 = utils.clamp(interaction.original.y2 + snapDy, 0, state.canvasHeight);
    } else if (obj.type === 'pen') {
      obj.points = interaction.original.points.map((item) => ({
        x: utils.clamp(item.x + snapDx, 0, state.canvasWidth),
        y: utils.clamp(item.y + snapDy, 0, state.canvasHeight)
      }));
    }
    editor.renderAll();
    ui.updateSelectionStatus(obj);
  }

  function resizeRectLike(interaction, point) {
    const obj = editor.getObjectById(interaction.objectId);
    if (!obj) return;
    const original = interaction.original;
    let left = original.x;
    let top = original.y;
    let right = original.x + original.w;
    let bottom = original.y + original.h;

    if (interaction.handle.includes('w')) left = utils.clamp(point.x, 0, right - constants.MIN_SHAPE_SIZE);
    if (interaction.handle.includes('e')) right = utils.clamp(point.x, left + constants.MIN_SHAPE_SIZE, state.canvasWidth);
    if (interaction.handle.includes('n')) top = utils.clamp(point.y, 0, bottom - constants.MIN_SHAPE_SIZE);
    if (interaction.handle.includes('s')) bottom = utils.clamp(point.y, top + constants.MIN_SHAPE_SIZE, state.canvasHeight);

    left = state.snapToGrid ? applySnap(left) : left;
    top = state.snapToGrid ? applySnap(top) : top;
    right = state.snapToGrid ? applySnap(right) : right;
    bottom = state.snapToGrid ? applySnap(bottom) : bottom;

    obj.x = Math.min(left, right - constants.MIN_SHAPE_SIZE);
    obj.y = Math.min(top, bottom - constants.MIN_SHAPE_SIZE);
    obj.w = Math.max(constants.MIN_SHAPE_SIZE, right - left);
    obj.h = Math.max(constants.MIN_SHAPE_SIZE, bottom - top);
    editor.renderAll();
  }

  function resizeLine(interaction, point) {
    const obj = editor.getObjectById(interaction.objectId);
    if (!obj) return;
    const snapped = applySnapPoint(point);
    if (interaction.handle === 'line-start') {
      obj.x1 = snapped.x;
      obj.y1 = snapped.y;
    } else {
      obj.x2 = snapped.x;
      obj.y2 = snapped.y;
    }
    editor.renderAll();
  }

  function resizePen(interaction, point) {
    const obj = editor.getObjectById(interaction.objectId);
    if (!obj) return;
    const original = interaction.original;
    const bounds = utils.pointsBounds(original.points);
    let left = bounds.x;
    let top = bounds.y;
    let right = bounds.x + Math.max(bounds.w, constants.MIN_PEN_SIZE);
    let bottom = bounds.y + Math.max(bounds.h, constants.MIN_PEN_SIZE);

    if (interaction.handle.includes('w')) left = utils.clamp(point.x, 0, right - constants.MIN_PEN_SIZE);
    if (interaction.handle.includes('e')) right = utils.clamp(point.x, left + constants.MIN_PEN_SIZE, state.canvasWidth);
    if (interaction.handle.includes('n')) top = utils.clamp(point.y, 0, bottom - constants.MIN_PEN_SIZE);
    if (interaction.handle.includes('s')) bottom = utils.clamp(point.y, top + constants.MIN_PEN_SIZE, state.canvasHeight);

    left = state.snapToGrid ? applySnap(left) : left;
    top = state.snapToGrid ? applySnap(top) : top;
    right = state.snapToGrid ? applySnap(right) : right;
    bottom = state.snapToGrid ? applySnap(bottom) : bottom;

    const nextBounds = { x: left, y: top, w: Math.max(constants.MIN_PEN_SIZE, right - left), h: Math.max(constants.MIN_PEN_SIZE, bottom - top) };
    obj.points = utils.scalePoints(original.points, { x: bounds.x, y: bounds.y, w: Math.max(bounds.w, 1), h: Math.max(bounds.h, 1) }, nextBounds);
    editor.renderAll();
  }

  function updateInteraction(point) {
    if (!state.interaction) return;
    if (state.interaction.mode === 'draw') {
      updateDraftObject(state.interaction.tool, state.interaction.origin, point);
      return;
    }
    if (state.interaction.mode === 'move') {
      moveObject(state.interaction, point);
      return;
    }
    if (state.interaction.mode === 'resize') {
      const obj = editor.getObjectById(state.interaction.objectId);
      if (!obj) return;
      if (constants.RECT_LIKE_TYPES.includes(obj.type)) resizeRectLike(state.interaction, point);
      else if (constants.LINE_TYPES.includes(obj.type)) resizeLine(state.interaction, point);
      else if (obj.type === 'pen') resizePen(state.interaction, point);
    }
  }

  function finishInteraction() {
    if (!state.interaction) return;
    if (state.interaction.mode === 'draw') {
      if (draftIsVisible(state.draftObject)) {
        const committed = editor.commitDraft();
        if (committed) selectObject(committed.id);
        markDirty();
      } else {
        editor.clearDraft();
      }
    } else {
      markDirty();
    }
    state.interaction = null;
  }

  function hitObjectNode(target) {
    return target.closest ? target.closest('.vector-object') : null;
  }

  function hitHandleNode(target) {
    return target.closest ? target.closest('[data-handle]') : null;
  }

  function runOfficeCommand(command) {
    return window.OfficeShell?.runCommand?.(command) || false;
  }

  function createShellCommands() {
    return {
      new: newProject,
      open: openProject,
      save: saveProject,
      undo: undo,
      redo: redo
    };
  }

  function handleMenuAction(action) {
    switch (action) {
      case 'new-project': runOfficeCommand('new') || newProject(); break;
      case 'open-project': runOfficeCommand('open') || openProject(); break;
      case 'save-project': runOfficeCommand('save') || saveProject(); break;
      case 'export-svg': exportSvg(); break;
      case 'export-png': exportPng(); break;
      case 'print': printProject(); break;
      case 'undo': runOfficeCommand('undo') || undo(); break;
      case 'redo': runOfficeCommand('redo') || redo(); break;
      case 'duplicate': duplicateSelected(); break;
      case 'delete-selected': deleteSelected(); break;
      case 'bring-front': bringFront(); break;
      case 'send-back': sendBack(); break;
      case 'edit-text': editSelectedText(); break;
      case 'set-tool-text': setTool('text'); break;
      case 'set-tool-rect': setTool('rect'); break;
      case 'set-tool-ellipse': setTool('ellipse'); break;
      case 'set-tool-line': setTool('line'); break;
      case 'set-tool-arrow': setTool('arrow'); break;
      case 'guide-none': setGuide('none'); break;
      case 'guide-grid': setGuide('grid'); break;
      case 'guide-lines': setGuide('lines'); break;
      case 'toggle-snap': toggleSnap(); break;
      case 'zoom-out': zoomOut(); break;
      case 'zoom-reset': zoomReset(); break;
      case 'zoom-in': zoomIn(); break;
      case 'show-help':
        ui.showInfoModal('Довідка та поради', `Що вміє редактор
• Редаговані векторні фігури, лінії та стрілки
• Текстові підписи для схем, діаграм і плакатів
• Прив'язка до сітки для акуратної побудови
• Експорт у SVG, PNG та друк
• Збереження проєкту у JSON без реєстрації

Поради для уроків
• Для молодших учнів зазвичай достатньо інструментів: Вибір, Лінія, Прямокутник, Еліпс і Текст
• Якщо потрібно акуратно вирівнювати елементи, увімкніть Прив'язку
• Експорт SVG підходить для подальшого редагування, PNG — для вставки в презентації та документи`, '💡');
        break;
      case 'show-shortcuts':
        ui.showInfoModal('Клавіатурні скорочення', 'V — вибір\nP — олівець\nL — лінія\nA — стрілка\nR — прямокутник\nO — еліпс\nD — ромб\nS — зірка\nT — текст\nDelete / Backspace — видалити\nCtrl+Z / Ctrl+Y — скасувати / повернути\nCtrl+D — дублювати\nCtrl+C / Ctrl+V — копіювати / вставити\nCtrl+S — зберегти проєкт\nCtrl+Shift+S — PNG\nEsc — зняти виділення', '⌨️');
        break;
      case 'show-about':
        ui.showInfoModal('Про ПЛЮС Вектор', 'ПЛЮС Вектор — браузерний векторний редактор для шкільного офісного набору. Інтерфейс узгоджений з іншими програмами Офіс ПЛЮС: кольоровий хедер, верхнє меню, компактна панель інструментів і чисте робоче поле без зайвих бокових підказок. Редактор працює без реєстрації, зберігає проєкти локально та дозволяє експортувати роботи у SVG і PNG.', '🧩');
        break;
      default:
        break;
    }
    ui.closeMenus();
    ui.closeToolPickers();
  }

  function bindUi() {
    document.addEventListener('click', (event) => {
      const actionButton = event.target.closest('[data-action]');
      if (actionButton) {
        handleMenuAction(actionButton.dataset.action);
      }
    });

    ui.elements.toolSwitches.forEach((button) => {
      button.addEventListener('click', () => setTool(button.dataset.tool));
    });

    ui.elements.toolMenuOptions.forEach((button) => {
      button.addEventListener('click', (event) => {
        event.stopPropagation();
        setTool(button.dataset.tool);
      });
    });

    ui.elements.guideButtons.forEach((button) => {
      button.addEventListener('click', () => setGuide(button.dataset.guide));
    });

    ui.elements.strokeTargetBtn.addEventListener('click', () => {
      state.currentColorTarget = 'stroke';
      ui.updateColorUI();
    });
    ui.elements.fillTargetBtn.addEventListener('click', () => {
      state.currentColorTarget = 'fill';
      ui.updateColorUI();
    });

    ui.elements.colorPalette.addEventListener('click', (event) => {
      const swatch = event.target.closest('.color-swatch');
      if (!swatch) return;
      updateColor(swatch.dataset.hex);
    });

    ui.elements.noFillBtn.addEventListener('click', setNoFill);
    ui.elements.nativeColorPicker.addEventListener('input', (event) => updateColor(event.target.value));
    ui.elements.strokeWidthSlider.addEventListener('input', (event) => updateStrokeWidth(event.target.value));
    ui.elements.opacitySlider.addEventListener('input', (event) => updateOpacity(event.target.value));
    ui.elements.fontSizeSlider.addEventListener('input', (event) => updateFontSize(event.target.value));
    if (ui.elements.snapToggleBtn && !ui.elements.snapToggleBtn.matches('[data-action="toggle-snap"]')) {
      ui.elements.snapToggleBtn.addEventListener('click', toggleSnap);
    }

    document.addEventListener('click', (event) => {
      const renameTrigger = event.target.closest('#fileName');
      if (!renameTrigger) return;
      ui.beginRename(() => {
        ui.updateFileNameUI();
        markDirty();
      });
    });

    ui.elements.projectFileInput.addEventListener('change', (event) => {
      handleProjectFile(event.target.files?.[0]);
      event.target.value = '';
    });
  }

  function bindCanvas() {
    const svg = ui.elements.drawingSvg;

    svg.addEventListener('pointermove', (event) => {
      const point = utils.getSvgPoint(event, svg, state.canvasWidth, state.canvasHeight);
      state.pointer = point;
      ui.updateCoords(point.x, point.y);
      updateInteraction(point);
    });

    svg.addEventListener('pointerdown', async (event) => {
      if (event.button !== undefined && event.button !== 0) return;
      const point = utils.getSvgPoint(event, svg, state.canvasWidth, state.canvasHeight);
      state.pointer = point;
      ui.updateCoords(point.x, point.y);

      const handle = hitHandleNode(event.target);
      if (handle && state.currentTool === 'select') {
        event.preventDefault();
        startResize(point, handle.dataset.handle);
        return;
      }

      const objectNode = hitObjectNode(event.target);
      if (objectNode && state.currentTool === 'select') {
        event.preventDefault();
        startMove(point, objectNode.dataset.id);
        return;
      }

      if (objectNode) {
        selectObject(objectNode.dataset.id);
        if (getSelectedObject()?.type === 'text' && event.detail >= 2) {
          await editSelectedText();
        }
        return;
      }

      if (state.currentTool === 'select') {
        clearSelection();
        return;
      }

      if (state.currentTool === 'text') {
        await createTextAt(point);
        return;
      }

      clearSelection();
      startDrawing(point);
    });

    document.addEventListener('pointerup', () => finishInteraction());
    document.addEventListener('pointercancel', () => {
      state.interaction = null;
      editor.clearDraft();
    });
  }

  function bindKeyboard() {
    document.addEventListener('keydown', (event) => {
      const target = event.target;
      const typing = target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable);
      if (typing) return;

      if ((event.key === 'Delete' || event.key === 'Backspace') && getSelectedObject()) {
        event.preventDefault();
        deleteSelected();
        return;
      }

      if (event.ctrlKey && event.key.toLowerCase() === 'z') {
        event.preventDefault();
        runOfficeCommand('undo') || undo();
        return;
      }
      if (event.ctrlKey && event.key.toLowerCase() === 'y') {
        event.preventDefault();
        runOfficeCommand('redo') || redo();
        return;
      }
      if (event.ctrlKey && event.shiftKey && event.key.toLowerCase() === 's') {
        event.preventDefault();
        exportPng();
        return;
      }
      if (event.ctrlKey && event.key.toLowerCase() === 's') {
        event.preventDefault();
        runOfficeCommand('save') || saveProject();
        return;
      }
      if (event.ctrlKey && event.key.toLowerCase() === 'o') {
        event.preventDefault();
        runOfficeCommand('open') || openProject();
        return;
      }
      if (event.ctrlKey && event.key.toLowerCase() === 'n') {
        event.preventDefault();
        runOfficeCommand('new') || newProject();
        return;
      }
      if (event.ctrlKey && event.key.toLowerCase() === 'd') {
        event.preventDefault();
        duplicateSelected();
        return;
      }
      if (event.ctrlKey && event.key.toLowerCase() === 'c') {
        event.preventDefault();
        copySelected();
        return;
      }
      if (event.ctrlKey && event.key.toLowerCase() === 'v') {
        event.preventDefault();
        pasteSelected();
        return;
      }
      if (event.key === 'Escape') {
        clearSelection();
        ui.closeMenus();
        return;
      }

      const toolHotkeys = {
        v: 'select', p: 'pen', l: 'line', a: 'arrow', r: 'rect', o: 'ellipse', d: 'diamond', s: 'star', t: 'text'
      };
      const hotTool = toolHotkeys[event.key.toLowerCase()];
      if (hotTool && !event.ctrlKey && !event.altKey && !event.metaKey) {
        event.preventDefault();
        setTool(hotTool);
      }
    });
  }

  function tryRestoreAutosave() {
    const raw = localStorage.getItem(constants.STORAGE_KEY);
    if (!raw) return;
    try {
      const payload = JSON.parse(raw);
      restorePayload(payload);
      state.unsavedChanges = false;
      ui.updateAll();
    } catch (error) {
      console.warn('Не вдалося відновити чернетку.', error);
    }
  }

  function initVectorEditor() {
    const elements = ui.init();
    editor.init(elements);
    editor.resizeArtboard(state.canvasWidth, state.canvasHeight);
    tryRestoreAutosave();
    bindUi();
    bindCanvas();
    bindKeyboard();
    ui.updateAll();
  }

  window.VectorApp.boot = () =>
    window.OfficeShell?.bootEditor?.({
      source: 'vector',
      commands: createShellCommands,
      boot: initVectorEditor
    }) ?? (window.OfficeUI?.registerCommands?.(createShellCommands(), { source: 'vector' }), initVectorEditor());
})();
