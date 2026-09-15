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

    // Кілька вибраних блоків потрібні для вирівнювання, розподілу, кольору й видалення.
    // selectedShape лишається основним (останнім вибраним) блоком для дій над одним блоком:
    // тексту, синхронізації палітри й ручок з'єднання.
    function selectedList() {
      if (!state) return [];
      if (!Array.isArray(state.selectedShapes)) state.selectedShapes = [];
      state.selectedShapes = state.selectedShapes.filter((el) => el && el.isConnected);
      return state.selectedShapes;
    }

    function markShape(el, selected) {
      el.classList.toggle('selected', selected);
      el.setAttribute('aria-selected', selected ? 'true' : 'false');
    }

    function setPrimary(el) {
      state.selectedShape = el || null;
      if (!el) {
        hideAllHandles?.();
        return;
      }
      showHandlesForShape?.(el.id);
      const hex = rgbToHex?.(el.style.backgroundColor) || state.currentColor || '';
      state.currentColor = hex;
      syncColorPickerToCurrent?.(hex);
    }

    function selectShape(el) {
      if (!el || !state) return;
      clearConnectionSelection?.(false);
      selectedList().forEach((item) => {
        if (item !== el) markShape(item, false);
      });
      if (state.selectedShape && state.selectedShape !== el) markShape(state.selectedShape, false);
      state.selectedShapes = [el];
      markShape(el, true);
      setPrimary(el);
      updateConnectionBar?.();
    }

    // Shift/Ctrl/Cmd+клік: додає блок до вибору або прибирає його з вибору.
    function toggleShapeSelection(el) {
      if (!el || !state) return;
      clearConnectionSelection?.(false);
      const list = selectedList();
      if (state.selectedShape && !list.includes(state.selectedShape)) list.push(state.selectedShape);
      const index = list.indexOf(el);
      if (index >= 0) {
        list.splice(index, 1);
        markShape(el, false);
        setPrimary(list[list.length - 1] || null);
      } else {
        list.push(el);
        markShape(el, true);
        setPrimary(el);
      }
      updateConnectionBar?.();
    }

    function selectShapes(elements) {
      if (!state) return;
      const next = [...new Set((elements || []).filter(Boolean))];
      clearConnectionSelection?.(false);
      selectedList().forEach((item) => {
        if (!next.includes(item)) markShape(item, false);
      });
      if (state.selectedShape && !next.includes(state.selectedShape)) markShape(state.selectedShape, false);
      state.selectedShapes = next;
      next.forEach((el) => markShape(el, true));
      setPrimary(next[next.length - 1] || null);
      updateConnectionBar?.();
    }

    function getSelectedShapes() {
      const list = selectedList();
      if (state?.selectedShape && !list.includes(state.selectedShape)) return [...list, state.selectedShape];
      return [...list];
    }

    function deselectAll(updateBar = true) {
      if (state) {
        selectedList().forEach((item) => markShape(item, false));
        if (state.selectedShape) markShape(state.selectedShape, false);
        state.selectedShapes = [];
        state.selectedShape = null;
      }
      hideAllHandles?.();
      if (updateBar) updateConnectionBar?.();
    }

    return {
      selectShape,
      toggleShapeSelection,
      selectShapes,
      getSelectedShapes,
      deselectAll,
    };
  }

  window.FlowchartsShapeSelection = {
    createShapeSelectionController,
  };
})();
