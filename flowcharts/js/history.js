(function () {
  'use strict';

  function createHistoryController(options) {
    const {
      state,
      undoButton,
      redoButton,
      defaultBaseColors,
      removeHandleGroup,
      removeConnectionDom,
      createShape,
      connectShapes,
      scheduleRefresh,
      updateConnectionBar,
      syncColorPickerToCurrent,
      scheduleAutosave,
      setDirty,
      cancelTitleUpdate,
      syncTitleInput,
      renderTitle,
      updateSnapButton,
    } = options || {};

    const defaults = defaultBaseColors || {};

    function captureSnapshot() {
      const shapeSnap = state.shapes.map((shape) => {
        const el = document.getElementById(shape.id);
        return {
          id: shape.id,
          type: shape.type,
          color: shape.color,
          textRaw: shape.textRaw,
          left: el ? el.offsetLeft : 0,
          top: el ? el.offsetTop : 0,
        };
      });

      return {
        shapes: shapeSnap,
        connections: state.connections.map((conn) => ({ ...conn })),
        baseColors: { ...state.baseColors },
        diagramTitle: state.diagramTitle,
        shapeCounter: state.shapeCounter,
        lastShapeType: state.lastShapeType,
        snapEnabled: state.snapEnabled,
      };
    }

    function updateHistoryButtons() {
      if (undoButton) undoButton.disabled = state.undoStack.length === 0;
      if (redoButton) redoButton.disabled = state.redoStack.length === 0;
    }

    function saveSnapshot() {
      state.undoStack.push(captureSnapshot());
      if (state.undoStack.length > state.MAX_UNDO) state.undoStack.shift();
      state.redoStack = [];
      updateHistoryButtons();
      setDirty?.(true);
      scheduleAutosave?.();
    }

    function restoreSnapshot(snap) {
      state.shapes.forEach((shape) => {
        document.getElementById(shape.id)?.remove();
        removeHandleGroup?.(shape.id);
      });
      state.connections.forEach((conn) => removeConnectionDom?.(conn.id));

      state.shapes = [];
      state.connections = [];
      state.selectedShape = null;
      state.selectedConnId = null;
      state.activeShape = null;
      state.dragState = null;
      state.connDrag = null;
      state.pendingConn = null;
      cancelTitleUpdate?.();
      if (state._refreshRaf) cancelAnimationFrame(state._refreshRaf);
      state._refreshRaf = 0;

      state.baseColors = { ...defaults, ...(snap.baseColors || {}) };
      state.diagramTitle = snap.diagramTitle || '';
      state.shapeCounter = snap.shapeCounter || 0;
      state.lastShapeType = snap.lastShapeType || 'process';
      state.snapEnabled = snap.snapEnabled !== undefined ? !!snap.snapEnabled : true;

      syncTitleInput?.();
      renderTitle?.();
      updateSnapButton?.();

      (snap.shapes || []).forEach((shape) => {
        createShape?.(shape.type, shape.color, shape.textRaw, shape.left, shape.top, shape.id, true);
        const num = parseInt((shape.id || '').split('-')[1], 10);
        if (!Number.isNaN(num)) state.shapeCounter = Math.max(state.shapeCounter, num);
      });

      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          (snap.connections || []).forEach((conn) => {
            const fromEl = document.getElementById(conn.from);
            const toEl = document.getElementById(conn.to);
            if (fromEl && toEl) {
              connectShapes?.(fromEl, toEl, conn.type || null, conn.id, true, conn.routeMode || 'auto');
              const restoredConn = state.connections.find((item) => item.id === conn.id);
              if (restoredConn) restoredConn.label = conn.label ?? null;
            }
          });
          scheduleRefresh?.();
          updateConnectionBar?.();
          syncColorPickerToCurrent?.();
        });
      });

      updateHistoryButtons();
      scheduleAutosave?.();
    }

    function undo() {
      if (state.undoStack.length === 0) return;
      state.redoStack.push(captureSnapshot());
      if (state.redoStack.length > state.MAX_UNDO) state.redoStack.shift();
      restoreSnapshot(state.undoStack.pop());
    }

    function redo() {
      if (state.redoStack.length === 0) return;
      state.undoStack.push(captureSnapshot());
      if (state.undoStack.length > state.MAX_UNDO) state.undoStack.shift();
      restoreSnapshot(state.redoStack.pop());
    }

    function bind() {
      updateHistoryButtons();
      undoButton?.addEventListener('click', undo);
      redoButton?.addEventListener('click', redo);
    }

    return {
      captureSnapshot,
      updateHistoryButtons,
      saveSnapshot,
      restoreSnapshot,
      undo,
      redo,
      bind,
    };
  }

  window.FlowchartsHistory = {
    createHistoryController,
  };
})();
