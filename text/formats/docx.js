'use strict';
/* formats/docx.js — .docx імпорт/експорт */

const ArtDocx = (() => {
  const MAX_IMPORTED_DOM_NODES = 50_000;
  const MAX_IMPORTED_TEXT_CHARS = 5 * 1024 * 1024;
  const MAX_IMPORTED_IMAGES = 100;
  const PAGE_SIZES_TWIPS = {
    a4: { width: 11906, height: 16838 },
    a5: { width: 8391, height: 11906 },
    letter: { width: 12240, height: 15840 }
  };
  const DEFAULT_MARGINS_CM = { top: 2, right: 1.5, bottom: 2, left: 3 };
  const CM_TO_TWIPS = 1440 / 2.54;
  // document.xml більшого розміру не розпаковуємо лише заради підрахунку розділів.
  const MAX_SECTION_SCAN_BYTES = 64 * 1024 * 1024;

  function importDocx(file) {
    if (typeof mammoth === 'undefined') return Promise.reject(new Error('Бібліотека mammoth.js не завантажена'));
    return new Promise((resolve, reject) => {
      const fr = new FileReader();
      fr.onload = async () => {
        try {
          const directory = _zipDirectory(fr.result);
          const notices = [];
          if (directory.some(entry => /^word\/(header|footer)\d*\.xml$/i.test(entry.name))) {
            notices.push('Колонтитули й номери сторінок із цього .docx не переносяться в ПЛЮС Текст. Задайте їх заново: «Вставка → Колонтитули й номери сторінок».');
          }
          if (await _countSections(fr.result, directory) > 1) {
            notices.push('Розділи з власною орієнтацією, папером чи полями з цього .docx не переносяться в ПЛЮС Текст: документ відкрито одним розділом. Розриви розділів додайте заново: «Вставка → Розрив розділу».');
          }
          const result = await mammoth.convertToHtml({ arrayBuffer: fr.result }, {
            styleMap: [
              "p[style-name='Heading 1'] => h1:fresh",
              "p[style-name='Heading 2'] => h2:fresh",
              "p[style-name='Heading 3'] => h3:fresh",
              "p[style-name='Заголовок 1'] => h1:fresh",
              "p[style-name='Заголовок 2'] => h2:fresh",
              "p[style-name='Заголовок 3'] => h3:fresh"
            ],
            // Розрив сторінки Word → позначка в тексті → явний розрив редактора (_mapPageBreaks).
            // styleMap тут не підходить: у цій версії Mammoth правило br[type='page']
            // застосовується й до звичайних розривів рядка.
            transformDocument: mammoth.transforms?.run ? mammoth.transforms.run(_markPageBreaks) : undefined
          });
          const html = ArtSanitize.clean(_mapPageBreaks(result.value));
          _validateConvertedHtml(html);
          resolve({ html, meta: { format: 'docx', fileName: file.name, warnings: result.messages || [], notices } });
        } catch (e) {
          reject(new Error('Не вдалося прочитати .docx: ' + (e.message || e)));
        }
      };
      fr.onerror = () => reject(new Error('Не вдалося прочитати файл'));
      fr.readAsArrayBuffer(file);
    });
  }

  // Mammoth не читає колонтитулів і розділів. Центральний каталог ZIP дає імена частин
  // (їх видно без розпакування), спосіб стиснення, розміри й зсув локального заголовка.
  function _zipDirectory(buffer) {
    const entries = [];
    try {
      const view = new DataView(buffer);
      const bytes = buffer.byteLength;
      const decoder = new TextDecoder();
      for (let end = bytes - 22; end >= Math.max(0, bytes - 65557); end -= 1) {
        if (view.getUint32(end, true) !== 0x06054b50) continue;
        const count = view.getUint16(end + 10, true);
        let offset = view.getUint32(end + 16, true);
        for (let index = 0; index < count && offset + 46 <= bytes; index += 1) {
          if (view.getUint32(offset, true) !== 0x02014b50) break;
          const nameLength = view.getUint16(offset + 28, true);
          if (offset + 46 + nameLength > bytes) break;
          entries.push({
            name: decoder.decode(new Uint8Array(buffer, offset + 46, nameLength)),
            method: view.getUint16(offset + 10, true),
            compressedSize: view.getUint32(offset + 20, true),
            size: view.getUint32(offset + 24, true),
            localOffset: view.getUint32(offset + 42, true)
          });
          offset += 46 + nameLength + view.getUint16(offset + 30, true) + view.getUint16(offset + 32, true);
        }
        break;
      }
    } catch {
      // Пошкоджений каталог: Mammoth сам повідомить про помилку формату.
    }
    return entries;
  }

  async function _zipEntryText(buffer, entry) {
    const view = new DataView(buffer);
    if (entry.localOffset + 30 > buffer.byteLength) return '';
    const start = entry.localOffset + 30 + view.getUint16(entry.localOffset + 26, true) + view.getUint16(entry.localOffset + 28, true);
    if (start + entry.compressedSize > buffer.byteLength) return '';
    const bytes = new Uint8Array(buffer, start, entry.compressedSize);
    if (entry.method === 0) return new TextDecoder().decode(bytes);
    if (entry.method !== 8 || typeof DecompressionStream !== 'function') return '';
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
    return new Response(stream).text();
  }

  // Кількість розділів Word — елементи w:sectPr у document.xml.
  async function _countSections(buffer, directory) {
    const entry = directory.find(item => item.name === 'word/document.xml');
    if (!entry || entry.size > MAX_SECTION_SCAN_BYTES) return 0;
    try {
      return ((await _zipEntryText(buffer, entry)).match(/<w:sectPr[\s>/]/g) || []).length;
    } catch {
      return 0;
    }
  }

  // Налаштування розділу з data-art-section: «орієнтація розмір top right bottom left» (см).
  function _sectionMeta(node, previous = {}) {
    const [orientation, pageSize, ...values] = String(node.getAttribute('data-art-section') || '').trim().split(/\s+/);
    const base = { ...DEFAULT_MARGINS_CM, ...(previous.margins || {}) };
    const margins = {};
    ['top', 'right', 'bottom', 'left'].forEach((side, index) => {
      const numeric = Number(values[index]);
      margins[side] = values[index] !== undefined && values[index] !== '' && Number.isFinite(numeric) ? numeric : Number(base[side]);
    });
    return {
      orientation: ['portrait', 'landscape'].includes(orientation) ? orientation : (previous.orientation === 'landscape' ? 'landscape' : 'portrait'),
      pageSize: Object.prototype.hasOwnProperty.call(PAGE_SIZES_TWIPS, pageSize) ? pageSize : (previous.pageSize || 'a4'),
      margins
    };
  }

  // Позначка розриву сторінки: невидимі роздільники навколо тексту, якого немає в документах.
  const PAGE_BREAK_MARKER = `${String.fromCharCode(0x2063)}ART-PAGE-BREAK${String.fromCharCode(0x2063)}`;

  function _markPageBreaks(run) {
    const children = (run.children || []).map(child => (
      child.type === 'break' && child.breakType === 'page' ? { type: 'text', value: PAGE_BREAK_MARKER } : child
    ));
    return { ...run, children };
  }

  // Абзац із позначкою ділимо в її місці: текст до — свій абзац, далі явний розрив редактора
  // (форма, що проходить санітайзер), текст після — новий абзац того ж типу. Порожні половини
  // прибираємо. Розрив усередині таблиці чи списку Word не переносимо — лише знімаємо позначку.
  function _mapPageBreaks(html) {
    const template = document.createElement('template');
    template.innerHTML = html;
    const root = template.content;
    const owner = root.ownerDocument;
    const splittable = new Set(['P', 'DIV', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'BLOCKQUOTE']);
    const findMarker = () => {
      const walker = owner.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      let node;
      while ((node = walker.nextNode())) {
        if (node.data.includes(PAGE_BREAK_MARKER)) return node;
      }
      return null;
    };

    for (let marker = findMarker(), guard = 0; marker && guard < MAX_IMPORTED_DOM_NODES; marker = findMarker(), guard += 1) {
      const offset = marker.data.indexOf(PAGE_BREAK_MARKER);
      marker.deleteData(offset, PAGE_BREAK_MARKER.length);
      let block = marker.parentNode;
      while (block && block.parentNode !== root) block = block.parentNode;
      if (!block || block.nodeType !== Node.ELEMENT_NODE || !splittable.has(block.tagName)) continue;

      const after = owner.createRange();
      after.setStart(marker, offset);
      after.setEnd(block, block.childNodes.length);
      const tail = block.cloneNode(false);
      tail.appendChild(after.extractContents());
      const pageBreak = owner.createElement('hr');
      pageBreak.setAttribute('style', 'break-after: page;');
      block.after(pageBreak);
      if ((tail.textContent || '').trim() || tail.querySelector('img')) pageBreak.after(tail);
      if (!(block.textContent || '').trim() && !block.querySelector('img')) block.remove();
    }
    return template.innerHTML;
  }

  function _validateConvertedHtml(html) {
    const template = document.createElement('template');
    template.innerHTML = html;
    const walker = document.createTreeWalker(template.content, NodeFilter.SHOW_ALL);
    let nodes = 0;
    while (walker.nextNode()) {
      nodes += 1;
      if (nodes > MAX_IMPORTED_DOM_NODES) {
        throw new Error(`DOCX містить забагато елементів. Максимум — ${MAX_IMPORTED_DOM_NODES}.`);
      }
    }
    if ((template.content.textContent || '').length > MAX_IMPORTED_TEXT_CHARS) {
      throw new Error('DOCX містить забагато тексту для безпечного відкриття.');
    }
    if (template.content.querySelectorAll('img').length > MAX_IMPORTED_IMAGES) {
      throw new Error(`DOCX містить забагато зображень. Максимум — ${MAX_IMPORTED_IMAGES}.`);
    }
  }

  async function exportDocx(html, meta = {}) {
    if (typeof docx === 'undefined') throw new Error('Бібліотека docx.js не завантажена');
    const { Document, Packer, Paragraph, TextRun, ImageRun, HeadingLevel, AlignmentType, UnderlineType, PageOrientation, Table, TableRow, TableCell, WidthType, PageBreak, Header, Footer, Tab, TabStopType, LeaderType, PageNumber } = docx;
    const div = document.createElement('div');
    div.innerHTML = html;
    // Розриви розділів ділять документ на розділи Word, кожен зі своєю геометрією.
    const sectionList = [{ meta, children: [] }];
    let children = sectionList[0].children;

    function css(node, prop) {
      return (node.style && node.style[prop]) || '';
    }

    function collectRuns(node, fmt = {}) {
      if (node.nodeType === Node.TEXT_NODE) {
        const text = node.textContent || '';
        return text ? [new TextRun({
          text,
          bold: fmt.bold,
          italics: fmt.italics,
          underline: fmt.underline ? { type: UnderlineType.SINGLE } : undefined,
          strike: fmt.strike,
          font: fmt.font,
          size: fmt.size,
          color: fmt.color,
          highlight: fmt.highlight
        })] : [];
      }
      if (node.nodeType !== Node.ELEMENT_NODE) return [];
      const tag = node.tagName.toLowerCase();
      if (tag === 'br') return [new TextRun({ text: '', break: 1 })];
      if (tag === 'img') {
        const imgRun = _imageRunFromNode(node, ImageRun);
        return imgRun ? [imgRun] : [];
      }
      const next = {
        bold: fmt.bold || ['b','strong'].includes(tag),
        italics: fmt.italics || ['i','em'].includes(tag),
        underline: fmt.underline || tag === 'u',
        strike: fmt.strike || ['s','strike'].includes(tag),
        font: node.style.fontFamily || fmt.font,
        size: _ptToHalfPt(node.style.fontSize) || fmt.size,
        color: _cssColorToHex(node.style.color) || fmt.color,
        highlight: node.style.backgroundColor ? 'yellow' : fmt.highlight
      };
      return [...node.childNodes].flatMap(ch => collectRuns(ch, next));
    }

    function para(node, opts = {}) {
      return new Paragraph({
        children: collectRuns(node).length ? collectRuns(node) : [new TextRun('')],
        heading: opts.heading,
        alignment: _alignment(node.style.textAlign),
        indent: node.style.marginLeft ? { left: Math.round(parseInt(node.style.marginLeft, 10) * 15) } : undefined
      });
    }

    const CELL_BLOCK_TAGS = ['P', 'DIV', 'H1', 'H2', 'H3', 'H4', 'BLOCKQUOTE', 'UL', 'OL'];

    function listParagraphs(listNode) {
      const tag = listNode.tagName.toLowerCase();
      return [...listNode.children].map(li => new Paragraph({
        children: collectRuns(li).length ? collectRuns(li) : [new TextRun('')],
        bullet: tag === 'ul' ? { level: 0 } : undefined,
        numbering: tag === 'ol' ? { reference: 'numbered-list', level: 0 } : undefined
      }));
    }

    // Клітинка може містити кілька абзаців, заголовок або список — кожен із них
    // має лишитися окремим абзацом у .docx, а не злитися в один рядок тексту.
    function cellParagraphs(cell) {
      const blocks = [...cell.children].filter(child => CELL_BLOCK_TAGS.includes(child.tagName));
      if (!blocks.length) return [para(cell)];

      const paragraphs = [];
      blocks.forEach(block => {
        const tag = block.tagName.toLowerCase();
        if (tag === 'ul' || tag === 'ol') paragraphs.push(...listParagraphs(block));
        else if (['h1', 'h2', 'h3', 'h4'].includes(tag)) paragraphs.push(para(block, { heading: HeadingLevel[`HEADING_${tag.slice(1)}`] }));
        else paragraphs.push(para(block));
      });
      return paragraphs.length ? paragraphs : [para(cell)];
    }

    function cellWidth(cell, columns) {
      const raw = cell.style.width || '';
      const value = parseFloat(raw);
      if (value && raw.trim().endsWith('%')) {
        return { size: value, type: WidthType.PERCENTAGE };
      }
      // 1 px при 96 dpi = 15 twips (1440 twips на дюйм).
      if (value) return { size: Math.round(value * 15), type: WidthType.DXA };
      return { size: 100 / Math.max(1, columns), type: WidthType.PERCENTAGE };
    }

    function tableFromNode(tableNode) {
      const rowNodes = [...tableNode.querySelectorAll('tr')];
      const rows = rowNodes.map((tr, rowIndex) => {
        const cells = [...tr.children];
        const isHeader = rowIndex === 0 && cells.length > 0 && cells.every(cell => cell.tagName === 'TH');
        return new TableRow({
          // Рядок заголовків Word повторює на кожній сторінці — так само, як це
          // робить пагінатор редактора.
          tableHeader: isHeader ? true : undefined,
          children: cells.map(cell => new TableCell({
            width: cellWidth(cell, cells.length),
            columnSpan: cell.colSpan > 1 ? cell.colSpan : undefined,
            rowSpan: cell.rowSpan > 1 ? cell.rowSpan : undefined,
            shading: _cellShading(cell),
            children: cellParagraphs(cell)
          }))
        });
      });
      return new Table({ rows, width: { size: 100, type: WidthType.PERCENTAGE } });
    }

    function pageGeometry(sectionMeta) {
      const isLandscape = sectionMeta.orientation === 'landscape';
      const baseSize = PAGE_SIZES_TWIPS[sectionMeta.pageSize] || PAGE_SIZES_TWIPS.a4;
      const size = isLandscape
        ? { orientation: PageOrientation.LANDSCAPE, width: baseSize.height, height: baseSize.width }
        : { width: baseSize.width, height: baseSize.height };
      const sourceMargins = { ...DEFAULT_MARGINS_CM, ...(sectionMeta.margins || {}) };
      const margin = Object.fromEntries(
        Object.entries(sourceMargins).map(([side, cm]) => [side, Math.round(Number(cm) * CM_TO_TWIPS)])
      );
      return { size, margin, contentWidth: Math.max(1, size.width - margin.left - margin.right) };
    }
    // Ширина тексту поточного розділу — для правої табуляції пунктів змісту.
    let contentWidth = pageGeometry(meta).contentWidth;

    // Зміст — звичайний текст: назва по центру, пункт — назва, крапкова табуляція й номер праворуч.
    // Поле TOC Word не створюємо: номери взято з розкладки ПЛЮС Тексту (див. describeExportLimits).
    function tocParagraph(node) {
      const kind = node.getAttribute('data-art-toc');
      const spans = node.querySelectorAll(':scope > span');
      if (kind === 'title') {
        return new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: (node.textContent || '').trim(), bold: true, size: 32 })] });
      }
      if (!/^[1-4]$/.test(kind || '') || spans.length < 2) {
        return new Paragraph({ children: [new TextRun({ text: (node.textContent || '').trim(), italics: kind === 'empty' })] });
      }
      return new Paragraph({
        indent: { left: (Number(kind) - 1) * 360 },
        tabStops: [{ type: TabStopType.RIGHT, position: contentWidth, leader: LeaderType.DOT }],
        children: [new TextRun({ children: [spans[0].textContent.trim(), new Tab(), spans[spans.length - 1].textContent.trim()] })]
      });
    }

    [...div.childNodes].forEach(node => {
      if (node.nodeType !== Node.ELEMENT_NODE) {
        if ((node.textContent || '').trim()) children.push(new Paragraph({ children: collectRuns(node) }));
        return;
      }
      const tag = node.tagName.toLowerCase();
      if (tag === 'p' && node.hasAttribute('data-art-toc')) children.push(tocParagraph(node));
      else if (['p','div','blockquote'].includes(tag)) children.push(para(node));
      else if (['h1','h2','h3','h4'].includes(tag)) children.push(para(node, { heading: HeadingLevel[`HEADING_${tag.slice(1)}`] }));
      else if (tag === 'ul' || tag === 'ol') {
        [...node.children].forEach((li, idx) => children.push(new Paragraph({
          children: collectRuns(li).length ? collectRuns(li) : [new TextRun('')],
          bullet: tag === 'ul' ? { level: 0 } : undefined,
          numbering: tag === 'ol' ? { reference: 'numbered-list', level: 0 } : undefined
        })));
      } else if (tag === 'table') children.push(tableFromNode(node));
      else if (tag === 'img') { const imgRun = _imageRunFromNode(node, ImageRun); if (imgRun) children.push(new Paragraph({ children: [imgRun] })); }
      else if (tag === 'hr' && _isPageBreakNode(node) && node.hasAttribute('data-art-section')) {
        // Новий розділ Word сам починається з нової сторінки — окремий PageBreak не потрібен.
        const section = { meta: _sectionMeta(node, sectionList[sectionList.length - 1].meta), children: [] };
        sectionList.push(section);
        children = section.children;
        contentWidth = pageGeometry(section.meta).contentWidth;
      }
      else if (tag === 'hr' && _isPageBreakNode(node)) children.push(new Paragraph({ children: [new PageBreak()] }));
      else if (tag === 'hr') children.push(new Paragraph({ children: [new TextRun('────────────────────────')] }));
    });

    sectionList.forEach(section => {
      if (!section.children.length) section.children.push(new Paragraph({ children: [new TextRun('')] }));
    });

    // Колонтитул Word: текст по центру, номер сторінки (поле PAGE) праворуч — на табуляціях.
    // Колонтитули однакові для всіх розділів, але табуляції — за шириною кожного.
    const headerFooter = ArtState.normalizeHeaderFooter(meta.headerFooter);
    function band(Ctor, text, withNumber, width) {
      if (!text && !withNumber) return undefined;
      const runChildren = [new Tab(), text];
      if (withNumber) runChildren.push(new Tab(), PageNumber.CURRENT);
      return {
        default: new Ctor({
          children: [new Paragraph({
            tabStops: [
              { type: TabStopType.CENTER, position: Math.round(width / 2) },
              { type: TabStopType.RIGHT, position: width }
            ],
            children: [new TextRun({ children: runChildren, font: 'Times New Roman', size: 22 })]
          })]
        })
      };
    }

    const doc = new Document({
      numbering: {
        config: [{ reference: 'numbered-list', levels: [{ level: 0, format: 'decimal', text: '%1.', alignment: AlignmentType.START }] }]
      },
      sections: sectionList.map(section => {
        const geometry = pageGeometry(section.meta);
        const headers = band(Header, headerFooter.header, headerFooter.pageNumber === 'header', geometry.contentWidth);
        const footers = band(Footer, headerFooter.footer, headerFooter.pageNumber === 'footer', geometry.contentWidth);
        return {
          properties: { page: { size: geometry.size, margin: geometry.margin } },
          ...(headers ? { headers } : {}),
          ...(footers ? { footers } : {}),
          children: section.children
        };
      })
    });
    return Packer.toBlob(doc);
  }


  function _imageRunFromNode(node, ImageRunCtor) {
    const src = node.getAttribute('src') || '';
    const match = /^data:(image\/(png|jpeg|jpg|gif|webp));base64,(.+)$/i.exec(src);
    if (!match) return null;
    const data = Uint8Array.from(atob(match[3]), ch => ch.charCodeAt(0));
    const cssWidth = parseFloat(node.style.width || node.getAttribute('width') || '0') || Math.min(480, node.naturalWidth || 480);
    const naturalW = node.naturalWidth || cssWidth || 1;
    const naturalH = node.naturalHeight || Math.max(1, Math.round(cssWidth * 0.75));
    const width = Math.max(48, Math.round(cssWidth));
    const height = Math.max(48, Math.round(width * (naturalH / naturalW)));
    return new ImageRunCtor({ data, transformation: { width, height } });
  }

  // Явний розрив сторінки редактора: <hr style="break-after: page">.
  function _isPageBreakNode(node) {
    return node?.tagName === 'HR' && (node.style.breakAfter === 'page' || node.style.pageBreakAfter === 'always');
  }

  function _cellShading(cell) {
    const fill = _cssColorToHex(cell.style.backgroundColor);
    return fill ? { fill } : undefined;
  }

  function _ptToHalfPt(pt) { const m = /([\d.]+)pt/.exec(pt || ''); return m ? Math.round(parseFloat(m[1]) * 2) : undefined; }
  function _alignment(value) { return ({ center: docx.AlignmentType.CENTER, right: docx.AlignmentType.RIGHT, justify: docx.AlignmentType.JUSTIFIED }[value] || docx.AlignmentType.LEFT); }
  function _cssColorToHex(color) {
    if (!color) return undefined;
    if (/^#([0-9a-f]{6})$/i.test(color)) return color.slice(1);
    const rgb = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i.exec(color);
    if (!rgb) return undefined;
    return [rgb[1], rgb[2], rgb[3]]
      .map(part => Number(part).toString(16).padStart(2, '0'))
      .join('');
  }

  // Чесний перелік того, що формат .docx у нас поки спрощує. Редактор показує
  // його ДО збереження, щоб учитель не виявив втрату вже у Word.
  function describeExportLimits(html) {
    const box = document.createElement('div');
    box.innerHTML = html;
    const notes = [];

    if (box.querySelector('table table')) notes.push('вкладені таблиці збережено без внутрішньої таблиці');
    if (box.querySelector('table img')) notes.push('зображення в клітинках можуть змінити розмір');
    if (box.querySelector('td[style*="width"], th[style*="width"], td[style*="background"], th[style*="background"]')) {
      notes.push('ширина колонок і фон клітинок збережуться у Word, але можуть спроститися при повторному відкритті в ПЛЮС Тексті');
    }
    if ([...box.querySelectorAll('[style*="background-color"]')].some(el => !/^(td|th)$/i.test(el.tagName))) {
      notes.push('колір виділення тексту у Word стане жовтим');
    }
    if ([...box.querySelectorAll('hr')].some(hr => !_isPageBreakNode(hr))) notes.push('горизонтальну лінію замінено рядком символів');
    if (box.querySelector('[data-art-toc]')) {
      notes.push('зміст збережено як текст із номерами сторінок ПЛЮС Тексту: Word не оновлює його сам, і номери у Word можуть відрізнятися');
    }

    return notes;
  }

  return {
    importDocx,
    exportDocx,
    describeExportLimits,
    limits: {
      maxDomNodes: MAX_IMPORTED_DOM_NODES,
      maxTextChars: MAX_IMPORTED_TEXT_CHARS,
      maxImages: MAX_IMPORTED_IMAGES
    }
  };
})();
