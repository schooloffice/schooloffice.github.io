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
        resolve({ html, meta: { format: 'txt', fileName: file.name } });
      };
      fr.onerror = () => reject(new Error('Не вдалося прочитати файл'));
      fr.readAsText(file, 'utf-8');
    });
  }

  function exportTxt(html) {
    const div = document.createElement('div');
    div.innerHTML = html;
    return _blockLines(div).join('\n');
  }

  const TXT_BLOCKS = new Set(['P', 'DIV', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'BLOCKQUOTE', 'PRE', 'LI', 'FIGURE']);

  // Рядки контейнера: кожен блок — окремий рядок (порожній блок — порожній рядок), <br> —
  // перенос рядка, пункти списку — окремі рядки, рядок таблиці — клітинки через табуляцію.
  // Горизонтальна лінія й розрив сторінки в TXT не пишуться. Табуляція всередині абзацу
  // (між назвою й номером пункту змісту) лишається.
  function _blockLines(container) {
    const lines = [];
    let inline = '';
    const flush = () => {
      if (inline.replace(/\n/g, '').trim()) lines.push(...inline.replace(/\n$/, '').split('\n'));
      inline = '';
    };
    container.childNodes.forEach(node => {
      if (node.nodeType === Node.TEXT_NODE) {
        inline += node.data.replace(/[\r\n]+/g, ' ');
        return;
      }
      if (node.nodeType !== Node.ELEMENT_NODE) return;
      const tag = node.tagName;
      if (tag === 'BR') {
        inline += '\n';
      } else if (tag === 'HR') {
        flush();
      } else if (tag === 'TABLE') {
        flush();
        node.querySelectorAll('tr').forEach(row => {
          lines.push([...row.cells].map(cell => _blockLines(cell).join(' ').trim()).join('\t'));
        });
      } else if (tag === 'UL' || tag === 'OL') {
        flush();
        lines.push(..._blockLines(node));
      } else if (TXT_BLOCKS.has(tag)) {
        flush();
        const inner = _blockLines(node);
        lines.push(...(inner.length ? inner : ['']));
      } else {
        inline += _inlineText(node);
      }
    });
    flush();
    return lines;
  }

  function _inlineText(node) {
    return [...node.childNodes].map(child => {
      if (child.nodeType === Node.TEXT_NODE) return child.data.replace(/[\r\n]+/g, ' ');
      if (child.nodeType !== Node.ELEMENT_NODE) return '';
      return child.tagName === 'BR' ? '\n' : _inlineText(child);
    }).join('');
  }

  function _esc(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  return { importTxt, exportTxt };
})();
