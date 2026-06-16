'use strict';

window.ArtMalyunky = window.ArtMalyunky || {};

(() => {
  const { constants, state, utils, canvasApi, ui } = window.ArtMalyunky;

  function createPaintDocument({ markDirty, markSaved, pushUndo, discardActiveText }) {
    const autosaveDraft = utils.debounce(() => {
      if (state.suppressAutosave) return;
      const payload = {
        fileName: state.fileName,
        currentTool: state.currentTool,
        currentBrush: state.currentBrush,
        currentShape: state.currentShape,
        currentStamp: state.currentStamp,
        currentColor: state.currentColor,
        backgroundColor: state.backgroundColor,
        currentSize: state.currentSize,
        currentOpacity: state.currentOpacity,
        currentFontSize: state.currentFontSize,
        currentFontFamily: state.currentFontFamily,
        currentBold: state.currentBold,
        currentItalic: state.currentItalic,
        guideMode: state.guideMode,
        canvas: canvasApi.toSerializable()
      };
      window.ArtMalyunky.paintStorage.saveDraft(payload).catch((error) => {
        console.warn('Не вдалося зберегти чернетку.', error);
      });
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
        discardActiveText?.();
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
        const draft = await window.ArtMalyunky.paintStorage.loadDraft();
        if (!draft) return;
        state.fileName = draft.fileName || constants.DEFAULT_FILE_NAME;
        state.currentTool = draft.currentTool || 'brush';
        state.currentBrush = draft.currentBrush || 'pencil';
        state.currentShape = draft.currentShape || 'line';
        state.currentStamp = draft.currentStamp || constants.DEFAULT_STAMP;
        state.currentColor = draft.currentColor || constants.DEFAULT_COLOR;
        state.backgroundColor = draft.backgroundColor || constants.DEFAULT_BG_COLOR;
        state.currentSize = Number(draft.currentSize || constants.DEFAULT_SIZE);
        state.currentOpacity = Number(draft.currentOpacity || constants.DEFAULT_OPACITY);
        state.currentFontSize = Number(draft.currentFontSize || constants.DEFAULT_FONT_SIZE);
        state.currentFontFamily = draft.currentFontFamily || constants.DEFAULT_FONT_FAMILY;
        state.currentBold = !!draft.currentBold;
        state.currentItalic = !!draft.currentItalic;
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
        ui.updateTextUI();
        ui.updateGuideUI();
        // Нова чернетка: draft.canvas (серіалізована). Старий формат: draft.snapshot (пласкі поля + raster dataURL).
        const serial = draft.canvas || (draft.snapshot ? {
          document: {
            width: draft.snapshot.width,
            height: draft.snapshot.height,
            background: draft.snapshot.background,
            transparent: draft.snapshot.transparent
          },
          raster: draft.snapshot.raster,
          objects: draft.snapshot.objects
        } : null);
        if (serial) {
          await canvasApi.restoreSerializable(serial);
        }
        state.unsavedChanges = false;
        ui.updateDirtyUI();
        ui.updateDetailStatus();
      } catch (error) {
        console.warn('Не вдалося відновити чернетку.', error);
      }
    }

    // === Project-файл (.malyunok): повний редагований стан, re-editable ===
    function saveProject() {
      const project = {
        format: constants.PROJECT_FORMAT,
        version: constants.PROJECT_VERSION,
        fileName: state.fileName || constants.DEFAULT_FILE_NAME,
        document: {
          width: state.document.width,
          height: state.document.height,
          background: state.document.background,
          transparent: state.document.transparent
        },
        raster: canvasApi.canvas.toDataURL('image/png')
      };
      const blob = new Blob([JSON.stringify(project)], { type: 'application/json' });
      utils.downloadBlob(blob, `${state.fileName || constants.DEFAULT_FILE_NAME}.${constants.PROJECT_EXT}`);
      markSaved();
    }

    function openProject() {
      window.OfficeShell?.openFilePicker?.(ui.elements.projectFileInput) || ui.elements.projectFileInput.click();
    }

    // P0-валідація недовіреного project-файлу: формат, межі розміру/пікселів,
    // MIME та довжина растру, санітизація фону й назви.
    function validateProject(obj) {
      if (!obj || typeof obj !== 'object') return null;
      if (obj.format !== constants.PROJECT_FORMAT) return null;
      if (typeof obj.version !== 'number') return null;
      const docData = obj.document;
      if (!docData || typeof docData !== 'object') return null;
      const width = Math.round(Number(docData.width));
      const height = Math.round(Number(docData.height));
      if (!Number.isFinite(width) || !Number.isFinite(height)) return null;
      if (width < constants.MIN_DOC_DIMENSION || width > constants.MAX_DOC_DIMENSION) return null;
      if (height < constants.MIN_DOC_DIMENSION || height > constants.MAX_DOC_DIMENSION) return null;
      if (width * height > constants.MAX_DOC_PIXELS) return null;
      const raster = typeof obj.raster === 'string' ? obj.raster : '';
      if (raster && !/^data:image\/(png|jpeg|webp);base64,/.test(raster)) return null;
      if (raster.length > constants.MAX_RASTER_DATAURL) return null;
      return {
        width,
        height,
        background: utils.sanitizeHexColor(docData.background, constants.DEFAULT_BACKGROUND),
        transparent: !!docData.transparent,
        raster: raster || null,
        fileName: typeof obj.fileName === 'string' && obj.fileName.trim()
          ? obj.fileName.trim().slice(0, 80)
          : constants.DEFAULT_FILE_NAME
      };
    }

    async function handleProjectFile(file) {
      if (!file) return;
      if (file.size > constants.MAX_PROJECT_BYTES) {
        ui.showInfoModal('Завеликий файл', 'Project-файл перевищує допустимий розмір.', '⚠️');
        return;
      }
      let parsed;
      try {
        parsed = JSON.parse(await file.text());
      } catch {
        ui.showInfoModal('Пошкоджений файл', 'Не вдалося прочитати project-файл (не коректний JSON).', '⚠️');
        return;
      }
      const valid = validateProject(parsed);
      if (!valid) {
        ui.showInfoModal('Несумісний файл', 'Це не коректний project-файл ПЛЮС Малюнки або він пошкоджений.', '⚠️');
        return;
      }
      try {
        if (discardActiveText) discardActiveText();
        state.suppressAutosave = true;
        canvasApi.setDocumentSize(valid.width, valid.height, {
          clear: true,
          background: valid.background,
          transparent: valid.transparent
        });
        await canvasApi.restoreRasterFromDataUrl(valid.raster);
        state.suppressAutosave = false;
        state.objects = [];
        state.selectedObjectId = null;
        state.selection = null;
        state.undoStack.length = 0;
        state.redoStack.length = 0;
        state.fileName = valid.fileName;
        canvasApi.renderObjects();
        canvasApi.drawSelectionOverlay();
        canvasApi.fitDocumentToViewport();
        ui.updateFileNameUI();
        ui.updateCanvasInfo(state.document.width, state.document.height);
        ui.updateZoomUI();
        ui.updateDetailStatus();
        state.unsavedChanges = false;
        ui.updateDirtyUI();
        autosaveDraft();
      } catch (error) {
        state.suppressAutosave = false;
        console.error(error);
        ui.showInfoModal('Помилка відкриття', 'Не вдалося відкрити project-файл.', '⚠️');
      }
    }

    return {
      autosaveDraft,
      handleImportedFile,
      handleProjectFile,
      importImage,
      openProject,
      printImage,
      restoreDraftIfAny,
      saveImage,
      saveProject
    };
  }

  window.ArtMalyunky.paintDocument = { createPaintDocument };
})();
