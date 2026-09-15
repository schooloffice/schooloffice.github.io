(function () {
  'use strict';

  const ALIGN_MODES = ['left', 'center', 'right', 'top', 'middle', 'bottom'];
  const DISTRIBUTE_MODES = ['distribute-horizontal', 'distribute-vertical'];
  const HORIZONTAL_MODES = new Set(['left', 'center', 'right', 'distribute-horizontal']);
  const INPUT_OUTPUT_SKEW = Math.tan(20 * Math.PI / 180);

  const MODE_MESSAGES = {
    left: 'Блоки вирівняно ліворуч.',
    center: 'Блоки вирівняно по центру.',
    right: 'Блоки вирівняно праворуч.',
    top: 'Блоки вирівняно вгору.',
    middle: 'Блоки вирівняно посередині.',
    bottom: 'Блоки вирівняно вниз.',
    'distribute-horizontal': 'Блоки розподілено по горизонталі.',
    'distribute-vertical': 'Блоки розподілено по вертикалі.',
  };

  // Видимі межі блока. Ромб — повернутий на 45° квадрат, тож виходить за DOM-прямокутник;
  // паралелограм скошено на 20°. Вирівнювання йде за тим, що бачить учень, як і fit-to-view.
  function visualBox(box, decisionVertexDistance) {
    const cx = box.left + box.width / 2;
    const cy = box.top + box.height / 2;
    if (box.type === 'decision') {
      const d = decisionVertexDistance ? decisionVertexDistance(box) : box.width / Math.SQRT2;
      return { minX: cx - d, maxX: cx + d, minY: cy - d, maxY: cy + d };
    }
    if (box.type === 'input-output') {
      const skew = Math.abs(INPUT_OUTPUT_SKEW * box.height / 2);
      return { minX: box.left - skew, maxX: box.left + box.width + skew, minY: box.top, maxY: box.top + box.height };
    }
    return { minX: box.left, maxX: box.left + box.width, minY: box.top, maxY: box.top + box.height };
  }

  function minimumCount(mode) {
    return DISTRIBUTE_MODES.includes(mode) ? 3 : 2;
  }

  // Нові позиції {id, left, top} лише для блоків, що зсуваються; null — невідомий режим або
  // замалий вибір. Кожен режим змінює одну вісь. Вирівнювання — до спільного краю чи центру
  // рамки вибору; розподіл лишає крайні блоки на місці й робить рівні проміжки між краями.
  // Позиції округлено до пікселя й не менші за 0; прив'язка до сітки не застосовується.
  function computeArrangement(boxes, mode, decisionVertexDistance) {
    if (!ALIGN_MODES.includes(mode) && !DISTRIBUTE_MODES.includes(mode)) return null;
    const items = (boxes || [])
      .filter((box) => box && box.id && Number.isFinite(box.left) && Number.isFinite(box.top))
      .map((box) => ({ box, visual: visualBox(box, decisionVertexDistance) }));
    if (items.length < minimumCount(mode)) return null;

    const horizontal = HORIZONTAL_MODES.has(mode);
    const lo = horizontal ? 'minX' : 'minY';
    const hi = horizontal ? 'maxX' : 'maxY';
    const deltas = new Map();

    if (ALIGN_MODES.includes(mode)) {
      const min = Math.min(...items.map((item) => item.visual[lo]));
      const max = Math.max(...items.map((item) => item.visual[hi]));
      items.forEach(({ box, visual }) => {
        let delta;
        if (mode === 'left' || mode === 'top') delta = min - visual[lo];
        else if (mode === 'right' || mode === 'bottom') delta = max - visual[hi];
        else delta = (min + max) / 2 - (visual[lo] + visual[hi]) / 2;
        deltas.set(box.id, delta);
      });
    } else {
      const sorted = [...items].sort((a, b) => ((a.visual[lo] + a.visual[hi]) - (b.visual[lo] + b.visual[hi]))
        || String(a.box.id).localeCompare(String(b.box.id)));
      const first = sorted[0].visual;
      const last = sorted[sorted.length - 1].visual;
      const sizes = sorted.reduce((sum, item) => sum + (item.visual[hi] - item.visual[lo]), 0);
      const gap = ((last[hi] - first[lo]) - sizes) / (sorted.length - 1);
      let cursor = first[lo];
      sorted.forEach((item) => {
        deltas.set(item.box.id, cursor - item.visual[lo]);
        cursor += (item.visual[hi] - item.visual[lo]) + gap;
      });
    }

    const moves = [];
    items.forEach(({ box }) => {
      const delta = deltas.get(box.id) || 0;
      const left = horizontal ? Math.max(0, Math.round(box.left + delta)) : box.left;
      const top = horizontal ? box.top : Math.max(0, Math.round(box.top + delta));
      if (left !== box.left || top !== box.top) moves.push({ id: box.id, left, top });
    });
    return moves;
  }

  function createShapeArrangeController(options) {
    const {
      getSelectedShapes,
      getShapeType,
      decisionVertexDistance,
      saveSnapshot,
      updateConnectionsForShape,
      updateHandleGroup,
      scheduleRefresh,
      announce,
    } = options || {};

    function toBox(el) {
      return {
        id: el.id,
        type: getShapeType ? getShapeType(el) : 'process',
        left: el.offsetLeft,
        top: el.offsetTop,
        width: el.offsetWidth,
        height: el.offsetHeight,
      };
    }

    // Одна дія — один крок undo: знімок береться лише тоді, коли хоч один блок справді зсувається.
    function arrangeSelected(mode) {
      const selected = (getSelectedShapes?.() || []).filter((el) => el && el.isConnected);
      const needed = minimumCount(mode);
      if (selected.length < needed) {
        announce?.(needed === 3
          ? 'Для розподілу вибери щонайменше 3 блоки (Shift+клік або Ctrl+A).'
          : 'Для вирівнювання вибери щонайменше 2 блоки (Shift+клік або Ctrl+A).', 'selection');
        return { moved: 0, reason: 'selection' };
      }
      const moves = computeArrangement(selected.map(toBox), mode, decisionVertexDistance);
      if (!moves) return { moved: 0, reason: 'mode' };
      if (!moves.length) {
        announce?.('Вибрані блоки вже розташовані так.');
        return { moved: 0, reason: 'unchanged' };
      }

      saveSnapshot?.();
      const byId = new Map(selected.map((el) => [el.id, el]));
      moves.forEach((move) => {
        const el = byId.get(move.id);
        el.style.left = `${move.left}px`;
        el.style.top = `${move.top}px`;
      });
      moves.forEach((move) => {
        updateConnectionsForShape?.(move.id);
        updateHandleGroup?.(move.id);
      });
      scheduleRefresh?.();
      announce?.(MODE_MESSAGES[mode]);
      return { moved: moves.length, reason: null };
    }

    return {
      arrangeSelected,
    };
  }

  window.FlowchartsShapeArrange = {
    ALIGN_MODES,
    DISTRIBUTE_MODES,
    visualBox,
    minimumCount,
    computeArrangement,
    createShapeArrangeController,
  };
})();
