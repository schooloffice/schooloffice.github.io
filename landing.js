(function () {
  'use strict';

  const themeToggle = document.getElementById('themeToggle');
  const themeIcon = themeToggle?.querySelector('i');
  if (!themeToggle || !themeIcon) return;

  if (localStorage.getItem('theme') === 'dark') {
    document.body.classList.add('dark-mode');
    themeIcon.classList.replace('fa-moon', 'fa-sun');
  }

  themeToggle.addEventListener('click', () => {
    const isDark = document.body.classList.toggle('dark-mode');
    themeIcon.classList.replace(isDark ? 'fa-moon' : 'fa-sun', isDark ? 'fa-sun' : 'fa-moon');
    localStorage.setItem('theme', isDark ? 'dark' : 'light');
  });
}());
