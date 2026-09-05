'use strict';
/* ui/page.js — геометрія сторінки: розмір паперу, поля, лінійка */

const ArtPage = (() => {
  // Сторінка рахується в сантиметрах, а верстка — у пікселях при 96 dpi.
  const CM_TO_PX = 96 / 2.54;
  const MIN_MARGIN_CM = 0.5;
  const MIN_CONTENT_CM = 3;
  const STEP_CM = 0.1;

  const SIZES = {
    a4: { label: 'A4 (21 × 29,7 см)', width: 21, height: 29.7 },
    a5: { label: 'A5 (14,8 × 21 см)', width: 14.8, height: 21 },
    letter: { label: 'Letter (21,6 × 27,9 см)', width: 21.6, height: 27.9 }
  };

  const DEFAULT_MARGINS = { top: 2, right: 1.5, bottom: 2, left: 3 };
  const SIDES = ['top', 'bottom', 'left', 'right'];
  // Скільки разів і як часто чекати на першу розкладку сторінки й лінійки
  // (див. updateRuler): ~3 секунди, після чого припиняємо.
  const RULER_MAX_RETRIES = 25;
  const RULER_RETRY_MS = 120;

  let _ruler = null;
  let _track = null;
  let _ticks = null;
  let _drag = null;
  let _rulerFrame = 0;
  let _rulerTimer = 0;
  let _rulerRetries = 0;

  function init() {
    _ruler = document.getElementById('pageRuler');
    _track = document.getElementById('rulerTrack');
    _ticks = document.getElementById('rulerTicks');

    ArtState.on('change:pageSize', () => apply());
    ArtState.on('change:orientation', () => apply());
    ArtState.on('change:margins', () => apply());
    ArtState.on('change:zoom', () => scheduleRulerUpdate());

    document.querySelector('.editor-scroll')?.addEventListener('scroll', scheduleRulerUpdate, { passive: true });
    window.addEventListener('resize', scheduleRulerUpdate);

    _bindRulerHandles();
    _bindDialog();
    apply({ repaginate: false });
  }

  function pageSizeCm() {
    const size = SIZES[ArtState.get('pageSize')] || SIZES.a4;
    const landscape = ArtState.get('orientation') === 'landscape';
    return {
      width: landscape ? size.height : size.width,
      height: landscape ? size.width : size.height
    };
  }

  function margins() {
    return Object.assign({}, DEFAULT_MARGINS, ArtState.get('margins') || {});
  }

  function apply(options = {}) {
    const wrap = document.querySelector('.pages-wrap');
    if (!wrap) return;

    const size = pageSizeCm();
    const m = margins();
    wrap.style.setProperty('--page-width', Math.round(size.width * CM_TO_PX) + 'px');
    wrap.style.setProperty('--page-height', Math.round(size.height * CM_TO_PX) + 'px');
    wrap.style.setProperty('--page-pad-top', Math.round(m.top * CM_TO_PX) + 'px');
    wrap.style.setProperty('--page-pad-right', Math.round(m.right * CM_TO_PX) + 'px');
    wrap.style.setProperty('--page-pad-bottom', Math.round(m.bottom * CM_TO_PX) + 'px');
    wrap.style.setProperty('--page-pad-left', Math.round(m.left * CM_TO_PX) + 'px');
    _updatePrintStyle(size, m);

    if (options.repaginate !== false) ArtEditor.refreshLayout?.();
    scheduleRulerUpdate();
  }

  function setMargins(next, options = {}) {
    const size = pageSizeCm();
    const current = margins();
    const merged = Object.assign({}, current, next);
    const clamped = {
      top: _clamp(merged.top, size.height - MIN_CONTENT_CM - merged.bottom),
      bottom: _clamp(merged.bottom, size.height - MIN_CONTENT_CM - merged.top),
      left: _clamp(merged.left, size.width - MIN_CONTENT_CM - merged.right),
      right: _clamp(merged.right, size.width - MIN_CONTENT_CM - merged.left)
    };
    ArtState.set('margins', clamped);
    if (options.repaginate === false) apply({ repaginate: false });
    return clamped;
  }

  function resetMargins() { setMargins(Object.assign({}, DEFAULT_MARGINS)); }

  // ── Лінійка ─────────────────────────────────────────────────────────────
  function scheduleRulerUpdate() {
    cancelAnimationFrame(_rulerFrame);
    clearTimeout(_rulerTimer);
    // rAF дає кадр саме тоді, коли браузер малює, — це правильний момент для
    // вимірювання. Але кадру може не бути взагалі: фонова вкладка, згорнуте
    // вікно, headless-прогін у CI. Тому дублюємо планування таймером, інакше
    // лінійка мовчки лишається несинхронізованою.
    _rulerFrame = requestAnimationFrame(updateRuler);
    _rulerTimer = setTimeout(updateRuler, RULER_RETRY_MS);
  }

  function updateRuler() {
    cancelAnimationFrame(_rulerFrame);
    clearTimeout(_rulerTimer);
    if (!_ruler || !_track) return;
    const page = document.querySelector('.page');
    const host = _ruler.getBoundingClientRect();
    if (!page || !host.width) {
      // Оновлення після init() могло статися ще до того, як з'явиться перша
      // `.page` або відбудеться перша розкладка лінійки. Раніше ми просто
      // виходили — і більше ніхто не планував спробу, бо на свіжому документі
      // немає ні scroll, ні resize, ні зміни стану. Лінійка так і лишалася з
      // розміткою за замовчуванням. Тому пробуємо ще кілька разів, але не
      // крутимо цикл вічно: на вузьких екранах `.ruler` — display: none, і
      // нульова ширина там є нормою, а не гонкою.
      if (_rulerRetries < RULER_MAX_RETRIES) {
        _rulerRetries += 1;
        scheduleRulerUpdate();
      }
      return;
    }

    _rulerRetries = 0;

    const rect = page.getBoundingClientRect();
    const size = pageSizeCm();
    const pxPerCm = rect.width / size.width;
    const m = margins();

    _track.style.left = Math.round(rect.left - host.left) + 'px';
    _track.style.width = Math.round(rect.width) + 'px';
    _track.style.setProperty('--margin-left', Math.round(m.left * pxPerCm) + 'px');
    _track.style.setProperty('--margin-right', Math.round(m.right * pxPerCm) + 'px');

    _renderTicks(size.width, pxPerCm, m.left);
    _updateHandle('left', m.left, size.width - m.right - MIN_CONTENT_CM);
    _updateHandle('right', m.right, size.width - m.left - MIN_CONTENT_CM);
  }

  function _renderTicks(widthCm, pxPerCm, leftMarginCm) {
    if (!_ticks) return;
    const total = Math.floor(widthCm);
    if (_ticks.childElementCount !== total + 1) {
      _ticks.innerHTML = '';
      for (let cm = 0; cm <= total; cm += 1) {
        const tick = document.createElement('span');
        tick.className = 'ruler-tick';
        _ticks.appendChild(tick);
      }
    }
    [..._ticks.children].forEach((tick, cm) => {
      tick.style.left = Math.round(cm * pxPerCm) + 'px';
      // Нумерація йде від лівого поля — так само, як у Word і Docs.
      const label = Math.abs(Math.round(cm - leftMarginCm));
      tick.textContent = label > 0 ? String(label) : '';
    });
  }

  function _updateHandle(side, valueCm, maxCm) {
    const handle = _track && _track.querySelector('[data-ruler-handle="' + side + '"]');
    if (!handle) return;
    handle.setAttribute('aria-valuenow', valueCm.toFixed(1));
    handle.setAttribute('aria-valuemin', String(MIN_MARGIN_CM));
    handle.setAttribute('aria-valuemax', Math.max(MIN_MARGIN_CM, maxCm).toFixed(1));
    handle.setAttribute('aria-valuetext', valueCm.toFixed(1) + ' см');
  }

  function _bindRulerHandles() {
    if (!_track) return;

    _track.querySelectorAll('[data-ruler-handle]').forEach(handle => {
      handle.addEventListener('pointerdown', event => {
        event.preventDefault();
        handle.focus();
        handle.setPointerCapture?.(event.pointerId);
        _drag = { side: handle.dataset.rulerHandle };
      });

      handle.addEventListener('keydown', event => {
        const side = handle.dataset.rulerHandle;
        const step = event.shiftKey ? 0.5 : STEP_CM;
        const current = margins()[side];
        if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') {
          event.preventDefault();
          _setSide(side, current + (side === 'left' ? -step : step));
        } else if (event.key === 'ArrowRight' || event.key === 'ArrowUp') {
          event.preventDefault();
          _setSide(side, current + (side === 'left' ? step : -step));
        } else if (event.key === 'Home') {
          event.preventDefault();
          _setSide(side, DEFAULT_MARGINS[side]);
        }
      });
    });

    document.addEventListener('pointermove', event => {
      if (!_drag) return;
      const page = document.querySelector('.page');
      if (!page) return;
      const rect = page.getBoundingClientRect();
      const size = pageSizeCm();
      const pxPerCm = rect.width / size.width;
      const value = _drag.side === 'left'
        ? (event.clientX - rect.left) / pxPerCm
        : (rect.right - event.clientX) / pxPerCm;
      // Під час перетягування лише перемальовуємо поля; повне перекомпонування
      // документа робимо один раз, коли маркер відпущено.
      setMargins({ [_drag.side]: _round(value) }, { repaginate: false });
    });

    document.addEventListener('pointerup', () => {
      if (!_drag) return;
      _drag = null;
      apply();
      ArtHistory.pushNow?.();
    });
  }

  function _setSide(side, value) {
    const next = {};
    next[side] = _round(value);
    setMargins(next);
    ArtHistory.pushNow?.();
  }

  // ── Діалог «Налаштування сторінки» ──────────────────────────────────────
  function openSetup() {
    const form = document.getElementById('pageSetupForm');
    if (!form) return;

    const m = margins();
    form.querySelectorAll('[name="pageOrientation"]').forEach(input => {
      input.checked = input.value === ArtState.get('orientation');
    });

    const sizeSelect = document.getElementById('pageSetupSize');
    if (sizeSelect) {
      if (!sizeSelect.options.length) {
        Object.keys(SIZES).forEach(key => {
          const option = document.createElement('option');
          option.value = key;
          option.textContent = SIZES[key].label;
          sizeSelect.appendChild(option);
        });
      }
      sizeSelect.value = ArtState.get('pageSize');
    }

    SIDES.forEach(side => {
      const input = _marginInput(side);
      if (input) input.value = m[side].toFixed(1);
    });

    ArtModals.open('modalPageSetup');
  }

  function applySetupForm() {
    const form = document.getElementById('pageSetupForm');
    if (!form) return;

    const orientation = form.querySelector('[name="pageOrientation"]:checked')?.value || 'portrait';
    const pageSize = document.getElementById('pageSetupSize')?.value || 'a4';
    const current = margins();
    const next = {};
    SIDES.forEach(side => {
      const raw = (_marginInput(side)?.value || '').replace(',', '.');
      const value = parseFloat(raw);
      next[side] = Number.isFinite(value) ? value : current[side];
    });

    ArtState.set('pageSize', pageSize);
    ArtState.set('orientation', orientation);
    setMargins(next);
    ArtModals.close('modalPageSetup');
    ArtHistory.pushNow?.();
  }

  function _marginInput(side) {
    return document.getElementById('pageMargin' + side[0].toUpperCase() + side.slice(1));
  }

  function _bindDialog() {
    document.getElementById('pageSetupForm')?.addEventListener('submit', event => {
      event.preventDefault();
      applySetupForm();
    });
    document.querySelector('[data-page-setup-reset]')?.addEventListener('click', () => {
      SIDES.forEach(side => {
        const input = _marginInput(side);
        if (input) input.value = DEFAULT_MARGINS[side].toFixed(1);
      });
    });
  }

  function _clamp(value, max) {
    const safeMax = Math.max(MIN_MARGIN_CM, max);
    const numeric = Number(value);
    const safe = Number.isFinite(numeric) ? numeric : MIN_MARGIN_CM;
    return _round(Math.min(safeMax, Math.max(MIN_MARGIN_CM, safe)));
  }

  function _round(value) { return Math.round(value * 10) / 10; }

  function _updatePrintStyle(size, m) {
    let style = document.getElementById('pagePrintGeometry');
    if (!style) {
      style = document.createElement('style');
      style.id = 'pagePrintGeometry';
      document.head.appendChild(style);
    }
    style.textContent = `@page { size: ${size.width}cm ${size.height}cm; margin: ${m.top}cm ${m.right}cm ${m.bottom}cm ${m.left}cm; }`;
  }

  return {
    init, apply, openSetup, applySetupForm, setMargins, resetMargins,
    updateRuler, margins, pageSizeCm, SIZES, DEFAULT_MARGINS
  };
})();
