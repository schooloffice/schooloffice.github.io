export const STORAGE_KEY = 'art_slides_v1';
export const MAX_HISTORY = 80;
export const STAGE_WIDTH = 960;
export const STAGE_HEIGHT = 540;

// Версія формату проєкту. Зберігається у файлі для майбутніх міграцій.
export const SCHEMA_VERSION = 1;

// Захисні межі для імпорту недовірених файлів (P0-безпека): обмежують розмір,
// кількість і довжини, щоб пошкоджений чи зловмисний файл не вішав редактор.
export const LIMITS = {
  MAX_PROJECT_FILE_BYTES: 25 * 1024 * 1024,
  MAX_IMAGE_FILE_BYTES: 8 * 1024 * 1024,
  MAX_SLIDES: 200,
  MAX_ELEMENTS_PER_SLIDE: 100,
  // Сумарна межа об'єктів: усі thumbnails рендеряться одразу, тож обмежуємо
  // загальну кількість, щоб великий файл не вішав слабкі шкільні пристрої.
  MAX_TOTAL_ELEMENTS: 4000,
  MAX_TEXT_LENGTH: 20000,
  MAX_DATA_URL_LENGTH: 12 * 1024 * 1024,
  MAX_COORD: 20000,
  MIN_SIZE: 1,
  MAX_SIZE: 20000
};

export const COLOR_PALETTE = [
  '#000000', '#ffffff', '#dc2626', '#f97316', '#f59e0b', '#eab308',
  '#22c55e', '#10b981', '#06b6d4', '#3b82f6', '#6366f1', '#8b5cf6',
  '#ec4899', '#64748b', '#1e293b', '#fecaca', '#fde68a', '#bfdbfe'
];

export const FONT_SIZES = [20, 28, 40, 56, 72];

// Версія текстової моделі. Формат лишається whole-box (форматування на рівні
// блока), але поле готує ґрунт для майбутніх inline-runs без зміни схеми файла.
export const TEXT_MODEL_VERSION = 1;

// Сімейства шрифтів. Тільки CSS-загальні родини з локальними fallback —
// без зовнішніх шрифтів, щоб лишатися офлайн.
export const FONT_FAMILIES = [
  { key: 'sans', label: 'Звичайний', css: 'inherit' },
  { key: 'serif', label: 'Із засічками', css: 'Georgia, "Times New Roman", serif' },
  { key: 'mono', label: 'Моноширинний', css: '"Courier New", Consolas, monospace' },
  { key: 'rounded', label: 'Округлий', css: '"Comic Sans MS", "Segoe UI", system-ui, sans-serif' }
];
export const FONT_FAMILY_KEYS = FONT_FAMILIES.map(f => f.key);
export const FONT_FAMILY_CSS = Object.fromEntries(FONT_FAMILIES.map(f => [f.key, f.css]));

export const LINE_HEIGHTS = [1, 1.15, 1.5, 2];

export const DEFAULT_TEXT_STYLE = {
  fontSize: 28,
  color: '#111827',
  bold: false,
  italic: false,
  underline: false,
  align: 'left',
  fontFamily: 'sans',
  lineHeight: 1.15
};

export const DEFAULT_SHAPE_STYLE = {
  fill: '#dbeafe',
  stroke: '#1d4ed8'
};
