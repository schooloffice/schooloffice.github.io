import { DEFAULT_IMAGE_STYLE, DEFAULT_SHAPE_STYLE, DEFAULT_TEXT_STYLE, FONT_FAMILY_KEYS, IMAGE_FIT_MODES, LIMITS, LIST_TYPES, SCHEMA_VERSION, SHAPE_TYPES, TEXT_MODEL_VERSION, TEXT_SHAPE_TYPES } from './constants.js';
import { clamp, downloadTextFile } from './utils.js';

const DEFAULT_PRESENTATION_NAME = 'моя презентація';

function clampCoord(value, fallback) {
  if (!Number.isFinite(value)) return fallback;
  return clamp(value, -LIMITS.MAX_COORD, LIMITS.MAX_COORD);
}

function clampSize(value, fallback) {
  if (!Number.isFinite(value)) return fallback;
  return clamp(value, LIMITS.MIN_SIZE, LIMITS.MAX_SIZE);
}

function clampText(value) {
  return typeof value === 'string' ? value.slice(0, LIMITS.MAX_TEXT_LENGTH) : '';
}

// Кадрування зберігаємо як частки рамки (l/t/r/b у [0..0.9]); протилежні разом
// не більш як 0.9, щоб лишалося хоча б 10% видимого вікна.
function normalizeCrop(crop) {
  const c = crop && typeof crop === 'object' ? crop : {};
  const f = value => (Number.isFinite(value) ? clamp(value, 0, 0.9) : 0);
  let l = f(c.l); let t = f(c.t); let r = f(c.r); let b = f(c.b);
  if (l + r > 0.9) r = Math.max(0, 0.9 - l);
  if (t + b > 0.9) b = Math.max(0, 0.9 - t);
  return { l, t, r, b };
}

// Джерело зображення приймаємо лише як data:image обмеженого розміру. Зовнішні
// (http/https) URL у недовіреному файлі нейтралізуємо: вони розкривають IP,
// залежать від CORS і ламають офлайн (P0). Власну чернетку (trusted) лишаємо як є.
function sanitizeImageSrc(src, trusted) {
  if (typeof src !== 'string' || !src) return '';
  if (trusted) return src;
  if (src.startsWith('data:image/') && src.length <= LIMITS.MAX_DATA_URL_LENGTH) return src;
  return '';
}

// Кольори (текст/фон/заливка/контур) приймаємо ЛИШЕ з безпечного allowlist:
// hex, rg[b]/hsl[a]() з самих чисел, або відоме ім'я. Це блокує `url(https://…)`
// у фоні чи fill/stroke, який інакше створив би зовнішній запит (P0).
const SAFE_HEX_COLOR = /^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
const SAFE_FUNC_COLOR = /^(?:rgb|rgba|hsl|hsla)\(\s*[0-9.,%\s/]+\)$/i;
const SAFE_NAMED_COLORS = new Set([
  'transparent', 'currentcolor', 'white', 'black', 'red', 'green', 'blue', 'yellow',
  'orange', 'purple', 'pink', 'gray', 'grey', 'brown', 'cyan', 'magenta', 'navy',
  'teal', 'lime', 'maroon', 'olive', 'silver', 'gold', 'beige', 'ivory', 'coral',
  'salmon', 'khaki', 'violet', 'indigo', 'turquoise', 'crimson', 'tomato', 'wheat',
  'aqua', 'fuchsia'
]);
const ALIGNMENTS = ['left', 'center', 'right'];

function sanitizeColor(value, fallback) {
  if (typeof value !== 'string') return fallback;
  const v = value.trim().slice(0, 64);
  if (SAFE_HEX_COLOR.test(v) || SAFE_FUNC_COLOR.test(v)) return v;
  if (SAFE_NAMED_COLORS.has(v.toLowerCase())) return v;
  return fallback;
}

