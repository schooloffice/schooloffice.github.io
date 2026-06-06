const CACHE_VERSION = 'office-plus-v7';
const PRECACHE_NAME = `${CACHE_VERSION}-precache`;
const RUNTIME_CACHE = `${CACHE_VERSION}-runtime`;
const MAX_RUNTIME_ENTRIES = 80;
const CORE_ASSETS = [
  './apple-touch-icon.png',
  './design-tokens.json',
  './favicon-96x96.png',
  './favicon.ico',
  './favicon.svg',
  './flowcharts/index.html',
  './flowcharts/js/app.js',
  './flowcharts/js/autosave.js',
  './flowcharts/js/colors.js',
  './flowcharts/js/connection-selection.js',
  './flowcharts/js/connections-dom.js',
  './flowcharts/js/core.js',
  './flowcharts/js/editor.js',
  './flowcharts/js/editor-utils.js',
  './flowcharts/js/flow-actions.js',
  './flowcharts/js/handles.js',
  './flowcharts/js/history.js',
  './flowcharts/js/keyboard-shortcuts.js',
  './flowcharts/js/menu-actions.js',
  './flowcharts/js/modals.js',
  './flowcharts/js/project-io.js',
  './flowcharts/js/routing.js',
  './flowcharts/js/runtime.js',
  './flowcharts/js/shape-geometry.js',
  './flowcharts/js/shape-interactions.js',
  './flowcharts/js/shape-factory.js',
  './flowcharts/js/shape-deletion.js',
  './flowcharts/js/shape-placement.js',
  './flowcharts/js/shape-selection.js',
  './flowcharts/js/shape-text.js',
  './flowcharts/js/status.js',
  './flowcharts/style.css',
  './flowcharts/js/title.js',
  './flowcharts/js/ui.js',
  './flowcharts/js/viewport.js',
  './index.html',
  './office-shell.js',
  './office-ui.js',
  './offline.js',
  './shell-overrides.css',
  './site.webmanifest',
  './paint/index.html',
  './paint/js/app.js',
  './paint/js/canvas.js',
  './paint/js/constants.js',
  './paint/js/document.js',
  './paint/js/object-interactions.js',
  './paint/js/runtime.js',
  './paint/js/state.js',
  './paint/js/ui.js',
  './paint/js/utils.js',
  './paint/style.css',
  './SERVICE_THEME_MAP.json',
  './slides/index.html',
  './slides/js/app.js',
  './slides/js/constants.js',
  './slides/js/export.js',
  './slides/js/history.js',
  './slides/js/modal-ui.js',
  './slides/js/project.js',
  './slides/js/runtime.js',
  './slides/js/slide-list.js',
  './slides/js/stage-interactions.js',
  './slides/js/stage-renderer.js',
  './slides/js/state.js',
  './slides/js/storage.js',
  './slides/js/templates.js',
  './slides/js/utils.js',
  './slides/style.css',
  './tables/index.html',
  './tables/js/addressing.js',
  './tables/js/app.js',
  './tables/js/calculation.js',
  './tables/js/cell-format-ui.js',
  './tables/js/charts.js',
  './tables/js/clipboard.js',
  './tables/js/column-sizing.js',
  './tables/js/core.js',
  './tables/js/formula-engine.js',
  './tables/js/formula-functions.js',
  './tables/js/formatting.js',
  './tables/js/formula-bar.js',
  './tables/js/formula-parser.js',
  './tables/js/formula-references.js',
  './tables/js/grid.js',
  './tables/js/model.js',
  './tables/js/runtime.js',
  './tables/js/selection-actions.js',
  './tables/js/sorting.js',
  './tables/js/state.js',
  './tables/js/storage.js',
  './tables/js/structure.js',
  './tables/js/ui.js',
  './tables/js/view-options.js',
  './tables/js/workbook.js',
  './tables/js/workbook-file.js',
  './tables/style.css',
  './text/core/history.js',
  './text/core/sanitize.js',
  './text/core/selection.js',
  './text/core/state.js',
  './text/formats/docx.js',
  './text/formats/rtf.js',
  './text/formats/txt.js',
  './text/index.html',
  './text/js/app.js',
  './text/js/runtime.js',
  './text/style.css',
  './text/ui/editor.js',
  './text/ui/menu.js',
  './text/ui/modals.js',
  './text/ui/toolbar.js',
  './UI_TOKENS.css',
  './style.css',
  './web-app-manifest-192x192.png',
  './web-app-manifest-512x512.png',
  './vector/filetest.png',
  './vector/home.png',
  './vector/home2.png',
  './vector/index.html',
  './vector/js/app.js',
  './vector/js/constants.js',
  './vector/js/editor.js',
  './vector/js/runtime.js',
  './vector/js/state.js',
  './vector/js/ui.js',
  './vector/js/utils.js',
  './vector/style.css',
  './vendor/chartjs/chart.umd.js',
  './vendor/docx/index.umd.js',
  './vendor/dompurify/purify.min.js',
  './vendor/fontawesome/css/all.min.css',
  './vendor/fontawesome/webfonts/fa-regular-400.woff2',
  './vendor/fontawesome/webfonts/fa-solid-900.woff2',
  './vendor/html2canvas/html2canvas.min.js',
  './vendor/html2pdf/html2pdf.bundle.min.js',
  './vendor/mammoth/mammoth.browser.min.js'
];

