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
export const TEXT_MODEL_VERSION = 3;

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

export const LIST_TYPES = ['none', 'bullet', 'number'];

export const DEFAULT_TEXT_STYLE = {
  fontSize: 28,
  color: '#111827',
  bold: false,
  italic: false,
  underline: false,
  align: 'left',
  fontFamily: 'sans',
  lineHeight: 1.15,
  listType: 'none'
};

export const DEFAULT_SHAPE_STYLE = {
  fill: '#dbeafe',
  stroke: '#1d4ed8'
};

// Теми оформлення (дизайн-токени): фон слайдів + узгоджена акцентна палітра,
// яку показує колірний popover. Лише локальні кольори (офлайн, без зовнішніх
// ресурсів). Зміна теми не чіпає вміст елементів — лише фон і палітру.
export const THEMES = [
  { key: 'classic', name: 'Класична', background: '#ffffff', palette: COLOR_PALETTE },
  {
    key: 'ocean', name: 'Океан', background: '#eff6ff',
    palette: [
      '#0f172a', '#ffffff', '#0ea5e9', '#0284c7', '#0369a1', '#1d4ed8',
      '#2563eb', '#3b82f6', '#06b6d4', '#0891b2', '#14b8a6', '#0d9488',
      '#38bdf8', '#7dd3fc', '#bae6fd', '#1e293b', '#475569', '#94a3b8'
    ]
  },
  {
    key: 'sunny', name: 'Сонячна', background: '#fffbeb',
    palette: [
      '#1c1917', '#ffffff', '#f59e0b', '#d97706', '#b45309', '#ea580c',
      '#f97316', '#fb923c', '#dc2626', '#ef4444', '#eab308', '#ca8a04',
      '#fcd34d', '#fde68a', '#fed7aa', '#44403c', '#78716c', '#a8a29e'
    ]
  },
  {
    key: 'forest', name: 'Ліс', background: '#f0fdf4',
    palette: [
      '#14241a', '#ffffff', '#16a34a', '#15803d', '#166534', '#22c55e',
      '#4ade80', '#10b981', '#059669', '#047857', '#65a30d', '#4d7c0f',
      '#86efac', '#bbf7d0', '#a16207', '#1f2937', '#4b5563', '#9ca3af'
    ]
  },
  {
    key: 'grape', name: 'Виноград', background: '#faf5ff',
    palette: [
      '#1e1b2e', '#ffffff', '#9333ea', '#7e22ce', '#6b21a8', '#a855f7',
      '#c084fc', '#8b5cf6', '#6366f1', '#4f46e5', '#db2777', '#be185d',
      '#ec4899', '#f0abfc', '#e9d5ff', '#312e44', '#52525b', '#a1a1aa'
    ]
  }
];
export const THEME_KEYS = THEMES.map(theme => theme.key);
export const DEFAULT_THEME = 'classic';

// Типи placeholder-слотів макета. Текстові (title/subtitle/body) і зображення.
export const PLACEHOLDER_TYPES = ['title', 'subtitle', 'body', 'image'];
export const PLACEHOLDER_PROMPTS = {
  title: 'Заголовок слайда',
  subtitle: 'Підзаголовок',
  body: 'Додай основний текст або короткі пункти',
  image: 'Додати зображення'
};

// Макети слайдів: набір типізованих слотів із геометрією та базовим стилем.
// Застосування макета НЕ знищує реальний вміст — лише замінює порожні placeholder-и.
export const LAYOUTS = [
  { key: 'blank', name: 'Порожній', slots: [] },
  {
    key: 'title', name: 'Титульний', slots: [
      { type: 'title', x: 110, y: 180, w: 740, h: 130, style: { fontSize: 54, bold: true, align: 'center' } },
      { type: 'subtitle', x: 210, y: 330, w: 540, h: 80, style: { fontSize: 28, align: 'center', color: '#475569' } }
    ]
  },
  {
    key: 'title-body', name: 'Заголовок і текст', slots: [
      { type: 'title', x: 70, y: 48, w: 820, h: 90, style: { fontSize: 40, bold: true } },
      { type: 'body', x: 84, y: 168, w: 792, h: 300, style: { fontSize: 28 } }
    ]
  },
  {
    key: 'two-content', name: 'Дві колонки', slots: [
      { type: 'title', x: 70, y: 48, w: 820, h: 90, style: { fontSize: 40, bold: true } },
      { type: 'body', x: 70, y: 168, w: 390, h: 300, style: { fontSize: 26 } },
      { type: 'body', x: 500, y: 168, w: 390, h: 300, style: { fontSize: 26 } }
    ]
  },
  {
    key: 'title-image', name: 'Заголовок і фото', slots: [
      { type: 'title', x: 70, y: 48, w: 820, h: 90, style: { fontSize: 40, bold: true } },
      { type: 'image', x: 230, y: 160, w: 500, h: 320 }
    ]
  }
];
export const LAYOUT_KEYS = LAYOUTS.map(layout => layout.key);
export const DEFAULT_LAYOUT = 'blank';
export const SHAPE_TYPES = ['rect', 'circle', 'triangle', 'line', 'arrow'];
export const LINE_SHAPE_TYPES = ['line', 'arrow'];
export const TEXT_SHAPE_TYPES = ['rect', 'circle', 'triangle'];

// Режим вписування зображення в рамку: cover (заповнити з обрізанням) або
// contain (вписати повністю). Прозорість — 0..1.
export const IMAGE_FIT_MODES = ['cover', 'contain'];
export const DEFAULT_IMAGE_STYLE = {
  objectFit: 'cover',
  opacity: 1
};
