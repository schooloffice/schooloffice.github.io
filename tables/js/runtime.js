document.addEventListener('DOMContentLoaded', () => {
  window.TablesApp.ready = Promise.resolve(window.TablesApp?.boot?.());
});
