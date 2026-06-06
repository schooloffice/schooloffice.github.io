'use strict';

window.ArtMalyunky = window.ArtMalyunky || {};

window.ArtMalyunky.constants = {
  STORAGE_KEY: 'art_malyunky_draft_v2',
  MAX_UNDO: 50,
  DEFAULT_FILE_NAME: 'малюнок',
  DEFAULT_COLOR: '#1f2937',
  DEFAULT_SIZE: 6,
  DEFAULT_OPACITY: 100,
  DEFAULT_GUIDE: 'none',
  DEFAULT_STAMP: '⭐',
  DEFAULT_CANVAS_MIN_WIDTH: 960,
  DEFAULT_CANVAS_MIN_HEIGHT: 560,
  COLOR_PALETTE: [
    '#111827', '#475569', '#ef4444', '#f97316', '#f59e0b', '#eab308',
    '#84cc16', '#22c55e', '#14b8a6', '#06b6d4', '#3b82f6', '#6366f1',
    '#8b5cf6', '#ec4899', '#fda4af', '#ffffff'
  ],
  BRUSHES: {
    pencil: {
      label: 'Олівець',
      icon: 'fa-pencil',
      cursor: 'crosshair',
      lineCap: 'round',
      sizeMultiplier: 0.75,
      opacityMultiplier: 1,
      spray: false
    },
    pen: {
      label: 'Перо',
      icon: 'fa-pen',
      cursor: 'crosshair',
      lineCap: 'round',
      sizeMultiplier: 1,
      opacityMultiplier: 1,
      spray: false
    },
    marker: {
      label: 'Маркер',
      icon: 'fa-highlighter',
      cursor: 'crosshair',
      lineCap: 'round',
      sizeMultiplier: 1.8,
      opacityMultiplier: 0.5,
      spray: false
    },
    spray: {
      label: 'Аерозоль',
      icon: 'fa-spray-can-sparkles',
      cursor: 'crosshair',
      lineCap: 'round',
      sizeMultiplier: 1,
      opacityMultiplier: 1,
      spray: true
    }
  },
  TOOLS: {
    brush: { label: 'Пензлик', icon: 'fa-paintbrush', cursor: 'crosshair' },
    eraser: { label: 'Гумка', icon: 'fa-eraser', cursor: 'cell' },
    fill: { label: 'Заливка', icon: 'fa-fill-drip', cursor: 'cell' },
    shapes: { label: 'Фігури', icon: 'fa-shapes', cursor: 'crosshair' },
    stamps: { label: 'Штампи', icon: 'fa-stamp', cursor: 'copy' }
  },
  SHAPES: {
    line: { label: 'Лінія', icon: 'fa-minus' },
    rect: { label: 'Прямокутник', icon: 'fa-regular fa-square' },
    'rect-filled': { label: 'Прямокутник із заливкою', icon: 'fa-solid fa-square' },
    circle: { label: 'Коло', icon: 'fa-regular fa-circle' },
    'circle-filled': { label: 'Коло із заливкою', icon: 'fa-solid fa-circle' },
    triangle: { label: 'Трикутник', icon: 'fa-solid fa-play fa-rotate-270' },
    star: { label: 'Зірка', icon: 'fa-solid fa-star' },
    heart: { label: 'Серце', icon: 'fa-solid fa-heart' },
    arrow: { label: 'Стрілка', icon: 'fa-solid fa-arrow-up' }
  },
  GUIDE_LABELS: {
    none: 'Немає',
    grid: 'Сітка',
    lines: 'Рядки'
  },
  STAMP_POOL: [
    '⭐', '🌟', '🎯', '🎈', '🎁', '🎨', '✏️', '📚',
    '🚀', '🪐', '☀️', '🌈', '🔥', '❄️', '🍎', '🍓',
    '🍀', '🌻', '🌸', '🌺', '🍄', '🧁', '🍪', '🎂',
    '🐱', '🐶', '🐻', '🐼', '🦊', '🐸', '🐧', '🦄',
    '🦋', '🐝', '🐬', '🐢', '🦜', '🦕', '🦒', '🐘'
  ],
  RESIZE_HANDLES: ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w']
};
