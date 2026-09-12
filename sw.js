const CACHE_VERSION = 'office-plus-v70';
const RUNTIME_CACHE = `${CACHE_VERSION}-runtime`;
const OFFLINE_STATUS_CACHE = `${CACHE_VERSION}-offline-status`;
const OFFLINE_STATUS_URL = new URL('./__offline_status__', self.registration.scope).href;
const MAX_RUNTIME_ENTRIES = 80;
const ALL_LOCAL_ASSETS = [
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
  './flowcharts/js/connection-waypoints.js',
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
  './flowcharts/js/obstacle-routing.js',
  './flowcharts/js/palette-dnd.js',
  './flowcharts/js/project-io.js',
  './flowcharts/js/svg-export.js',
  './flowcharts/js/routing.js',
  './flowcharts/js/runtime.js',
  './flowcharts/js/templates.js',
  './flowcharts/js/templates-data.js',
  './flowcharts/js/validation.js',
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
  './landing.js',
  './office-storage.js',
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
  './paint/js/storage.js',
  './paint/js/text.js',
  './paint/js/tools.js',
  './paint/js/ui.js',
  './paint/js/utils.js',
  './paint/style.css',
  './SERVICE_THEME_MAP.json',
  './slides/index.html',
  './slides/js/app.js',
  './slides/js/chart-controller.js',
  './slides/js/chart-element.js',
  './slides/js/constants.js',
  './slides/js/element-rendering.js',
  './slides/js/export.js',
  './slides/js/history.js',
  './slides/js/image-geometry.js',
  './slides/js/modal-ui.js',
  './slides/js/object-commands.js',
  './slides/js/presentation-design.js',
  './slides/js/pptx-export.js',
  './slides/js/project.js',
  './slides/js/runtime.js',
  './slides/js/slide-list.js',
  './slides/js/stage-interactions.js',
  './slides/js/stage-renderer.js',
  './slides/js/text-list.js',
  './slides/js/table-controller.js',
  './slides/js/table-element.js',
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
  './tables/js/conditional-formatting.js',
  './tables/js/clipboard.js',
  './tables/js/column-sizing.js',
  './tables/js/core.js',
  './tables/js/filter.js',
  './tables/js/formula-engine.js',
  './tables/js/formula-functions.js',
  './tables/js/formatting.js',
  './tables/js/formula-bar.js',
  './tables/js/formula-parser.js',
  './tables/js/formula-references.js',
  './tables/js/sheets.js',
  './tables/js/grid-viewport.js',
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
  './tables/js/xlsx-file.js',
  './tables/style.css',
  './text/core/document-model.js',
  './text/core/history.js',
  './text/core/sanitize.js',
  './text/core/selection.js',
  './text/core/state.js',
  './text/core/storage.js',
  './text/formats/docx.js',
  './text/formats/rtf.js',
  './text/formats/txt.js',
  './text/index.html',
  './text/js/app.js',
  './text/js/runtime.js',
  './text/style.css',
  './text/ui/editor.js',
  './text/ui/find.js',
  './text/ui/menu.js',
  './text/ui/modals.js',
  './text/ui/page.js',
  './text/ui/toolbar.js',
  './UI_TOKENS.css',
  './style.css',
  './web-app-manifest-192x192.png',
  './web-app-manifest-512x512.png',
  './vector/index.html',
  './vector/js/app.js',
  './vector/js/constants.js',
  './vector/js/editor.js',
  './vector/js/project-io.js',
  './vector/js/runtime.js',
  './vector/js/state.js',
  './vector/js/storage.js',
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
  './vendor/mammoth/mammoth.browser.min.js',
  './vendor/pptxgenjs/LICENSE',
  './vendor/pptxgenjs/pptxgen.bundle.js'
];

