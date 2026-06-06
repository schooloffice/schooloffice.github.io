(function () {
  'use strict';

  let globalsBound = false;
  let modalBehaviorBound = false;
  let statusbarBound = false;
  const commands = new Map();

  const focusableSelector = [
    'button:not([disabled])',
    '[href]',
    'input:not([disabled])',
    'select:not([disabled])',
    'textarea:not([disabled])',
    '[tabindex]:not([tabindex="-1"])'
  ].join(',');

  function qs(selector, root = document) {
    return root.querySelector(selector);
  }

  function qsa(selector, root = document) {
    return Array.from(root.querySelectorAll(selector));
  }

  function ensureId(element, prefix) {
    if (!element) return null;
    if (!element.id) element.id = `${prefix}-${Math.random().toString(36).slice(2)}`;
    return element.id;
  }

  function setAttributeIfChanged(element, name, value) {
    if (!element || element.getAttribute(name) === value) return;
    element.setAttribute(name, value);
  }

  function isVisible(element) {
    if (!element) return false;
    if (element.hidden || element.getAttribute('aria-hidden') === 'true') return false;
    if (element.classList.contains('hidden')) return false;
    if (element.classList.contains('modal-overlay') || element.classList.contains('modal')) {
      return element.classList.contains('active') ||
        (!element.classList.contains('hidden') && element.getAttribute('aria-hidden') === 'false');
    }
    return !!(element.offsetWidth || element.offsetHeight || element.getClientRects().length);
  }

  function getActiveModal() {
    return qsa('.modal-overlay, .modal')
      .filter(isVisible)
      .at(-1) || null;
  }

  function resolveModal(modalOrId) {
    if (typeof modalOrId === 'string') return document.getElementById(modalOrId);
    return modalOrId || null;
  }

  function getModalPanel(modal) {
    return qs('.modal-box, .modal-content, .choffice-modal-content, [role="dialog"], [role="alertdialog"]', modal) || modal;
  }

  function getFocusable(root) {
    return qsa(focusableSelector, root).filter(element => !element.closest('[hidden], .hidden'));
  }

  function dispatchOverlayClose(type, detail = {}) {
    document.dispatchEvent(new CustomEvent('office:overlayclose', {
      detail: { type, ...detail }
    }));
  }

  function normalizeCommandName(name) {
    return String(name || '').trim().toLowerCase();
  }

  function registerCommand(name, handler, options = {}) {
    const command = normalizeCommandName(name);
    if (!command || typeof handler !== 'function') return () => {};

    commands.set(command, {
      handler,
      label: options.label || command,
      source: options.source || document.body?.dataset?.officeService || 'local'
    });

    document.dispatchEvent(new CustomEvent('office:commandregistered', {
      detail: { command, label: commands.get(command).label, source: commands.get(command).source }
    }));

    return () => {
      if (commands.get(command)?.handler === handler) commands.delete(command);
    };
  }

  function registerCommands(commandMap, options = {}) {
    return Object.entries(commandMap || {}).map(([name, handler]) =>
      registerCommand(name, handler, options)
    );
  }

  function hasCommand(name) {
    return commands.has(normalizeCommandName(name));
  }

  function runCommand(name, detail = {}) {
    const command = normalizeCommandName(name);
    const entry = commands.get(command);
    if (!entry) return false;
    entry.handler({
      command,
      source: entry.source,
      label: entry.label,
      ...detail
    });
    return true;
  }

  function closeMenus({ restoreFocus = false } = {}) {
    const trigger = qs('.menu-title[aria-expanded="true"]');
    const openMenus = qsa('.menu-dropdown.open');
    const hadOpen = !!trigger || openMenus.length > 0;
    openMenus.forEach(menu => menu.classList.remove('open'));
    qsa('.menu-title').forEach(title => setAttributeIfChanged(title, 'aria-expanded', 'false'));
    if (restoreFocus && trigger) trigger.focus();
    if (hadOpen) dispatchOverlayClose('menu');
    return hadOpen;
  }

  function closePickers({ restoreFocus = false } = {}) {
    let trigger = null;
    let hadOpen = false;

    qsa('.picker-wrap.open').forEach(wrap => {
      hadOpen = true;
      trigger = trigger || qs('.picker-trigger', wrap);
      wrap.classList.remove('open');
    });
    qsa('.tool-picker.open').forEach(wrap => {
      hadOpen = true;
      trigger = trigger || qs('.tool-group-trigger', wrap);
      wrap.classList.remove('open');
    });

    qsa('.picker-trigger[aria-expanded="true"], .tool-group-trigger[aria-expanded="true"]').forEach(button => {
      trigger = trigger || button;
      setAttributeIfChanged(button, 'aria-expanded', 'false');
      button.classList.remove('active');
    });

    if (restoreFocus && trigger) trigger.focus();
    if (hadOpen || !!trigger) dispatchOverlayClose('picker');
    return hadOpen || !!trigger;
  }

  function closePalettes({ restoreFocus = false } = {}) {
    let trigger = null;
    let hadOpen = false;
    qsa('.palette-toggle[aria-expanded="true"]').forEach(button => {
      trigger = trigger || button;
      setAttributeIfChanged(button, 'aria-expanded', 'false');
    });
    qsa('.palette-popover').forEach(popover => {
      if (!popover.hasAttribute('hidden')) hadOpen = true;
      popover.setAttribute('hidden', '');
    });
    if (restoreFocus && trigger) trigger.focus();
    if (hadOpen || !!trigger) dispatchOverlayClose('palette');
    return hadOpen || !!trigger;
  }

  function openModal(modalOrId, { focus = true, returnFocus = document.activeElement } = {}) {
    const modal = resolveModal(modalOrId);
    if (!modal) return false;

    if (returnFocus && returnFocus instanceof HTMLElement && !modal.contains(returnFocus)) {
      modal.dataset.officeReturnFocus = ensureId(returnFocus, 'office-return-focus');
    }

    modal.hidden = false;
    modal.classList.remove('hidden');
    modal.classList.add('active');
    setAttributeIfChanged(modal, 'aria-hidden', 'false');
    enhanceModal(modal);
    if (focus) syncModalState(modal);
    return true;
  }

  function closeModal(modal, { restoreFocus = true } = {}) {
    modal = resolveModal(modal);
    if (!modal) return false;
    modal.classList.remove('active');
    modal.classList.add('hidden');
    setAttributeIfChanged(modal, 'aria-hidden', 'true');
    if (restoreFocus) {
      const triggerId = modal.dataset.officeReturnFocus;
      const trigger = triggerId ? document.getElementById(triggerId) : null;
      if (trigger) trigger.focus();
    }
    dispatchOverlayClose('modal', { modal });
    return true;
  }

  function closeActiveModal({ restoreFocus = true } = {}) {
    return closeModal(getActiveModal(), { restoreFocus });
  }

  function closeTopOverlay({ restoreFocus = false } = {}) {
    return closeActiveModal({ restoreFocus }) ||
      closeMenus({ restoreFocus }) ||
      closePickers({ restoreFocus }) ||
      closePalettes({ restoreFocus });
  }

  function setPressed(target, pressed, activeClass = 'active') {
    const elements = typeof target === 'string'
      ? qsa(target)
      : (target instanceof Element ? [target] : Array.from(target || []));
    elements.forEach(element => {
      element.classList.toggle(activeClass, pressed);
      setAttributeIfChanged(element, 'aria-pressed', String(pressed));
    });
  }

  function openFilePicker(inputOrId) {
    const input = typeof inputOrId === 'string' ? document.getElementById(inputOrId) : inputOrId;
    if (!(input instanceof HTMLInputElement) || input.type !== 'file') return false;
    input.value = '';
    input.click();
    return true;
  }

  function openMenuFromTitle(title, focusFirstItem = false) {
    const name = title?.dataset?.menu;
    if (!name) return;
    closeTopOverlay();
    setAttributeIfChanged(title, 'aria-expanded', 'true');
    const escapedName = window.CSS?.escape ? CSS.escape(name) : name.replace(/"/g, '\\"');
    const menu = qs(`.menu-dropdown[data-menu="${escapedName}"]`);
    menu?.classList.add('open');
    if (focusFirstItem) {
      qs(focusableSelector, menu)?.focus();
    }
  }

  function moveMenuFocus(menu, current, direction) {
    const items = qsa(focusableSelector, menu);
    if (!items.length) return;
    const currentIndex = Math.max(0, items.indexOf(current));
    const nextIndex = (currentIndex + direction + items.length) % items.length;
    items[nextIndex].focus();
  }

  function bindMenuKeyboard() {
    qsa('.menu-title').forEach(title => {
      if (title.dataset.officeKeyboardBound === 'true') return;
      title.dataset.officeKeyboardBound = 'true';
      title.addEventListener('keydown', event => {
        if (event.key === 'ArrowDown') {
          event.preventDefault();
          openMenuFromTitle(title, true);
        }
        if (event.key === 'Escape') {
          if (closeTopOverlay({ restoreFocus: true })) {
            event.preventDefault();
            event.stopPropagation();
          }
        }
      });
    });

    qsa('.menu-dropdown').forEach(menu => {
      if (menu.dataset.officeKeyboardBound === 'true') return;
      menu.dataset.officeKeyboardBound = 'true';
      menu.addEventListener('keydown', event => {
        if (event.key === 'Escape') {
          event.preventDefault();
          event.stopPropagation();
          closeMenus({ restoreFocus: true });
          return;
        }
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
          event.preventDefault();
          moveMenuFocus(menu, event.target, event.key === 'ArrowDown' ? 1 : -1);
          return;
        }
        if (event.key === 'Home' || event.key === 'End') {
          event.preventDefault();
          const items = qsa(focusableSelector, menu);
          if (items.length) items[event.key === 'Home' ? 0 : items.length - 1].focus();
        }
      });
    });
  }

  function bindGlobalOverlayBehavior() {
    if (globalsBound) return;
    globalsBound = true;

    document.addEventListener('keydown', event => {
      if (event.key !== 'Escape') return;
      if (closeTopOverlay({ restoreFocus: true })) {
        event.preventDefault();
        event.stopPropagation();
      }
    }, true);

    document.addEventListener('pointerdown', event => {
      if (getActiveModal()?.contains(event.target)) return;
      if (event.target.closest('.menu-item-wrap, .menu-title, .menu-dropdown, .picker-wrap, .tool-picker, .palette-wrap, .palette-popover')) return;
      closeTopOverlay();
    }, true);
  }

  function enhanceModal(modal) {
    if (modal.dataset.officeModalEnhanced === 'true') return;
    modal.dataset.officeModalEnhanced = 'true';
    modal.classList.add('office-modal-backdrop');
    if (!modal.id) modal.id = `office-modal-${Math.random().toString(36).slice(2)}`;

    const panel = getModalPanel(modal);
    if (!panel.classList.contains('modal-box')) {
      panel.classList.add('office-modal');
    }
    if (!panel.getAttribute('role')) {
      panel.setAttribute('role', modal.getAttribute('role') || 'dialog');
    }
    setAttributeIfChanged(panel, 'aria-modal', 'true');

    const title = qs('.modal-title, h2, h3, [id$="Title"]', panel);
    if (title && !panel.getAttribute('aria-labelledby')) {
      if (!title.id) title.id = `${modal.id}-title`;
      setAttributeIfChanged(panel, 'aria-labelledby', title.id);
    }

    if (!isVisible(modal)) {
      setAttributeIfChanged(modal, 'aria-hidden', 'true');
    }

    modal.addEventListener('pointerdown', event => {
      if (event.target === modal && modal.dataset.officeBackdropClose !== 'false') {
        closeModal(modal);
      }
    });
  }

  function syncModalState(modal) {
    const visible = isVisible(modal);
    setAttributeIfChanged(modal, 'aria-hidden', visible ? 'false' : 'true');
    if (!visible) return;

    const active = document.activeElement;
    if (active && !modal.contains(active) && active.id) {
      modal.dataset.officeReturnFocus = active.id;
    }

    const panel = getModalPanel(modal);
    const target = qs('[data-autofocus]', panel) || getFocusable(panel)[0] || panel;
    if (!panel.hasAttribute('tabindex')) panel.setAttribute('tabindex', '-1');
    setTimeout(() => {
      if (!panel.contains(document.activeElement)) {
        target?.focus?.();
      }
    }, 0);
  }

  function bindModalBehavior() {
    qsa('.modal-overlay, .modal').forEach(enhanceModal);
    if (modalBehaviorBound) return;
    modalBehaviorBound = true;

    const observer = new MutationObserver(records => {
      const changed = new Set();
      records.forEach(record => {
        if (record.target instanceof HTMLElement && record.target.matches('.modal-overlay, .modal')) {
          changed.add(record.target);
        }
        record.addedNodes.forEach(node => {
          if (!(node instanceof HTMLElement)) return;
          if (node.matches('.modal-overlay, .modal')) {
            enhanceModal(node);
            changed.add(node);
          }
          qsa('.modal-overlay, .modal', node).forEach(modal => {
            enhanceModal(modal);
            changed.add(modal);
          });
        });
      });
      changed.forEach(syncModalState);
    });
    observer.observe(document.body, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ['class', 'hidden', 'aria-hidden']
    });

    document.addEventListener('keydown', event => {
      const modal = getActiveModal();
      if (!modal) return;
      const panel = getModalPanel(modal);
      if (event.key === 'Escape' && modal.dataset.officeEscapeClose !== 'false') {
        event.preventDefault();
        event.stopPropagation();
        closeModal(modal);
        return;
      }
      if (event.key !== 'Tab') return;
      const items = getFocusable(panel);
      if (!items.length) {
        event.preventDefault();
        panel.focus();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }, true);
  }

  function ensureLiveRegion() {
    let region = qs('#office-live-region');
    if (region) return region;

    region = document.createElement('div');
    region.id = 'office-live-region';
    region.setAttribute('aria-live', 'polite');
    region.setAttribute('aria-atomic', 'true');
    region.style.position = 'absolute';
    region.style.width = '1px';
    region.style.height = '1px';
    region.style.padding = '0';
    region.style.margin = '-1px';
    region.style.overflow = 'hidden';
    region.style.clip = 'rect(0, 0, 0, 0)';
    region.style.whiteSpace = 'nowrap';
    region.style.border = '0';
    document.body.appendChild(region);
    return region;
  }

  function announce(message) {
    if (!message) return;
    const region = ensureLiveRegion();
    region.textContent = '';
    setTimeout(() => {
      region.textContent = message;
    }, 10);
  }

  function enhanceStatusbar(statusbar) {
    if (statusbar.dataset.officeStatusbarEnhanced === 'true') return;
    statusbar.dataset.officeStatusbarEnhanced = 'true';
    statusbar.setAttribute('role', 'status');
    statusbar.setAttribute('aria-live', 'polite');

    const children = Array.from(statusbar.children);
    if (children[0]) {
      children[0].dataset.officeStatusSlot = children[0].dataset.officeStatusSlot || 'primary';
      ensureId(children[0], 'office-status-primary');
    }
    if (children[1]) {
      children[1].dataset.officeStatusSlot = children[1].dataset.officeStatusSlot || 'secondary';
      ensureId(children[1], 'office-status-secondary');
    }
  }

  function updateStatus(message, slot = 'primary') {
    const statusbar = qs('.office-statusbar');
    if (!statusbar) {
      announce(message);
      return false;
    }
    enhanceStatusbar(statusbar);
    const target = qs(`[data-office-status-slot="${slot}"]`, statusbar) || statusbar.firstElementChild || statusbar;
    target.textContent = message;
    announce(message);
    return true;
  }

  function bindStatusbarBehavior() {
    qsa('.office-statusbar').forEach(enhanceStatusbar);
    ensureLiveRegion();
    if (statusbarBound) return;
    statusbarBound = true;

    document.addEventListener('office:status', event => {
      const detail = event.detail || {};
      updateStatus(detail.message || '', detail.slot || 'primary');
    });
  }

  function syncAriaOnPointer() {
    document.addEventListener('click', () => {
      requestAnimationFrame(() => {
        qsa('.picker-wrap').forEach(wrap => {
          const trigger = qs('.picker-trigger', wrap);
          if (trigger) setAttributeIfChanged(trigger, 'aria-expanded', wrap.classList.contains('open') ? 'true' : 'false');
        });
        qsa('.tool-picker').forEach(wrap => {
          const trigger = qs('.tool-group-trigger', wrap);
          if (trigger) setAttributeIfChanged(trigger, 'aria-expanded', wrap.classList.contains('open') ? 'true' : 'false');
        });
      });
    }, true);
  }

  function init() {
    bindMenuKeyboard();
    bindModalBehavior();
    bindStatusbarBehavior();
    bindGlobalOverlayBehavior();
    syncAriaOnPointer();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }

  window.OfficeUI = {
    init,
    closeTopOverlay,
    closeMenus,
    closePickers,
    closePalettes,
    openModal,
    closeModal,
    closeActiveModal,
    setPressed,
    openFilePicker,
    registerCommand,
    registerCommands,
    hasCommand,
    runCommand,
    dispatchOverlayClose,
    announce,
    updateStatus
  };
}());
