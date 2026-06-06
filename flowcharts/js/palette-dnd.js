(function () {
  'use strict';

  const DRAG_THRESHOLD = 6; // px before a press becomes a drag

  function createPaletteDragController(options) {
    const {
      shapeButtons,
      canvas,
      canvasContainer,
      clientToCanvas,
      snapToGrid,
      getShapeSizeHint,
      addShapeAt,
      document: doc = (typeof document !== 'undefined' ? document : null),
    } = options || {};

    function isInsideCanvas(clientX, clientY) {
      if (!canvasContainer) return false;
      const rect = canvasContainer.getBoundingClientRect();
      return clientX >= rect.left && clientX <= rect.right && clientY >= rect.top && clientY <= rect.bottom;
    }

    // Pure: where the top-left of a dropped block should land (snapped, clamped).
    function computeDropPosition(clientX, clientY, type) {
      if (!isInsideCanvas(clientX, clientY)) return null;
      const pt = clientToCanvas?.(clientX, clientY) || { x: 0, y: 0 };
      const hint = getShapeSizeHint?.(type) || { w: 150, h: 84 };
      const rawLeft = pt.x - hint.w / 2;
      const rawTop = pt.y - hint.h / 2;
      const snap = snapToGrid || ((value) => value);
      return {
        left: Math.max(0, snap(rawLeft)),
        top: Math.max(0, snap(rawTop)),
      };
    }

    function makePreview(button, type) {
      if (!doc) return null;
      const hint = getShapeSizeHint?.(type) || { w: 150, h: 84 };
      const preview = doc.createElement('div');
      preview.className = `palette-drag-preview shape ${type}`;
      preview.style.width = `${Math.min(hint.w, 150)}px`;
      preview.style.height = `${Math.min(hint.h, 90)}px`;
      const content = doc.createElement('div');
      content.className = 'content';
      content.textContent = button?.querySelector('.shape-button-text')?.textContent || '';
      preview.appendChild(content);
      doc.body.appendChild(preview);
      return preview;
    }

    function bindButton(button) {
      const type = button?.dataset?.shape;
      if (!type) return;

      let startX = 0;
      let startY = 0;
      let dragging = false;
      let suppressClick = false;
      let preview = null;
      let activePointerId = null;

      function movePreview(clientX, clientY) {
        if (preview) {
          preview.style.left = `${clientX}px`;
          preview.style.top = `${clientY}px`;
        }
      }

      function cleanup() {
        if (preview) { preview.remove(); preview = null; }
        dragging = false;
        activePointerId = null;
        doc?.removeEventListener('pointermove', onPointerMove, true);
        doc?.removeEventListener('pointerup', onPointerUp, true);
        doc?.removeEventListener('pointercancel', onPointerCancel, true);
      }

      function onPointerMove(event) {
        if (event.pointerId !== activePointerId) return;
        if (!dragging) {
          const moved = Math.hypot(event.clientX - startX, event.clientY - startY);
          if (moved < DRAG_THRESHOLD) return;
          dragging = true;
          button.classList.add('is-dragging');
          preview = makePreview(button, type);
        }
        movePreview(event.clientX, event.clientY);
        const overCanvas = isInsideCanvas(event.clientX, event.clientY);
        if (preview) preview.classList.toggle('over-canvas', overCanvas);
        event.preventDefault();
      }

      function onPointerUp(event) {
        if (event.pointerId !== activePointerId) return;
        const wasDragging = dragging;
        const clientX = event.clientX;
        const clientY = event.clientY;
        button.classList.remove('is-dragging');
        cleanup();
        if (!wasDragging) return;
        // A real drag happened — own the gesture and stop the click handler
        // from also creating a block.
        suppressClick = true;
        const pos = computeDropPosition(clientX, clientY, type);
        if (pos) addShapeAt?.(type, pos.left, pos.top);
      }

      function onPointerCancel(event) {
        if (event.pointerId !== activePointerId) return;
        button.classList.remove('is-dragging');
        cleanup();
      }

      button.addEventListener('pointerdown', (event) => {
        if (event.button !== 0) return;
        // A new press is a fresh gesture: clear any stale suppression left over
        // from a drag whose trailing synthetic click never arrived.
        suppressClick = false;
        startX = event.clientX;
        startY = event.clientY;
        dragging = false;
        activePointerId = event.pointerId;
        doc?.addEventListener('pointermove', onPointerMove, true);
        doc?.addEventListener('pointerup', onPointerUp, true);
        doc?.addEventListener('pointercancel', onPointerCancel, true);
      });

      // Capture phase: swallow the click that follows a completed drag so the
      // normal "click = add at auto position" path does not double-create.
      button.addEventListener('click', (event) => {
        if (suppressClick) {
          suppressClick = false;
          event.stopImmediatePropagation();
          event.preventDefault();
        }
      }, true);
    }

    function bind() {
      Array.from(shapeButtons || []).forEach(bindButton);
    }

    return {
      bind,
      bindButton,
      computeDropPosition,
      isInsideCanvas,
    };
  }

  window.FlowchartsPaletteDnd = {
    createPaletteDragController,
  };
}());
