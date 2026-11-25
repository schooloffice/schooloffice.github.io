'use strict';

window.TextApp = window.TextApp || {};

function runOfficeCommand(command) {
  return window.OfficeShell?.runCommand?.(command) || false;
}

function createShellCommands() {
  return {
    new: () => ArtMenu.dispatch('new'),
    open: () => ArtMenu.dispatch('open'),
    save: () => ArtEditor.saveAs('docx'),
    undo: () => {
      ArtHistory.undo();
      ArtToolbar.updateState();
    },
    redo: () => {
      ArtHistory.redo();
      ArtToolbar.updateState();
    }
  };
}

// Власне контекстне меню документа. Правий клік у клітинці таблиці відкриває окреме меню
// таблиці (ui/editor.js), тому сюди доходять лише кліки поза таблицями.
function bindTextContextMenu(editor) {
  const surface = document.querySelector('.editor-scroll');
  const hasSelection = () => {
    const range = ArtSelection.getRange(editor);
    return !!range && !range.collapsed;
  };
  const caretPoint = () => {
    const range = ArtSelection.getRange(editor);
    const rect = range?.getClientRects?.()[0] || range?.getBoundingClientRect?.();
    if (rect && (rect.width || rect.height)) return { x: rect.left, y: rect.bottom + 4 };
    const box = editor.getBoundingClientRect();
    return { x: box.left + 48, y: Math.max(box.top, 0) + 48 };
  };

  window.TextApp.contextMenu = window.OfficeUI?.bindContextMenu?.({
    surface,
    menu: 'textContextMenu',
    resolve: () => {
      ArtSelection.remember(editor);
      return { selection: hasSelection() };
    },
    prepare: (menu, context) => {
      menu.querySelectorAll('[data-context-action="cut"], [data-context-action="copy"]').forEach(item => {
        item.disabled = !context.selection;
      });
    },
    anchor: caretPoint,
    onAction: async action => {
      if (!ArtSelection.getRange(editor)) ArtSelection.restoreLast(editor);
      if (!ArtSelection.getRange(editor)) editor.focus({ preventScroll: true });
      await ArtMenu.dispatch(action);
      ArtToolbar.updateState();
    }
  }) || null;
}

