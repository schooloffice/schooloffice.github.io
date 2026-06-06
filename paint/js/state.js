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

    canvasWidth: 0,
    canvasHeight: 0,
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
