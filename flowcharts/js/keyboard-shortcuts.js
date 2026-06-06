(function () {
  'use strict';

  function detectMacPlatform() {
    const userAgentData = navigator.userAgentData;
    if (userAgentData && typeof userAgentData.platform === 'string') return /mac/i.test(userAgentData.platform);
    return /mac|iphone|ipad|ipod/i.test(navigator.userAgent || '');
  }

  function isTextInputActive() {
    const tag = (document.activeElement?.tagName || '').toLowerCase();
    return tag === 'input' || tag === 'textarea';
  }

  function createKeyboardShortcutsController(options) {
    const {
      state,
      runOfficeCommand,
      undo,
      redo,
      downloadProjectJson,
      openProjectFilePicker,
      openSaveTitlePrompt,
      cycleSelectedConnectionRouteMode,
      snapToggleButton,
      closeMenus,
      helpPanel,
      toggleHelp,
      closeModal,
      textModal,
      connectionModal,
      saveTitleModal,
      deleteSelected,
    } = options || {};

    const isMacPlatform = detectMacPlatform();

    function onKeydown(event) {
      const mod = isMacPlatform ? event.metaKey : event.ctrlKey;
      const key = event.key.toLowerCase();

      if (mod && key === 'z') {
        event.preventDefault();
        if (event.shiftKey) runOfficeCommand?.('redo') || redo?.();
        else runOfficeCommand?.('undo') || undo?.();
        return;
      }
      if (mod && key === 'y') {
        event.preventDefault();
        runOfficeCommand?.('redo') || redo?.();
        return;
      }
      if (mod && event.shiftKey && key === 's') {
        event.preventDefault();
        runOfficeCommand?.('save') || downloadProjectJson?.();
        return;
      }
      if (mod && key === 'o') {
        event.preventDefault();
        runOfficeCommand?.('open') || openProjectFilePicker?.();
        return;
      }
      if (mod && key === 's') {
        event.preventDefault();
        openSaveTitlePrompt?.();
        return;
      }
      if (!mod && key === 'r' && state?.selectedConnId) {
        if (!isTextInputActive()) {
          event.preventDefault();
          cycleSelectedConnectionRouteMode?.();
        }
        return;
      }
      if (!mod && key === 'g') {
        if (!isTextInputActive()) {
          event.preventDefault();
          snapToggleButton?.click();
        }
        return;
      }

      if (event.key === 'Escape') {
        closeMenus?.();
        if (helpPanel && !helpPanel.hidden) toggleHelp?.(false);
        closeModal?.(textModal);
        closeModal?.(connectionModal);
        closeModal?.(document.getElementById('message-modal'));
        closeModal?.(saveTitleModal);
        if (state) {
          state.pendingConn = null;
          state.activeShape = null;
        }
      }

      if (event.key === 'Delete' || event.key === 'Backspace') {
        if (isTextInputActive()) return;
        deleteSelected?.();
      }
    }

    function bind(target = document) {
      target.addEventListener('keydown', onKeydown);
    }

    return {
      bind,
      onKeydown,
    };
  }

  window.FlowchartsKeyboardShortcuts = {
    createKeyboardShortcutsController,
  };
})();
