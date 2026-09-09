import { chartFromDelimitedText, chartToDelimitedText, CHART_TYPES, createChartElement } from './chart-element.js';
import { getCurrentSlide, getSelectedElement, state } from './state.js';
import { $, createNode } from './utils.js';

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
    const typeNames = { column: 'Стовпчаста', line: 'Лінійна', pie: 'Кругова' };
    const typeField = createNode('select', { id: 'chartTypeField', className: 'input-like' });
    CHART_TYPES.forEach(type => typeField.appendChild(createNode('option', {
      text: typeNames[type],
      properties: { value: type, selected: chart.type === type }
    })));
    const titleField = createNode('input', {
      id: 'chartTitleField',
      className: 'input-like',
      attributes: { type: 'text', maxlength: 120 },
      properties: { value: chart.title }
    });
    const legendField = createNode('input', {
      id: 'chartLegendField',
      attributes: { type: 'checkbox' },
      properties: { checked: chart.showLegend }
    });
    const dataField = createNode('textarea', {
      id: 'chartDataField',
      className: 'input-like',
      attributes: { rows: 8, spellcheck: 'false' },
      properties: { value: chartToDelimitedText(chart) }
    });
    const bodyNode = createNode('div', { className: 'form-grid chart-form' },
      createNode('label', {}, 'Тип ', typeField),
      createNode('label', {}, 'Заголовок ', titleField),
      createNode('label', { className: 'checkbox-row' }, legendField, ' Показувати легенду'),
      createNode('label', { className: 'chart-data-field' }, 'Дані', dataField),
      createNode('div', { className: 'helper-text chart-data-field', text: 'Кругова діаграма використовує перший ряд даних; від’ємні значення в ній показуються як нуль.' }),
      createNode('div', { id: 'chartError', className: 'form-error hidden', attributes: { role: 'alert' } })
    );
    showModal({
      title: mode === 'edit' ? 'Змінити діаграму' : 'Вставити діаграму',
      text: 'Перший рядок містить назви рядів, перший стовпець — категорії. Розділяйте значення крапкою з комою.',
      bodyNode,
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
