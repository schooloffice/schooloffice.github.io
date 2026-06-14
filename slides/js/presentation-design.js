import { LAYOUTS, LAYOUT_KEYS, THEMES, THEME_KEYS } from './constants.js';
import { createPlaceholderElement } from './templates.js';

export function getTheme(themeKey) {
  return THEMES.find(theme => theme.key === themeKey) || THEMES[0];
}

export function applyThemeToPresentation(presentation, themeKey) {
  if (!presentation || !Array.isArray(presentation.slides)) return false;
  if (!THEME_KEYS.includes(themeKey) || themeKey === presentation.theme) return false;

  const theme = getTheme(themeKey);
  presentation.theme = themeKey;
  presentation.slides.forEach(slide => { slide.background = theme.background; });
  return true;
}

export function applyLayoutToSlide(slide, layoutKey) {
  if (!slide || !Array.isArray(slide.elements) || !LAYOUT_KEYS.includes(layoutKey)) return false;

  const layout = LAYOUTS.find(item => item.key === layoutKey);
  // Replace only empty typed layout placeholders. Filled slots, manual text boxes
  // and shapes remain untouched when a different layout is applied.
  const kept = slide.elements.filter(element => !(element.isPlaceholder && element.placeholderType));
  const satisfied = {};
  kept.forEach(element => {
    if (element.placeholderType) satisfied[element.placeholderType] = (satisfied[element.placeholderType] || 0) + 1;
  });

  let z = kept.reduce((max, element) => Math.max(max, element.z || 1), 0) + 1;
  const placeholders = [];
  layout.slots.forEach(slot => {
    if (satisfied[slot.type] > 0) {
      satisfied[slot.type] -= 1;
      return;
    }
    placeholders.push(createPlaceholderElement(slot, z++));
  });

  slide.elements = [...kept, ...placeholders];
  slide.layout = layoutKey;
  return true;
}
