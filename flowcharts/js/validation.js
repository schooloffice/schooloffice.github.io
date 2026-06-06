(function () {
  'use strict';

  const LEVEL_META = {
    error: { icon: 'fa-circle-xmark', label: 'Помилка', cls: 'validation-issue-error' },
    warning: { icon: 'fa-triangle-exclamation', label: 'Попередження', cls: 'validation-issue-warning' },
    info: { icon: 'fa-circle-info', label: 'Підказка', cls: 'validation-issue-info' },
  };

  function createValidationController(options) {
    const {
      core,
      panel,
      listEl,
      summaryEl,
      closeButton,
      getDiagram,
      focusShape,
      openPanel,
      closePanel,
    } = options || {};

    function buildIssues() {
      const diagram = getDiagram?.() || { shapes: [], connections: [] };
      if (!core?.validateDiagram) return [];
      return core.validateDiagram(diagram);
    }

    function summarize(issues) {
      const errors = issues.filter((issue) => issue.level === 'error').length;
      const warnings = issues.filter((issue) => issue.level === 'warning').length;
      if (issues.length === 0) {
        return { ok: true, text: 'Схему перевірено — проблем не знайдено. 🎉' };
      }
      const parts = [];
      if (errors) parts.push(`${errors} ${pluralize(errors, 'помилка', 'помилки', 'помилок')}`);
      if (warnings) parts.push(`${warnings} ${pluralize(warnings, 'попередження', 'попередження', 'попереджень')}`);
      if (!errors && !warnings) parts.push('є підказки');
      return { ok: false, text: `Знайдено: ${parts.join(', ')}.` };
    }

    function pluralize(n, one, few, many) {
      const mod10 = n % 10;
      const mod100 = n % 100;
      if (mod10 === 1 && mod100 !== 11) return one;
      if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return few;
      return many;
    }

    function render(issues) {
      if (summaryEl) {
        const summary = summarize(issues);
        summaryEl.textContent = summary.text;
        summaryEl.classList.toggle('is-ok', summary.ok);
      }
      if (!listEl) return;
      listEl.innerHTML = '';
      issues.forEach((issue) => {
        const meta = LEVEL_META[issue.level] || LEVEL_META.info;
        const row = document.createElement(issue.shapeId ? 'button' : 'div');
        row.className = `validation-issue ${meta.cls}`;
        if (issue.shapeId) {
          row.type = 'button';
          row.dataset.shapeId = issue.shapeId;
          row.setAttribute('aria-label', `${meta.label}: ${issue.message}. Показати блок.`);
          row.addEventListener('click', () => focusShape?.(issue.shapeId));
        }
        const icon = document.createElement('i');
        icon.className = `fa-solid ${meta.icon} validation-issue-icon`;
        icon.setAttribute('aria-hidden', 'true');
        const text = document.createElement('span');
        text.className = 'validation-issue-text';
        text.textContent = issue.message;
        row.appendChild(icon);
        row.appendChild(text);
        listEl.appendChild(row);
      });
    }

    function runValidation() {
      const issues = buildIssues();
      render(issues);
      if (panel) panel.hidden = false;
      openPanel?.(panel);
      return issues;
    }

    function close() {
      if (panel) panel.hidden = true;
      closePanel?.(panel);
    }

    function toggle() {
      if (panel && panel.hidden === false) {
        close();
        return null;
      }
      return runValidation();
    }

    function bind() {
      closeButton?.addEventListener('click', close);
    }

    return {
      runValidation,
      toggle,
      close,
      bind,
      // exposed for testing
      summarize,
      render,
    };
  }

  window.FlowchartsValidation = {
    createValidationController,
  };
}());
