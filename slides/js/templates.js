import { DEFAULT_SHAPE_STYLE, DEFAULT_TEXT_STYLE } from './constants.js';
import { uid } from './utils.js';

function mergeTextStyle(style = {}) {
  return { ...DEFAULT_TEXT_STYLE, ...style };
}

function mergeShapeStyle(style = {}) {
  return { ...DEFAULT_TEXT_STYLE, ...DEFAULT_SHAPE_STYLE, ...style };
}

export function createTextElement(overrides = {}) {
  const placeholder = overrides.placeholder ?? 'Введіть текст...';
  const isPlaceholder = overrides.isPlaceholder ?? (overrides.content == null);
  return {
    id: uid(),
    type: 'text',
    shape: null,
    x: 180,
    y: 150,
    w: 600,
    h: 120,
    z: 1,
    rotation: 0,
    content: overrides.content ?? placeholder,
    placeholder,
    isPlaceholder,
    style: mergeTextStyle(),
    ...overrides,
    content: overrides.content ?? placeholder,
    placeholder,
    isPlaceholder,
    style: mergeTextStyle(overrides.style || {})
  };
}

export function createShapeElement(kind = 'rect', overrides = {}) {
  const defaults = {
    rect: { x: 285, y: 150, w: 240, h: 160 },
    circle: { x: 330, y: 160, w: 180, h: 180 },
    triangle: { x: 320, y: 155, w: 190, h: 170 }
  };
  const size = defaults[kind] || defaults.rect;

  return {
    id: uid(),
    type: 'shape',
    shape: kind,
    x: size.x,
    y: size.y,
    w: size.w,
    h: size.h,
    z: 1,
    rotation: 0,
    content: '',
    style: mergeShapeStyle(),
    ...overrides,
    style: mergeShapeStyle(overrides.style || {})
  };
}

export function createImageElement(src, overrides = {}) {
  return {
    id: uid(),
    type: 'image',
    shape: null,
    x: 260,
    y: 150,
    w: 420,
    h: 240,
    z: 1,
    rotation: 0,
    content: src,
    style: mergeTextStyle(),
    ...overrides,
    style: mergeTextStyle(overrides.style || {})
  };
}

export function createBasicSlideElements() {
  return [
    createTextElement({
      x: 70,
      y: 52,
      w: 820,
      h: 86,
      z: 1,
      placeholder: 'Заголовок слайда',
      content: 'Заголовок слайда',
      isPlaceholder: true,
      style: { fontSize: 40, bold: true, color: '#94a3b8' }
    }),
    createTextElement({
      x: 84,
      y: 166,
      w: 792,
      h: 250,
      z: 2,
      placeholder: 'Додай основний текст або короткі пункти',
      content: 'Додай основний текст або короткі пункти',
      isPlaceholder: true,
      style: { fontSize: 28, color: '#64748b' }
    })
  ];
}

export function createSlide(overrides = {}) {
  const providedElements = Array.isArray(overrides.elements) && overrides.elements.length
    ? overrides.elements
    : createBasicSlideElements();
  return {
    id: uid(),
    background: '#ffffff',
    elements: providedElements,
    ...overrides,
    elements: providedElements
  };
}

export function createDefaultPresentation() {
  const slide = createSlide({
    elements: [
      createTextElement({
        x: 150,
        y: 110,
        w: 660,
        h: 160,
        z: 1,
        content: 'Привіт!\nСтвори свою презентацію',
        placeholder: 'Заголовок',
        isPlaceholder: false,
        style: { fontSize: 56, align: 'center', bold: true, color: '#111827' }
      }),
      createTextElement({
        x: 240,
        y: 320,
        w: 480,
        h: 80,
        z: 2,
        content: 'Додай текст, фото та фігури',
        placeholder: 'Короткий опис',
        isPlaceholder: false,
        style: { fontSize: 28, align: 'center', color: '#475569' }
      })
    ]
  });

  return {
    fileName: 'моя презентація',
    slides: [slide],
    currentSlideId: slide.id,
    selectedElementId: null
  };
}

