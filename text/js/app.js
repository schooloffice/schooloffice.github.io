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

window.TextApp.boot = () => {
  const editor = document.getElementById('editor');
  const announcer = document.getElementById('ariaAnnouncer');
  if (!editor) return;

  ArtToolbar.init(editor);
  ArtMenu.init();
  ArtEditor.init(editor, announcer);
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

  const findInput = document.querySelector('[data-find-input]');
  const findNext = () => ArtEditor.findNext(document.getElementById('findInput')?.value || '');
  findInput?.addEventListener('keydown', event => {
    if (event.key === 'Enter') findNext();
  });
  document.querySelector('[data-find-next]')?.addEventListener('click', findNext);

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
    const isEditorTarget = !!target?.closest?.('.page-content');
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
      f: () => ArtModals.open('modalFind'),
      a: () => ArtSelection.selectAll(editor),
      c: () => ArtSelection.copy(editor),
      x: async () => {
        await ArtSelection.cut(editor);
        editor.dispatchEvent(new Event('input', { bubbles: true }));
        requestAnimationFrame(() => ArtHistory.pushNow());
      },
      v: async () => {
        await ArtSelection.pastePlainText(editor);
        editor.dispatchEvent(new Event('input', { bubbles: true }));
        requestAnimationFrame(() => ArtHistory.pushNow());
      }
    };

    if (!map[key]) return;
    e.preventDefault();
    await map[key]();
    ArtToolbar.updateState();
  });

  window.art = { menu: ArtMenu, editor: ArtEditor, toolbar: ArtToolbar, modals: ArtModals, history: ArtHistory };
};
