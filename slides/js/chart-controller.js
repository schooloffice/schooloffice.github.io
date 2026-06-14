import { chartFromDelimitedText, chartToDelimitedText, CHART_TYPES, createChartElement } from './chart-element.js';
import { getCurrentSlide, getSelectedElement, state } from './state.js';
import { $ } from './utils.js';

export function createChartController({
  elementDomMap,
  markDirty,
  pushHistory,
  renderCurrentSlideWorkspace,
  showInfoModal,
  showModal
}) {
  function showChartModal(mode = 'insert') {
    const current = mode === 'edit' ? getSelectedElement() : null;
    if (mode === 'edit' && current?.type !== 'chart') {
      showInfoModal('Змінити діаграму', 'Виберіть одну діаграму.');
      return;
    }
    const chart = current?.chart || createChartElement().chart;
    const typeOptions = CHART_TYPES.map(type => `<option value="${type}"${chart.type === type ? ' selected' : ''}>${({
      column: 'Стовпчаста', line: 'Лінійна', pie: 'Кругова'
    })[type]}</option>`).join('');
    showModal({
      title: mode === 'edit' ? 'Змінити діаграму' : 'Вставити діаграму',
      text: 'Перший рядок містить назви рядів, перший стовпець — категорії. Розділяйте значення крапкою з комою.',
      body: `
        <div class="form-grid chart-form">
          <label>Тип <select id="chartTypeField" class="input-like">${typeOptions}</select></label>
          <label>Заголовок <input id="chartTitleField" class="input-like" type="text" maxlength="120" value="${escapeAttr(chart.title)}"></label>
          <label class="checkbox-row"><input id="chartLegendField" type="checkbox"${chart.showLegend ? ' checked' : ''}> Показувати легенду</label>
          <label class="chart-data-field">Дані
            <textarea id="chartDataField" class="input-like" rows="8" spellcheck="false">${escapeText(chartToDelimitedText(chart))}</textarea>
          </label>
          <div class="helper-text chart-data-field">Кругова діаграма використовує перший ряд даних; від’ємні значення в ній показуються як нуль.</div>
          <div id="chartError" class="form-error hidden" role="alert"></div>
        </div>
      `,
      confirmText: mode === 'edit' ? 'Застосувати' : 'Вставити',
      cancelText: 'Скасувати',
      onConfirm: () => {
        const parsed = chartFromDelimitedText($('#chartDataField').value, {
          ...chart,
          type: $('#chartTypeField').value,
          title: $('#chartTitleField').value,
          showLegend: $('#chartLegendField').checked
        });
        if (!parsed) {
          const error = $('#chartError');
          error.textContent = 'Додайте заголовок таблиці даних і щонайменше один рядок категорії.';
          error.classList.remove('hidden');
          return false;
        }
        if (mode === 'edit') {
          if (JSON.stringify(parsed) === JSON.stringify(current.chart)) return;
          pushHistory();
          current.chart = parsed;
          renderCurrentSlideWorkspace();
          markDirty('Діаграму змінено');
          return;
        }
        pushHistory();
        const slide = getCurrentSlide();
        const element = createChartElement({ z: slide.elements.length + 1, chart: parsed });
        slide.elements.push(element);
        state.selectedElementIds = [element.id];
        renderCurrentSlideWorkspace();
        markDirty('Додано діаграму');
        requestAnimationFrame(() => elementDomMap.get(element.id)?.focus());
      }
    });
  }

  return { showChartModal };
}

function escapeAttr(value) {
  return String(value || '').replace(/[&"<>]/g, char => ({ '&': '&amp;', '"': '&quot;', '<': '&lt;', '>': '&gt;' })[char]);
}

function escapeText(value) {
  return String(value || '').replace(/[&<>]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[char]);
}