const TEXT_VENDOR_ASSETS = new Set([
  './vendor/docx/index.umd.js',
  './vendor/dompurify/purify.min.js',
  './vendor/mammoth/mammoth.browser.min.js'
]);
const TABLES_VENDOR_ASSETS = new Set(['./vendor/chartjs/chart.umd.js']);
const SLIDES_VENDOR_ASSETS = new Set([
  './vendor/html2pdf/html2pdf.bundle.min.js',
  './vendor/pptxgenjs/LICENSE',
  './vendor/pptxgenjs/pptxgen.bundle.js'
]);
const FLOWCHARTS_VENDOR_ASSETS = new Set(['./vendor/html2canvas/html2canvas.min.js']);

const TEXT_ASSETS = ALL_LOCAL_ASSETS.filter(asset => asset.startsWith('./text/') || TEXT_VENDOR_ASSETS.has(asset));
const TABLES_ASSETS = ALL_LOCAL_ASSETS.filter(asset => asset.startsWith('./tables/') || TABLES_VENDOR_ASSETS.has(asset));
const SLIDES_ASSETS = ALL_LOCAL_ASSETS.filter(asset => asset.startsWith('./slides/') || SLIDES_VENDOR_ASSETS.has(asset));
const PAINT_ASSETS = ALL_LOCAL_ASSETS.filter(asset => asset.startsWith('./paint/'));
const VECTOR_ASSETS = ALL_LOCAL_ASSETS.filter(asset => asset.startsWith('./vector/'));
const FLOWCHARTS_ASSETS = ALL_LOCAL_ASSETS.filter(asset => asset.startsWith('./flowcharts/') || FLOWCHARTS_VENDOR_ASSETS.has(asset));
const EDITOR_ASSET_SET = new Set([
  ...TEXT_ASSETS,
  ...TABLES_ASSETS,
  ...SLIDES_ASSETS,
  ...PAINT_ASSETS,
  ...VECTOR_ASSETS,
  ...FLOWCHARTS_ASSETS
]);
const CORE_SHELL_ASSETS = ALL_LOCAL_ASSETS.filter(asset => !EDITOR_ASSET_SET.has(asset)).concat('./tests/offline-smoke.html');

const CACHE_GROUPS = {
  core: CORE_SHELL_ASSETS,
  text: TEXT_ASSETS,
  tables: TABLES_ASSETS,
  slides: SLIDES_ASSETS,
  paint: PAINT_ASSETS,
  vector: VECTOR_ASSETS,
  flowcharts: FLOWCHARTS_ASSETS
};
const GROUP_CACHE_NAMES = Object.fromEntries(
  Object.keys(CACHE_GROUPS).map(group => [group, `${CACHE_VERSION}-${group}`])
);

const ASSET_EXTENSIONS = /\.(?:css|js|json|png|jpg|jpeg|svg|woff2|ico|webmanifest)$/i;

