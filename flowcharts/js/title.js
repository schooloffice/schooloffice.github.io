(function () {
  'use strict';

  function createTitleController({
    titleInput,
    titleDisplay,
    fileNameEl,
    getTitle,
    setTitle,
    onChange,
  } = {}) {
    let titleRaf = 0;

    function syncHeaderTitle() {
      if (!fileNameEl) return;
      const value = String(getTitle?.() || '').trim();
      fileNameEl.textContent = value || 'схема';
      fileNameEl.title = value ? 'Клікни, щоб змінити назву' : 'Додай назву схемі';
    }

    function render() {
      syncHeaderTitle();
      if (!titleDisplay) return;
      titleDisplay.style.display = 'none';
      titleDisplay.textContent = '';
    }

    function updatePosition() {
      titleRaf = 0;
      if (titleDisplay) titleDisplay.style.display = 'none';
    }

    function schedule() {
      if (titleRaf) return;
      titleRaf = requestAnimationFrame(updatePosition);
    }

    function cancel() {
      if (titleRaf) cancelAnimationFrame(titleRaf);
      titleRaf = 0;
    }

    function syncInput() {
      if (titleInput) titleInput.value = getTitle?.() || '';
    }

    function focusInput() {
      titleInput?.focus();
      titleInput?.select();
    }

    function bindInput() {
      titleInput?.addEventListener('input', () => {
        setTitle?.(titleInput.value);
        render();
        onChange?.();
      });
    }

    function bindHeaderFocus() {
      fileNameEl?.addEventListener('click', focusInput);
      fileNameEl?.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          focusInput();
        }
      });
    }

    return {
      bindHeaderFocus,
      bindInput,
      cancel,
      render,
      schedule,
      syncInput,
    };
  }

  window.FlowchartsTitle = {
    createTitleController,
  };
}());
