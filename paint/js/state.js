'use strict';

window.ArtMalyunky = window.ArtMalyunky || {};

(() => {
  const { constants } = window.ArtMalyunky;

  window.ArtMalyunky.state = {
    fileName: constants.DEFAULT_FILE_NAME,
    currentTool: 'brush',
    currentBrush: 'pencil',
    currentShape: 'line',
    currentStamp: constants.DEFAULT_STAMP,
    currentColor: constants.DEFAULT_COLOR,
    currentSize: constants.DEFAULT_SIZE,
    currentOpacity: constants.DEFAULT_OPACITY,
    guideMode: constants.DEFAULT_GUIDE,

    document: {
      version: 1,
      width: constants.DEFAULT_DOC_WIDTH,
      height: constants.DEFAULT_DOC_HEIGHT,
      background: constants.DEFAULT_BACKGROUND,
      transparent: false
    },
    viewport: {
      zoom: 1,
      fitMode: 'fit',
      panX: 0,
      panY: 0
    },

    // Дзеркала document.width/height для зворотної сумісності зі старим кодом.
    canvasWidth: constants.DEFAULT_DOC_WIDTH,
    canvasHeight: constants.DEFAULT_DOC_HEIGHT,
    isDrawing: false,
    lastX: 0,
    lastY: 0,
    startX: 0,
    startY: 0,
    lastPointer: { x: 0, y: 0 },
    pointerId: null,

    objects: [],
    selectedObjectId: null,
    pendingObject: null,
    objectInteraction: null,

    undoStack: [],
    redoStack: [],
    unsavedChanges: false,
    suppressAutosave: false
  };
})();
