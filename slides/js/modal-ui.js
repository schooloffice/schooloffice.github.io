let modalHandlerAbort = null;

export function showModal(dom, {
  title,
  text = '',
  body = '',
  confirmText = 'Гаразд',
  cancelText = 'Скасувати',
  icon = 'fa-solid fa-circle-info',
  onConfirm = null,
  onMount = null,
  showCancel = true
}) {
  dom.modalTitle.textContent = title;
  dom.modalText.textContent = text;
  dom.modalBody.innerHTML = body;
  dom.modalIcon.innerHTML = `<i class="${icon}"></i>`;
  dom.modalConfirm.textContent = confirmText;
  dom.modalCancel.textContent = cancelText;
  dom.modalCancel.classList.toggle('hidden', !showCancel);
  dom.modalOverlay.classList.remove('hidden');
  dom.modalOverlay.classList.add('active');
  dom.modalOverlay.setAttribute('aria-hidden', 'false');

  const confirmHandler = () => {
    onConfirm?.();
    closeModal(dom);
  };
  const cancelHandler = () => closeModal(dom);

  modalHandlerAbort?.abort();
  modalHandlerAbort = new AbortController();
  dom.modalConfirm.addEventListener('click', confirmHandler, { signal: modalHandlerAbort.signal });
  dom.modalCancel.addEventListener('click', cancelHandler, { signal: modalHandlerAbort.signal });
  onMount?.();
}

export function closeModal(dom) {
  modalHandlerAbort?.abort();
  modalHandlerAbort = null;
  dom.modalOverlay.classList.add('hidden');
  dom.modalOverlay.classList.remove('active');
  dom.modalOverlay.setAttribute('aria-hidden', 'true');
  dom.modalBody.innerHTML = '';
}

export function showInfoModal(dom, title, text) {
  showModal(dom, {
    title,
    text,
    confirmText: 'Гаразд',
    showCancel: false
  });
}

export function showConfirmModal(dom, { title, text, confirmText = 'Продовжити', onConfirm }) {
  showModal(dom, {
    title,
    text,
    confirmText,
    cancelText: 'Скасувати',
    onConfirm
  });
}