window.TextApp.boot = async () => {
  const editor = document.getElementById('editor');
  const announcer = document.getElementById('ariaAnnouncer');
  if (!editor) return;

  ArtToolbar.init(editor);
  ArtMenu.init();
  ArtEditor.init(editor, announcer);
  ArtPage.init();
  ArtHistory.init(editor);
  ArtHistory.markSaved();
  ArtHistory.onButtonsUpdate(() => ArtToolbar.updateState());
  ArtToolbar.updateState();
  window.OfficeShell?.registerCommands?.('text', createShellCommands()) ||
    window.OfficeUI?.registerCommands?.(createShellCommands(), { source: 'text' });

  document.querySelectorAll('.tb-btn').forEach(button => {
    button.addEventListener('mousedown', event => event.preventDefault());
  });

  document.querySelector('[data-edit-file-name]')?.addEventListener('click', () => ArtEditor.editFileName());
  document.querySelector('[data-edit-file-name]')?.addEventListener('keydown', event => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      ArtEditor.editFileName();
    }
  });

  document.querySelectorAll('[data-menu-action]').forEach(button => {
    button.addEventListener('click', () => {
      if (button.dataset.officeCommand && runOfficeCommand(button.dataset.officeCommand)) return;
      ArtMenu.dispatch(button.dataset.menuAction);
    });
  });

  document.querySelectorAll('[data-history-action]').forEach(button => {
    button.addEventListener('click', () => {
      if (runOfficeCommand(button.dataset.historyAction)) return;
      if (button.dataset.historyAction === 'undo') ArtHistory.undo();
      else ArtHistory.redo();
      ArtToolbar.updateState();
    });
  });

  document.querySelector('[data-heading-select]')?.addEventListener('change', event => {
    ArtToolbar.applyHeading(event.target.value);
    event.target.value = 'p';
  });

  document.querySelectorAll('[data-align]').forEach(button => {
    button.addEventListener('click', () => ArtToolbar.applyAlign(button.dataset.align));
  });

  document.querySelectorAll('[data-table-action]').forEach(button => {
    button.addEventListener('mousedown', event => event.preventDefault());
    button.addEventListener('click', () => ArtEditor.tableAction(button.dataset.tableAction));
  });

  document.getElementById('tableMenuButton')?.addEventListener('click', event => {
    event.stopPropagation();
    ArtSelection.remember(editor);
    ArtEditor.toggleTableMenu(event.currentTarget, { focusFirst: event.detail === 0 });
  });

  document.querySelectorAll('[data-image-layout]').forEach(button => {
    button.addEventListener('click', () => ArtEditor.setSelectedImageLayout(button.dataset.imageLayout));
  });

  document.querySelectorAll('[data-open-modal]').forEach(el => {
    el.addEventListener('click', () => ArtModals.open(el.dataset.openModal));
    el.addEventListener('keydown', event => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        ArtModals.open(el.dataset.openModal);
      }
    });
  });

  document.querySelectorAll('[data-close-modal]').forEach(button => {
    button.addEventListener('click', () => ArtModals.close(button.dataset.closeModal));
  });

  document.querySelectorAll('[data-save-as]').forEach(button => {
    button.addEventListener('click', () => ArtEditor.saveAs(button.dataset.saveAs));
  });

  document.querySelector('[data-insert-table]')?.addEventListener('click', () => {
    ArtEditor.insertTable(
      Number(document.getElementById('tableRows')?.value),
      Number(document.getElementById('tableCols')?.value)
    );
  });

  ArtFind.init(editor);
  bindTextContextMenu(editor);

  document.querySelectorAll('[data-set-zoom]').forEach(button => {
    button.addEventListener('click', () => {
      ArtEditor.setZoom(Number(button.dataset.setZoom));
      ArtModals.close('modalZoom');
    });
  });

  document.querySelectorAll('[data-confirm-choice]').forEach(button => {
    button.addEventListener('click', () => {
      if (button.dataset.confirmChoice === 'yes') ArtModals.confirmYes();
      else ArtModals.confirmNo();
    });
  });

  document.addEventListener('keydown', async e => {
    const ctrl = e.ctrlKey || e.metaKey;
    if (!ctrl) return;

    const target = e.target;
    const isEditorTarget = target === editor || !!target?.closest?.('.page-content');
    const isFormField = !!target?.closest?.('input, textarea, select');
    if (isFormField && !isEditorTarget) return;

    const key = e.key.toLowerCase();
    const map = {
      n: () => runOfficeCommand('new'),
      b: () => ArtToolbar.applyCommand('bold'),
      i: () => ArtToolbar.applyCommand('italic'),
      u: () => ArtToolbar.applyCommand('underline'),
      z: () => runOfficeCommand(e.shiftKey ? 'redo' : 'undo'),
      y: () => runOfficeCommand('redo'),
      s: () => runOfficeCommand('save'),
      o: () => runOfficeCommand('open'),
      p: () => window.print(),
      f: () => ArtFind.open('find'),
      h: () => ArtFind.open('replace'),
      a: () => ArtSelection.selectAll(editor)
      // Ctrl+C, Ctrl+X і Ctrl+V тут не перехоплюються: браузер сам надсилає події copy,
      // cut і paste, і їх обробляє ArtEditor. Робота з буфером через navigator.clipboard
      // потребувала б дозволу сайту.
    };

    if (!map[key]) return;
    e.preventDefault();
    await map[key]();
    ArtToolbar.updateState();
  });

  window.art = {
    menu: ArtMenu, editor: ArtEditor, toolbar: ArtToolbar, modals: ArtModals, history: ArtHistory,
    page: ArtPage,
    find: ArtFind,
    state: ArtState,
    storage: ArtTextStorage,
    formats: { docx: ArtDocx, rtf: ArtRtf, txt: ArtTxt }
  };

  await ArtTextStorage.init(ArtEditor);
  return window.art;
};
