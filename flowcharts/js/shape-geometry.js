(function () {
  'use strict';

  function createShapeGeometry({
    core,
    state,
    decisionHandleOutset = 8,
    decisionConnOutset = 2,
  } = {}) {
    function getShapeType(shapeEl) {
      if (!shapeEl) return 'process';
      if (shapeEl.classList.contains('start-end')) return 'start-end';
      if (shapeEl.classList.contains('decision')) return 'decision';
      if (shapeEl.classList.contains('input-output')) return 'input-output';
      if (shapeEl.classList.contains('subroutine')) return 'subroutine';
      if (shapeEl.classList.contains('connector')) return 'connector';
      return 'process';
    }

    function domShapeToBox(shapeEl) {
      return {
        left: shapeEl.offsetLeft,
        top: shapeEl.offsetTop,
        width: shapeEl.offsetWidth,
        height: shapeEl.offsetHeight,
        type: getShapeType(shapeEl),
      };
    }

    function decisionVertexDistance(shapeEl) {
      if (core?.decisionVertexDistance) return core.decisionVertexDistance(domShapeToBox(shapeEl));
      return (shapeEl.offsetWidth || 0) / Math.SQRT2;
    }

    function getHandlePositions(shapeEl) {
      const cx = shapeEl.offsetLeft + shapeEl.offsetWidth / 2;
      const cy = shapeEl.offsetTop + shapeEl.offsetHeight / 2;

      if (shapeEl.classList.contains('connector')) {
        const r = Math.min(shapeEl.offsetWidth, shapeEl.offsetHeight) / 2;
        return {
          top: { x: cx, y: cy - r },
          right: { x: cx + r, y: cy },
          bottom: { x: cx, y: cy + r },
          left: { x: cx - r, y: cy },
        };
      }

      if (shapeEl.classList.contains('decision')) {
        const d = decisionVertexDistance(shapeEl);
        const outset = decisionHandleOutset;
        return {
          top: { x: cx, y: cy - d - outset },
          right: { x: cx + d + outset, y: cy },
          bottom: { x: cx, y: cy + d + outset },
          left: { x: cx - d - outset, y: cy },
        };
      }

      const hw = shapeEl.offsetWidth / 2;
      const hh = shapeEl.offsetHeight / 2;
      return {
        top: { x: cx, y: cy - hh },
        right: { x: cx + hw, y: cy },
        bottom: { x: cx, y: cy + hh },
        left: { x: cx - hw, y: cy },
      };
    }

    function getConnectionPoint(shapeEl, toX, toY) {
      const cx = shapeEl.offsetLeft + shapeEl.offsetWidth / 2;
      const cy = shapeEl.offsetTop + shapeEl.offsetHeight / 2;
      const dx = toX - cx;
      const dy = toY - cy;

      if (shapeEl.classList.contains('connector')) {
        const r = Math.min(shapeEl.offsetWidth, shapeEl.offsetHeight) / 2;
        const len = Math.hypot(dx, dy) || 1;
        return { x: cx + (dx / len) * r, y: cy + (dy / len) * r };
      }

      if (shapeEl.classList.contains('decision')) {
        const d = decisionVertexDistance(shapeEl) + decisionConnOutset;
        const adx = Math.abs(dx);
        const ady = Math.abs(dy);
        const denom = (adx + ady) || 1;
        const t = d / denom;
        return { x: cx + dx * t, y: cy + dy * t };
      }

      const hw = shapeEl.offsetWidth / 2;
      const hh = shapeEl.offsetHeight / 2;
      if (dx === 0 && dy === 0) return { x: cx, y: cy };

      const sx = hw / (Math.abs(dx) || 0.001);
      const sy = hh / (Math.abs(dy) || 0.001);
      const scale = Math.min(sx, sy);
      return { x: cx + dx * scale, y: cy + dy * scale };
    }

    function findShapeAt(x, y, excludeId) {
      for (let i = state.shapes.length - 1; i >= 0; i--) {
        const shape = state.shapes[i];
        if (shape.id === excludeId) continue;
        const el = document.getElementById(shape.id);
        if (!el) continue;
        const cx = el.offsetLeft + el.offsetWidth / 2;
        const cy = el.offsetTop + el.offsetHeight / 2;
        const dx = Math.abs(x - cx);
        const dy = Math.abs(y - cy);

        if (shape.type === 'connector') {
          const r = Math.min(el.offsetWidth, el.offsetHeight) / 2 + 10;
          if ((dx * dx + dy * dy) <= (r * r)) return el;
        } else if (shape.type === 'decision') {
          const d = decisionVertexDistance(el);
          if ((dx + dy) <= (d + 14)) return el;
        } else if (dx <= el.offsetWidth / 2 + 10 && dy <= el.offsetHeight / 2 + 10) {
          return el;
        }
      }
      return null;
    }

    return {
      decisionVertexDistance,
      domShapeToBox,
      findShapeAt,
      getConnectionPoint,
      getHandlePositions,
      getShapeType,
    };
  }

  window.FlowchartsShapeGeometry = {
    createShapeGeometry,
  };
}());
