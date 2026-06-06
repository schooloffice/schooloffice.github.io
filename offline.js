(function () {
  'use strict';

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
