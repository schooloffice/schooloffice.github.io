(function () {
  'use strict';

  function createFlowActionsController(options) {
    const {
      state,
      snapToggleButton,
      shapeButtons,
      connectionModal,
      connectionYesBtn,
      connectionNoBtn,
      cancelConnBtn,
      saveSnapshot,
      createShape,
      getBaseColor,
      selectShape,
      connectShapes,
      scheduleRefresh,
      closeModal,
    } = options || {};

    function updateSnapButton() {
      const active = !!state?.snapEnabled;
      snapToggleButton?.setAttribute('aria-pressed', String(active));
      snapToggleButton?.classList.toggle('is-active', active);
      if (snapToggleButton) {
        snapToggleButton.title = active
          ? 'Прив\'язка до сітки увімкнена (G)'
          : 'Прив\'язка до сітки вимкнена (G)';
      }
      document.querySelector('.menu-item[data-action="toggle-grid"]')?.classList.toggle('checked', active);
    }

    function addShape(type) {
      if (!type || !state) return null;
      state.lastShapeType = type;
      saveSnapshot?.();
      const newEl = createShape?.(type);
      if (!newEl) return null;

      const base = getBaseColor?.(type);
      if (base) newEl.style.backgroundColor = base;
      const shape = state.shapes.find((item) => item.id === newEl.id);
      if (shape && base) shape.color = base;
      selectShape?.(newEl);
      return newEl;
    }

    function finishDecisionConnection(kind) {
      if (!state?.pendingConn) return;
      const { fromEl, toEl } = state.pendingConn;
      state.pendingConn = null;
      closeModal?.(connectionModal);
      saveSnapshot?.();
      connectShapes?.(fromEl, toEl, kind);
      scheduleRefresh?.();
    }

    function cancelDecisionConnection() {
      if (state) state.pendingConn = null;
      closeModal?.(connectionModal);
    }

    function bind() {
      snapToggleButton?.addEventListener('click', () => {
        state.snapEnabled = !state.snapEnabled;
        updateSnapButton();
      });

      Array.from(shapeButtons || []).forEach((button) => {
        button.addEventListener('click', () => addShape(button.dataset.shape));
      });

      connectionYesBtn?.addEventListener('click', () => finishDecisionConnection('yes'));
      connectionNoBtn?.addEventListener('click', () => finishDecisionConnection('no'));
      cancelConnBtn?.addEventListener('click', cancelDecisionConnection);
      connectionModal?.addEventListener('pointerdown', (event) => {
        if (event.target === connectionModal) cancelDecisionConnection();
      });
    }

    return {
      updateSnapButton,
      addShape,
      finishDecisionConnection,
      cancelDecisionConnection,
      bind,
    };
  }

  window.FlowchartsFlowActions = {
    createFlowActionsController,
  };
})();
