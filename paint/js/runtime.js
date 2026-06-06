function bootPaint() {
  window.PaintApp?.boot?.();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', bootPaint, { once: true });
} else {
  bootPaint();
}