self.addEventListener('install', event => {
  event.waitUntil(cacheAllGroups().then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
  const keepCaches = new Set([...Object.values(GROUP_CACHE_NAMES), RUNTIME_CACHE, OFFLINE_STATUS_CACHE]);
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys
          .filter(key => !keepCaches.has(key))
          .map(key => caches.delete(key))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('message', event => {
  const type = event.data?.type;
  if (type === 'CHECK_OFFLINE_STATUS') {
    event.waitUntil(checkOfflineStatus().then(status => respondToMessage(event, status)));
    return;
  }
  if (type === 'RETRY_OFFLINE_CACHE') {
    event.waitUntil(cacheAllGroups().then(status => respondToMessage(event, status)));
  }
});

function assetUrl(asset) {
  return new URL(asset, self.registration.scope).href;
}

async function cacheAssetGroup(group, assets) {
  const cache = await caches.open(GROUP_CACHE_NAMES[group]);
  const failures = [];
  for (let offset = 0; offset < assets.length; offset += 6) {
    const batch = assets.slice(offset, offset + 6);
    const attempts = await Promise.allSettled(batch.map(async asset => {
      const request = new Request(assetUrl(asset), { cache: 'reload' });
      const response = await fetch(request);
      if (!isPrecacheable(response)) throw new Error(`HTTP ${response.status}`);
      await cache.put(request, response.clone());
      return asset;
    }));
    attempts.forEach((attempt, index) => {
      if (attempt.status === 'rejected') failures.push(batch[index]);
    });
  }
  return failures;
}

async function saveOfflineFailures(failures) {
  const cache = await caches.open(OFFLINE_STATUS_CACHE);
  await cache.put(OFFLINE_STATUS_URL, new Response(JSON.stringify({
    cacheVersion: CACHE_VERSION,
    checkedAt: Date.now(),
    failures
  }), { headers: { 'Content-Type': 'application/json' } }));
}

async function readOfflineFailures() {
  try {
    const cache = await caches.open(OFFLINE_STATUS_CACHE);
    const response = await cache.match(OFFLINE_STATUS_URL);
    return response ? (await response.json()).failures || {} : {};
  } catch {
    return {};
  }
}

async function cacheAllGroups() {
  const entries = Object.entries(CACHE_GROUPS);
  const settled = await Promise.allSettled(entries.map(([group, assets]) => cacheAssetGroup(group, assets)));
  const failures = {};
  settled.forEach((result, index) => {
    const group = entries[index][0];
    failures[group] = result.status === 'fulfilled'
      ? result.value
      : [...entries[index][1]];
  });
  await saveOfflineFailures(failures);
  return checkOfflineStatus();
}

async function checkGroup(group, assets) {
  const cache = await caches.open(GROUP_CACHE_NAMES[group]);
  const cachedUrls = new Set((await cache.keys()).map(request => request.url));
  const missing = assets.filter(asset => !cachedUrls.has(assetUrl(asset)));
  return { ready: missing.length === 0, missing };
}

async function checkOfflineStatus() {
  const groupEntries = await Promise.all(Object.entries(CACHE_GROUPS).map(async ([group, assets]) => {
    return [group, await checkGroup(group, assets)];
  }));
  const groups = Object.fromEntries(groupEntries);
  const editors = {};
  for (const editor of ['text', 'tables', 'slides', 'paint', 'vector', 'flowcharts']) {
    const missing = [...groups.core.missing, ...groups[editor].missing];
    editors[editor] = { ready: groups.core.ready && groups[editor].ready, missing };
  }
  return {
    type: 'OFFLINE_STATUS',
    cacheVersion: CACHE_VERSION,
    ready: Object.values(editors).every(editor => editor.ready),
    groups,
    editors,
    lastFailures: await readOfflineFailures()
  };
}

function respondToMessage(event, payload) {
  if (event.ports?.[0]) event.ports[0].postMessage(payload);
  else event.source?.postMessage?.(payload);
}

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
  const cache = await caches.open(RUNTIME_CACHE);
  try {
    const response = await fetch(request);
    if (isCacheable(response)) {
      await cache.put(request, response.clone());
      await trimRuntimeCache(cache);
    }
    return response;
  } catch (error) {
    const cached = await cache.match(request, { ignoreSearch: true }) || await caches.match(request, { ignoreSearch: true });
    if (cached) return cached;
    throw error;
  }
}

async function assetFromCacheOrNetwork(request, refreshPromise) {
  const runtime = await caches.open(RUNTIME_CACHE);
  const cached = await runtime.match(request) || await caches.match(request);
  if (cached) return cached;

  const refreshed = await refreshPromise;
  if (refreshed) return refreshed;

  const fallback = await caches.match(request);
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

function isPrecacheable(response) {
  return !!response && response.status === 200 && response.type === 'basic';
}

async function trimRuntimeCache(cache) {
  const keys = await cache.keys();
  const overflow = keys.length - MAX_RUNTIME_ENTRIES;
  if (overflow <= 0) return;

  await Promise.all(keys.slice(0, overflow).map(key => cache.delete(key)));
}