export function normalizePresentation(raw, { trusted = false } = {}) {
  if (!raw || typeof raw !== 'object') return null;
  if (!Array.isArray(raw.slides) || raw.slides.length === 0) return null;
  if (raw.slides.length > LIMITS.MAX_SLIDES) return null;

  let totalElements = 0;
  for (const slide of raw.slides) {
    if (slide && Array.isArray(slide.elements)) {
      if (slide.elements.length > LIMITS.MAX_ELEMENTS_PER_SLIDE) return null;
      totalElements += slide.elements.length;
    }
  }
  if (totalElements > LIMITS.MAX_TOTAL_ELEMENTS) return null;

  const slides = raw.slides.map((rawSlide, slideIndex) => {
    const slide = rawSlide && typeof rawSlide === 'object' ? rawSlide : {};
    return {
      id: typeof slide.id === 'string' ? slide.id.slice(0, 64) : `slide_${slideIndex}`,
      background: sanitizeColor(slide.background, '#ffffff'),
      elements: Array.isArray(slide.elements)
        ? slide.elements.slice(0, LIMITS.MAX_ELEMENTS_PER_SLIDE).map((element, elementIndex) => normalizeElement(element, elementIndex, { trusted }))
        : []
    };
  });

  // Гарантуємо унікальність ID слайдів і об'єктів. Дублікати (зокрема через
  // обрізання до 64 символів) ламають lookup, вибір, drag, delete, reorder та
  // elementDomMap. Перше входження зберігає свій ID, наступні отримують новий.
  const usedSlideIds = new Set();
  let slideSeq = 0;
  const usedElementIds = new Set();
  let elementSeq = 0;
  for (const slide of slides) {
    while (!slide.id || usedSlideIds.has(slide.id)) slide.id = `slide_${slideSeq++}`;
    usedSlideIds.add(slide.id);
    for (const element of slide.elements) {
      while (!element.id || usedElementIds.has(element.id)) element.id = `el_${elementSeq++}`;
      usedElementIds.add(element.id);
    }
  }

  return {
    fileName: typeof raw.fileName === 'string' && raw.fileName.trim() ? raw.fileName.trim().slice(0, 200) : DEFAULT_PRESENTATION_NAME,
    slides,
    currentSlideId: slides.some(slide => slide.id === raw.currentSlideId) ? raw.currentSlideId : slides[0].id,
    selectedElementIds: []
  };
}

export function normalizeElement(element, index, { trusted = false } = {}) {
  const type = ['text', 'image', 'shape'].includes(element?.type) ? element.type : 'text';
  const shape = SHAPE_TYPES.includes(element?.shape) ? element.shape : 'rect';
  const supportsText = type === 'text' || (type === 'shape' && TEXT_SHAPE_TYPES.includes(shape));
  const placeholder = typeof element?.placeholder === 'string' && element.placeholder.trim()
    ? clampText(element.placeholder)
    : (type === 'text' ? 'Введіть текст...' : '');
  const hasTextContent = typeof element?.content === 'string' && element.content.length > 0;
  const isPlaceholder = supportsText
    ? (typeof element?.isPlaceholder === 'boolean' ? element.isPlaceholder : !hasTextContent)
    : false;
  let content;
  if (supportsText) {
    content = hasTextContent ? clampText(element.content) : (placeholder || '');
  } else if (type === 'image') {
    content = sanitizeImageSrc(element?.content, trusted);
  } else {
    content = '';
  }

  return {
    id: typeof element?.id === 'string' ? element.id.slice(0, 64) : `el_${index}_${Math.random().toString(36).slice(2, 7)}`,
    type,
    shape,
    x: clampCoord(element?.x, 120),
    y: clampCoord(element?.y, 120),
    w: clampSize(element?.w, 240),
    h: clampSize(element?.h, 120),
    z: Number.isFinite(element?.z) ? clamp(element.z, 0, LIMITS.MAX_ELEMENTS_PER_SLIDE + 1) : index + 1,
    rotation: Number.isFinite(element?.rotation) ? ((element.rotation % 360) + 360) % 360 : 0,
    content,
    placeholder,
    isPlaceholder,
    alt: type === 'image' && typeof element?.alt === 'string' ? clampText(element.alt) : '',
    crop: type === 'image' ? normalizeCrop(element?.crop) : null,
    style: normalizeStyle(element?.style)
  };
}

