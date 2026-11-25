(function () {
  'use strict';

  let globalsBound = false;
  let modalBehaviorBound = false;
  let statusbarBound = false;
  let responsiveToolbarsBound = false;
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

  // ---------- Власне контекстне меню ----------
  // Один спільний механізм для всіх редакторів: позиціювання в межах вікна, клавіатура,
  // закриття, aria та повернення фокуса. Кожен редактор лише описує пункти в HTML
  // (.office-context-menu > .menu-item[data-context-action]) і вирішує, що показати.
  const contextMenus = new Set();
  let openContextMenu = null;

  function visibleMenuItems(menu) {
    return qsa('.menu-item', menu).filter(item => !item.hidden && !item.disabled && item.getAttribute('aria-disabled') !== 'true');
  }

  // Роздільник видно лише між двома видимими групами пунктів.
  function syncContextSeparators(menu) {
    let seenItem = false;
    let pending = null;
    Array.from(menu.children).forEach(child => {
      if (child.classList.contains('menu-sep')) {
        child.hidden = true;
        if (seenItem) pending = child;
        return;
      }
      if (child.hidden) return;
      if (pending) pending.hidden = false;
      pending = null;
      seenItem = true;
    });
  }

  function placeContextMenu(menu, x, y) {
    menu.style.left = '0px';
    menu.style.top = '0px';
    const width = menu.offsetWidth || 220;
    const height = menu.offsetHeight || 240;
    const left = Math.min(x, window.innerWidth - width - 8);
    const top = Math.min(y, window.innerHeight - height - 8);
    menu.style.left = `${Math.max(8, Math.round(left))}px`;
    menu.style.top = `${Math.max(8, Math.round(top))}px`;
  }

  function closeContextMenus({ restoreFocus = false } = {}) {
    const state = openContextMenu;
    if (!state) return false;
    openContextMenu = null;
    state.menu.hidden = true;
    if (restoreFocus && state.returnFocus?.isConnected) state.returnFocus.focus({ preventScroll: true });
    dispatchOverlayClose('contextmenu', { menu: state.menu.id || '' });
    state.options.onClose?.(state.context);
    return true;
  }

  function showContextMenu(binding, context, x, y, { focusFirst = false } = {}) {
    const { menu, options } = binding;
    closeTopOverlay();
    options.prepare?.(menu, context);
    syncContextSeparators(menu);
    if (!qsa('.menu-item', menu).some(item => !item.hidden)) return false;
    menu.hidden = false;
    placeContextMenu(menu, x, y);
    openContextMenu = { menu, options, context, returnFocus: document.activeElement };
    if (focusFirst) (visibleMenuItems(menu)[0] || menu).focus({ preventScroll: true });
    return true;
  }

  // options:
  //   surface   — елемент, у якому правий клік відкриває наше меню;
  //   menu      — елемент меню з пунктами .menu-item[data-context-action];
  //   resolve(event) → контекст або null (null — меню не відкривати, лишити поведінку браузера);
  //   prepare(menu, context) — сховати/вимкнути пункти для цього контексту;
  //   anchor(context) → {x, y} для відкриття з клавіатури (Shift+F10, клавіша меню);
  //   onAction(action, context, item) — виконати вибраний пункт;
  //   onClose(context) — необов'язково.
  // Shift + правий клік мишею лишає меню браузера (потрібне, наприклад, для варіантів
  // виправлення правопису). Довге натискання на сенсорному екрані теж лишається браузерним.
  function bindContextMenu(options = {}) {
    const surface = typeof options.surface === 'string' ? document.getElementById(options.surface) : options.surface;
    const menu = typeof options.menu === 'string' ? document.getElementById(options.menu) : options.menu;
    if (!surface || !menu) return null;
    const binding = { surface, menu, options };
    contextMenus.add(binding);

    menu.classList.add('office-context-menu');
    menu.setAttribute('role', 'menu');
    menu.hidden = true;
    ensureId(menu, 'office-context-menu');
    if (!menu.hasAttribute('tabindex')) menu.tabIndex = -1;
    qsa('.menu-item', menu).forEach(item => {
      item.setAttribute('role', 'menuitem');
      if (item.tagName === 'BUTTON' && !item.hasAttribute('type')) item.type = 'button';
      item.tabIndex = -1;
    });

    surface.addEventListener('contextmenu', event => {
      if (event.defaultPrevented) return;
      const fromKeyboard = event.button !== 2 && event.pointerType !== 'touch' && event.pointerType !== 'pen';
      if (!fromKeyboard && event.shiftKey) return;
      if (event.pointerType === 'touch' || event.pointerType === 'pen') return;
      const context = options.resolve ? options.resolve(event) : {};
      if (context == null) return;
      let x = event.clientX;
      let y = event.clientY;
      if (fromKeyboard || (!x && !y)) {
        const point = options.anchor?.(context);
        if (point) ({ x, y } = point);
        else {
          const rect = surface.getBoundingClientRect();
          x = rect.left + Math.min(rect.width / 2, 160);
          y = rect.top + Math.min(rect.height / 2, 120);
        }
      }
      // Якщо для цього місця немає жодного доступного пункту, лишаємо меню браузера,
      // а не порожнє місце без жодного меню.
      if (showContextMenu(binding, context, x, y, { focusFirst: fromKeyboard })) event.preventDefault();
    });

    // Клік по пункту не забирає фокус і виділення з робочої області.
    menu.addEventListener('pointerdown', event => event.preventDefault());

    menu.addEventListener('click', event => {
      const item = event.target.closest('.menu-item');
      if (!item || !menu.contains(item) || item.disabled || item.hidden || item.getAttribute('aria-disabled') === 'true') return;
      event.preventDefault();
      event.stopPropagation();
      const state = openContextMenu;
      const context = state?.menu === menu ? state.context : null;
      const fromKeyboard = state?.returnFocus && document.activeElement === item;
      closeContextMenus({ restoreFocus: !!fromKeyboard });
      options.onAction?.(item.dataset.contextAction, context, item);
    });

    menu.addEventListener('keydown', event => {
      const items = visibleMenuItems(menu);
      if (!items.length) return;
      const index = items.indexOf(document.activeElement);
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        const step = event.key === 'ArrowDown' ? 1 : -1;
        items[(index + step + items.length) % items.length].focus();
      } else if (event.key === 'Home' || event.key === 'End') {
        event.preventDefault();
        items[event.key === 'Home' ? 0 : items.length - 1].focus();
      } else if (event.key === 'Tab') {
        event.preventDefault();
        closeContextMenus({ restoreFocus: true });
      }
    });

    return {
      open(context, x, y, openOptions) { return showContextMenu(binding, context, x, y, openOptions); },
      openForKeyboard(context) {
        const point = options.anchor?.(context);
        if (!point) return false;
        return showContextMenu(binding, context, point.x, point.y, { focusFirst: true });
      },
      close(closeOptions) { return openContextMenu?.menu === menu ? closeContextMenus(closeOptions) : false; },
      isOpen() { return openContextMenu?.menu === menu; }
    };
  }

  function closeTopOverlay({ restoreFocus = false } = {}) {
    return closeContextMenus({ restoreFocus }) ||
      closeActiveModal({ restoreFocus }) ||
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
      if (event.target.closest('.office-context-menu, [data-office-context-trigger], .menu-item-wrap, .menu-title, .menu-dropdown, .picker-wrap, .tool-picker, .palette-wrap, .palette-popover')) return;
      closeTopOverlay();
    }, true);

    // Відкрите контекстне меню прив'язане до точки на екрані: прокрутка колесом чи жестом,
    // зміна розміру або перехід в інше вікно його закривають. Програмна прокрутка (розбиття
    // на сторінки, автозбереження) меню не закриває, інакше воно зникало б саме по собі.
    const closeContextOnViewportChange = event => {
      if (event?.type !== 'resize' && event?.type !== 'blur' && openContextMenu?.menu.contains(event.target)) return;
      closeContextMenus();
    };
    window.addEventListener('wheel', closeContextOnViewportChange, { capture: true, passive: true });
    window.addEventListener('touchmove', closeContextOnViewportChange, { capture: true, passive: true });
    window.addEventListener('resize', closeContextOnViewportChange);
    window.addEventListener('blur', closeContextOnViewportChange);
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

  function bindResponsiveToolbars() {
    const service = document.body?.dataset?.officeService;
    if (!['text', 'slides'].includes(service)) return;

    const toolbars = qsa('.office-toolbar.toolbar');
    const activeSelector = '.active, [aria-pressed="true"], [aria-selected="true"]';

    const updateScrollState = toolbar => {
      const maxScrollLeft = Math.max(0, toolbar.scrollWidth - toolbar.clientWidth);
      const scrollable = maxScrollLeft > 2;
      toolbar.classList.toggle('office-toolbar-scrollable', scrollable);
      toolbar.classList.toggle('can-scroll-left', scrollable && toolbar.scrollLeft > 2);
      toolbar.classList.toggle('can-scroll-right', scrollable && toolbar.scrollLeft < maxScrollLeft - 2);
    };

    const revealTool = (toolbar, tool) => {
      if (!(tool instanceof Element) || !toolbar.contains(tool)) return;
      const toolbarRect = toolbar.getBoundingClientRect();
      const toolRect = tool.getBoundingClientRect();
      const edgePadding = 28;
      if (toolRect.left < toolbarRect.left + edgePadding) {
        toolbar.scrollLeft += toolRect.left - toolbarRect.left - edgePadding;
      } else if (toolRect.right > toolbarRect.right - edgePadding) {
        toolbar.scrollLeft += toolRect.right - toolbarRect.right + edgePadding;
      }
    };

    // Кадр requestAnimationFrame не приходить у фоновій вкладці чи iframe (і ненадійний під
    // навантаженням у headless-перевірках), тож дублюємо його таймером: спрацьовує той, хто перший.
    const scheduleToolbarUpdate = callback => {
      let done = false;
      const run = () => {
        if (done) return;
        done = true;
        callback();
      };
      requestAnimationFrame(run);
      setTimeout(run, 100);
    };

    toolbars.forEach(toolbar => {
      if (toolbar.dataset.officeScrollEnhanced === 'true') return;
      toolbar.dataset.officeScrollEnhanced = 'true';
      toolbar.addEventListener('scroll', () => updateScrollState(toolbar), { passive: true });
      toolbar.addEventListener('wheel', event => {
        if (Math.abs(event.deltaY) <= Math.abs(event.deltaX) || toolbar.scrollWidth <= toolbar.clientWidth) return;
        event.preventDefault();
        toolbar.scrollLeft += event.deltaY;
      }, { passive: false });
      toolbar.addEventListener('focusin', event => revealTool(toolbar, event.target));
      toolbar.addEventListener('click', event => revealTool(toolbar, event.target.closest('button, select, input, [role="button"]')));

      const observer = new MutationObserver(records => {
        const activeTool = records
          .map(record => record.target instanceof Element ? record.target.closest(activeSelector) : null)
          .find(Boolean);
        // MutationObserver already runs after the class/ARIA change. Reveal now:
        // requestAnimationFrame can be throttled for a background editor iframe,
        // leaving the newly active control outside the mobile toolbar viewport.
        if (activeTool) revealTool(toolbar, activeTool);
        scheduleToolbarUpdate(() => updateScrollState(toolbar));
      });
      observer.observe(toolbar, {
        subtree: true,
        attributes: true,
        attributeFilter: ['class', 'aria-pressed', 'aria-selected']
      });
      // Стилі вже застосовано до запуску скрипта, тож стан градієнта можна порахувати одразу.
      updateScrollState(toolbar);
      scheduleToolbarUpdate(() => {
        updateScrollState(toolbar);
        revealTool(toolbar, toolbar.querySelector(activeSelector));
      });
    });

    if (!responsiveToolbarsBound) {
      responsiveToolbarsBound = true;
      window.addEventListener('resize', () => toolbars.forEach(updateScrollState), { passive: true });
    }
  }

  // E2 UX-пілот: опційний режим «Великі інструменти з підписами». Це налаштування пристрою, а не
  // документа: зберігається в localStorage, ставить data-office-tools="large" на <html> і не торкається
  // файла, історії чи чернетки. Редактор, що підтримує режим, має пункт [data-office-large-tools-toggle]
  // і власні CSS-правила для цього атрибута; решта редакторів атрибут просто ігнорує.
  const LARGE_TOOLS_KEY = 'office_large_tools_v1';
  let largeToolsBound = false;

  function readLargeToolsPreference() {
    try {
      return window.localStorage.getItem(LARGE_TOOLS_KEY) === '1';
    } catch {
      return false;
    }
  }

  function isLargeTools() {
    return document.documentElement.dataset.officeTools === 'large';
  }

  function applyLargeTools(enabled) {
    if (enabled) document.documentElement.dataset.officeTools = 'large';
    else delete document.documentElement.dataset.officeTools;
    qsa('[data-office-large-tools-toggle]').forEach(toggle => {
      setAttributeIfChanged(toggle, 'role', 'menuitemcheckbox');
      setAttributeIfChanged(toggle, 'aria-checked', String(!!enabled));
      toggle.classList.toggle('checked', !!enabled);
    });
    document.dispatchEvent(new CustomEvent('office:largetoolschange', { detail: { enabled: !!enabled } }));
  }

  function setLargeTools(enabled, { persist = true } = {}) {
    const next = !!enabled;
    // Пункт меню зникає разом зі списком, тож фокус повертаємо на заголовок цього меню.
    const menuTitle = document.activeElement?.closest?.('.menu-item-wrap')?.querySelector('.menu-title');
    applyLargeTools(next);
    if (persist) {
      try {
        window.localStorage.setItem(LARGE_TOOLS_KEY, next ? '1' : '0');
      } catch {
        // Сховище сайту заборонене: режим діє до перезавантаження сторінки.
      }
    }
    if (menuTitle instanceof HTMLElement) menuTitle.focus();
    announce(next ? 'Великі інструменти з підписами увімкнено.' : 'Великі інструменти з підписами вимкнено.');
    return next;
  }

  function toggleLargeTools(options) {
    return setLargeTools(!isLargeTools(), options);
  }

  function bindLargeTools() {
    applyLargeTools(readLargeToolsPreference());
    if (largeToolsBound) return;
    largeToolsBound = true;
    // Інша вкладка з редактором змінила режим — застосовуємо без перезавантаження.
    window.addEventListener('storage', event => {
      if (event.key === LARGE_TOOLS_KEY) applyLargeTools(event.newValue === '1');
    });
  }

  // Атрибут ставимо одразу під час виконання скрипта, щоб розкладка не «стрибала» після DOMContentLoaded.
  if (readLargeToolsPreference()) document.documentElement.dataset.officeTools = 'large';

  function init() {
    bindMenuKeyboard();
    bindModalBehavior();
    bindStatusbarBehavior();
    bindGlobalOverlayBehavior();
    syncAriaOnPointer();
    bindResponsiveToolbars();
    bindLargeTools();
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
    bindContextMenu,
    closeContextMenus,
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
    updateStatus,
    bindResponsiveToolbars,
    isLargeTools,
    setLargeTools,
    toggleLargeTools
  };
}());
