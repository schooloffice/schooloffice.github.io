'use strict';

window.ArtVector = window.ArtVector || {};
window.VectorApp = window.VectorApp || {};

(() => {
  const { constants, state, utils, editor, ui, projectIo, vectorStorage } = window.ArtVector;

  const persistDraft = debounce(() => {
    if (state.suppressAutosave) return;
    // Чернетка негарантована: помилка сховища не повинна ламати редагування.
    vectorStorage.saveDraft(editor.buildProjectPayload()).catch((error) => {
      console.warn('Не вдалося зберегти чернетку.', error);
    });
  }, 220);

  // Лічильник дій користувача. Відновлення чернетки асинхронне, тож перед
  // застосуванням треба переконатися, що за час читання зі сховища користувач
  // нічого не зробив — інакше чернетка затре перейменування, зміну інструмента
  // чи щойно відкритий проєкт. Усі дії редактора вже проходять через autosaveDraft.
  let userActionSeq = 0;

  function autosaveDraft() {
    userActionSeq += 1;
    persistDraft();
  }

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

  // Останній обраний підінструмент кожної групи: кнопка групи в rail повертає
  // саме його, а не завжди перший у списку.
  const lastGroupTool = { draw: 'pen', line: 'line', shape: 'rect' };

  function setTool(toolName) {
    if (!Object.prototype.hasOwnProperty.call(constants.TOOLS, toolName)) return;
    const group = constants.getToolGroup(toolName);
    if (group) lastGroupTool[group] = toolName;
    state.currentTool = toolName;
    ui.updateToolUI();
    autosaveDraft();
  }

  function setToolGroup(groupName) {
    setTool(lastGroupTool[groupName] || constants.TOOL_GROUPS[groupName]?.[0]);
  }

  function getSelectedObject() {
    if (!state.selectedObjectId) return null;
    return editor.getObjectById(state.selectedObjectId);
  }

  function getSelectedObjects() {
    return (state.selectedObjectIds || [])
      .map((id) => editor.getObjectById(id))
      .filter(Boolean);
  }

  // Групу виділяємо цілком: клік по будь-якій її фігурі бере всі, інакше
  // «згруповано» нічого б не означало на практиці.
  function expandToGroup(id) {
    const obj = editor.getObjectById(id);
    if (!obj) return [];
    if (!obj.groupId) return [id];
    return state.objects.filter((item) => item.groupId === obj.groupId).map((item) => item.id);
  }

  function setSelection(ids) {
    const unique = [...new Set(ids.filter((id) => !!editor.getObjectById(id)))];
    state.selectedObjectIds = unique;
    state.selectedObjectId = unique[0] || null;
    editor.renderAll();
    ui.updateSelectionStatus(getSelectedObject(), unique.length);
  }

  // additive — Shift-клік: додає або знімає фігуру (разом із її групою).
  function selectObject(id, options = {}) {
    const target = expandToGroup(id);
    if (!options.additive) return setSelection(target);

    const current = new Set(state.selectedObjectIds || []);
    const alreadyIn = target.every((item) => current.has(item));
    target.forEach((item) => { if (alreadyIn) current.delete(item); else current.add(item); });
    setSelection([...current]);
  }

  function clearSelection() {
    setSelection([]);
  }

  function groupSelected() {
    const selected = getSelectedObjects();
    if (selected.length < 2) {
      ui.showInfoModal?.('Групування', 'Виділи дві або більше фігур: утримуй Shift і клікай по них.');
      return;
    }
    pushUndo();
    const groupId = utils.uid('group');
    selected.forEach((obj) => { obj.groupId = groupId; });
    setSelection(selected.map((obj) => obj.id));
    markDirty();
  }

  function ungroupSelected() {
    const selected = getSelectedObjects().filter((obj) => obj.groupId);
    if (!selected.length) return;
    pushUndo();
    selected.forEach((obj) => { delete obj.groupId; });
    setSelection(selected.map((obj) => obj.id));
    markDirty();
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
    // Нижня межа менша за перший ZOOM_STEP: «вмістити у вікно» має працювати
    // і для великого полотна на невеликому екрані.
    state.zoom = utils.clamp(value, 0.1, 2);
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

  // Артборд ландшафтний, а на ноутбуці дефіцитна саме висота — тож масштаб
  // рахуємо за меншим коефіцієнтом і лишаємо поле навколо полотна.
  function fitToWindow() {
    const scroller = ui.elements.canvasScroller;
    if (!scroller) return;
    const available = scroller.getBoundingClientRect();
    if (!available.width || !available.height) return;
    const padding = 32;
    const scale = Math.min(
      (available.width - padding) / state.canvasWidth,
      (available.height - padding) / state.canvasHeight
    );
    setZoom(scale);
    scroller.scrollTo({ top: 0, left: 0 });
  }

  function togglePropertiesPanel() {
    ui.togglePanel();
  }

  async function newProject() {
    if (state.unsavedChanges) {
      const okay = await ui.showConfirmModal('Створити новий проєкт?', 'Незбережені зміни буде втрачено.', '🆕', 'Створити');
      if (!okay) return;
    }
    state.fileName = constants.DEFAULT_FILE_NAME;
    state.objects = [];
    state.selectedObjectId = null;
      state.selectedObjectIds = [];
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

  const IMPORT_ERRORS = {
    'too-large': 'Файл проєкту завеликий. Максимальний розмір — 8 МБ.',
    'not-json': 'Не вдалося прочитати файл проєкту. Перевірте, чи це коректний JSON-файл редактора.',
    schema: 'Файл проєкту не відповідає формату редактора або перевищує допустимі межі (кількість об’єктів, розмір полотна).',
    read: 'Не вдалося прочитати файл. Спробуйте ще раз.'
  };

  function showImportError(reason) {
    ui.showInfoModal('Помилка відкриття', IMPORT_ERRORS[reason] || IMPORT_ERRORS.read, '⚠️');
  }

  // Недовірений файл: ліміт розміру -> JSON -> schema-валідація. У state
  // потрапляє лише нормалізований payload (див. vector/js/project-io.js).
  async function handleProjectFile(file) {
    if (!file) return;
    if (file.size > projectIo.LIMITS.MAX_FILE_BYTES) {
      showImportError('too-large');
      return;
    }
    let text;
    try {
      text = await utils.fileToText(file);
    } catch (error) {
      console.error(error);
      showImportError('read');
      return;
    }
    const parsed = projectIo.parseProjectText(text);
    if (!parsed.ok) {
      showImportError(parsed.reason);
      return;
    }
    restorePayload(parsed.payload);
    state.undoStack.length = 0;
    state.redoStack.length = 0;
    state.unsavedChanges = false;
    ui.updateAll();
    markSaved();
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
    const selected = getSelectedObjects();
    if (!selected.length) return;
    pushUndo();
    selected.forEach((obj) => editor.deleteObject(obj.id));
    setSelection([]);
    markDirty();
  }

  function duplicateSelected() {
    const selected = getSelectedObjects();
    if (!selected.length) return;
    pushUndo();
    // Копії групи лишаються групою, але вже своєю власною.
    const groupRemap = new Map();
    const copies = selected.map((obj) => {
      const copy = editor.duplicateObject(obj.id);
      if (copy && obj.groupId) {
        if (!groupRemap.has(obj.groupId)) groupRemap.set(obj.groupId, utils.uid('group'));
        copy.groupId = groupRemap.get(obj.groupId);
      }
      return copy;
    }).filter(Boolean);
    if (copies.length) setSelection(copies.map((obj) => obj.id));
    markDirty();
  }

  function bringFront() {
    const selected = getSelectedObjects();
    if (!selected.length) return;
    pushUndo();
    // Порядок зберігаємо: піднімаємо знизу вгору, інакше група перевернеться.
    let changed = false;
    selected.forEach((obj) => { if (editor.bringToFront(obj.id)) changed = true; });
    if (changed) markDirty();
  }

  function sendBack() {
    const selected = getSelectedObjects();
    if (!selected.length) return;
    pushUndo();
    let changed = false;
    [...selected].reverse().forEach((obj) => { if (editor.sendToBack(obj.id)) changed = true; });
    if (changed) markDirty();
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
    } else if (constants.POINT_TYPES.includes(copy.type)) {
      copy.points = copy.points.map((point) => ({ x: point.x + 20, y: point.y + 20 }));
    }
    editor.addObject(copy);
    selectObject(copy.id);
    markDirty();
  }

  function createObjectFromTool(tool, point) {
    const snapped = applySnapPoint(point);
    // Олівець малює від руки: прив'язка до сітки перетворювала б будь-яку
    // діагональ на сходинки з кроком GRID_SIZE, тож точки контуру лишаються
    // такими, як їх веде рука. Прив'язка діє на примітиви з опорними точками.
    if (constants.POINT_TYPES.includes(tool)) {
      return {
        id: utils.uid(tool),
        type: tool,
        points: [{ x: point.x, y: point.y }],
        stroke: state.currentStroke,
        // Крива може бути замкненою фігурою, тож заливка їй доречна.
        fill: tool === 'curve' ? state.currentFill : 'none',
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

    // Олівець веде лінію по фактичних координатах курсора — див. коментар
    // у createObjectFromTool.
    if (constants.POINT_TYPES.includes(tool)) {
      // Для кривої беремо точки рідше: щільний слід від руки дав би сплайн,
      // у якому кожне тремтіння стає окремим вигином.
      const minStep = tool === 'curve' ? 14 : 2;
      const last = draft.points[draft.points.length - 1];
      if (!last || utils.distance(last, point) >= minStep) {
        draft.points.push({ x: point.x, y: point.y });
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
    if (constants.POINT_TYPES.includes(draft.type)) return (draft.points || []).length > 1;
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
    // Якщо фігура вже у виділенні, тягнемо все виділення; інакше клік спершу
    // перевиділяє — так само, як у будь-якому графічному редакторі.
    if (!(state.selectedObjectIds || []).includes(objectId)) selectObject(objectId);

    state.interaction = {
      mode: 'move',
      objectId,
      start: point,
      // Знімок кожної рухомої фігури: рахувати зсув від початкових координат
      // надійніше, ніж накопичувати різницю між кадрами.
      originals: getSelectedObjects().map((item) => ({ id: item.id, snapshot: utils.deepClone(item) }))
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
    const dx = point.x - interaction.start.x;
    const dy = point.y - interaction.start.y;
    const snapDx = state.snapToGrid ? applySnap(dx) : dx;
    const snapDy = state.snapToGrid ? applySnap(dy) : dy;

    (interaction.originals || []).forEach(({ id, snapshot }) => {
      const obj = editor.getObjectById(id);
      if (!obj) return;

      if (constants.RECT_LIKE_TYPES.includes(obj.type)) {
        obj.x = utils.clamp(snapshot.x + snapDx, 0, state.canvasWidth - (obj.w || 0));
        obj.y = utils.clamp(snapshot.y + snapDy, 0, state.canvasHeight - (obj.h || 0));
      } else if (obj.type === 'text') {
        obj.x = utils.clamp(snapshot.x + snapDx, 0, state.canvasWidth);
        obj.y = utils.clamp(snapshot.y + snapDy, 0, state.canvasHeight);
      } else if (constants.LINE_TYPES.includes(obj.type)) {
        obj.x1 = utils.clamp(snapshot.x1 + snapDx, 0, state.canvasWidth);
        obj.y1 = utils.clamp(snapshot.y1 + snapDy, 0, state.canvasHeight);
        obj.x2 = utils.clamp(snapshot.x2 + snapDx, 0, state.canvasWidth);
        obj.y2 = utils.clamp(snapshot.y2 + snapDy, 0, state.canvasHeight);
      } else if (obj.type === 'pen' || obj.type === 'curve') {
        obj.points = snapshot.points.map((item) => ({
          x: utils.clamp(item.x + snapDx, 0, state.canvasWidth),
          y: utils.clamp(item.y + snapDy, 0, state.canvasHeight)
        }));
      }
    });

    editor.renderAll();
    ui.updateSelectionStatus(getSelectedObject(), (state.selectedObjectIds || []).length);
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
      else if (constants.POINT_TYPES.includes(obj.type)) resizePen(state.interaction, point);
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
      case 'group-objects': groupSelected(); break;
      case 'ungroup-objects': ungroupSelected(); break;
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
      case 'fit-canvas': fitToWindow(); break;
      case 'toggle-panel': togglePropertiesPanel(); break;
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
        ui.showInfoModal('Клавіатурні скорочення', 'V — вибір\nP — олівець\nL — лінія\nA — стрілка\nR — прямокутник\nO — еліпс\nD — ромб\nS — зірка\nT — текст\nDelete / Backspace — видалити\nCtrl+Z / Ctrl+Y — скасувати / повернути\nCtrl+D — дублювати\nCtrl+C / Ctrl+V — копіювати / вставити\nCtrl+S — зберегти проєкт\nCtrl+Shift+S — PNG\nCtrl+0 — масштаб 100%\nCtrl+\\ — згорнути панель параметрів\nEsc — зняти виділення', '⌨️');
        break;
      case 'show-about':
        ui.showInfoModal('Про ПЛЮС Вектор', 'ПЛЮС Вектор — браузерний векторний редактор для шкільного офісного набору. Інтерфейс узгоджений з іншими програмами Офіс ПЛЮС: кольоровий хедер, верхнє меню, компактна панель інструментів і чисте робоче поле без зайвих бокових підказок. Редактор працює без реєстрації, зберігає проєкти локально та дозволяє експортувати роботи у SVG і PNG.', '🧩');
        break;
      default:
        break;
    }
    ui.closeMenus();
  }

  function bindUi() {
    document.addEventListener('click', (event) => {
      const actionButton = event.target.closest('[data-action]');
      if (actionButton) {
        handleMenuAction(actionButton.dataset.action);
      }
    });

    ui.elements.railTools.forEach((button) => {
      button.addEventListener('click', () => {
        if (button.dataset.toolGroup) setToolGroup(button.dataset.toolGroup);
        else setTool(button.dataset.tool);
      });
    });

    ui.elements.toolChips.forEach((chip) => {
      chip.addEventListener('click', () => setTool(chip.dataset.tool));
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
        // Shift-клік лише змінює склад виділення: тягнути одночасно з ним
        // означало б випадково зрушити щойно додану фігуру.
        if (event.shiftKey) {
          selectObject(objectNode.dataset.id, { additive: true });
          return;
        }
        startMove(point, objectNode.dataset.id);
        return;
      }

      if (objectNode) {
        // Shift працює однаково незалежно від активного інструмента: інакше
        // «додати до виділення» мовчки замінювало б виділення, щойно в rail
        // лишився обраним, скажімо, прямокутник.
        selectObject(objectNode.dataset.id, { additive: event.shiftKey });
        if (!event.shiftKey && getSelectedObject()?.type === 'text' && event.detail >= 2) {
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

      if ((event.key === 'Delete' || event.key === 'Backspace') && getSelectedObjects().length) {
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
      if (event.ctrlKey && event.key === '\\') {
        event.preventDefault();
        togglePropertiesPanel();
        return;
      }
      if (event.ctrlKey && event.key === '0') {
        event.preventDefault();
        zoomReset();
        return;
      }
      if (event.ctrlKey && event.key.toLowerCase() === 'd') {
        event.preventDefault();
        duplicateSelected();
        return;
      }
      if (event.ctrlKey && event.key.toLowerCase() === 'g') {
        event.preventDefault();
        if (event.shiftKey) ungroupSelected();
        else groupSelected();
        return;
      }
      // Ctrl+A виділяє всі фігури — без нього згрупувати цілий малюнок
      // означало б клікати по кожній фігурі окремо.
      if (event.ctrlKey && event.key.toLowerCase() === 'a') {
        event.preventDefault();
        setSelection(state.objects.map((obj) => obj.id));
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

  // Чернетка теж проходить нормалізацію: сховище браузера могло бути змінене
  // ззовні, а формат — застаріти між версіями редактора.
  async function tryRestoreAutosave() {
    const seqAtStart = userActionSeq;
    let raw;
    try {
      raw = await vectorStorage.loadDraft();
    } catch (error) {
      console.warn('Не вдалося прочитати чернетку.', error);
      return;
    }
    if (!raw) return;
    // Будь-яка дія користувача за час читання зі сховища скасовує відновлення:
    // його робота важливіша за чернетку.
    if (userActionSeq !== seqAtStart) return;
    const payload = projectIo.normalizeProject(raw);
    if (!payload) {
      console.warn('Чернетку відхилено: не відповідає формату проєкту.');
      return;
    }
    restorePayload(payload);
    state.unsavedChanges = false;
    ui.updateAll();
  }

  function initVectorEditor() {
    const elements = ui.init();
    editor.init(elements);
    editor.resizeArtboard(state.canvasWidth, state.canvasHeight);
    bindUi();
    bindCanvas();
    bindKeyboard();
    ui.updateAll();
    // Асинхронне сховище не блокує показ редактора; відновлення саме оновить UI.
    window.ArtVector.draftRestored = tryRestoreAutosave();
  }

  // Boot має відбутися РІВНО один раз. Раніше тут стояв `bootEditor(...) ?? fallback`,
  // але синхронний initVectorEditor повертає undefined — тож fallback спрацьовував
  // завжди, редактор ініціалізувався двічі й кожен слухач вішався двічі
  // (один клік = дві дії). Перевіряємо наявність shell явно.
  window.VectorApp.boot = () => {
    if (window.OfficeShell?.bootEditor) {
      window.OfficeShell.bootEditor({
        source: 'vector',
        commands: createShellCommands,
        boot: initVectorEditor
      });
      return;
    }
    window.OfficeUI?.registerCommands?.(createShellCommands(), { source: 'vector' });
    initVectorEditor();
  };
})();
