(function () {
  'use strict';

  function createShapeFactory(options) {
    const {
      state,
      canvas,
      canvasContainer,
      getBaseColor,
      getDefaultText,
      resolveShapePosition,
      setShapeText,
      bindShapeInteractions,
      createHandleGroup,
      scheduleRefresh,
    } = options || {};

    function createShape(type, color, textRaw, posLeft, posTop, forcedId, isRestore = false) {
      if (!state || !canvas || !canvasContainer || !type) return null;
      if (!forcedId) state.shapeCounter++;
      const shapeId = forcedId || `shape-${state.shapeCounter}`;
      const existing = forcedId ? document.getElementById(forcedId) : null;
      if (existing) return existing;

      const usedColor = color || getBaseColor?.(type) || '#3f51b5';
      const raw = (textRaw !== undefined && textRaw !== null) ? String(textRaw) : getDefaultText?.(type) || '';

      const shape = document.createElement('div');
      shape.id = shapeId;
      shape.className = `shape ${type}`;
      shape.setAttribute('role', 'button');
      shape.setAttribute('tabindex', '0');
      shape.style.backgroundColor = usedColor;

      const containerRect = canvasContainer.getBoundingClientRect();
      const defaultLeft = (canvasContainer.scrollLeft + containerRect.width / 2) / state.scale - 75;
      const defaultTop = (canvasContainer.scrollTop + containerRect.height / 3) / state.scale - 30;
      const position = resolveShapePosition?.(type, { posLeft, posTop, defaultLeft, defaultTop }) || { left: 20, top: 20 };
      shape.style.left = position.left + 'px';
      shape.style.top = position.top + 'px';

      const content = document.createElement('div');
      content.className = 'content';
      shape.appendChild(content);
      canvas.appendChild(shape);

      if (!state.shapes.find((item) => item.id === shapeId)) {
        state.shapes.push({ id: shapeId, type, color: usedColor, textRaw: raw });
      }

      setShapeText?.(shape, raw);

      if (!isRestore) {
        shape.classList.add('new-pop');
        setTimeout(() => shape.classList.remove('new-pop'), 350);
      }

      bindShapeInteractions?.(shape);
      createHandleGroup?.(shape);
      scheduleRefresh?.();
      return shape;
    }

    return {
      createShape,
    };
  }

  window.FlowchartsShapeFactory = {
    createShapeFactory,
  };
})();
