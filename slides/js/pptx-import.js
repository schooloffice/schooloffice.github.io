import { LIMITS, STAGE_HEIGHT, STAGE_WIDTH } from './constants.js';
import { normalizePresentation } from './project.js';

// PPTX Import Lite (пілот): власний читач обмеженої підмножини PresentationML без сторонніх
// бібліотек. ZIP розпаковується нативним DecompressionStream із лімітами, XML — DOMParser без DTD.
// Імпорт лише будує нову нормалізовану модель; застосування до документа вирішує користувач.
// Підтримано: порядок і розмір слайдів, простий фон, текст (runs зводяться до переважного
// оформлення блока), прямокутник/овал, вбудовані PNG/JPEG, прямі перетворення xfrm.
// З макета й зразка слайдів успадковуються лише розміщення placeholder-ів, стилі тексту
// й кольори теми; усе інше перелічується у звіті втрат.
export const PPTX_IMPORT_LIMITS = Object.freeze({
  MAX_FILE_BYTES: LIMITS.MAX_PROJECT_FILE_BYTES,
  MAX_ENTRIES: 2000,
  MAX_TOTAL_UNCOMPRESSED_BYTES: 80 * 1024 * 1024,
  MAX_XML_BYTES: 4 * 1024 * 1024,
  MAX_MEDIA_BYTES: LIMITS.MAX_IMAGE_FILE_BYTES,
  MAX_COMPRESSION_RATIO: 100,
  MAX_XML_NODES: 50000,
  MAX_SLIDES: LIMITS.MAX_SLIDES,
  MAX_ELEMENTS_PER_SLIDE: LIMITS.MAX_ELEMENTS_PER_SLIDE,
  MAX_IMAGES: 300
});

const MB = 1024 * 1024;

export class PptxImportError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'PptxImportError';
    this.code = code;
  }
}

const ERROR_TEXT = {
  'not-zip': () => 'Файл не є архівом PPTX або пошкоджений.',
  'not-pptx': () => 'Це не презентація PowerPoint (.pptx).',
  'too-large': limits => `Файл PPTX завеликий: максимум ${Math.round(limits.MAX_FILE_BYTES / MB)} МБ.`,
  'too-many-entries': () => 'PPTX містить забагато внутрішніх частин.',
  'unsafe-path': () => 'PPTX містить недопустимі шляхи до внутрішніх частин.',
  'unsupported-zip': () => 'Цей варіант архіву PPTX (шифрування, ZIP64 або інший метод стиснення) не підтримується.',
  'zip-bomb': () => 'Розпакований вміст PPTX завеликий або не збігається із заявленим розміром.',
  'corrupt-zip': () => 'Архів PPTX пошкоджено: частину не вдалося розпакувати.',
  'invalid-xml': (limits, part) => `Частина ${part} містить некоректний XML.`,
  'unsafe-xml': (limits, part) => `Частина ${part} містить DTD або оголошення сутностей, які імпорт не обробляє.`,
  'xml-too-complex': (limits, part) => `Частина ${part} завелика або надто складна для імпорту.`,
  'no-slides': () => 'У презентації немає слайдів.',
  'too-many-slides': limits => `Презентація має понад ${limits.MAX_SLIDES} слайдів.`,
  'unsupported-browser': () => 'Цей браузер не підтримує розпакування PPTX.',
  'model-limits': () => 'Імпортована презентація перевищує межі ПЛЮС Слайдів.'
};

function fail(code, limits = PPTX_IMPORT_LIMITS, part = '') {
  throw new PptxImportError(code, ERROR_TEXT[code](limits, part));
}

// --- ZIP ---------------------------------------------------------------------------------

const decoder = new TextDecoder('utf-8');

function toBytes(buffer) {
  if (buffer instanceof ArrayBuffer) return new Uint8Array(buffer);
  if (ArrayBuffer.isView(buffer)) return new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  return null;
}

function findEndOfCentralDirectory(view) {
  for (let offset = view.byteLength - 22; offset >= Math.max(0, view.byteLength - 65557); offset -= 1) {
    if (view.getUint32(offset, true) === 0x06054b50) return offset;
  }
  return -1;
}

function isSafeEntryName(name) {
  if (!name || name.includes('\\') || name.includes('\0') || name.startsWith('/') || /^[a-z][a-z0-9+.-]*:/i.test(name)) return false;
  return !name.split('/').includes('..');
}

function openZip(buffer, limits) {
  const bytes = toBytes(buffer);
  if (!bytes) fail('not-zip', limits);
  if (bytes.byteLength > limits.MAX_FILE_BYTES) fail('too-large', limits);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const end = bytes.byteLength >= 22 ? findEndOfCentralDirectory(view) : -1;
  if (end < 0) fail('not-zip', limits);
  const count = view.getUint16(end + 10, true);
  const directorySize = view.getUint32(end + 12, true);
  let offset = view.getUint32(end + 16, true);
  if (count === 0xffff || offset === 0xffffffff) fail('unsupported-zip', limits);
  if (count > limits.MAX_ENTRIES) fail('too-many-entries', limits);
  if (offset + directorySize > end) fail('not-zip', limits);

  const entries = new Map();
  let declared = 0;
  for (let index = 0; index < count; index += 1) {
    if (offset + 46 > end || view.getUint32(offset, true) !== 0x02014b50) fail('not-zip', limits);
    const flags = view.getUint16(offset + 8, true);
    const method = view.getUint16(offset + 10, true);
    const compressedSize = view.getUint32(offset + 20, true);
    const size = view.getUint32(offset + 24, true);
    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    const localOffset = view.getUint32(offset + 42, true);
    if (offset + 46 + nameLength > end) fail('not-zip', limits);
    const name = decoder.decode(bytes.subarray(offset + 46, offset + 46 + nameLength));
    if (!isSafeEntryName(name)) fail('unsafe-path', limits);
    if (flags & 1) fail('unsupported-zip', limits);
    if (compressedSize === 0xffffffff || size === 0xffffffff || localOffset === 0xffffffff) fail('unsupported-zip', limits);
    declared += size;
    if (declared > limits.MAX_TOTAL_UNCOMPRESSED_BYTES) fail('zip-bomb', limits);
    // Великий запис із надмірним коефіцієнтом стиснення — ознака zip bomb ще до розпакування.
    if (size > MB && size > compressedSize * limits.MAX_COMPRESSION_RATIO) fail('zip-bomb', limits);
    if (!name.endsWith('/')) {
      if (entries.has(name)) fail('corrupt-zip', limits);
      entries.set(name, { name, method, compressedSize, size, localOffset });
    }
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return { bytes, view, entries, inflated: 0, limits };
}

function concatBytes(chunks, length) {
  const out = new Uint8Array(length);
  let offset = 0;
  chunks.forEach(chunk => { out.set(chunk, offset); offset += chunk.byteLength; });
  return out;
}

// Потокове розпакування з жорсткою межею: заголовкам розміру не довіряємо.
async function inflateRaw(packed, maxBytes, limits) {
  const source = new ReadableStream({ start(controller) { controller.enqueue(packed); controller.close(); } });
  const reader = source.pipeThrough(new DecompressionStream('deflate-raw')).getReader();
  const chunks = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > maxBytes) {
        await reader.cancel().catch(() => {});
        fail('zip-bomb', limits);
      }
      chunks.push(value);
    }
  } catch (error) {
    if (error instanceof PptxImportError) throw error;
    fail('corrupt-zip', limits);
  }
  return concatBytes(chunks, length);
}

