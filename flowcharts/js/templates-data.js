(function () {
  'use strict';

  // Кольори збігаються з FlowchartCore.DEFAULT_BASE_COLORS, щоб шаблони
  // виглядали так само, як свіжостворені блоки.
  const COLORS = {
    'start-end': '#4caf50',
    'process': '#03a9f4',
    'decision': '#ff9800',
    'input-output': '#3f51b5',
    'subroutine': '#7b1fa2',
    'connector': '#546e7a',
  };

  function connId(from, to, type) {
    return type ? `conn-${from}-${to}-${type}` : `conn-${from}-${to}`;
  }

  // Невеликий DSL: shapes описуються коротко, координати/кольори підставляються.
  function project(title, shapes, conns) {
    return {
      version: 2,
      diagramTitle: title,
      shapeCounter: shapes.length,
      lastShapeType: 'process',
      snapEnabled: true,
      baseColors: { ...COLORS },
      shapes: shapes.map((s) => ({
        id: s.id,
        type: s.type,
        color: COLORS[s.type],
        textRaw: s.text,
        left: s.x,
        top: s.y,
      })),
      connections: conns.map((c) => ({
        id: connId(c.from, c.to, c.type),
        from: c.from,
        to: c.to,
        type: c.type || null,
        routeMode: c.route || 'auto',
        label: c.label != null ? c.label : null,
      })),
    };
  }

  const TEMPLATES = [
    {
      id: 'blank',
      title: 'Порожня схема',
      description: 'Лише «Початок» і «Кінець» — каркас для власного алгоритму.',
      build: () => project('', [
        { id: 'shape-1', type: 'start-end', text: 'Початок', x: 360, y: 60 },
        { id: 'shape-2', type: 'start-end', text: 'Кінець', x: 360, y: 240 },
      ], [
        { from: 'shape-1', to: 'shape-2' },
      ]),
    },
    {
      id: 'linear',
      title: 'Лінійний алгоритм',
      description: 'Ввід → обчислення → вивід. Базова послідовність дій.',
      build: () => project('Лінійний алгоритм', [
        { id: 'shape-1', type: 'start-end', text: 'Початок', x: 360, y: 40 },
        { id: 'shape-2', type: 'input-output', text: 'Ввести a, b', x: 340, y: 160 },
        { id: 'shape-3', type: 'process', text: 'sum = a + b', x: 350, y: 290 },
        { id: 'shape-4', type: 'input-output', text: 'Вивести sum', x: 340, y: 410 },
        { id: 'shape-5', type: 'start-end', text: 'Кінець', x: 360, y: 540 },
      ], [
        { from: 'shape-1', to: 'shape-2' },
        { from: 'shape-2', to: 'shape-3' },
        { from: 'shape-3', to: 'shape-4' },
        { from: 'shape-4', to: 'shape-5' },
      ]),
    },
    {
      id: 'branching',
      title: 'Розгалуження',
      description: 'Умова з гілками «Так» / «Ні» — вибір одного з двох шляхів.',
      build: () => project('Розгалуження', [
        { id: 'shape-1', type: 'start-end', text: 'Початок', x: 400, y: 40 },
        { id: 'shape-2', type: 'input-output', text: 'Ввести число n', x: 380, y: 160 },
        { id: 'shape-3', type: 'decision', text: 'n > 0?', x: 400, y: 290 },
        { id: 'shape-4', type: 'process', text: 'Вивести: додатнє', x: 140, y: 320 },
        { id: 'shape-5', type: 'process', text: 'Вивести: недодатнє', x: 640, y: 320 },
        { id: 'shape-6', type: 'start-end', text: 'Кінець', x: 400, y: 480 },
      ], [
        { from: 'shape-1', to: 'shape-2' },
        { from: 'shape-2', to: 'shape-3' },
        { from: 'shape-3', to: 'shape-4', type: 'yes' },
        { from: 'shape-3', to: 'shape-5', type: 'no' },
        { from: 'shape-4', to: 'shape-6' },
        { from: 'shape-5', to: 'shape-6' },
      ]),
    },
    {
      id: 'loop',
      title: 'Цикл',
      description: 'Цикл з умовою та поверненням назад: вивід чисел від 1 до 10.',
      build: () => project('Цикл', [
        { id: 'shape-1', type: 'start-end', text: 'Початок', x: 400, y: 40 },
        { id: 'shape-2', type: 'process', text: 'i = 1', x: 390, y: 160 },
        { id: 'shape-3', type: 'decision', text: 'i <= 10?', x: 400, y: 280 },
        { id: 'shape-4', type: 'process', text: 'Вивести i', x: 390, y: 430 },
        { id: 'shape-5', type: 'process', text: 'i = i + 1', x: 390, y: 540 },
        { id: 'shape-6', type: 'start-end', text: 'Кінець', x: 680, y: 300 },
      ], [
        { from: 'shape-1', to: 'shape-2' },
        { from: 'shape-2', to: 'shape-3' },
        { from: 'shape-3', to: 'shape-4', type: 'yes' },
        { from: 'shape-4', to: 'shape-5' },
        { from: 'shape-5', to: 'shape-3', route: 'bypass-left', label: 'повтор' },
        { from: 'shape-3', to: 'shape-6', type: 'no' },
      ]),
    },
    {
      id: 'nested',
      title: 'Вкладене розгалуження',
      description: 'Умова всередині умови — порівняння двох чисел (a > b, a < b).',
      build: () => project('Вкладене розгалуження', [
        { id: 'shape-1', type: 'start-end', text: 'Початок', x: 420, y: 40 },
        { id: 'shape-2', type: 'input-output', text: 'Ввести a, b', x: 400, y: 150 },
        { id: 'shape-3', type: 'decision', text: 'a > b?', x: 420, y: 270 },
        { id: 'shape-4', type: 'process', text: 'Вивести a', x: 160, y: 290 },
        { id: 'shape-5', type: 'decision', text: 'a < b?', x: 620, y: 290 },
        { id: 'shape-6', type: 'process', text: 'Вивести b', x: 600, y: 450 },
        { id: 'shape-7', type: 'process', text: 'a = b', x: 860, y: 320 },
        { id: 'shape-8', type: 'start-end', text: 'Кінець', x: 420, y: 600 },
      ], [
        { from: 'shape-1', to: 'shape-2' },
        { from: 'shape-2', to: 'shape-3' },
        { from: 'shape-3', to: 'shape-4', type: 'yes' },
        { from: 'shape-3', to: 'shape-5', type: 'no' },
        { from: 'shape-5', to: 'shape-6', type: 'yes' },
        { from: 'shape-5', to: 'shape-7', type: 'no' },
        { from: 'shape-4', to: 'shape-8' },
        { from: 'shape-6', to: 'shape-8' },
        { from: 'shape-7', to: 'shape-8' },
      ]),
    },
    {
      id: 'subroutine',
      title: 'Схема з підпрограмою',
      description: 'Виклик підпрограм — поділ алгоритму на окремі кроки.',
      build: () => project('Схема з підпрограмою', [
        { id: 'shape-1', type: 'start-end', text: 'Початок', x: 380, y: 40 },
        { id: 'shape-2', type: 'subroutine', text: 'Підготувати дані', x: 350, y: 160 },
        { id: 'shape-3', type: 'process', text: 'Обробити дані', x: 360, y: 290 },
        { id: 'shape-4', type: 'subroutine', text: 'Зберегти результат', x: 350, y: 410 },
        { id: 'shape-5', type: 'start-end', text: 'Кінець', x: 380, y: 540 },
      ], [
        { from: 'shape-1', to: 'shape-2' },
        { from: 'shape-2', to: 'shape-3' },
        { from: 'shape-3', to: 'shape-4' },
        { from: 'shape-4', to: 'shape-5' },
      ]),
    },
  ];

  window.FlowchartsTemplatesData = {
    TEMPLATES,
  };
}());
