'use strict';

window.ArtMalyunky = window.ArtMalyunky || {};

window.ArtMalyunky.constants = {
  STORAGE_KEY: 'art_malyunky_draft_v2',
  PANEL_STATE_KEY: 'art_malyunky_panel_v1',
  MAX_UNDO: 80,
  HISTORY_MAX_BYTES: 128 * 1024 * 1024,
  PROJECT_FORMAT: 'office-plus-paint',
  PROJECT_VERSION: 1,
  PROJECT_EXT: 'malyunok',
  MAX_PROJECT_BYTES: 64 * 1024 * 1024,
  MAX_RASTER_DATAURL: 48 * 1024 * 1024,
  MAX_PROJECT_OBJECTS: 128,
  MAX_IMPORT_BYTES: 40 * 1024 * 1024,
  DEFAULT_FILE_NAME: 'малюнок',
  DEFAULT_COLOR: '#1f2937',
  DEFAULT_BG_COLOR: '#ffffff',
  DEFAULT_SIZE: 6,
  DEFAULT_OPACITY: 100,
  DEFAULT_GUIDE: 'none',
  DEFAULT_STAMP: '⭐',
  DEFAULT_FONT_SIZE: 24,
  DEFAULT_FONT_FAMILY: 'sans-serif',
  FONT_FAMILIES: [
    { label: 'Без зарубок', value: 'sans-serif' },
    { label: 'Із зарубками', value: 'serif' },
    { label: 'Моноширинний', value: 'monospace' },
    { label: 'Nunito', value: "'Nunito', sans-serif" }
  ],
  DEFAULT_DOC_WIDTH: 800,
  DEFAULT_DOC_HEIGHT: 600,
  MIN_DOC_DIMENSION: 16,
  MAX_DOC_DIMENSION: 4096,
  MAX_DOC_PIXELS: 16777216,
  DEFAULT_BACKGROUND: '#ffffff',
  MIN_ZOOM: 0.1,
  MAX_ZOOM: 8,
  ZOOM_LEVELS: [0.1, 0.25, 0.5, 0.75, 1, 1.5, 2, 3, 4, 6, 8],
  DOC_PRESETS: [
    { label: '800 × 600', width: 800, height: 600 },
    { label: '1024 × 768', width: 1024, height: 768 },
    { label: '1280 × 720', width: 1280, height: 720 },
    { label: 'A4 книжкова', width: 794, height: 1123 },
    { label: 'A4 альбомна', width: 1123, height: 794 },
    { label: 'Квадрат 600', width: 600, height: 600 }
  ],
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
    select: { label: 'Виділення', icon: 'fa-object-group', cursor: 'crosshair' },
    brush: { label: 'Пензлик', icon: 'fa-paintbrush', cursor: 'crosshair' },
    eraser: { label: 'Гумка', icon: 'fa-eraser', cursor: 'cell' },
    fill: { label: 'Заливка', icon: 'fa-fill-drip', cursor: 'cell' },
    eyedropper: { label: 'Піпетка', icon: 'fa-eye-dropper', cursor: 'crosshair' },
    text: { label: 'Текст', icon: 'fa-font', cursor: 'text' },
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
