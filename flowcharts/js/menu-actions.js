(function () {
  'use strict';

  const INSERT_ACTIONS = {
    'insert-start-end': 'start-end',
    'insert-process': 'process',
    'insert-decision': 'decision',
    'insert-input-output': 'input-output',
    'insert-subroutine': 'subroutine',
    'insert-connector': 'connector',
  };

  const ZOOM_ACTIONS = {
    'zoom-75': 0.75,
    'zoom-100': 1,
    'zoom-125': 1.25,
    'zoom-150': 1.5,
    'zoom-reset': 1,
  };

  function createMenuActionsController(options) {
    const {
      UI,
      helpPanel,
      helpButton,
      helpClose,
      clearButton,
      openProjectButton,
      saveProjectButton,
      saveButton,
      snapToggleButton,
      runOfficeCommand,
      undo,
      redo,
      deleteSelected,
      setZoom,
      showMessageModal,
    } = options || {};

    function triggerShapeButton(type) {
      document.querySelector(`.shape-button[data-shape="${type}"]`)?.click();
    }

    function toggleHelp(show) {
      if (!helpPanel) return;
      if (typeof show === 'boolean') {
        helpPanel.hidden = !show;
        return;
      }
      helpPanel.hidden = !helpPanel.hidden;
    }

    function dispatchMenuAction(action) {
      switch (action) {
        case 'new-project':
          (runOfficeCommand && runOfficeCommand('new')) || clearButton?.click();
          break;
        case 'open-project':
          (runOfficeCommand && runOfficeCommand('open')) || openProjectButton?.click();
          break;
        case 'save-project':
          (runOfficeCommand && runOfficeCommand('save')) || saveProjectButton?.click();
          break;
        case 'export-png':
          saveButton?.click();
          break;
        case 'print':
          window.print();
          break;
        case 'undo':
          (runOfficeCommand && runOfficeCommand('undo')) || undo?.();
          break;
        case 'redo':
          (runOfficeCommand && runOfficeCommand('redo')) || redo?.();
          break;
        case 'delete-selected':
          deleteSelected?.();
          break;
        case 'clear-canvas':
          clearButton?.click();
          break;
        case 'insert-start-end':
        case 'insert-process':
        case 'insert-decision':
        case 'insert-input-output':
        case 'insert-subroutine':
        case 'insert-connector':
          triggerShapeButton(INSERT_ACTIONS[action]);
          break;
        case 'zoom-75':
        case 'zoom-100':
        case 'zoom-125':
        case 'zoom-150':
        case 'zoom-reset':
          setZoom?.(ZOOM_ACTIONS[action]);
          break;
        case 'toggle-grid':
          snapToggleButton?.click();
          break;
        case 'help-panel':
          toggleHelp(true);
          break;
        case 'open-manual':
          window.open('manual.html', '_blank', 'noopener');
          break;
        case 'about':
          showMessageModal?.('ПЛЮС Схеми — редактор блок-схем для шкільного офісного пакета ПЛЮС. Він зберігає проєкти у JSON, експортує схеми у PNG та допомагає учням вивчати алгоритми на практиці.');
          break;
      }
    }

    function bind() {
      UI?.renderHelpPanelContent?.(helpPanel);
      helpButton?.addEventListener('click', () => toggleHelp());
      helpClose?.addEventListener('click', () => toggleHelp(false));
      return UI?.initMenus ? UI.initMenus(dispatchMenuAction) : null;
    }

    return {
      dispatchMenuAction,
      toggleHelp,
      bind,
    };
  }

  window.FlowchartsMenuActions = {
    createMenuActionsController,
  };
})();
