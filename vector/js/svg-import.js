'use strict';

window.ArtVector = window.ArtVector || {};

// Імпорт SVG обмеженої підмножини. Файл розбирається DOMParser як окремий XML-документ:
// жоден вузол не потрапляє в живий DOM, скрипти не виконуються, ресурси не завантажуються.
// Із дерева будуються звичайні об'єкти редактора, а payload проходить ту саму нормалізацію,
// що й project-файл. Небезпечний, пошкоджений або надто складний файл відхиляється цілком;
// непідтримане пропускається чи спрощується з точним попередженням.
(() => {
  const { constants, projectIo } = window.ArtVector;

  const SVG_NS = 'http://www.w3.org/2000/svg';
  const XML_NS = 'http://www.w3.org/XML/1998/namespace';
  const XLINK_NS = 'http://www.w3.org/1999/xlink';

  const SVG_LIMITS = {
    MAX_FILE_BYTES: 5 * 1024 * 1024,
    MAX_ELEMENTS: 20000,
    MAX_DEPTH: 64,
    MAX_TRANSFORM_STEPS: 32,
    // Кількість вершин багатокутника, яким замінюється повернутий або скошений еліпс.
    ELLIPSE_SEGMENTS: 64
  };

  const IDENTITY = [1, 0, 0, 1, 0, 0];
  const NUMBER = /[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/g;
  const PATH_TOKEN = /[MmLlHhVvZzCcSsQqTtAa]|[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/g;
  const LENGTH = /^([+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)(px|pt|pc|mm|cm|in|em|ex|%)?$/i;
  const UNIT_PX = { px: 1, pt: 96 / 72, pc: 16, mm: 96 / 25.4, cm: 96 / 2.54, in: 96, em: 16, ex: 8 };
  const FONT_SIZE_KEYWORDS = { 'xx-small': 9, 'x-small': 10, small: 13, medium: 16, large: 18, 'x-large': 24, 'xx-large': 32 };

  // Стандартне оголошення SVG 1.0/1.1 без внутрішньої частини нічого не визначає й нічого не
  // завантажує, тож його прибираємо перед розбором. Будь-яке інше оголошення DTD чи сутності —
  // відмова: сутності відкривають шлях до entity expansion.
  const STANDARD_DOCTYPE = /<!DOCTYPE\s+svg\s+PUBLIC\s+"-\/\/W3C\/\/DTD SVG 1\.[01](?: Basic| Tiny)?\/\/EN"\s+"http:\/\/www\.w3\.org\/[\w./-]+\.dtd"\s*>/i;

  const UNSAFE_ELEMENTS = new Set(['script', 'foreignobject', 'handler', 'listener', 'iframe', 'embed', 'object', 'audio', 'video']);
  const SCRIPT_URL = /(?:java|vb)script:/i;

  // Властивості, які читаємо з атрибутів, класів <style> і атрибута style. Решту ігноруємо.
  const STYLE_PROPERTIES = [
    'fill', 'stroke', 'stroke-width', 'opacity', 'fill-opacity', 'stroke-opacity', 'display', 'visibility', 'color',
    'font-size', 'font-family', 'font-style', 'text-anchor', 'marker-start', 'marker-mid', 'marker-end',
    'clip-path', 'mask', 'filter', 'stop-color', 'stop-opacity'
  ];
  const INHERITED_PROPERTIES = [
    'fill', 'stroke', 'stroke-width', 'fill-opacity', 'stroke-opacity', 'visibility', 'color',
    'font-size', 'font-family', 'font-style', 'text-anchor', 'marker-start', 'marker-mid', 'marker-end'
  ];
  const ROOT_STYLE = { fill: 'black', stroke: 'none', 'stroke-width': '1', visibility: 'visible', color: 'black', 'font-size': '16' };

  // Не малюються самі по собі: вміст визначень використовується лише через посилання.
  const NON_RENDERED = new Set([
    'defs', 'symbol', 'marker', 'clipPath', 'mask', 'pattern', 'linearGradient', 'radialGradient', 'filter',
    'style', 'title', 'desc', 'metadata', 'cursor', 'view', 'font', 'font-face', 'color-profile', 'stop'
  ]);
  const ANIMATION_ELEMENTS = new Set(['animate', 'animateTransform', 'animateMotion', 'animateColor', 'set', 'discard']);

  const NAMED_COLORS = {
    black: '#000000', white: '#ffffff', red: '#ff0000', lime: '#00ff00', green: '#008000', blue: '#0000ff',
    yellow: '#ffff00', cyan: '#00ffff', aqua: '#00ffff', magenta: '#ff00ff', fuchsia: '#ff00ff', gray: '#808080',
    grey: '#808080', silver: '#c0c0c0', maroon: '#800000', olive: '#808000', navy: '#000080', purple: '#800080',
    teal: '#008080', orange: '#ffa500'
  };

  const WARNINGS = {
    curves: n => `Контури з кривими або дугами пропущено: ${n}`,
    'ellipse-polygon': n => `Повернуті або скошені еліпси перетворено на багатокутники: ${n}`,
    holes: n => `Отвори в складених контурах зафарбовано: ${n}`,
    'filled-open': n => `Незамкнені залиті контури й ламані замкнено: ${n}`,
    rounded: n => `Скруглення кутів прямокутників спрощено: ${n}`,
    'text-rotated': n => `Повернутий, скошений або віддзеркалений текст пропущено: ${n}`,
    'text-scaled': n => `Нерівномірно розтягнутий текст спрощено до рівномірного розміру: ${n}`,
    'text-font': n => `Шрифт і накреслення тексту замінено типовими: ${n}`,
    'text-anchor': n => `Вирівнювання тексту за центром або правим краєм не перенесено: ${n}`,
    'text-path': n => `Текст уздовж контуру перенесено звичайним рядком: ${n}`,
    effects: n => `Обрізання (clip-path), маски й фільтри не застосовано: ${n}`,
    gradient: n => `Градієнти замінено першим кольором: ${n}`,
    pattern: n => `Візерунки (pattern) не перенесено: ${n}`,
    'paint-ref': n => `Посилання на відсутню заливку не перенесено: ${n}`,
    color: n => `Невідомі кольори замінено типовими: ${n}`,
    'split-opacity': n => `Різну прозорість заливки й контуру зведено до однієї: ${n}`,
    markers: n => `Маркери на початку й у вузлах ліній, а також на ламаних і контурах не перенесено: ${n}`,
    'marker-arrow': n => `Власні наконечники ліній замінено типовою стрілкою: ${n}`,
    css: n => `Правила CSS у <style>, крім селекторів класів, не застосовано: ${n}`,
    invisible: n => `Невидимі елементи без заливки й контуру пропущено: ${n}`,
    invalid: n => `Елементи з некоректними атрибутами пропущено: ${n}`,
    use: n => `Клони (<use>) не перенесено: ${n}`,
    image: n => `Растрові зображення (<image>) не перенесено: ${n}`,
    animation: n => `Анімацію не перенесено: ${n}`,
    'nested-svg': n => `Вкладені <svg> пропущено: ${n}`,
    switch: n => `Умовні блоки <switch> пропущено: ${n}`,
    unknown: (n, ctx) => `Невідомі елементи пропущено: ${n} (${[...ctx.unknown].slice(0, 5).map(name => `<${name}>`).join(', ')})`
  };

  class SvgImportError extends Error {
    constructor(reason, detail = '') {
      super(reason);
      this.reason = reason;
      this.detail = detail;
    }
  }

  function fail(reason, detail) {
    throw new SvgImportError(reason, detail);
  }

  const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
  const round = value => Math.round(value * 100) / 100;
  const roundPoint = point => ({ x: round(point.x), y: round(point.y) });
  const shortValue = value => {
    const text = String(value).trim();
    return text.length > 60 ? `${text.slice(0, 57)}…` : text;
  };

  // ---- Розбір і перевірка безпеки ----

  function parseDocument(source) {
    if (source.length > SVG_LIMITS.MAX_FILE_BYTES) fail('too-large');
    const withoutDoctype = source.replace(STANDARD_DOCTYPE, '');
    if (/<!DOCTYPE|<!ENTITY/i.test(withoutDoctype)) fail('dtd');
    if (/<\?xml-stylesheet/i.test(withoutDoctype)) fail('unsafe', 'зовнішня таблиця стилів <?xml-stylesheet?>');
    let doc;
    try {
      doc = new DOMParser().parseFromString(withoutDoctype, 'application/xml');
    } catch {
      fail('malformed');
    }
    if (!doc || doc.getElementsByTagNameNS('*', 'parsererror').length) fail('malformed');
    const root = doc.documentElement;
    if (!root || root.localName !== 'svg' || root.namespaceURI !== SVG_NS) fail('not-svg');
    if (doc.getElementsByTagName('*').length > SVG_LIMITS.MAX_ELEMENTS) {
      fail('too-complex', `понад ${SVG_LIMITS.MAX_ELEMENTS} елементів`);
    }
    return doc;
  }

  // url(...) у значенні: дозволено лише посилання на елемент цього ж файла (#id).
  function hasExternalUrl(value) {
    const pattern = /url\(\s*(['"]?)([^'")]*)\1\s*\)/gi;
    for (const match of value.matchAll(pattern)) {
      if (!match[2].trim().startsWith('#')) return true;
    }
    return /url\(/i.test(value.replace(pattern, ''));
  }

  function isAllowedHref(element, value) {
    const href = value.trim();
    if (!href || href.startsWith('#')) return true;
    // Вбудований растр не відкривається й не малюється: <image> пропускається з попередженням.
    return element.localName === 'image' && /^data:image\/(?:png|jpe?g|gif|webp);base64,/i.test(href);
  }

  // Увесь документ перевіряється до побудови моделі: небезпечний вміст відхиляє файл, навіть
  // якщо лежить у <defs> чи в елементі, який імпорт однаково пропустив би.
  function scanSafety(doc) {
    const stack = [[doc.documentElement, 1]];
    while (stack.length) {
      const [element, depth] = stack.pop();
      if (depth > SVG_LIMITS.MAX_DEPTH) fail('too-complex', `вкладеність глибша за ${SVG_LIMITS.MAX_DEPTH} рівні`);
      if (UNSAFE_ELEMENTS.has(element.localName.toLowerCase())) fail('unsafe', `елемент <${element.localName}>`);
      for (const attr of Array.from(element.attributes)) {
        const name = attr.localName.toLowerCase();
        if (name.startsWith('on')) fail('unsafe', `обробник події ${attr.name}`);
        if (SCRIPT_URL.test(attr.value.replace(/[ - ]+/g, ''))) fail('unsafe', `посилання ${shortValue(attr.value)}`);
        if (name === 'href' && !isAllowedHref(element, attr.value)) {
          fail('unsafe', `зовнішнє посилання ${attr.name}="${shortValue(attr.value)}"`);
        }
        if (hasExternalUrl(attr.value) || /@import/i.test(attr.value)) {
          fail('unsafe', `зовнішній ресурс у ${attr.name}="${shortValue(attr.value)}"`);
        }
      }
      if (element.localName === 'style' && (/@import/i.test(element.textContent) || hasExternalUrl(element.textContent))) {
        fail('unsafe', 'зовнішній ресурс у <style>');
      }
      for (const child of Array.from(element.children)) stack.push([child, depth + 1]);
    }
  }

  // ---- Стилі ----

  function parseDeclarations(text) {
    const declared = {};
    for (const part of String(text || '').split(';')) {
      const colon = part.indexOf(':');
      if (colon < 0) continue;
      const name = part.slice(0, colon).trim().toLowerCase();
      const value = part.slice(colon + 1).replace(/!important/i, '').trim();
      if (value && STYLE_PROPERTIES.includes(name)) declared[name] = value;
    }
    return declared;
  }

  // Підтримуються лише правила з селекторами класів (.cls-1 { fill: … }), які типово пишуть
  // експортери іконок; інші селектори й @-правила названо в попередженні.
  function readClassRules(doc, ctx) {
    const rules = new Map();
    for (const styleElement of Array.from(doc.getElementsByTagNameNS(SVG_NS, 'style'))) {
      const css = styleElement.textContent.replace(/\/\*[\s\S]*?\*\//g, '');
      if (!css.trim()) continue;
      let unsupported = css.includes('@');
      for (const [, selectors, body] of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
        const declared = parseDeclarations(body);
        for (const selector of selectors.split(',')) {
          const match = /^\.([A-Za-z_-][\w-]*)$/.exec(selector.trim());
          if (!match) {
            unsupported = true;
            continue;
          }
          rules.set(match[1], { ...(rules.get(match[1]) || {}), ...declared });
        }
      }
      if (unsupported) ctx.warn('css');
    }
    return rules;
  }

  // Порядок пріоритету як у браузері: атрибут < правило класу < атрибут style.
  function readDeclarations(element, ctx) {
    const declared = {};
    for (const name of STYLE_PROPERTIES) {
      const value = element.getAttribute(name);
      if (value !== null && value.trim()) declared[name] = value.trim();
    }
    for (const className of (element.getAttribute('class') || '').split(/\s+/)) {
      if (className && ctx.classRules.has(className)) Object.assign(declared, ctx.classRules.get(className));
    }
    return Object.assign(declared, parseDeclarations(element.getAttribute('style')));
  }

  function parseOpacity(value, fallback) {
    if (value === undefined || value === null) return fallback;
    const text = String(value).trim();
    const number = text.endsWith('%') ? Number(text.slice(0, -1)) / 100 : Number(text);
    return text && Number.isFinite(number) ? clamp(number, 0, 1) : fallback;
  }

  // null — атрибута немає, NaN — некоректне значення.
  function parseLength(value, percentBase = null) {
    if (value === null || value === undefined) return null;
    const match = LENGTH.exec(String(value).trim());
    if (!match) return NaN;
    const number = Number(match[1]);
    const unit = (match[2] || 'px').toLowerCase();
    if (unit === '%') return percentBase === null ? NaN : number * percentBase / 100;
    return number * UNIT_PX[unit];
  }

  function lengthAttr(element, name, percentBase, fallback) {
    const value = element.getAttribute(name);
    if (value === null || !value.trim() || value.trim() === 'auto') return fallback;
    return parseLength(value, percentBase);
  }

  function parseNumberList(value) {
    const text = String(value ?? '');
    if (text.replace(NUMBER, ' ').replace(/[\s,]+/g, '')) return null;
    return (text.match(NUMBER) || []).map(Number);
  }

  function childState(element, parent, ctx) {
    const declared = readDeclarations(element, ctx);
    const style = { ...parent.style };
    for (const name of INHERITED_PROPERTIES) {
      if (declared[name] !== undefined && declared[name] !== 'inherit') style[name] = declared[name];
    }
    const local = parseTransformList(element.getAttribute('transform'));
    if (!local) return null;
    const space = element.getAttributeNS(XML_NS, 'space');
    return {
      ctm: multiply(parent.ctm, local),
      style,
      opacity: parent.opacity * parseOpacity(declared.opacity, 1),
      hidden: parent.hidden || declared.display === 'none',
      preserveSpace: space ? space === 'preserve' : parent.preserveSpace,
      effects: ['clip-path', 'mask', 'filter'].some(name => declared[name] && declared[name] !== 'none')
    };
  }

  const isHidden = state => state.hidden || /^(?:hidden|collapse)$/.test(String(state.style.visibility || '').trim());

  // ---- Кольори ----

  function toHex(channels) {
    return `#${channels.map(value => Math.round(clamp(value, 0, 255)).toString(16).padStart(2, '0')).join('')}`;
  }

  function parseColor(value, style) {
    const text = String(value).trim().toLowerCase();
    if (text === 'currentcolor') return style.color && String(style.color).trim().toLowerCase() !== 'currentcolor' ? parseColor(style.color, {}) : { hex: '#000000', alpha: 1 };
    if (text === 'none' || text === 'transparent') return { hex: 'none', alpha: 1 };
    if (NAMED_COLORS[text]) return { hex: NAMED_COLORS[text], alpha: 1 };
    const hexMatch = /^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/.exec(text);
    if (hexMatch) {
      let digits = hexMatch[1];
      if (digits.length <= 4) digits = digits.split('').map(char => char + char).join('');
      return { hex: `#${digits.slice(0, 6)}`, alpha: digits.length === 8 ? parseInt(digits.slice(6), 16) / 255 : 1 };
    }
    const rgbMatch = /^rgba?\(([^)]*)\)$/.exec(text);
    if (rgbMatch) {
      const parts = rgbMatch[1].trim().split(/\s*[,/]\s*|\s+/).filter(Boolean);
      if (parts.length < 3 || parts.length > 4) return null;
      const channels = parts.slice(0, 3).map(part => (part.endsWith('%') ? Number(part.slice(0, -1)) * 2.55 : Number(part)));
      const alpha = parts[3] === undefined ? 1 : parseOpacity(parts[3], NaN);
      if (channels.some(channel => !Number.isFinite(channel)) || Number.isNaN(alpha)) return null;
      return { hex: toHex(channels), alpha };
    }
    return null;
  }

  function firstGradientStop(gradient, ctx) {
    let current = gradient;
    for (let hop = 0; current && hop < 8; hop += 1) {
      const stop = Array.from(current.children).find(node => node.localName === 'stop' && node.namespaceURI === SVG_NS);
      if (stop) {
        const declared = readDeclarations(stop, ctx);
        const color = parseColor(declared['stop-color'] || 'black', {});
        return color ? { hex: color.hex, alpha: color.alpha * parseOpacity(declared['stop-opacity'], 1) } : null;
      }
      const href = current.getAttribute('href') || current.getAttributeNS(XLINK_NS, 'href') || '';
      current = href.startsWith('#') ? ctx.ids.get(href.slice(1)) : null;
    }
    return null;
  }

  // Повертає { hex, alpha } або null, якщо значення не вдалося розібрати.
  function resolvePaint(value, style, ctx) {
    const text = String(value ?? '').trim();
    const urlMatch = /^url\(\s*['"]?#([^'")]+)['"]?\s*\)\s*(.*)$/i.exec(text);
    if (urlMatch) {
      const target = ctx.ids.get(urlMatch[1]);
      const name = target?.localName;
      if (name === 'linearGradient' || name === 'radialGradient') {
        ctx.warn('gradient');
        const stop = firstGradientStop(target, ctx);
        if (stop) return stop;
      } else {
        ctx.warn(name === 'pattern' ? 'pattern' : 'paint-ref');
      }
      return urlMatch[2].trim() ? resolvePaint(urlMatch[2], style, ctx) : { hex: 'none', alpha: 1 };
    }
    const color = parseColor(text, style);
    if (!color) ctx.warn('color');
    return color;
  }

  // Модель має одну прозорість на об'єкт і лише hex-кольори: зводимо все до них.
  function paintOf(state, ctx, { withFill = true } = {}) {
    const fill = withFill ? (resolvePaint(state.style.fill, state.style, ctx) || { hex: '#000000', alpha: 1 }) : { hex: 'none', alpha: 1 };
    const stroke = resolvePaint(state.style.stroke, state.style, ctx) || { hex: 'none', alpha: 1 };
    const widthRaw = parseLength(state.style['stroke-width'], ctx.viewport.diagonal);
    const width = (Number.isFinite(widthRaw) && widthRaw >= 0 ? widthRaw : 1) * matrixScale(state.ctm);

    const fillAlpha = fill.hex === 'none' ? 0 : fill.alpha * parseOpacity(state.style['fill-opacity'], 1);
    const strokeAlpha = stroke.hex === 'none' || !(width > 0) ? 0 : stroke.alpha * parseOpacity(state.style['stroke-opacity'], 1);
    const hasFill = fillAlpha > 0;
    const hasStroke = strokeAlpha > 0;
    if (hasFill && hasStroke && Math.abs(fillAlpha - strokeAlpha) > 0.01) ctx.warn('split-opacity');
    const alpha = hasFill ? fillAlpha : (hasStroke ? strokeAlpha : 1);
    return {
      fill: hasFill ? fill.hex : 'none',
      stroke: hasStroke ? stroke.hex : 'none',
      strokeWidth: round(hasStroke ? width : 1),
      opacity: Math.round(clamp(state.opacity * alpha, 0, 1) * 100),
      hasFill,
      hasStroke
    };
  }

  // ---- Перетворення ----

  function multiply(m, n) {
    return [
      m[0] * n[0] + m[2] * n[1],
      m[1] * n[0] + m[3] * n[1],
      m[0] * n[2] + m[2] * n[3],
      m[1] * n[2] + m[3] * n[3],
      m[0] * n[4] + m[2] * n[5] + m[4],
      m[1] * n[4] + m[3] * n[5] + m[5]
    ];
  }

  const apply = (m, x, y) => ({ x: m[0] * x + m[2] * y + m[4], y: m[1] * x + m[3] * y + m[5] });
  const matrixScale = m => Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2]));
  const nearZero = (value, m) => Math.abs(value) <= 1e-9 * Math.max(1, Math.abs(m[0]), Math.abs(m[1]), Math.abs(m[2]), Math.abs(m[3]));
  // Прямокутник після такого перетворення лишається прямокутником зі сторонами вздовж осей.
  const isAxisAligned = m => (nearZero(m[1], m) && nearZero(m[2], m)) || (nearZero(m[0], m) && nearZero(m[3], m));

  function transformStep(name, args) {
    if (!args) return null;
    const count = args.length;
    const toRadians = degrees => degrees * Math.PI / 180;
    switch (name) {
      case 'matrix':
        return count === 6 ? args : null;
      case 'translate':
        return count === 1 || count === 2 ? [1, 0, 0, 1, args[0], args[1] ?? 0] : null;
      case 'scale':
        return count === 1 || count === 2 ? [args[0], 0, 0, args[1] ?? args[0], 0, 0] : null;
      case 'rotate': {
        if (count !== 1 && count !== 3) return null;
        const angle = toRadians(args[0]);
        const rotation = [Math.cos(angle), Math.sin(angle), -Math.sin(angle), Math.cos(angle), 0, 0];
        if (count === 1) return rotation;
        return multiply(multiply([1, 0, 0, 1, args[1], args[2]], rotation), [1, 0, 0, 1, -args[1], -args[2]]);
      }
      case 'skewX':
        return count === 1 ? [1, 0, Math.tan(toRadians(args[0])), 1, 0, 0] : null;
      case 'skewY':
        return count === 1 ? [1, Math.tan(toRadians(args[0])), 0, 1, 0, 0] : null;
      default:
        return null;
    }
  }

  // Повертає матрицю або null для некоректного списку; надто довгий список — відмова файла.
  function parseTransformList(value) {
    const text = String(value ?? '').trim();
    if (!text) return IDENTITY;
    const pattern = /\s*(matrix|translate|scale|rotate|skewX|skewY)\s*\(([^)]*)\)\s*,?/y;
    let matrix = IDENTITY;
    let steps = 0;
    pattern.lastIndex = 0;
    while (pattern.lastIndex < text.length) {
      const match = pattern.exec(text);
      if (!match) return null;
      steps += 1;
      if (steps > SVG_LIMITS.MAX_TRANSFORM_STEPS) {
        fail('too-complex', `понад ${SVG_LIMITS.MAX_TRANSFORM_STEPS} перетворень в одному атрибуті transform`);
      }
      const step = transformStep(match[1], parseNumberList(match[2]));
      if (!step || !step.every(Number.isFinite)) return null;
      matrix = multiply(matrix, step);
    }
    return matrix;
  }

  function parsePreserveAspectRatio(value) {
    const [align = 'xMidYMid', mode = 'meet'] = String(value || '').trim().split(/\s+/).filter(Boolean);
    return { align, slice: mode === 'slice' };
  }

  // Полотно й матриця кореня: viewBox, preserveAspectRatio і розмір у допустимих межах проєкту.
  function rootViewport(root, ctx) {
    const viewBoxValue = root.getAttribute('viewBox');
    const numbers = viewBoxValue === null ? null : parseNumberList(viewBoxValue);
    const box = numbers && numbers.length === 4 && numbers[2] > 0 && numbers[3] > 0 ? numbers : null;
    const readSize = name => {
      const value = root.getAttribute(name);
      if (value === null || /%\s*$/.test(value)) return null;
      const size = parseLength(value);
      return size > 0 ? size : null;
    };
    let width = readSize('width');
    let height = readSize('height');
    if (box) {
      if (width === null && height === null) {
        width = box[2];
        height = box[3];
      } else if (width === null) {
        width = height * box[2] / box[3];
      } else if (height === null) {
        height = width * box[3] / box[2];
      }
    }
    if (width === null || height === null) {
      width = width ?? constants.DEFAULT_CANVAS_WIDTH;
      height = height ?? constants.DEFAULT_CANVAS_HEIGHT;
      ctx.notes.push(`Розмір малюнка у файлі не задано: використано ${Math.round(width)} × ${Math.round(height)}`);
    }

    let viewBoxMatrix = IDENTITY;
    if (box) {
      const { align, slice } = parsePreserveAspectRatio(root.getAttribute('preserveAspectRatio'));
      let sx = width / box[2];
      let sy = height / box[3];
      if (align !== 'none') sx = sy = slice ? Math.max(sx, sy) : Math.min(sx, sy);
      let tx = -box[0] * sx;
      let ty = -box[1] * sy;
      if (align !== 'none') {
        const extraX = width - box[2] * sx;
        const extraY = height - box[3] * sy;
        if (align.includes('xMid')) tx += extraX / 2;
        else if (align.includes('xMax')) tx += extraX;
        if (align.includes('YMid')) ty += extraY / 2;
        else if (align.includes('YMax')) ty += extraY;
      }
      viewBoxMatrix = [sx, 0, 0, sy, tx, ty];
    }

    const limits = projectIo.LIMITS;
    let scale = 1;
    if (Math.max(width, height) > limits.MAX_CANVAS) scale = limits.MAX_CANVAS / Math.max(width, height);
    if (width * height * scale * scale > limits.MAX_CANVAS_PIXELS) scale = Math.min(scale, Math.sqrt(limits.MAX_CANVAS_PIXELS / (width * height)));
    if (Math.min(width, height) * scale < limits.MIN_CANVAS) scale = limits.MIN_CANVAS / Math.min(width, height);
    const canvasWidth = clamp(Math.floor(width * scale + 1e-6), limits.MIN_CANVAS, limits.MAX_CANVAS);
    const canvasHeight = clamp(Math.floor(height * scale + 1e-6), limits.MIN_CANVAS, limits.MAX_CANVAS);
    if (Math.abs(scale - 1) > 1e-6) {
      ctx.notes.push(`Малюнок ${Math.round(width)} × ${Math.round(height)} масштабовано до полотна ${canvasWidth} × ${canvasHeight}`);
    }
    const userWidth = box ? box[2] : width;
    const userHeight = box ? box[3] : height;
    return {
      matrix: multiply([scale, 0, 0, scale, 0, 0], viewBoxMatrix),
      canvasWidth,
      canvasHeight,
      width: userWidth,
      height: userHeight,
      diagonal: Math.sqrt((userWidth * userWidth + userHeight * userHeight) / 2)
    };
  }

  // ---- Контури ----

  // Лише прямі відрізки (M, L, H, V, Z). Криві й дуги модель не зберігає — такий контур
  // пропускається цілком. Повертає масив частин, 'curves' або null для некоректних даних.
  function parsePathData(value, pointBudget) {
    const text = String(value ?? '');
    if (text.replace(PATH_TOKEN, ' ').replace(/[\s,]+/g, '')) return null;
    const tokens = text.match(PATH_TOKEN) || [];
    if (!tokens.length) return [];
    if (tokens.some(token => /^[CcSsQqTtAa]$/.test(token))) return 'curves';
    if (!/^[Mm]$/.test(tokens[0])) return null;

    const isCommand = token => /^[A-Za-z]$/.test(token);
    const subpaths = [];
    let current = null;
    let x = 0;
    let y = 0;
    let startX = 0;
    let startY = 0;
    let command = '';
    let index = 0;
    let count = 0;
    const number = () => {
      const token = tokens[index];
      if (token === undefined || isCommand(token)) throw new SyntaxError('path');
      index += 1;
      return Number(token);
    };
    const addPoint = (nextX, nextY, newSubpath) => {
      if (newSubpath || !current) {
        current = { points: [], closed: false };
        subpaths.push(current);
        if (!newSubpath) {
          current.points.push({ x, y });
          count += 1;
        }
      }
      x = nextX;
      y = nextY;
      current.points.push({ x, y });
      count += 1;
      if (count > pointBudget) fail('too-complex', `понад ${projectIo.LIMITS.MAX_TOTAL_PEN_POINTS} точок у всіх фігурах`);
    };

    try {
      while (index < tokens.length) {
        if (isCommand(tokens[index])) {
          command = tokens[index];
          index += 1;
        } else if (command === 'Z' || command === 'z') {
          return null;
        }
        const relative = command === command.toLowerCase();
        switch (command.toUpperCase()) {
          case 'M': {
            const nextX = number() + (relative ? x : 0);
            const nextY = number() + (relative ? y : 0);
            addPoint(nextX, nextY, true);
            startX = nextX;
            startY = nextY;
            command = relative ? 'l' : 'L';
            break;
          }
          case 'L': {
            const nextX = number() + (relative ? x : 0);
            const nextY = number() + (relative ? y : 0);
            addPoint(nextX, nextY, false);
            break;
          }
          case 'H':
            addPoint(number() + (relative ? x : 0), y, false);
            break;
          case 'V':
            addPoint(x, number() + (relative ? y : 0), false);
            break;
          case 'Z':
            if (current) current.closed = true;
            current = null;
            x = startX;
            y = startY;
            break;
          default:
            return null;
        }
      }
    } catch (error) {
      if (error instanceof SvgImportError) throw error;
      return null;
    }
    return subpaths;
  }

  function cleanPoints(points, closed) {
    const cleaned = [];
    for (const point of points) {
      const last = cleaned[cleaned.length - 1];
      if (!last || Math.abs(last.x - point.x) > 0.005 || Math.abs(last.y - point.y) > 0.005) cleaned.push(point);
    }
    if (closed && cleaned.length > 2) {
      const first = cleaned[0];
      const last = cleaned[cleaned.length - 1];
      if (Math.abs(first.x - last.x) <= 0.005 && Math.abs(first.y - last.y) <= 0.005) cleaned.pop();
    }
    return cleaned;
  }

  function parsePointList(value) {
    const numbers = parseNumberList(value) || [];
    const points = [];
    for (let index = 0; index + 1 < numbers.length; index += 2) points.push({ x: numbers[index], y: numbers[index + 1] });
    return points;
  }

  function sameCycle(expected, actual, tolerance) {
    const count = actual.length;
    if (expected.length !== count) return false;
    const close = (a, b) => Math.abs(a.x - b.x) <= tolerance && Math.abs(a.y - b.y) <= tolerance;
    for (let offset = 0; offset < count; offset += 1) {
      if (expected.every((point, index) => close(point, actual[(offset + index) % count]))) return true;
      if (expected.every((point, index) => close(point, actual[(offset - index + count) % count]))) return true;
    }
    return false;
  }

  // Трикутник, ромб і зірку власний експорт пише багатокутниками тих самих формул, що й
  // редактор. Такий багатокутник повертається своїм типом, щоб лишитися звичною фігурою.
  function classifyPolygon(points, base) {
    const { editor } = window.ArtVector;
    if (!editor || ![3, 4, 10].includes(points.length)) return null;
    const xs = points.map(point => point.x);
    const ys = points.map(point => point.y);
    const left = Math.min(...xs);
    const top = Math.min(...ys);
    const width = Math.max(...xs) - left;
    const height = Math.max(...ys) - top;
    if (width < constants.MIN_SHAPE_SIZE || height < constants.MIN_SHAPE_SIZE) return null;
    const tolerance = Math.max(0.5, Math.max(width, height) * 0.002);
    let candidate;
    if (points.length === 3) candidate = { type: 'triangle', generator: 'trianglePoints', x: left, y: top, w: width, h: height };
    if (points.length === 4) candidate = { type: 'diamond', generator: 'diamondPoints', x: left, y: top, w: width, h: height };
    if (points.length === 10) {
      // Крайні вершини зірки лежать на відстані outer·cos 18° від центру, верхня — на outer вище центру.
      const outer = width / (2 * Math.cos(Math.PI / 10));
      candidate = { type: 'star', generator: 'starPoints', x: left + width / 2 - outer, y: top, w: outer * 2, h: outer * 2 };
    }
    const shape = { x: candidate.x, y: candidate.y, w: candidate.w, h: candidate.h };
    if (!sameCycle(parsePointList(editor[candidate.generator](shape)), points, tolerance)) return null;
    return { ...base, type: candidate.type, x: round(shape.x), y: round(shape.y), w: round(shape.w), h: round(shape.h) };
  }

  function pointsObject(points, closed, paint, base, ctx) {
    if (closed || paint.hasFill) {
      if (points.length >= 3) {
        if (!closed && paint.hasStroke) ctx.warn('filled-open');
        return classifyPolygon(points, base) || { ...base, type: 'polygon', points };
      }
      if (points.length < 2 || !paint.hasStroke) return null;
    }
    if (!paint.hasStroke || points.length < 2) return null;
    if (points.length === 2) {
      return { ...base, fill: 'none', type: 'line', x1: points[0].x, y1: points[0].y, x2: points[1].x, y2: points[1].y };
    }
    return { ...base, fill: 'none', type: 'pen', points };
  }

  // ---- Елементи ----

  function titleOf(element) {
    const title = Array.from(element.children).find(child => child.localName === 'title' && child.namespaceURI === SVG_NS);
    return title ? title.textContent.trim() : '';
  }

  function baseObject(element, state, paint) {
    return {
      stroke: paint.stroke,
      fill: paint.fill,
      strokeWidth: paint.strokeWidth,
      opacity: paint.opacity,
      name: titleOf(element),
      hidden: isHidden(state),
      locked: false
    };
  }

  function markerId(value) {
    const match = /^url\(\s*['"]?#([^'")]+)['"]?\s*\)$/i.exec(String(value || '').trim());
    return match ? match[1] : null;
  }

  function pushObject(ctx, object) {
    const limits = projectIo.LIMITS;
    if (ctx.objects.length >= limits.MAX_OBJECTS) fail('too-complex', `понад ${limits.MAX_OBJECTS} об'єктів`);
    if (object.points) {
      if (object.points.length > limits.MAX_PEN_POINTS) fail('too-complex', `понад ${limits.MAX_PEN_POINTS} точок в одній фігурі`);
      ctx.totalPoints += object.points.length;
      if (ctx.totalPoints > limits.MAX_TOTAL_PEN_POINTS) fail('too-complex', `понад ${limits.MAX_TOTAL_PEN_POINTS} точок у всіх фігурах`);
    }
    ctx.objects.push(object);
  }

  // Білий прямокутник на все полотно першим елементом — це фон (так пише і власний експорт):
  // полотно вже біле, тож окремим об'єктом він не стає.
  function isBackground(object, ctx) {
    return ctx.objects.length === 0 && object.type === 'rect' && object.fill === '#ffffff' && object.stroke === 'none'
      && object.opacity === 100 && !object.hidden
      && object.x <= 1 && object.y <= 1
      && object.x + object.w >= ctx.viewport.canvasWidth - 1 && object.y + object.h >= ctx.viewport.canvasHeight - 1;
  }

  function convertRect(element, state, ctx) {
    const { width: viewWidth, height: viewHeight } = ctx.viewport;
    const x = lengthAttr(element, 'x', viewWidth, 0);
    const y = lengthAttr(element, 'y', viewHeight, 0);
    const width = lengthAttr(element, 'width', viewWidth, null);
    const height = lengthAttr(element, 'height', viewHeight, null);
    const rx = lengthAttr(element, 'rx', viewWidth, null);
    const ry = lengthAttr(element, 'ry', viewHeight, null);
    if ([x, y, width, height, rx, ry].some(Number.isNaN)) return ctx.warn('invalid');
    if (!(width > 0) || !(height > 0)) return undefined;
    const paint = paintOf(state, ctx);
    if (!paint.hasFill && !paint.hasStroke) return ctx.warn('invisible');
    const base = baseObject(element, state, paint);
    const m = state.ctm;
    const corners = [apply(m, x, y), apply(m, x + width, y), apply(m, x + width, y + height), apply(m, x, y + height)];
    let object;
    if (isAxisAligned(m)) {
      const xs = corners.map(point => point.x);
      const ys = corners.map(point => point.y);
      const left = Math.min(...xs);
      const top = Math.min(...ys);
      object = { ...base, type: 'rect', x: round(left), y: round(top), w: round(Math.max(...xs) - left), h: round(Math.max(...ys) - top) };
    } else {
      object = { ...base, type: 'polygon', points: corners.map(roundPoint) };
    }
    if (isBackground(object, ctx)) return undefined;
    // Редактор малює прямокутник зі скругленням 4 px; більше чи повернуте скруглення не зберігається.
    const radius = Math.max(rx > 0 ? rx : 0, ry > 0 ? ry : 0) * matrixScale(m);
    if (radius > 0 && (object.type !== 'rect' || Math.abs(radius - 4) > 0.5)) ctx.warn('rounded');
    return pushObject(ctx, object);
  }

  function convertEllipse(element, state, ctx, isCircle) {
    const { width: viewWidth, height: viewHeight, diagonal } = ctx.viewport;
    const cx = lengthAttr(element, 'cx', viewWidth, 0);
    const cy = lengthAttr(element, 'cy', viewHeight, 0);
    let rx;
    let ry;
    if (isCircle) {
      rx = ry = lengthAttr(element, 'r', diagonal, null);
    } else {
      rx = lengthAttr(element, 'rx', viewWidth, null);
      ry = lengthAttr(element, 'ry', viewHeight, null);
      if (rx === null) rx = ry;
      if (ry === null) ry = rx;
    }
    if ([cx, cy, rx, ry].some(Number.isNaN)) return ctx.warn('invalid');
    if (!(rx > 0) || !(ry > 0)) return undefined;
    const paint = paintOf(state, ctx);
    if (!paint.hasFill && !paint.hasStroke) return ctx.warn('invisible');
    const base = baseObject(element, state, paint);
    const m = state.ctm;
    // Образ еліпса — еліпс із матрицею форми (LS)(LS)ᵀ; осі лишаються вздовж осей полотна,
    // коли її позадіагональний елемент нульовий (переноси, масштаб, поворот кола, кратні 90°).
    const halfWidth = Math.hypot(m[0] * rx, m[2] * ry);
    const halfHeight = Math.hypot(m[1] * rx, m[3] * ry);
    const cross = m[0] * m[1] * rx * rx + m[2] * m[3] * ry * ry;
    if (Math.abs(cross) <= 1e-9 * Math.max(1, halfWidth * halfWidth + halfHeight * halfHeight)) {
      const center = apply(m, cx, cy);
      return pushObject(ctx, {
        ...base,
        type: 'ellipse',
        x: round(center.x - halfWidth),
        y: round(center.y - halfHeight),
        w: round(halfWidth * 2),
        h: round(halfHeight * 2)
      });
    }
    ctx.warn('ellipse-polygon');
    const points = [];
    for (let index = 0; index < SVG_LIMITS.ELLIPSE_SEGMENTS; index += 1) {
      const angle = index * 2 * Math.PI / SVG_LIMITS.ELLIPSE_SEGMENTS;
      points.push(roundPoint(apply(m, cx + rx * Math.cos(angle), cy + ry * Math.sin(angle))));
    }
    return pushObject(ctx, { ...base, type: 'polygon', points });
  }

  function convertLine(element, state, ctx) {
    const { width: viewWidth, height: viewHeight } = ctx.viewport;
    const coords = [
      lengthAttr(element, 'x1', viewWidth, 0), lengthAttr(element, 'y1', viewHeight, 0),
      lengthAttr(element, 'x2', viewWidth, 0), lengthAttr(element, 'y2', viewHeight, 0)
    ];
    if (coords.some(Number.isNaN)) return ctx.warn('invalid');
    const paint = paintOf(state, ctx, { withFill: false });
    if (!paint.hasStroke) return ctx.warn('invisible');
    const start = roundPoint(apply(state.ctm, coords[0], coords[1]));
    const end = roundPoint(apply(state.ctm, coords[2], coords[3]));
    const arrowMarker = markerId(state.style['marker-end']);
    if (arrowMarker && arrowMarker !== 'arrowHead') ctx.warn('marker-arrow');
    if (markerId(state.style['marker-start']) || markerId(state.style['marker-mid'])) ctx.warn('markers');
    return pushObject(ctx, {
      ...baseObject(element, state, paint),
      fill: 'none',
      type: arrowMarker ? 'arrow' : 'line',
      x1: start.x,
      y1: start.y,
      x2: end.x,
      y2: end.y
    });
  }

  function warnPathMarkers(state, ctx) {
    if (['marker-start', 'marker-mid', 'marker-end'].some(name => markerId(state.style[name]))) ctx.warn('markers');
  }

  function convertPoly(element, state, ctx, closed) {
    const numbers = parseNumberList(element.getAttribute('points'));
    if (!numbers) return ctx.warn('invalid');
    if (numbers.length / 2 > projectIo.LIMITS.MAX_PEN_POINTS) {
      fail('too-complex', `понад ${projectIo.LIMITS.MAX_PEN_POINTS} точок в одній фігурі`);
    }
    const paint = paintOf(state, ctx);
    if (!paint.hasFill && !paint.hasStroke) return ctx.warn('invisible');
    const raw = parsePointList(element.getAttribute('points'));
    const points = cleanPoints(raw.map(point => roundPoint(apply(state.ctm, point.x, point.y))), closed);
    const object = pointsObject(points, closed, paint, baseObject(element, state, paint), ctx);
    if (!object) return undefined;
    warnPathMarkers(state, ctx);
    return pushObject(ctx, object);
  }

  const boundsOf = points => {
    const xs = points.map(point => point.x);
    const ys = points.map(point => point.y);
    return { left: Math.min(...xs), top: Math.min(...ys), right: Math.max(...xs), bottom: Math.max(...ys) };
  };

  function convertPath(element, state, ctx) {
    const budget = projectIo.LIMITS.MAX_TOTAL_PEN_POINTS - ctx.totalPoints;
    const subpaths = parsePathData(element.getAttribute('d'), budget);
    if (subpaths === 'curves') return ctx.warn('curves');
    if (!subpaths) return ctx.warn('invalid');
    const paint = paintOf(state, ctx);
    if (!paint.hasFill && !paint.hasStroke) return ctx.warn('invisible');
    const parts = subpaths
      .map(subpath => ({ closed: subpath.closed, points: cleanPoints(subpath.points.map(point => roundPoint(apply(state.ctm, point.x, point.y))), subpath.closed) }))
      .filter(part => part.points.length >= 2);
    // Частина всередині іншої залитої частини — отвір: модель не має правила заливки, тож він зафарбується.
    if (paint.hasFill) {
      const boxes = parts.filter(part => part.points.length >= 3).map(part => boundsOf(part.points));
      const hasHole = boxes.some((inner, i) => boxes.some((outer, j) => i !== j
        && inner.left >= outer.left && inner.right <= outer.right && inner.top >= outer.top && inner.bottom <= outer.bottom));
      if (hasHole) ctx.warn('holes');
    }
    let added = false;
    for (const part of parts) {
      const object = pointsObject(part.points, part.closed, paint, baseObject(element, state, paint), ctx);
      if (!object) continue;
      pushObject(ctx, object);
      added = true;
    }
    if (added) warnPathMarkers(state, ctx);
    return undefined;
  }

  function normalizeSpace(text, preserve) {
    return preserve ? text.replace(/[\r\n\t]/g, ' ') : text.replace(/[\r\n]/g, '').replace(/\t/g, ' ');
  }

  // Рядки тексту: tspan з y або ненульовим dy починає новий рядок (так пишуть власний експорт
  // і Inkscape); вкладені tspan і посилання в тексті дають лише свій текст.
  function textLines(textElement, state, ctx) {
    const lines = [''];
    const visit = (node, preserve) => {
      for (const child of Array.from(node.childNodes)) {
        if (child.nodeType === 3 || child.nodeType === 4) {
          lines[lines.length - 1] += normalizeSpace(child.nodeValue, preserve);
          continue;
        }
        if (child.nodeType !== 1 || child.namespaceURI !== SVG_NS || !['tspan', 'textPath', 'a'].includes(child.localName)) continue;
        if (child.localName === 'textPath') ctx.warn('text-path');
        const dy = parseNumberList(child.getAttribute('dy')) || [];
        const startsLine = child.localName === 'tspan' && (child.hasAttribute('y') || (dy[0] || 0) !== 0);
        if (startsLine && (lines.length > 1 || lines[0] !== '')) lines.push('');
        const space = child.getAttributeNS(XML_NS, 'space');
        visit(child, space ? space === 'preserve' : preserve);
      }
    };
    visit(textElement, state.preserveSpace);
    const cleaned = lines.map(line => (state.preserveSpace ? line : line.replace(/ {2,}/g, ' ')).trim());
    while (cleaned.length && !cleaned[0]) cleaned.shift();
    while (cleaned.length && !cleaned[cleaned.length - 1]) cleaned.pop();
    return cleaned;
  }

  function convertText(element, state, ctx) {
    const m = state.ctm;
    const lines = textLines(element, state, ctx);
    if (!lines.length) return undefined;
    if (!(nearZero(m[1], m) && nearZero(m[2], m) && m[0] > 0 && m[3] > 0)) return ctx.warn('text-rotated');

    const firstSpan = Array.from(element.children).find(child => child.localName === 'tspan' && child.namespaceURI === SVG_NS);
    const spanState = firstSpan ? childState(firstSpan, state, ctx) || state : state;
    const first = (el, name) => (el ? parseNumberList(el.getAttribute(name)) : null);
    const xs = first(element, 'x');
    const ys = first(element, 'y');
    const dxs = first(element, 'dx');
    const dys = first(element, 'dy');
    if ([xs, ys, dxs, dys].some(list => list === null)) return ctx.warn('invalid');
    let x = (xs[0] ?? 0) + (dxs[0] ?? 0);
    let y = (ys[0] ?? 0) + (dys[0] ?? 0);
    const spanX = first(firstSpan, 'x');
    const spanY = first(firstSpan, 'y');
    if (spanX?.length) x = spanX[0];
    if (spanY?.length) y = spanY[0];

    const sizeValue = String(spanState.style['font-size'] || '16').trim().toLowerCase();
    const parsedSize = FONT_SIZE_KEYWORDS[sizeValue] ?? parseLength(sizeValue, 16);
    const fontSize = (parsedSize > 0 ? parsedSize : 16) * Math.sqrt(m[0] * m[3]);
    if (Math.abs(m[0] - m[3]) > 0.01 * Math.max(m[0], m[3])) ctx.warn('text-scaled');

    const paint = paintOf(spanState, ctx);
    if (!paint.hasFill && !paint.hasStroke) return ctx.warn('invisible');
    const family = spanState.style['font-family'];
    if ((family && !/nunito/i.test(family)) || /italic|oblique/i.test(spanState.style['font-style'] || '')) ctx.warn('text-font');
    if (/^(?:middle|end)$/.test(String(spanState.style['text-anchor'] || '').trim())) ctx.warn('text-anchor');

    const position = roundPoint(apply(m, x, y));
    return pushObject(ctx, {
      ...baseObject(element, state, paint),
      hidden: isHidden(spanState),
      type: 'text',
      x: position.x,
      y: position.y,
      fontSize: round(fontSize),
      text: lines.join('\n')
    });
  }

  function walk(parent, parentState, ctx) {
    for (const element of Array.from(parent.children)) {
      if (element.namespaceURI !== SVG_NS) continue;
      const name = element.localName;
      if (NON_RENDERED.has(name)) continue;
      if (ANIMATION_ELEMENTS.has(name)) {
        ctx.warn('animation');
        continue;
      }
      const state = childState(element, parentState, ctx);
      if (!state) {
        ctx.warn('invalid');
        continue;
      }
      if (state.effects) ctx.warn('effects');
      if (!state.ctm.every(Number.isFinite) || matrixScale(state.ctm) < 1e-9) continue;
      if (name !== 'g' && name !== 'a' && Array.from(element.children).some(child => ANIMATION_ELEMENTS.has(child.localName))) {
        ctx.warn('animation');
      }
      switch (name) {
        case 'g':
        case 'a':
          walk(element, state, ctx);
          break;
        case 'rect':
          convertRect(element, state, ctx);
          break;
        case 'circle':
          convertEllipse(element, state, ctx, true);
          break;
        case 'ellipse':
          convertEllipse(element, state, ctx, false);
          break;
        case 'line':
          convertLine(element, state, ctx);
          break;
        case 'polyline':
          convertPoly(element, state, ctx, false);
          break;
        case 'polygon':
          convertPoly(element, state, ctx, true);
          break;
        case 'path':
          convertPath(element, state, ctx);
          break;
        case 'text':
          convertText(element, state, ctx);
          break;
        case 'use':
        case 'image':
        case 'switch':
          ctx.warn(name);
          break;
        case 'svg':
          ctx.warn('nested-svg');
          break;
        default:
          ctx.unknown.add(name);
          ctx.warn('unknown');
      }
    }
  }

  function createContext(doc) {
    const ids = new Map();
    for (const element of Array.from(doc.getElementsByTagName('*'))) {
      const id = element.getAttribute('id');
      if (id && !ids.has(id)) ids.set(id, element);
    }
    const counts = new Map();
    const ctx = {
      ids,
      classRules: new Map(),
      objects: [],
      totalPoints: 0,
      notes: [],
      unknown: new Set(),
      viewport: null,
      warn(key) {
        counts.set(key, (counts.get(key) || 0) + 1);
      },
      warnings() {
        return [...ctx.notes, ...Array.from(counts, ([key, count]) => WARNINGS[key](count, ctx))];
      }
    };
    ctx.classRules = readClassRules(doc, ctx);
    return ctx;
  }

  // Єдина точка входу: текст файла -> XML DOM -> перевірка безпеки -> модель -> нормалізація.
  // basePayload — поточні налаштування редактора (сітка, кольори), які імпорт не змінює.
  function parseSvgText(text, { fileName = '', basePayload = {} } = {}) {
    let ctx = null;
    try {
      const source = String(text ?? '').replace(/^﻿/, '');
      const doc = parseDocument(source);
      scanSafety(doc);
      ctx = createContext(doc);
      const root = doc.documentElement;
      ctx.viewport = rootViewport(root, ctx);
      const baseState = { ctm: ctx.viewport.matrix, style: { ...ROOT_STYLE }, opacity: 1, hidden: false, preserveSpace: false, effects: false };
      const rootState = childState(root, baseState, ctx);
      if (!rootState) ctx.warn('invalid');
      if (rootState?.effects) ctx.warn('effects');
      walk(root, rootState || baseState, ctx);
      if (!ctx.objects.length) fail('empty');

      const payload = projectIo.normalizeProject({
        ...basePayload,
        format: projectIo.PROJECT_FORMAT,
        version: projectIo.PROJECT_VERSION,
        fileName,
        canvasWidth: ctx.viewport.canvasWidth,
        canvasHeight: ctx.viewport.canvasHeight,
        objects: ctx.objects
      });
      if (!payload) fail('too-complex', 'малюнок перевищує межі проєкту');
      return {
        ok: true,
        reason: null,
        payload,
        report: {
          objects: payload.objects.length,
          canvasWidth: payload.canvasWidth,
          canvasHeight: payload.canvasHeight,
          warnings: ctx.warnings()
        }
      };
    } catch (error) {
      if (!(error instanceof SvgImportError)) throw error;
      return { ok: false, reason: error.reason, detail: error.detail, warnings: ctx ? ctx.warnings() : [], payload: null };
    }
  }

  window.ArtVector.svgImport = {
    LIMITS: SVG_LIMITS,
    parseSvgText
  };
})();
