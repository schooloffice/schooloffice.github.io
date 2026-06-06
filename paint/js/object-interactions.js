'use strict';

window.ArtMalyunky = window.ArtMalyunky || {};

(() => {
  const { state, utils, canvasApi, ui } = window.ArtMalyunky;

  function createPaintObjectInteractions({ markDirty, pushUndo }) {
    function getSelectedObject() {
      if (!state.selectedObjectId) return null;
      return canvasApi.getObjectById(state.selectedObjectId);
    }

    function selectObject(id) {
      state.selectedObjectId = id;
      canvasApi.renderObjects();
      ui.updateDetailStatus(getSelectedObject());
    }

    function deselectObject() {
      state.selectedObjectId = null;
      canvasApi.renderObjects();
      ui.updateDetailStatus();
    }

    function deleteSelectedObject() {
      if (!state.selectedObjectId) return;
      pushUndo();
      const removed = canvasApi.deleteSelectedObject();
      if (removed) {
        ui.updateDetailStatus();
        markDirty();
      }
    }

    function startObjectMove(id, point) {
      const obj = canvasApi.getObjectById(id);
      if (!obj) return;
      pushUndo();
      selectObject(id);
      state.objectInteraction = {
        type: 'move',
        objectId: id,
        startX: point.x,
        startY: point.y,
        original: utils.deepClone(obj)
      };
    }

    function startObjectResize(id, handle, point) {
      const obj = canvasApi.getObjectById(id);
      if (!obj) return;
      pushUndo();
      selectObject(id);
      state.objectInteraction = {
        type: 'resize',
        objectId: id,
        handle,
        startX: point.x,
        startY: point.y,
        original: utils.deepClone(obj)
      };
    }

    function updateObjectInteraction(point) {
      if (!state.objectInteraction) return;
      const interaction = state.objectInteraction;
      const obj = canvasApi.getObjectById(interaction.objectId);
      if (!obj) return;
      const dx = point.x - interaction.startX;
      const dy = point.y - interaction.startY;

      if (interaction.type === 'move') {
        const nextX = utils.clamp(interaction.original.x + dx, 0, state.canvasWidth - interaction.original.w);
        const nextY = utils.clamp(interaction.original.y + dy, 0, state.canvasHeight - interaction.original.h);
        canvasApi.updateObject(obj.id, { x: nextX, y: nextY });
        ui.updateDetailStatus(canvasApi.getObjectById(obj.id));
        return;
      }

      const minSize = obj.kind === 'stamp' ? 32 : 12;
      let left = interaction.original.x;
      let top = interaction.original.y;
      let right = interaction.original.x + interaction.original.w;
      let bottom = interaction.original.y + interaction.original.h;

      if (interaction.handle.includes('w')) left = utils.clamp(interaction.original.x + dx, 0, right - minSize);
      if (interaction.handle.includes('e')) right = utils.clamp(interaction.original.x + interaction.original.w + dx, left + minSize, state.canvasWidth);
      if (interaction.handle.includes('n')) top = utils.clamp(interaction.original.y + dy, 0, bottom - minSize);
      if (interaction.handle.includes('s')) bottom = utils.clamp(interaction.original.y + interaction.original.h + dy, top + minSize, state.canvasHeight);

      canvasApi.updateObject(obj.id, {
        x: left,
        y: top,
        w: right - left,
        h: bottom - top
      });
      ui.updateDetailStatus(canvasApi.getObjectById(obj.id));
    }

    function finishObjectInteraction() {
      if (!state.objectInteraction) return;
      state.objectInteraction = null;
      markDirty();
    }

    return {
      deleteSelectedObject,
      deselectObject,
      finishObjectInteraction,
      selectObject,
      startObjectMove,
      startObjectResize,
      updateObjectInteraction
    };
  }

  window.ArtMalyunky.objectInteractions = { createPaintObjectInteractions };
})();