function normalizeStyle(style) {
  const src = style && typeof style === 'object' ? style : {};
  const merged = { ...DEFAULT_TEXT_STYLE, ...DEFAULT_SHAPE_STYLE, ...DEFAULT_IMAGE_STYLE, ...src };
  merged.color = sanitizeColor(merged.color, DEFAULT_TEXT_STYLE.color);
  merged.fill = sanitizeColor(merged.fill, DEFAULT_SHAPE_STYLE.fill);
  merged.stroke = sanitizeColor(merged.stroke, DEFAULT_SHAPE_STYLE.stroke);
  // align вставляється у CSS-селектор у renderToolbarState — суворий allowlist.
  merged.align = ALIGNMENTS.includes(merged.align) ? merged.align : 'left';
  merged.bold = !!merged.bold;
  merged.italic = !!merged.italic;
  merged.underline = !!merged.underline;
  merged.fontSize = Number.isFinite(merged.fontSize) ? clamp(merged.fontSize, 4, 400) : DEFAULT_TEXT_STYLE.fontSize;
  merged.fontFamily = FONT_FAMILY_KEYS.includes(merged.fontFamily) ? merged.fontFamily : DEFAULT_TEXT_STYLE.fontFamily;
  // Інтервал — будь-яке число у діапазоні поля (0.8–3), не лише старі пресети,
  // інакше довільні значення (напр. 1.2) мовчки втрачаються при відкритті/відновленні.
  merged.lineHeight = Number.isFinite(merged.lineHeight) ? clamp(merged.lineHeight, 0.8, 3) : DEFAULT_TEXT_STYLE.lineHeight;
  merged.listType = LIST_TYPES.includes(merged.listType) ? merged.listType : DEFAULT_TEXT_STYLE.listType;
  // Зображення: режим вписування — суворий allowlist (йде в CSS object-fit),
  // прозорість — число 0..1.
  merged.objectFit = IMAGE_FIT_MODES.includes(merged.objectFit) ? merged.objectFit : DEFAULT_IMAGE_STYLE.objectFit;
  merged.opacity = Number.isFinite(merged.opacity) ? clamp(merged.opacity, 0, 1) : DEFAULT_IMAGE_STYLE.opacity;
  return merged;
}

export function slugify(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '') || 'presentation';
}

export function savePresentationFile(presentation) {
  const payload = { ...presentation, schemaVersion: SCHEMA_VERSION, textModelVersion: TEXT_MODEL_VERSION };
  const fileName = `${slugify(presentation.fileName)}.artslides.json`;
  downloadTextFile(fileName, JSON.stringify(payload, null, 2));
}

// Імпорт з файла — НЕдовірений: зовнішні URL та надмірні значення нейтралізуються.
export function parsePresentationText(text) {
  const parsed = JSON.parse(text);
  // Файли без версії — legacy v1. Явно невідому версію не відкриваємо
  // мовчки, бо майбутній формат може мати іншу семантику або втрачати дані.
  if (Object.prototype.hasOwnProperty.call(parsed || {}, 'schemaVersion') &&
      parsed.schemaVersion !== SCHEMA_VERSION) {
    return null;
  }
  if (Object.prototype.hasOwnProperty.call(parsed || {}, 'textModelVersion') &&
      (!Number.isInteger(parsed.textModelVersion) || parsed.textModelVersion < 1 || parsed.textModelVersion > TEXT_MODEL_VERSION)) {
    return null;
  }
  return normalizePresentation(parsed, { trusted: false });
}
