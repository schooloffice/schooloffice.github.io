import { HISTORY_BUDGET_BYTES, HISTORY_HEAP_SHARE, MAX_HISTORY } from './constants.js';
import { state, applyPresentationData } from './state.js';

// Модель історії: вершина undoStack — це завжди ЗАВЕРШЕНИЙ попередній стан.
// `pushHistory()` викликається перед мутацією й зберігає поточний (ще не змінений)
// стан. `undo`/`redo` додатково захоплюють живий стан, тож вершина стека ніколи
// не «відстає» від документа і скасування йде рівно на один крок.
//
// Знімок — відокремлена копія з однієї серіалізації. Розмір її JSON запам'ятовується для
// бюджету, а сам JSON тримається лише для вершини undo: порівняння з наступним знімком —
// порівняння рядків замість двох нових серіалізацій. Вимір E1 (2026-09-15): JSON-рядок
// із кирилицею двобайтовий і займає вдвічі більше за копію об'єкта, а UTF-8 байти коштують
// ще одне кодування на кожен крок, тому в стеках лишаються об'єкти. Знімки в стеках не мутуються.
//
// Бюджет: undo і redo разом не більші за historyBudgetBytes(). Першими відкидаються
// найстаріші кроки undo, потім найдальші redo. Щойно записаний крок лишається завжди,
// тож знімок, більший за весь бюджет, дає рівно один крок скасування.

const snapshotBytes = new WeakMap();
const pendingJson = new WeakMap();
let topOfUndo = { snapshot: null, json: null };
let budgetOverride = null;

export function historyBudgetBytes(heapLimit = globalThis.performance?.memory?.jsHeapSizeLimit) {
  const heapShare = Number.isFinite(heapLimit) && heapLimit > 0 ? Math.floor(heapLimit * HISTORY_HEAP_SHARE) : Infinity;
  return Math.min(HISTORY_BUDGET_BYTES, heapShare);
}

// Лише для тестів і вимірів; null повертає звичайний бюджет.
export function setHistoryBudget(bytes) {
  budgetOverride = Number.isFinite(bytes) && bytes > 0 ? bytes : null;
}

export function resetHistory() {
  state.undoStack = [];
  state.redoStack = [];
  topOfUndo = { snapshot: null, json: null };
}

// Знімок поточного стану без запису в історію. Знадобиться, коли пре-стан треба
// захопити раніше за саму зміну (напр. до очищення плейсхолдера на focus), а
// записати — лише якщо зміна справді відбулася.
export function captureState() {
  const json = JSON.stringify({
    fileName: state.fileName,
    theme: state.theme,
    slides: state.slides,
    currentSlideId: state.currentSlideId,
    selectedElementIds: state.selectedElementIds
  });
  const snapshot = JSON.parse(json);
  snapshotBytes.set(snapshot, json.length);
  pendingJson.set(snapshot, json);
  return snapshot;
}

function bytesOf(snapshot) {
  let bytes = snapshotBytes.get(snapshot);
  if (bytes === undefined) {
    bytes = JSON.stringify(snapshot).length;
    snapshotBytes.set(snapshot, bytes);
  }
  return bytes;
}

export function historyBytes() {
  let total = 0;
  for (const snapshot of state.undoStack) total += bytesOf(snapshot);
  for (const snapshot of state.redoStack) total += bytesOf(snapshot);
  return total;
}

function enforceBudget(keepTopOf) {
  const budget = budgetOverride ?? historyBudgetBytes();
  let total = historyBytes();
  while (total > budget) {
    if (state.undoStack.length > (keepTopOf === state.undoStack ? 1 : 0)) {
      total -= bytesOf(state.undoStack.shift());
    } else if (state.redoStack.length > (keepTopOf === state.redoStack ? 1 : 0)) {
      total -= bytesOf(state.redoStack.shift());
    } else {
      break;
    }
  }
}

// Записати раніше захоплений знімок як попередній стан історії.
export function commitState(snapshot) {
  if (state.suppressHistory || !snapshot) return;
  const json = pendingJson.get(snapshot) ?? JSON.stringify(snapshot);
  // У стеку JSON не тримаємо: інакше кожен крок займав би пам'ять двічі.
  pendingJson.delete(snapshot);
  const last = state.undoStack[state.undoStack.length - 1];
  if (last) {
    const lastJson = topOfUndo.snapshot === last ? topOfUndo.json : JSON.stringify(last);
    if (lastJson === json) {
      topOfUndo = { snapshot: last, json: lastJson };
      return;
    }
  }
  snapshotBytes.set(snapshot, json.length);
  state.undoStack.push(snapshot);
  topOfUndo = { snapshot, json };
  if (state.undoStack.length > MAX_HISTORY) state.undoStack.shift();
  state.redoStack = [];
  enforceBudget(state.undoStack);
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
  const current = captureState();
  pendingJson.delete(current);
  const previous = state.undoStack.pop();
  state.redoStack.push(current);
  applyPresentationData(previous);
  enforceBudget(state.redoStack);
  return true;
}

export function redo() {
  if (!state.redoStack.length) return false;
  const current = captureState();
  pendingJson.delete(current);
  const next = state.redoStack.pop();
  state.undoStack.push(current);
  applyPresentationData(next);
  enforceBudget(state.undoStack);
  return true;
}
