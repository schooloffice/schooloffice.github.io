document.addEventListener('DOMContentLoaded', () => {
  const bootResult = window.TextApp?.boot?.();
  window.TextApp.ready = Promise.resolve(bootResult).catch(error => {
    console.error('Text boot failed:', error);
    throw error;
  });
});
