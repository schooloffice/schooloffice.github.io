(function () {
  'use strict';

  function createRouting({
    core,
    state,
    routeModes = ['auto', 'vertical', 'horizontal'],
    mergeLead = 34,
    decisionConnOutset = 2,
    domShapeToBox,
    decisionVertexDistance,
    obstacleRouter,
    onSmartRouteFailure,
  } = {}) {
    function getShape(shapeId) {
      return state?.shapes?.find(shape => shape.id === shapeId) || null;
    }

    function polylineLength(points) {
      let len = 0;
      for (let i = 1; i < points.length; i++) {
        const dx = points[i].x - points[i - 1].x;
        const dy = points[i].y - points[i - 1].y;
        len += Math.hypot(dx, dy);
      }
      return len;
    }

    function pointAlongPolyline(points, t) {
      if (core?.pointAlongPolyline) return core.pointAlongPolyline(points, t);
      const total = polylineLength(points);
      if (total <= 0) return points[0] || { x: 0, y: 0 };
      const target = total * t;
      let acc = 0;
      for (let i = 1; i < points.length; i++) {
        const a = points[i - 1], b = points[i];
        const seg = Math.hypot(b.x - a.x, b.y - a.y);
        if (acc + seg >= target) {
          const ratio = (target - acc) / (seg || 1);
          return { x: a.x + (b.x - a.x) * ratio, y: a.y + (b.y - a.y) * ratio };
        }
        acc += seg;
      }
      return points[points.length - 1];
    }

    function getEdgePoints(el) {
      if (core?.getEdgePoints) return core.getEdgePoints(domShapeToBox(el), decisionConnOutset);
      const cx = el.offsetLeft + el.offsetWidth / 2;
      const cy = el.offsetTop + el.offsetHeight / 2;
      if (el.classList.contains('decision')) {
        const d = decisionVertexDistance(el) + decisionConnOutset;
        return {
          top: { x: cx, y: cy - d, side: 'top' },
          bottom: { x: cx, y: cy + d, side: 'bottom' },
          left: { x: cx - d, y: cy, side: 'left' },
          right: { x: cx + d, y: cy, side: 'right' },
        };
      }

      const hw = el.offsetWidth / 2;
      const hh = el.offsetHeight / 2;
      return {
        top: { x: cx, y: cy - hh, side: 'top' },
        bottom: { x: cx, y: cy + hh, side: 'bottom' },
        left: { x: cx - hw, y: cy, side: 'left' },
        right: { x: cx + hw, y: cy, side: 'right' },
      };
    }

    function orthogonalPath(fromPt, toPt, exitSide, entrySide) {
      const pts = [fromPt];
      const dx = toPt.x - fromPt.x;
      const dy = toPt.y - fromPt.y;

      if ((exitSide === 'bottom' && entrySide === 'top') ||
        (exitSide === 'top' && entrySide === 'bottom')) {
        if (Math.abs(dx) < 2) {
          pts.push(toPt);
        } else {
          const yMid = fromPt.y + dy / 2;
          pts.push({ x: fromPt.x, y: yMid });
          pts.push({ x: toPt.x, y: yMid });
          pts.push(toPt);
        }
        return pts;
      }

      if ((exitSide === 'right' && entrySide === 'left') ||
        (exitSide === 'left' && entrySide === 'right')) {
        if (Math.abs(dy) < 2) {
          pts.push(toPt);
        } else {
          const xMid = fromPt.x + dx / 2;
          pts.push({ x: xMid, y: fromPt.y });
          pts.push({ x: xMid, y: toPt.y });
          pts.push(toPt);
        }
        return pts;
      }

      if (exitSide === 'bottom' || exitSide === 'top') {
        pts.push({ x: fromPt.x, y: toPt.y });
      } else {
        pts.push({ x: toPt.x, y: fromPt.y });
      }
      pts.push(toPt);
      return pts;
    }

    function chooseSides(fromEl, toEl, routeMode = 'auto') {
      if (core?.chooseSides) return core.chooseSides(domShapeToBox(fromEl), domShapeToBox(toEl), routeMode);
      const fcx = fromEl.offsetLeft + fromEl.offsetWidth / 2;
      const fcy = fromEl.offsetTop + fromEl.offsetHeight / 2;
      const tcx = toEl.offsetLeft + toEl.offsetWidth / 2;
      const tcy = toEl.offsetTop + toEl.offsetHeight / 2;
      const dx = tcx - fcx;
      const dy = tcy - fcy;

      if (routeMode === 'vertical') {
        return dy >= 0 ? { exit: 'bottom', entry: 'top' } : { exit: 'top', entry: 'bottom' };
      }
      if (routeMode === 'horizontal') {
        return dx >= 0 ? { exit: 'right', entry: 'left' } : { exit: 'left', entry: 'right' };
      }

      const fhw = fromEl.offsetWidth / 2;
      const fhh = fromEl.offsetHeight / 2;
      const thw = toEl.offsetWidth / 2;
      const thh = toEl.offsetHeight / 2;
      const gapRight = dx - fhw - thw;
      const gapLeft = -dx - fhw - thw;
      const gapBottom = dy - fhh - thh;
      const gapTop = -dy - fhh - thh;
      const hGap = Math.max(gapRight, gapLeft);
      const vGap = Math.max(gapBottom, gapTop);

      if (vGap >= hGap) {
        return dy >= 0 ? { exit: 'bottom', entry: 'top' } : { exit: 'top', entry: 'bottom' };
      }
      return dx >= 0 ? { exit: 'right', entry: 'left' } : { exit: 'left', entry: 'right' };
    }

    function routeOrthogonal(fromEl, toEl, routeMode = 'auto') {
      if (core?.routeOrthogonal) return core.routeOrthogonal(domShapeToBox(fromEl), domShapeToBox(toEl), routeMode);
      const { exit, entry } = chooseSides(fromEl, toEl, routeMode);
      const fromPt = getEdgePoints(fromEl)[exit];
      const toPt = getEdgePoints(toEl)[entry];
      return { pts: orthogonalPath(fromPt, toPt, exit, entry), exit, entry };
    }

    function chooseExitSideToPoint(fromEl, toPt, routeMode = 'auto') {
      if (core?.chooseExitSideToPoint) return core.chooseExitSideToPoint(domShapeToBox(fromEl), toPt, routeMode);
      const cx = fromEl.offsetLeft + fromEl.offsetWidth / 2;
      const cy = fromEl.offsetTop + fromEl.offsetHeight / 2;
      const dx = toPt.x - cx;
      const dy = toPt.y - cy;
      if (routeMode === 'vertical') return dy >= 0 ? 'bottom' : 'top';
      if (routeMode === 'horizontal') return dx >= 0 ? 'right' : 'left';
      return Math.abs(dy) >= Math.abs(dx)
        ? (dy >= 0 ? 'bottom' : 'top')
        : (dx >= 0 ? 'right' : 'left');
    }

    function routeToPoint(fromEl, toPt, routeMode = 'auto', entrySide = 'top') {
      if (core?.routeToPoint) return core.routeToPoint(domShapeToBox(fromEl), toPt, routeMode, entrySide);
      const exit = chooseExitSideToPoint(fromEl, toPt, routeMode);
      const fromPt = getEdgePoints(fromEl)[exit];
      const pts = orthogonalPath(fromPt, { x: toPt.x, y: toPt.y, side: entrySide }, exit, entrySide);
      return { pts, exit, entry: entrySide };
    }

    function pointsToPathD(points) {
      if (!points.length) return '';
      let d = `M ${points[0].x} ${points[0].y}`;
      for (let i = 1; i < points.length; i++) d += ` L ${points[i].x} ${points[i].y}`;
      return d;
    }

    function computeDecisionConnection(fromEl, toEl, side) {
      if (core?.getDecisionBranchRoute) {
        const routed = core.getDecisionBranchRoute(domShapeToBox(fromEl), domShapeToBox(toEl), side, decisionConnOutset);
        return { d: pointsToPathD(routed.pts), pts: routed.pts };
      }

      const fromEdges = getEdgePoints(fromEl);
      const toEdges = getEdgePoints(toEl);
      const fromPt = side === 'right' ? fromEdges.right : fromEdges.left;
      const cx = fromEl.offsetLeft + fromEl.offsetWidth / 2;
      const cy = fromEl.offsetTop + fromEl.offsetHeight / 2;
      const toCx = toEl.offsetLeft + toEl.offsetWidth / 2;
      const toCy = toEl.offsetTop + toEl.offsetHeight / 2;
      const hDist = side === 'right' ? toCx - cx : cx - toCx;
      const vDist = toCy - cy;
      const entry = vDist < -30 ? side : (Math.abs(vDist) < 30 && hDist > 20 ? (side === 'right' ? 'left' : 'right') : 'top');
      const toPt = toEdges[entry];
      const margin = 40;
      let pts;

      if (entry === side) {
        const corridor = side === 'right'
          ? Math.max(fromPt.x, toPt.x) + margin
          : Math.min(fromPt.x, toPt.x) - margin;
        pts = [fromPt, { x: corridor, y: fromPt.y }, { x: corridor, y: toPt.y }, toPt];
      } else if (Math.abs(toPt.y - fromPt.y) < 4) {
        pts = [fromPt, toPt];
      } else if (
        (side === 'right' && toPt.x > fromPt.x + 4) ||
        (side === 'left' && toPt.x < fromPt.x - 4)
      ) {
        pts = [fromPt, { x: toPt.x, y: fromPt.y }, toPt];
      } else {
        const xOut = side === 'right' ? fromPt.x + margin : fromPt.x - margin;
        pts = [fromPt, { x: xOut, y: fromPt.y }, { x: xOut, y: toPt.y }, toPt];
      }

      return { d: pointsToPathD(pts), pts };
    }

    function getDecisionEntrySide(fromEl, toEl, side) {
      if (core?.getDecisionBranchRoute) {
        return core.getDecisionBranchRoute(domShapeToBox(fromEl), domShapeToBox(toEl), side, decisionConnOutset).entry;
      }
      const cx = fromEl.offsetLeft + fromEl.offsetWidth / 2;
      const cy = fromEl.offsetTop + fromEl.offsetHeight / 2;
      const toCx = toEl.offsetLeft + toEl.offsetWidth / 2;
      const toCy = toEl.offsetTop + toEl.offsetHeight / 2;
      const hDist = side === 'right' ? toCx - cx : cx - toCx;
      const vDist = toCy - cy;
      if (vDist < -30) return side;
      if (Math.abs(vDist) < 30 && hDist > 20) return side === 'right' ? 'left' : 'right';
      return 'top';
    }

    function getConnectionEntrySide(conn) {
      const fromEl = document.getElementById(conn.from);
      const toEl = document.getElementById(conn.to);
      if (!fromEl || !toEl) return 'top';

      const fromData = getShape(conn.from);
      if (fromData?.type === 'decision' && (conn.type === 'yes' || conn.type === 'no')) {
        const side = conn.type === 'yes' ? 'left' : 'right';
        return getDecisionEntrySide(fromEl, toEl, side);
      }

      const routeMode = routeModes.includes(conn.routeMode) ? conn.routeMode : 'auto';
      return chooseSides(fromEl, toEl, routeMode).entry;
    }

    function sortConnsBySourcePosition(conns, entrySide) {
      return conns.slice().sort((a, b) => {
        const aFrom = document.getElementById(a.from);
        const bFrom = document.getElementById(b.from);
        if (!aFrom || !bFrom) return a.id.localeCompare(b.id);
        const aCx = aFrom.offsetLeft + aFrom.offsetWidth / 2;
        const bCx = bFrom.offsetLeft + bFrom.offsetWidth / 2;
        const aCy = aFrom.offsetTop + aFrom.offsetHeight / 2;
        const bCy = bFrom.offsetTop + bFrom.offsetHeight / 2;
        if (entrySide === 'left' || entrySide === 'right') return aCy - bCy || aCx - bCx;
        return aCx - bCx || aCy - bCy;
      });
    }

    function getFanInOffset(conn, entrySide, toEl) {
      const incoming = state.connections
        .filter(c => c.to === conn.to && getConnectionEntrySide(c) === entrySide);
      const sortedIncoming = sortConnsBySourcePosition(incoming, entrySide);

      if (sortedIncoming.length <= 1) return 0;
      const idx = sortedIncoming.findIndex(c => c.id === conn.id);
      if (idx < 0) return 0;

      const slot = idx - (sortedIncoming.length - 1) / 2;
      const rawOffset = slot * 16;

      if (entrySide === 'top' || entrySide === 'bottom') {
        const max = Math.max(14, toEl.offsetWidth / 2 - 16);
        return Math.max(-max, Math.min(max, rawOffset));
      }
      const max = Math.max(12, toEl.offsetHeight / 2 - 14);
      return Math.max(-max, Math.min(max, rawOffset));
    }

    function applyEntryOffset(points, entrySide, offset, toEl) {
      if (!offset || !points || points.length < 2) return points;
      const out = points.map(point => ({ ...point }));
      const last = out.length - 1;

      if (entrySide === 'top' || entrySide === 'bottom') {
        const cx = toEl.offsetLeft + toEl.offsetWidth / 2;
        const max = Math.max(14, toEl.offsetWidth / 2 - 16);
        const shiftedX = Math.max(cx - max, Math.min(cx + max, out[last].x + offset));
        out[last].x = shiftedX;
        out[last - 1].x = shiftedX;
      } else {
        const cy = toEl.offsetTop + toEl.offsetHeight / 2;
        const max = Math.max(12, toEl.offsetHeight / 2 - 14);
        const shiftedY = Math.max(cy - max, Math.min(cy + max, out[last].y + offset));
        out[last].y = shiftedY;
        out[last - 1].y = shiftedY;
      }
      return out;
    }

    function buildMergeContext() {
      const groups = new Map();

      state.connections.forEach(conn => {
        if (conn.type) return;
        const fromEl = document.getElementById(conn.from);
        const toEl = document.getElementById(conn.to);
        if (!fromEl || !toEl) return;
        const entrySide = getConnectionEntrySide(conn);
        const key = `${conn.to}|${entrySide}`;
        if (!groups.has(key)) groups.set(key, { toEl, entrySide, conns: [] });
        groups.get(key).conns.push(conn);
      });

      const byConnId = {};
      groups.forEach(group => {
        if (group.conns.length < 2) return;
        const targetPt = getEdgePoints(group.toEl)[group.entrySide];
        const junction = { x: targetPt.x, y: targetPt.y };
        if (group.entrySide === 'top') junction.y -= mergeLead;
        if (group.entrySide === 'bottom') junction.y += mergeLead;
        if (group.entrySide === 'left') junction.x -= mergeLead;
        if (group.entrySide === 'right') junction.x += mergeLead;

        const sorted = sortConnsBySourcePosition(group.conns, group.entrySide);
        const primaryIdx = Math.floor((sorted.length - 1) / 2);
        sorted.forEach((conn, idx) => {
          byConnId[conn.id] = {
            isMerged: true,
            isPrimary: idx === primaryIdx,
            entrySide: group.entrySide,
            junction,
            targetPt,
          };
        });
      });

      return byConnId;
    }

    function offsetAlongSide(point, side, distance) {
      if (side === 'left') return { x: point.x - distance, y: point.y };
      if (side === 'right') return { x: point.x + distance, y: point.y };
      if (side === 'top') return { x: point.x, y: point.y - distance };
      return { x: point.x, y: point.y + distance };
    }

    function dedupePoints(points) {
      const out = [];
      points.forEach((point) => {
        const last = out[out.length - 1];
        if (!last || Math.abs(last.x - point.x) > 0.5 || Math.abs(last.y - point.y) > 0.5) {
          out.push({ x: point.x, y: point.y });
        }
      });
      return out;
    }

    function computeSmartConnection(fromEl, toEl, conn) {
      if (!obstacleRouter?.routeAroundObstacles) return null;
      const fromData = getShape(fromEl.id);
      const connType = conn?.type || null;

      let exitSide;
      let entrySide;
      if (fromData?.type === 'decision' && (connType === 'yes' || connType === 'no')) {
        // Honour the Yes/No exit sides even with obstacle-aware routing.
        exitSide = connType === 'yes' ? 'left' : 'right';
      } else {
        const sides = chooseSides(fromEl, toEl, 'auto');
        exitSide = sides.exit;
        entrySide = sides.entry;
      }
      const fromPt = getEdgePoints(fromEl)[exitSide];
      if (!entrySide) entrySide = chooseExitSideToPoint(toEl, fromPt, 'auto');
      const toPt = getEdgePoints(toEl)[entrySide];

      // Step out from the source and into the target along their sides so the
      // arrow can never double back through its own block, and route A* between
      // those stubs with ALL blocks (incl. source/target) treated as obstacles.
      const lead = 30;
      const leadOut = offsetAlongSide(fromPt, exitSide, lead);
      const leadIn = offsetAlongSide(toPt, entrySide, lead);
      const obstacles = (state?.shapes || [])
        .map(shape => document.getElementById(shape.id))
        .filter(Boolean)
        .map(el => {
          const box = domShapeToBox(el);
          // A diamond's connection tips stick out beyond its bounding box, so
          // grow decision obstacles to the diamond extent — otherwise an arrow
          // can clip the condition shape near its centre line.
          if (box.type === 'decision' && decisionVertexDistance) {
            const over = Math.max(0, decisionVertexDistance(el) - box.width / 2);
            return { left: box.left - over, top: box.top - over, width: box.width + over * 2, height: box.height + over * 2 };
          }
          return box;
        });

      const routed = obstacleRouter.routeAroundObstacles(
        { x: leadOut.x, y: leadOut.y },
        { x: leadIn.x, y: leadIn.y },
        obstacles,
        { margin: 24 }
      );
      if (!routed || routed.length < 2) return null;

      let pts = dedupePoints([fromPt, leadOut, ...routed, leadIn, toPt]);
      if (obstacleRouter.simplify) pts = obstacleRouter.simplify(pts);
      if (pts.length < 2) return null;
      pts[pts.length - 1].side = entrySide;
      return { d: pointsToPathD(pts), pts };
    }

    // Orthogonal elbow between two points. `axis` decides whether the first
    // sub-segment is horizontal ('h') or vertical ('v'); returns [] when the
    // points already share a row/column.
    function orthogonalElbow(prev, cur, axis) {
      const dx = Math.abs(prev.x - cur.x);
      const dy = Math.abs(prev.y - cur.y);
      if (dx <= 0.5 || dy <= 0.5) return [];
      return axis === 'h' ? [{ x: cur.x, y: prev.y }] : [{ x: prev.x, y: cur.y }];
    }

    function computeCustomConnection(fromEl, toEl, conn) {
      const wps = conn.waypoints.filter(p => p && Number.isFinite(p.x) && Number.isFinite(p.y));
      if (!wps.length) return null;
      const exit = chooseExitSideToPoint(fromEl, wps[0], 'auto');
      const fromPt = getEdgePoints(fromEl)[exit];
      const entry = chooseExitSideToPoint(toEl, wps[wps.length - 1], 'auto');
      const toPt = getEdgePoints(toEl)[entry];
      const guide = [
        { x: fromPt.x, y: fromPt.y },
        ...wps.map(p => ({ x: p.x, y: p.y })),
        { x: toPt.x, y: toPt.y },
      ];

      // Orient the first leg to leave along the exit side and the last leg to
      // arrive along the entry side, so the arrow meets blocks squarely rather
      // than sliding in along an edge. Middle legs default to horizontal-first.
      const pts = [{ x: guide[0].x, y: guide[0].y }];
      const last = guide.length - 1;
      for (let i = 1; i <= last; i++) {
        const prev = pts[pts.length - 1];
        const cur = guide[i];
        let axis = 'h';
        if (i === 1) axis = (exit === 'left' || exit === 'right') ? 'h' : 'v';
        else if (i === last) axis = (entry === 'left' || entry === 'right') ? 'v' : 'h';
        orthogonalElbow(prev, cur, axis).forEach(elbow => pts.push(elbow));
        pts.push({ x: cur.x, y: cur.y });
      }
      const orthoPts = dedupePoints(pts);
      orthoPts[orthoPts.length - 1].side = entry;
      return { d: pointsToPathD(orthoPts), pts: orthoPts };
    }

    function computeConnectionGeometry(fromEl, toEl, conn, mergeContext) {
      const connType = conn?.type || null;
      const fromData = getShape(fromEl.id);

      // Strategy priority is intentional: a manual route is the user's explicit
      // geometry; smart is the explicitly selected obstacle-aware mode; decision
      // branch semantics precede shared fan-in merging; default routing is last.
      // custom -> smart -> decision -> merge -> default
      if (conn?.isCustom && Array.isArray(conn.waypoints) && conn.waypoints.length) {
        const custom = computeCustomConnection(fromEl, toEl, conn);
        if (custom) return custom;
      }

      // Smart routing is checked before the decision Yes/No branch so that an
      // explicitly chosen "Розумний обхід" also applies to decision outputs.
      if (conn?.routeMode === 'smart') {
        const smart = computeSmartConnection(fromEl, toEl, conn);
        if (smart) return smart;
        onSmartRouteFailure?.(conn);
        // fall through to default routing when no clear obstacle-aware path
      }

      if (fromData?.type === 'decision') {
        if (connType === 'yes') return computeDecisionConnection(fromEl, toEl, 'left');
        if (connType === 'no') return computeDecisionConnection(fromEl, toEl, 'right');
      }

      const mergeMeta = mergeContext?.[conn.id];
      if (mergeMeta?.isMerged) {
        const routeMode = routeModes.includes(conn?.routeMode) ? conn.routeMode : 'auto';
        let pts = routeToPoint(fromEl, mergeMeta.junction, routeMode, mergeMeta.entrySide).pts;
        if (mergeMeta.isPrimary) {
          const last = pts[pts.length - 1];
          if (!last || last.x !== mergeMeta.targetPt.x || last.y !== mergeMeta.targetPt.y) {
            pts = pts.concat([{ x: mergeMeta.targetPt.x, y: mergeMeta.targetPt.y }]);
          }
        }
        return { d: pointsToPathD(pts), pts };
      }

      const routeMode = routeModes.includes(conn?.routeMode) ? conn.routeMode : 'auto';
      const routed = routeOrthogonal(fromEl, toEl, routeMode);
      const offset = conn ? getFanInOffset(conn, routed.entry, toEl) : 0;
      const pts = applyEntryOffset(routed.pts, routed.entry, offset, toEl);
      return { d: pointsToPathD(pts), pts };
    }

    return {
      buildMergeContext,
      computeConnectionGeometry,
      pointAlongPolyline,
      pointsToPathD,
    };
  }

  window.FlowchartsRouting = {
    createRouting,
  };
}());
