(function () {
  'use strict';

  function rgbToHex(rgb) {
    if (!rgb || rgb === 'transparent') return '#ffffff';
    if (rgb.startsWith('#')) return rgb;
    const match = rgb.match(/\d+/g);
    if (match && match.length >= 3) {
      return '#' + match.slice(0, 3).map(value => (+value).toString(16).padStart(2, '0')).join('');
    }
    return '#ffffff';
  }

  function sanitizeFilename(name) {
    const fallback = 'блок-схема';
    const base = (name || '').trim() || fallback;
    const safe = base
      .replace(/[\\/:*?"<>|]/g, '')
      .replace(/[().,]/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 60);
    return safe || fallback;
  }

  function smartWrapText(raw, type, core) {
    if (core?.smartWrapText) return core.smartWrapText(raw, type);
    const text = (raw || '').trim();
    if (!text) return '';
    const maxChars = (type === 'decision') ? 12 : (type === 'start-end') ? 16 : (type === 'input-output') ? 18 : 18;
    const maxLines = 4;

    const words = text.split(/\s+/).filter(Boolean);
    const lines = [];
    let line = '';

    function pushLine(value) {
      if (value) lines.push(value);
    }

    function splitLongWord(word) {
      const parts = [];
      let rest = word;
      while (rest.length > maxChars) {
        let cut = maxChars - 1;
        if (rest.length - cut < 3) cut = rest.length - 3;
        if (cut < 3) break;
        parts.push(rest.slice(0, cut) + '-');
        rest = rest.slice(cut);
      }
      parts.push(rest);
      return parts;
    }

    for (const word of words) {
      const chunks = (word.length > maxChars) ? splitLongWord(word) : [word];
      for (const chunk of chunks) {
        if (!line) line = chunk;
        else if ((line.length + 1 + chunk.length) <= maxChars) line += ' ' + chunk;
        else {
          pushLine(line);
          line = chunk;
        }
        if (lines.length >= maxLines) break;
      }
      if (lines.length >= maxLines) break;
    }
    pushLine(line);

    if (lines.length > maxLines) lines.length = maxLines;
    const used = lines.join(' ').replace(/-/g, '');
    if (used.length < text.length) {
      lines[lines.length - 1] = lines[lines.length - 1].replace(/\s*…?$/, '') + '…';
    }
    return lines.join('\n');
  }

  window.FlowchartsEditorUtils = {
    rgbToHex,
    sanitizeFilename,
    smartWrapText
  };
}());
