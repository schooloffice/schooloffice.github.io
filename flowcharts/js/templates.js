(function () {
  'use strict';

  function createTemplatesController(options) {
    const {
      templates,
      gridEl,
      modal,
      closeButton,
      openModal,
      closeModal,
      loadTemplate,
      onAfterLoad,
    } = options || {};

    const list = Array.isArray(templates) ? templates : [];

    function applyTemplate(template) {
      if (!template || typeof template.build !== 'function') return;
      let data;
      try {
        data = template.build();
      } catch (error) {
        console.error('Template build failed:', error);
        return;
      }
      closeModal?.(modal);
      loadTemplate?.(data);
      onAfterLoad?.();
    }

    function render() {
      if (!gridEl) return;
      gridEl.innerHTML = '';
      list.forEach((template) => {
        const card = document.createElement('button');
        card.type = 'button';
        card.className = 'template-card';
        card.setAttribute('role', 'listitem');
        card.dataset.templateId = template.id;
        card.setAttribute('aria-label', `Шаблон: ${template.title}. ${template.description}`);

        const title = document.createElement('span');
        title.className = 'template-card-title';
        title.textContent = template.title;

        const desc = document.createElement('span');
        desc.className = 'template-card-desc';
        desc.textContent = template.description;

        card.appendChild(title);
        card.appendChild(desc);
        card.addEventListener('click', () => applyTemplate(template));
        gridEl.appendChild(card);
      });
    }

    function open() {
      render();
      openModal?.(modal);
    }

    function close() {
      closeModal?.(modal);
    }

    function bind() {
      closeButton?.addEventListener('click', close);
    }

    return {
      open,
      close,
      render,
      applyTemplate,
      bind,
    };
  }

  window.FlowchartsTemplates = {
    createTemplatesController,
  };
}());
