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

  // Однобайтові знаки кодової сторінки 1251 ('xx поза основною кирилицею А–я).
  const CP1251_EXTRA = {
    0x84: '„', 0x85: '…', 0x91: '‘', 0x92: '’', 0x93: '“', 0x94: '”', 0x96: '–', 0x97: '—',
    0xA5: 'Ґ', 0xA8: 'Ё', 0xAA: 'Є', 0xAB: '«', 0xAF: 'Ї', 0xB2: 'І', 0xB3: 'і', 0xB4: 'ґ',
    0xB8: 'ё', 0xB9: '№', 0xBA: 'є', 0xBB: '»', 0xBF: 'ї'
  };

  function _decodeCp1251(code) {
    if (code >= 0xC0 && code <= 0xFF) return String.fromCharCode(code - 0xC0 + 0x0410);
    return CP1251_EXTRA[code] ?? '';
  }

  // Символи, що мають значення в HTML чи в синтаксисі RTF, після декодування пишемо сутностями,
  // щоб наступні заміни не прийняли їх за розмітку.
  function _htmlChar(ch) {
    return { '<': '&lt;', '>': '&gt;', '&': '&amp;', '{': '&#123;', '}': '&#125;', '\\': '&#92;' }[ch] || ch;
  }

  // Юнікодні символи RTF: uN — 16-бітне ціле зі знаком (від'ємне — код понад 32767). Після нього
  // стоять замінні символи для старих читачів; їх кількість задає ucN (типово 1), а замінним
  // символом вважається один знак або одна послідовність 'xx. Екранований зворотний скісний
  // лишається для наступних замін.
  function _decodeUnicodeEscapes(source) {
    const pattern = /\\(?:uc(\d+) ?|u(-?\d+) ?|\\)/g;
    let result = '';
    let index = 0;
    let fallback = 1;
    let match;
    while ((match = pattern.exec(source))) {
      result += source.slice(index, match.index);
      index = pattern.lastIndex;
      if (match[1] !== undefined) {
        fallback = Math.min(Number(match[1]), 8);
      } else if (match[2] !== undefined) {
        const code = Number(match[2]);
        if (code >= -32768 && code <= 65535) result += _htmlChar(String.fromCharCode(code < 0 ? code + 65536 : code));
        for (let skipped = 0; skipped < fallback && index < source.length; skipped += 1) {
          if (source[index] === '\\' && source[index + 1] === "'") index += 4;
          else if (source[index] === '\\' || source[index] === '{' || source[index] === '}') break;
          else index += 1;
        }
        pattern.lastIndex = index;
      } else {
        result += match[0];
      }
    }
    return result + source.slice(index);
  }

  function _rtfToHtml(rtf) {
    let s = _decodeUnicodeEscapes(rtf)
      .replace(/\{\\fonttbl[^}]*\}/g, '')
      .replace(/\{\\colortbl[^}]*\}/g, '')
      .replace(/\{\\stylesheet(?:[^{}]|\{[^}]*\})*\}/g, '')
      .replace(/\{\\info(?:[^{}]|\{[^}]*\})*\}/g, '')
      // Службові групи без вкладених (на кшталт *generator), але не сама група документа rtf1:
      // інакше документ без вкладених груп зникав повністю.
      .replace(/\{\\(?!rtf)[^{}]*\}/g, '')
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
          // Розділи RTF не переносяться: новий розділ стає розривом сторінки.
          '\\sect':     '</p><hr style="break-after: page;"><p>',
          '\\tab':      '&nbsp;&nbsp;&nbsp;&nbsp;',
          '\\pard':     '', '\\plain': '',
        };
        // Розмір шрифту (fsN) не переносимо: заміна без розбору груп не знає, де розмір
        // закінчується, і відкритий span лишався незакритим.
        return map[key] ?? '';
      })
      // Escaped символи 'xx — однобайтові знаки кодової сторінки 1251.
      .replace(/\\'([0-9a-fA-F]{2})/g, (_, hex) => _decodeCp1251(parseInt(hex, 16)))
      .replace(/[{}\\]/g, '');

    return _sanitizeHtml(`<p>${s.trim()}</p>`);
  }

  // ── EXPORT ──────────────────────────────────
  function exportRtf(html, meta = {}) {
    const div = document.createElement('div');
    div.innerHTML = html;
    let body = '';
    const documentPage = _sectionSettings(null, meta);
    const context = { tocTabTwips: _contentWidthTwips(meta), section: documentPage };
    div.childNodes.forEach(n => { body += _nodeToRtf(n, context); });
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
      _pageGeometryRtf(documentPage, false),
      // Колонки першого розділу — властивість розділу, тож задаються через \sectd.
      ...(documentPage.columns > 1 ? [`\\sectd${_columnsRtf(documentPage)}`] : []),
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

  const PAGE_SIZES_CM = { a4: [21, 29.7], a5: [14.8, 21], letter: [21.6, 27.9] };
  const RTF_LINE_END = String.fromCharCode(10);

  // Ширина тексту між полями у twips — позиція правої табуляції для номерів змісту.
  function _contentWidthTwips(meta = {}) {
    const [width, height] = PAGE_SIZES_CM[meta.pageSize] || PAGE_SIZES_CM.a4;
    const pageWidth = meta.orientation === 'landscape' ? height : width;
    const left = Number(meta.margins?.left ?? 3) || 0;
    const right = Number(meta.margins?.right ?? 1.5) || 0;
    return Math.max(720, Math.round((pageWidth - left - right) * 1440 / 2.54));
  }

  const CM_TO_TWIPS = 1440 / 2.54;

  // Налаштування розділу з data-art-section: «орієнтація розмір top right bottom left» (см);
  // невідоме береться з попереднього розділу.
  function _sectionSettings(value, previous = {}) {
    const [orientation, pageSize, ...values] = String(value || '').trim().split(/\s+/);
    const base = { top: 2, right: 1.5, bottom: 2, left: 3, ...(previous.margins || {}) };
    const margins = {};
    ['top', 'right', 'bottom', 'left'].forEach((side, index) => {
      const numeric = Number(values[index]);
      margins[side] = values[index] !== undefined && values[index] !== '' && Number.isFinite(numeric) ? numeric : Number(base[side]);
    });
    // Колонки: п'ятий числовий токен розділу; для документа (value відсутнє) — з налаштувань документа.
    const columnsRaw = values[4] !== undefined ? values[4] : (value ? 1 : previous.columns);
    const columnsValue = Math.round(Number(columnsRaw));
    return {
      orientation: ['portrait', 'landscape'].includes(orientation) ? orientation : (previous.orientation === 'landscape' ? 'landscape' : 'portrait'),
      pageSize: Object.prototype.hasOwnProperty.call(PAGE_SIZES_CM, pageSize) ? pageSize
        : (Object.prototype.hasOwnProperty.call(PAGE_SIZES_CM, previous.pageSize) ? previous.pageSize : 'a4'),
      margins,
      columns: Number.isFinite(columnsValue) && columnsValue >= 1 ? Math.min(3, columnsValue) : 1
    };
  }

  // Колонки розділу RTF із проміжком 1,25 см (708 twips).
  function _columnsRtf(settings) {
    return settings.columns > 1 ? `\\cols${settings.columns}\\colsx${Math.round(1.25 * CM_TO_TWIPS)}` : '';
  }

  // Розмір аркуша й поля у twips: для документа (\paperw…) або для розділу (\pgwsxn…).
  function _pageGeometryRtf(settings, section) {
    const [width, height] = PAGE_SIZES_CM[settings.pageSize] || PAGE_SIZES_CM.a4;
    const landscape = settings.orientation === 'landscape';
    const twips = cm => Math.round(cm * CM_TO_TWIPS);
    const w = twips(landscape ? height : width);
    const h = twips(landscape ? width : height);
    const m = settings.margins;
    if (section) {
      return `${landscape ? '\\lndscpsxn' : ''}\\pgwsxn${w}\\pghsxn${h}\\marglsxn${twips(m.left)}\\margrsxn${twips(m.right)}\\margtsxn${twips(m.top)}\\margbsxn${twips(m.bottom)}`;
    }
    return `\\paperw${w}\\paperh${h}\\margl${twips(m.left)}\\margr${twips(m.right)}\\margt${twips(m.top)}\\margb${twips(m.bottom)}${landscape ? '\\landscape' : ''}`;
  }

  // Розрив розділу: \sect і властивості наступного розділу.
  function _sectionRtf(node, context) {
    const settings = _sectionSettings(node.getAttribute('data-art-section'), context.section || {});
    context.section = settings;
    context.tocTabTwips = _contentWidthTwips(settings);
    return `\\sect\\sectd${_pageGeometryRtf(settings, true)}${_columnsRtf(settings)}${RTF_LINE_END}`;
  }

  // Зміст — текст: назва по центру, пункт — назва, крапкова табуляція й номер праворуч.
  function _tocRtf(node, context) {
    const kind = node.getAttribute('data-art-toc');
    const spans = node.querySelectorAll(':scope > span');
    const text = _encodeRtf((node.textContent || '').trim());
    if (kind === 'title') return `\\pard\\qc\\sa160{\\b\\fs32 ${text}}\\par${RTF_LINE_END}`;
    if (!/^[1-4]$/.test(kind || '') || spans.length < 2) return `\\pard\\sa120 ${text}\\par${RTF_LINE_END}`;
    const indent = (Number(kind) - 1) * 360;
    const label = _encodeRtf(spans[0].textContent.trim());
    const page = _encodeRtf(spans[spans.length - 1].textContent.trim());
    return `\\pard\\li${indent}\\sa60\\tqr\\tldot\\tx${context?.tocTabTwips || 9354} ${label}\\tab ${page}\\par${RTF_LINE_END}`;
  }

  function _nodeToRtf(node, context = {}) {
    if (node.nodeType === Node.TEXT_NODE) return _encodeRtf(node.textContent);
    if (node.nodeType !== Node.ELEMENT_NODE) return '';

    const tag = node.tagName.toLowerCase();
    const inner = () => Array.from(node.childNodes).map(child => _nodeToRtf(child, context)).join('');

    const headings = {
      h1: '\\pard\\sb240\\sa120\\b\\fs48 ',
      h2: '\\pard\\sb200\\sa100\\b\\fs40 ',
      h3: '\\pard\\sb160\\sa80\\b\\fs32 ',
      h4: '\\pard\\sb120\\sa60\\b\\fs28 ',
    };

    if (tag === 'p' && node.hasAttribute('data-art-toc')) return _tocRtf(node, context);
    if (tag === 'hr' && node.hasAttribute('data-art-section')
      && (node.style.breakAfter === 'page' || node.style.pageBreakAfter === 'always')) return _sectionRtf(node, context);

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

  // Не-ASCII записується як uN по одиницях UTF-16 (символ поза BMP — сурогатною парою). RTF читає
  // N як 16-бітне ціле зі знаком, тож коди понад 32767 стають від'ємними; «?» — замінний символ.
  function _encodeRtf(text) {
    const source = String(text);
    let out = '';
    for (let index = 0; index < source.length; index += 1) {
      const ch = source[index];
      const code = source.charCodeAt(index);
      if (code < 128) {
        if (ch === '\\') out += '\\\\';
        else if (ch === '{') out += '\\{';
        else if (ch === '}') out += '\\}';
        else out += ch;
      } else {
        out += `\\u${code > 32767 ? code - 65536 : code}?`;
      }
    }
    return out;
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