export function createTemplateDefinition(type) {
  if (type === 'title') {
    return {
      background: '#ffffff',
      elements: [
        createShapeElement('rect', {
          x: 60,
          y: 60,
          w: 840,
          h: 420,
          z: 1,
          style: { fill: '#fee2e2', stroke: '#dc2626' }
        }),
        createTextElement({
          x: 110,
          y: 150,
          w: 740,
          h: 160,
          z: 2,
          content: 'НАЗВА ПРЕЗЕНТАЦІЇ',
          isPlaceholder: false,
          style: { fontSize: 56, align: 'center', bold: true, color: '#111827' }
        }),
        createTextElement({
          x: 220,
          y: 330,
          w: 520,
          h: 90,
          z: 3,
          content: 'Автор: ...',
          isPlaceholder: false,
          style: { fontSize: 28, align: 'center', color: '#475569' }
        })
      ]
    };
  }

  if (type === 'text-image') {
    return {
      background: '#ffffff',
      elements: [
        createTextElement({
          x: 60,
          y: 50,
          w: 840,
          h: 70,
          z: 1,
          content: 'ЗАГОЛОВОК',
          isPlaceholder: false,
          style: { fontSize: 48, bold: true, color: '#111827' }
        }),
        createTextElement({
          x: 60,
          y: 145,
          w: 410,
          h: 320,
          z: 2,
          content: '• Пункт 1\n• Пункт 2\n• Пункт 3',
          isPlaceholder: false,
          style: { fontSize: 28, color: '#111827' }
        }),
        createShapeElement('rect', {
          x: 500,
          y: 145,
          w: 360,
          h: 300,
          z: 3,
          style: { fill: '#dbeafe', stroke: '#2563eb' }
        }),
        createTextElement({
          x: 540,
          y: 260,
          w: 280,
          h: 80,
          z: 4,
          content: 'Додай фото сюди',
          isPlaceholder: false,
          style: { fontSize: 28, align: 'center', bold: true, color: '#1d4ed8' }
        })
      ]
    };
  }

  return {
    background: '#ffffff',
    elements: [
      createTextElement({
        x: 60,
        y: 44,
        w: 840,
        h: 70,
        z: 1,
        content: 'МІЙ СЛАЙД',
        isPlaceholder: false,
        style: { fontSize: 48, bold: true, align: 'center', color: '#111827' }
      }),
      createShapeElement('rect', {
        x: 55,
        y: 150,
        w: 250,
        h: 320,
        z: 2,
        style: { fill: '#dcfce7', stroke: '#16a34a' }
      }),
      createShapeElement('rect', {
        x: 355,
        y: 150,
        w: 250,
        h: 320,
        z: 3,
        style: { fill: '#dbeafe', stroke: '#2563eb' }
      }),
      createShapeElement('rect', {
        x: 655,
        y: 150,
        w: 250,
        h: 320,
        z: 4,
        style: { fill: '#fae8ff', stroke: '#a21caf' }
      }),
      createTextElement({ x: 80, y: 175, w: 200, h: 70, z: 10, content: 'Ідея 1', isPlaceholder: false, style: { fontSize: 32, bold: true, align: 'center' } }),
      createTextElement({ x: 380, y: 175, w: 200, h: 70, z: 11, content: 'Ідея 2', isPlaceholder: false, style: { fontSize: 32, bold: true, align: 'center' } }),
      createTextElement({ x: 680, y: 175, w: 200, h: 70, z: 12, content: 'Ідея 3', isPlaceholder: false, style: { fontSize: 32, bold: true, align: 'center' } }),
      createTextElement({ x: 80, y: 250, w: 200, h: 170, z: 13, content: 'Напиши тут...', isPlaceholder: false, style: { fontSize: 24 } }),
      createTextElement({ x: 380, y: 250, w: 200, h: 170, z: 14, content: 'Напиши тут...', isPlaceholder: false, style: { fontSize: 24 } }),
      createTextElement({ x: 680, y: 250, w: 200, h: 170, z: 15, content: 'Напиши тут...', isPlaceholder: false, style: { fontSize: 24 } })
    ]
  };
}
