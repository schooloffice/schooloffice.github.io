import { deepClone } from './utils.js';

export const state = {
  fileName: 'моя презентація',
  slides: [],
  currentSlideId: null,
  selectedElementId: null,
  clipboard: null,
  undoStack: [],
  redoStack: [],
  unsavedChanges: false,
  suppressHistory: false,
  currentColorTarget: 'text',
  presentationIndex: 0
};

export function applyPresentationData(data) {
  state.fileName = data.fileName || 'моя презентація';
  state.slides = Array.isArray(data.slides) ? data.slides : [];
  state.currentSlideId = data.currentSlideId || state.slides[0]?.id || null;
  state.selectedElementId = data.selectedElementId || null;
}

export function serializePresentation() {
  return {
    fileName: state.fileName,
    slides: deepClone(state.slides),
    currentSlideId: state.currentSlideId,
    selectedElementId: state.selectedElementId
  };
}

export function getCurrentSlide() {
  return state.slides.find(slide => slide.id === state.currentSlideId) || state.slides[0] || null;
}

export function getCurrentSlideIndex() {
  return state.slides.findIndex(slide => slide.id === state.currentSlideId);
}

export function getSelectedElement() {
  const slide = getCurrentSlide();
  if (!slide) return null;
  return slide.elements.find(element => element.id === state.selectedElementId) || null;
}
