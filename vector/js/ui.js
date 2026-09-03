'use strict';

window.ArtVector = window.ArtVector || {};

(() => {
  const { utils, constants, state } = window.ArtVector;

  const ui = {
    elements: {},
    openMenuName: null,

    init() {
      this.cacheElements();
      this.renderPalette();
      this.bindMenus();
      this.updateAll();
      this.applyPanelState(this.isPanelCollapsed());
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

        canvasScroller: utils.$('canvasScroller'),

        railLineBtn: utils.$('railLineBtn'),
        railLineIcon: utils.$('railLineIcon'),
        railShapeBtn: utils.$('railShapeBtn'),
        railShapeIcon: utils.$('railShapeIcon'),
        panelToggleBtn: utils.$('panelToggleBtn'),
        panelToggleIcon: utils.$('panelToggleIcon'),
        propLine: utils.$('propLine'),
        propShape: utils.$('propShape'),
        lineToolName: utils.$('lineToolName'),
        shapeToolName: utils.$('shapeToolName'),
        propText: utils.$('propText'),
        propObject: utils.$('propObject'),

        statusCoords: utils.$('statusCoords'),
        statusTool: utils.$('statusTool'),
        statusSelection: utils.$('statusSelection'),
        statusStyle: utils.$('statusStyle'),
        statusZoom: utils.$('statusZoom'),
        statusCanvas: utils.$('statusCanvas'),

        menuTitles: utils.$$('.menu-title'),
        menuDropdowns: utils.$$('.menu-dropdown'),
        railTools: utils.$$('.rail-tool'),
        toolChips: utils.$$('.prop-chip[data-tool]'),
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

      document.addEventListener('click', (event) => {
        if (!event.target.closest('.menu-item-wrap')) this.closeMenus();
      });

      document.addEventListener('office:overlayclose', (event) => {
        if (event.detail?.type === 'menu') this.openMenuName = null;
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

    // Згорнутість панелі параметрів — дрібне UI-налаштування, тож localStorage
    // (не чернетка): воно має пережити «новий проєкт» і не залежати від документа.
    isPanelCollapsed() {
      try {
        return localStorage.getItem(constants.PANEL_STATE_KEY) === '1';
      } catch {
        return false;
      }
    },

    applyPanelState(collapsed) {
      document.body.classList.toggle('panel-collapsed', collapsed);
      const button = this.elements.panelToggleBtn;
      if (button) {
        button.setAttribute('aria-expanded', String(!collapsed));
        button.title = collapsed
          ? 'Показати панель параметрів (Ctrl+\\)'
          : 'Згорнути панель параметрів (Ctrl+\\)';
      }
      if (this.elements.panelToggleIcon) {
        this.elements.panelToggleIcon.className = collapsed
          ? 'fa-solid fa-chevron-right'
          : 'fa-solid fa-chevron-left';
      }
      try {
        localStorage.setItem(constants.PANEL_STATE_KEY, collapsed ? '1' : '0');
      } catch {
        // Налаштування необов'язкове: недоступне сховище не має ламати редактор.
      }
    },

    togglePanel() {
      const collapsed = !document.body.classList.contains('panel-collapsed');
      this.applyPanelState(collapsed);
      return collapsed;
    },

    renderPalette() {
      this.elements.colorPalette.replaceChildren();
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

    // Rail показує п'ять груп; конкретний підінструмент групи (яка саме фігура,
    // лінія чи стрілка) вибирається чипами в панелі параметрів. Іконка кнопки
    // групи повторює активний підінструмент, щоб вибір було видно і згорнутою панеллю.
    updateToolUI() {
      const activeGroup = constants.getToolGroup(state.currentTool);

      this.elements.railTools.forEach((button) => {
        const groupName = button.dataset.toolGroup;
        const isActive = groupName
          ? groupName === activeGroup
          : button.dataset.tool === state.currentTool;
        button.classList.toggle('active', isActive);
      });

      this.elements.toolChips.forEach((chip) => {
        chip.classList.toggle('active', chip.dataset.tool === state.currentTool);
      });

      this.updateGroupDisplay('line', this.elements.railLineIcon, this.elements.lineToolName);
      this.updateGroupDisplay('shape', this.elements.railShapeIcon, this.elements.shapeToolName);

      // Секція параметрів показується лише для активної групи.
      this.elements.propLine?.classList.toggle('hidden', activeGroup !== 'line');
      this.elements.propShape?.classList.toggle('hidden', activeGroup !== 'shape');
      this.elements.propText?.classList.toggle('hidden', state.currentTool !== 'text');

      this.elements.statusTool.textContent = `Інструмент: ${constants.TOOLS[state.currentTool]?.label || '—'}`;
    },

    // Іконка кнопки групи в rail і назва в заголовку секції показують той самий
    // активний підінструмент — вибір видно і зі згорнутою панеллю.
    updateGroupDisplay(groupName, iconNode, nameNode) {
      const members = constants.TOOL_GROUPS[groupName] || [];
      const toolName = members.includes(state.currentTool) ? state.currentTool : members[0];
      const tool = constants.TOOLS[toolName];
      if (iconNode) iconNode.className = tool?.icon || 'fa-solid fa-shapes';
      if (nameNode) nameNode.textContent = tool?.label || '';
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
      // Дії над об'єктом мають сенс лише при виділенні — інакше секція просто
      // витісняє «Підкладку» за нижній край панелі на ноутбуці.
      this.elements.propObject?.classList.toggle('hidden', !selectedObject);
      if (!selectedObject) {
        this.elements.statusSelection.textContent = 'Вибрано: нічого';
        if (this.elements.selectionState) this.elements.selectionState.textContent = '';
        return;
      }
      const label = constants.TOOLS[selectedObject.type]?.label
        || ({ rect: 'Прямокутник', ellipse: 'Еліпс', triangle: 'Трикутник', diamond: 'Ромб', star: 'Зірка', line: 'Лінія', arrow: 'Стрілка', pen: 'Олівець', text: 'Текст' }[selectedObject.type] || selectedObject.type);
      this.elements.statusSelection.textContent = `Вибрано: ${label}`;
      // Тип вибраного об'єкта живе в заголовку секції — окрема рамка з тим самим
      // текстом лише дублювала рядок стану й забирала висоту панелі.
      if (this.elements.selectionState) this.elements.selectionState.textContent = label;
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
