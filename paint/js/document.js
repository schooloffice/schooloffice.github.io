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

    async function confirmReplaceDocument(title, confirmText) {
      if (!state.unsavedChanges) return true;
      return ui.showConfirmModal(
        title,
        'Незбережені зміни буде втрачено. Спершу збережіть проєкт, якщо хочете продовжити редагування пізніше.',
        '⚠️',
        confirmText
      );
    }

    function handleImportedFile(file) {
      if (!file) return;
      if (file.size > constants.MAX_IMPORT_BYTES) {
        ui.showInfoModal('Завеликий файл', 'Файл зображення перевищує допустимий розмір.', '⚠️');
        return;
      }
      const reader = new FileReader();
      reader.onload = async (event) => {
        let image;
        try {
          image = await canvasApi.decodeImage(event.target.result);
        } catch (error) {
          console.error(error);
          ui.showInfoModal('Помилка імпорту', 'Не вдалося відкрити зображення.', '⚠️');
          return;
        }
        const plan = canvasApi.planImageImport(image);
        const proceed = await confirmReplaceDocument('Відкрити зображення?', 'Відкрити');
        if (!proceed) return;
        // Велике зображення зменшується — попереджаємо й питаємо згоду.
        if (plan.scaled) {
          const ok = await ui.showConfirmModal(
            'Велике зображення',
            `Зображення ${plan.naturalW} × ${plan.naturalH} перевищує ліміт і буде зменшено до ${plan.targetW} × ${plan.targetH}. Продовжити?`,
            '🖼️',
            'Зменшити й відкрити'
          );
          if (!ok) return;
        }
        pushUndo();
        discardActiveText?.();
        canvasApi.placeImageAsDocument(image, plan.targetW, plan.targetH);
        ui.updateCanvasInfo(state.document.width, state.document.height);
        ui.updateZoomUI();
        markDirty();
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
      const serial = canvasApi.toSerializable();
      const project = {
        format: constants.PROJECT_FORMAT,
        version: constants.PROJECT_VERSION,
        fileName: state.fileName || constants.DEFAULT_FILE_NAME,
        ...serial
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
    function validateProjectSettings(raw) {
      const settings = raw && typeof raw === 'object' ? raw : {};
      const safe = {};
      if (constants.TOOLS[settings.currentTool]) safe.currentTool = settings.currentTool;
      if (constants.BRUSHES[settings.currentBrush]) safe.currentBrush = settings.currentBrush;
      if (constants.SHAPES[settings.currentShape]) safe.currentShape = settings.currentShape;
      if (constants.STAMP_POOL.includes(settings.currentStamp)) safe.currentStamp = settings.currentStamp;
      safe.currentColor = utils.sanitizeHexColor(settings.currentColor, state.currentColor);
      safe.backgroundColor = utils.sanitizeHexColor(settings.backgroundColor, state.backgroundColor);
      safe.currentSize = utils.clamp(Math.round(Number(settings.currentSize) || state.currentSize), 1, 96);
      safe.currentOpacity = utils.clamp(Math.round(Number(settings.currentOpacity) || state.currentOpacity), 1, 100);
      safe.currentFontSize = utils.clamp(Math.round(Number(settings.currentFontSize) || state.currentFontSize), 8, 200);
      if (constants.FONT_FAMILIES.some((font) => font.value === settings.currentFontFamily)) {
        safe.currentFontFamily = settings.currentFontFamily;
      }
      safe.currentBold = !!settings.currentBold;
      safe.currentItalic = !!settings.currentItalic;
      if (constants.GUIDE_LABELS[settings.guideMode]) safe.guideMode = settings.guideMode;
      return safe;
    }

    function sanitizeProjectObject(raw, index, width, height) {
      if (!raw || typeof raw !== 'object') return null;
      const kind = raw.kind === 'shape' || raw.kind === 'stamp' ? raw.kind : null;
      if (!kind) return null;
      const idText = typeof raw.id === 'string' ? raw.id.replace(/[^\w-]/g, '').slice(0, 40) : '';
      const base = {
        id: `project_${index}_${idText || kind}`,
        kind,
        x: utils.clamp(Number(raw.x) || 0, -width, width),
        y: utils.clamp(Number(raw.y) || 0, -height, height),
        w: utils.clamp(Number(raw.w) || 1, 1, Math.max(1, width * 2)),
        h: utils.clamp(Number(raw.h) || 1, 1, Math.max(1, height * 2)),
        opacity: utils.clamp(Math.round(Number(raw.opacity) || 100), 1, 100)
      };
      if (kind === 'stamp') {
        return {
          ...base,
          stamp: typeof raw.stamp === 'string' && raw.stamp.trim()
            ? raw.stamp.trim().slice(0, 8)
            : constants.DEFAULT_STAMP
        };
      }
      return {
        ...base,
        shape: constants.SHAPES[raw.shape] ? raw.shape : 'line',
        color: utils.sanitizeHexColor(raw.color, constants.DEFAULT_COLOR),
        strokeColor: utils.sanitizeHexColor(raw.strokeColor || raw.color, constants.DEFAULT_COLOR),
        fillColor: utils.sanitizeHexColor(raw.fillColor || raw.color, constants.DEFAULT_BG_COLOR),
        strokeWidth: utils.clamp(Math.round(Number(raw.strokeWidth) || 2), 1, 96),
        flipX: !!raw.flipX,
        flipY: !!raw.flipY
      };
    }

    function validateProjectObjects(rawObjects, width, height) {
      if (!Array.isArray(rawObjects)) return [];
      return rawObjects
        .slice(0, constants.MAX_PROJECT_OBJECTS)
        .map((item, index) => sanitizeProjectObject(item, index, width, height))
        .filter(Boolean);
    }

    function validateProject(obj) {
      if (!obj || typeof obj !== 'object') return null;
      if (obj.format !== constants.PROJECT_FORMAT) return null;
      if (!Number.isInteger(obj.version) || obj.version !== constants.PROJECT_VERSION) return null;
      const projectData = obj.canvas && typeof obj.canvas === 'object' ? obj.canvas : obj;
      const docData = projectData.document;
      if (!docData || typeof docData !== 'object') return null;
      const width = Math.round(Number(docData.width));
      const height = Math.round(Number(docData.height));
      if (!Number.isFinite(width) || !Number.isFinite(height)) return null;
      if (width < constants.MIN_DOC_DIMENSION || width > constants.MAX_DOC_DIMENSION) return null;
      if (height < constants.MIN_DOC_DIMENSION || height > constants.MAX_DOC_DIMENSION) return null;
      if (width * height > constants.MAX_DOC_PIXELS) return null;
      const raster = typeof projectData.raster === 'string' ? projectData.raster : '';
      if (raster && !/^data:image\/(png|jpeg|webp);base64,/.test(raster)) return null;
      if (raster.length > constants.MAX_RASTER_DATAURL) return null;
      const documentData = {
        width,
        height,
        background: utils.sanitizeHexColor(docData.background, constants.DEFAULT_BACKGROUND),
        transparent: !!docData.transparent
      };
      return {
        canvas: {
          document: documentData,
          raster: raster || null,
          objects: validateProjectObjects(projectData.objects, width, height),
          settings: validateProjectSettings(projectData.settings)
        },
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
      const proceed = await confirmReplaceDocument('Відкрити проєкт?', 'Відкрити');
      if (!proceed) return;
      try {
        if (discardActiveText) discardActiveText();
        state.suppressAutosave = true;
        await canvasApi.restoreSerializable(valid.canvas);
        state.suppressAutosave = false;
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
        ui.updateToolUI();
        ui.updateShapeUI();
        ui.updateStampUI();
        ui.updateColorUI();
        ui.updateSizeUI();
        ui.updateOpacityUI();
        ui.updateTextUI();
        ui.updateGuideUI();
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
