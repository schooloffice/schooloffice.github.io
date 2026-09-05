'use strict';

window.ArtVector = window.ArtVector || {};

// P0-валідація недовіреного project-файлу (див. PROJECT_DIRECTION.md §8).
// Файл проєкту — це JSON, який учень може отримати звідки завгодно, тому перед
// потраплянням у state він проходить повну нормалізацію: allowlist типів,
// межі кількості й розмірів, санітизація кольорів і рядків. Нормалізатор
// БУДУЄ нові об'єкти з дозволених полів, а не «чистить» вхідні — так у стан не
// потрапляють сторонні ключі.
(() => {
  const { utils, constants } = window.ArtVector;

  const PROJECT_FORMAT = 'art-vector-project';
  const PROJECT_VERSION = 1;

  const LIMITS = {
    MAX_FILE_BYTES: 8 * 1024 * 1024,
    MAX_FILE_CHARS: 8 * 1024 * 1024,
    MAX_OBJECTS: 2000,
    MAX_PEN_POINTS: 4000,
    MAX_TOTAL_PEN_POINTS: 60000,
    MAX_TEXT_LENGTH: 5000,
    MAX_TEXT_LINES: 200,
    MAX_NAME_LENGTH: 100,
    MIN_CANVAS: 100,
    MAX_CANVAS: 10000,
    // Окрема межа площі: 10000×10000 проходить по сторонах, але PNG-експорт і друк
    // створюють canvas на 100 млн пікселів (~400 МБ RGBA) і вішають вкладку.
    // Значення узгоджене з paint MAX_DOC_PIXELS (16 Мп).
    MAX_CANVAS_PIXELS: 16777216,
    MAX_COORD: 40000,
    MIN_STROKE_WIDTH: 0.5,
    MAX_STROKE_WIDTH: 200,
    MIN_FONT_SIZE: 4,
    MAX_FONT_SIZE: 400
  };

  const OBJECT_TYPES = ['rect', 'ellipse', 'triangle', 'diamond', 'star', 'line', 'arrow', 'pen', 'curve', 'text'];
  const GUIDE_MODES = ['none', 'grid', 'lines'];
  const HEX_COLOR = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;
  const SAFE_ID = /^[A-Za-z0-9_-]{1,64}$/;

  const DEFAULT_STROKE = '#1f2937';

  // Дозволені лише `none` і hex — жодних `url(...)`, `rgb(...)` чи довільних
  // рядків, які потім опиняться в SVG-атрибуті.
  function sanitizeColor(value, fallback) {
    if (typeof value !== 'string') return fallback;
    const trimmed = value.trim();
    if (trimmed.toLowerCase() === 'none') return 'none';
    return HEX_COLOR.test(trimmed) ? trimmed.toLowerCase() : fallback;
  }

  function clampNumber(value, min, max, fallback) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return fallback;
    return utils.clamp(numeric, min, max);
  }

  function clampCoord(value, fallback = 0) {
    return clampNumber(value, -LIMITS.MAX_COORD, LIMITS.MAX_COORD, fallback);
  }

  function clampSpan(value, fallback = 0) {
    return clampNumber(value, 0, LIMITS.MAX_COORD, fallback);
  }

  function stripControlChars(value) {
    let out = '';
    for (const char of value) {
      const code = char.codePointAt(0);
      if (code >= 32 && code !== 127) out += char;
    }
    return out;
  }

  // XML 1.0 забороняє більшість керівних символів навіть у екранованому вигляді.
  // Якщо вони доживуть до тексту, XMLSerializer видасть їх у SVG як є, і
  // експортований файл стане невалідним XML (а PNG-експорт, який рендерить той
  // самий SVG, просто не завантажиться). Дозволені: TAB, LF, CR.
  function stripXmlInvalidChars(value) {
    let out = '';
    for (const char of value) {
      const code = char.codePointAt(0);
      const allowed = code === 0x09 || code === 0x0a || code === 0x0d
        || (code >= 0x20 && code <= 0xd7ff)
        || (code >= 0xe000 && code <= 0xfffd)
        || code >= 0x10000;
      if (allowed) out += char;
    }
    return out;
  }

  function sanitizeName(value, fallback) {
    if (typeof value !== 'string') return fallback;
    // Керівні символи ламають назву файла й статус-бар.
    const cleaned = stripControlChars(value).trim();
    return cleaned ? cleaned.slice(0, LIMITS.MAX_NAME_LENGTH) : fallback;
  }

  function sanitizeText(value) {
    const raw = stripXmlInvalidChars(typeof value === 'string' ? value : '');
    const lines = raw.replace(/\r/g, '').split('\n').slice(0, LIMITS.MAX_TEXT_LINES);
    return lines.join('\n').slice(0, LIMITS.MAX_TEXT_LENGTH);
  }

  function sanitizeId(value, type, seenIds) {
    const candidate = typeof value === 'string' && SAFE_ID.test(value) && !seenIds.has(value)
      ? value
      : utils.uid(type);
    seenIds.add(candidate);
    return candidate;
  }

  // Ідентифікатор групи з чужого файла — просто мітка, за якою фігури
  // виділяються разом. Обмежуємо довжину й набір символів, щоб він не став
  // носієм довільного рядка зі стороннього JSON.
  function sanitizeGroupId(value) {
    if (typeof value !== 'string') return null;
    const trimmed = value.trim();
    if (!trimmed || trimmed.length > 64) return null;
    return /^[A-Za-z0-9_-]+$/.test(trimmed) ? trimmed : null;
  }

  function normalizeCommon(raw, type, seenIds) {
    const common = {
      id: sanitizeId(raw.id, type, seenIds),
      type,
      stroke: sanitizeColor(raw.stroke, DEFAULT_STROKE),
      fill: sanitizeColor(raw.fill, 'none'),
      strokeWidth: clampNumber(raw.strokeWidth, LIMITS.MIN_STROKE_WIDTH, LIMITS.MAX_STROKE_WIDTH, 3),
      opacity: clampNumber(raw.opacity, 0, 100, 100)
    };
    const groupId = sanitizeGroupId(raw.groupId);
    if (groupId) common.groupId = groupId;
    return common;
  }

  function normalizePoints(raw) {
    if (!Array.isArray(raw)) return [];
    const points = [];
    for (const point of raw.slice(0, LIMITS.MAX_PEN_POINTS)) {
      if (!point || typeof point !== 'object') continue;
      const x = Number(point.x);
      const y = Number(point.y);
      if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
      points.push({ x: clampCoord(x), y: clampCoord(y) });
    }
    return points;
  }

  // Повертає нормалізований об'єкт або null, якщо його треба відкинути.
  function normalizeObject(raw, seenIds) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    const type = typeof raw.type === 'string' ? raw.type : '';
    if (!OBJECT_TYPES.includes(type)) return null;

    const object = normalizeCommon(raw, type, seenIds);

    if (constants.RECT_LIKE_TYPES.includes(type)) {
      object.x = clampCoord(raw.x);
      object.y = clampCoord(raw.y);
      object.w = clampSpan(raw.w, constants.MIN_SHAPE_SIZE);
      object.h = clampSpan(raw.h, constants.MIN_SHAPE_SIZE);
      return object;
    }

    if (constants.LINE_TYPES.includes(type)) {
      object.x1 = clampCoord(raw.x1);
      object.y1 = clampCoord(raw.y1);
      object.x2 = clampCoord(raw.x2);
      object.y2 = clampCoord(raw.y2);
      return object;
    }

    if (constants.POINT_TYPES.includes(type)) {
      object.points = normalizePoints(raw.points);
      // Один вузол не малює нічого — такий об'єкт лише засмічує сцену.
      return object.points.length >= 2 ? object : null;
    }

    object.x = clampCoord(raw.x);
    object.y = clampCoord(raw.y);
    object.fontSize = clampNumber(raw.fontSize, LIMITS.MIN_FONT_SIZE, LIMITS.MAX_FONT_SIZE, 32);
    object.text = sanitizeText(raw.text);
    return object;
  }

  // Повертає нормалізований payload або null, якщо файл структурно некоректний
  // чи виходить за межі. Окремі зіпсовані об'єкти відкидаються тихо, але
  // перевищення лімітів файла — це відмова, щоб учень бачив причину.
  function normalizeProject(raw) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    if (raw.format !== undefined && raw.format !== PROJECT_FORMAT) return null;
    if (raw.version !== undefined && !(Number.isInteger(raw.version) && raw.version <= PROJECT_VERSION)) return null;

    const rawObjects = raw.objects === undefined ? [] : raw.objects;
    if (!Array.isArray(rawObjects)) return null;
    if (rawObjects.length > LIMITS.MAX_OBJECTS) return null;

    const seenIds = new Set();
    const objects = [];
    let totalPenPoints = 0;
    for (const item of rawObjects) {
      const normalized = normalizeObject(item, seenIds);
      if (!normalized) continue;
      if (constants.POINT_TYPES.includes(normalized.type)) {
        totalPenPoints += normalized.points.length;
        if (totalPenPoints > LIMITS.MAX_TOTAL_PEN_POINTS) return null;
      }
      objects.push(normalized);
    }

    const canvasWidth = clampNumber(raw.canvasWidth, LIMITS.MIN_CANVAS, LIMITS.MAX_CANVAS, constants.DEFAULT_CANVAS_WIDTH);
    const canvasHeight = clampNumber(raw.canvasHeight, LIMITS.MIN_CANVAS, LIMITS.MAX_CANVAS, constants.DEFAULT_CANVAS_HEIGHT);
    if (canvasWidth * canvasHeight > LIMITS.MAX_CANVAS_PIXELS) return null;

    const guideMode = GUIDE_MODES.includes(raw.guideMode) ? raw.guideMode : 'grid';
    const currentTool = Object.prototype.hasOwnProperty.call(constants.TOOLS, raw.currentTool)
      ? raw.currentTool
      : 'select';

    return {
      format: PROJECT_FORMAT,
      version: PROJECT_VERSION,
      fileName: sanitizeName(raw.fileName, constants.DEFAULT_FILE_NAME),
      canvasWidth,
      canvasHeight,
      guideMode,
      snapToGrid: typeof raw.snapToGrid === 'boolean' ? raw.snapToGrid : true,
      currentTool,
      currentStroke: sanitizeColor(raw.currentStroke, DEFAULT_STROKE),
      currentFill: sanitizeColor(raw.currentFill, 'none'),
      currentStrokeWidth: clampNumber(raw.currentStrokeWidth, LIMITS.MIN_STROKE_WIDTH, LIMITS.MAX_STROKE_WIDTH, 3),
      currentOpacity: clampNumber(raw.currentOpacity, 0, 100, 100),
      currentFontSize: clampNumber(raw.currentFontSize, LIMITS.MIN_FONT_SIZE, LIMITS.MAX_FONT_SIZE, 32),
      objects
    };
  }

  // Єдина точка входу для тексту з файла: розмір -> JSON -> схема.
  function parseProjectText(text) {
    const source = String(text || '');
    if (source.length > LIMITS.MAX_FILE_CHARS) {
      return { ok: false, reason: 'too-large', payload: null };
    }
    let raw;
    try {
      raw = JSON.parse(source);
    } catch {
      return { ok: false, reason: 'not-json', payload: null };
    }
    const payload = normalizeProject(raw);
    return payload ? { ok: true, reason: null, payload } : { ok: false, reason: 'schema', payload: null };
  }

  window.ArtVector.projectIo = {
    PROJECT_FORMAT,
    PROJECT_VERSION,
    LIMITS,
    OBJECT_TYPES,
    sanitizeColor,
    normalizeObject,
    normalizeProject,
    parseProjectText
  };
})();
