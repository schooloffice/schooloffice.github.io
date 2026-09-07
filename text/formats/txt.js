'use strict';
/* formats/txt.js — імпорт і експорт .txt */

const ArtTxt = (() => {

  function importTxt(file) {
    return new Promise((resolve, reject) => {
      const fr = new FileReader();
      fr.onload = () => {
        const text = fr.result;
        const html = text
          .split(/\r?\n/)
          .map(line => `<p>${_esc(line) || '<br>'}</p>`)
          .join('');
        // Звичайний текст нічого не втрачає під час очищення: сирий і
        // прийнятий вміст тут збігаються.
        resolve({ html, rawHtml: html, meta: { format: 'txt', fileName: file.name } });
      };
      fr.onerror = () => reject(new Error('Не вдалося прочитати файл'));
      fr.readAsText(file, 'utf-8');
    });
  }

  function exportTxt(html) {
    const div = document.createElement('div');
    div.innerHTML = html;
    return div.textContent || div.innerText || '';
  }

  function _esc(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  return { importTxt, exportTxt };
})();
