import { MAX_HISTORY } from './constants.js';
import { state, applyPresentationData, serializePresentation } from './state.js';
import { deepClone } from './utils.js';

export function resetHistory() {
  state.undoStack = [deepClone(serializePresentation())];
  state.redoStack = [];
}

export function pushHistory() {
  if (state.suppressHistory) return;
  const snapshot = deepClone(serializePresentation());
  const last = state.undoStack[state.undoStack.length - 1];
  if (last && JSON.stringify(last) === JSON.stringify(snapshot)) return;
  state.undoStack.push(snapshot);
  if (state.undoStack.length > MAX_HISTORY) state.undoStack.shift();
  state.redoStack = [];
}

export function undo() {
  if (state.undoStack.length <= 1) return false;
  const current = state.undoStack.pop();
  state.redoStack.push(current);
  const prev = deepClone(state.undoStack[state.undoStack.length - 1]);
  applyPresentationData(prev);
  return true;
}

export function redo() {
  if (!state.redoStack.length) return false;
  const next = deepClone(state.redoStack.pop());
  state.undoStack.push(deepClone(next));
  applyPresentationData(next);
  return true;
}
