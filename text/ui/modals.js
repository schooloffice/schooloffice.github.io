'use strict';
/* ui/modals.js — модалки з focus trap */

const ArtModals = (() => {
  let _confirmCb = null;
  let _lastFocused = null;

  function open(id) {
    const el = document.getElementById(id);
    if (!el) return;
    _lastFocused = document.activeElement;
    if (!window.OfficeUI?.openModal?.(el, { focus: false, returnFocus: _lastFocused })) {
      el.classList.remove('hidden');
      el.classList.add('active');
      el.setAttribute('aria-hidden', 'false');
    }
    requestAnimationFrame(() => {
      (el.querySelector('[data-autofocus]') || el.querySelector('button,input,select,textarea'))?.focus();
    });
  }

  function close(id) {
    const el = document.getElementById(id);
    if (!el) return;
    if (!window.OfficeUI?.closeModal?.(el, { restoreFocus: false })) {
      el.classList.remove('active');
      el.classList.remove('hidden');
      el.setAttribute('aria-hidden', 'true');
    }
    _lastFocused?.focus?.();
  }

  function closeAll() {
    document.querySelectorAll('.modal-overlay.active').forEach(el => {
      if (!window.OfficeUI?.closeModal?.(el, { restoreFocus: false })) {
        el.classList.remove('active');
        el.classList.remove('hidden');
        el.setAttribute('aria-hidden', 'true');
      }
    });
    _lastFocused?.focus?.();
  }

  function info(title, text) {
    document.getElementById('modalInfoTitle').textContent = title;
    document.getElementById('modalInfoText').textContent = text;
    open('modalInfo');
  }

  function confirm(text, onYes, onNo = null) {
    document.getElementById('modalConfirmText').textContent = text;
    _confirmCb = { yes: onYes, no: onNo };
    open('modalConfirm');
  }

  function confirmYes() { close('modalConfirm'); _confirmCb?.yes?.(); _confirmCb = null; }
  function confirmNo() { close('modalConfirm'); _confirmCb?.no?.(); _confirmCb = null; }

  document.addEventListener('keydown', e => {
    const active = document.querySelector('.modal-overlay.active');
    if (!active) return;
    if (e.key === 'Escape') { e.preventDefault(); closeAll(); }
    if (e.key === 'Tab') {
      const focusables = [...active.querySelectorAll('button,[href],input,select,textarea,[tabindex]:not([tabindex="-1"])')]
        .filter(el => !el.disabled && el.offsetParent !== null);
      if (!focusables.length) return;
      const first = focusables[0], last = focusables[focusables.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
  });

  document.addEventListener('click', e => {
    if (e.target.classList.contains('modal-overlay')) closeAll();
  });

  return { open, close, closeAll, info, confirm, confirmYes, confirmNo };
})();
