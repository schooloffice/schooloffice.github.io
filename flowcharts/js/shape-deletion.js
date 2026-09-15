(function () {
  'use strict';

  function createShapeDeletionController(options) {
    const {
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
      getSelectedShapes,
    } = options || {};

    function connectionWord(count) {
      return count === 1 ? "з'єднання" : "з'єднань";
    }

    // Кілька вибраних блоків і їхні стрілки видаляються одним кроком undo.
    function performShapesDeletion(shapeEls) {
      const els = (shapeEls || []).filter(Boolean);
      if (!els.length) return;
      const ids = new Set(els.map((el) => el.id));
      saveSnapshot?.();

      const toRemove = state.connections.filter((conn) => ids.has(conn.from) || ids.has(conn.to)).map((conn) => conn.id);
      toRemove.forEach((id) => removeConnectionDom?.(id));
      state.connections = state.connections.filter((conn) => !ids.has(conn.from) && !ids.has(conn.to));

      ids.forEach((shapeId) => {
        document.getElementById(shapeId)?.remove();
        removeHandleGroup?.(shapeId);
      });
      state.shapes = state.shapes.filter((shape) => !ids.has(shape.id));

      deselectAll?.(false);
      clearConnectionSelection?.(false);
      updateConnectionBar?.();
      scheduleRefresh?.();
    }

    function performShapeDeletion(shapeEl) {
      performShapesDeletion(shapeEl ? [shapeEl] : []);
    }

    function shouldConfirmShapeDeletion(shapeEl) {
      if (!shapeEl) return false;
      const hasConnections = state.connections.some((conn) => conn.from === shapeEl.id || conn.to === shapeEl.id);
      const shapeData = state.shapes.find((shape) => shape.id === shapeEl.id);
      const text = String(shapeData?.textRaw || '').trim();
      const defaultText = String(getDefaultText?.(shapeData?.type, state.shapes) || '').trim();
      const hasMeaningfulCustomText = !!text && text !== defaultText;
      return hasConnections || hasMeaningfulCustomText;
    }

    function selectedShapeElements() {
      const list = typeof getSelectedShapes === 'function' ? getSelectedShapes() : [];
      if (list.length) return list;
      return state.selectedShape ? [state.selectedShape] : [];
    }

    function deleteSelected() {
      if (state.selectedConnId) {
        deleteConnection?.(state.selectedConnId);
        return;
      }
      const shapeEls = selectedShapeElements();
      if (!shapeEls.length) return;

      if (shapeEls.length > 1) {
        const ids = new Set(shapeEls.map((el) => el.id));
        const linkedCount = state.connections.filter((conn) => ids.has(conn.from) || ids.has(conn.to)).length;
        const detail = linkedCount > 0 ? ` Буде також видалено ${linkedCount} ${connectionWord(linkedCount)}.` : '';
        showConfirmModal?.(`Видалити вибрані блоки (${shapeEls.length})?${detail}`, () => performShapesDeletion(shapeEls), 'Видалити');
        return;
      }

      const shapeEl = shapeEls[0];
      if (!shouldConfirmShapeDeletion(shapeEl)) {
        performShapeDeletion(shapeEl);
        return;
      }

      const linkedCount = state.connections.filter((conn) => conn.from === shapeEl.id || conn.to === shapeEl.id).length;
      const shapeData = state.shapes.find((shape) => shape.id === shapeEl.id);
      const text = String(shapeData?.textRaw || '').trim();
      const detail = linkedCount > 0
        ? ` Буде також видалено ${linkedCount} ${connectionWord(linkedCount)}.`
        : '';
      const label = text ? ` «${text.slice(0, 40)}${text.length > 40 ? '…' : ''}»` : '';
      showConfirmModal?.(`Видалити блок${label}?${detail}`, () => performShapeDeletion(shapeEl), 'Видалити');
    }

    function clearCanvas() {
      saveSnapshot?.();
      state.shapes.forEach((shape) => {
        document.getElementById(shape.id)?.remove();
        removeHandleGroup?.(shape.id);
      });
      state.connections.forEach((conn) => removeConnectionDom?.(conn.id));

      state.shapes = [];
      state.connections = [];
      state.selectedShape = null;
      state.selectedShapes = [];
      state.selectedConnId = null;
      state.shapeCounter = 0;
      state.redoStack = [];
      hideAllHandles?.();
      updateHistoryButtons?.();
      updateConnectionBar?.();
      scheduleRefresh?.();
    }

    clearButton?.addEventListener('click', () => {
      showConfirmModal?.('Очистити все полотно?', clearCanvas);
    });

    return {
      performShapeDeletion,
      performShapesDeletion,
      shouldConfirmShapeDeletion,
      deleteSelected,
      clearCanvas,
    };
  }

  window.FlowchartsShapeDeletion = {
    createShapeDeletionController,
  };
})();
