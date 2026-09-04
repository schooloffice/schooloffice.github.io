// ---- View options ----
function setZoom(zoom) {
  currentZoom = [90, 100, 115, 130].includes(Number(zoom)) ? Number(zoom) : 100;
  const factor = currentZoom / 100;
  const cellFont = Math.round(15 * factor);
  const cellHeight = Math.round(30 * factor);
  const headerHeight = Math.round(32 * factor);
  document.documentElement.style.setProperty('--cell-font', `${cellFont}px`);
  document.documentElement.style.setProperty('--cell-h', `${cellHeight}px`);
  document.documentElement.style.setProperty('--head-h', `${headerHeight}px`);
  // Геометрія кнопок швидкого вставлення має відповідати видимій сітці
  // навіть тоді, коли масштаб відновлено вже після першого renderGrid().
  metrics.rowH = cellHeight;
  metrics.headerH = headerHeight;
  TablesStructure?.hideInsertButtons?.();
  const label = document.getElementById('zoomLabel');
  if (label) label.textContent = `${currentZoom}%`;
  document.querySelectorAll('.menu-item[data-action^="zoom-"]').forEach(btn => btn.classList.remove('checked'));
  document.querySelector(`.menu-item[data-action="zoom-${currentZoom}"]`)?.classList.add('checked');
  persistUiState();
}

function changeTheme(name) {
  const t = themes[name];
  if (!t) return;

  const h = document.getElementById('header');
  if (h) {
    const prev = themes[currentTheme]?.headerCls;
    if (prev) h.classList.remove(prev);
    h.classList.add(t.headerCls);
  }
  currentTheme = name;
  document.documentElement.style.setProperty('--th-bg', t.th);
  document.documentElement.style.setProperty('--th-text', t.text);
}

window.TablesViewOptions = {
  changeTheme,
  setZoom
};
