'use strict';
/* formats/rtf.js — базовий RTF імпорт/експорт з підтримкою кирилиці */

const ArtRtf = (() => {

  // ── IMPORT ──────────────────────────────────
  function importRtf(file) {
    return new Promise((resolve, reject) => {
      const fr = new FileReader();
      fr.onload = () => {
        try {
          const { rtf, headerFooter } = _extractHeaderFooter(fr.result);
          const html = _rtfToHtml(rtf);
          resolve({ html, meta: { format: 'rtf', fileName: file.name, ...(headerFooter ? { headerFooter } : {}) } });
        } catch (e) {
          reject(e);
        }
      };
      fr.onerror = () => reject(new Error('Не вдалося прочитати файл'));
      fr.readAsText(file, 'utf-8');
    });
  }

  // Групи колонтитулів ({\header …}, {\footerl …} тощо) — не текст документа: вирізаємо їх
  // цілими, з вкладеними групами. Звичайні \header і \footer стають колонтитулами редактора.
  function _extractHeaderFooter(source) {
    let rtf = String(source || '');
    const bands = {};
    for (let guard = 0; guard < 64; guard += 1) {
      const found = _findBandGroup(rtf);
      if (!found) break;
      if (!(found.word in bands)) bands[found.word] = rtf.slice(found.start, found.end);
      rtf = rtf.slice(0, found.start) + rtf.slice(found.end);
    }
    const header = bands.header ?? bands.headerr;
    const footer = bands.footer ?? bands.footerr;
    if (header === undefined && footer === undefined) return { rtf, headerFooter: null };
    const hasPageField = group => !!group && /fldinst[^}]*PAGE/.test(group);
    return {
      rtf,
      headerFooter: {
        header: _bandText(header),
        footer: _bandText(footer),
        pageNumber: hasPageField(footer) ? 'footer' : hasPageField(header) ? 'header' : 'none'
      }
    };
  }

  function _findBandGroup(rtf) {
    const match = /\{\\((?:header|footer)[lrf]?)(?![a-z])/.exec(rtf);
    if (!match) return null;
    let depth = 0;
    for (let index = match.index; index < rtf.length; index += 1) {
      const ch = rtf[index];
      if (ch === '\\') { index += 1; continue; }
      if (ch === '{') depth += 1;
      else if (ch === '}' && --depth === 0) return { word: match[1], start: match.index, end: index + 1 };
    }
    return { word: match[1], start: match.index, end: rtf.length };
  }

  // Текст колонтитула без поля номера, керівних слів і дужок; \uN? — символ Unicode.
  function _bandText(group) {
    if (!group) return '';
    return group
      .replace(/\{\\\*\\fldinst[^}]*\}/g, '')
      .replace(/\{\\fldrslt[^}]*\}/g, '')
      .replace(/\\u(-?\d+)\??/g, (_, code) => String.fromCharCode(Number(code) < 0 ? Number(code) + 65536 : Number(code)))
      .replace(/\\'[0-9a-fA-F]{2}/g, '')
      .replace(/\\[a-z]+-?\d* ?/gi, ' ')
      .replace(/\\([{}\\])/g, '$1')
      .replace(/[{}]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
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
          '\\page':     '</p><hr style="break-after: page;"><p>',
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
  function exportRtf(html, meta = {}) {
    const div = document.createElement('div');
    div.innerHTML = html;
    let body = '';
    div.childNodes.forEach(n => { body += _nodeToRtf(n); });
    const bands = _headerFooterRtf(meta.headerFooter);

    return [
      '{\\rtf1\\ansi\\ansicpg1251\\uc1\\deff0',
      '{\\fonttbl',
      '{\\f0\\froman\\fcharset204 Times New Roman;}',
      '{\\f1\\fswiss\\fcharset204 Arial;}',
      '{\\f2\\fswiss\\fcharset204 Calibri;}',
      '}',
      '{\\colortbl;\\red0\\green0\\blue0;}',
      '\\widowctrl\\hyphauto\\f1\\fs28',
      ...(bands ? [bands] : []),
      body,
      '}',
    ].join('\n');
  }

  // Колонтитули всього документа: текст по центру, номер сторінки — поле PAGE праворуч.
  function _headerFooterRtf(value) {
    const settings = ArtState.normalizeHeaderFooter(value);
    const band = (word, text, withNumber) => {
      if (!text && !withNumber) return '';
      const parts = [];
      if (text) parts.push(`\\pard\\qc\\f0\\fs22 ${_encodeRtf(text)}\\par`);
      if (withNumber) parts.push('\\pard\\qr\\f0\\fs22 {\\field{\\*\\fldinst PAGE}{\\fldrslt 1}}\\par');
      return `{\\${word}${parts.join('')}}`;
    };
    return [
      band('header', settings.header, settings.pageNumber === 'header'),
      band('footer', settings.footer, settings.pageNumber === 'footer')
    ].filter(Boolean).join('\n');
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
      case 'hr':
        // Явний розрив сторінки редактора → \page; звичайна лінія — нижня межа абзацу.
        if (node.style.breakAfter === 'page' || node.style.pageBreakAfter === 'always') return '\\page\n';
        return '\\pard\\brdrb\\brdrs\\brdrw10 \\par\n';
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
