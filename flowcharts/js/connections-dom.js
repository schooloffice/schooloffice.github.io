(function () {
  'use strict';

  const SVG_NS = 'http://www.w3.org/2000/svg';

  function markerForConnection(conn) {
    if (conn?.type === 'yes') return 'url(#arrowhead-yes)';
    if (conn?.type === 'no') return 'url(#arrowhead-no)';
    return 'url(#arrowhead)';
  }

  function createConnectionsDom({
    core,
    state,
    svgLayer,
    routeModes,
    buildMergeContext,
    computeConnectionGeometry,
    pointAlongPolyline,
    onSelectConnection,
    onDuplicateConnection,
  } = {}) {
    function getConnectionLabelText(conn) {
      return core?.resolveConnectionLabel ? core.resolveConnectionLabel(conn) : '';
    }

    function removeConnectionDom(connId) {
      document.getElementById(connId)?.remove();
      document.getElementById(`label-${connId}`)?.remove();
      document.getElementById(`hit-${connId}`)?.remove();
    }

    function addConnectionLabel(connId) {
      const group = document.createElementNS(SVG_NS, 'g');
      group.id = `label-${connId}`;
      group.style.pointerEvents = 'none';

      const bg = document.createElementNS(SVG_NS, 'rect');
      bg.setAttribute('rx', '11');
      bg.setAttribute('ry', '11');
      bg.setAttribute('fill', 'white');
      bg.setAttribute('stroke', '#607d8b');
      bg.setAttribute('stroke-width', '2');

      const txt = document.createElementNS(SVG_NS, 'text');
      txt.setAttribute('text-anchor', 'middle');
      txt.setAttribute('dominant-baseline', 'central');
      txt.setAttribute('fill', '#37474f');
      txt.setAttribute('font-family', "'Nunito', Arial, sans-serif");
      txt.setAttribute('font-size', '14px');
      txt.setAttribute('font-weight', '900');
      txt.textContent = '';

      group.appendChild(bg);
      group.appendChild(txt);

      const firstHandleGroup = svgLayer.querySelector('g[data-shape-id]');
      svgLayer.insertBefore(group, firstHandleGroup);
      updateConnectionLabel(connId);
    }

    function updateConnectionLabel(connId, ptsOverride) {
      const labelGroup = document.getElementById(`label-${connId}`);
      const conn = state.connections.find(candidate => candidate.id === connId);
      const path = document.getElementById(connId);
      if (!labelGroup || !conn || !path) return;

      let pts = ptsOverride;
      if (!pts) {
        const fromEl = document.getElementById(conn.from);
        const toEl = document.getElementById(conn.to);
        if (!fromEl || !toEl) return;
        pts = computeConnectionGeometry(fromEl, toEl, conn).pts;
      }

      let labelPoint = core?.getConnectionLabelPosition
        ? core.getConnectionLabelPosition(pts, conn.type)
        : pointAlongPolyline(pts, (conn.type === 'yes' || conn.type === 'no') ? 0.28 : 0.5);

      if (core?.resolveConnectionLabelOverlap) {
        const occupied = Array.from(svgLayer.querySelectorAll('g[id^="label-"]'))
          .filter(group => group.id !== `label-${connId}`)
          .map((group) => {
            const textNode = group.querySelector('text');
            if (!textNode) return null;
            const x = Number(textNode.getAttribute('x'));
            const y = Number(textNode.getAttribute('y'));
            if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
            return { x, y };
          })
          .filter(Boolean);
        labelPoint = core.resolveConnectionLabelOverlap(labelPoint, conn.type, occupied);
      }

      const txt = labelGroup.querySelector('text');
      const bg = labelGroup.querySelector('rect');
      const labelText = getConnectionLabelText(conn);
      if (!labelText) {
        labelGroup.remove();
        return;
      }

      txt.textContent = labelText;
      bg.setAttribute('stroke', conn.type === 'yes' ? '#4caf50' : conn.type === 'no' ? '#f44336' : '#607d8b');
      txt.setAttribute('fill', conn.type === 'yes' ? '#2e7d32' : conn.type === 'no' ? '#c62828' : '#37474f');
      txt.setAttribute('x', labelPoint.x);
      txt.setAttribute('y', labelPoint.y);
      try {
        const bbox = txt.getBBox();
        const pad = 7;
        bg.setAttribute('x', bbox.x - pad);
        bg.setAttribute('y', bbox.y - pad);
        bg.setAttribute('width', bbox.width + pad * 2);
        bg.setAttribute('height', bbox.height + pad * 2);
      } catch (_) { }
    }

    function updateConnection(connId) {
      const conn = state.connections.find(candidate => candidate.id === connId);
      const path = document.getElementById(connId);
      const hit = document.getElementById(`hit-${connId}`);
      if (!conn || !path) return;
      const fromEl = document.getElementById(conn.from);
      const toEl = document.getElementById(conn.to);
      if (!fromEl || !toEl) return;

      const mergeContext = buildMergeContext();
      const mergeMeta = mergeContext[conn.id];
      const geo = computeConnectionGeometry(fromEl, toEl, conn, mergeContext);
      path.setAttribute('d', geo.d);
      hit?.setAttribute('d', geo.d);
      if (state.selectedConnId !== connId) {
        path.setAttribute('marker-end', mergeMeta?.isMerged && !mergeMeta.isPrimary ? 'none' : markerForConnection(conn));
      }

      const labelText = getConnectionLabelText(conn);
      if (labelText) {
        if (!document.getElementById(`label-${connId}`)) addConnectionLabel(connId);
        updateConnectionLabel(connId, geo.pts);
      } else {
        document.getElementById(`label-${connId}`)?.remove();
      }
    }

    function updateConnectionsForShape(shapeId) {
      state.connections.forEach(conn => {
        if (conn.from === shapeId || conn.to === shapeId) updateConnection(conn.id);
      });
    }

    function connectShapes(fromEl, toEl, connType, forcedId, isRestore = false, forcedRouteMode = 'auto') {
      connType = connType || null;
      if (!fromEl || !toEl) return null;
      if (fromEl.id === toEl.id) return null;

      const connId = forcedId || (connType
        ? `conn-${fromEl.id}-${toEl.id}-${connType}`
        : `conn-${fromEl.id}-${toEl.id}`);

      if (!isRestore && state.connections.some(conn => conn.id === connId)) {
        onDuplicateConnection?.();
        return null;
      }

      const path = document.createElementNS(SVG_NS, 'path');
      path.id = connId;
      path.classList.add('conn-line');
      path.setAttribute('fill', 'none');

      if (connType === 'yes') {
        path.setAttribute('stroke', '#4caf50');
        path.setAttribute('stroke-width', '2.8');
        path.setAttribute('marker-end', 'url(#arrowhead-yes)');
      } else if (connType === 'no') {
        path.setAttribute('stroke', '#f44336');
        path.setAttribute('stroke-width', '2.8');
        path.setAttribute('marker-end', 'url(#arrowhead-no)');
      } else {
        path.setAttribute('stroke', '#555');
        path.setAttribute('stroke-width', '2.8');
        path.setAttribute('marker-end', 'url(#arrowhead)');
      }
      path.style.pointerEvents = 'none';

      const hitPath = document.createElementNS(SVG_NS, 'path');
      hitPath.id = `hit-${connId}`;
      hitPath.classList.add('conn-hit');
      hitPath.dataset.connId = connId;

      const firstHandleGroup = svgLayer.querySelector('g[data-shape-id]') || svgLayer.lastChild;
      svgLayer.insertBefore(path, firstHandleGroup);
      svgLayer.insertBefore(hitPath, firstHandleGroup);

      hitPath.addEventListener('pointerdown', (event) => {
        if (state.connDrag) return;
        event.stopPropagation();
        onSelectConnection?.(connId);
      });

      if (!state.connections.find(conn => conn.id === connId)) {
        const routeMode = routeModes.includes(forcedRouteMode) ? forcedRouteMode : 'auto';
        state.connections.push({ id: connId, from: fromEl.id, to: toEl.id, type: connType, routeMode, label: null });
      }

      updateConnection(connId);
      return path;
    }

    return {
      connectShapes,
      removeConnectionDom,
      updateConnection,
      updateConnectionsForShape,
    };
  }

  window.FlowchartsConnectionsDom = {
    createConnectionsDom,
    markerForConnection,
  };
}());
