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
  // Розрив розділу, до якого застосовується відкритий діалог (null — перший розділ, тобто документ).
  let _setupTarget = null;
  let _setupSettings = null;

  function init() {
    _ruler = document.getElementById('pageRuler');
    _track = document.getElementById('rulerTrack');
    _ticks = document.getElementById('rulerTicks');

    ArtState.on('change:pageSize', () => apply());
    ArtState.on('change:orientation', () => apply());
    ArtState.on('change:margins', () => apply());
    // Колонтитули лежать у полях аркуша й не змінюють місця для тексту — без перекомпонування.
    ArtState.on('change:headerFooter', () => apply({ repaginate: false }));
    ArtState.on('change:zoom', () => scheduleRulerUpdate());

    document.querySelector('.editor-scroll')?.addEventListener('scroll', scheduleRulerUpdate, { passive: true });
    window.addEventListener('resize', scheduleRulerUpdate);
    // Лінійка показує поля розділу, у якому каретка.
    document.addEventListener('selectionchange', scheduleRulerUpdate);

    _bindRulerHandles();
    _bindDialog();
    _bindHeaderFooterDialog();
    apply({ repaginate: false });
  }

  function _sizeCm(pageSize, orientation) {
    const size = SIZES[pageSize] || SIZES.a4;
    const landscape = orientation === 'landscape';
    return {
      width: landscape ? size.height : size.width,
      height: landscape ? size.width : size.height
    };
  }

  function pageSizeCm() {
    return _sizeCm(ArtState.get('pageSize'), ArtState.get('orientation'));
  }

  function margins() {
    return Object.assign({}, DEFAULT_MARGINS, ArtState.get('margins') || {});
  }

  // Налаштування першого розділу — це налаштування документа.
  function documentSettings() {
    return {
      orientation: ArtState.get('orientation') === 'landscape' ? 'landscape' : 'portrait',
      pageSize: Object.prototype.hasOwnProperty.call(SIZES, ArtState.get('pageSize')) ? ArtState.get('pageSize') : 'a4',
      margins: margins()
    };
  }

  // Орієнтація, розмір паперу й поля з недовіреного джерела (атрибут розділу у файлі чи
  // чернетці): невідоме береться з fallback, поля обмежуються так само, як у діалозі.
  function normalizeSettings(value = {}, fallback = documentSettings()) {
    const orientation = ['portrait', 'landscape'].includes(value?.orientation) ? value.orientation : fallback.orientation;
    const pageSize = Object.prototype.hasOwnProperty.call(SIZES, value?.pageSize) ? value.pageSize : fallback.pageSize;
    const merged = {};
    SIDES.forEach(side => {
      const raw = value?.margins?.[side];
      const numeric = raw === undefined || raw === null || String(raw).trim() === '' ? NaN : Number(raw);
      merged[side] = Number.isFinite(numeric) ? numeric : Number(fallback.margins?.[side] ?? DEFAULT_MARGINS[side]);
    });
    return { orientation, pageSize, margins: _clampMargins(merged, _sizeCm(pageSize, orientation)) };
  }

  // CSS-змінні аркуша: для документа — на .pages-wrap, для розділу — на його аркушах.
  function geometryVars(settings) {
    const size = _sizeCm(settings.pageSize, settings.orientation);
    const m = settings.margins;
    return {
      '--page-width': Math.round(size.width * CM_TO_PX) + 'px',
      '--page-height': Math.round(size.height * CM_TO_PX) + 'px',
      '--page-pad-top': Math.round(m.top * CM_TO_PX) + 'px',
      '--page-pad-right': Math.round(m.right * CM_TO_PX) + 'px',
      '--page-pad-bottom': Math.round(m.bottom * CM_TO_PX) + 'px',
      '--page-pad-left': Math.round(m.left * CM_TO_PX) + 'px'
    };
  }

  function apply(options = {}) {
    const wrap = document.querySelector('.pages-wrap');
    if (!wrap) return;

    const settings = documentSettings();
    Object.entries(geometryVars(settings)).forEach(([name, value]) => wrap.style.setProperty(name, value));
    const hf = headerFooter();
    _applyHeaderFooter(wrap, hf);
    _updatePrintStyle(_sizeCm(settings.pageSize, settings.orientation), settings.margins, hf);

    if (options.repaginate !== false) ArtEditor.refreshLayout?.();
    scheduleRulerUpdate();
  }

  function _clampMargins(merged, size) {
    return {
      top: _clamp(merged.top, size.height - MIN_CONTENT_CM - merged.bottom),
      bottom: _clamp(merged.bottom, size.height - MIN_CONTENT_CM - merged.top),
      left: _clamp(merged.left, size.width - MIN_CONTENT_CM - merged.right),
      right: _clamp(merged.right, size.width - MIN_CONTENT_CM - merged.left)
    };
  }

  function setMargins(next, options = {}) {
    const clamped = _clampMargins(Object.assign({}, margins(), next), pageSizeCm());
    ArtState.set('margins', clamped);
    if (options.repaginate === false) apply({ repaginate: false });
    return clamped;
  }

  function resetMargins() { setMargins(Object.assign({}, DEFAULT_MARGINS)); }

  // Лінійка й діалог працюють із розділом, у якому каретка; без розділів — із документом.
  function _currentTarget() {
    const section = ArtEditor.sectionAtCaret?.();
    if (section) return section;
    return { index: 0, count: 1, element: null, settings: documentSettings(), page: document.querySelector('.page') };
  }

  // ── Колонтитули й номери сторінок ───────────────────────────────────────
  function headerFooter() {
    return ArtState.normalizeHeaderFooter(ArtState.get('headerFooter'));
  }

  function setHeaderFooter(next) {
    const merged = ArtState.normalizeHeaderFooter(Object.assign({}, headerFooter(), next));
    ArtState.set('headerFooter', merged);
    return merged;
  }

  // Колонтитули — оформлення аркуша, а не абзаци документа. Текст іде в CSS-змінні:
  // кожен аркуш, зокрема новий після пагінації, показує його псевдоелементами шару
  // .page-chrome, тож у вмісті, пошуку й лічильнику слів цього тексту немає.
  function _applyHeaderFooter(wrap, hf) {
    wrap.style.setProperty('--art-header-text', _cssString(hf.header));
    wrap.style.setProperty('--art-footer-text', _cssString(hf.footer));
    wrap.dataset.pageNumberPosition = hf.pageNumber;
  }

  // Рядок CSS, у якому все, крім літер, цифр і пробілу, записано шістнадцятковими
  // escape-послідовностями: текст користувача не може закрити рядок чи правило.
  function _cssString(text) {
    const body = Array.from(String(text || '')).map(ch => (
      /[\p{L}\p{N} ]/u.test(ch) ? ch : `\\${ch.codePointAt(0).toString(16)} `
    )).join('');
    return `"${body}"`;
  }

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
    const target = _drag?.target || _currentTarget();
    const page = target.page?.isConnected ? target.page : document.querySelector('.page');
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
    const size = _sizeCm(target.settings.pageSize, target.settings.orientation);
    const pxPerCm = rect.width / size.width;
    const m = target.settings.margins;

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
        const target = _currentTarget();
        handle.focus();
        handle.setPointerCapture?.(event.pointerId);
        _drag = { side: handle.dataset.rulerHandle, target };
      });

      handle.addEventListener('keydown', event => {
        const side = handle.dataset.rulerHandle;
        const step = event.shiftKey ? 0.5 : STEP_CM;
        const target = _currentTarget();
        const current = target.settings.margins[side];
        if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') {
          event.preventDefault();
          _setSide(side, current + (side === 'left' ? -step : step), target);
        } else if (event.key === 'ArrowRight' || event.key === 'ArrowUp') {
          event.preventDefault();
          _setSide(side, current + (side === 'left' ? step : -step), target);
        } else if (event.key === 'Home') {
          event.preventDefault();
          _setSide(side, DEFAULT_MARGINS[side], target);
        }
      });
    });

    document.addEventListener('pointermove', event => {
      if (!_drag) return;
      const target = _drag.target;
      const page = target.page?.isConnected ? target.page : document.querySelector('.page');
      if (!page) return;
      const rect = page.getBoundingClientRect();
      const size = _sizeCm(target.settings.pageSize, target.settings.orientation);
      const pxPerCm = rect.width / size.width;
      const value = _drag.side === 'left'
        ? (event.clientX - rect.left) / pxPerCm
        : (rect.right - event.clientX) / pxPerCm;
      // Під час перетягування лише перемальовуємо поля; повне перекомпонування
      // документа робимо один раз, коли маркер відпущено.
      if (target.element) {
        const next = { ...target.settings, margins: { ...target.settings.margins, [_drag.side]: _round(value) } };
        target.settings = ArtEditor.previewSectionSettings?.(target.element, next) || target.settings;
        scheduleRulerUpdate();
      } else {
        target.settings = { ...target.settings, margins: setMargins({ [_drag.side]: _round(value) }, { repaginate: false }) };
      }
    });

    document.addEventListener('pointerup', () => {
      if (!_drag) return;
      const target = _drag.target;
      _drag = null;
      if (target.element) {
        ArtEditor.commitSectionChange?.();
        scheduleRulerUpdate();
        return;
      }
      apply();
      ArtHistory.pushNow?.();
    });
  }

  function _setSide(side, value, target = _currentTarget()) {
    if (target.element) {
      ArtEditor.setSectionSettings(target.element, {
        ...target.settings,
        margins: { ...target.settings.margins, [side]: _round(value) }
      });
      scheduleRulerUpdate();
      return;
    }
    const next = {};
    next[side] = _round(value);
    setMargins(next);
    ArtHistory.pushNow?.();
  }

  // ── Діалог «Налаштування сторінки» ──────────────────────────────────────
  // У документі з кількома розділами діалог змінює лише розділ, у якому каретка.
  function openSetup() {
    const form = document.getElementById('pageSetupForm');
    if (!form) return;

    const target = _currentTarget();
    _setupTarget = target.element;
    _setupSettings = target.settings;
    const settings = target.settings;
    form.querySelectorAll('[name="pageOrientation"]').forEach(input => {
      input.checked = input.value === settings.orientation;
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
      sizeSelect.value = settings.pageSize;
    }

    SIDES.forEach(side => {
      const input = _marginInput(side);
      if (input) input.value = settings.margins[side].toFixed(1);
    });

    const scope = document.getElementById('pageSetupScope');
    if (scope) {
      scope.hidden = target.count < 2;
      scope.textContent = target.count < 2 ? '' : `Розділ ${target.index + 1} з ${target.count}: зміни застосуються лише до нього.`;
    }

    ArtModals.open('modalPageSetup');
  }

  function applySetupForm() {
    const form = document.getElementById('pageSetupForm');
    if (!form) return;

    const orientation = form.querySelector('[name="pageOrientation"]:checked')?.value || 'portrait';
    const pageSize = document.getElementById('pageSetupSize')?.value || 'a4';
    const current = _setupSettings?.margins || margins();
    const next = {};
    SIDES.forEach(side => {
      const raw = (_marginInput(side)?.value || '').replace(',', '.');
      const value = parseFloat(raw);
      next[side] = Number.isFinite(value) ? value : current[side];
    });

    const section = _setupTarget;
    _setupTarget = null;
    _setupSettings = null;
    if (section?.isConnected) {
      ArtModals.close('modalPageSetup');
      ArtEditor.setSectionSettings(section, { orientation, pageSize, margins: next });
      scheduleRulerUpdate();
      return;
    }

    ArtState.set('pageSize', pageSize);
    ArtState.set('orientation', orientation);
    setMargins(next);
    ArtModals.close('modalPageSetup');
    ArtHistory.pushNow?.();
  }

  // ── Діалог «Колонтитули й номери сторінок» ──────────────────────────────
  function openHeaderFooter() {
    const form = document.getElementById('headerFooterForm');
    if (!form) return;

    const hf = headerFooter();
    const header = document.getElementById('headerFooterHeader');
    const footer = document.getElementById('headerFooterFooter');
    if (header) header.value = hf.header;
    if (footer) footer.value = hf.footer;
    form.querySelectorAll('[name="headerFooterPageNumber"]').forEach(input => {
      input.checked = input.value === hf.pageNumber;
    });

    ArtModals.open('modalHeaderFooter');
  }

  function applyHeaderFooterForm() {
    const form = document.getElementById('headerFooterForm');
    if (!form) return;

    setHeaderFooter({
      header: document.getElementById('headerFooterHeader')?.value || '',
      footer: document.getElementById('headerFooterFooter')?.value || '',
      pageNumber: form.querySelector('[name="headerFooterPageNumber"]:checked')?.value || 'none'
    });
    ArtModals.close('modalHeaderFooter');
    ArtHistory.pushNow?.();
  }

  function _bindHeaderFooterDialog() {
    document.getElementById('headerFooterForm')?.addEventListener('submit', event => {
      event.preventDefault();
      applyHeaderFooterForm();
    });
    // Як «Повернути стандартні поля»: лише очищає форму, зміна настає після «Застосувати».
    document.querySelector('[data-header-footer-clear]')?.addEventListener('click', () => {
      ['headerFooterHeader', 'headerFooterFooter'].forEach(id => {
        const input = document.getElementById(id);
        if (input) input.value = '';
      });
      const none = document.querySelector('[name="headerFooterPageNumber"][value="none"]');
      if (none) none.checked = true;
    });
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

  function _updatePrintStyle(size, m, hf = headerFooter()) {
    let style = document.getElementById('pagePrintGeometry');
    if (!style) {
      style = document.createElement('style');
      style.id = 'pagePrintGeometry';
      document.head.appendChild(style);
    }
    // У друку колонтитули стоять у полях аркуша (@page margin boxes), а номер —
    // лічильник сторінок друку. Екранний шар .page-chrome у друку прихований.
    const font = "font-family: 'Times New Roman', serif; font-size: 11pt; color: #334155;";
    const boxes = [];
    if (hf.header) boxes.push(`@top-center { content: ${_cssString(hf.header)}; ${font} }`);
    if (hf.footer) boxes.push(`@bottom-center { content: ${_cssString(hf.footer)}; ${font} }`);
    if (hf.pageNumber !== 'none') boxes.push(`@${hf.pageNumber === 'header' ? 'top' : 'bottom'}-right { content: counter(page); ${font} }`);
    const marginBoxes = boxes.length ? ` ${boxes.join(' ')}` : '';
    style.textContent = `@page { size: ${size.width}cm ${size.height}cm; margin: ${m.top}cm ${m.right}cm ${m.bottom}cm ${m.left}cm;${marginBoxes} }`;
  }

  // Друк розділів: аркуші кожного розділу, крім першого, — іменована сторінка з власним
  // розміром і полями. Колонтитули з загального правила @page діють і на них.
  function setSectionPrintPages(entries = []) {
    const text = entries.map(({ name, settings }) => {
      const size = _sizeCm(settings.pageSize, settings.orientation);
      const m = settings.margins;
      return `@page ${name} { size: ${size.width}cm ${size.height}cm; margin: ${m.top}cm ${m.right}cm ${m.bottom}cm ${m.left}cm; }`;
    }).join(' ');
    let style = document.getElementById('pageSectionPrintGeometry');
    if (!style) {
      if (!text) return;
      style = document.createElement('style');
      style.id = 'pageSectionPrintGeometry';
      document.head.appendChild(style);
    }
    if (style.textContent !== text) style.textContent = text;
  }

  return {
    init, apply, openSetup, applySetupForm, setMargins, resetMargins,
    headerFooter, setHeaderFooter, openHeaderFooter, applyHeaderFooterForm,
    documentSettings, normalizeSettings, geometryVars, setSectionPrintPages,
    updateRuler, margins, pageSizeCm, SIZES, DEFAULT_MARGINS
  };
})();
