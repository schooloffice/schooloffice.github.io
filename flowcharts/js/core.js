(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
    return;
  }
  root.FlowchartCore = factory();
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const DEFAULT_BASE_COLORS = {
    'start-end': '#4caf50',
    'process': '#03a9f4',
    'decision': '#ff9800',
    'input-output': '#3f51b5',
    'subroutine': '#7b1fa2',
    'connector': '#546e7a',
  };

  const ROUTE_MODES = ['auto', 'vertical', 'horizontal', 'bypass-left', 'bypass-right'];
  const ROUTE_MODE_LABELS = {
    auto: 'Авто',
    vertical: 'Вертикально',
    horizontal: 'Горизонтально',
    'bypass-left': 'Обхід ліворуч',
    'bypass-right': 'Обхід праворуч',
  };
  const PROJECT_LIMITS = {
    maxShapes: 500,
    maxConnections: 1000,
    maxCoord: 4000,
    maxText: 200,
    maxLabel: 40,
  };
  const ALLOWED_SHAPE_TYPES = new Set(Object.keys(DEFAULT_BASE_COLORS));
  const SHAPE_ID_RE = /^shape-\d+$/;
  const CONN_ID_RE = /^conn-shape-\d+-shape-\d+(?:-(yes|no))?$/;
  const HEX_COLOR_RE = /^#[0-9a-f]{3,8}$/i;

  function clampNumber(value, min, max) {
    const num = Number(value);
    if (!Number.isFinite(num)) return min;
    return Math.max(min, Math.min(num, max));
  }

  function normalizeShapeType(type) {
    const normalized = String(type || 'process');
    return ALLOWED_SHAPE_TYPES.has(normalized) ? normalized : 'process';
  }

  function normalizeText(value, maxLength) {
    return String(value || '').slice(0, maxLength);
  }

  function normalizeShapeColor(value, type) {
    const color = String(value || '');
    return HEX_COLOR_RE.test(color) ? color : DEFAULT_BASE_COLORS[type];
  }

  function resolveConnectionLabel(conn) {
    if (!conn) return '';
    const customLabel = conn.label !== null && conn.label !== undefined ? String(conn.label).trim() : '';
    if (customLabel) return customLabel;
    if (conn.type === 'yes') return 'Так';
    if (conn.type === 'no') return 'Ні';
    return '';
  }

  function hasStartBlock(shapes) {
    return (shapes || []).some((shape) => {
      return shape.type === 'start-end' && String(shape.textRaw || '').trim().toLowerCase() === 'початок';
    });
  }

  function getDefaultText(type, shapes) {
    switch (type) {
      case 'start-end':
        return hasStartBlock(shapes) ? 'Кінець' : 'Початок';
      case 'process':
        return 'Дія';
      case 'decision':
        return 'Умова?';
      case 'input-output':
        return 'Ввід / Вивід';
      case 'subroutine':
        return 'Підпрограма';
      case 'connector':
        return 'A';
      default:
        return '';
    }
  }

  function smartWrapText(raw, type) {
    const text = String(raw || '').trim();
    if (!text) return '';

    const maxChars = (type === 'decision') ? 12 : (type === 'start-end') ? 16 : (type === 'connector') ? 3 : 18;
    const maxLines = (type === 'connector') ? 1 : 4;
    const words = text.split(/\s+/).filter(Boolean);
    const lines = [];
    let line = '';

    function pushLine(value) {
      if (value) lines.push(value);
    }

    function splitLongWord(word) {
      const parts = [];
      let rest = word;
      while (rest.length > maxChars) {
        let cut = maxChars - 1;
        if (rest.length - cut < 3) cut = rest.length - 3;
        if (cut < 1) break;
        parts.push(rest.slice(0, cut) + '-');
        rest = rest.slice(cut);
      }
      parts.push(rest);
      return parts;
    }

    for (const word of words) {
      const chunks = word.length > maxChars ? splitLongWord(word) : [word];
      for (const chunk of chunks) {
        if (!line) {
          line = chunk;
        } else if ((line.length + 1 + chunk.length) <= maxChars) {
          line += ' ' + chunk;
        } else {
          pushLine(line);
          line = chunk;
        }
        if (lines.length >= maxLines) break;
      }
      if (lines.length >= maxLines) break;
    }

    pushLine(line);

    if (lines.length > maxLines) lines.length = maxLines;
    const used = lines.join(' ').replace(/-/g, '');
    if (used.length < text.length) {
      lines[lines.length - 1] = lines[lines.length - 1].replace(/\s*…?$/, '') + '…';
    }
    return lines.join('\n');
  }

  function decisionVertexDistance(shape) {
    return (shape.width || 0) / Math.SQRT2;
  }

  function getEdgePoints(shape, outset) {
    const extra = typeof outset === 'number' ? outset : 2;
    const cx = shape.left + shape.width / 2;
    const cy = shape.top + shape.height / 2;

    if (shape.type === 'connector') {
      const r = Math.min(shape.width, shape.height) / 2;
      return {
        top: { x: cx, y: cy - r, side: 'top' },
        bottom: { x: cx, y: cy + r, side: 'bottom' },
        left: { x: cx - r, y: cy, side: 'left' },
        right: { x: cx + r, y: cy, side: 'right' },
      };
    }

    if (shape.type === 'decision') {
      const d = decisionVertexDistance(shape) + extra;
      return {
        top: { x: cx, y: cy - d, side: 'top' },
        bottom: { x: cx, y: cy + d, side: 'bottom' },
        left: { x: cx - d, y: cy, side: 'left' },
        right: { x: cx + d, y: cy, side: 'right' },
      };
    }

    const hw = shape.width / 2;
    const hh = shape.height / 2;
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

    if ((exitSide === 'bottom' && entrySide === 'top') || (exitSide === 'top' && entrySide === 'bottom')) {
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

    if ((exitSide === 'right' && entrySide === 'left') || (exitSide === 'left' && entrySide === 'right')) {
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

  function chooseSides(fromShape, toShape, routeMode) {
    const fcx = fromShape.left + fromShape.width / 2;
    const fcy = fromShape.top + fromShape.height / 2;
    const tcx = toShape.left + toShape.width / 2;
    const tcy = toShape.top + toShape.height / 2;
    const dx = tcx - fcx;
    const dy = tcy - fcy;

    if (routeMode === 'vertical') {
      return dy >= 0 ? { exit: 'bottom', entry: 'top' } : { exit: 'top', entry: 'bottom' };
    }
    if (routeMode === 'horizontal') {
      return dx >= 0 ? { exit: 'right', entry: 'left' } : { exit: 'left', entry: 'right' };
    }
    if (routeMode === 'bypass-left') {
      return { exit: 'left', entry: 'left' };
    }
    if (routeMode === 'bypass-right') {
      return { exit: 'right', entry: 'right' };
    }

    const fhw = fromShape.width / 2;
    const fhh = fromShape.height / 2;
    const thw = toShape.width / 2;
    const thh = toShape.height / 2;

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

  function bypassPath(fromShape, toShape, side) {
    const fromEdges = getEdgePoints(fromShape);
    const toEdges = getEdgePoints(toShape);
    const fromPt = side === 'left' ? fromEdges.left : fromEdges.right;
    const toPt = side === 'left' ? toEdges.left : toEdges.right;
    const margin = 48;
    const corridor = side === 'left'
      ? Math.min(fromEdges.left.x, toEdges.left.x) - margin
      : Math.max(fromEdges.right.x, toEdges.right.x) + margin;

    return {
      pts: [
        fromPt,
        { x: corridor, y: fromPt.y },
        { x: corridor, y: toPt.y },
        toPt,
      ],
      exit: side,
      entry: side,
    };
  }

  function routeOrthogonal(fromShape, toShape, routeMode) {
    if (routeMode === 'bypass-left') {
      return bypassPath(fromShape, toShape, 'left');
    }
    if (routeMode === 'bypass-right') {
      return bypassPath(fromShape, toShape, 'right');
    }

    const sides = chooseSides(fromShape, toShape, routeMode || 'auto');
    const fromEdges = getEdgePoints(fromShape);
    const toEdges = getEdgePoints(toShape);
    const pts = orthogonalPath(fromEdges[sides.exit], toEdges[sides.entry], sides.exit, sides.entry);
    return { pts, exit: sides.exit, entry: sides.entry };
  }

  function chooseExitSideToPoint(fromShape, toPoint, routeMode) {
    const cx = fromShape.left + fromShape.width / 2;
    const cy = fromShape.top + fromShape.height / 2;
    const dx = toPoint.x - cx;
    const dy = toPoint.y - cy;

    if (routeMode === 'vertical') return dy >= 0 ? 'bottom' : 'top';
    if (routeMode === 'horizontal') return dx >= 0 ? 'right' : 'left';
    if (routeMode === 'bypass-left') return 'left';
    if (routeMode === 'bypass-right') return 'right';
    return Math.abs(dy) >= Math.abs(dx)
      ? (dy >= 0 ? 'bottom' : 'top')
      : (dx >= 0 ? 'right' : 'left');
  }

  function routeToPoint(fromShape, toPoint, routeMode, entrySide) {
    const safeEntrySide = entrySide || 'top';
    const fromEdges = getEdgePoints(fromShape);
    const exit = chooseExitSideToPoint(fromShape, toPoint, routeMode || 'auto');
    const fromPt = fromEdges[exit];

    if (routeMode === 'bypass-left' || routeMode === 'bypass-right') {
      const side = routeMode === 'bypass-left' ? 'left' : 'right';
      const margin = 48;
      const corridor = side === 'left'
        ? Math.min(fromPt.x, toPoint.x) - margin
        : Math.max(fromPt.x, toPoint.x) + margin;

      return {
        pts: [
          fromPt,
          { x: corridor, y: fromPt.y },
          { x: corridor, y: toPoint.y },
          { x: toPoint.x, y: toPoint.y, side: safeEntrySide },
        ],
        exit,
        entry: safeEntrySide,
      };
    }

    const pts = orthogonalPath(fromPt, { x: toPoint.x, y: toPoint.y, side: safeEntrySide }, exit, safeEntrySide);
    return { pts, exit, entry: safeEntrySide };
  }

  function pointAlongPolyline(points, t) {
    if (!Array.isArray(points) || points.length === 0) return { x: 0, y: 0 };
    let total = 0;
    for (let i = 1; i < points.length; i++) {
      total += Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y);
    }
    if (total <= 0) return points[0];
    const target = total * t;
    let acc = 0;
    for (let i = 1; i < points.length; i++) {
      const a = points[i - 1];
      const b = points[i];
      const seg = Math.hypot(b.x - a.x, b.y - a.y);
      if (acc + seg >= target) {
        const ratio = (target - acc) / (seg || 1);
        return { x: a.x + (b.x - a.x) * ratio, y: a.y + (b.y - a.y) * ratio };
      }
      acc += seg;
    }
    return points[points.length - 1];
  }

  function getConnectionLabelPosition(points, connType) {
    if (!Array.isArray(points) || points.length === 0) return { x: 0, y: 0 };
    if (points.length === 1) return points[0];

    if (connType === 'yes' || connType === 'no') {
      const start = points[0];
      const next = points[1] || points[0];
      const dx = next.x - start.x;
      const dy = next.y - start.y;

      if (Math.abs(dx) >= Math.abs(dy)) {
        return {
          x: start.x + (dx < 0 ? -42 : 42),
          y: start.y - 8,
        };
      }

      return {
        x: start.x + (connType === 'yes' ? -26 : 26),
        y: start.y + (dy < 0 ? -28 : 28),
      };
    }

    return pointAlongPolyline(points, 0.5);
  }

  function resolveConnectionLabelOverlap(basePoint, connType, occupiedPoints) {
    const base = basePoint || { x: 0, y: 0 };
    const occupied = Array.isArray(occupiedPoints) ? occupiedPoints : [];
    const thresholdX = connType === 'yes' || connType === 'no' ? 38 : 44;
    const thresholdY = connType === 'yes' || connType === 'no' ? 28 : 24;
    const step = connType === 'yes' || connType === 'no' ? 24 : 18;
    const candidates = [{ x: base.x, y: base.y }];

    for (let i = 1; i <= 4; i++) {
      if (connType === 'yes' || connType === 'no') {
        candidates.push({ x: base.x, y: base.y - step * i });
        candidates.push({ x: base.x, y: base.y + step * i });
      } else {
        candidates.push({ x: base.x, y: base.y - step * i });
        candidates.push({ x: base.x, y: base.y + step * i });
        candidates.push({ x: base.x - step * i, y: base.y });
        candidates.push({ x: base.x + step * i, y: base.y });
      }
    }

    const overlaps = (candidate) => occupied.some((point) => {
      return Math.abs(point.x - candidate.x) < thresholdX && Math.abs(point.y - candidate.y) < thresholdY;
    });

    for (const candidate of candidates) {
      if (!overlaps(candidate)) return candidate;
    }
    return candidates[candidates.length - 1];
  }

  function getDecisionBranchRoute(fromShape, toShape, side, outset) {
    const safeSide = side === 'right' ? 'right' : 'left';
    const fromEdges = getEdgePoints(fromShape, outset);
    const toEdges = getEdgePoints(toShape);
    const fromPt = safeSide === 'right' ? fromEdges.right : fromEdges.left;
    const cx = fromShape.left + fromShape.width / 2;
    const cy = fromShape.top + fromShape.height / 2;
    const toCx = toShape.left + toShape.width / 2;
    const toCy = toShape.top + toShape.height / 2;
    const hDist = safeSide === 'right' ? toCx - cx : cx - toCx;
    const vDist = toCy - cy;

    let entry = 'top';
    if (vDist < -30) {
      // Looping back upward looks cleaner when the branch enters the side corridor.
      entry = safeSide;
    } else if (Math.abs(vDist) < 30 && hDist > 20) {
      entry = safeSide === 'right' ? 'left' : 'right';
    }

    const toPt = toEdges[entry];
    const margin = 72;
    let pts;

    if (entry === safeSide) {
      const corridor = safeSide === 'right'
        ? Math.max(fromPt.x, toPt.x) + margin
        : Math.min(fromPt.x, toPt.x) - margin;
      pts = [
        fromPt,
        { x: corridor, y: fromPt.y },
        { x: corridor, y: toPt.y },
        toPt,
      ];
    } else if (Math.abs(toPt.y - fromPt.y) < 4) {
      pts = [fromPt, toPt];
    } else if (
      (safeSide === 'right' && toPt.x > fromPt.x + 4) ||
      (safeSide === 'left' && toPt.x < fromPt.x - 4)
    ) {
      pts = [fromPt, { x: toPt.x, y: fromPt.y }, toPt];
    } else {
      const xOut = safeSide === 'right' ? fromPt.x + margin : fromPt.x - margin;
      pts = [fromPt, { x: xOut, y: fromPt.y }, { x: xOut, y: toPt.y }, toPt];
    }

    return { pts, exit: safeSide, entry };
  }

  function serializeProject(state, positionsById) {
    const positions = positionsById || {};
    return {
      version: 2,
      diagramTitle: String(state?.diagramTitle || ''),
      shapeCounter: Number(state?.shapeCounter || 0),
      lastShapeType: String(state?.lastShapeType || 'process'),
      snapEnabled: state?.snapEnabled !== undefined ? !!state.snapEnabled : true,
      baseColors: { ...DEFAULT_BASE_COLORS, ...(state?.baseColors || {}) },
      shapes: (state?.shapes || []).map((shape) => {
        const pos = positions[shape.id] || {};
        return {
          id: shape.id,
          type: shape.type,
          color: shape.color,
          textRaw: shape.textRaw,
          left: Number(pos.left ?? shape.left ?? 0),
          top: Number(pos.top ?? shape.top ?? 0),
        };
      }),
      connections: (state?.connections || []).map((conn) => ({
        id: conn.id,
        from: conn.from,
        to: conn.to,
        type: conn.type ?? null,
        routeMode: ROUTE_MODES.includes(conn.routeMode) ? conn.routeMode : 'auto',
        label: conn.label ?? null,
      })),
    };
  }

  function parseProject(raw) {
    const data = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (!data || typeof data !== 'object') throw new Error('Invalid project data.');

    const shapes = Array.isArray(data.shapes) ? data.shapes : [];
    const connections = Array.isArray(data.connections) ? data.connections : [];
    if (shapes.length > PROJECT_LIMITS.maxShapes) throw new Error('Too many shapes in project.');
    if (connections.length > PROJECT_LIMITS.maxConnections) throw new Error('Too many connections in project.');

    const parsedShapes = shapes.map((shape) => {
      const type = normalizeShapeType(shape.type);
      return {
        id: SHAPE_ID_RE.test(String(shape.id || '')) ? String(shape.id) : '',
        type,
        color: normalizeShapeColor(shape.color, type),
        textRaw: normalizeText(shape.textRaw, PROJECT_LIMITS.maxText),
        left: clampNumber(shape.left, 0, PROJECT_LIMITS.maxCoord),
        top: clampNumber(shape.top, 0, PROJECT_LIMITS.maxCoord),
      };
    }).filter((shape) => shape.id);

    const knownShapeIds = new Set(parsedShapes.map((shape) => shape.id));
    const parsedConnections = connections.map((conn) => ({
      id: CONN_ID_RE.test(String(conn.id || '')) ? String(conn.id) : '',
      from: SHAPE_ID_RE.test(String(conn.from || '')) ? String(conn.from) : '',
      to: SHAPE_ID_RE.test(String(conn.to || '')) ? String(conn.to) : '',
      type: conn.type === 'yes' || conn.type === 'no' ? conn.type : null,
      routeMode: ROUTE_MODES.includes(conn.routeMode) ? conn.routeMode : 'auto',
      label: conn.label === null || conn.label === undefined ? null : normalizeText(conn.label, PROJECT_LIMITS.maxLabel),
    })).filter((conn) => {
      return conn.id && conn.from && conn.to && knownShapeIds.has(conn.from) && knownShapeIds.has(conn.to);
    });

    return {
      version: Number(data.version || 2),
      diagramTitle: String(data.diagramTitle || ''),
      shapeCounter: Number(data.shapeCounter || 0),
      lastShapeType: normalizeShapeType(data.lastShapeType || 'process'),
      snapEnabled: data.snapEnabled !== undefined ? !!data.snapEnabled : true,
      baseColors: { ...DEFAULT_BASE_COLORS, ...(data.baseColors || {}) },
      shapes: parsedShapes,
      connections: parsedConnections,
    };
  }

  return {
    DEFAULT_BASE_COLORS,
    ROUTE_MODES,
    ROUTE_MODE_LABELS,
    decisionVertexDistance,
    getDefaultText,
    getEdgePoints,
    orthogonalPath,
    parseProject,
    chooseExitSideToPoint,
    getDecisionBranchRoute,
    routeOrthogonal,
    routeToPoint,
    getConnectionLabelPosition,
    resolveConnectionLabelOverlap,
    pointAlongPolyline,
    resolveConnectionLabel,
    serializeProject,
    chooseSides,
    smartWrapText,
  };
}));

