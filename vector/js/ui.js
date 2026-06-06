'use strict';

window.ArtVector = window.ArtVector || {};

(() => {
  const { utils, constants, state } = window.ArtVector;

  const ui = {
    elements: {},
    openMenuName: null,
    openPickerName: null,

    init() {
      this.cacheElements();
      this.renderPalette();
      this.bindMenus();
      this.updateAll();
      return this.elements;
    },

    cacheElements() {
      this.elements = {
        modalOverlay: utils.$('modalOverlay'),
        modalIcon: utils.$('modalIcon'),
        modalTitle: utils.$('modalTitle'),
        modalText: utils.$('modalText'),
        modalInputWrap: utils.$('modalInputWrap'),
        modalInput: utils.$('modalInput'),
        modalCancel: utils.$('modalCancel'),
        modalConfirm: utils.$('modalConfirm'),

        fileName: utils.$('fileName'),
        dirtyDot: utils.$('dirtyDot'),
        saveBadge: utils.$('saveBadge'),
        projectFileInput: utils.$('projectFileInput'),

        drawingSvg: utils.$('drawingSvg'),
        guideLayer: utils.$('guideLayer'),
        contentLayer: utils.$('contentLayer'),
        selectionLayer: utils.$('selectionLayer'),
        artboardWrap: utils.$('artboardWrap'),

        colorPalette: utils.$('colorPalette'),
        strokeTargetBtn: utils.$('strokeTargetBtn'),
        fillTargetBtn: utils.$('fillTargetBtn'),
        strokePreview: utils.$('strokePreview'),
        fillPreview: utils.$('fillPreview'),
        noFillBtn: utils.$('noFillBtn'),
        nativeColorPicker: utils.$('nativeColorPicker'),

        strokeWidthSlider: utils.$('strokeWidthSlider'),
        strokeWidthValue: utils.$('strokeWidthValue'),
        opacitySlider: utils.$('opacitySlider'),
        opacityValue: utils.$('opacityValue'),
        fontSizeSlider: utils.$('fontSizeSlider'),
        fontSizeValue: utils.$('fontSizeValue'),

        snapToggleBtn: utils.$('snapToggleBtn'),
        snapStateLabel: utils.$('snapStateLabel'),
        zoomValueBtn: utils.$('zoomValueBtn'),
        zoomValueButtons: utils.$$('.zoom-value'),
        selectionState: utils.$('selectionState'),

        drawGroupTrigger: utils.$('drawGroupTrigger'),
        drawGroupIcon: utils.$('drawGroupIcon'),
        drawGroupLabel: utils.$('drawGroupLabel'),
        shapeGroupTrigger: utils.$('shapeGroupTrigger'),
        shapeGroupIcon: utils.$('shapeGroupIcon'),
        shapeGroupLabel: utils.$('shapeGroupLabel'),
        toolPickerTriggers: utils.$$('.tool-group-trigger'),
        toolPickerMenus: utils.$$('.tool-picker-menu'),
        toolMenuOptions: utils.$$('.tool-menu-option'),

        statusCoords: utils.$('statusCoords'),
        statusTool: utils.$('statusTool'),
        statusSelection: utils.$('statusSelection'),
        statusStyle: utils.$('statusStyle'),
        statusZoom: utils.$('statusZoom'),
        statusCanvas: utils.$('statusCanvas'),

        menuTitles: utils.$$('.menu-title'),
        menuDropdowns: utils.$$('.menu-dropdown'),
        toolSwitches: utils.$$('.tool-switch[data-tool]'),
        guideButtons: utils.$$('.segmented-btn[data-guide]'),
        guideMenuItems: utils.$$('[data-action^="guide-"]'),
        snapMenuItem: document.querySelector('[data-action="toggle-snap"]')
      };
    },

    bindMenus() {
      this.elements.menuTitles.forEach((button) => {
        button.addEventListener('click', (event) => {
          event.stopPropagation();
          const name = button.dataset.menu;
          if (this.openMenuName === name) this.closeMenus();
          else this.openMenu(name);
        });
      });

      this.elements.toolPickerTriggers.forEach((button) => {
        button.addEventListener('click', (event) => {
          event.stopPropagation();
          const wrapper = button.closest('.tool-picker');
          const name = wrapper?.dataset.picker;
          if (!name) return;
          if (this.openPickerName === name) this.closeToolPickers();
          else this.openToolPicker(name);
        });
      });

      document.addEventListener('click', (event) => {
        if (!event.target.closest('.menu-item-wrap')) this.closeMenus();
        if (!event.target.closest('.tool-picker')) this.closeToolPickers();
      });

      document.addEventListener('office:overlayclose', (event) => {
        if (event.detail?.type === 'menu') this.openMenuName = null;
        if (event.detail?.type === 'picker') this.openPickerName = null;
      });
    },

    openMenu(name) {
      this.closeToolPickers();
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

    openToolPicker(name) {
      this.closeMenus();
      this.closeToolPickers();
      this.openPickerName = name;
      const wrap = document.querySelector(`.tool-picker[data-picker="${name}"]`);
      const trigger = wrap?.querySelector('.tool-group-trigger');
      if (!wrap || !trigger) return;
      wrap.classList.add('open');
      trigger.setAttribute('aria-expanded', 'true');
    },

    closeToolPickers() {
      this.openPickerName = null;
      utils.$$('.tool-picker').forEach((wrap) => wrap.classList.remove('open'));
      this.elements.toolPickerTriggers.forEach((trigger) => trigger.setAttribute('aria-expanded', 'false'));
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

    updateAll() {
      this.updateFileNameUI();
      this.updateDirtyUI();
      this.updateToolUI();
      this.updateColorUI();
      this.updateStrokeWidthUI();
      this.updateOpacityUI();
      this.updateFontSizeUI();
      this.updateGuideUI();
      this.updateSnapUI();
      this.updateZoomUI();
      this.updateCanvasInfo();
      this.updateSelectionStatus();
    },

    updateToolUI() {
      this.elements.toolSwitches.forEach((button) => {
        button.classList.toggle('active', button.dataset.tool === state.currentTool);
      });
      this.elements.toolMenuOptions.forEach((button) => {
        button.classList.toggle('active', button.dataset.tool === state.currentTool);
      });

      const drawTool = constants.TOOL_GROUPS.draw.includes(state.currentTool) ? state.currentTool : constants.TOOL_GROUPS.draw[0];
      const shapeTool = constants.TOOL_GROUPS.shape.includes(state.currentTool) ? state.currentTool : constants.TOOL_GROUPS.shape[0];
      this.updateToolGroupButton('draw', drawTool, this.elements.drawGroupTrigger, this.elements.drawGroupIcon, this.elements.drawGroupLabel);
      this.updateToolGroupButton('shape', shapeTool, this.elements.shapeGroupTrigger, this.elements.shapeGroupIcon, this.elements.shapeGroupLabel);

      this.elements.statusTool.textContent = `Інструмент: ${constants.TOOLS[state.currentTool]?.label || '—'}`;
    },

    updateToolGroupButton(groupName, toolName, trigger, iconNode, labelNode) {
      if (!trigger || !iconNode || !labelNode) return;
      const tool = constants.TOOLS[toolName] || { label: toolName, icon: 'fa-solid fa-shapes' };
      iconNode.className = tool.icon;
      labelNode.textContent = tool.label;
      trigger.classList.toggle('active', constants.TOOL_GROUPS[groupName].includes(state.currentTool));
      trigger.closest('.tool-picker')?.classList.toggle('is-active', constants.TOOL_GROUPS[groupName].includes(state.currentTool));
    },

    updateColorUI() {
      this.elements.strokeTargetBtn.classList.toggle('active', state.currentColorTarget === 'stroke');
      this.elements.fillTargetBtn.classList.toggle('active', state.currentColorTarget === 'fill');
      this.elements.strokePreview.style.background = state.currentStroke;
      if (state.currentFill === 'none') {
        this.elements.fillPreview.classList.add('no-fill');
        this.elements.fillPreview.style.background = '';
      } else {
        this.elements.fillPreview.classList.remove('no-fill');
        this.elements.fillPreview.style.background = state.currentFill;
      }
      this.elements.nativeColorPicker.value = state.currentColorTarget === 'stroke'
        ? state.currentStroke
        : (state.currentFill === 'none' ? '#ffffff' : state.currentFill);
      utils.$$('.color-swatch', this.elements.colorPalette).forEach((button) => {
        const activeColor = state.currentColorTarget === 'stroke' ? state.currentStroke : state.currentFill;
        button.classList.toggle('active', button.dataset.hex.toLowerCase() === String(activeColor).toLowerCase());
      });
      this.elements.statusStyle.textContent = `Контур: ${state.currentStroke.toUpperCase()} · Заливка: ${state.currentFill === 'none' ? 'немає' : state.currentFill.toUpperCase()}`;
    },

    updateStrokeWidthUI() {
      this.elements.strokeWidthSlider.value = String(state.currentStrokeWidth);
      this.elements.strokeWidthValue.textContent = `${state.currentStrokeWidth} px`;
    },

    updateOpacityUI() {
      this.elements.opacitySlider.value = String(state.currentOpacity);
      this.elements.opacityValue.textContent = `${state.currentOpacity}%`;
    },

    updateFontSizeUI() {
      this.elements.fontSizeSlider.value = String(state.currentFontSize);
      this.elements.fontSizeValue.textContent = `${state.currentFontSize} px`;
    },

    updateGuideUI() {
      this.elements.guideButtons.forEach((button) => {
        button.classList.toggle('active', button.dataset.guide === state.guideMode);
      });
      const guideAction = `guide-${state.guideMode}`;
      this.elements.guideMenuItems.forEach((button) => {
        button.classList.toggle('checked', button.dataset.action === guideAction);
      });
    },

    updateSnapUI() {
      if (this.elements.snapToggleBtn) {
        this.elements.snapToggleBtn.classList.toggle('active', state.snapToGrid);
      }
      if (this.elements.snapStateLabel) this.elements.snapStateLabel.textContent = state.snapToGrid ? 'Увімкнено' : 'Вимкнено';
      if (this.elements.snapMenuItem) {
        this.elements.snapMenuItem.classList.toggle('checked', state.snapToGrid);
      }
    },

    updateZoomUI() {
      const value = `${Math.round(state.zoom * 100)}%`;
      this.elements.zoomValueButtons.forEach((button) => {
        button.textContent = value;
        button.title = value;
      });
      this.elements.statusZoom.textContent = `Масштаб: ${value}`;
    },

    updateCanvasInfo() {
      this.elements.statusCanvas.textContent = `Полотно: ${state.canvasWidth} × ${state.canvasHeight}`;
      this.elements.artboardWrap.style.setProperty('--zoom', String(state.zoom));
      this.elements.artboardWrap.style.setProperty('--canvas-width', `${state.canvasWidth}px`);
    },

    updateCoords(x = 0, y = 0) {
      this.elements.statusCoords.textContent = `X: ${Math.round(x)}, Y: ${Math.round(y)}`;
    },

    updateSelectionStatus(selectedObject = null) {
      if (!selectedObject) {
        this.elements.statusSelection.textContent = 'Вибрано: нічого';
        if (this.elements.selectionState) {
          this.elements.selectionState.textContent = 'Нічого не вибрано';
          this.elements.selectionState.classList.add('is-empty');
        }
        return;
      }
      const label = constants.TOOLS[selectedObject.type]?.label
        || ({ rect: 'Прямокутник', ellipse: 'Еліпс', triangle: 'Трикутник', diamond: 'Ромб', star: 'Зірка', line: 'Лінія', arrow: 'Стрілка', pen: 'Олівець', text: 'Текст' }[selectedObject.type] || selectedObject.type);
      this.elements.statusSelection.textContent = `Вибрано: ${label}`;
      if (this.elements.selectionState) {
        this.elements.selectionState.textContent = `Вибрано: ${label}`;
        this.elements.selectionState.classList.remove('is-empty');
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
      clearTimeout(this.saveBadgeTimeout);
      this.saveBadgeTimeout = setTimeout(() => {
        this.elements.saveBadge.style.opacity = '0';
      }, 1600);
    },

    showDialog({ title, text, icon = '✏️', withCancel = true, confirmText = 'Гаразд', inputValue = null, multiline = true }) {
      this.elements.modalIcon.textContent = icon;
      this.elements.modalTitle.textContent = title;
      this.elements.modalText.textContent = text;
      this.elements.modalConfirm.textContent = confirmText;
      this.elements.modalCancel.classList.toggle('hidden', !withCancel);
      const hasInput = inputValue !== null;
      this.elements.modalInputWrap.classList.toggle('hidden', !hasInput);
      this.elements.modalInput.value = hasInput ? inputValue : '';
      this.elements.modalInput.rows = multiline ? 5 : 1;
      this.elements.modalOverlay.classList.remove('hidden');
      this.elements.modalOverlay.classList.add('active');
      this.elements.modalOverlay.setAttribute('aria-hidden', 'false');
      if (hasInput) setTimeout(() => this.elements.modalInput.focus(), 10);

      return new Promise((resolve) => {
        const cleanup = (result) => {
          this.elements.modalOverlay.classList.add('hidden');
          this.elements.modalOverlay.classList.remove('active');
          this.elements.modalOverlay.setAttribute('aria-hidden', 'true');
          resolve(result);
        };

        this.elements.modalConfirm.addEventListener('click', () => cleanup(hasInput ? this.elements.modalInput.value : true), { once: true });
        this.elements.modalCancel.addEventListener('click', () => cleanup(false), { once: true });
      });
    },

    showInfoModal(title, text, icon = 'ℹ️') {
      return this.showDialog({ title, text, icon, withCancel: false, confirmText: 'Гаразд', inputValue: null });
    },

    showConfirmModal(title, text, icon = '❓', confirmText = 'Продовжити') {
      return this.showDialog({ title, text, icon, withCancel: true, confirmText, inputValue: null });
    },

    showPromptModal(title, text, initialValue = '') {
      return this.showDialog({ title, text, icon: '✏️', withCancel: true, confirmText: 'Застосувати', inputValue: initialValue, multiline: true });
    },

    beginRename(onCommit) {
      const current = state.fileName;
      const input = document.createElement('input');
      input.className = 'filename-input';
      input.value = current;
      input.maxLength = 80;
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

  window.ArtVector.ui = ui;
})();
