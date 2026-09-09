(function () {
  'use strict';

  const STATUS_READY = 'Працює офлайн';
  const STATUS_NOT_READY = 'Офлайн-режим ще не готовий';
  const STATUS_CHECKING = 'Перевіряємо офлайн-режим…';
  let currentRegistration = null;

  function workerPath() {
    const url = new URL('sw.js', window.location.href);
    if (/\/(text|tables|paint|slides|flowcharts|vector)\//.test(window.location.pathname)) {
      url.pathname = url.pathname.replace(/\/(text|tables|paint|slides|flowcharts|vector)\/sw\.js$/, '/sw.js');
    }
    return url.pathname;
  }

  function dispatchOfflineError(operation, error) {
    const message = error?.message || String(error || 'offline-error');
    console.error(`Offline ${operation} failed:`, error);
    window.dispatchEvent(new CustomEvent('office:offline-error', {
      detail: { operation, message }
    }));
  }

  function statusBadge() {
    let badge = document.querySelector('[data-office-offline-status]');
    if (badge) return badge;
    badge = document.createElement('span');
    badge.className = 'office-offline-status';
    badge.dataset.officeOfflineStatus = '';
    badge.setAttribute('aria-live', 'polite');
    const host = document.querySelector('.office-statusbar') || document.querySelector('.hero-badges');
    if (host) host.appendChild(badge);
    else document.body.appendChild(badge);
    return badge;
  }

  function renderStatus(state, details = '') {
    const badge = statusBadge();
    badge.dataset.state = state;
    badge.textContent = state === 'ready'
      ? STATUS_READY
      : state === 'checking' ? STATUS_CHECKING : STATUS_NOT_READY;
    badge.title = details;
  }

  function postToWorker(registration, type) {
    const worker = registration?.active || navigator.serviceWorker.controller;
    if (!worker) return Promise.reject(new Error('service-worker-not-active'));
    return new Promise((resolve, reject) => {
      const channel = new MessageChannel();
      const timer = setTimeout(() => reject(new Error(`${type}-timeout`)), 10000);
      channel.port1.onmessage = event => {
        clearTimeout(timer);
        resolve(event.data);
      };
      worker.postMessage({ type }, [channel.port2]);
    });
  }

  function pageIsReady(status) {
    const app = document.body?.dataset.officeService;
    return app && status?.editors?.[app]
      ? status.editors[app].ready
      : status?.ready === true;
  }

  function missingSummary(status) {
    const app = document.body?.dataset.officeService;
    const missing = app && status?.editors?.[app]
      ? status.editors[app].missing
      : Object.values(status?.editors || {}).flatMap(editor => editor.missing || []);
    return [...new Set(missing || [])].slice(0, 8).join(', ');
  }

  async function checkStatus() {
    if (!currentRegistration) throw new Error('service-worker-not-registered');
    const status = await postToWorker(currentRegistration, 'CHECK_OFFLINE_STATUS');
    renderStatus(pageIsReady(status) ? 'ready' : 'error', missingSummary(status));
    window.dispatchEvent(new CustomEvent('office:offline-status', { detail: status }));
    return status;
  }

  async function retryOfflineCache() {
    if (!currentRegistration) throw new Error('service-worker-not-registered');
    renderStatus('checking');
    try {
      const status = await postToWorker(currentRegistration, 'RETRY_OFFLINE_CACHE');
      renderStatus(pageIsReady(status) ? 'ready' : 'error', missingSummary(status));
      window.dispatchEvent(new CustomEvent('office:offline-status', { detail: status }));
      return status;
    } catch (error) {
      dispatchOfflineError('retry', error);
      renderStatus('error', error.message);
      throw error;
    }
  }

  async function bootOffline() {
    if (!('serviceWorker' in navigator) || !/^https?:$/.test(window.location.protocol)) {
      renderStatus('error', 'Service Worker недоступний у цьому середовищі.');
      return null;
    }
    renderStatus('checking');
    try {
      currentRegistration = await navigator.serviceWorker.register(workerPath());
      const ready = await navigator.serviceWorker.ready;
      currentRegistration = ready || currentRegistration;
      return await checkStatus();
    } catch (error) {
      dispatchOfflineError('registration', error);
      renderStatus('error', error.message);
      return null;
    }
  }

  window.OfficeOffline = {
    checkStatus,
    retryOfflineCache,
    ready: null
  };

  function start() {
    window.OfficeOffline.ready = bootOffline();
  }
  navigator.serviceWorker?.addEventListener?.('controllerchange', () => {
    if (currentRegistration) window.OfficeOffline.ready = checkStatus().catch(error => {
      dispatchOfflineError('status', error);
      renderStatus('error', error.message);
      return null;
    });
  });
  if (document.readyState === 'complete') start();
  else window.addEventListener('load', start, { once: true });
}());
