'use strict';

window.ArtMalyunky = window.ArtMalyunky || {};

(() => {
  const { constants, state, utils, canvasApi, ui } = window.ArtMalyunky;

  function createPaintDocument({ markDirty, markSaved, pushUndo }) {
    const autosaveDraft = utils.debounce(() => {
      if (state.suppressAutosave) return;
      try {
        const payload = {
          fileName: state.fileName,
          currentTool: state.currentTool,
          currentBrush: state.currentBrush,
          currentShape: state.currentShape,
          currentStamp: state.currentStamp,
          currentColor: state.currentColor,
          currentSize: state.currentSize,
          currentOpacity: state.currentOpacity,
          guideMode: state.guideMode,
          snapshot: canvasApi.snapshot()
        };
        localStorage.setItem(constants.STORAGE_KEY, JSON.stringify(payload));
      } catch (error) {
        console.warn('Не вдалося зберегти чернетку.', error);
      }
    }, 260);

    function saveImage(type = 'png') {
      const ext = type === 'jpg' ? 'jpg' : 'png';
      const mime = type === 'jpg' ? 'image/jpeg' : 'image/png';
      const dataUrl = canvasApi.exportImage(mime, 0.92);
      utils.downloadDataUrl(dataUrl, `${state.fileName || constants.DEFAULT_FILE_NAME}.${ext}`);
      markSaved();
    }

    function printImage() {
      const dataUrl = canvasApi.exportImage('image/png');
      const printWindow = window.open('', '_blank', 'width=900,height=700');
      if (!printWindow) {
        ui.showInfoModal('Друк заблоковано', 'Браузер не відкрив вікно друку. Дозвольте спливаючі вікна для цієї сторінки.', '⚠️');
        return;
      }
      const doc = printWindow.document;
      const title = state.fileName || constants.DEFAULT_FILE_NAME;
      doc.open();
      doc.write('<!DOCTYPE html><html lang="uk"><head><meta charset="UTF-8"></head><body></body></html>');
      doc.close();
      doc.title = title;

      const style = doc.createElement('style');
      style.textContent = 'body{margin:0;padding:24px;display:grid;place-items:center;background:#f5f7fb}img{max-width:100%;height:auto;box-shadow:0 8px 28px rgba(0,0,0,.12)}';
      doc.head.appendChild(style);

      const image = doc.createElement('img');
      image.src = dataUrl;
      image.alt = title;
      doc.body.appendChild(image);

      printWindow.focus();
      printWindow.print();
    }

    function importImage() {
      window.OfficeShell?.openFilePicker?.(ui.elements.importFileInput) || ui.elements.importFileInput.click();
    }

    function handleImportedFile(file) {
      if (!file) return;
      const reader = new FileReader();
      reader.onload = async (event) => {
        pushUndo();
        try {
          await canvasApi.loadImageFile(event.target.result);
          markDirty();
        } catch (error) {
          console.error(error);
          ui.showInfoModal('Помилка імпорту', 'Не вдалося відкрити зображення.', '⚠️');
        }
      };
      reader.readAsDataURL(file);
    }

    async function restoreDraftIfAny() {
      try {
        const raw = localStorage.getItem(constants.STORAGE_KEY);
        if (!raw) return;
        const draft = JSON.parse(raw);
        if (!draft) return;
        state.fileName = draft.fileName || constants.DEFAULT_FILE_NAME;
        state.currentTool = draft.currentTool || 'brush';
        state.currentBrush = draft.currentBrush || 'pencil';
        state.currentShape = draft.currentShape || 'line';
        state.currentStamp = draft.currentStamp || constants.DEFAULT_STAMP;
        state.currentColor = draft.currentColor || constants.DEFAULT_COLOR;
        state.currentSize = Number(draft.currentSize || constants.DEFAULT_SIZE);
        state.currentOpacity = Number(draft.currentOpacity || constants.DEFAULT_OPACITY);
        state.guideMode = draft.guideMode || constants.DEFAULT_GUIDE;
        ui.renderBrushes();
        ui.renderStamps();
        ui.updateFileNameUI();
        ui.updateToolUI();
        ui.updateShapeUI();
        ui.updateStampUI();
        ui.updateColorUI();
        ui.updateSizeUI();
        ui.updateOpacityUI();
        ui.updateGuideUI();
        if (draft.snapshot) {
          await canvasApi.restoreSnapshot(draft.snapshot);
        }
        state.unsavedChanges = false;
        ui.updateDirtyUI();
        ui.updateDetailStatus();
      } catch (error) {
        console.warn('Не вдалося відновити чернетку.', error);
      }
    }

    return {
      autosaveDraft,
      handleImportedFile,
      importImage,
      printImage,
      restoreDraftIfAny,
      saveImage
    };
  }

  window.ArtMalyunky.paintDocument = { createPaintDocument };
})();
