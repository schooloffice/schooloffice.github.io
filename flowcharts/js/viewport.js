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

    function isOnBackground(target) {
      return target === canvas || target === canvasContainer || target === svgLayer;
    }

    function clearSelectionForBackground() {
      deselectAll?.(false);
      clearConnectionSelection?.(false);
      updateConnectionBar?.();
    }

    function onPanStart(event) {
      if (event.button === 2) return;
      if (!isOnBackground(event.target)) return;

      clearSelectionForBackground();
      isPanning = true;
      panStart = { x: event.clientX, y: event.clientY };
      panScroll = { left: canvasContainer.scrollLeft, top: canvasContainer.scrollTop };
      canvasContainer.setPointerCapture?.(event.pointerId);
      canvasContainer.style.cursor = 'grabbing';
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
      canvasContainer.style.cursor = 'default';
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
      svgLayer?.addEventListener('pointerdown', (event) => {
        if ((event.target instanceof SVGElement) && event.target.classList.contains('conn-hit')) return;
        if (!isOnBackground(event.target)) return;
        clearSelectionForBackground();
      });
    }

    return {
      setZoom,
      isOnBackground,
      bind,
    };
  }

  window.FlowchartsViewport = {
    createViewportController,
  };
})();
