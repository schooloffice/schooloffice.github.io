(function () {
  'use strict';

  function createShapePlacement({ state, snapToGrid } = {}) {
    function getShapeSizeHint(type) {
      if (type === 'connector') return { w: 60, h: 60 };
      if (type === 'decision') return { w: 140, h: 140 };
      if (type === 'start-end') return { w: 170, h: 78 };
      if (type === 'input-output') return { w: 170, h: 84 };
      if (type === 'subroutine') return { w: 190, h: 84 };
      return { w: 150, h: 84 };
    }

    function rectsOverlap(a, b, gap = 14) {
      return !(
        (a.left + a.w + gap) < b.left ||
        (b.left + b.w + gap) < a.left ||
        (a.top + a.h + gap) < b.top ||
        (b.top + b.h + gap) < a.top
      );
    }

    function hasShapeCollision(left, top, width, height) {
      const nextRect = { left, top, w: width, h: height };
      return state.shapes.some(shape => {
        const el = document.getElementById(shape.id);
        if (!el) return false;
        const hint = getShapeSizeHint(shape.type);
        const rect = {
          left: el.offsetLeft,
          top: el.offsetTop,
          w: el.offsetWidth || hint.w,
          h: el.offsetHeight || hint.h,
        };
        return rectsOverlap(nextRect, rect);
      });
    }

    function findAutoShapePosition(type, startLeft, startTop) {
      const hint = getShapeSizeHint(type);
      const minLeft = 20;
      const minTop = 20;
      const x0 = Math.max(minLeft, Math.round(startLeft));
      const y0 = Math.max(minTop, Math.round(startTop));
      if (!hasShapeCollision(x0, y0, hint.w, hint.h)) return { left: x0, top: y0 };

      const stepX = 56;
      const stepY = 48;
      const maxRing = 14;

      for (let ring = 1; ring <= maxRing; ring++) {
        for (let dx = -ring; dx <= ring; dx++) {
          for (let dy = -ring; dy <= ring; dy++) {
            if (Math.max(Math.abs(dx), Math.abs(dy)) !== ring) continue;
            const left = Math.max(minLeft, x0 + dx * stepX);
            const top = Math.max(minTop, y0 + dy * stepY);
            if (!hasShapeCollision(left, top, hint.w, hint.h)) return { left, top };
          }
        }
      }

      return { left: x0 + stepX, top: y0 + stepY };
    }

    function resolveShapePosition(type, { posLeft, posTop, defaultLeft, defaultTop } = {}) {
      const autoPos = (posLeft === undefined || posTop === undefined)
        ? findAutoShapePosition(type, defaultLeft, defaultTop)
        : null;
      return {
        left: posLeft !== undefined ? posLeft : snapToGrid(autoPos.left),
        top: posTop !== undefined ? posTop : snapToGrid(autoPos.top),
      };
    }

    return {
      findAutoShapePosition,
      getShapeSizeHint,
      hasShapeCollision,
      rectsOverlap,
      resolveShapePosition,
    };
  }

  window.FlowchartsShapePlacement = {
    createShapePlacement,
  };
}());
