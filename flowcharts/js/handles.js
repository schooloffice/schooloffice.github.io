(function () {
  'use strict';

  const SVG_NS = 'http://www.w3.org/2000/svg';
  const HANDLE_SIDES = ['top', 'right', 'bottom', 'left'];

  function createHandlesController({
    svgLayer,
    state,
    getHandlePositions,
    clientToCanvas,
    findShapeAt,
    getShapeData,
    onDirectConnect,
    onDecisionConnect,
  } = {}) {
    const handleGroups = {};

    const tempLine = document.createElementNS(SVG_NS, 'line');
    tempLine.setAttribute('stroke', '#4361ee');
    tempLine.setAttribute('stroke-width', '2.5');
    tempLine.setAttribute('stroke-dasharray', '8 5');
    tempLine.setAttribute('marker-end', 'url(#arrowhead)');
    tempLine.style.display = 'none';
    tempLine.style.pointerEvents = 'none';
    svgLayer.appendChild(tempLine);

    function updateHandleGroup(shapeId) {
      const el = document.getElementById(shapeId);
      const group = handleGroups[shapeId];
      if (!el || !group) return;
      const pts = getHandlePositions(el);
      const hitCircles = group.querySelectorAll('.conn-handle-hit-area');
      const visualCircles = group.querySelectorAll('.conn-handle-visual');
      HANDLE_SIDES.forEach((pos, index) => {
        if (hitCircles[index]) {
          hitCircles[index].setAttribute('cx', pts[pos].x);
          hitCircles[index].setAttribute('cy', pts[pos].y);
        }
        if (visualCircles[index]) {
          visualCircles[index].setAttribute('cx', pts[pos].x);
          visualCircles[index].setAttribute('cy', pts[pos].y);
        }
      });
    }

    function onHandlePointerDown(event) {
      if (event.button !== 0 && event.pointerType === 'mouse') return;
      event.preventDefault();
      event.stopPropagation();

      const shapeId = this.dataset.shapeId;
      const pos = this.dataset.pos;
      const shapeEl = document.getElementById(shapeId);
      if (!shapeEl) return;

      const startPt = getHandlePositions(shapeEl)[pos];
      tempLine.setAttribute('x1', startPt.x);
      tempLine.setAttribute('y1', startPt.y);
      tempLine.setAttribute('x2', startPt.x);
      tempLine.setAttribute('y2', startPt.y);
      tempLine.style.display = '';
      state.connDrag = { fromShapeId: shapeId };

      this.setPointerCapture(event.pointerId);

      const onMove = (moveEvent) => {
        const pt = clientToCanvas(moveEvent.clientX, moveEvent.clientY);
        tempLine.setAttribute('x2', pt.x);
        tempLine.setAttribute('y2', pt.y);
      };

      const onUp = (upEvent) => {
        this.removeEventListener('pointermove', onMove);
        this.removeEventListener('pointerup', onUp);
        this.removeEventListener('pointercancel', onUp);
        tempLine.style.display = 'none';

        if (!state.connDrag) return;
        const fromId = state.connDrag.fromShapeId;
        state.connDrag = null;

        const pt = clientToCanvas(upEvent.clientX, upEvent.clientY);
        const targetEl = findShapeAt(pt.x, pt.y, fromId);
        if (!targetEl || targetEl.id === fromId) return;

        const fromEl = document.getElementById(fromId);
        const fromData = getShapeData?.(fromId);
        if (fromData?.type === 'decision') {
          onDecisionConnect?.({ fromEl, toEl: targetEl });
        } else {
          onDirectConnect?.({ fromEl, toEl: targetEl });
        }
      };

      this.addEventListener('pointermove', onMove);
      this.addEventListener('pointerup', onUp);
      this.addEventListener('pointercancel', onUp);
    }

    function attachHandleListeners(shapeId) {
      const group = handleGroups[shapeId];
      if (!group) return;
      group.querySelectorAll('.conn-handle-hit-area').forEach(circle => {
        circle.addEventListener('pointerdown', onHandlePointerDown);
      });
    }

    function createHandleGroup(shapeEl) {
      const group = document.createElementNS(SVG_NS, 'g');
      group.dataset.shapeId = shapeEl.id;

      HANDLE_SIDES.forEach(pos => {
        const hitCircle = document.createElementNS(SVG_NS, 'circle');
        hitCircle.setAttribute('r', '22');
        hitCircle.setAttribute('fill', 'transparent');
        hitCircle.setAttribute('stroke', 'none');
        hitCircle.classList.add('conn-handle', 'conn-handle-hit-area');
        hitCircle.dataset.shapeId = shapeEl.id;
        hitCircle.dataset.pos = pos;
        group.appendChild(hitCircle);

        const visualCircle = document.createElementNS(SVG_NS, 'circle');
        visualCircle.setAttribute('r', '10');
        visualCircle.setAttribute('fill', 'white');
        visualCircle.setAttribute('stroke', '#4361ee');
        visualCircle.setAttribute('stroke-width', '3');
        visualCircle.classList.add('conn-handle', 'conn-handle-visual');
        visualCircle.dataset.shapeId = shapeEl.id;
        visualCircle.dataset.pos = pos;
        visualCircle.style.pointerEvents = 'none';
        group.appendChild(visualCircle);
      });

      svgLayer.appendChild(group);
      handleGroups[shapeEl.id] = group;
      updateHandleGroup(shapeEl.id);
      attachHandleListeners(shapeEl.id);
      return group;
    }

    function showHandlesForShape(shapeId) {
      Object.values(handleGroups).forEach(group => {
        group.querySelectorAll('.conn-handle-visual').forEach(circle => circle.classList.remove('visible'));
      });
      const group = handleGroups[shapeId];
      if (group) {
        group.querySelectorAll('.conn-handle-visual').forEach(circle => circle.classList.add('visible'));
      }
    }

    function hideAllHandles() {
      Object.values(handleGroups).forEach(group => {
        group.querySelectorAll('.conn-handle-visual').forEach(circle => circle.classList.remove('visible'));
      });
    }

    function removeHandleGroup(shapeId) {
      const group = handleGroups[shapeId];
      if (group) {
        group.remove();
        delete handleGroups[shapeId];
      }
    }

    function updateAllHandleGroups() {
      Object.keys(handleGroups).forEach(updateHandleGroup);
    }

    return {
      createHandleGroup,
      hideAllHandles,
      removeHandleGroup,
      showHandlesForShape,
      updateAllHandleGroups,
      updateHandleGroup,
    };
  }

  window.FlowchartsHandles = {
    createHandlesController,
  };
}());
