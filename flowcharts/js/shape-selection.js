(function () {
  'use strict';

  function createShapeSelectionController(options) {
    const {
      state,
      clearConnectionSelection,
      showHandlesForShape,
      hideAllHandles,
      rgbToHex,
      syncColorPickerToCurrent,
      updateConnectionBar,
    } = options || {};

    function selectShape(el) {
      if (!el || !state) return;
      clearConnectionSelection?.(false);
      if (state.selectedShape && state.selectedShape !== el) {
        state.selectedShape.classList.remove('selected');
        state.selectedShape.setAttribute('aria-selected', 'false');
      }
      state.selectedShape = el;
      el.classList.add('selected');
      el.setAttribute('aria-selected', 'true');
      showHandlesForShape?.(el.id);

      const hex = rgbToHex?.(el.style.backgroundColor) || state.currentColor || '';
      state.currentColor = hex;
      syncColorPickerToCurrent?.(hex);
      updateConnectionBar?.();
    }

    function deselectAll(updateBar = true) {
      if (state?.selectedShape) {
        state.selectedShape.classList.remove('selected');
        state.selectedShape.setAttribute('aria-selected', 'false');
        state.selectedShape = null;
      }
      hideAllHandles?.();
      if (updateBar) updateConnectionBar?.();
    }

    return {
      selectShape,
      deselectAll,
    };
  }

  window.FlowchartsShapeSelection = {
    createShapeSelectionController,
  };
})();
