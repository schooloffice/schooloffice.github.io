'use strict';

window.ArtMalyunky = window.ArtMalyunky || {};

(() => {
  const { utils, constants, state } = window.ArtMalyunky;

  const ui = {
    elements: {},
    openMenuName: null,
    openPickerName: null,

    init() {
      this.cacheElements();
      this.renderBrushes();
      this.renderShapes();
      this.renderPalette();
      this.renderStamps();
      this.bindMenus();
      this.bindPickers();
      this.bindAdvancedColorPanel();
      this.updateToolUI();
      this.updateShapeUI();
      this.updateStampUI();
      this.updateColorUI();
      this.updateSizeUI();
      this.updateOpacityUI();
      this.updateGuideUI();
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
        canvasStage: utils.$('canvasStage'),

        brushGrid: utils.$('brushGrid'),
        shapeGrid: utils.$('shapeGrid'),
        stampGrid: utils.$('stampGrid'),
        colorPalette: utils.$('colorPalette'),
        nativeColorPicker: utils.$('nativeColorPicker'),
        shuffleStampsBtn: utils.$('shuffleStampsBtn'),

        brushPickerTrigger: utils.$('brushPickerTrigger'),
        brushTriggerIcon: utils.$('brushTriggerIcon'),
        brushTriggerLabel: utils.$('brushTriggerLabel'),
        shapePickerTrigger: utils.$('shapePickerTrigger'),
        shapeTriggerLabel: utils.$('shapeTriggerLabel'),
        stampPickerTrigger: utils.$('stampPickerTrigger'),
        stampTriggerEmoji: utils.$('stampTriggerEmoji'),
        stampTriggerLabel: utils.$('stampTriggerLabel'),

        sizeSlider: utils.$('sizeSlider'),
        opacitySlider: utils.$('opacitySlider'),
        sizeValue: utils.$('sizeValue'),
        opacityValue: utils.$('opacityValue'),

        advancedColorBtn: utils.$('advancedColorBtn'),
        advancedColorPanel: utils.$('advancedColorPanel'),
        closeAdvancedColorBtn: utils.$('closeAdvancedColorBtn'),
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
        pickerWraps: utils.$$('.picker-wrap'),
        pickerTriggers: utils.$$('.picker-trigger[data-picker]'),
        guideButtons: utils.$$('.segmented-btn[data-guide]'),
        toolSwitches: utils.$$('.tool-switch[data-tool]'),

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

    bindPickers() {
      this.elements.pickerTriggers.forEach((trigger) => {
        trigger.addEventListener('click', (event) => {
          event.stopPropagation();
          this.closeMenus();
          const name = trigger.dataset.picker;
          if (this.openPickerName === name) this.closePickers();
          else this.openPicker(name);
        });
      });

      document.addEventListener('click', (event) => {
        if (!event.target.closest('.picker-wrap')) this.closePickers();
      });

      document.addEventListener('office:overlayclose', (event) => {
        if (event.detail?.type === 'picker') this.openPickerName = null;
      });
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

    openPicker(name) {
      this.closePickers();
      this.openPickerName = name;
      const wrap = document.querySelector(`.picker-trigger[data-picker="${name}"]`)?.parentElement;
      if (!wrap) return;
      wrap.classList.add('open');
      wrap.querySelector('.picker-trigger')?.classList.add('active');
    },

    closePickers() {
      this.openPickerName = null;
      this.elements.pickerWraps.forEach((wrap) => wrap.classList.remove('open'));
      this.elements.pickerTriggers.forEach((trigger) => trigger.classList.remove('active'));
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
      const brushInfo = constants.BRUSHES[state.currentBrush];
      this.elements.toolSwitches.forEach((button) => {
        button.classList.toggle('active', button.dataset.tool === state.currentTool);
      });
      this.elements.brushPickerTrigger.classList.toggle('active', state.currentTool === 'brush');
      this.elements.shapePickerTrigger.classList.toggle('active', state.currentTool === 'shapes');
      this.elements.stampPickerTrigger.classList.toggle('active', state.currentTool === 'stamps');
      this.elements.brushTriggerIcon.className = `fa-solid ${brushInfo.icon}`;
      this.elements.brushTriggerLabel.textContent = `Пензлик · ${brushInfo.label}`;
      this.elements.statusTool.textContent = `Інструмент: ${toolInfo.label}`;
      this.updateDetailStatus();
      this.elements.drawingCanvas.style.cursor = toolInfo.cursor;
    },

    updateShapeUI() {
      utils.$$('.shape-option', this.elements.shapeGrid).forEach((button) => {
        button.classList.toggle('active', button.dataset.shape === state.currentShape);
      });
      this.elements.shapeTriggerLabel.textContent = constants.SHAPES[state.currentShape]?.label || 'Фігури';
      this.updateDetailStatus();
    },

    updateStampUI() {
      utils.$$('.stamp-option', this.elements.stampGrid).forEach((button) => {
        button.classList.toggle('active', button.dataset.stamp === state.currentStamp);
      });
      this.elements.stampTriggerEmoji.textContent = state.currentStamp;
      this.elements.stampTriggerLabel.textContent = 'Штампи';
      this.updateDetailStatus();
    },

    updateColorUI() {
      utils.$$('.color-swatch', this.elements.colorPalette).forEach((button) => {
        button.classList.toggle('active', button.dataset.hex.toLowerCase() === state.currentColor.toLowerCase());
      });
      this.elements.nativeColorPicker.value = state.currentColor;
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

    updateDetailStatus(selectedObject = null) {
      if (!selectedObject && state.selectedObjectId && window.ArtMalyunky.canvasApi?.getObjectById) {
        selectedObject = window.ArtMalyunky.canvasApi.getObjectById(state.selectedObjectId);
      }
      if (selectedObject) {
        if (selectedObject.kind === 'stamp') {
          this.elements.statusDetail.textContent = `Вибрано: штамп ${selectedObject.stamp}`;
          return;
        }
        const shapeName = constants.SHAPES[selectedObject.shape]?.label || 'Фігура';
        this.elements.statusDetail.textContent = `Вибрано: ${shapeName}`;
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