async function readEntry(zip, name) {
  const entry = zip.entries.get(name);
  if (!entry) return null;
  const { bytes, view, limits } = zip;
  const local = entry.localOffset;
  if (local + 30 > bytes.byteLength || view.getUint32(local, true) !== 0x04034b50) fail('corrupt-zip', limits);
  const start = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true);
  const end = start + entry.compressedSize;
  if (end > bytes.byteLength) fail('corrupt-zip', limits);
  const packed = bytes.subarray(start, end);
  let content;
  if (entry.method === 0) {
    if (entry.compressedSize !== entry.size) fail('corrupt-zip', limits);
    content = packed.slice();
  } else if (entry.method === 8) {
    if (typeof DecompressionStream !== 'function') fail('unsupported-browser', limits);
    content = await inflateRaw(packed, entry.size, limits);
  } else {
    fail('unsupported-zip', limits);
  }
  if (content.byteLength !== entry.size) fail('corrupt-zip', limits);
  zip.inflated += content.byteLength;
  if (zip.inflated > limits.MAX_TOTAL_UNCOMPRESSED_BYTES) fail('zip-bomb', limits);
  return content;
}

// --- XML і зв'язки ----------------------------------------------------------------------------

const NS = {
  a: 'http://schemas.openxmlformats.org/drawingml/2006/main',
  p: 'http://schemas.openxmlformats.org/presentationml/2006/main',
  r: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships',
  mc: 'http://schemas.openxmlformats.org/markup-compatibility/2006'
};

function parseXml(bytes, part, limits) {
  if (bytes.byteLength > limits.MAX_XML_BYTES) fail('xml-too-complex', limits, part);
  const text = decoder.decode(bytes);
  // DTD і сутності не потрібні OOXML і відкривають шлях до entity expansion.
  if (/<!DOCTYPE|<!ENTITY/i.test(text)) fail('unsafe-xml', limits, part);
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  if (doc.getElementsByTagName('parsererror').length) fail('invalid-xml', limits, part);
  if (doc.getElementsByTagName('*').length > limits.MAX_XML_NODES) fail('xml-too-complex', limits, part);
  return doc;
}

function child(node, qname) {
  if (!node) return null;
  const [prefix, local] = qname.split(':');
  for (const item of node.children) {
    if (item.localName === local && item.namespaceURI === NS[prefix]) return item;
  }
  return null;
}

function childrenOf(node, qname) {
  if (!node) return [];
  const [prefix, local] = qname.split(':');
  return [...node.children].filter(item => item.localName === local && item.namespaceURI === NS[prefix]);
}

const find = (node, ...qnames) => qnames.reduce((current, qname) => child(current, qname), node);

