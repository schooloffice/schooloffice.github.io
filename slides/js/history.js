import { MAX_HISTORY } from './constants.js';
import { state, applyPresentationData, serializePresentation } from './state.js';

// Модель історії: вершина undoStack — це завжди ЗАВЕРШЕНИЙ попередній стан.
// `pushHistory()` викликається перед мутацією й зберігає поточний (ще не змінений)
// стан. `undo`/`redo` додатково захоплюють живий стан, тож вершина стека ніколи
// не «відстає» від документа і скасування йде рівно на один крок.

export function resetHistory() {
  state.undoStack = [];
  state.redoStack = [];
}

// Знімок поточного стану без запису в історію. Знадобиться, коли пре-стан треба
// захопити раніше за саму зміну (напр. до очищення плейсхолдера на focus), а
// записати — лише якщо зміна справді відбулася.
export function captureState() {
  return serializePresentation();
}

// Записати раніше захоплений знімок як попередній стан історії.
export function commitState(snapshot) {
  if (state.suppressHistory || !snapshot) return;
  const last = state.undoStack[state.undoStack.length - 1];
  if (last && JSON.stringify(last) === JSON.stringify(snapshot)) return;
  state.undoStack.push(snapshot);
  if (state.undoStack.length > MAX_HISTORY) state.undoStack.shift();
  state.redoStack = [];
}

export function pushHistory() {
  if (state.suppressHistory) return;
  commitState(captureState());
}

export function canUndo() {
  return state.undoStack.length > 0;
}

export function canRedo() {
  return state.redoStack.length > 0;
}

export function undo() {
  if (!state.undoStack.length) return false;
  const current = serializePresentation();
  const previous = state.undoStack.pop();
  state.redoStack.push(current);
  applyPresentationData(previous);
  return true;
}

export function redo() {
  if (!state.redoStack.length) return false;
  const current = serializePresentation();
  const next = state.redoStack.pop();
  state.undoStack.push(current);
  applyPresentationData(next);
  return true;
}
