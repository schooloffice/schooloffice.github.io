'use strict';
/* formats/rtf.js — базовий RTF імпорт/експорт з підтримкою кирилиці */

const ArtRtf = (() => {

  // ── IMPORT ──────────────────────────────────
  function importRtf(file) {
    return new Promise((resolve, reject) => {
      const fr = new FileReader();
      fr.onload = () => {
        try {
          const html = _rtfToHtml(fr.result);
          resolve({ html, meta: { format: 'rtf', fileName: file.name } });
        } catch (e) {
          reject(e);
        }
      };
      fr.onerror = () => reject(new Error('Не вдалося прочитати файл'));
      fr.readAsText(file, 'utf-8');
    });
  }

  function _rtfToHtml(rtf) {
    let s = rtf
      .replace(/\{\\fonttbl[^}]*\}/g, '')
      .replace(/\{\\colortbl[^}]*\}/g, '')
      .replace(/\{\\stylesheet(?:[^{}]|\{[^}]*\})*\}/g, '')
      .replace(/\{\\info(?:[^{}]|\{[^}]*\})*\}/g, '')
      .replace(/\{\\[^{}]*\}/g, '')
      .replace(/\\([a-z]+)(-?\d+)? ?/g, (m, cmd, num) => {
        const key = num !== undefined ? `\\${cmd}${num}` : `\\${cmd}`;
        const map = {
          '\\b':        '<b>',  '\\b0':      '</b>',
          '\\i':        '<i>',  '\\i0':      '</i>',
          '\\ul':       '<u>',  '\\ulnone':  '</u>',
          '\\strike':   '<s>',  '\\strike0': '</s>',
          '\\par':      '</p><p>',
          '\\line':     '<br>',
          '\\tab':      '&nbsp;&nbsp;&nbsp;&nbsp;',
          '\\pard':     '', '\\plain': '',
        };
        // Розмір шрифту \\fsN (half-points)
        if (cmd === 'fs' && num) {
          const pt = Math.round(parseInt(num, 10) / 2);
          return `<span style="font-size:${pt}pt">`;
        }
        return map[key] ?? '';
      })
      // Escaped символи \'xx → Unicode
      .replace(/\\'([0-9a-fA-F]{2})/g, (_, hex) => {
        const code = parseInt(hex, 16);
        // cp1251 кирилиця
        if (code >= 0xC0 && code <= 0xFF) return String.fromCharCode(code - 0xC0 + 0x0410);
        const special = { 0xA8:'Ё', 0xB8:'ё', 0x84:'\u0404', 0x94:'\u0454',
                          0x86:'\u0406', 0x96:'\u0456', 0x87:'\u0407', 0x97:'\u0457',
                          0xAA:'\u0490', 0xBA:'\u0491' };
        return special[code] ?? '';
      })
      .replace(/[{}\\]/g, '');

    return _sanitizeHtml(`<p>${s.trim()}</p>`);
  }

  // ── EXPORT ──────────────────────────────────
  function exportRtf(html) {
    const div = document.createElement('div');
    div.innerHTML = html;
    let body = '';
    div.childNodes.forEach(n => { body += _nodeToRtf(n); });

    return [
      '{\\rtf1\\ansi\\ansicpg1251\\uc1\\deff0',
      '{\\fonttbl',
      '{\\f0\\froman\\fcharset204 Times New Roman;}',
      '{\\f1\\fswiss\\fcharset204 Arial;}',
      '{\\f2\\fswiss\\fcharset204 Calibri;}',
      '}',
      '{\\colortbl;\\red0\\green0\\blue0;}',
      '\\widowctrl\\hyphauto\\f1\\fs28',
      body,
      '}',
    ].join('\n');
  }

  function _nodeToRtf(node) {
    if (node.nodeType === Node.TEXT_NODE) return _encodeRtf(node.textContent);
    if (node.nodeType !== Node.ELEMENT_NODE) return '';

    const tag = node.tagName.toLowerCase();
    const inner = () => Array.from(node.childNodes).map(_nodeToRtf).join('');

    const headings = {
      h1: '\\pard\\sb240\\sa120\\b\\fs48 ',
      h2: '\\pard\\sb200\\sa100\\b\\fs40 ',
      h3: '\\pard\\sb160\\sa80\\b\\fs32 ',
      h4: '\\pard\\sb120\\sa60\\b\\fs28 ',
    };

    switch (tag) {
      case 'b': case 'strong': return `{\\b ${inner()}}`;
      case 'i': case 'em':    return `{\\i ${inner()}}`;
      case 'u':               return `{\\ul ${inner()}}`;
      case 's': case 'strike':return `{\\strike ${inner()}}`;
      case 'h1': case 'h2': case 'h3': case 'h4':
        return `${headings[tag]}${inner()}{\\b0}\\par\n`;
      case 'p':  return `\\pard\\sa160 ${inner()}\\par\n`;
      case 'br': return '\\line\n';
      case 'li': return `\\pard\\sa100 \\bullet  ${inner()}\\par\n`;
      case 'blockquote': return `\\pard\\li720\\sa160 ${inner()}\\par\n`;
      case 'hr': return '\\pard\\brdrb\\brdrs\\brdrw10 \\par\n';
      default:   return inner();
    }
  }

  function _encodeRtf(text) {
    return Array.from(text).map(ch => {
      const code = ch.charCodeAt(0);
      if (code < 128) {
        if (ch === '\\') return '\\\\';
        if (ch === '{')  return '\\{';
        if (ch === '}')  return '\\}';
        return ch;
      }
      return `\\u${code}?`;
    }).join('');
  }

  // Мінімальний sanitize без DOMParser (бо formats/ не повинні залежати від UI)
  function _sanitizeHtml(html) {
    // Просто прибираємо script/on* — достатньо для rtf→html
    return html
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
      .replace(/ on\w+="[^"]*"/gi, '');
  }

  return { importRtf, exportRtf };
})();
