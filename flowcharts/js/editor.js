/* ===== РОЗШИРЕНИЙ РЕДАКТОР БЛОК-СХЕМ — script.js (повна виправлена версія) ===== */

window.initFlowchartsEditor = function initFlowchartsEditor() {
  'use strict';

  const UI = window.ArtSchemesUI || {};
  const editorUtils = window.FlowchartsEditorUtils || {};
  const autosaveApi = window.FlowchartsAutosave || {};
  const modalsApi = window.FlowchartsModals || {};
  const titleApi = window.FlowchartsTitle || {};
  const routingApi = window.FlowchartsRouting || {};
  const connectionsDomApi = window.FlowchartsConnectionsDom || {};
  const shapeGeometryApi = window.FlowchartsShapeGeometry || {};
  const handlesApi = window.FlowchartsHandles || {};
  const shapePlacementApi = window.FlowchartsShapePlacement || {};
  const statusApi = window.FlowchartsStatus || {};
  const colorsApi = window.FlowchartsColors || {};
  const connectionSelectionApi = window.FlowchartsConnectionSelection || {};
  const shapeSelectionApi = window.FlowchartsShapeSelection || {};
  const shapeDeletionApi = window.FlowchartsShapeDeletion || {};
  const shapeTextApi = window.FlowchartsShapeText || {};
  const shapeInteractionsApi = window.FlowchartsShapeInteractions || {};
  const shapeFactoryApi = window.FlowchartsShapeFactory || {};
  const viewportApi = window.FlowchartsViewport || {};
  const keyboardApi = window.FlowchartsKeyboardShortcuts || {};
  const historyApi = window.FlowchartsHistory || {};
  const menuActionsApi = window.FlowchartsMenuActions || {};
  const flowActionsApi = window.FlowchartsFlowActions || {};

  const core = window.FlowchartCore || null;
  const projectIo = window.FlowchartsProjectIO || null;

  // ================= DOM =================
  const canvas = document.getElementById('flowchart-canvas');
  const canvasContainer = document.getElementById('canvas-container');
  const svgLayer = document.getElementById('connectors-layer');
  const headerEl = document.querySelector('header');

  const clearButton = document.getElementById('clear-button');
  const saveButton = document.getElementById('save-button');
  const newProjectButton = document.getElementById('new-project-button');
  const openProjectButton = document.getElementById('open-project-button');
  const saveProjectButton = document.getElementById('save-project-button');
  const snapToggleButton = document.getElementById('snap-toggle-button');
  const undoButton = document.getElementById('undo-button');
  let redoButton = document.getElementById('redo-button');

  const textModal = document.getElementById('text-modal');
  const shapeTextArea = document.getElementById('shape-text');
  const cancelText = document.getElementById('cancel-text');
  const saveText = document.getElementById('save-text');

  const helpButton = document.getElementById('help-button');
  const selectionStateEl = document.getElementById('selection-state');
  const toolbarEditBtn = document.getElementById('toolbar-edit-button');
  const toolbarRouteBtn = document.getElementById('toolbar-route-button');
  const toolbarLabelBtn = document.getElementById('toolbar-label-button');
  const toolbarDeleteBtn = document.getElementById('toolbar-delete-button');
  const helpPanel = document.getElementById('help-panel');
  const helpClose = document.getElementById('help-close');

  // topUndoBtn / topSaveBtn are now the main undo/save buttons — no delegation needed

  const zoomInBtn = document.getElementById('zoom-in');
  const zoomOutBtn = document.getElementById('zoom-out');
  const zoomResetBtn = document.getElementById('zoom-reset');
  const zoomLevelText = document.getElementById('zoom-level');

  const connectionModal = document.getElementById('connection-modal');
  const connectionYesBtn = document.getElementById('connection-yes');
  const connectionNoBtn = document.getElementById('connection-no');
  const cancelConnBtn = document.getElementById('cancel-connection');

  const connectionBar = null;
  let shapeBar = null;
  const deleteConnBtn = null;
  const routeConnBtn = toolbarRouteBtn;
  let editShapeBtn = toolbarEditBtn;
  let deleteShapeBtn = toolbarDeleteBtn;
  let editConnLabelBtn = toolbarLabelBtn;
  const saveTitleModal = document.getElementById('save-title-modal');
  const saveTitleInput = document.getElementById('save-title-input');
  const saveWithTitleBtn = document.getElementById('save-with-title');
  const saveWithoutTitleBtn = document.getElementById('save-without-title');
  const closeSaveTitleBtn = document.getElementById('close-save-title');

  const titleInput = document.getElementById('diagram-title-input');
  const titleDisplay = document.getElementById('diagram-title-display');
  const fileNameEl = document.getElementById('fileName');
  const dirtyDotEl = document.getElementById('dirtyDot');
  const savedBadgeEl = document.getElementById('savedBadge');

  if (!canvas || !canvasContainer || !svgLayer) {
    console.error('Flowchart editor: required DOM nodes are missing.');
    return;
  }

  function updateFloatingBarOffset() {
    /* floating bars removed in toolbar refactor */
  }

  const legacyDeleteButton = document.getElementById('delete-button');
  legacyDeleteButton?.remove();

  if (undoButton) {
    undoButton.innerHTML = '<i class="fa-solid fa-rotate-left"></i>';
    undoButton.setAttribute('aria-label', 'Скасувати');
    undoButton.title = 'Скасувати (Ctrl+Z)';
  }

  if (saveButton) {
    saveButton.setAttribute('aria-label', 'Зберегти зображення');
    saveButton.title = 'Зберегти зображення (Ctrl+S)';
  }

  let updateSnapButton = () => {};

  const projectFileInput = document.createElement('input');
  projectFileInput.id = 'project-file-input';
  projectFileInput.type = 'file';
  projectFileInput.accept = '.json,application/json';
  projectFileInput.hidden = true;
  document.body.appendChild(projectFileInput);

  document.querySelectorAll('.title-hint, .color-hint').forEach((el) => el.remove());

  // ================= STATE =================
  const DEFAULT_BASE_COLORS = core?.DEFAULT_BASE_COLORS
    ? { ...core.DEFAULT_BASE_COLORS }
    : {
      'start-end': '#4caf50',
      'process': '#03a9f4',
      'decision': '#ff9800',
      'input-output': '#3f51b5',
    };

  const state = {
    shapes: [],           // {id,type,color,textRaw}
    connections: [],      // {id,from,to,type,routeMode}
    selectedShape: null,
    selectedConnId: null,

    baseColors: { ...DEFAULT_BASE_COLORS },
    currentColor: '#3f51b5',
    lastShapeType: 'process',
    snapEnabled: true,

    diagramTitle: '',

    shapeCounter: 0,

    // Zoom
    scale: 1,
    minScale: 0.2,
    maxScale: 3.5,
    scaleStep: 0.1,

    // Drag states
    activeShape: null,
    dragState: null,
    connDrag: null,
    pendingConn: null,

    // Undo
    undoStack: [],
    redoStack: [],
    MAX_UNDO: 30,

    // schedulers
    _refreshRaf: 0,
  };

  const ROUTE_MODES = core?.ROUTE_MODES ? [...core.ROUTE_MODES] : ['auto', 'vertical', 'horizontal'];
  const ROUTE_MODE_LABELS = {
    auto: 'Авто',
    vertical: 'Вертикально',
    horizontal: 'Горизонтально',
  };
  ROUTE_MODE_LABELS['bypass-left'] = ROUTE_MODE_LABELS['bypass-left'] || 'Обхід ліворуч';
  ROUTE_MODE_LABELS['bypass-right'] = ROUTE_MODE_LABELS['bypass-right'] || 'Обхід праворуч';
  const MERGE_LEAD = 34;
  const GRID_SIZE = 20;
  const AUTOSAVE_STORAGE_KEY = 'flowchart-designer-2-autosave';

  const statusController = statusApi.createStatusController?.({ dirtyDotEl, savedBadgeEl }) || {};
  const setDirty = statusController.setDirty || (() => {});
  const flashSavedBadge = statusController.flashSavedBadge || (() => {});
  let saveSnapshot = () => {};
  let restoreSnapshot = () => {};
  let undo = () => {};
  let redo = () => {};
  let updateHistoryButtons = () => {};


  const openModal = UI.openModal || ((modal) => modal?.classList.add('active'));
  const closeModal = UI.closeModal || ((modal) => modal?.classList.remove('active'));

  const modalHelpers = modalsApi.createModalHelpers?.({ openModal, closeModal }) || {};
  const showMessageModal = modalHelpers.showMessageModal || (() => {});
  const showConfirmModal = modalHelpers.showConfirmModal || (() => {});
  const showRestoreDraftModal = modalHelpers.showRestoreDraftModal || (() => {});
  modalHelpers.bindBackdropClose?.();

  const rgbToHex = editorUtils.rgbToHex || (() => '#ffffff');
  const sanitizeFilename = editorUtils.sanitizeFilename || ((name) => (name || 'блок-схема').trim() || 'блок-схема');

  // ================= TITLE =================
  function findStartElement() {
    const startShape = state.shapes.find(s => s.type === 'start-end' && (s.textRaw || '').trim().toLowerCase() === 'початок');
    return startShape ? document.getElementById(startShape.id) : null;
  }

  const titleController = titleApi.createTitleController?.({
    titleInput,
    titleDisplay,
    fileNameEl,
    getTitle: () => state.diagramTitle,
    setTitle: (value) => { state.diagramTitle = value; },
    onChange: () => scheduleAutosave(),
  }) || {};
  const renderTitle = titleController.render || (() => {});
  const scheduleTitleUpdate = titleController.schedule || (() => {});
  titleController.bindInput?.();

  const autosave = autosaveApi.createAutosaveController?.({
    storageKey: AUTOSAVE_STORAGE_KEY,
    collectProjectData,
    parseProject: core?.parseProject,
    showRestoreDraftModal,
    onRestoreDraft: (project) => {
      restoreSnapshot(project);
      setDirty(false);
      showMessageModal('Чернетку відкрито.');
    },
    onDiscardDraft: () => setDirty(false),
  }) || {};
  const persistAutosave = autosave.persist || (() => {});
  const scheduleAutosave = autosave.schedule || (() => {});
  const promptRestoreAutosave = autosave.promptRestore || (() => {});

  // ================= TEXT WRAP =================
  const smartWrapText = (raw, type) => editorUtils.smartWrapText?.(raw, type, core) || '';

  function hasStartBlock() {
    return state.shapes.some(s => s.type === 'start-end' && (s.textRaw || '').trim().toLowerCase() === 'початок');
  }

  function getDefaultText(type) {
    if (core?.getDefaultText) return core.getDefaultText(type, state.shapes);
    switch (type) {
      case 'start-end': return hasStartBlock() ? 'Кінець' : 'Початок';
      case 'process': return 'Дія';
      case 'decision': return 'Умова?';
      case 'input-output': return 'Ввід / Вивід';
      default: return '';
    }
  }

  const colorController = colorsApi.createColorController?.({
    state,
    defaultBaseColors: DEFAULT_BASE_COLORS,
    colorButtons: Array.from(document.querySelectorAll('.color-option')),
    saveSnapshot: (...args) => saveSnapshot(...args),
    scheduleRefresh,
  }) || {};
  const getBaseColor = colorController.getBaseColor || ((type) => state.baseColors[type] || DEFAULT_BASE_COLORS[type] || '#3f51b5');
  const syncColorPickerToCurrent = colorController.syncColorPickerToCurrent || (() => {});
  const applyColor = colorController.applyColor || (() => {});
  colorController.bind?.();

  const shapeText = shapeTextApi.createShapeTextController?.({
    state,
    textModal,
    shapeTextArea,
    cancelButton: cancelText,
    saveButton: saveText,
    openModal,
    closeModal,
    saveSnapshot: (...args) => saveSnapshot(...args),
    scheduleRefresh,
    smartWrapText,
    getDefaultText,
  }) || {};
  const setShapeText = shapeText.setShapeText || (() => {});
  const openTextModal = shapeText.openTextModal || (() => {});
  shapeText.bind?.();

  // ================= COORDINATES =================
  function clientToCanvas(clientX, clientY) {
    const r = canvas.getBoundingClientRect();
    return { x: (clientX - r.left) / state.scale, y: (clientY - r.top) / state.scale };
  }

  function snapToGrid(value) {
    if (!state.snapEnabled) return value;
    return Math.round(value / GRID_SIZE) * GRID_SIZE;
  }

  // ================= HANDLES (SVG) =================
  const DECISION_HANDLE_OUTSET = 8; // px: handles sit slightly outside the diamond
  const DECISION_CONN_OUTSET = 2; // px: keep endpoints close to diamond border

  const shapeGeometry = shapeGeometryApi.createShapeGeometry?.({
    core,
    state,
    decisionHandleOutset: DECISION_HANDLE_OUTSET,
    decisionConnOutset: DECISION_CONN_OUTSET,
  }) || {};
  const decisionVertexDistance = shapeGeometry.decisionVertexDistance || (() => 0);
  const domShapeToBox = shapeGeometry.domShapeToBox || (() => ({ left: 0, top: 0, width: 0, height: 0, type: 'process' }));
  const findShapeAt = shapeGeometry.findShapeAt || (() => null);
  const getHandlePositions = shapeGeometry.getHandlePositions || (() => ({}));

  const handles = handlesApi.createHandlesController?.({
    svgLayer,
    state,
    getHandlePositions,
    clientToCanvas,
    findShapeAt,
    getShapeData: (shapeId) => state.shapes.find(shape => shape.id === shapeId),
    onDecisionConnect: ({ fromEl, toEl }) => {
      state.pendingConn = { fromEl, toEl };
      openModal(connectionModal);
    },
    onDirectConnect: ({ fromEl, toEl }) => {
      saveSnapshot();
      connectShapes(fromEl, toEl, null);
    },
  }) || {};
  const createHandleGroup = handles.createHandleGroup || (() => null);
  const hideAllHandles = handles.hideAllHandles || (() => {});
  const removeHandleGroup = handles.removeHandleGroup || (() => {});
  const showHandlesForShape = handles.showHandlesForShape || (() => {});
  const updateAllHandleGroups = handles.updateAllHandleGroups || (() => {});
  const updateHandleGroup = handles.updateHandleGroup || (() => {});

  // ================= CONNECTIONS (orthogonal) =================
  const routing = routingApi.createRouting?.({
    core,
    state,
    routeModes: ROUTE_MODES,
    mergeLead: MERGE_LEAD,
    decisionConnOutset: DECISION_CONN_OUTSET,
    domShapeToBox,
    decisionVertexDistance,
  }) || {};
  const buildMergeContext = routing.buildMergeContext || (() => ({}));
  const computeConnectionGeometry = routing.computeConnectionGeometry || (() => ({ d: '', pts: [] }));
  const pointAlongPolyline = routing.pointAlongPolyline || ((points) => points?.[0] || { x: 0, y: 0 });

  const connectionsDom = connectionsDomApi.createConnectionsDom?.({
    core,
    state,
    svgLayer,
    routeModes: ROUTE_MODES,
    buildMergeContext,
    computeConnectionGeometry,
    pointAlongPolyline,
    onSelectConnection: (connId) => selectConnection(connId),
    onDuplicateConnection: () => showMessageModal('Ці фігури вже з\'єднані!'),
  }) || {};
  const removeConnectionDom = connectionsDom.removeConnectionDom || (() => {});
  const updateConnection = connectionsDom.updateConnection || (() => {});
  const updateConnectionsForShape = connectionsDom.updateConnectionsForShape || (() => {});
  const connectShapes = connectionsDom.connectShapes || (() => null);

  let clearConnectionSelection = (updateBar = true) => {
    state.selectedConnId = null;
    if (updateBar) updateConnectionBar();
  };
  let selectConnection = () => {};
  let updateConnectionBar = () => {};
  let cycleSelectedConnectionRouteMode = () => {};
  let selectShape = () => {};
  let deselectAll = () => {};

  // ================= SELECT CONNECTION =================
  const connectionSelection = connectionSelectionApi.createConnectionSelectionController?.({
    state,
    routeModes: ROUTE_MODES,
    routeModeLabels: ROUTE_MODE_LABELS,
    selectionStateEl,
    routeButton: routeConnBtn,
    labelButton: editConnLabelBtn,
    editShapeButton: editShapeBtn,
    deleteButton: toolbarDeleteBtn,
    saveSnapshot: (...args) => saveSnapshot(...args),
    updateConnection,
    deselectAll: (...args) => deselectAll(...args),
    hideAllHandles,
    openModal,
    closeModal,
  }) || {};
  clearConnectionSelection = connectionSelection.clearConnectionSelection || clearConnectionSelection;
  selectConnection = connectionSelection.selectConnection || selectConnection;
  updateConnectionBar = connectionSelection.updateConnectionBar || updateConnectionBar;
  cycleSelectedConnectionRouteMode = connectionSelection.cycleSelectedConnectionRouteMode || cycleSelectedConnectionRouteMode;

  function deleteConnection(connId) {
    const conn = state.connections.find(c => c.id === connId);
    if (!conn) return;
    saveSnapshot();
    removeConnectionDom(connId);
    state.connections = state.connections.filter(c => c.id !== connId);
    clearConnectionSelection();
  }

  // ================= SHAPES =================
  const shapePlacement = shapePlacementApi.createShapePlacement?.({ state, snapToGrid }) || {};
  const getShapeSizeHint = shapePlacement.getShapeSizeHint || (() => ({ w: 150, h: 84 }));
  const resolveShapePosition = shapePlacement.resolveShapePosition || (() => ({ left: 20, top: 20 }));

  const shapeInteractions = shapeInteractionsApi.createShapeInteractionsController?.({
    state,
    onShapePointerDown,
    openTextModal,
    clearConnectionSelection: (...args) => clearConnectionSelection(...args),
    selectShape: (...args) => selectShape(...args),
    showHandlesForShape,
    hideAllHandles,
    deleteSelected: (...args) => deleteSelected(...args),
  }) || {};
  const bindShapeInteractions = shapeInteractions.bindShape || ((shape) => {
    shape?.addEventListener('pointerdown', onShapePointerDown);
  });

  const shapeFactory = shapeFactoryApi.createShapeFactory?.({
    state,
    canvas,
    canvasContainer,
    getBaseColor,
    getDefaultText,
    resolveShapePosition,
    setShapeText,
    bindShapeInteractions,
    createHandleGroup,
    scheduleRefresh,
  }) || {};
  const createShape = shapeFactory.createShape || (() => null);

  const history = historyApi.createHistoryController?.({
    state,
    undoButton,
    redoButton,
    defaultBaseColors: DEFAULT_BASE_COLORS,
    removeHandleGroup,
    removeConnectionDom,
    createShape,
    connectShapes,
    scheduleRefresh,
    updateConnectionBar: (...args) => updateConnectionBar(...args),
    syncColorPickerToCurrent,
    scheduleAutosave,
    setDirty,
    cancelTitleUpdate: () => titleController.cancel?.(),
    syncTitleInput: () => titleController.syncInput?.(),
    renderTitle,
    updateSnapButton,
  }) || {};
  saveSnapshot = history.saveSnapshot || saveSnapshot;
  restoreSnapshot = history.restoreSnapshot || restoreSnapshot;
  undo = history.undo || undo;
  redo = history.redo || redo;
  updateHistoryButtons = history.updateHistoryButtons || updateHistoryButtons;
  history.bind?.();

  const shapeSelection = shapeSelectionApi.createShapeSelectionController?.({
    state,
    clearConnectionSelection: (...args) => clearConnectionSelection(...args),
    showHandlesForShape,
    hideAllHandles,
    rgbToHex,
    syncColorPickerToCurrent,
    updateConnectionBar: (...args) => updateConnectionBar(...args),
  }) || {};
  selectShape = shapeSelection.selectShape || selectShape;
  deselectAll = shapeSelection.deselectAll || deselectAll;

  // ================= DRAG SHAPES =================
  function onShapePointerDown(e) {
    if (e.target.classList.contains('conn-handle')) return;
    if (e.button === 2) return;
    e.stopPropagation();

    clearConnectionSelection();
    selectShape(this);

    if (e.detail >= 2) return;

    const el = this;
    const pt = clientToCanvas(e.clientX, e.clientY);
    let moved = false;
    let snapshotTaken = false;

    state.dragState = { el, offsetX: pt.x - el.offsetLeft, offsetY: pt.y - el.offsetTop };
    el.setPointerCapture(e.pointerId);
    el.style.cursor = 'grabbing';

    const onMove = (ev) => {
      if (!state.dragState) return;
      const pt2 = clientToCanvas(ev.clientX, ev.clientY);
      if (!moved) {
        const delta = Math.hypot(ev.clientX - e.clientX, ev.clientY - e.clientY);
        if (delta < 3) return;
        moved = true;
      }
      if (!snapshotTaken) {
        saveSnapshot();
        snapshotTaken = true;
      }
      const rawX = Math.max(0, pt2.x - state.dragState.offsetX);
      const rawY = Math.max(0, pt2.y - state.dragState.offsetY);
      const newX = snapToGrid(rawX);
      const newY = snapToGrid(rawY);
      el.style.left = newX + 'px';
      el.style.top = newY + 'px';
      updateConnectionsForShape(el.id);
      updateHandleGroup(el.id);
      scheduleTitleUpdate();
    };

    const onUp = () => {
      el.style.cursor = 'move';
      state.dragState = null;
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerup', onUp);
      el.removeEventListener('pointercancel', onUp);
      scheduleRefresh();
    };

    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerup', onUp);
    el.addEventListener('pointercancel', onUp);
    e.preventDefault();
  }

  // ================= VIEWPORT =================
  const viewport = viewportApi.createViewportController?.({
    state,
    canvas,
    canvasContainer,
    svgLayer,
    zoomInBtn,
    zoomOutBtn,
    zoomResetBtn,
    zoomLevelText,
    scheduleRefresh,
    deselectAll,
    clearConnectionSelection,
    updateConnectionBar,
  }) || {};
  const setZoom = viewport.setZoom || (() => {});
  const isOnBackground = viewport.isOnBackground || ((target) => target === canvas || target === canvasContainer || target === svgLayer);
  viewport.bind?.();

  // ================= FLOW ACTIONS =================
  const flowActions = flowActionsApi.createFlowActionsController?.({
    state,
    snapToggleButton,
    shapeButtons: document.querySelectorAll('.shape-button'),
    connectionModal,
    connectionYesBtn,
    connectionNoBtn,
    cancelConnBtn,
    saveSnapshot: (...args) => saveSnapshot(...args),
    createShape,
    getBaseColor,
    selectShape: (...args) => selectShape(...args),
    connectShapes,
    scheduleRefresh,
    closeModal,
  }) || {};
  updateSnapButton = flowActions.updateSnapButton || updateSnapButton;
  flowActions.bind?.();

  // ================= DELETE / CLEAR =================
  const shapeDeletion = shapeDeletionApi.createShapeDeletionController?.({
    state,
    clearButton,
    saveSnapshot,
    removeConnectionDom,
    removeHandleGroup,
    deselectAll,
    clearConnectionSelection,
    updateConnectionBar,
    scheduleRefresh,
    getDefaultText,
    showConfirmModal,
    hideAllHandles,
    updateHistoryButtons,
    deleteConnection,
  }) || {};
  const deleteSelected = shapeDeletion.deleteSelected || (() => {});

  editShapeBtn?.addEventListener('click', () => {
    if (state.selectedShape) openTextModal(state.selectedShape);
  });
  toolbarDeleteBtn?.addEventListener('click', deleteSelected);

  // ================= SAVE AS IMAGE =================
  function computeShapesBounds() {
    if (state.shapes.length === 0) {
      return { minX: 0, minY: 0, maxX: 0, maxY: 0, empty: true };
    }
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;

    state.shapes.forEach(s => {
      const el = document.getElementById(s.id);
      if (!el) return;
      const left = el.offsetLeft;
      const top = el.offsetTop;
      const w = el.offsetWidth;
      const h = el.offsetHeight;
      const cx = left + w / 2;
      const cy = top + h / 2;

      if (s.type === 'decision') {
        const d = decisionVertexDistance(el);
        minX = Math.min(minX, cx - d);
        minY = Math.min(minY, cy - d);
        maxX = Math.max(maxX, cx + d);
        maxY = Math.max(maxY, cy + d);
      } else if (s.type === 'input-output') {
        const skewOffset = Math.abs(Math.tan(20 * Math.PI / 180) * h / 2);
        minX = Math.min(minX, left - skewOffset);
        minY = Math.min(minY, top);
        maxX = Math.max(maxX, left + w + skewOffset);
        maxY = Math.max(maxY, top + h);
      } else {
        minX = Math.min(minX, left);
        minY = Math.min(minY, top);
        maxX = Math.max(maxX, left + w);
        maxY = Math.max(maxY, top + h);
      }
    });

    if (titleDisplay && titleDisplay.style.display !== 'none' && titleDisplay.textContent.trim()) {
      const tLeft = titleDisplay.offsetLeft - titleDisplay.offsetWidth / 2;
      const tTop = titleDisplay.offsetTop;
      minX = Math.min(minX, tLeft);
      minY = Math.min(minY, tTop);
      maxX = Math.max(maxX, tLeft + titleDisplay.offsetWidth);
      maxY = Math.max(maxY, tTop + titleDisplay.offsetHeight);
    }

    return { minX, minY, maxX, maxY, empty: false };
  }

  function collectProjectData() {
    const positionsById = {};
    state.shapes.forEach((shape) => {
      const el = document.getElementById(shape.id);
      positionsById[shape.id] = {
        left: el ? el.offsetLeft : 0,
        top: el ? el.offsetTop : 0,
      };
    });

    if (core?.serializeProject) {
      return core.serializeProject(state, positionsById);
    }

    return {
      version: 2,
      diagramTitle: state.diagramTitle,
      shapeCounter: state.shapeCounter,
      lastShapeType: state.lastShapeType,
      baseColors: { ...state.baseColors },
      shapes: state.shapes.map((shape) => ({ ...shape, ...positionsById[shape.id] })),
      connections: state.connections.map((conn) => ({ ...conn, label: conn.label ?? null })),
    };
  }

  const projectBridge = projectIo?.createProjectBridge?.({
    core,
    state,
    projectFileInput,
    canvas,
    canvasContainer,
    titleDisplay,
    saveTitleModal,
    saveTitleInput,
    saveWithTitleBtn,
    saveWithoutTitleBtn,
    closeSaveTitleBtn,
    titleInput,
    saveButton,
    newProjectButton,
    saveProjectButton,
    openProjectButton,
    clearButton,
    collectProjectData,
    saveSnapshot,
    restoreSnapshot,
    setDirty,
    flashSavedBadge,
    showMessageModal,
    sanitizeFilename,
    computeShapesBounds,
    clearConnectionSelection,
    hideAllHandles,
    updateConnectionBar,
    setZoom,
    scheduleRefresh,
    openModal,
    closeModal,
    renderTitle,
  });

  const downloadProjectJson = projectBridge?.downloadProjectJson || function noopDownloadProjectJson() {};
  const getImportErrorMessage = projectBridge?.getImportErrorMessage || function defaultGetImportErrorMessage() {
    return 'Не вдалося відкрити проєкт. Перевір JSON-файл.';
  };
  const importProjectData = projectBridge?.importProjectData || function noopImportProjectData() {};
  const openProjectFilePicker = projectBridge?.openProjectFilePicker || function fallbackOpenProjectFilePicker() {
    if (window.OfficeShell?.openFilePicker?.(projectFileInput)) return;
    projectFileInput.value = '';
    projectFileInput.click();
  };
  const runOfficeCommand = projectBridge?.runOfficeCommand || function fallbackRunOfficeCommand(command) {
    return window.OfficeShell?.runCommand?.(command) || false;
  };
  const registerShellCommands = projectBridge?.registerShellCommands || function fallbackRegisterShellCommands(commandMap) {
    return window.OfficeShell?.registerCommands?.('flowcharts', commandMap) ||
      window.OfficeUI?.registerCommands?.(commandMap, { source: 'flowcharts' });
  };
  const exportPng = projectBridge?.exportPng || (async function noopExportPng() {});
  const openSaveTitlePrompt = projectBridge?.openSaveTitlePrompt || function fallbackOpenSaveTitlePrompt() {
    exportPng();
  };

  projectBridge?.bindProjectControls?.();

  // ================= MENUS / HELP =================
  const menuActions = menuActionsApi.createMenuActionsController?.({
    UI,
    helpPanel,
    helpButton,
    helpClose,
    clearButton,
    openProjectButton,
    saveProjectButton,
    saveButton,
    snapToggleButton,
    runOfficeCommand,
    undo,
    redo,
    deleteSelected,
    setZoom,
    showMessageModal,
  }) || {};
  const toggleHelp = menuActions.toggleHelp || (() => {});
  const menuApi = menuActions.bind?.() || null;
  updateSnapButton();
  updateFloatingBarOffset();
  titleController.bindHeaderFocus?.();

  // ================= GLOBAL SHORTCUTS =================
  keyboardApi.createKeyboardShortcutsController?.({
    state,
    runOfficeCommand,
    undo,
    redo,
    downloadProjectJson,
    openProjectFilePicker,
    openSaveTitlePrompt,
    cycleSelectedConnectionRouteMode,
    snapToggleButton,
    closeMenus,
    helpPanel,
    toggleHelp,
    closeModal,
    textModal,
    connectionModal,
    saveTitleModal,
    deleteSelected,
  })?.bind?.();

  // ================= REFRESH LAYOUT =================
  function refreshAll() {
    state._refreshRaf = 0;
    state.connections.forEach(c => updateConnection(c.id));
    updateAllHandleGroups();
    scheduleTitleUpdate();
  }
  function scheduleRefresh() {
    if (state._refreshRaf) return;
    state._refreshRaf = requestAnimationFrame(refreshAll);
  }
  window.addEventListener('resize', () => {
    updateFloatingBarOffset();
    scheduleRefresh();
  });

  // ================= INIT UI =================
  syncColorPickerToCurrent(state.currentColor);
  renderTitle();
  setDirty(false);
  window.addEventListener('beforeunload', persistAutosave);
  registerShellCommands({
    new: () => clearButton?.click(),
    open: openProjectFilePicker,
    save: downloadProjectJson,
    undo: undo,
    redo: redo
  });
  promptRestoreAutosave();

};
