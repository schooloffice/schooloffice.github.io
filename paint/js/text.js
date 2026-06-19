'use strict';

window.ArtMalyunky = window.ArtMalyunky || {};

// Текстовий інструмент: редагований overlay (<textarea>), що запікається в растр
// при підтвердженні (raster-first). Винесено з app.js окремим модулем.
(() => {
  const { state, constants, utils, canvasApi, ui } = window.ArtMalyunky;

  function createPaintText({ pushUndo, markDirty, autosaveDraft }) {
    function syncTextBoxStyle() {
      const edit = state.textEdit;
      if (!edit) return;
      const zoom = state.viewport.zoom;
      edit.el.style.left = `${edit.x * zoom}px`;
      edit.el.style.top = `${edit.y * zoom}px`;
      edit.el.style.fontSize = `${state.currentFontSize * zoom}px`;
      edit.el.style.fontFamily = state.currentFontFamily;
      edit.el.style.fontWeight = state.currentBold ? '700' : '400';
      edit.el.style.fontStyle = state.currentItalic ? 'italic' : 'normal';
      edit.el.style.color = state.currentColor;
      edit.autosize?.();
    }

    function createTextBox(docX, docY) {
      commitActiveText();
      const el = document.createElement('textarea');
      el.className = 'text-edit-box';
      el.setAttribute('spellcheck', 'false');
      el.setAttribute('wrap', 'off');
      el.setAttribute('rows', '1');
      el.setAttribute('aria-label', 'Текст для додавання на малюнок');
      state.textEdit = { el, x: docX, y: docY };
      ui.elements.canvasStage.appendChild(el);
      syncTextBoxStyle();
      const autosize = () => {
        el.style.width = '0';
        el.style.height = '0';
        el.style.width = `${el.scrollWidth + 6}px`;
        el.style.height = `${el.scrollHeight}px`;
      };
      state.textEdit.autosize = autosize;
      el.addEventListener('input', autosize);
      autosize();
      el.focus();
      el.addEventListener('keydown', (event) => {
        event.stopPropagation();
        if (event.key === 'Escape') {
          event.preventDefault();
          commitActiveText();
        }
      });
    }

    function commitActiveText() {
      const edit = state.textEdit;
      if (!edit) return;
      const value = edit.el.value;
      state.textEdit = null;
      edit.el.remove();
      if (!value.trim()) return;
      pushUndo();
      canvasApi.drawText({
        text: value,
        x: edit.x,
        y: edit.y,
        fontSize: state.currentFontSize,
        fontFamily: state.currentFontFamily,
        bold: state.currentBold,
        italic: state.currentItalic,
        color: state.currentColor,
        opacity: state.currentOpacity
      });
      markDirty();
    }

    function discardActiveText() {
      const edit = state.textEdit;
      if (!edit) return;
      state.textEdit = null;
      edit.el.remove();
    }

    function setFontSize(value) {
      state.currentFontSize = utils.clamp(Math.round(Number(value) || constants.DEFAULT_FONT_SIZE), 8, 200);
      ui.updateTextUI();
      syncTextBoxStyle();
      autosaveDraft();
    }

    function setFontFamily(value) {
      state.currentFontFamily = value || constants.DEFAULT_FONT_FAMILY;
      ui.updateTextUI();
      syncTextBoxStyle();
      autosaveDraft();
    }

    function toggleBold() {
      state.currentBold = !state.currentBold;
      ui.updateTextUI();
      syncTextBoxStyle();
      autosaveDraft();
    }

    function toggleItalic() {
      state.currentItalic = !state.currentItalic;
      ui.updateTextUI();
      syncTextBoxStyle();
      autosaveDraft();
    }

    return {
      syncTextBoxStyle,
      createTextBox,
      commitActiveText,
      discardActiveText,
      setFontSize,
      setFontFamily,
      toggleBold,
      toggleItalic
    };
  }

  window.ArtMalyunky.paintText = { createPaintText };
})();
