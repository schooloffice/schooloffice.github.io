(function () {
  'use strict';

  const SVG_NS = 'http://www.w3.org/2000/svg';

  // --- Pure geometry helpers (unit-tested) ---
  function getInteriorPoints(pts) {
    if (!Array.isArray(pts) || pts.length <= 2) return [];
    return pts.slice(1, pts.length - 1).map((point) => ({ x: point.x, y: point.y }));
  }

  function getSegmentMidpoints(pts) {
    if (!Array.isArray(pts) || pts.length < 2) return [];
    const mids = [];
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i];
      const b = pts[i + 1];
      mids.push({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, index: i });
    }
    return mids;
  }

  function createConnectionWaypointsController(options) {
    const {
      svgLayer,
      state,
      clientToCanvas,
      snapToGrid,
      getConnectionPath,
      updateConnection,
      saveSnapshot,
      scheduleRefresh,
      isPanGesture,
      document: doc = (typeof document !== 'undefined' ? document : null),
    } = options || {};

    let activeConnId = null;
    let group = null;

    function getConn(connId) {
      return state?.connections?.find((conn) => conn.id === connId) || null;
    }

    function snapPoint(canvasPt) {
      const snap = snapToGrid || ((value) => value);
      return { x: Math.max(0, snap(canvasPt.x)), y: Math.max(0, snap(canvasPt.y)) };
    }

    // Interior points currently in effect for a connection: stored waypoints
    // when custom, otherwise the auto-routed bends.
    function currentInterior(connId) {
      const conn = getConn(connId);
      if (conn?.isCustom && Array.isArray(conn.waypoints) && conn.waypoints.length) {
        return conn.waypoints.map((point) => ({ x: point.x, y: point.y }));
      }
      return getInteriorPoints(getConnectionPath?.(connId) || []);
    }

    function commit(connId, interior) {
      const conn = getConn(connId);
      if (!conn) return;
      conn.isCustom = interior.length > 0;
      conn.waypoints = interior.map((point) => ({ x: point.x, y: point.y }));
      updateConnection?.(connId);
    }

    function removeGroup() {
      group?.remove();
      group = null;
    }

    function clear() {
      activeConnId = null;
      removeGroup();
    }

    function makeCircle(cls, x, y) {
      const circle = doc.createElementNS(SVG_NS, 'circle');
      circle.setAttribute('class', cls);
      circle.setAttribute('cx', x);
      circle.setAttribute('cy', y);
      circle.setAttribute('r', cls === 'wp-ghost' ? '5' : '6.5');
      return circle;
    }

    function beginDrag(connId, interiorIndex, isInsert, startEvent) {
      startEvent.stopPropagation();
      startEvent.preventDefault();
      if (!doc) return;

      saveSnapshot?.();
      if (state) state.connDrag = { waypoint: true };

      let interior = currentInterior(connId);
      let index = interiorIndex;
      if (isInsert) {
        const inserted = snapPoint(clientToCanvas(startEvent.clientX, startEvent.clientY));
        interior.splice(index, 0, inserted);
        commit(connId, interior);
      }

      const onMove = (event) => {
        const pt = snapPoint(clientToCanvas(event.clientX, event.clientY));
        interior[index] = pt;
        commit(connId, interior);
        const node = group?.querySelector(`[data-vertex="${index}"]`);
        if (node) {
          node.setAttribute('cx', pt.x);
          node.setAttribute('cy', pt.y);
        }
      };

      const onUp = () => {
        doc.removeEventListener('pointermove', onMove, true);
        doc.removeEventListener('pointerup', onUp, true);
        doc.removeEventListener('pointercancel', onUp, true);
        if (state) state.connDrag = null;
        render();
        scheduleRefresh?.();
      };

      doc.addEventListener('pointermove', onMove, true);
      doc.addEventListener('pointerup', onUp, true);
      doc.addEventListener('pointercancel', onUp, true);
    }

    function removeVertex(connId, interiorIndex) {
      const interior = currentInterior(connId);
      if (interiorIndex < 0 || interiorIndex >= interior.length) return;
      saveSnapshot?.();
      interior.splice(interiorIndex, 1);
      commit(connId, interior);
      render();
      scheduleRefresh?.();
    }

    function render() {
      removeGroup();
      if (!activeConnId || !svgLayer || !doc) return;
      const rendered = getConnectionPath?.(activeConnId) || [];
      if (rendered.length < 2) return;

      // Handles map to the editable guide points (stored waypoints when custom,
      // otherwise the auto bends) — never to the orthogonal elbows the renderer
      // inserts, so the drag indices stay aligned with conn.waypoints.
      const interior = currentInterior(activeConnId);
      const guide = [rendered[0], ...interior, rendered[rendered.length - 1]];

      group = doc.createElementNS(SVG_NS, 'g');
      group.id = 'waypoint-handles';

      // Ghost handles on each guide segment midpoint — drag to add a bend.
      getSegmentMidpoints(guide).forEach((mid) => {
        const ghost = makeCircle('wp-ghost', mid.x, mid.y);
        ghost.addEventListener('pointerdown', (event) => {
          if (event.button !== 0) return;
          if (isPanGesture?.(event)) return; // yield to pan
          beginDrag(activeConnId, mid.index, true, event);
        });
        group.appendChild(ghost);
      });

      // Solid handles on existing guide points — drag to move, double-click to remove.
      interior.forEach((point, j) => {
        const node = makeCircle('wp-node', point.x, point.y);
        node.dataset.vertex = String(j);
        node.addEventListener('pointerdown', (event) => {
          if (event.button !== 0) return;
          if (isPanGesture?.(event)) return; // yield to pan
          beginDrag(activeConnId, j, false, event);
        });
        node.addEventListener('dblclick', (event) => {
          event.stopPropagation();
          removeVertex(activeConnId, j);
        });
        group.appendChild(node);
      });

      svgLayer.appendChild(group);
    }

    function showForConnection(connId) {
      activeConnId = connId;
      render();
    }

    function refresh() {
      if (activeConnId) render();
    }

    function resetConnection(connId) {
      const conn = getConn(connId);
      if (!conn) return;
      conn.isCustom = false;
      conn.waypoints = [];
      updateConnection?.(connId);
      if (activeConnId === connId) render();
    }

    return {
      showForConnection,
      clear,
      refresh,
      render,
      resetConnection,
      // pure helpers exposed for testing
      getInteriorPoints,
      getSegmentMidpoints,
      currentInterior,
    };
  }

  window.FlowchartsConnectionWaypoints = {
    createConnectionWaypointsController,
    getInteriorPoints,
    getSegmentMidpoints,
  };
}());
