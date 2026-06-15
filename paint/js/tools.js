'use strict';

window.ArtMalyunky = window.ArtMalyunky || {};

// Реєстр інструментів: кожен інструмент — об'єкт зі спільним контрактом
// begin/update/commit/cancel. Диспетчер pointer-подій у app.js більше не має
// розгалужень if/else по currentTool, а делегує активному інструменту.
(() => {
  const { state, canvasApi, utils } = window.ArtMalyunky;

  function createPaintTools({ pushUndo, markDirty, objectInteractions, setColor }) {
    let selDrag = null;

    // --- Прямокутне виділення (marquee): створення, переміщення з підняттям пікселів ---
    const select = {
      begin(point) {
        if (state.selection && canvasApi.pointInSelection(point)) {
          state.isDrawing = true;
          selDrag = {
            mode: 'move',
            startX: point.x,
            startY: point.y,
            origX: state.selection.x,
            origY: state.selection.y,
            lifted: false
          };
        } else {
          // Початок нового маркера фіксує попереднє плаваюче виділення в растрі.
          if (canvasApi.flattenSelection()) markDirty();
          state.isDrawing = true;
          state.startX = point.x;
          state.startY = point.y;
          state.selection = { x: point.x, y: point.y, w: 0, h: 0, floating: null };
          selDrag = { mode: 'create' };
          canvasApi.drawSelectionOverlay();
        }
      },
      update(point) {
        if (!state.isDrawing || !selDrag) return;
        if (selDrag.mode === 'create') {
          const r = utils.normalizeRect(state.startX, state.startY, point.x, point.y);
          Object.assign(state.selection, { x: r.x, y: r.y, w: r.w, h: r.h });
          canvasApi.drawSelectionOverlay();
          return;
        }
        // Перше переміщення «піднімає» пікселі (з undo); далі лише рухаємо буфер.
        if (!selDrag.lifted) {
          pushUndo();
          canvasApi.liftSelection();
          selDrag.lifted = true;
        }
        const sel = state.selection;
        sel.x = utils.clamp(selDrag.origX + (point.x - selDrag.startX), 0, state.document.width - sel.w);
        sel.y = utils.clamp(selDrag.origY + (point.y - selDrag.startY), 0, state.document.height - sel.h);
        canvasApi.drawSelectionOverlay();
      },
      commit() {
        if (!state.isDrawing) return;
        state.isDrawing = false;
        if (selDrag && selDrag.mode === 'create') {
          const sel = state.selection;
          if (!sel || sel.w < 3 || sel.h < 3) {
            state.selection = null;
            canvasApi.drawSelectionOverlay();
          }
        } else if (selDrag && selDrag.mode === 'move' && selDrag.lifted) {
          markDirty();
        }
        selDrag = null;
      },
      cancel() {
        state.isDrawing = false;
        selDrag = null;
      }
    };

    // --- Растрові інструменти (пишуть прямо в полотно) ---
    const brush = {
      begin(point) {
        state.isDrawing = true;
        state.startX = point.x;
        state.startY = point.y;
        state.lastX = point.x;
        state.lastY = point.y;
        pushUndo();
        canvasApi.drawFreehand(point.x, point.y);
      },
      update(point) {
        if (!state.isDrawing) return;
        canvasApi.drawFreehand(point.x, point.y);
        state.lastX = point.x;
        state.lastY = point.y;
      },
      commit() {
        if (!state.isDrawing) return;
        state.isDrawing = false;
        markDirty();
      },
      cancel() {
        state.isDrawing = false;
      }
    };

    const eraser = {
      begin(point) {
        state.isDrawing = true;
        state.startX = point.x;
        state.startY = point.y;
        state.lastX = point.x;
        state.lastY = point.y;
        pushUndo();
        canvasApi.erase(point.x, point.y);
      },
      update(point) {
        if (!state.isDrawing) return;
        canvasApi.erase(point.x, point.y);
        state.lastX = point.x;
        state.lastY = point.y;
      },
      commit() {
        if (!state.isDrawing) return;
        state.isDrawing = false;
        markDirty();
      },
      cancel() {
        state.isDrawing = false;
      }
    };

    const fill = {
      begin(point) {
        pushUndo();
        canvasApi.floodFill(Math.floor(point.x), Math.floor(point.y));
        markDirty();
      },
      update() {},
      commit() {},
      cancel() {}
    };

    // --- Піпетка: бере колір пікселя, нічого не змінює (без undo) ---
    const eyedropper = {
      begin(point) {
        const hex = canvasApi.pickColor(Math.floor(point.x), Math.floor(point.y));
        if (hex) setColor(hex);
      },
      update() {},
      commit() {},
      cancel() {}
    };

    // --- Об'єктні інструменти (тимчасовий pending-об'єкт до підтвердження) ---
    const shapes = {
      begin(point) {
        state.isDrawing = true;
        state.startX = point.x;
        state.startY = point.y;
        pushUndo();
        canvasApi.createPendingShape(point.x, point.y, point.x, point.y);
      },
      update(point) {
        if (!state.isDrawing) return;
        canvasApi.updatePendingShape(state.startX, state.startY, point.x, point.y);
      },
      commit() {
        if (!state.isDrawing) return;
        state.isDrawing = false;
        const obj = canvasApi.commitPendingObject();
        if (obj) {
          objectInteractions.selectObject(obj.id);
          markDirty();
        }
      },
      cancel() {
        state.isDrawing = false;
        canvasApi.cancelPendingObject();
      }
    };

    const stamps = {
      begin(point) {
        state.isDrawing = true;
        state.startX = point.x;
        state.startY = point.y;
        pushUndo();
        canvasApi.createPendingStamp(point.x, point.y, point.x, point.y);
      },
      update(point) {
        if (!state.isDrawing) return;
        canvasApi.updatePendingStamp(state.startX, state.startY, point.x, point.y);
      },
      commit(point) {
        if (!state.isDrawing) return;
        state.isDrawing = false;
        const pending = state.pendingObject;
        // Одиночний клік (без перетягування) → штамп фіксованого розміру в точці.
        if (pending && pending.w < 8 && pending.h < 8) {
          Object.assign(pending, {
            x: utils.clamp(point.x - 36, 0, state.document.width - 72),
            y: utils.clamp(point.y - 36, 0, state.document.height - 72),
            w: 72,
            h: 72
          });
        }
        const obj = canvasApi.commitPendingObject();
        if (obj) {
          objectInteractions.selectObject(obj.id);
          markDirty();
        }
      },
      cancel() {
        state.isDrawing = false;
        canvasApi.cancelPendingObject();
      }
    };

    const registry = { select, brush, eraser, fill, eyedropper, shapes, stamps };

    return {
      registry,
      get(id) {
        return registry[id] || null;
      },
      getActive() {
        return registry[state.currentTool] || brush;
      }
    };
  }

  window.ArtMalyunky.paintTools = { createPaintTools };
})();
