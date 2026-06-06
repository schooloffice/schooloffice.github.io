import './app.js';

function bootSlides() {
  window.SlidesApp?.boot?.();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', bootSlides, { once: true });
} else {
  bootSlides();
}
