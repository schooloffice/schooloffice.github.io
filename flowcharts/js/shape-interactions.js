(function () {
  'use strict';

  function createShapeInteractionsController(options) {
    const {
      state,
      onShapePointerDown,
      openTextModal,
      clearConnectionSelection,
      selectShape,
      showHandlesForShape,
      hideAllHandles,
      deleteSelected,
    } = options || {};

    function bindShape(shape) {
      if (!shape) return;

      shape.addEventListener('pointerdown', onShapePointerDown);

      shape.addEventListener('dblclick', (event) => {
        event.stopPropagation();
        openTextModal?.(shape);
      });

      let longPressTimer = null;
      let longPressPointerId = null;
      shape.addEventListener('pointerdown', (event) => {
        if (longPressTimer) clearTimeout(longPressTimer);
        longPressPointerId = event.pointerId;
        longPressTimer = setTimeout(() => {
          longPressTimer = null;
          longPressPointerId = null;
          openTextModal?.(shape);
        }, 650);
      });

      const cancelLongPress = (event) => {
        if (longPressPointerId !== null && event?.pointerId !== undefined && event.pointerId !== longPressPointerId) return;
        if (longPressTimer) clearTimeout(longPressTimer);
        longPressTimer = null;
        longPressPointerId = null;
      };
      shape.addEventListener('pointerup', cancelLongPress);
      shape.addEventListener('pointercancel', cancelLongPress);
      shape.addEventListener('pointermove', cancelLongPress);

      shape.addEventListener('click', (event) => {
        event.stopPropagation();
        clearConnectionSelection?.();
        selectShape?.(shape);
      });

      shape.addEventListener('pointerenter', () => {
        if (!state?.connDrag) showHandlesForShape?.(shape.id);
      });
      shape.addEventListener('pointerleave', () => {
        if (state?.connDrag) return;
        if (state?.selectedShape && state.selectedShape !== shape) {
          showHandlesForShape?.(state.selectedShape.id);
        } else if (!state?.selectedShape) {
          hideAllHandles?.();
        }
      });

      shape.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          openTextModal?.(shape);
        }
        if (event.key === 'Delete' || event.key === 'Backspace') {
          event.preventDefault();
          deleteSelected?.();
        }
      });
    }

    return {
      bindShape,
    };
  }

  window.FlowchartsShapeInteractions = {
    createShapeInteractionsController,
  };
})();
