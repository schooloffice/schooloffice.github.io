// ---- View options ----
function setZoom(zoom) {
  currentZoom = [90, 100, 115, 130].includes(Number(zoom)) ? Number(zoom) : 100;
  const factor = currentZoom / 100;
  document.documentElement.style.setProperty('--cell-font', `${Math.round(16 * factor)}px`);
  document.documentElement.style.setProperty('--cell-h', `${Math.round(44 * factor)}px`);
  document.documentElement.style.setProperty('--head-h', `${Math.round(42 * factor)}px`);
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
