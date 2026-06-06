'use strict';
/* ui/toolbar.js — панель форматування */

const ArtToolbar = (() => {
  let _editor = null;
  const FONTS = ['Arial', 'Times New Roman', 'Calibri', 'Verdana', 'Georgia', 'Courier New', 'Trebuchet MS'];
  const SIZES = [8, 9, 10, 11, 12, 14, 16, 18, 20, 24, 28, 32, 36, 48, 72];
  const TEXT_COLORS = ['#1e293b', '#111827', '#dc2626', '#ea580c', '#ca8a04', '#16a34a', '#0891b2', '#2563eb', '#7c3aed', '#db2777', '#ffffff', '#64748b'];
  const HIGHLIGHT_COLORS = ['#fef08a', '#fde68a', '#fdba74', '#fecaca', '#bfdbfe', '#c7d2fe', '#ddd6fe', '#bbf7d0', '#a7f3d0', '#fbcfe8', '#e5e7eb', '#ffffff'];

  function init(editorEl) {
    _editor = editorEl;
    _buildFontSelect();
    _buildSizeSelect();
    _buildPalettes();
    _bindEvents();
  }

  function _buildFontSelect() {
    const sel = document.getElementById('tbFontFamily');
    sel.innerHTML = '';
    FONTS.forEach(font => {
      const opt = document.createElement('option');
      opt.value = font;
      opt.textContent = font;
      opt.style.fontFamily = font;
      sel.appendChild(opt);
    });
    sel.value = ArtState.get('fontFamily');
    sel.addEventListener('change', () => run(() => {
      ArtSelection.applyInlineStyle(_editor, { fontFamily: sel.value });
      ArtState.set('fontFamily', sel.value);
    }));
  }

  function _buildSizeSelect() {
    const sel = document.getElementById('tbFontSize');
    sel.innerHTML = '';
    SIZES.forEach(size => {
      const opt = document.createElement('option');
      opt.value = size;
      opt.textContent = size;
      sel.appendChild(opt);
    });
    sel.value = String(ArtState.get('fontSize'));
    sel.addEventListener('change', () => run(() => {
      ArtSelection.applyInlineStyle(_editor, { fontSize: `${sel.value}pt` });
      ArtState.set('fontSize', Number(sel.value));
    }));
  }

  function _buildPalettes() {
    _mountSwatches('textSwatches', TEXT_COLORS, color => applyColor(color));
    _mountSwatches('highlightSwatches', HIGHLIGHT_COLORS, color => applyHighlight(color));

    document.getElementById('textNoColor')?.addEventListener('click', clearColor);
    document.getElementById('highlightNoColor')?.addEventListener('click', clearHighlight);

    document.getElementById('textCustomColor')?.addEventListener('mousedown', e => e.preventDefault());
    document.getElementById('highlightCustomColor')?.addEventListener('mousedown', e => e.preventDefault());
    document.getElementById('textCustomColor')?.addEventListener('input', e => applyColor(e.target.value));
    document.getElementById('highlightCustomColor')?.addEventListener('input', e => applyHighlight(e.target.value));
  }

  function _mountSwatches(id, colors, handler) {
    const host = document.getElementById(id);
    if (!host) return;
    host.innerHTML = '';
    colors.forEach(color => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'palette-swatch';
      btn.style.setProperty('--swatch', color);
      btn.setAttribute('aria-label', `Вибрати колір ${color}`);
      btn.addEventListener('mousedown', e => e.preventDefault());
      btn.addEventListener('click', () => handler(color));
      host.appendChild(btn);
    });
  }

  function _bindEvents() {
    document.querySelectorAll('[data-cmd]').forEach(btn => {
      btn.addEventListener('mousedown', e => e.preventDefault());
      btn.addEventListener('click', () => applyCommand(btn.dataset.cmd));
    });

    document.querySelectorAll('.palette-toggle').forEach(btn => {
      btn.addEventListener('mousedown', e => e.preventDefault());
      btn.addEventListener('click', e => {
        ArtSelection.remember(_editor);
        e.stopPropagation();
        togglePalette(btn.dataset.palette);
      });
    });
    document.addEventListener('click', e => {
      if (!e.target.closest('.palette-wrap')) closePalettes();
    });

    ['keyup', 'mouseup', 'focus', 'selectionchange'].forEach(evt => {
      document.addEventListener(evt, () => {
        if (document.activeElement === _editor || _editor.contains(document.activeElement)) {
          updateState();
          ArtSelection.remember(_editor);
        }
      });
    });
  }

  function togglePalette(name) {
    document.querySelectorAll('.palette-popover').forEach(pop => {
      const isTarget = pop.id === `${name}Palette`;
      if (isTarget) {
        if (pop.hasAttribute('hidden')) pop.removeAttribute('hidden');
        else pop.setAttribute('hidden', '');
      } else {
        pop.setAttribute('hidden', '');
      }
    });
    document.querySelectorAll('.palette-toggle').forEach(btn => {
      btn.setAttribute('aria-expanded', String(btn.dataset.palette === name && document.getElementById(`${name}Palette`) && !document.getElementById(`${name}Palette`).hidden));
    });
  }

  function closePalettes() {
    document.querySelectorAll('.palette-popover').forEach(pop => pop.setAttribute('hidden', ''));
    document.querySelectorAll('.palette-toggle').forEach(btn => btn.setAttribute('aria-expanded', 'false'));
  }

  function applyCommand(cmd) {
    run(() => {
      switch (cmd) {
        case 'bold': ArtSelection.toggleInlineTag(_editor, 'strong'); break;
        case 'italic': ArtSelection.toggleInlineTag(_editor, 'em'); break;
        case 'underline': ArtSelection.toggleInlineTag(_editor, 'u'); break;
        case 'strikeThrough': ArtSelection.toggleInlineTag(_editor, 's'); break;
        case 'insertUnorderedList': ArtSelection.toggleList(_editor, 'ul'); break;
        case 'insertOrderedList': ArtSelection.toggleList(_editor, 'ol'); break;
        case 'indent': ArtSelection.indent(_editor); break;
        case 'outdent': ArtSelection.outdent(_editor); break;
      }
    });
  }

  function run(fn) {
    ArtSelection.focusEditor(_editor);
    fn();
    ArtSelection.normalizeEditor(_editor);
    _editor.dispatchEvent(new Event('input', { bubbles: true }));
    requestAnimationFrame(() => {
      ArtHistory.pushNow();
      updateState();
    });
  }

  function applyFont(family) {
    document.getElementById('tbFontFamily').value = family;
    run(() => {
      ArtSelection.applyInlineStyle(_editor, { fontFamily: family });
      ArtState.set('fontFamily', family);
    });
  }

  function applySize(pt) {
    document.getElementById('tbFontSize').value = String(pt);
    run(() => {
      ArtSelection.applyInlineStyle(_editor, { fontSize: `${pt}pt` });
      ArtState.set('fontSize', pt);
    });
  }

  function applyAlign(side) {
    run(() => {
      if (window.art?.editor?.hasSelectedImage?.()) {
        ArtEditor.setSelectedImageLayout(side);
        return;
      }
      ArtSelection.setAlignment(_editor, side);
    });
  }

  function applyHeading(tag) {
    run(() => {
      if (tag === 'p') ArtSelection.setBlockTag(_editor, 'p');
      else if (tag === 'blockquote') ArtSelection.setBlockTag(_editor, 'blockquote');
      else ArtSelection.setBlockTag(_editor, tag);
    });
  }

  function applyColor(color) {
    closePalettes();
    run(() => ArtSelection.applyInlineStyle(_editor, { color }, { syncDecorations: true }));
  }

  function applyHighlight(color) {
    closePalettes();
    run(() => ArtSelection.applyInlineStyle(_editor, { backgroundColor: color }));
  }

  function clearColor() {
    closePalettes();
    run(() => ArtSelection.clearInlineStyle(_editor, ['color', 'textDecorationColor']));
  }

  function clearHighlight() {
    closePalettes();
    run(() => ArtSelection.clearInlineStyle(_editor, ['backgroundColor']));
  }

  function updateState() {
    ['bold', 'italic', 'underline', 'strikeThrough', 'insertUnorderedList', 'insertOrderedList'].forEach(cmd => {
      const btn = document.querySelector(`[data-cmd="${cmd}"]`);
      if (!btn) return;
      const active = ArtSelection.queryState(_editor, cmd);
      if (window.OfficeUI?.setPressed) {
        window.OfficeUI.setPressed(btn, active);
      } else {
        btn.classList.toggle('active', active);
        btn.setAttribute('aria-pressed', String(active));
      }
    });
    const undo = document.getElementById('tbUndo');
    const redo = document.getElementById('tbRedo');
    if (undo) undo.disabled = !ArtHistory.canUndo();
    if (redo) redo.disabled = !ArtHistory.canRedo();
  }

  return { init, applyCommand, applyFont, applySize, applyAlign, applyHeading, applyColor, applyHighlight, updateState, run, FONTS, SIZES, closePalettes };
})();
