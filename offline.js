(function () {
  'use strict';

  // ---------------------------------------------------------------------------
  // DEV MODE: service worker вимкнено на час доробки сайту.
  // Цей блок активно знімає реєстрацію будь-якого раніше встановленого SW і
  // чистить кеші, щоб у браузері завжди була свіжа, незакешована версія.
  // Щоб увімкнути офлайн-режим назад — видали цей блок і прибери ранній return
  // нижче (відновивши реєстрацію sw.js).
  // ---------------------------------------------------------------------------
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.getRegistrations()
      .then(regs => regs.forEach(reg => reg.unregister()))
      .catch(() => {});
  }
  if (window.caches && caches.keys) {
    caches.keys().then(keys => keys.forEach(key => caches.delete(key))).catch(() => {});
  }
  return;

  // eslint-disable-next-line no-unreachable
  if (!('serviceWorker' in navigator)) return;
  if (!/^https?:$/.test(window.location.protocol)) return;

  const scriptUrl = new URL('sw.js', window.location.href);
  if (window.location.pathname.includes('/text/') ||
      window.location.pathname.includes('/tables/') ||
      window.location.pathname.includes('/paint/') ||
      window.location.pathname.includes('/slides/') ||
      window.location.pathname.includes('/flowcharts/') ||
      window.location.pathname.includes('/vector/')) {
    scriptUrl.pathname = scriptUrl.pathname.replace(/\/(text|tables|paint|slides|flowcharts|vector)\/sw\.js$/, '/sw.js');
  }

  window.addEventListener('load', () => {
    navigator.serviceWorker.register(scriptUrl.pathname).catch(() => {});
  });
}());
