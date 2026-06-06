(function () {
  'use strict';

  function createButton({ text, className, onClick }) {
    const button = document.createElement('button');
    button.textContent = text;
    button.className = className;
    button.addEventListener('click', onClick);
    return button;
  }

  function getMessageModalParts() {
    const modal = document.getElementById('message-modal');
    const textEl = document.getElementById('message-modal-text');
    const buttonsEl = document.getElementById('message-modal-buttons');
    if (!modal || !textEl || !buttonsEl) return null;
    return { modal, textEl, buttonsEl };
  }

  function createModalHelpers({
    openModal = (modal) => modal?.classList.add('active'),
    closeModal = (modal) => modal?.classList.remove('active'),
  } = {}) {
    function showMessageModal(text) {
      const parts = getMessageModalParts();
      if (!parts) return;
      const { modal, textEl, buttonsEl } = parts;

      textEl.textContent = text;
      buttonsEl.innerHTML = '';
      const ok = createButton({
        text: 'OK',
        className: 'modal-btn ok-btn',
        onClick: () => closeModal(modal),
      });
      buttonsEl.appendChild(ok);
      openModal(modal);
      setTimeout(() => ok.focus(), 30);
    }

    function showConfirmModal(text, onOk) {
      const parts = getMessageModalParts();
      if (!parts) return;
      const { modal, textEl, buttonsEl } = parts;

      textEl.textContent = text;
      buttonsEl.innerHTML = '';

      const cancel = createButton({
        text: 'Скасувати',
        className: 'modal-btn cancel-btn',
        onClick: () => closeModal(modal),
      });
      const ok = createButton({
        text: 'Очистити',
        className: 'modal-btn no-btn',
        onClick: () => {
          closeModal(modal);
          onOk?.();
        },
      });

      buttonsEl.appendChild(cancel);
      buttonsEl.appendChild(ok);
      openModal(modal);
      setTimeout(() => cancel.focus(), 30);
    }

    function showRestoreDraftModal(text, onRestore, onDiscard) {
      const parts = getMessageModalParts();
      if (!parts) return;
      const { modal, textEl, buttonsEl } = parts;

      textEl.textContent = text;
      buttonsEl.innerHTML = '';

      const discard = createButton({
        text: 'Нова схема',
        className: 'modal-btn cancel-btn',
        onClick: () => {
          closeModal(modal);
          onDiscard?.();
        },
      });
      const restore = createButton({
        text: 'Відкрити чернетку',
        className: 'modal-btn ok-btn',
        onClick: () => {
          closeModal(modal);
          onRestore?.();
        },
      });

      buttonsEl.appendChild(discard);
      buttonsEl.appendChild(restore);
      openModal(modal);
      setTimeout(() => restore.focus(), 30);
    }

    function bindBackdropClose() {
      document.querySelectorAll('.modal').forEach(modal => {
        modal.addEventListener('pointerdown', (event) => {
          if (event.target === modal) closeModal(modal);
        });
      });
    }

    return {
      bindBackdropClose,
      showConfirmModal,
      showMessageModal,
      showRestoreDraftModal,
    };
  }

  window.FlowchartsModals = {
    createModalHelpers,
  };
}());
