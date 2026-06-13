import { deepClone } from './utils.js';

export const state = {
  fileName: 'моя презентація',
  slides: [],
  currentSlideId: null,
  // Множинний вибір. Порядок = порядок додавання; останній — «головний»
  // (для відображення формату в тулбарі й цілі колір-popover).
  selectedElementIds: [],
  clipboard: null,
  undoStack: [],
  redoStack: [],
  unsavedChanges: false,
  suppressHistory: false,
  currentColorTarget: 'text',
  presentationIndex: 0,
  // Налаштування вигляду (не серіалізується у файл/чернетку).
  snapToGrid: false,
  // Id зображення в режимі кадрування (ефемерний UI-стан, не серіалізується).
  cropElementId: null
};

function normalizeSelectionInput(data) {
  if (Array.isArray(data.selectedElementIds)) return data.selectedElementIds.filter(id => typeof id === 'string');
  // Зворотна сумісність зі старим одиничним полем.
  if (typeof data.selectedElementId === 'string') return [data.selectedElementId];
  return [];
}

export function applyPresentationData(data) {
  state.fileName = data.fileName || 'моя презентація';
  state.slides = Array.isArray(data.slides) ? data.slides : [];
  state.currentSlideId = data.currentSlideId || state.slides[0]?.id || null;
  state.selectedElementIds = normalizeSelectionInput(data);
  state.cropElementId = null;
}

export function serializePresentation() {
  return {
    fileName: state.fileName,
    slides: deepClone(state.slides),
    currentSlideId: state.currentSlideId,
    selectedElementIds: [...state.selectedElementIds]
  };
}

export function getCurrentSlide() {
  return state.slides.find(slide => slide.id === state.currentSlideId) || state.slides[0] || null;
}

export function getCurrentSlideIndex() {
  return state.slides.findIndex(slide => slide.id === state.currentSlideId);
}

export function isSelected(id) {
  return state.selectedElementIds.includes(id);
}

// Усі вибрані елементи поточного слайда (у порядку шарів слайда).
export function getSelectedElements() {
  const slide = getCurrentSlide();
  if (!slide) return [];
  const ids = new Set(state.selectedElementIds);
  return slide.elements.filter(element => ids.has(element.id));
}

// «Головний» вибраний елемент — останній доданий, що ще існує на слайді.
export function getSelectedElement() {
  const slide = getCurrentSlide();
  if (!slide) return null;
  for (let i = state.selectedElementIds.length - 1; i >= 0; i -= 1) {
    const found = slide.elements.find(element => element.id === state.selectedElementIds[i]);
    if (found) return found;
  }
  return null;
}
