import { STORAGE_KEY } from './constants.js';

export function saveDraft(data) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}

export function loadDraft() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function clearDraft() {
  localStorage.removeItem(STORAGE_KEY);
}