const ASSET_EXTENSIONS = /\.(?:css|js|json|png|jpg|jpeg|svg|woff2|ico|webmanifest)$/i;

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(PRECACHE_NAME)
      .then(cache => cache.addAll(CORE_ASSETS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys
          .filter(key => key !== PRECACHE_NAME && key !== RUNTIME_CACHE)
          .map(key => caches.delete(key))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.mode === 'navigate' || acceptsHtml(request)) {
    event.respondWith(networkFirstPage(request));
    return;
  }

  if (!shouldCacheAsset(url)) return;

  const refresh = refreshAsset(request);
  event.waitUntil(refresh);
  event.respondWith(assetFromCacheOrNetwork(request, refresh));
});

function acceptsHtml(request) {
  return request.headers.get('accept')?.includes('text/html') === true;
}

function shouldCacheAsset(url) {
  return ASSET_EXTENSIONS.test(url.pathname);
}

async function networkFirstPage(request) {
  const cache = await caches.open(PRECACHE_NAME);
  try {
    const response = await fetch(request);
    if (isCacheable(response)) {
      await cache.put(request, response.clone());
    }
    return response;
  } catch (error) {
    const cached = await cache.match(request);
    if (cached) return cached;
    throw error;
  }
}

async function assetFromCacheOrNetwork(request, refreshPromise) {
  const runtime = await caches.open(RUNTIME_CACHE);
  const precache = await caches.open(PRECACHE_NAME);
  const cached = await runtime.match(request) || await precache.match(request);
  if (cached) return cached;

  const refreshed = await refreshPromise;
  if (refreshed) return refreshed;

  const fallback = await precache.match(request);
  if (fallback) return fallback;
  throw new Error(`Asset unavailable: ${request.url}`);
}

async function refreshAsset(request) {
  try {
    const response = await fetch(request);
    if (!isCacheable(response)) return response;

    const runtime = await caches.open(RUNTIME_CACHE);
    await runtime.put(request, response.clone());
    await trimRuntimeCache(runtime);
    return response;
  } catch (error) {
    return null;
  }
}

function isCacheable(response) {
  if (!response || response.status !== 200 || response.type !== 'basic') return false;
  const cacheControl = response.headers.get('Cache-Control') || '';
  return !/no-store/i.test(cacheControl);
}

async function trimRuntimeCache(cache) {
  const keys = await cache.keys();
  const overflow = keys.length - MAX_RUNTIME_ENTRIES;
  if (overflow <= 0) return;

  await Promise.all(keys.slice(0, overflow).map(key => cache.delete(key)));
}
