import { DEFAULT_SHAPE_STYLE, DEFAULT_TEXT_STYLE } from './constants.js';
import { downloadTextFile } from './utils.js';

const DEFAULT_PRESENTATION_NAME = 'моя презентація';

export function normalizePresentation(raw) {
  if (!raw || typeof raw !== 'object') return null;
  if (!Array.isArray(raw.slides) || raw.slides.length === 0) return null;

  const slides = raw.slides.map((slide, slideIndex) => ({
    id: typeof slide.id === 'string' ? slide.id : `slide_${slideIndex}`,
    background: typeof slide.background === 'string' ? slide.background : '#ffffff',
    elements: Array.isArray(slide.elements)
      ? slide.elements.map((element, elementIndex) => normalizeElement(element, elementIndex))
      : []
  }));

  return {
    fileName: typeof raw.fileName === 'string' && raw.fileName.trim() ? raw.fileName.trim() : DEFAULT_PRESENTATION_NAME,
    slides,
    currentSlideId: slides.some(slide => slide.id === raw.currentSlideId) ? raw.currentSlideId : slides[0].id,
    selectedElementId: null
  };
}

export function normalizeElement(element, index) {
  const type = ['text', 'image', 'shape'].includes(element?.type) ? element.type : 'text';
  const shape = ['rect', 'circle', 'triangle'].includes(element?.shape) ? element.shape : 'rect';
  const placeholder = typeof element?.placeholder === 'string' && element.placeholder.trim()
    ? element.placeholder
    : (type === 'text' ? 'Введіть текст...' : '');
  const hasTextContent = typeof element?.content === 'string' && element.content.length > 0;
  const isPlaceholder = type === 'text'
    ? (typeof element?.isPlaceholder === 'boolean' ? element.isPlaceholder : !hasTextContent)
    : false;
  const content = type === 'text'
    ? (hasTextContent ? element.content : placeholder)
    : (typeof element?.content === 'string' ? element.content : '');

  return {
    id: typeof element?.id === 'string' ? element.id : `el_${index}_${Math.random().toString(36).slice(2, 7)}`,
    type,
    shape,
    x: Number.isFinite(element?.x) ? element.x : 120,
    y: Number.isFinite(element?.y) ? element.y : 120,
    w: Number.isFinite(element?.w) ? element.w : 240,
    h: Number.isFinite(element?.h) ? element.h : 120,
    z: Number.isFinite(element?.z) ? element.z : index + 1,
    rotation: Number.isFinite(element?.rotation) ? element.rotation : 0,
    content,
    placeholder,
    isPlaceholder,
    style: {
      ...DEFAULT_TEXT_STYLE,
      ...DEFAULT_SHAPE_STYLE,
      ...(element?.style || {})
    }
  };
}

export function slugify(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '') || 'presentation';
}

export function savePresentationFile(presentation) {
  const fileName = `${slugify(presentation.fileName)}.artslides.json`;
  downloadTextFile(fileName, JSON.stringify(presentation, null, 2));
}

export function parsePresentationText(text) {
  return normalizePresentation(JSON.parse(text));
}
