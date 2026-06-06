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
    } = options || {};

    function performShapeDeletion(shapeEl) {
      if (!shapeEl) return;
      const shapeId = shapeEl.id;
      saveSnapshot?.();

      const toRemove = state.connections.filter((conn) => conn.from === shapeId || conn.to === shapeId).map((conn) => conn.id);
      toRemove.forEach((id) => removeConnectionDom?.(id));
      state.connections = state.connections.filter((conn) => conn.from !== shapeId && conn.to !== shapeId);

      document.getElementById(shapeId)?.remove();
      removeHandleGroup?.(shapeId);
      state.shapes = state.shapes.filter((shape) => shape.id !== shapeId);

      deselectAll?.(false);
      clearConnectionSelection?.(false);
      updateConnectionBar?.();
      scheduleRefresh?.();
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

    function deleteSelected() {
      if (state.selectedConnId) {
        deleteConnection?.(state.selectedConnId);
        return;
      }
      if (!state.selectedShape) return;

      const shapeEl = state.selectedShape;
      if (!shouldConfirmShapeDeletion(shapeEl)) {
        performShapeDeletion(shapeEl);
        return;
      }

      const linkedCount = state.connections.filter((conn) => conn.from === shapeEl.id || conn.to === shapeEl.id).length;
      const shapeData = state.shapes.find((shape) => shape.id === shapeEl.id);
      const text = String(shapeData?.textRaw || '').trim();
      const connectionWord = linkedCount === 1 ? "з'єднання" : "з'єднань";
      const detail = linkedCount > 0
        ? ` Буде також видалено ${linkedCount} ${connectionWord}.`
        : '';
      const label = text ? ` «${text.slice(0, 40)}${text.length > 40 ? '…' : ''}»` : '';
      showConfirmModal?.(`Видалити блок${label}?${detail}`, () => performShapeDeletion(shapeEl));
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
      shouldConfirmShapeDeletion,
      deleteSelected,
      clearCanvas,
    };
  }

  window.FlowchartsShapeDeletion = {
    createShapeDeletionController,
  };
})();
