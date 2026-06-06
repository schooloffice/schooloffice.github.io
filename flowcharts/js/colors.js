(function () {
  'use strict';

  function createColorController(options) {
    const {
      state,
      defaultBaseColors,
      colorButtons,
      saveSnapshot,
      scheduleRefresh,
    } = options || {};

    const defaults = defaultBaseColors || {};
    const buttons = Array.isArray(colorButtons) ? colorButtons : [];

    function getBaseColor(type) {
      return state.baseColors[type] || defaults[type] || '#3f51b5';
    }

    function syncColorPickerToCurrent(forcedHex) {
      const hex = (forcedHex || state.currentColor || '').toLowerCase();
      buttons.forEach((button) => {
        const color = (button.dataset.color || '').toLowerCase();
        button.classList.toggle('selected', color === hex);
      });
    }

    function applyColor(hex) {
      if (!hex) return;
      state.currentColor = hex;
      syncColorPickerToCurrent(hex);

      if (state.selectedShape) {
        saveSnapshot?.();
        state.selectedShape.style.backgroundColor = hex;
        const shape = state.shapes.find((item) => item.id === state.selectedShape.id);
        if (shape) {
          shape.color = hex;
          state.baseColors[shape.type] = hex;
        }
        scheduleRefresh?.();
        return;
      }

      if (state.baseColors[state.lastShapeType] !== hex) saveSnapshot?.();
      state.baseColors[state.lastShapeType] = hex;
    }

    function bind() {
      buttons.forEach((button) => {
        button.addEventListener('click', () => applyColor(button.dataset.color));
      });
    }

    return {
      getBaseColor,
      syncColorPickerToCurrent,
      applyColor,
      bind,
    };
  }

  window.FlowchartsColors = {
    createColorController,
  };
})();
