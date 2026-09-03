'use strict';
/* formats/docx.js — .docx імпорт/експорт */

const ArtDocx = (() => {
  const PAGE_SIZES_TWIPS = {
    a4: { width: 11906, height: 16838 },
    a5: { width: 8391, height: 11906 },
    letter: { width: 12240, height: 15840 }
  };
  const DEFAULT_MARGINS_CM = { top: 2, right: 1.5, bottom: 2, left: 3 };
  const CM_TO_TWIPS = 1440 / 2.54;

  function importDocx(file) {
    if (typeof mammoth === 'undefined') return Promise.reject(new Error('Бібліотека mammoth.js не завантажена'));
    return new Promise((resolve, reject) => {
      const fr = new FileReader();
      fr.onload = async () => {
        try {
          const result = await mammoth.convertToHtml({ arrayBuffer: fr.result }, {
            styleMap: [
              "p[style-name='Heading 1'] => h1:fresh",
              "p[style-name='Heading 2'] => h2:fresh",
              "p[style-name='Heading 3'] => h3:fresh",
              "p[style-name='Заголовок 1'] => h1:fresh",
              "p[style-name='Заголовок 2'] => h2:fresh",
              "p[style-name='Заголовок 3'] => h3:fresh"
            ]
          });
          resolve({ html: ArtSanitize.clean(result.value), meta: { format: 'docx', fileName: file.name, warnings: result.messages || [] } });
        } catch (e) {
          reject(new Error('Не вдалося прочитати .docx: ' + (e.message || e)));
        }
      };
      fr.onerror = () => reject(new Error('Не вдалося прочитати файл'));
      fr.readAsArrayBuffer(file);
    });
  }

  async function exportDocx(html, meta = {}) {
    if (typeof docx === 'undefined') throw new Error('Бібліотека docx.js не завантажена');
    const { Document, Packer, Paragraph, TextRun, ImageRun, HeadingLevel, AlignmentType, UnderlineType, PageOrientation, Table, TableRow, TableCell, WidthType } = docx;
    const div = document.createElement('div');
    div.innerHTML = html;
    const children = [];

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

    [...div.childNodes].forEach(node => {
      if (node.nodeType !== Node.ELEMENT_NODE) {
        if ((node.textContent || '').trim()) children.push(new Paragraph({ children: collectRuns(node) }));
        return;
      }
      const tag = node.tagName.toLowerCase();
      if (['p','div','blockquote'].includes(tag)) children.push(para(node));
      else if (['h1','h2','h3','h4'].includes(tag)) children.push(para(node, { heading: HeadingLevel[`HEADING_${tag.slice(1)}`] }));
      else if (tag === 'ul' || tag === 'ol') {
        [...node.children].forEach((li, idx) => children.push(new Paragraph({
          children: collectRuns(li).length ? collectRuns(li) : [new TextRun('')],
          bullet: tag === 'ul' ? { level: 0 } : undefined,
          numbering: tag === 'ol' ? { reference: 'numbered-list', level: 0 } : undefined
        })));
      } else if (tag === 'table') children.push(tableFromNode(node));
      else if (tag === 'img') { const imgRun = _imageRunFromNode(node, ImageRun); if (imgRun) children.push(new Paragraph({ children: [imgRun] })); }
      else if (tag === 'hr') children.push(new Paragraph({ children: [new TextRun('────────────────────────')] }));
    });

    if (!children.length) children.push(new Paragraph({ children: [new TextRun('')] }));
    const isLandscape = meta.orientation === 'landscape';
    const baseSize = PAGE_SIZES_TWIPS[meta.pageSize] || PAGE_SIZES_TWIPS.a4;
    const pageSize = isLandscape
      ? { orientation: PageOrientation.LANDSCAPE, width: baseSize.height, height: baseSize.width }
      : { width: baseSize.width, height: baseSize.height };
    const sourceMargins = { ...DEFAULT_MARGINS_CM, ...(meta.margins || {}) };
    const pageMargin = Object.fromEntries(
      Object.entries(sourceMargins).map(([side, cm]) => [side, Math.round(Number(cm) * CM_TO_TWIPS)])
    );
    const doc = new Document({
      numbering: {
        config: [{ reference: 'numbered-list', levels: [{ level: 0, format: 'decimal', text: '%1.', alignment: AlignmentType.START }] }]
      },
      sections: [{
        properties: { page: { size: pageSize, margin: pageMargin } },
        children
      }]
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

  // Чесний перелік того, що формат .docx у нас поки спрощує. Показуємо його
  // після збереження, щоб учитель не виявив втрату вже у Word.
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
    if (box.querySelector('hr')) notes.push('горизонтальну лінію замінено рядком символів');

    return notes;
  }

  return { importDocx, exportDocx, describeExportLimits };
})();
