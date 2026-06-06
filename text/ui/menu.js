'use strict';
/* ui/menu.js — головне меню */

const ArtMenu = (() => {
  let _openMenu = null;

  function init() {
    document.querySelectorAll('.menu-title').forEach(title => {
      title.addEventListener('click', e => { e.stopPropagation(); toggle(title.dataset.menu, title); });
      title.addEventListener('keydown', e => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); title.click(); }
      });
    });

    document.addEventListener('click', closeAll);
    document.addEventListener('keydown', e => { if (e.key === 'Escape') closeAll(); });
    document.addEventListener('office:overlayclose', e => {
      if (e.detail?.type === 'menu') _openMenu = null;
    });

    document.querySelectorAll('.menu-item[data-action]').forEach(item => {
      item.addEventListener('click', e => {
        e.stopPropagation();
        closeAll();
        dispatch(item.dataset.action);
      });
    });
  }

  function toggle(name, titleEl) {
    if (_openMenu === name) return closeAll();
    closeAll();
    document.querySelector(`.menu-dropdown[data-menu="${name}"]`)?.classList.add('open');
    titleEl.setAttribute('aria-expanded', 'true');
    _openMenu = name;
  }

  function closeAll() {
    document.querySelectorAll('.menu-dropdown.open').forEach(el => el.classList.remove('open'));
    document.querySelectorAll('.menu-title').forEach(el => el.setAttribute('aria-expanded', 'false'));
    _openMenu = null;
  }

  async function dispatch(action) {
    const openFile = () => window.OfficeUI?.openFilePicker?.('fileInput') || document.getElementById('fileInput')?.click();
    switch (action) {
      case 'new':
        if (ArtState.isDirty()) ArtModals.confirm('Є незбережені зміни. Створити новий документ?', ArtEditor.newDoc);
        else ArtEditor.newDoc();
        break;
      case 'open':
        if (ArtState.isDirty()) ArtModals.confirm('Є незбережені зміни. Відкрити інший файл?', openFile);
        else openFile();
        break;
      case 'save-txt': return ArtEditor.saveAs('txt');
      case 'save-rtf': return ArtEditor.saveAs('rtf');
      case 'save-docx': return ArtEditor.saveAs('docx');
      case 'print': window.print(); break;
      case 'undo': ArtHistory.undo(); ArtToolbar.updateState(); break;
      case 'redo': ArtHistory.redo(); ArtToolbar.updateState(); break;
      case 'cut': { const editor = document.getElementById('editor'); await ArtSelection.cut(editor); editor.dispatchEvent(new Event('input', { bubbles: true })); requestAnimationFrame(() => ArtHistory.pushNow()); break; }
      case 'copy': await ArtSelection.copy(document.getElementById('editor')); break;
      case 'paste': { const editor = document.getElementById('editor'); await ArtSelection.pastePlainText(editor); editor.dispatchEvent(new Event('input', { bubbles: true })); requestAnimationFrame(() => ArtHistory.pushNow()); break; }
      case 'select-all': ArtSelection.selectAll(document.getElementById('editor')); break;
      case 'find': ArtModals.open('modalFind'); break;
      case 'orient-portrait': ArtEditor.setOrientation('portrait'); break;
      case 'orient-landscape': ArtEditor.setOrientation('landscape'); break;
      case 'zoom-75': ArtEditor.setZoom(75); break;
      case 'zoom-100': ArtEditor.setZoom(100); break;
      case 'zoom-125': ArtEditor.setZoom(125); break;
      case 'zoom-150': ArtEditor.setZoom(150); break;
      case 'insert-hr': ArtToolbar.run(() => ArtSelection.insertHorizontalRule(document.getElementById('editor'))); break;
      case 'insert-table': ArtModals.open('modalTable'); break;
      case 'insert-image': ArtEditor.openImageDialog(); break;
      case 'shortcuts': ArtModals.open('modalShortcuts'); break;
      case 'about': ArtModals.open('modalAbout'); break;
    }
  }

  return { init, dispatch, closeAll };
})();
