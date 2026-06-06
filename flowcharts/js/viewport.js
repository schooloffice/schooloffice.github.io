(function () {
  'use strict';

  function createViewportController(options) {
    const {
      state,
      canvas,
      canvasContainer,
      svgLayer,
      zoomInBtn,
      zoomOutBtn,
      zoomResetBtn,
      zoomLevelText,
      scheduleRefresh,
      deselectAll,
      clearConnectionSelection,
      updateConnectionBar,
    } = options || {};

    let isPanning = false;
    let panStart = { x: 0, y: 0 };
    let panScroll = { left: 0, top: 0 };
    let spaceHeld = false;
    let panViaModifier = false;

    function setZoom(newScale) {
      if (!state || !canvas || !canvasContainer) return;
      const nextScale = Math.max(state.minScale, Math.min(state.maxScale, newScale));
      const rect = canvasContainer.getBoundingClientRect();
      const centerX = (canvasContainer.scrollLeft + rect.width / 2) / state.scale;
      const centerY = (canvasContainer.scrollTop + rect.height / 2) / state.scale;

      state.scale = nextScale;
      canvas.style.transform = `scale(${nextScale})`;
      if (zoomLevelText) zoomLevelText.textContent = `${Math.round(nextScale * 100)}%`;

      canvasContainer.scrollLeft = centerX * nextScale - rect.width / 2;
      canvasContainer.scrollTop = centerY * nextScale - rect.height / 2;
      scheduleRefresh?.();
    }

    // Scale + scroll so the given content bounds fit inside the viewport.
    // Fitting never zooms past 100% so small diagrams stay readable.
    function fitToBounds(bounds, opts) {
      if (!state || !canvas || !canvasContainer || !bounds || bounds.empty) return false;
      const options = opts || {};
      const padding = typeof options.padding === 'number' ? options.padding : 60;
      const maxFitScale = typeof options.maxScale === 'number' ? options.maxScale : 1;
      const rect = canvasContainer.getBoundingClientRect();
      const contentWidth = Math.max(1, (bounds.maxX - bounds.minX));
      const contentHeight = Math.max(1, (bounds.maxY - bounds.minY));
      const availWidth = Math.max(1, rect.width - padding * 2);
      const availHeight = Math.max(1, rect.height - padding * 2);

      let scale = Math.min(availWidth / contentWidth, availHeight / contentHeight);
      scale = Math.min(scale, maxFitScale);
      scale = Math.max(state.minScale, Math.min(state.maxScale, scale));

      state.scale = scale;
      canvas.style.transform = `scale(${scale})`;
      if (zoomLevelText) zoomLevelText.textContent = `${Math.round(scale * 100)}%`;

      const centerX = (bounds.minX + bounds.maxX) / 2;
      const centerY = (bounds.minY + bounds.maxY) / 2;
      canvasContainer.scrollLeft = centerX * scale - rect.width / 2;
      canvasContainer.scrollTop = centerY * scale - rect.height / 2;
      scheduleRefresh?.();
      return true;
    }

    function isOnBackground(target) {
      return target === canvas || target === canvasContainer || target === svgLayer;
    }

    // True when this pointer event should pan rather than interact with a shape
    // (middle button, or Space held). Shapes consult this to yield the gesture.
    function isPanGesture(event) {
      return event?.button === 1 || spaceHeld;
    }

    function clearSelectionForBackground() {
      deselectAll?.(false);
      clearConnectionSelection?.(false);
      updateConnectionBar?.();
    }

    function startPan(event) {
      isPanning = true;
      panStart = { x: event.clientX, y: event.clientY };
      panScroll = { left: canvasContainer.scrollLeft, top: canvasContainer.scrollTop };
      canvasContainer.setPointerCapture?.(event.pointerId);
      canvasContainer.style.cursor = 'grabbing';
    }

    function onPanStart(event) {
      if (event.button === 2) return;

      // Middle-button or Space+drag pans from anywhere without losing selection.
      if (event.button === 1 || spaceHeld) {
        panViaModifier = true;
        startPan(event);
        event.preventDefault();
        return;
      }

      if (event.button !== 0) return;
      if (!isOnBackground(event.target)) return;

      panViaModifier = false;
      clearSelectionForBackground();
      startPan(event);
    }

    function onPanMove(event) {
      if (!isPanning) return;
      const dx = event.clientX - panStart.x;
      const dy = event.clientY - panStart.y;
      canvasContainer.scrollLeft = panScroll.left - dx;
      canvasContainer.scrollTop = panScroll.top - dy;
    }

    function stopPanning() {
      if (!isPanning) return;
      isPanning = false;
      panViaModifier = false;
      canvasContainer.style.cursor = spaceHeld ? 'grab' : 'default';
    }

    function shouldGrabSpace(event) {
      if (event.code !== 'Space' && event.key !== ' ') return false;
      const target = event.target;
      const tag = target && target.tagName ? target.tagName.toLowerCase() : '';
      if (tag === 'input' || tag === 'textarea' || (target && target.isContentEditable)) return false;
      return true;
    }

    function bind() {
      zoomInBtn?.addEventListener('click', () => setZoom(state.scale + state.scaleStep));
      zoomOutBtn?.addEventListener('click', () => setZoom(state.scale - state.scaleStep));
      zoomResetBtn?.addEventListener('click', () => setZoom(1));
      canvasContainer?.addEventListener('wheel', (event) => {
        event.preventDefault();
        setZoom(state.scale + Math.sign(event.deltaY) * -0.1);
      }, { passive: false });
      canvasContainer?.addEventListener('pointerdown', onPanStart);
      canvasContainer?.addEventListener('pointermove', onPanMove);
      canvasContainer?.addEventListener('pointerup', stopPanning);
      canvasContainer?.addEventListener('pointercancel', stopPanning);
      window.addEventListener('keydown', (event) => {
        if (!shouldGrabSpace(event)) return;
        spaceHeld = true;
        if (!isPanning) canvasContainer.style.cursor = 'grab';
        event.preventDefault();
      });
      window.addEventListener('keyup', (event) => {
        if (event.code !== 'Space' && event.key !== ' ') return;
        spaceHeld = false;
        if (!isPanning) canvasContainer.style.cursor = 'default';
      });
      svgLayer?.addEventListener('pointerdown', (event) => {
        if ((event.target instanceof SVGElement) && event.target.classList.contains('conn-hit')) return;
        if (!isOnBackground(event.target)) return;
        clearSelectionForBackground();
      });
    }

    return {
      setZoom,
      fitToBounds,
      isOnBackground,
      isPanGesture,
      bind,
    };
  }

  window.FlowchartsViewport = {
    createViewportController,
  };
})();
