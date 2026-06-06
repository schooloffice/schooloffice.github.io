(function () {
  'use strict';

  function createShapeTextController(options) {
    const {
      state,
      textModal,
      shapeTextArea,
      cancelButton,
      saveButton,
      openModal,
      closeModal,
      saveSnapshot,
      scheduleRefresh,
      smartWrapText,
      getDefaultText,
    } = options || {};

    function setShapeText(shapeEl, raw) {
      if (!shapeEl || !state) return;
      const shape = state.shapes.find((item) => item.id === shapeEl.id);
      const rawText = (raw || '').trim();
      if (shape) shape.textRaw = rawText;

      const type = shape?.type || (shapeEl.classList.contains('decision') ? 'decision' : 'process');
      const content = shapeEl.querySelector('.content');
      const defaultText = getDefaultText?.(type) || '';
      if (content) content.textContent = smartWrapText?.(rawText || defaultText, type) || '';
      shapeEl.setAttribute('aria-label', `Фігура: ${rawText || defaultText}`);
    }

    function openTextModal(shapeEl) {
      if (!shapeEl || !state) return;
      state.activeShape = shapeEl;
      const shape = state.shapes.find((item) => item.id === shapeEl.id);
      if (shapeTextArea) shapeTextArea.value = (shape?.textRaw || '').trim();
      openModal?.(textModal);
      setTimeout(() => shapeTextArea?.focus(), 50);
    }

    function cancelEdit() {
      if (state) state.activeShape = null;
      closeModal?.(textModal);
    }

    function saveEdit() {
      if (!state?.activeShape) {
        closeModal?.(textModal);
        return;
      }
      saveSnapshot?.();
      setShapeText(state.activeShape, shapeTextArea?.value || '');
      closeModal?.(textModal);
      state.activeShape = null;
      scheduleRefresh?.();
    }

    function bind() {
      cancelButton?.addEventListener('click', cancelEdit);
      saveButton?.addEventListener('click', saveEdit);
    }

    return {
      setShapeText,
      openTextModal,
      cancelEdit,
      saveEdit,
      bind,
    };
  }

  window.FlowchartsShapeText = {
    createShapeTextController,
  };
})();
