(function (root, factory) {
  'use strict';
  root.TablesXlsxFile = factory();
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  const MAX_BYTES = 12 * 1024 * 1024;
  const MAX_UNCOMPRESSED = 24 * 1024 * 1024;
  const MAX_POPULATED_CELLS = 100000;
  const textEncoder = new TextEncoder();
  const textDecoder = new TextDecoder('utf-8');

  function xmlEscape(value) {
    return String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
  }

  function normalizePath(path) {
    const parts = [];
    String(path || '').replace(/\\/g, '/').split('/').forEach(part => {
      if (!part || part === '.') return;
      if (part === '..') parts.pop(); else parts.push(part);
    });
    return parts.join('/');
  }

  function resolvePath(base, target) {
    if (String(target).startsWith('/')) return normalizePath(String(target).slice(1));
    return normalizePath(`${base.slice(0, base.lastIndexOf('/') + 1)}${target}`);
  }

  function findEocd(view) {
    const min = Math.max(0, view.byteLength - 65557);
    for (let i = view.byteLength - 22; i >= min; i--) {
      if (view.getUint32(i, true) === 0x06054b50) return i;
    }
    throw new Error('ZIP-контейнер XLSX пошкоджено');
  }

  async function inflateRaw(bytes) {
    if (typeof DecompressionStream !== 'function') throw new Error('Цей браузер не підтримує розпакування XLSX');
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
    const reader = stream.getReader();
    const chunks = [];
    let length = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > MAX_UNCOMPRESSED) {
        await reader.cancel();
        throw new Error('Розпакований XLSX завеликий');
      }
      chunks.push(value);
    }
    return concat(chunks);
  }

  async function unzip(buffer) {
    const bytes = new Uint8Array(buffer);
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const eocd = findEocd(view);
    const count = view.getUint16(eocd + 10, true);
    const centralOffset = view.getUint32(eocd + 16, true);
    if (count > 2000) throw new Error('XLSX містить забагато внутрішніх файлів');
    const files = new Map();
    let offset = centralOffset;
    let total = 0;
    for (let i = 0; i < count; i++) {
      if (view.getUint32(offset, true) !== 0x02014b50) throw new Error('Каталог ZIP пошкоджено');
      const method = view.getUint16(offset + 10, true);
      const compressedSize = view.getUint32(offset + 20, true);
      const size = view.getUint32(offset + 24, true);
      const nameLen = view.getUint16(offset + 28, true);
      const extraLen = view.getUint16(offset + 30, true);
      const commentLen = view.getUint16(offset + 32, true);
      const localOffset = view.getUint32(offset + 42, true);
      const name = normalizePath(textDecoder.decode(bytes.subarray(offset + 46, offset + 46 + nameLen)));
      total += size;
      if (total > MAX_UNCOMPRESSED) throw new Error('Розпакований XLSX завеликий');
      if (!name.endsWith('/')) {
        if (view.getUint32(localOffset, true) !== 0x04034b50) throw new Error('Запис ZIP пошкоджено');
        const localNameLen = view.getUint16(localOffset + 26, true);
        const localExtraLen = view.getUint16(localOffset + 28, true);
        const start = localOffset + 30 + localNameLen + localExtraLen;
        const packed = bytes.subarray(start, start + compressedSize);
        let content;
        if (method === 0) content = packed.slice();
        else if (method === 8) content = await inflateRaw(packed);
        else throw new Error(`Непідтримуваний ZIP-метод ${method}`);
        if (content.byteLength !== size) throw new Error('Розмір запису ZIP не збігається');
        files.set(name, content);
      }
      offset += 46 + nameLen + extraLen + commentLen;
    }
    return files;
  }

  function parseXml(bytes, label) {
    const doc = new DOMParser().parseFromString(textDecoder.decode(bytes || new Uint8Array()), 'application/xml');
    if (doc.querySelector('parsererror')) throw new Error(`Некоректний XML у ${label}`);
    return doc;
  }

  function childrenByName(node, name) {
    return Array.from(node?.children || []).filter(el => el.localName === name);
  }

  function firstChild(node, name) {
    return childrenByName(node, name)[0] || null;
  }

  function relMap(doc, basePath) {
    const map = new Map();
    Array.from(doc.getElementsByTagNameNS('*', 'Relationship')).forEach(rel => {
      map.set(rel.getAttribute('Id'), resolvePath(basePath, rel.getAttribute('Target') || ''));
    });
    return map;
  }

  function parseSharedStrings(files) {
    const bytes = files.get('xl/sharedStrings.xml');
    if (!bytes) return [];
    return Array.from(parseXml(bytes, 'sharedStrings.xml').getElementsByTagNameNS('*', 'si')).map(si =>
      Array.from(si.getElementsByTagNameNS('*', 't')).map(t => t.textContent || '').join(''));
  }

  function colorClass(rgb, fill) {
    const hex = String(rgb || '').replace(/^FF/i, '#').toLowerCase();
    const palette = fill ? {
      '#fef9c3': 'style-bg-yellow', '#dcfce7': 'style-bg-green', '#fee2e2': 'style-bg-red',
      '#dbeafe': 'style-bg-blue', '#e0e7ff': 'style-bg-indigo', '#ede9fe': 'style-bg-purple',
      '#fce7f3': 'style-bg-pink', '#ffedd5': 'style-bg-orange', '#f1f5f9': 'style-bg-gray', '#ccfbf1': 'style-bg-teal'
    } : {
      '#334155': 'style-text-slate', '#dc2626': 'style-text-red', '#ea580c': 'style-text-orange',
      '#d97706': 'style-text-amber', '#16a34a': 'style-text-green', '#0f766e': 'style-text-teal',
      '#2563eb': 'style-text-blue', '#4f46e5': 'style-text-indigo', '#7c3aed': 'style-text-purple',
      '#db2777': 'style-text-pink', '#92400e': 'style-text-brown'
    };
    return palette[hex] || '';
  }

  function parseStyles(files) {
    const bytes = files.get('xl/styles.xml');
    if (!bytes) return [];
    const doc = parseXml(bytes, 'styles.xml');
    const fonts = childrenByName(firstChild(doc.documentElement, 'fonts'), 'font');
    const fills = childrenByName(firstChild(doc.documentElement, 'fills'), 'fill');
    const borders = childrenByName(firstChild(doc.documentElement, 'borders'), 'border');
    const customFormats = new Map(childrenByName(firstChild(doc.documentElement, 'numFmts'), 'numFmt')
      .map(el => [Number(el.getAttribute('numFmtId')), el.getAttribute('formatCode') || '']));
    const dateIds = new Set([14, 15, 16, 17, 22, 27, 30, 36, 45, 46, 47, 50, 57]);
    return childrenByName(firstChild(doc.documentElement, 'cellXfs'), 'xf').map(xf => {
      const classes = [];
      const font = fonts[Number(xf.getAttribute('fontId') || 0)];
      if (firstChild(font, 'b')) classes.push('style-text-bold');
      if (firstChild(font, 'i')) classes.push('style-text-italic');
      if (firstChild(font, 'u')) classes.push('style-text-underline');
      if (firstChild(font, 'strike')) classes.push('style-text-strike');
      const fontColor = firstChild(font, 'color');
      const textColor = colorClass(fontColor?.getAttribute('rgb'), false);
      if (textColor) classes.push(textColor);
      const fill = fills[Number(xf.getAttribute('fillId') || 0)];
      const fg = firstChild(firstChild(fill, 'patternFill'), 'fgColor');
      const fillClass = colorClass(fg?.getAttribute('rgb'), true);
      if (fillClass) classes.push(fillClass);
      if (Number(xf.getAttribute('borderId') || 0) > 0 && borders[Number(xf.getAttribute('borderId'))]) classes.push('style-border-all');
      const alignment = firstChild(xf, 'alignment')?.getAttribute('horizontal');
      if (['left', 'center', 'right'].includes(alignment)) classes.push(`style-align-${alignment}`);
      const fmtId = Number(xf.getAttribute('numFmtId') || 0);
      const fmt = customFormats.get(fmtId) || '';
      const isDate = dateIds.has(fmtId) || /[dmy]/i.test(fmt.replace(/\[[^\]]*\]|"[^"]*"/g, ''));
      if (isDate) classes.push(/[hHsS]/.test(fmt) || fmtId === 22 ? 'style-num-datetime' : 'style-num-date');
      else if (fmtId === 9 || fmtId === 10 || /%/.test(fmt)) classes.push('style-num-percent');
      else if (fmtId === 2 || /0\.00/.test(fmt)) classes.push('style-num-fixed2');
      else if (fmtId === 1 || fmt === '0') classes.push('style-num-int');
      return { classes: [...new Set(classes)].join(' '), isDate };
    });
  }

  function excelDateToIso(serial, includeTime) {
    const value = Number(serial);
    if (!Number.isFinite(value)) return String(serial ?? '');
    const millis = Math.round((value - 25569) * 86400000);
    const iso = new Date(millis).toISOString();
    return includeTime ? iso.slice(0, 19).replace('T', ' ') : iso.slice(0, 10);
  }

  function cellCoords(ref) {
    const match = /^([A-Z]+)(\d+)$/i.exec(ref || '');
    if (!match) return null;
    let col = 0;
    for (const ch of match[1].toUpperCase()) col = col * 26 + ch.charCodeAt(0) - 64;
    return { col: col - 1, row: Number(match[2]), ref: match[1].toUpperCase() + Number(match[2]) };
  }

  function parseSheet(bytes, shared, styles, name, warnings) {
    const doc = parseXml(bytes, `${name}.xml`);
    const data = {};
    const cellStyles = {};
    let maxRow = 1;
    let maxCol = 0;
    Array.from(doc.getElementsByTagNameNS('*', 'c')).forEach(cell => {
      const coords = cellCoords(cell.getAttribute('r'));
      if (!coords || coords.row > 500 || coords.col >= 200) {
        warnings.add('дані поза межами 500×200');
        return;
      }
      maxRow = Math.max(maxRow, coords.row);
      maxCol = Math.max(maxCol, coords.col);
      const type = cell.getAttribute('t') || '';
      const styleIndex = Number(cell.getAttribute('s') || 0);
      const style = styles[styleIndex] || { classes: '', isDate: false };
      const formula = firstChild(cell, 'f')?.textContent;
      const raw = firstChild(cell, 'v')?.textContent ?? '';
      let value = raw;
      if (formula != null) value = `=${formula}`;
      else if (type === 's') value = shared[Number(raw)] ?? '';
      else if (type === 'inlineStr') value = Array.from(cell.getElementsByTagNameNS('*', 't')).map(t => t.textContent || '').join('');
      else if (type === 'b') value = raw === '1' ? 'TRUE' : 'FALSE';
      else if (style.isDate && raw !== '') value = excelDateToIso(raw, style.classes.includes('datetime'));
      if (String(value).length > 200) value = String(value).slice(0, 200);
      if (value !== '') data[coords.ref] = String(value);
      if (style.classes) cellStyles[coords.ref] = style.classes;
    });
    const colWidths = {};
    Array.from(doc.getElementsByTagNameNS('*', 'col')).forEach(col => {
      const min = Math.max(1, Number(col.getAttribute('min') || 1));
      const max = Math.min(200, Number(col.getAttribute('max') || min));
      const width = Math.max(50, Math.min(500, Math.round(Number(col.getAttribute('width') || 8.43) * 7 + 5)));
      for (let i = min; i <= max; i++) colWidths[i - 1] = width;
      maxCol = Math.max(maxCol, max - 1);
    });
    if (doc.getElementsByTagNameNS('*', 'mergeCell').length) warnings.add('об’єднані клітинки');
    if (doc.getElementsByTagNameNS('*', 'conditionalFormatting').length) warnings.add('умовне форматування');
    return { name, cellData: data, cellStyles, colWidths, condRules: [], rows: Math.max(60, maxRow), cols: Math.max(30, maxCol + 1) };
  }

  async function importArrayBuffer(buffer, filename = 'Таблиця.xlsx') {
    if (!buffer || buffer.byteLength > MAX_BYTES) throw new Error('XLSX завеликий (максимум 12 МБ)');
    const files = await unzip(buffer);
    const workbookPath = files.has('xl/workbook.xml') ? 'xl/workbook.xml' : null;
    if (!workbookPath) throw new Error('У XLSX немає книги');
    const workbook = parseXml(files.get(workbookPath), 'workbook.xml');
    const relsPath = 'xl/_rels/workbook.xml.rels';
    if (!files.has(relsPath)) throw new Error('У XLSX немає зв’язків аркушів');
    const relationships = relMap(parseXml(files.get(relsPath), 'workbook.xml.rels'), workbookPath);
    const shared = parseSharedStrings(files);
    const styles = parseStyles(files);
    const warnings = new Set();
    const sheetNodes = Array.from(workbook.getElementsByTagNameNS('*', 'sheet')).slice(0, 50);
    if (!sheetNodes.length) throw new Error('XLSX не містить аркушів');
    const sheets = sheetNodes.map((sheet, index) => {
      const relId = sheet.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id') || sheet.getAttribute('r:id');
      const path = relationships.get(relId);
      if (!path || !files.has(path)) throw new Error(`Не знайдено дані аркуша ${index + 1}`);
      const name = String(sheet.getAttribute('name') || `Аркуш${index + 1}`).slice(0, 31);
      return parseSheet(files.get(path), shared, styles, name, warnings);
    });
    const activeTab = Number(workbook.getElementsByTagNameNS('*', 'workbookView')[0]?.getAttribute('activeTab') || 0);
    for (const path of files.keys()) {
      if (/^(xl\/(drawings|charts|media|pivotTables)|xl\/vbaProject)/i.test(path)) warnings.add('зображення, діаграми, зведені таблиці або макроси');
    }
    return {
      payload: { type: 'art-tables-workbook', version: 2, name: filename.replace(/\.xlsx$/i, ''), activeSheet: Math.max(0, Math.min(sheets.length - 1, activeTab)), sheets },
      warnings: [...warnings]
    };
  }

  function crc32(bytes) {
    let crc = 0xffffffff;
    for (const byte of bytes) {
      crc ^= byte;
      for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
    }
    return (crc ^ 0xffffffff) >>> 0;
  }

  function dosDateTime() {
    const d = new Date();
    return {
      time: (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2),
      date: ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate()
    };
  }

  function concat(parts) {
    const length = parts.reduce((sum, part) => sum + part.byteLength, 0);
    const out = new Uint8Array(length);
    let offset = 0;
    parts.forEach(part => { out.set(part, offset); offset += part.byteLength; });
    return out;
  }

  function zipStore(entries) {
    const locals = [];
    const centrals = [];
    let offset = 0;
    const stamp = dosDateTime();
    entries.forEach(([filename, text]) => {
      const name = textEncoder.encode(filename);
      const data = typeof text === 'string' ? textEncoder.encode(text) : text;
      const crc = crc32(data);
      const local = new Uint8Array(30 + name.length + data.length);
      const lv = new DataView(local.buffer);
      lv.setUint32(0, 0x04034b50, true); lv.setUint16(4, 20, true); lv.setUint16(6, 0x0800, true);
      lv.setUint16(10, stamp.time, true); lv.setUint16(12, stamp.date, true); lv.setUint32(14, crc, true);
      lv.setUint32(18, data.length, true); lv.setUint32(22, data.length, true); lv.setUint16(26, name.length, true);
      local.set(name, 30); local.set(data, 30 + name.length); locals.push(local);
      const central = new Uint8Array(46 + name.length);
      const cv = new DataView(central.buffer);
      cv.setUint32(0, 0x02014b50, true); cv.setUint16(4, 20, true); cv.setUint16(6, 20, true); cv.setUint16(8, 0x0800, true);
      cv.setUint16(12, stamp.time, true); cv.setUint16(14, stamp.date, true); cv.setUint32(16, crc, true);
      cv.setUint32(20, data.length, true); cv.setUint32(24, data.length, true); cv.setUint16(28, name.length, true); cv.setUint32(42, offset, true);
      central.set(name, 46); centrals.push(central); offset += local.length;
    });
    const centralSize = centrals.reduce((sum, item) => sum + item.length, 0);
    const end = new Uint8Array(22);
    const ev = new DataView(end.buffer);
    ev.setUint32(0, 0x06054b50, true); ev.setUint16(8, entries.length, true); ev.setUint16(10, entries.length, true);
    ev.setUint32(12, centralSize, true); ev.setUint32(16, offset, true);
    return concat([...locals, ...centrals, end]);
  }

  function colName(index) {
    let n = index + 1, out = '';
    while (n) { n--; out = String.fromCharCode(65 + (n % 26)) + out; n = Math.floor(n / 26); }
    return out;
  }

  function styleDescriptor(classString) {
    const set = new Set(String(classString || '').split(/\s+/));
    const fontColors = { 'style-text-slate': '334155', 'style-text-red': 'DC2626', 'style-text-orange': 'EA580C', 'style-text-amber': 'D97706', 'style-text-green': '16A34A', 'style-text-teal': '0F766E', 'style-text-blue': '2563EB', 'style-text-indigo': '4F46E5', 'style-text-purple': '7C3AED', 'style-text-pink': 'DB2777', 'style-text-brown': '92400E' };
    const fills = { 'style-bg-yellow': 'FEF9C3', 'style-bg-green': 'DCFCE7', 'style-bg-red': 'FEE2E2', 'style-bg-blue': 'DBEAFE', 'style-bg-indigo': 'E0E7FF', 'style-bg-purple': 'EDE9FE', 'style-bg-pink': 'FCE7F3', 'style-bg-orange': 'FFEDD5', 'style-bg-gray': 'F1F5F9', 'style-bg-teal': 'CCFBF1' };
    const color = Object.keys(fontColors).find(key => set.has(key));
    const fill = Object.keys(fills).find(key => set.has(key));
    const align = ['left', 'center', 'right'].find(value => set.has(`style-align-${value}`)) || '';
    let numFmtId = 0;
    if (set.has('style-num-int')) numFmtId = 1;
    else if (set.has('style-num-fixed2')) numFmtId = 2;
    else if (set.has('style-num-percent')) numFmtId = 10;
    else if (set.has('style-num-date')) numFmtId = 14;
    else if (set.has('style-num-datetime')) numFmtId = 22;
    return { bold: set.has('style-text-bold'), italic: set.has('style-text-italic'), underline: set.has('style-text-underline'), strike: set.has('style-text-strike'), color: fontColors[color] || '', fill: fills[fill] || '', border: set.has('style-border-all'), align, numFmtId };
  }

  function buildStyles(sheets) {
    const descriptors = [{ bold: false, italic: false, underline: false, strike: false, color: '', fill: '', border: false, align: '', numFmtId: 0 }];
    const map = new Map([['', 0]]);
    sheets.forEach(sheet => Object.values(sheet.cellStyles || {}).forEach(value => {
      const d = styleDescriptor(value);
      const key = JSON.stringify(d);
      if (!map.has(key)) { map.set(key, descriptors.length); descriptors.push(d); }
    }));
    const fonts = descriptors.map(d => `<font><sz val="11"/><name val="Calibri"/>${d.bold ? '<b/>' : ''}${d.italic ? '<i/>' : ''}${d.underline ? '<u/>' : ''}${d.strike ? '<strike/>' : ''}${d.color ? `<color rgb="FF${d.color}"/>` : '<color theme="1"/>'}</font>`);
    const fillList = ['<fill><patternFill patternType="none"/></fill>', '<fill><patternFill patternType="gray125"/></fill>'];
    const fillIds = descriptors.map(d => { if (!d.fill) return 0; fillList.push(`<fill><patternFill patternType="solid"><fgColor rgb="FF${d.fill}"/><bgColor indexed="64"/></patternFill></fill>`); return fillList.length - 1; });
    const borderList = ['<border><left/><right/><top/><bottom/><diagonal/></border>', '<border><left style="thin"/><right style="thin"/><top style="thin"/><bottom style="thin"/><diagonal/></border>'];
    const xfs = descriptors.map((d, i) => `<xf numFmtId="${d.numFmtId}" fontId="${i}" fillId="${fillIds[i]}" borderId="${d.border ? 1 : 0}" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyNumberFormat="1"${d.align ? ' applyAlignment="1"' : ''}>${d.align ? `<alignment horizontal="${d.align}"/>` : ''}</xf>`);
    return {
      indexFor(value) { const key = JSON.stringify(styleDescriptor(value)); return map.get(key) ?? 0; },
      xml: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="${fonts.length}">${fonts.join('')}</fonts><fills count="${fillList.length}">${fillList.join('')}</fills><borders count="${borderList.length}">${borderList.join('')}</borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="${xfs.length}">${xfs.join('')}</cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`
    };
  }

  function isoToSerial(value) {
    const match = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?$/.exec(value);
    if (!match) return null;
    const time = Date.UTC(+match[1], +match[2] - 1, +match[3], +(match[4] || 0), +(match[5] || 0), +(match[6] || 0));
    return time / 86400000 + 25569;
  }

  function sheetXml(sheet, styles) {
    const styleMap = sheet.cellStyles || {};
    const refs = [...new Set([...Object.keys(sheet.cellData || {}), ...Object.keys(styleMap)])]
      .map(ref => ({ ref: ref.toUpperCase(), coords: cellCoords(ref) })).filter(item => item.coords)
      .sort((a, b) => a.coords.row - b.coords.row || a.coords.col - b.coords.col);
    const rows = new Map();
    refs.forEach(({ ref, coords }) => {
      const raw = String(sheet.cellData?.[ref] ?? '');
      const s = styles.indexFor(styleMap[ref] || '');
      let cell;
      if (raw.startsWith('=')) cell = `<c r="${ref}" s="${s}"><f>${xmlEscape(raw.slice(1))}</f><v>0</v></c>`;
      else {
        const dateSerial = isoToSerial(raw);
        const isDateStyle = /style-num-date(?:time)?/.test(styleMap[ref] || '');
        if (dateSerial != null && isDateStyle) cell = `<c r="${ref}" s="${s}"><v>${dateSerial}</v></c>`;
        else if (raw !== '' && Number.isFinite(Number(raw))) cell = `<c r="${ref}" s="${s}"><v>${Number(raw)}</v></c>`;
        else cell = `<c r="${ref}" s="${s}" t="inlineStr"><is><t xml:space="preserve">${xmlEscape(raw)}</t></is></c>`;
      }
      if (!rows.has(coords.row)) rows.set(coords.row, []);
      rows.get(coords.row).push(cell);
    });
    const cols = Object.entries(sheet.colWidths || {}).map(([index, px]) => `<col min="${Number(index) + 1}" max="${Number(index) + 1}" width="${Math.max(1, (Number(px) - 5) / 7).toFixed(2)}" customWidth="1"/>`).join('');
    const rowXml = [...rows.entries()].map(([r, cells]) => `<row r="${r}">${cells.join('')}</row>`).join('');
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><cols>${cols}</cols><sheetData>${rowXml}</sheetData></worksheet>`;
  }

  function exportArrayBuffer(rawPayload) {
    const payload = window.TablesWorkbookFile?.validateWorkbookPayload ? window.TablesWorkbookFile.validateWorkbookPayload(rawPayload) : rawPayload;
    const sheets = payload.sheets || [];
    const populatedCells = sheets.reduce((sum, sheet) => sum + new Set([
      ...Object.keys(sheet.cellData || {}), ...Object.keys(sheet.cellStyles || {})
    ]).size, 0);
    if (populatedCells > MAX_POPULATED_CELLS) throw new Error(`Забагато заповнених клітинок для XLSX (максимум ${MAX_POPULATED_CELLS})`);
    const styles = buildStyles(sheets);
    const sheetEntries = sheets.map((sheet, i) => [`xl/worksheets/sheet${i + 1}.xml`, sheetXml(sheet, styles)]);
    const workbookSheets = sheets.map((sheet, i) => `<sheet name="${xmlEscape(sheet.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('');
    const workbookRels = sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('') + `<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>`;
    const overrides = sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('');
    const entries = [
      ['[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${overrides}</Types>`],
      ['_rels/.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>'],
      ['xl/workbook.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><bookViews><workbookView activeTab="${payload.activeSheet || 0}"/></bookViews><sheets>${workbookSheets}</sheets><calcPr calcMode="auto"/></workbook>`],
      ['xl/_rels/workbook.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${workbookRels}</Relationships>`],
      ['xl/styles.xml', styles.xml],
      ...sheetEntries
    ];
    return zipStore(entries).buffer;
  }

  function currentPayload() {
    if (typeof syncActiveSheetFromGlobals === 'function') syncActiveSheetFromGlobals();
    return { type: 'art-tables-workbook', version: 2, name: workbookName, activeSheet, sheets };
  }

  function exportWorkbook() {
    try {
      const buffer = exportArrayBuffer(currentPayload());
      const blob = new Blob([buffer], { type: MIME });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `${normalizeFileName(workbookName)}.xlsx`;
      document.body.appendChild(link); link.click(); link.remove(); URL.revokeObjectURL(url);
      if (typeof setSaveBadge === 'function') setSaveBadge();
    } catch (error) {
      showInfoModal(`Не вдалося створити XLSX: ${error?.message || 'помилка експорту'}`);
    }
  }

  function triggerImport() {
    const input = document.getElementById('xlsxFileInput');
    if (!input) return;
    if (window.OfficeUI?.openFilePicker?.(input)) return;
    input.value = ''; input.click();
  }

  async function importFile(file) {
    try {
      if (!file || file.size > MAX_BYTES) throw new Error('XLSX завеликий (максимум 12 МБ)');
      const result = await importArrayBuffer(await file.arrayBuffer(), file.name);
      window.TablesWorkbookFile?.applyWorkbookPayload?.(result.payload);
      const warning = result.warnings.length ? `\n\nНе перенесено у цьому файлі: ${result.warnings.join(', ')}.` : '';
      showInfoModal(`XLSX імпортовано.${warning}\n\nПідтримано: аркуші, числа, текст, дати, базові формули, ширини колонок і базове форматування. Не підтримуються: merge, зображення, діаграми, pivot, макроси та формули поза набором ПЛЮС.`);
      return result;
    } catch (error) {
      showInfoModal(`Не вдалося відкрити XLSX: ${error?.message || 'помилка читання'}`);
      return null;
    }
  }

  return { exportArrayBuffer, exportWorkbook, importArrayBuffer, importFile, triggerImport, MIME, MAX_BYTES };
}));
