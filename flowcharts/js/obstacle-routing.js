(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
    return;
  }
  root.FlowchartsObstacleRouting = factory();
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const EPS = 0.5;

  function uniqueSorted(values) {
    const sorted = values.slice().sort((a, b) => a - b);
    const out = [];
    for (const value of sorted) {
      if (out.length === 0 || Math.abs(out[out.length - 1] - value) > EPS) out.push(value);
    }
    return out;
  }

  function inflate(rect, margin) {
    return {
      left: rect.left - margin,
      top: rect.top - margin,
      right: rect.left + rect.width + margin,
      bottom: rect.top + rect.height + margin,
    };
  }

  // Does an axis-aligned segment pass through a rectangle's interior?
  function segmentHitsRect(ax, ay, bx, by, rect) {
    if (Math.abs(ay - by) < EPS) {
      // horizontal
      const y = ay;
      if (y <= rect.top + EPS || y >= rect.bottom - EPS) return false;
      const minX = Math.min(ax, bx);
      const maxX = Math.max(ax, bx);
      return maxX > rect.left + EPS && minX < rect.right - EPS;
    }
    if (Math.abs(ax - bx) < EPS) {
      // vertical
      const x = ax;
      if (x <= rect.left + EPS || x >= rect.right - EPS) return false;
      const minY = Math.min(ay, by);
      const maxY = Math.max(ay, by);
      return maxY > rect.top + EPS && minY < rect.bottom - EPS;
    }
    return false;
  }

  function segmentBlocked(ax, ay, bx, by, rects) {
    for (const rect of rects) {
      if (segmentHitsRect(ax, ay, bx, by, rect)) return true;
    }
    return false;
  }

  function pathLength(points) {
    let total = 0;
    for (let i = 1; i < points.length; i++) {
      total += Math.abs(points[i].x - points[i - 1].x) + Math.abs(points[i].y - points[i - 1].y);
    }
    return total;
  }

  // Safe coarse fallback for diagrams whose detailed visibility grid is too
  // large. It routes around the outside of every inflated obstacle instead of
  // silently returning control to a route that may cross blocks.
  function routeAroundOuterBounds(start, goal, rects) {
    if (!rects.length) return simplify([start, { x: goal.x, y: start.y }, goal]);

    const minX = Math.min(...rects.map(rect => rect.left));
    const minY = Math.min(...rects.map(rect => rect.top));
    const maxX = Math.max(...rects.map(rect => rect.right));
    const maxY = Math.max(...rects.map(rect => rect.bottom));
    const candidates = [
      [start, { x: start.x, y: minY }, { x: goal.x, y: minY }, goal],
      [start, { x: start.x, y: maxY }, { x: goal.x, y: maxY }, goal],
      [start, { x: minX, y: start.y }, { x: minX, y: goal.y }, goal],
      [start, { x: maxX, y: start.y }, { x: maxX, y: goal.y }, goal],
    ];

    const clear = candidates
      .map(simplify)
      .filter(points => {
        for (let i = 1; i < points.length; i++) {
          if (segmentBlocked(points[i - 1].x, points[i - 1].y, points[i].x, points[i].y, rects)) return false;
        }
        return true;
      })
      .sort((a, b) => pathLength(a) - pathLength(b));

    return clear[0] || null;
  }

  function simplify(points) {
    if (points.length <= 2) return points;
    const out = [points[0]];
    for (let i = 1; i < points.length - 1; i++) {
      const prev = out[out.length - 1];
      const cur = points[i];
      const next = points[i + 1];
      const collinearX = Math.abs(prev.x - cur.x) < EPS && Math.abs(cur.x - next.x) < EPS;
      const collinearY = Math.abs(prev.y - cur.y) < EPS && Math.abs(cur.y - next.y) < EPS;
      if (collinearX || collinearY) continue;
      out.push(cur);
    }
    out.push(points[points.length - 1]);
    return out;
  }

  // Orthogonal route from `start` to `goal` that avoids the given obstacle
  // rectangles. Builds a graph over the candidate grid lines (rectangle edges
  // plus endpoints) and runs A* with a turn penalty, mirroring the visibility
  // approach used by good flowchart routers. Returns an array of points, or
  // null when no clear route exists (caller should fall back).
  function routeAroundObstacles(start, goal, obstacles, opts) {
    const options = opts || {};
    const margin = typeof options.margin === 'number' ? options.margin : 24;
    const turnPenalty = typeof options.turnPenalty === 'number' ? options.turnPenalty : 30;
    const maxNodes = typeof options.maxNodes === 'number' ? options.maxNodes : 2500;

    const rects = (obstacles || []).map((rect) => inflate(rect, margin));

    const xs = uniqueSorted([
      start.x, goal.x,
      ...rects.flatMap((rect) => [rect.left, rect.right]),
    ]);
    const ys = uniqueSorted([
      start.y, goal.y,
      ...rects.flatMap((rect) => [rect.top, rect.bottom]),
    ]);

    if (xs.length * ys.length > maxNodes) return routeAroundOuterBounds(start, goal, rects);

    const xIndex = new Map(xs.map((value, idx) => [idx, value]));
    const yIndex = new Map(ys.map((value, idx) => [idx, value]));
    const colOf = (value) => xs.findIndex((candidate) => Math.abs(candidate - value) <= EPS);
    const rowOf = (value) => ys.findIndex((candidate) => Math.abs(candidate - value) <= EPS);

    const startCol = colOf(start.x);
    const startRow = rowOf(start.y);
    const goalCol = colOf(goal.x);
    const goalRow = rowOf(goal.y);
    if (startCol < 0 || startRow < 0 || goalCol < 0 || goalRow < 0) return null;

    const key = (c, r) => `${c},${r}`;
    const startKey = key(startCol, startRow);
    const goalKey = key(goalCol, goalRow);

    const gScore = new Map([[startKey, 0]]);
    const cameFrom = new Map();
    const dirTo = new Map(); // 'h' | 'v' direction used to reach the node
    const open = [{ c: startCol, r: startRow, f: 0 }];

    const heuristic = (c, r) => Math.abs(xIndex.get(c) - goal.x) + Math.abs(yIndex.get(r) - goal.y);

    let found = false;
    while (open.length) {
      let bestIdx = 0;
      for (let i = 1; i < open.length; i++) {
        if (open[i].f < open[bestIdx].f) bestIdx = i;
      }
      const current = open.splice(bestIdx, 1)[0];
      const curKey = key(current.c, current.r);
      if (curKey === goalKey) { found = true; break; }

      const neighbors = [
        { c: current.c + 1, r: current.r, dir: 'h' },
        { c: current.c - 1, r: current.r, dir: 'h' },
        { c: current.c, r: current.r + 1, dir: 'v' },
        { c: current.c, r: current.r - 1, dir: 'v' },
      ];

      for (const next of neighbors) {
        if (next.c < 0 || next.c >= xs.length || next.r < 0 || next.r >= ys.length) continue;
        const ax = xIndex.get(current.c);
        const ay = yIndex.get(current.r);
        const bx = xIndex.get(next.c);
        const by = yIndex.get(next.r);
        if (segmentBlocked(ax, ay, bx, by, rects)) continue;

        const stepLen = Math.abs(bx - ax) + Math.abs(by - ay);
        const prevDir = dirTo.get(curKey);
        const turnCost = prevDir && prevDir !== next.dir ? turnPenalty : 0;
        const tentative = (gScore.get(curKey) ?? Infinity) + stepLen + turnCost;
        const nextKey = key(next.c, next.r);

        if (tentative < (gScore.get(nextKey) ?? Infinity)) {
          cameFrom.set(nextKey, curKey);
          dirTo.set(nextKey, next.dir);
          gScore.set(nextKey, tentative);
          open.push({ c: next.c, r: next.r, f: tentative + heuristic(next.c, next.r) });
        }
      }
    }

    if (!found) return routeAroundOuterBounds(start, goal, rects);

    const path = [];
    let k = goalKey;
    while (k) {
      const [c, r] = k.split(',').map(Number);
      path.push({ x: xIndex.get(c), y: yIndex.get(r) });
      k = cameFrom.get(k);
    }
    path.reverse();
    return simplify(path);
  }

  return {
    routeAroundObstacles,
    // exposed for testing
    segmentHitsRect,
    simplify,
    routeAroundOuterBounds,
  };
}));
