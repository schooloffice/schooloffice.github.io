'use strict';

window.ArtVector = window.ArtVector || {};

window.ArtVector.constants = {
  STORAGE_KEY: 'art_vector_draft_v1',
  MAX_UNDO: 60,
  DEFAULT_FILE_NAME: 'векторний_малюнок',
  DEFAULT_CANVAS_WIDTH: 1200,
  DEFAULT_CANVAS_HEIGHT: 700,
  GRID_SIZE: 20,
  MIN_SHAPE_SIZE: 12,
  MIN_TEXT_SIZE: 12,
  MIN_PEN_SIZE: 8,
  ZOOM_STEPS: [0.5, 0.75, 1, 1.25, 1.5, 2],
  COLOR_PALETTE: [
    '#111827', '#475569', '#ef4444', '#f97316', '#f59e0b', '#eab308',
    '#84cc16', '#22c55e', '#14b8a6', '#06b6d4', '#3b82f6', '#6366f1',
    '#8b5cf6', '#ec4899', '#fda4af', '#ffffff'
  ],
  TOOLS: {
    select: { label: 'Вибір', icon: 'fa-solid fa-arrow-pointer' },
    pen: { label: 'Олівець', icon: 'fa-solid fa-pencil' },
    line: { label: 'Лінія', icon: 'fa-solid fa-minus' },
    arrow: { label: 'Стрілка', icon: 'fa-solid fa-arrow-right' },
    rect: { label: 'Прямокутник', icon: 'fa-regular fa-square' },
    ellipse: { label: 'Еліпс', icon: 'fa-regular fa-circle' },
    triangle: { label: 'Трикутник', icon: 'fa-solid fa-play fa-rotate-270' },
    diamond: { label: 'Ромб', icon: 'fa-regular fa-gem' },
    star: { label: 'Зірка', icon: 'fa-solid fa-star' },
    text: { label: 'Текст', icon: 'fa-solid fa-font' }
  },
  TOOL_GROUPS: {
    draw: ['pen', 'line', 'arrow'],
    shape: ['rect', 'ellipse', 'triangle', 'diamond', 'star']
  },
  GUIDE_LABELS: {
    none: 'Немає',
    grid: 'Сітка',
    lines: 'Рядки'
  },
  RECT_LIKE_TYPES: ['rect', 'ellipse', 'triangle', 'diamond', 'star'],
  LINE_TYPES: ['line', 'arrow']
};
