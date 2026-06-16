'use strict';

window.ArtMalyunky = window.ArtMalyunky || {};

(() => {
  const { utils, constants, state } = window.ArtMalyunky;

  const ui = {
    elements: {},
    openMenuName: null,

    init() {
      this.cacheElements();
      this.renderBrushes();
      this.renderShapes();
      this.renderPalette();
      this.renderStamps();
      this.renderFontFamilies();
      this.bindMenus();
      this.bindAdvancedColorPanel();
      this.updateToolUI();
      this.updateShapeUI();
      this.updateStampUI();
      this.updateColorUI();
      this.updateSizeUI();
      this.updateOpacityUI();
      this.updateTextUI();
      this.updateGuideUI();
      this.updateZoomUI();
      this.updateFileNameUI();
      this.updateDirtyUI();
      return this.elements;
    },

    cacheElements() {
      this.elements = {
        modalOverlay: utils.$('modalOverlay'),
        modalIcon: utils.$('modalIcon'),
        modalTitle: utils.$('modalTitle'),
        modalText: utils.$('modalText'),
        modalCancel: utils.$('modalCancel'),
        modalConfirm: utils.$('modalConfirm'),

        fileName: utils.$('fileName'),
        dirtyDot: utils.$('dirtyDot'),
        saveBadge: utils.$('saveBadge'),
        importFileInput: utils.$('importFileInput'),

        drawingCanvas: utils.$('drawingCanvas'),
        guideCanvas: utils.$('guideCanvas'),
        objectLayer: utils.$('objectLayer'),
        selectionCanvas: utils.$('selectionCanvas'),
        canvasStage: utils.$('canvasStage'),
        canvasStageWrap: utils.$('canvasStageWrap'),

        docDialogOverlay: utils.$('docDialogOverlay'),
        docDialogTitle: utils.$('docDialogTitle'),
        docPresetGrid: utils.$('docPresetGrid'),
        docWidthInput: utils.$('docWidthInput'),
        docHeightInput: utils.$('docHeightInput'),
        docDialogCancel: utils.$('docDialogCancel'),
        docDialogConfirm: utils.$('docDialogConfirm'),

        zoomLevelLabel: utils.$('zoomLevelLabel'),
        statusZoom: utils.$('statusZoom'),

        brushGrid: utils.$('brushGrid'),
        shapeGrid: utils.$('shapeGrid'),
        stampGrid: utils.$('stampGrid'),
        colorPalette: utils.$('colorPalette'),
        nativeColorPicker: utils.$('nativeColorPicker'),
        foregroundChip: utils.$('foregroundChip'),
        backgroundChip: utils.$('backgroundChip'),
        swapColorsBtn: utils.$('swapColorsBtn'),
        shuffleStampsBtn: utils.$('shuffleStampsBtn'),
        propSections: utils.$$('.prop-section[data-tool-section]'),

        sizeSlider: utils.$('sizeSlider'),
        opacitySlider: utils.$('opacitySlider'),
        sizeValue: utils.$('sizeValue'),
        opacityValue: utils.$('opacityValue'),

        fontFamilySelect: utils.$('fontFamilySelect'),
        fontSizeInput: utils.$('fontSizeInput'),
        fontSizeValue: utils.$('fontSizeValue'),
        boldBtn: utils.$('boldBtn'),
        italicBtn: utils.$('italicBtn'),

        advancedColorBtn: utils.$('advancedColorBtn'),
        advancedColorPanel: utils.$('advancedColorPanel'),
        colorPreview: utils.$('colorPreview'),
        hexValue: utils.$('hexValue'),
        rgbValue: utils.$('rgbValue'),
        binValue: utils.$('binValue'),
        redSlider: utils.$('redSlider'),
        greenSlider: utils.$('greenSlider'),
        blueSlider: utils.$('blueSlider'),
        redValue: utils.$('redValue'),
        greenValue: utils.$('greenValue'),
        blueValue: utils.$('blueValue'),
        applyMixerBtn: utils.$('applyMixerBtn'),

        menuTitles: utils.$$('.menu-title'),
        menuDropdowns: utils.$$('.menu-dropdown'),
        guideButtons: utils.$$('.segmented-btn[data-guide]'),
        toolSwitches: utils.$$('[data-tool]'),

        statusCoords: utils.$('statusCoords'),
        statusTool: utils.$('statusTool'),
        statusDetail: utils.$('statusDetail'),
        statusColor: utils.$('statusColor'),
        statusSize: utils.$('statusSize'),
        statusOpacity: utils.$('statusOpacity'),
        statusGuide: utils.$('statusGuide'),
        statusCanvas: utils.$('statusCanvas')
      };
    },

    bindMenus() {
      this.elements.menuTitles.forEach((button) => {
        button.addEventListener('click', (event) => {
          event.stopPropagation();
          this.closePickers();
          const name = button.dataset.menu;
          if (this.openMenuName === name) this.closeMenus();
          else this.openMenu(name);
        });
      });

      document.addEventListener('click', (event) => {
        if (!event.target.closest('.menu-item-wrap')) this.closeMenus();
      });

      document.addEventListener('office:overlayclose', (event) => {
        if (event.detail?.type === 'menu') this.openMenuName = null;
      });

      window.addEventListener('resize', () => {
        this.closeMenus();
        this.closePickers();
      });
      window.addEventListener('scroll', () => {
        this.closeMenus();
        this.closePickers();
      }, true);
    },

    bindAdvancedColorPanel() {
      const togglePanel = (force) => {
        const nextState = typeof force === 'boolean'
          ? force
          : this.elements.advancedColorPanel.classList.contains('hidden');
        this.elements.advancedColorPanel.classList.toggle('hidden', !nextState);
        this.elements.advancedColorBtn.classList.toggle('active', nextState);
        if (nextState) this.previewMixerColor();
      };

      this.elements.advancedColorBtn.addEventListener('click', (event) => {
        event.stopPropagation();
        this.closeMenus();
        this.closePickers();
        togglePanel();
      });

      this.elements.closeAdvancedColorBtn?.addEventListener('click', (event) => {
        event.stopPropagation();
        togglePanel(false);
      });

      this.elements.advancedColorPanel.addEventListener('click', (event) => {
        event.stopPropagation();
      });

      document.addEventListener('click', (event) => {
        if (this.elements.advancedColorPanel.classList.contains('hidden')) return;
        if (event.target.closest('#advancedColorBtn')) return;
        if (event.target.closest('#advancedColorPanel')) return;
        togglePanel(false);
      });
    },

    openMenu(name) {
      this.closeMenus();
      this.openMenuName = name;
      const title = document.querySelector(`.menu-title[data-menu="${name}"]`);
      const dropdown = document.querySelector(`.menu-dropdown[data-menu="${name}"]`);
      if (!title || !dropdown) return;
      title.setAttribute('aria-expanded', 'true');
      dropdown.classList.add('open');
    },

    closeMenus() {
      this.openMenuName = null;
      this.elements.menuTitles.forEach((item) => item.setAttribute('aria-expanded', 'false'));
      this.elements.menuDropdowns.forEach((item) => item.classList.remove('open'));
    },

    // Параметри інструментів тепер живуть інлайн у боковій панелі (без дропдаунів-пікерів).
    // Метод лишається як no-op, щоб не чіпати наявні виклики closePickers().
    closePickers() {},

    // Показує лише ті prop-секції, що стосуються активного інструмента.
    updateToolSections() {
      this.elements.propSections.forEach((section) => {
        const tools = (section.dataset.toolSection || '').split(/\s+/).filter(Boolean);
        section.classList.toggle('hidden', tools.length > 0 && !tools.includes(state.currentTool));
      });
    },

    renderBrushes() {
      this.elements.brushGrid.innerHTML = Object.entries(constants.BRUSHES).map(([key, brush]) => `
        <button type="button" class="brush-option ${state.currentBrush === key ? 'active' : ''}" data-brush="${key}">
          <i class="fa-solid ${brush.icon}"></i>
          <span>${brush.label}</span>
        </button>`).join('');
    },

    renderShapes() {
      this.elements.shapeGrid.innerHTML = Object.entries(constants.SHAPES).map(([key, shape]) => `
        <button type="button" class="shape-option ${state.currentShape === key ? 'active' : ''}" data-shape="${key}" title="${shape.label}">
          <i class="${shape.icon}"></i>
        </button>`).join('');
    },

    renderPalette() {
      this.elements.colorPalette.innerHTML = '';
      constants.COLOR_PALETTE.forEach((hex) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'color-swatch';
        button.dataset.hex = hex;
        button.style.background = hex;
        button.title = hex.toUpperCase();
        if (hex.toLowerCase() === '#ffffff') button.style.borderColor = '#cbd5e1';
        this.elements.colorPalette.appendChild(button);
      });
    },

    renderStamps() {
      const stamps = [...new Set(utils.shuffle(constants.STAMP_POOL))].slice(0, 16);
      if (!stamps.includes(state.currentStamp)) stamps[0] = state.currentStamp;
      this.elements.stampGrid.innerHTML = stamps.map((stamp) => `
        <button type="button" class="stamp-option ${stamp === state.currentStamp ? 'active' : ''}" data-stamp="${stamp}" title="${stamp}">${stamp}</button>`).join('');
    },

    updateToolUI() {
      const toolInfo = constants.TOOLS[state.currentTool];
      this.elements.toolSwitches.forEach((button) => {
        button.classList.toggle('active', button.dataset.tool === state.currentTool);
      });
      this.elements.statusTool.textContent = `Інструмент: ${toolInfo.label}`;
      this.updateToolSections();
      this.updateDetailStatus();
      this.elements.drawingCanvas.style.cursor = toolInfo.cursor;
    },

    updateShapeUI() {
      utils.$$('.shape-option', this.elements.shapeGrid).forEach((button) => {
        button.classList.toggle('active', button.dataset.shape === state.currentShape);
      });
      this.updateDetailStatus();
    },

    updateStampUI() {
      utils.$$('.stamp-option', this.elements.stampGrid).forEach((button) => {
        button.classList.toggle('active', button.dataset.stamp === state.currentStamp);
      });
      this.updateDetailStatus();
    },

    updateColorUI() {
      utils.$$('.color-swatch', this.elements.colorPalette).forEach((button) => {
        button.classList.toggle('active', button.dataset.hex.toLowerCase() === state.currentColor.toLowerCase());
      });
      this.elements.nativeColorPicker.value = state.currentColor;
      if (this.elements.foregroundChip) this.elements.foregroundChip.style.background = state.currentColor;
      if (this.elements.backgroundChip) this.elements.backgroundChip.style.background = state.backgroundColor;
      const { r, g, b } = utils.hexToRgb(state.currentColor);
      const binary = `${utils.byteToBinary(r)} ${utils.byteToBinary(g)} ${utils.byteToBinary(b)}`;
      this.elements.colorPreview.style.background = state.currentColor;
      this.elements.hexValue.textContent = state.currentColor.toUpperCase();
      this.elements.rgbValue.textContent = `${r}, ${g}, ${b}`;
      this.elements.binValue.textContent = binary;
      this.elements.redSlider.value = String(r);
      this.elements.greenSlider.value = String(g);
      this.elements.blueSlider.value = String(b);
      this.elements.redValue.textContent = String(r);
      this.elements.greenValue.textContent = String(g);
      this.elements.blueValue.textContent = String(b);
      this.elements.statusColor.textContent = `Колір: ${state.currentColor.toUpperCase()}`;
    },

    updateSizeUI() {
      this.elements.sizeSlider.value = String(state.currentSize);
      this.elements.sizeValue.textContent = String(state.currentSize);
      this.elements.statusSize.textContent = `Товщина: ${state.currentSize}`;
    },

    renderFontFamilies() {
      const select = this.elements.fontFamilySelect;
      if (!select) return;
      select.innerHTML = constants.FONT_FAMILIES
        .map((font) => `<option value="${utils.escapeHtml(font.value)}">${utils.escapeHtml(font.label)}</option>`)
        .join('');
    },

    updateTextUI() {
      if (this.elements.fontSizeInput) this.elements.fontSizeInput.value = String(state.currentFontSize);
      if (this.elements.fontSizeValue) this.elements.fontSizeValue.textContent = String(state.currentFontSize);
      if (this.elements.fontFamilySelect) this.elements.fontFamilySelect.value = state.currentFontFamily;
      if (this.elements.boldBtn) {
        this.elements.boldBtn.classList.toggle('active', state.currentBold);
        this.elements.boldBtn.setAttribute('aria-pressed', state.currentBold ? 'true' : 'false');
      }
      if (this.elements.italicBtn) {
        this.elements.italicBtn.classList.toggle('active', state.currentItalic);
        this.elements.italicBtn.setAttribute('aria-pressed', state.currentItalic ? 'true' : 'false');
      }
    },

    updateOpacityUI() {
      this.elements.opacitySlider.value = String(state.currentOpacity);
      this.elements.opacityValue.textContent = `${state.currentOpacity}%`;
      this.elements.statusOpacity.textContent = `Непрозорість: ${state.currentOpacity}%`;
    },

    updateGuideUI() {
      this.elements.guideButtons.forEach((button) => {
        button.classList.toggle('active', button.dataset.guide === state.guideMode);
      });
      this.elements.statusGuide.textContent = `Підкладка: ${constants.GUIDE_LABELS[state.guideMode]}`;
    },

    updateCoords(x, y) {
      this.elements.statusCoords.textContent = `X: ${Math.round(x)}, Y: ${Math.round(y)}`;
    },

    updateCanvasInfo(width, height) {
      this.elements.statusCanvas.textContent = `Полотно: ${width} × ${height}`;
    },

    updateZoomUI() {
      const percent = `${Math.round(state.viewport.zoom * 100)}%`;
      if (this.elements.zoomLevelLabel) this.elements.zoomLevelLabel.textContent = percent;
      if (this.elements.statusZoom) this.elements.statusZoom.textContent = `Масштаб: ${percent}`;
    },

    renderDocPresets(onPick) {
      const grid = this.elements.docPresetGrid;
      if (!grid) return;
      grid.innerHTML = constants.DOC_PRESETS
        .map((preset, index) => `<button type="button" class="doc-preset-btn" data-preset="${index}">${preset.label}</button>`)
        .join('');
      grid.querySelectorAll('.doc-preset-btn').forEach((button) => {
        button.addEventListener('click', () => {
          const preset = constants.DOC_PRESETS[Number(button.dataset.preset)];
          if (!preset) return;
          this.elements.docWidthInput.value = String(preset.width);
          this.elements.docHeightInput.value = String(preset.height);
          grid.querySelectorAll('.doc-preset-btn').forEach((item) => item.classList.toggle('active', item === button));
          if (typeof onPick === 'function') onPick(preset);
        });
      });
    },

    // Діалог нового документа / зміни розміру полотна.
    // Повертає Promise<{ width, height, background, transparent } | null>.
    showDocumentDialog({ title = 'Новий малюнок', width, height, confirmText = 'Створити', transparent = false } = {}) {
      return new Promise((resolve) => {
        const overlay = this.elements.docDialogOverlay;
        this.elements.docDialogTitle.textContent = title;
        this.elements.docDialogConfirm.textContent = confirmText;
        this.elements.docWidthInput.value = String(width ?? state.document.width);
        this.elements.docHeightInput.value = String(height ?? state.document.height);
        this.renderDocPresets();
        const bgValue = transparent ? 'transparent' : 'white';
        overlay.querySelectorAll('input[name="docBackground"]').forEach((radio) => {
          radio.checked = radio.value === bgValue;
        });

        overlay.classList.remove('hidden');
        overlay.classList.add('active');
        overlay.setAttribute('aria-hidden', 'false');
        this.elements.docWidthInput.focus();
        this.elements.docWidthInput.select();

        const cleanup = (result) => {
          overlay.classList.add('hidden');
          overlay.classList.remove('active');
          overlay.setAttribute('aria-hidden', 'true');
          this.elements.docDialogConfirm.removeEventListener('click', onConfirm);
          this.elements.docDialogCancel.removeEventListener('click', onCancel);
          overlay.removeEventListener('keydown', onKey);
          resolve(result);
        };

        const onConfirm = () => {
          const w = utils.clamp(Math.round(Number(this.elements.docWidthInput.value) || 0), constants.MIN_DOC_DIMENSION, constants.MAX_DOC_DIMENSION);
          const h = utils.clamp(Math.round(Number(this.elements.docHeightInput.value) || 0), constants.MIN_DOC_DIMENSION, constants.MAX_DOC_DIMENSION);
          const isTransparent = overlay.querySelector('input[name="docBackground"]:checked')?.value === 'transparent';
          cleanup({
            width: w,
            height: h,
            transparent: isTransparent,
            background: isTransparent ? state.document.background : constants.DEFAULT_BACKGROUND
          });
        };
        const onCancel = () => cleanup(null);
        const onKey = (event) => {
          if (event.key === 'Escape') onCancel();
          if (event.key === 'Enter' && event.target.tagName !== 'BUTTON') onConfirm();
        };

        this.elements.docDialogConfirm.addEventListener('click', onConfirm);
        this.elements.docDialogCancel.addEventListener('click', onCancel);
        overlay.addEventListener('keydown', onKey);
      });
    },

    updateDetailStatus(selectedObject = null) {
      if (!selectedObject && state.selectedObjectId && window.ArtMalyunky.canvasApi?.getObjectById) {
        selectedObject = window.ArtMalyunky.canvasApi.getObjectById(state.selectedObjectId);
      }
      if (selectedObject) {
        if (selectedObject.kind === 'stamp') {
          this.elements.statusDetail.textContent = `Штамп ${selectedObject.stamp} — рухай/змінюй розмір, Enter застосує`;
          return;
        }
        const shapeName = constants.SHAPES[selectedObject.shape]?.label || 'Фігура';
        this.elements.statusDetail.textContent = `${shapeName} — рухай/змінюй розмір, Enter застосує`;
        return;
      }

      if (state.currentTool === 'brush') {
        this.elements.statusDetail.textContent = `Режим: ${constants.BRUSHES[state.currentBrush].label}`;
      } else if (state.currentTool === 'shapes') {
        this.elements.statusDetail.textContent = `Фігура: ${constants.SHAPES[state.currentShape].label}`;
      } else if (state.currentTool === 'stamps') {
        this.elements.statusDetail.textContent = `Штамп: ${state.currentStamp}`;
      } else if (state.currentTool === 'eraser') {
        this.elements.statusDetail.textContent = 'Режим: стирання';
      } else if (state.currentTool === 'fill') {
        this.elements.statusDetail.textContent = 'Режим: заливка області';
      } else if (state.currentTool === 'eyedropper') {
        this.elements.statusDetail.textContent = 'Режим: піпетка (клік бере колір)';
      } else if (state.currentTool === 'select') {
        this.elements.statusDetail.textContent = 'Режим: виділення (перетягни рамку; Del — видалити, Ctrl+C/V — копіювати/вставити)';
      } else if (state.currentTool === 'text') {
        this.elements.statusDetail.textContent = 'Режим: текст (клікни на полотні й введи текст)';
      }
    },

    updateFileNameUI() {
      this.elements.fileName.textContent = state.fileName;
    },

    updateDirtyUI() {
      this.elements.dirtyDot.style.opacity = state.unsavedChanges ? '1' : '0';
    },

    flashSavedBadge() {
      this.elements.saveBadge.style.opacity = '1';
      window.clearTimeout(this._saveTimeout);
      this._saveTimeout = window.setTimeout(() => {
        this.elements.saveBadge.style.opacity = '0';
      }, 1400);
    },

    previewMixerColor() {
      const hex = utils.rgbToHex(this.elements.redSlider.value, this.elements.greenSlider.value, this.elements.blueSlider.value);
      const { r, g, b } = utils.hexToRgb(hex);
      this.elements.colorPreview.style.background = hex;
      this.elements.hexValue.textContent = hex.toUpperCase();
      this.elements.rgbValue.textContent = `${r}, ${g}, ${b}`;
      this.elements.binValue.textContent = `${utils.byteToBinary(r)} ${utils.byteToBinary(g)} ${utils.byteToBinary(b)}`;
      this.elements.redValue.textContent = String(r);
      this.elements.greenValue.textContent = String(g);
      this.elements.blueValue.textContent = String(b);
    },

    showInfoModal(title, text, icon = 'ℹ️') {
      return new Promise((resolve) => {
        this.elements.modalIcon.textContent = icon;
        this.elements.modalTitle.textContent = title;
        this.elements.modalText.textContent = text;
        this.elements.modalCancel.classList.add('hidden');
        this.elements.modalConfirm.textContent = 'Гаразд';
        this.elements.modalOverlay.classList.remove('hidden');
        this.elements.modalOverlay.classList.add('active');
        this.elements.modalOverlay.setAttribute('aria-hidden', 'false');
        const close = () => {
          this.elements.modalOverlay.classList.add('hidden');
          this.elements.modalOverlay.classList.remove('active');
          this.elements.modalOverlay.setAttribute('aria-hidden', 'true');
          resolve(true);
        };
        this.elements.modalConfirm.addEventListener('click', close, { once: true });
      });
    },

    showConfirmModal(title, text, icon = '❓', confirmText = 'Продовжити') {
      return new Promise((resolve) => {
        this.elements.modalIcon.textContent = icon;
        this.elements.modalTitle.textContent = title;
        this.elements.modalText.textContent = text;
        this.elements.modalCancel.classList.remove('hidden');
        this.elements.modalConfirm.textContent = confirmText;
        this.elements.modalOverlay.classList.remove('hidden');
        this.elements.modalOverlay.classList.add('active');
        this.elements.modalOverlay.setAttribute('aria-hidden', 'false');
        const cleanup = (result) => {
          this.elements.modalOverlay.classList.add('hidden');
          this.elements.modalOverlay.classList.remove('active');
          this.elements.modalOverlay.setAttribute('aria-hidden', 'true');
          resolve(result);
        };
        this.elements.modalConfirm.addEventListener('click', () => cleanup(true), { once: true });
        this.elements.modalCancel.addEventListener('click', () => cleanup(false), { once: true });
      });
    },

    beginRename(onCommit) {
      const current = state.fileName;
      const input = document.createElement('input');
      input.className = 'filename-input';
      input.value = current;
      input.maxLength = 60;
      this.elements.fileName.replaceWith(input);
      input.focus();
      input.select();

      const finish = (commit) => {
        const next = commit ? (input.value.trim() || constants.DEFAULT_FILE_NAME) : current;
        state.fileName = next;
        const span = document.createElement('span');
        span.id = 'fileName';
        span.setAttribute('role', 'button');
        span.setAttribute('tabindex', '0');
        span.setAttribute('title', 'Перейменувати файл');
        span.textContent = next;
        input.replaceWith(span);
        this.elements.fileName = span;
        if (commit && typeof onCommit === 'function') onCommit(next);
      };

      input.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') finish(true);
        if (event.key === 'Escape') finish(false);
      });
      input.addEventListener('blur', () => finish(true), { once: true });
    }
  };

  window.ArtMalyunky.ui = ui;
})();