function attrNum(node, name, fallback = null) {
  const value = node?.getAttribute(name);
  if (value == null || value === '') return fallback;
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

const relId = (node, name) => node?.getAttributeNS(NS.r, name) || '';

function dirname(part) {
  const index = part.lastIndexOf('/');
  return index < 0 ? '' : part.slice(0, index + 1);
}

// Внутрішня ціль зв'язку розв'язується лише в межах пакета: URI-схеми та вихід за корінь — null.
function resolveTarget(base, target) {
  if (!target || target.includes('\\') || /^[a-z][a-z0-9+.-]*:/i.test(target)) return null;
  const parts = target.startsWith('/') ? [] : dirname(base).split('/').filter(Boolean);
  for (const raw of target.replace(/^\/+/, '').split('/')) {
    let part;
    try {
      part = decodeURIComponent(raw);
    } catch {
      return null;
    }
    if (!part || part === '.') continue;
    if (part === '..') {
      if (!parts.length) return null;
      parts.pop();
    } else if (part.includes('/') || part.includes('\\')) {
      return null;
    } else {
      parts.push(part);
    }
  }
  return parts.join('/');
}

async function readXml(ctx, part) {
  if (!part) return null;
  if (ctx.xmlCache.has(part)) return ctx.xmlCache.get(part);
  const entry = ctx.zip.entries.get(part);
  if (!entry) return null;
  if (entry.size > ctx.limits.MAX_XML_BYTES) fail('xml-too-complex', ctx.limits, part);
  const doc = parseXml(await readEntry(ctx.zip, part), part, ctx.limits);
  ctx.xmlCache.set(part, doc);
  return doc;
}

async function readRelationships(ctx, part) {
  if (ctx.relsCache.has(part)) return ctx.relsCache.get(part);
  const relsPart = `${dirname(part)}_rels/${part.slice(dirname(part).length)}.rels`;
  const rels = new Map();
  const doc = await readXml(ctx, relsPart);
  for (const rel of doc?.documentElement.children || []) {
    if (rel.localName !== 'Relationship') continue;
    const external = rel.getAttribute('TargetMode') === 'External';
    const target = rel.getAttribute('Target') || '';
    rels.set(rel.getAttribute('Id'), {
      type: (rel.getAttribute('Type') || '').split('/').pop(),
      external,
      part: external ? null : resolveTarget(part, target)
    });
  }
  ctx.relsCache.set(part, rels);
  return rels;
}

function firstRelPart(ctx, rels, type) {
  return [...rels.values()].find(rel => rel.type === type && rel.part && ctx.zip.entries.has(rel.part))?.part || null;
}

// --- Звіт про втрати ------------------------------------------------------------------------

const WARNING_TEXT = {
  aspect: entry => `Слайди формату ${entry.details[0]} вписано у формат 16:9 з полями`,
  hiddenSlides: entry => `Приховані слайди імпортовано як звичайні: ${entry.count}`,
  gradientBackground: entry => `Градієнтний фон замінено першим кольором: ${entry.count}`,
  pictureBackground: entry => `Фонове зображення або візерунок не перенесено: ${entry.count}`,
  hyperlinks: entry => `Гіперпосилання не перенесено: ${entry.count}`,
  mixedText: entry => `Змішане форматування в текстовому блоці спрощено до переважного: ${entry.count}`,
  nestedList: entry => `Рівні вкладеності списку спрощено: ${entry.count}`,
  fields: entry => `Поля (дата, номер слайда) перенесено як звичайний текст: ${entry.count}`,
  unsupportedShapes: entry => `Фігури інших типів не перенесено: ${entry.count} (${entry.details.join(', ')})`,
  lines: entry => `Лінії та сполучні лінії не перенесено: ${entry.count}`,
  shapeFill: entry => `Градієнтну, текстурну або візерункову заливку фігур спрощено: ${entry.count}`,
  groups: entry => `Групи об’єктів не перенесено: ${entry.count} (об’єктів у них: ${entry.extra})`,
  tables: entry => `Таблиці не перенесено: ${entry.count}`,
  charts: entry => `Діаграми не перенесено: ${entry.count}`,
  smartArt: entry => `SmartArt не перенесено: ${entry.count}`,
  embedded: entry => `Вбудовані об’єкти (OLE, відео, рукописні) не перенесено: ${entry.count}`,
  flips: entry => `Віддзеркалення об’єктів не перенесено: ${entry.count}`,
  externalImages: entry => `Зовнішні (пов’язані) зображення не завантажуються: ${entry.count}`,
  unsafeTargets: entry => `Посилання на частини поза пакетом відхилено: ${entry.count}`,
  missingParts: entry => `Відсутні частини пакета пропущено: ${entry.count}`,
  imageFormats: entry => `Зображення форматів, крім PNG і JPEG, не перенесено: ${entry.count}`,
  largeImages: entry => `Завеликі зображення не перенесено: ${entry.count}`,
  imageLimit: entry => `Зображення понад ліміт пілота не перенесено: ${entry.count}`,
  hiddenShapes: entry => `Приховані об’єкти пропущено: ${entry.count}`,
  noGeometry: entry => `Об’єкти без розміщення пропущено: ${entry.count}`,
  elementLimit: entry => `Об’єкти понад ліміт слайда пропущено: ${entry.count}`,
  layoutDecor: entry => `Декоративні об’єкти макета чи зразка слайдів не перенесено: ${entry.count}`,
  transitions: entry => `Переходи між слайдами не перенесено: ${entry.count}`,
  animations: entry => `Анімації не перенесено: ${entry.count}`,
  notes: entry => `Нотатки доповідача не перенесено: ${entry.count}`
};

function createReport() {
  const entries = new Map();
  return {
    add(key, { amount = 1, detail = '', extra = 0 } = {}) {
      const entry = entries.get(key) || { count: 0, extra: 0, details: [] };
      entry.count += amount;
      entry.extra += extra;
      if (detail && !entry.details.includes(detail)) entry.details.push(detail);
      entries.set(key, entry);
    },
    list: () => [...entries].map(([key, entry]) => WARNING_TEXT[key](entry))
  };
}

// --- Кольори теми -----------------------------------------------------------------------------

const DEFAULT_CLR_MAP = { bg1: 'lt1', tx1: 'dk1', bg2: 'lt2', tx2: 'dk2' };
const DEFAULT_THEME = Object.freeze({
  scheme: {
    dk1: '000000', lt1: 'FFFFFF', dk2: '44546A', lt2: 'E7E6E6', accent1: '4472C4', accent2: 'ED7D31',
    accent3: 'A5A5A5', accent4: 'FFC000', accent5: '5B9BD5', accent6: '70AD47', hlink: '0563C1', folHlink: '954F72'
  },
  fonts: { major: '', minor: '' },
  bgFills: []
});
const PRESET_COLORS = {
  black: '000000', white: 'FFFFFF', red: 'FF0000', green: '008000', blue: '0000FF', yellow: 'FFFF00',
  gray: '808080', grey: '808080', orange: 'FFA500', purple: '800080', navy: '000080', silver: 'C0C0C0'
};
const HEX6 = /^[0-9a-f]{6}$/i;

function readTheme(doc) {
  const elements = find(doc?.documentElement, 'a:themeElements');
  if (!elements) return DEFAULT_THEME;
  const scheme = { ...DEFAULT_THEME.scheme };
  for (const item of child(elements, 'a:clrScheme')?.children || []) {
    const value = child(item, 'a:srgbClr')?.getAttribute('val') || child(item, 'a:sysClr')?.getAttribute('lastClr');
    if (HEX6.test(value || '')) scheme[item.localName] = value.toUpperCase();
  }
  return {
    scheme,
    fonts: {
      major: find(elements, 'a:fontScheme', 'a:majorFont', 'a:latin')?.getAttribute('typeface') || '',
      minor: find(elements, 'a:fontScheme', 'a:minorFont', 'a:latin')?.getAttribute('typeface') || ''
    },
    bgFills: [...(find(elements, 'a:fmtScheme', 'a:bgFillStyleLst')?.children || [])]
  };
}

function rgbToHsl([r, g, b]) {
  const [rn, gn, bn] = [r / 255, g / 255, b / 255];
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h = max === rn ? (gn - bn) / d + (gn < bn ? 6 : 0) : max === gn ? (bn - rn) / d + 2 : (rn - gn) / d + 4;
  return [h / 6, s, l];
}

function hslToRgb([h, s, l]) {
  if (!s) return [l * 255, l * 255, l * 255];
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const hue = t => {
    const x = t < 0 ? t + 1 : t > 1 ? t - 1 : t;
    if (x < 1 / 6) return p + (q - p) * 6 * x;
    if (x < 1 / 2) return q;
    if (x < 2 / 3) return p + (q - p) * (2 / 3 - x) * 6;
    return p;
  };
  return [hue(h + 1 / 3) * 255, hue(h) * 255, hue(h - 1 / 3) * 255];
}

// Модифікатори кольору: lumMod/lumOff — у HSL за специфікацією, shade/tint — наближено в RGB.
function applyColorModifiers(hex, node) {
  let rgb = [0, 2, 4].map(index => Number.parseInt(hex.slice(index, index + 2), 16));
  for (const modifier of node.children) {
    const value = attrNum(modifier, 'val');
    if (value == null) continue;
    const factor = value / 100000;
    if (modifier.localName === 'shade') rgb = rgb.map(channel => channel * factor);
    else if (modifier.localName === 'tint') rgb = rgb.map(channel => channel + (255 - channel) * (1 - factor));
    else if (modifier.localName === 'lumMod' || modifier.localName === 'lumOff') {
      const hsl = rgbToHsl(rgb);
      hsl[2] = Math.min(1, Math.max(0, modifier.localName === 'lumMod' ? hsl[2] * factor : hsl[2] + factor));
      rgb = hslToRgb(hsl);
    }
  }
  return `#${rgb.map(channel => Math.round(Math.min(255, Math.max(0, channel))).toString(16).padStart(2, '0')).join('')}`;
}

// Колір із контейнера (solidFill, fontRef, gs …). phClr — колір-заповнювач стилю теми.
function colorOf(container, scope, phClr = null) {
  if (!container) return null;
  for (const item of container.children) {
    if (item.namespaceURI !== NS.a) continue;
    let hex = null;
    if (item.localName === 'srgbClr') hex = item.getAttribute('val');
    else if (item.localName === 'sysClr') hex = item.getAttribute('lastClr');
    else if (item.localName === 'prstClr') hex = PRESET_COLORS[item.getAttribute('val')] || null;
    else if (item.localName === 'schemeClr') {
      const value = item.getAttribute('val');
      hex = value === 'phClr' ? phClr : scope.theme.scheme[scope.clrMap[value] || value] || null;
    } else if (item.localName === 'scrgbClr') {
      hex = ['r', 'g', 'b'].map(name => Math.round(Math.min(1, Math.max(0, attrNum(item, name, 0) / 100000)) * 255).toString(16).padStart(2, '0')).join('');
    } else {
      continue;
    }
    return HEX6.test(hex || '') ? applyColorModifiers(hex, item) : null;
  }
  return null;
}

function firstGradientStop(gradFill, scope, phClr = null) {
  const stops = childrenOf(child(gradFill, 'a:gsLst'), 'a:gs').sort((a, b) => attrNum(a, 'pos', 0) - attrNum(b, 'pos', 0));
  return stops.length ? colorOf(stops[0], scope, phClr) : null;
}

// --- Геометрія й placeholder-и -------------------------------------------------------------

const round2 = value => Math.round(value * 100) / 100;

function readXfrm(xfrm, ctx) {
  const off = child(xfrm, 'a:off');
  const ext = child(xfrm, 'a:ext');
  const values = [attrNum(off, 'x'), attrNum(off, 'y'), attrNum(ext, 'cx'), attrNum(ext, 'cy')];
  if (values.some(value => value == null)) return null;
  const [x, y, cx, cy] = values;
  return {
    x: round2(ctx.offsetX + x * ctx.scale),
    y: round2(ctx.offsetY + y * ctx.scale),
    w: round2(Math.max(1, cx * ctx.scale)),
    h: round2(Math.max(1, cy * ctx.scale)),
    rotation: round2((attrNum(xfrm, 'rot', 0) / 60000) % 360),
    flipped: xfrm.getAttribute('flipH') === '1' || xfrm.getAttribute('flipV') === '1'
  };
}

function nonVisualProps(node) {
  return [...node.children].find(item => item.namespaceURI === NS.p && item.localName.startsWith('nv')) || null;
}

const placeholderOf = node => find(nonVisualProps(node), 'p:nvPr', 'p:ph');
const phGroup = type => (type === 'title' || type === 'ctrTitle' ? 'title' : ['body', 'subTitle', 'obj'].includes(type) ? 'body' : type);

function collectPlaceholders(doc) {
  const tree = find(doc?.documentElement, 'p:cSld', 'p:spTree');
  return [...(tree?.children || [])].flatMap(node => {
    const ph = node.namespaceURI === NS.p ? placeholderOf(node) : null;
    return ph ? [{ ph, node, type: ph.getAttribute('type') || 'obj', idx: ph.getAttribute('idx') || '' }] : [];
  });
}

// Як PowerPoint: спершу за idx, далі за точним типом, далі за групою (заголовок/основний текст).
function matchPlaceholder(list, ph) {
  if (!ph || !list.length) return null;
  const type = ph.getAttribute('type') || 'obj';
  const idx = ph.getAttribute('idx') || '';
  if (idx && idx !== '0') {
    const byIdx = list.find(item => item.idx === idx);
    if (byIdx) return byIdx;
  }
  return list.find(item => item.type === type) || list.find(item => phGroup(item.type) === phGroup(type)) || null;
}

function placeholderChain(node, scope) {
  const ph = placeholderOf(node);
  const layout = matchPlaceholder(scope.layoutPlaceholders, ph);
  const master = matchPlaceholder(scope.masterPlaceholders, layout ? layout.ph : ph);
  return { ph, layout, master, type: ph ? (ph.getAttribute('type') || layout?.type || 'obj') : null };
}

function inheritedXfrm(node, chain) {
  return child(child(node, 'p:spPr'), 'a:xfrm')
    || child(child(chain.layout?.node, 'p:spPr'), 'a:xfrm')
    || child(child(chain.master?.node, 'p:spPr'), 'a:xfrm');
}

// --- Текст -------------------------------------------------------------------------------------

const ALIGN = { l: 'left', ctr: 'center', r: 'right', just: 'left', dist: 'left' };

function fontFamilyKey(typeface) {
  const name = String(typeface || '');
  if (/mono|courier|consolas|lucida console/i.test(name)) return 'mono';
  if (/comic/i.test(name)) return 'rounded';
  if (/sans/i.test(name)) return 'sans';
  if (/serif|times|georgia|cambria|garamond|palatino|book antiqua/i.test(name)) return 'serif';
  return 'sans';
}

function bulletKind(pPr) {
  if (!pPr) return null;
  if (child(pPr, 'a:buNone')) return 'none';
  if (child(pPr, 'a:buAutoNum')) return 'number';
  if (child(pPr, 'a:buChar') || child(pPr, 'a:buBlip')) return 'bullet';
  return null;
}

function levelProps(source, level) {
  return child(source, `a:lvl${level + 1}pPr`);
}

function majority(runs, key) {
  const weights = new Map();
  runs.forEach(run => weights.set(run[key], (weights.get(run[key]) || 0) + run.weight));
  let best = null;
  let bestWeight = -1;
  weights.forEach((weight, value) => {
    if (weight > bestWeight) {
      best = value;
      bestWeight = weight;
    }
  });
  return best;
}

// Модель Слайдів має оформлення на рівні блока: runs зводяться до переважного за кількістю
// символів оформлення, а розбіжності позначаються у звіті. Ланцюжок стилів: run → lstStyle
// фігури → fontRef стилю → lstStyle макета й зразка → txStyles зразка → defaultTextStyle.
function readText(node, chain, scope, ctx, report, styleNode) {
  const txBody = child(node, 'p:txBody');
  if (!txBody) return null;
  const own = child(txBody, 'a:lstStyle');
  const inherited = [find(chain.layout?.node, 'p:txBody', 'a:lstStyle'), find(chain.master?.node, 'p:txBody', 'a:lstStyle')];
  if (chain.ph) {
    const group = phGroup(chain.type);
    const styleName = group === 'title' ? 'p:titleStyle' : group === 'body' ? 'p:bodyStyle' : 'p:otherStyle';
    inherited.push(find(scope.master?.documentElement, 'p:txStyles', styleName));
  }
  inherited.push(scope.defaultTextStyle);
  const sources = [own, ...inherited].filter(Boolean);
  const fontRefColor = colorOf(child(styleNode, 'a:fontRef'), scope);
  const fontScale = attrNum(find(txBody, 'a:bodyPr', 'a:normAutofit'), 'fontScale', 100000) / 100000;

  const paragraphProp = (pPr, level, getter) => {
    const direct = getter(pPr);
    if (direct != null) return direct;
    for (const source of sources) {
      const value = getter(levelProps(source, level));
      if (value != null) return value;
    }
    return null;
  };
  const runProp = (rPr, level, getter, styleValue = null) => {
    const direct = getter(rPr);
    if (direct != null) return direct;
    const ownValue = getter(child(levelProps(own, level), 'a:defRPr'));
    if (ownValue != null) return ownValue;
    if (styleValue != null) return styleValue;
    for (const source of inherited) {
      const value = getter(child(levelProps(source, level), 'a:defRPr'));
      if (value != null) return value;
    }
    return null;
  };
  const flag = name => rPr => (rPr?.hasAttribute(name) ? ['1', 'true'].includes(rPr.getAttribute(name)) : null);

  const paragraphs = [];
  const runs = [];
  let links = find(nonVisualProps(node), 'p:cNvPr', 'a:hlinkClick') ? 1 : 0;
  let fields = 0;
  let nested = false;
  for (const paragraph of childrenOf(txBody, 'a:p')) {
    const pPr = child(paragraph, 'a:pPr');
    const level = Math.min(8, Math.max(0, attrNum(pPr, 'lvl', 0)));
    let text = '';
    for (const item of paragraph.children) {
      if (item.namespaceURI !== NS.a) continue;
      if (item.localName === 'br') {
        text += '\n';
        continue;
      }
      if (item.localName !== 'r' && item.localName !== 'fld') continue;
      const value = child(item, 'a:t')?.textContent || '';
      const rPr = child(item, 'a:rPr');
      if (item.localName === 'fld') fields += 1;
      if (child(rPr, 'a:hlinkClick')) links += 1;
      text += value;
      if (!value.trim()) continue;
      const typeface = runProp(rPr, level, props => child(props, 'a:latin')?.getAttribute('typeface') || null) || '+mn-lt';
      runs.push({
        weight: value.length,
        size: runProp(rPr, level, props => (attrNum(props, 'sz') ? attrNum(props, 'sz') / 100 : null)) ?? 18,
        bold: !!runProp(rPr, level, flag('b')),
        italic: !!runProp(rPr, level, flag('i')),
        underline: !!runProp(rPr, level, props => (props?.hasAttribute('u') ? props.getAttribute('u') !== 'none' : null)),
        color: runProp(rPr, level, props => colorOf(child(props, 'a:solidFill'), scope), fontRefColor) || '#000000',
        font: fontFamilyKey(typeface === '+mj-lt' ? scope.theme.fonts.major : typeface === '+mn-lt' ? scope.theme.fonts.minor : typeface)
      });
    }
    const hasText = !!text.trim();
    if (hasText && level > 0) nested = true;
    paragraphs.push({
      text,
      hasText,
      bullet: hasText ? paragraphProp(pPr, level, bulletKind) || 'none' : null,
      align: paragraphProp(pPr, level, props => props?.getAttribute('algn') || null) || 'l',
      lineSpacing: paragraphProp(pPr, level, props => attrNum(find(props, 'a:lnSpc', 'a:spcPct'), 'val'))
    });
  }

  if (links) report.add('hyperlinks', { amount: links });
  if (fields) report.add('fields', { amount: fields });
  const content = paragraphs.map(item => item.text).join('\n').replace(/\n+$/, '');
  if (!content.trim()) return null;
  const textParagraphs = paragraphs.filter(item => item.hasText);
  const bullets = textParagraphs.map(item => ({ bullet: item.bullet, weight: 1 }));
  const aligns = textParagraphs.map(item => ({ align: item.align, weight: 1 }));
  const mixed = ['size', 'bold', 'italic', 'underline', 'color', 'font'].some(key => new Set(runs.map(run => run[key])).size > 1)
    || new Set(aligns.map(item => item.align)).size > 1
    || new Set(bullets.map(item => item.bullet)).size > 1;
  if (mixed) report.add('mixedText');
  const listType = majority(bullets, 'bullet') || 'none';
  if (nested && listType !== 'none') report.add('nestedList');
  const lineSpacing = textParagraphs[0]?.lineSpacing;
  return {
    content,
    style: {
      fontSize: Math.round((majority(runs, 'size') ?? 18) * fontScale * ctx.pointScale * 10) / 10,
      color: majority(runs, 'color') || '#000000',
      bold: !!majority(runs, 'bold'),
      italic: !!majority(runs, 'italic'),
      underline: !!majority(runs, 'underline'),
      align: ALIGN[majority(aligns, 'align')] || 'left',
      fontFamily: majority(runs, 'font') || 'sans',
      lineHeight: lineSpacing ? Math.min(3, Math.max(0.8, round2(1.2 * lineSpacing / 100000))) : 1.2,
      listType
    }
  };
}

// --- Фігури, зображення, інші об'єкти -------------------------------------------------------

const SHAPE_NAMES = {
  custom: 'довільна фігура', star4: 'зірка', star5: 'зірка', star6: 'зірка', star7: 'зірка', star8: 'зірка', star10: 'зірка',
  star12: 'зірка', star16: 'зірка', star24: 'зірка', star32: 'зірка', triangle: 'трикутник', rtTriangle: 'трикутник',
  roundRect: 'заокруглений прямокутник', diamond: 'ромб', pentagon: 'п’ятикутник', hexagon: 'шестикутник',
  rightArrow: 'стрілка', leftArrow: 'стрілка', upArrow: 'стрілка', downArrow: 'стрілка', cloud: 'хмара', heart: 'серце'
};
const LINE_GEOMETRIES = new Set(['line', 'straightConnector1', 'bentConnector2', 'bentConnector3', 'curvedConnector3']);

function hiddenObject(node, report) {
  if (child(nonVisualProps(node), 'p:cNvPr')?.getAttribute('hidden') !== '1') return false;
  report.add('hiddenShapes');
  return true;
}

function resolveFill(spPr, styleNode, scope, report) {
  if (child(spPr, 'a:noFill')) return 'transparent';
  const solid = child(spPr, 'a:solidFill');
  if (solid) return colorOf(solid, scope) || 'transparent';
  const gradient = child(spPr, 'a:gradFill');
  if (gradient) {
    report.add('shapeFill');
    return firstGradientStop(gradient, scope) || 'transparent';
  }
  if (child(spPr, 'a:blipFill') || child(spPr, 'a:pattFill')) {
    report.add('shapeFill');
    return 'transparent';
  }
  const fillRef = child(styleNode, 'a:fillRef');
  return fillRef && attrNum(fillRef, 'idx', 0) > 0 ? colorOf(fillRef, scope) : null;
}

function resolveLine(spPr, styleNode, scope) {
  const line = child(spPr, 'a:ln');
  if (child(line, 'a:noFill')) return 'transparent';
  const solid = child(line, 'a:solidFill');
  if (solid) return colorOf(solid, scope) || 'transparent';
  const lnRef = child(styleNode, 'a:lnRef');
  return lnRef && attrNum(lnRef, 'idx', 0) > 0 ? colorOf(lnRef, scope) : null;
}

function convertShape(node, scope, ctx, report) {
  if (hiddenObject(node, report)) return null;
  const chain = placeholderChain(node, scope);
  const spPr = child(node, 'p:spPr');
  const geometry = child(spPr, 'a:prstGeom')?.getAttribute('prst') || (child(spPr, 'a:custGeom') ? 'custom' : 'rect');
  if (LINE_GEOMETRIES.has(geometry)) {
    report.add('lines');
    return null;
  }
  if (geometry !== 'rect' && geometry !== 'ellipse') {
    report.add('unsupportedShapes', { detail: SHAPE_NAMES[geometry] || 'інша фігура' });
    return null;
  }
  const box = readXfrm(inheritedXfrm(node, chain), ctx);
  if (!box) {
    report.add('noGeometry');
    return null;
  }
  if (box.flipped) report.add('flips');
  const styleNode = child(node, 'p:style');
  const text = readText(node, chain, scope, ctx, report, styleNode);
  const fill = resolveFill(spPr, styleNode, scope, report);
  const stroke = resolveLine(spPr, styleNode, scope);
  const textBox = find(nonVisualProps(node), 'p:cNvSpPr')?.getAttribute('txBox') === '1';
  const visibleFill = !!fill && fill !== 'transparent';
  const visibleLine = !!stroke && stroke !== 'transparent';
  const base = { x: box.x, y: box.y, w: box.w, h: box.h, rotation: box.rotation, isPlaceholder: false, placeholder: '' };
  if (geometry === 'ellipse' || (!chain.ph && !textBox && (visibleFill || visibleLine))) {
    return {
      ...base,
      type: 'shape',
      shape: geometry === 'ellipse' ? 'circle' : 'rect',
      content: text?.content || '',
      style: { ...(text?.style || {}), fill: fill || 'transparent', stroke: stroke || 'transparent' }
    };
  }
  // Порожній placeholder чи напис у показі PowerPoint не видно — не створюємо порожній блок.
  return text ? { ...base, type: 'text', content: text.content, style: text.style } : null;
}

function imageMime(bytes) {
  if (bytes.byteLength > 8 && [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((value, index) => bytes[index] === value)) return 'image/png';
  if (bytes.byteLength > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  return null;
}

function toBase64(bytes) {
  let binary = '';
  for (let index = 0; index < bytes.byteLength; index += 0x8000) {
    binary += String.fromCharCode.apply(null, bytes.subarray(index, index + 0x8000));
  }
  return btoa(binary);
}

async function convertPicture(node, scope, ctx, report) {
  if (hiddenObject(node, report)) return null;
  const blip = find(node, 'p:blipFill', 'a:blip');
  const embedId = relId(blip, 'embed');
  if (!embedId) {
    report.add(relId(blip, 'link') ? 'externalImages' : 'missingParts');
    return null;
  }
  const rel = scope.slideRels.get(embedId);
  if (rel?.external) {
    report.add('externalImages');
    return null;
  }
  if (rel && !rel.part) {
    report.add('unsafeTargets');
    return null;
  }
  const entry = rel ? ctx.zip.entries.get(rel.part) : null;
  if (!entry) {
    report.add('missingParts');
    return null;
  }
  if (entry.size > ctx.limits.MAX_MEDIA_BYTES) {
    report.add('largeImages');
    return null;
  }
  if (ctx.imageCount >= ctx.limits.MAX_IMAGES) {
    report.add('imageLimit');
    return null;
  }
  const box = readXfrm(inheritedXfrm(node, placeholderChain(node, scope)), ctx);
  if (!box) {
    report.add('noGeometry');
    return null;
  }
  const bytes = await readEntry(ctx.zip, rel.part);
  const mime = imageMime(bytes);
  if (!mime) {
    report.add('imageFormats');
    return null;
  }
  if (box.flipped) report.add('flips');
  ctx.imageCount += 1;
  const srcRect = find(node, 'p:blipFill', 'a:srcRect');
  const crop = Object.fromEntries(['l', 't', 'r', 'b'].map(side => [side, Math.max(0, attrNum(srcRect, side, 0) / 100000)]));
  const alpha = attrNum(child(blip, 'a:alphaModFix'), 'amt');
  return {
    type: 'image',
    x: box.x, y: box.y, w: box.w, h: box.h, rotation: box.rotation,
    content: `data:${mime};base64,${toBase64(bytes)}`,
    alt: child(nonVisualProps(node), 'p:cNvPr')?.getAttribute('descr') || '',
    crop,
    style: { objectFit: 'cover', opacity: alpha == null ? 1 : Math.min(1, Math.max(0, alpha / 100000)) }
  };
}

function countLeafObjects(group) {
  return [...group.children].reduce((sum, item) => {
    if (item.namespaceURI !== NS.p) return sum;
    if (item.localName === 'grpSp') return sum + countLeafObjects(item);
    return ['sp', 'pic', 'cxnSp', 'graphicFrame', 'contentPart'].includes(item.localName) ? sum + 1 : sum;
  }, 0);
}

function reportGraphicFrame(node, report) {
  const uri = find(node, 'a:graphic', 'a:graphicData')?.getAttribute('uri') || '';
  if (uri.endsWith('/table')) report.add('tables');
  else if (uri.includes('chart')) report.add('charts');
  else if (uri.endsWith('/diagram')) report.add('smartArt');
  else report.add('embedded');
}

async function convertTree(tree, scope, ctx, report, elements) {
  for (const node of tree?.children || []) {
    if (node.namespaceURI === NS.mc && node.localName === 'AlternateContent') {
      await convertTree(child(node, 'mc:Fallback'), scope, ctx, report, elements);
      continue;
    }
    if (node.namespaceURI !== NS.p) continue;
    if (['sp', 'pic'].includes(node.localName) && elements.length >= ctx.limits.MAX_ELEMENTS_PER_SLIDE) {
      report.add('elementLimit');
      continue;
    }
    let element = null;
    if (node.localName === 'sp') element = convertShape(node, scope, ctx, report);
    else if (node.localName === 'pic') element = await convertPicture(node, scope, ctx, report);
    else if (node.localName === 'grpSp') report.add('groups', { extra: countLeafObjects(node) });
    else if (node.localName === 'graphicFrame') reportGraphicFrame(node, report);
    else if (node.localName === 'cxnSp') report.add('lines');
    else if (node.localName === 'contentPart') report.add('embedded');
    if (element) elements.push({ ...element, id: `pptx-${ctx.slideIndex + 1}-${elements.length + 1}`, z: elements.length + 1 });
  }
}

// --- Слайди -----------------------------------------------------------------------------------

function attributesOf(node) {
  return Object.fromEntries([...(node?.attributes || [])].map(attribute => [attribute.localName, attribute.value]));
}

async function slideScope(ctx, slidePart, slideDoc, defaultTextStyle) {
  const slideRels = await readRelationships(ctx, slidePart);
  const layoutPart = firstRelPart(ctx, slideRels, 'slideLayout');
  const layout = await readXml(ctx, layoutPart);
  const masterPart = layoutPart ? firstRelPart(ctx, await readRelationships(ctx, layoutPart), 'slideMaster') : null;
  const master = await readXml(ctx, masterPart);
  const themePart = masterPart ? firstRelPart(ctx, await readRelationships(ctx, masterPart), 'theme') : null;
  if (!ctx.themes.has(themePart)) ctx.themes.set(themePart, readTheme(await readXml(ctx, themePart)));
  const clrMap = {
    ...DEFAULT_CLR_MAP,
    ...attributesOf(child(master?.documentElement, 'p:clrMap')),
    ...attributesOf(find(slideDoc.documentElement, 'p:clrMapOvr', 'a:overrideClrMapping'))
  };
  return {
    slideRels, layoutPart, layout, masterPart, master, clrMap, defaultTextStyle,
    theme: ctx.themes.get(themePart),
    layoutPlaceholders: collectPlaceholders(layout),
    masterPlaceholders: collectPlaceholders(master)
  };
}

function resolveBackground(docs, scope, report) {
  const fillColor = (fill, phClr) => {
    if (fill?.localName === 'solidFill') return colorOf(fill, scope, phClr) || '#ffffff';
    if (fill?.localName === 'gradFill') {
      report.add('gradientBackground');
      return firstGradientStop(fill, scope, phClr) || '#ffffff';
    }
    if (fill?.localName === 'blipFill' || fill?.localName === 'pattFill') report.add('pictureBackground');
    return '#ffffff';
  };
  for (const doc of docs) {
    const background = find(doc?.documentElement, 'p:cSld', 'p:bg');
    if (!background) continue;
    const properties = child(background, 'p:bgPr');
    if (properties) {
      const fill = [...properties.children].find(item => ['solidFill', 'gradFill', 'blipFill', 'pattFill', 'noFill'].includes(item.localName));
      return fillColor(fill, null);
    }
    const reference = child(background, 'p:bgRef');
    if (reference) {
      const color = colorOf(reference, scope);
      const index = attrNum(reference, 'idx', 0);
      const themeFill = index >= 1001 ? scope.theme.bgFills[index - 1001] : null;
      return themeFill ? fillColor(themeFill, color?.slice(1)) : color || '#ffffff';
    }
  }
  return '#ffffff';
}

function reportLayoutDecor(ctx, scope, slideDoc, report) {
  if (slideDoc.documentElement.getAttribute('showMasterSp') === '0') return;
  const inspect = (doc, part) => {
    if (!doc || ctx.decorParts.has(part)) return;
    ctx.decorParts.add(part);
    const tree = find(doc.documentElement, 'p:cSld', 'p:spTree');
    const decor = [...(tree?.children || [])].filter(node => node.namespaceURI === NS.p
      && ['sp', 'pic', 'grpSp', 'graphicFrame', 'cxnSp'].includes(node.localName) && !placeholderOf(node));
    if (decor.length) report.add('layoutDecor', { amount: decor.length });
  };
  inspect(scope.layout, scope.layoutPart);
  if (scope.layout?.documentElement.getAttribute('showMasterSp') !== '0') inspect(scope.master, scope.masterPart);
}

async function convertSlide(ctx, slidePart, defaultTextStyle, report) {
  const doc = await readXml(ctx, slidePart);
  const root = doc.documentElement;
  if (root.namespaceURI !== NS.p || root.localName !== 'sld') fail('not-pptx', ctx.limits);
  if (root.getAttribute('show') === '0') report.add('hiddenSlides');
  const scope = await slideScope(ctx, slidePart, doc, defaultTextStyle);
  const background = resolveBackground([doc, scope.layout, scope.master], scope, report);
  const elements = [];
  await convertTree(find(root, 'p:cSld', 'p:spTree'), scope, ctx, report, elements);
  reportLayoutDecor(ctx, scope, doc, report);
  if (doc.getElementsByTagNameNS(NS.p, 'transition').length) report.add('transitions');
  if (doc.getElementsByTagNameNS(NS.p, 'spTgt').length) report.add('animations');
  const notesDoc = await readXml(ctx, firstRelPart(ctx, scope.slideRels, 'notesSlide'));
  const notesText = [...(notesDoc?.getElementsByTagNameNS(NS.p, 'sp') || [])]
    .some(shape => placeholderOf(shape)?.getAttribute('type') === 'body' && shape.textContent.trim());
  if (notesText) report.add('notes');
  return {
    id: `pptx-slide-${ctx.slideIndex + 1}`,
    background,
    layout: 'blank',
    transition: { type: 'none', duration: 'normal' },
    notes: '',
    elements
  };
}

function ratioLabel(cx, cy) {
  const ratio = cx / cy;
  const known = [[4 / 3, '4:3'], [16 / 10, '16:10'], [297 / 210, 'A4'], [3 / 2, '3:2'], [1, '1:1']];
  return known.find(([value]) => Math.abs(ratio - value) < 0.01)?.[1] || `${round2(ratio)}:1`;
}

const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

export async function importPptxArrayBuffer(buffer, { fileName = 'Презентація.pptx', limits = PPTX_IMPORT_LIMITS } = {}) {
  const started = now();
  if (typeof DOMParser !== 'function') fail('unsupported-browser', limits);
  const zip = openZip(buffer, limits);
  const ctx = { zip, limits, xmlCache: new Map(), relsCache: new Map(), themes: new Map(), decorParts: new Set(), imageCount: 0, slideIndex: 0 };
  const officeDocument = firstRelPart(ctx, await readRelationships(ctx, ''), 'officeDocument') || 'ppt/presentation.xml';
  if (!zip.entries.has(officeDocument)) fail('not-pptx', limits);
  const root = (await readXml(ctx, officeDocument)).documentElement;
  if (root.namespaceURI !== NS.p || root.localName !== 'presentation') fail('not-pptx', limits);

  const size = child(root, 'p:sldSz');
  const cx = Math.min(51206400, Math.max(914400, attrNum(size, 'cx', 12192000)));
  const cy = Math.min(51206400, Math.max(914400, attrNum(size, 'cy', 6858000)));
  ctx.scale = Math.min(STAGE_WIDTH / cx, STAGE_HEIGHT / cy);
  ctx.offsetX = (STAGE_WIDTH - cx * ctx.scale) / 2;
  ctx.offsetY = (STAGE_HEIGHT - cy * ctx.scale) / 2;
  // 1 pt = 12700 EMU: розмір шрифту масштабуємо разом зі слайдом.
  ctx.pointScale = 12700 * ctx.scale;

  const report = createReport();
  if (Math.abs(cx / cy - STAGE_WIDTH / STAGE_HEIGHT) > 0.01) report.add('aspect', { detail: ratioLabel(cx, cy) });
  const slideIds = childrenOf(child(root, 'p:sldIdLst'), 'p:sldId');
  if (!slideIds.length) fail('no-slides', limits);
  if (slideIds.length > limits.MAX_SLIDES) fail('too-many-slides', limits);
  const presentationRels = await readRelationships(ctx, officeDocument);
  const defaultTextStyle = child(root, 'p:defaultTextStyle');
  const slides = [];
  for (const [index, slideId] of slideIds.entries()) {
    const rel = presentationRels.get(relId(slideId, 'id'));
    if (!rel || !rel.part || !zip.entries.has(rel.part)) {
      report.add(rel && !rel.external && !rel.part ? 'unsafeTargets' : 'missingParts');
      continue;
    }
    ctx.slideIndex = index;
    slides.push(await convertSlide(ctx, rel.part, defaultTextStyle, report));
  }
  if (!slides.length) fail('no-slides', limits);

  const presentation = normalizePresentation({
    fileName: String(fileName).replace(/\.pptx$/i, '').trim() || 'Презентація',
    theme: 'classic',
    slides,
    currentSlideId: slides[0].id
  }, { trusted: false });
  if (!presentation) fail('model-limits', limits);
  return {
    presentation,
    report: {
      fileName,
      slideCount: presentation.slides.length,
      importedElements: presentation.slides.reduce((sum, slide) => sum + slide.elements.length, 0),
      warnings: report.list(),
      durationMs: Math.round(now() - started),
      sourceBytes: zip.bytes.byteLength,
      inflatedBytes: zip.inflated
    }
  };
}
