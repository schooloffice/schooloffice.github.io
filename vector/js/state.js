'use strict';

window.ArtVector = window.ArtVector || {};

(() => {
  const { constants } = window.ArtVector;

  window.ArtVector.state = {
    fileName: constants.DEFAULT_FILE_NAME,
    canvasWidth: constants.DEFAULT_CANVAS_WIDTH,
    canvasHeight: constants.DEFAULT_CANVAS_HEIGHT,
    zoom: 1,
    guideMode: 'grid',
    snapToGrid: true,

    currentTool: 'select',
    currentColorTarget: 'stroke',
    currentStroke: '#1f2937',
    currentFill: 'none',
    currentStrokeWidth: 3,
    currentOpacity: 100,
    currentFontSize: 32,

    objects: [],
    selectedObjectId: null,
    draftObject: null,
    interaction: null,
    clipboard: null,

    undoStack: [],
    redoStack: [],
    unsavedChanges: false,
    suppressAutosave: false,

    pointer: { x: 0, y: 0 }
  };
})();
