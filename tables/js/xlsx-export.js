'use strict';

// ---- Експорт книги у .xlsx ----
// Пакет збирається вручну з OOXML-частин і пакується "stored"-ZIP.
// Обчислені значення формул НЕ кешуємо: у workbook.xml стоїть
// fullCalcOnLoad="1", тож Excel/LibreOffice/Google Sheets перерахують самі.
// Це прибирає ризик застарілих значень і потребу рахувати неактивні аркуші.

const XLSX_FIRST_CUSTOM_NUMFMT = 164;

const NS_MAIN = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const NS_REL_DOC = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const NS_PKG_REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const NS_CONTENT_TYPES = 'http://schemas.openxmlformats.org/package/2006/content-types';
const CT_PREFIX = 'application/vnd.openxmlformats-officedocument.spreadsheetml';

function xf() { return window.TablesXlsxFormat; }

// ---- Реєстр стилів ----
// Кожен унікальний набір класів клітинки → один запис у cellXfs.
function createStyleRegistry() {
  const fmt = xf();
  const numFmts = [];                 // [{ id, code }]
  const numFmtIds = new Map();        // code → id
  const fonts = ['<font><sz val="11"/><color theme="1"/><name val="Calibri"/><family val="2"/></font>'];
  const fontIds = new Map([['', 0]]);
  // Excel вимагає, щоб заливка 0 була none, а 1 — gray125.
  const fills = [
    '<fill><patternFill patternType="none"/></fill>',
    '<fill><patternFill patternType="gray125"/></fill>'
  ];
  const fillIds = new Map([['', 0]]);
  const borders = ['<border><left/><right/><top/><bottom/><diagonal/></border>'];
  const borderIds = new Map([['', 0]]);
  const cellXfs = ['<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>'];
  const xfIds = new Map([['', 0]]);
  const dxfs = [];
  const dxfIds = new Map();

  function numFmtIdFor(code) {
    if (!code) return 0;
    // Вбудовані формати не оголошуємо: так файл сумісніший зі старими читачами.
    const builtin = fmt.XLSX_BUILTIN_NUMBER_FORMATS[code];
    if (builtin) return builtin;
    if (numFmtIds.has(code)) return numFmtIds.get(code);
    const id = XLSX_FIRST_CUSTOM_NUMFMT + numFmts.length;
    numFmts.push({ id, code });
    numFmtIds.set(code, id);
    return id;
  }

  function fontIdFor(classes) {
    const bold = classes.has('style-text-bold');
    const italic = classes.has('style-text-italic');
    const underline = classes.has('style-text-underline');
    const strike = classes.has('style-text-strike');
    const colorClass = [...classes].find(c => fmt.XLSX_TEXT_COLORS[c]);
    const rgb = colorClass ? fmt.XLSX_TEXT_COLORS[colorClass] : '';
    const key = `${bold ? 'b' : ''}${italic ? 'i' : ''}${underline ? 'u' : ''}${strike ? 's' : ''}|${rgb}`;
    if (key === '|') return 0;
    if (fontIds.has(key)) return fontIds.get(key);

    let xml = '<font>';
    if (bold) xml += '<b/>';
    if (italic) xml += '<i/>';
    if (underline) xml += '<u/>';
    if (strike) xml += '<strike/>';
    xml += '<sz val="11"/>';
    xml += rgb ? `<color rgb="FF${rgb}"/>` : '<color theme="1"/>';
    xml += '<name val="Calibri"/><family val="2"/></font>';

    const id = fonts.length;
    fonts.push(xml);
    fontIds.set(key, id);
    return id;
  }

  function fillIdFor(classes) {
    const fillClass = [...classes].find(c => fmt.XLSX_FILL_COLORS[c]);
    if (!fillClass) return 0;
    const rgb = fmt.XLSX_FILL_COLORS[fillClass];
    if (fillIds.has(rgb)) return fillIds.get(rgb);
    const id = fills.length;
    fills.push(`<fill><patternFill patternType="solid"><fgColor rgb="FF${rgb}"/><bgColor indexed="64"/></patternFill></fill>`);
    fillIds.set(rgb, id);
    return id;
  }

  function borderIdFor(classes) {
    if (!classes.has('style-border-all')) return 0;
    if (borderIds.has('all')) return borderIds.get('all');
    const id = borders.length;
    borders.push(
      '<border>' +
      '<left style="thin"><color rgb="FF94A3B8"/></left>' +
      '<right style="thin"><color rgb="FF94A3B8"/></right>' +
      '<top style="thin"><color rgb="FF94A3B8"/></top>' +
      '<bottom style="thin"><color rgb="FF94A3B8"/></bottom>' +
      '<diagonal/></border>'
    );
    borderIds.set('all', id);
    return id;
  }

  // styleString — рядок класів із cellStyles, напр. "style-text-bold style-bg-yellow".
  function xfIdFor(styleString) {
    const key = String(styleString || '').split(/\s+/).filter(Boolean).sort().join(' ');
    if (!key) return 0;
    if (xfIds.has(key)) return xfIds.get(key);

    const classes = new Set(key.split(' '));
    const numClass = [...classes].find(c => fmt.XLSX_NUMBER_FORMATS[c]);
    const numFmtId = numClass ? numFmtIdFor(fmt.XLSX_NUMBER_FORMATS[numClass]) : 0;
    const fontId = fontIdFor(classes);
    const fillId = fillIdFor(classes);
    const borderId = borderIdFor(classes);
    const alignClass = [...classes].find(c => fmt.XLSX_ALIGNMENTS[c]);

    let attrs = `numFmtId="${numFmtId}" fontId="${fontId}" fillId="${fillId}" borderId="${borderId}" xfId="0"`;
    if (numFmtId) attrs += ' applyNumberFormat="1"';
    if (fontId) attrs += ' applyFont="1"';
    if (fillId) attrs += ' applyFill="1"';
    if (borderId) attrs += ' applyBorder="1"';

    let xml;
    if (alignClass) {
      xml = `<xf ${attrs} applyAlignment="1"><alignment horizontal="${fmt.XLSX_ALIGNMENTS[alignClass]}"/></xf>`;
    } else {
      xml = `<xf ${attrs}/>`;
    }

    const id = cellXfs.length;
    cellXfs.push(xml);
    xfIds.set(key, id);
    return id;
  }

  // Умовне форматування: у dxf видимий колір задає bgColor (особливість формату).
  function dxfIdFor(fillHex) {
    const rgb = String(fillHex || '').replace('#', '').toUpperCase();
    if (!/^[0-9A-F]{6}$/.test(rgb)) return null;
    if (dxfIds.has(rgb)) return dxfIds.get(rgb);
    const id = dxfs.length;
    dxfs.push(`<dxf><fill><patternFill><bgColor rgb="FF${rgb}"/></patternFill></fill></dxf>`);
    dxfIds.set(rgb, id);
    return id;
  }

  function toXml() {
    const numFmtsXml = numFmts.length
      ? `<numFmts count="${numFmts.length}">${numFmts.map(n => `<numFmt numFmtId="${n.id}" formatCode="${fmt.xmlEscape(n.code)}"/>`).join('')}</numFmts>`
      : '';
    const dxfsXml = dxfs.length ? `<dxfs count="${dxfs.length}">${dxfs.join('')}</dxfs>` : '<dxfs count="0"/>';

    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      `<styleSheet xmlns="${NS_MAIN}">` +
      numFmtsXml +
      `<fonts count="${fonts.length}">${fonts.join('')}</fonts>` +
      `<fills count="${fills.length}">${fills.join('')}</fills>` +
      `<borders count="${borders.length}">${borders.join('')}</borders>` +
      '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
      `<cellXfs count="${cellXfs.length}">${cellXfs.join('')}</cellXfs>` +
      '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>' +
      dxfsXml +
      '</styleSheet>';
  }

  return { xfIdFor, dxfIdFor, toXml };
}

// ---- Спільні рядки ----
function createSharedStrings() {
  const list = [];
  const index = new Map();

  function idFor(text) {
    if (index.has(text)) return index.get(text);
    const id = list.length;
    list.push(text);
    index.set(text, id);
    return id;
  }

  function toXml() {
    const fmt = xf();
    const items = list.map(s => `<si><t xml:space="preserve">${fmt.xmlEscape(fmt.xmlSafeText(s))}</t></si>`).join('');
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      `<sst xmlns="${NS_MAIN}" count="${list.length}" uniqueCount="${list.length}">${items}</sst>`;
  }

  return { idFor, toXml, get size() { return list.length; } };
}

// Числовий чи текстовий? Дзеркалить applyCellType з calculation.js,
// щоб те, що учень бачить праворуч у клітинці, стало числом і в Excel.
function asNumber(raw) {
  const s = String(raw ?? '').trim();
  if (s === '') return null;
  const n = Number(s.replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

function buildSheetXml(sheet, styles, strings) {
  const fmt = xf();
  const rows = Math.max(1, Number(sheet.rows) || 1);
  const cols = Math.max(1, Number(sheet.cols) || 1);
  const cellData = sheet.cellData || {};
  const cellStyles = sheet.cellStyles || {};
  const colWidths = sheet.colWidths || {};

  // Колонки з датами й валютою при типовій ширині Excel показує як ####.
  // Рахуємо мінімальну потрібну ширину, щоб учень одразу побачив значення.
  const minWidthByCol = new Map();
  for (const ref of Object.keys(cellStyles)) {
    const parsed = parseCellId(ref);
    if (!parsed) continue;
    for (const cls of String(cellStyles[ref]).split(/\s+/)) {
      const need = fmt.XLSX_MIN_FORMAT_WIDTHS[cls];
      if (need) minWidthByCol.set(parsed.cIdx, Math.max(minWidthByCol.get(parsed.cIdx) || 0, need));
    }
  }

  // ---- cols ----
  const colParts = [];
  const widthByCol = new Map();
  for (const key of Object.keys(colWidths)) {
    const idx = Number(key);
    if (!Number.isInteger(idx) || idx < 0 || idx >= cols) continue;
    const width = fmt.pxToExcelWidth(colWidths[key]);
    if (width != null) widthByCol.set(idx, width);
  }
  for (const [idx, need] of minWidthByCol) {
    if (idx < 0 || idx >= cols) continue;
    widthByCol.set(idx, Math.max(widthByCol.get(idx) || 0, need));
  }
  for (const idx of [...widthByCol.keys()].sort((a, b) => a - b)) {
    colParts.push(`<col min="${idx + 1}" max="${idx + 1}" width="${widthByCol.get(idx)}" customWidth="1"/>`);
  }
  const colsXml = colParts.length ? `<cols>${colParts.join('')}</cols>` : '';

  // ---- sheetData ----
  const rowParts = [];
  let maxCol = 0;
  let maxRow = 1;

  for (let r = 1; r <= rows; r++) {
    const cellParts = [];
    for (let c = 0; c < cols; c++) {
      const ref = fmt.columnLetters(c) + r;
      const raw = cellData[ref];
      const styleString = cellStyles[ref];
      const styleId = styles.xfIdFor(styleString);
      const hasValue = raw !== undefined && raw !== null && String(raw) !== '';

      if (!hasValue && !styleId) continue;

      maxCol = Math.max(maxCol, c);
      maxRow = Math.max(maxRow, r);
      const sAttr = styleId ? ` s="${styleId}"` : '';

      if (!hasValue) {
        cellParts.push(`<c r="${ref}"${sAttr}/>`);
        continue;
      }

      const text = String(raw);

      if (text.startsWith('=')) {
        const formula = fmt.toExcelFormula(text.slice(1));
        if (formula != null) {
          cellParts.push(`<c r="${ref}"${sAttr}><f>${fmt.xmlEscape(formula)}</f></c>`);
        } else {
          // Формулу не вдалося розібрати — зберігаємо як текст, щоб не втратити.
          cellParts.push(`<c r="${ref}"${sAttr} t="s"><v>${strings.idFor(text)}</v></c>`);
        }
        continue;
      }

      if (window.TablesModel?.isFormulaErrorCode?.(text)) {
        cellParts.push(`<c r="${ref}"${sAttr} t="e"><v>${fmt.xmlEscape(text)}</v></c>`);
        continue;
      }

      const num = asNumber(text);
      if (num != null) {
        cellParts.push(`<c r="${ref}"${sAttr}><v>${num}</v></c>`);
      } else {
        cellParts.push(`<c r="${ref}"${sAttr} t="s"><v>${strings.idFor(text)}</v></c>`);
      }
    }

    if (cellParts.length) rowParts.push(`<row r="${r}">${cellParts.join('')}</row>`);
  }

  const dimension = `A1:${fmt.columnLetters(maxCol)}${maxRow}`;

  // ---- Умовне форматування ----
  const condParts = [];
  let priority = 1;
  for (const rule of (sheet.condRules || [])) {
    const dxfId = styles.dxfIdFor(rule.fill);
    const operator = fmt.XLSX_COND_OPERATORS[rule.op];
    if (dxfId == null || !operator) continue;

    const [cMin, rMin, cMax, rMax] = rule.range;
    const sqref = `${fmt.columnLetters(cMin)}${rMin}:${fmt.columnLetters(cMax)}${rMax}`;
    const formulas = rule.op === 'between'
      ? `<formula>${rule.v1}</formula><formula>${rule.v2}</formula>`
      : `<formula>${rule.v1}</formula>`;

    condParts.push(
      `<conditionalFormatting sqref="${sqref}">` +
      `<cfRule type="cellIs" dxfId="${dxfId}" priority="${priority++}" operator="${operator}">${formulas}</cfRule>` +
      '</conditionalFormatting>'
    );
  }

  return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    `<worksheet xmlns="${NS_MAIN}" xmlns:r="${NS_REL_DOC}">` +
    `<dimension ref="${dimension}"/>` +
    '<sheetViews><sheetView workbookViewId="0"/></sheetViews>' +
    '<sheetFormatPr defaultRowHeight="15"/>' +
    colsXml +
    `<sheetData>${rowParts.join('')}</sheetData>` +
    condParts.join('') +
    '</worksheet>';
}

// Excel забороняє в назві аркуша : \ / ? * [ ] і обмежує 31 символом.
function sanitizeSheetName(name, index, used) {
  let base = String(name || '').replace(/[:\\/?*[\]]/g, ' ').trim().slice(0, 31);
  if (!base) base = `Аркуш${index + 1}`;
  let candidate = base;
  let n = 2;
  while (used.has(candidate.toLowerCase())) {
    const suffix = ` (${n++})`;
    candidate = base.slice(0, 31 - suffix.length) + suffix;
  }
  used.add(candidate.toLowerCase());
  return candidate;
}

function buildXlsxPackage(workbook) {
  const fmt = xf();
  const encoder = new TextEncoder();
  const styles = createStyleRegistry();
  const strings = createSharedStrings();

  const inputSheets = Array.isArray(workbook.sheets) && workbook.sheets.length
    ? workbook.sheets
    : [{ name: 'Аркуш1', cellData: {}, cellStyles: {}, colWidths: {}, condRules: [], rows: 1, cols: 1 }];

  const usedNames = new Set();
  const sheetInfos = inputSheets.map((sheet, i) => ({
    name: sanitizeSheetName(sheet.name, i, usedNames),
    xml: buildSheetXml(sheet, styles, strings)
  }));

  const files = [];

  // [Content_Types].xml
  const overrides = sheetInfos.map((_, i) =>
    `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="${CT_PREFIX}.worksheet+xml"/>`
  ).join('');
  files.push({
    name: '[Content_Types].xml',
    data: encoder.encode(
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      `<Types xmlns="${NS_CONTENT_TYPES}">` +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="xml" ContentType="application/xml"/>' +
      `<Override PartName="/xl/workbook.xml" ContentType="${CT_PREFIX}.sheet.main+xml"/>` +
      overrides +
      `<Override PartName="/xl/styles.xml" ContentType="${CT_PREFIX}.styles+xml"/>` +
      `<Override PartName="/xl/sharedStrings.xml" ContentType="${CT_PREFIX}.sharedStrings+xml"/>` +
      '</Types>'
    )
  });

  // _rels/.rels
  files.push({
    name: '_rels/.rels',
    data: encoder.encode(
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      `<Relationships xmlns="${NS_PKG_REL}">` +
      `<Relationship Id="rId1" Type="${NS_REL_DOC}/officeDocument" Target="xl/workbook.xml"/>` +
      '</Relationships>'
    )
  });

  // xl/workbook.xml — fullCalcOnLoad змушує Excel перерахувати формули при відкритті.
  const sheetTags = sheetInfos.map((s, i) =>
    `<sheet name="${fmt.xmlEscape(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`
  ).join('');
  files.push({
    name: 'xl/workbook.xml',
    data: encoder.encode(
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      `<workbook xmlns="${NS_MAIN}" xmlns:r="${NS_REL_DOC}">` +
      `<sheets>${sheetTags}</sheets>` +
      '<calcPr calcId="0" fullCalcOnLoad="1"/>' +
      '</workbook>'
    )
  });

  // xl/_rels/workbook.xml.rels
  const sheetRels = sheetInfos.map((_, i) =>
    `<Relationship Id="rId${i + 1}" Type="${NS_REL_DOC}/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`
  ).join('');
  const stylesRelId = sheetInfos.length + 1;
  files.push({
    name: 'xl/_rels/workbook.xml.rels',
    data: encoder.encode(
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      `<Relationships xmlns="${NS_PKG_REL}">` +
      sheetRels +
      `<Relationship Id="rId${stylesRelId}" Type="${NS_REL_DOC}/styles" Target="styles.xml"/>` +
      `<Relationship Id="rId${stylesRelId + 1}" Type="${NS_REL_DOC}/sharedStrings" Target="sharedStrings.xml"/>` +
      '</Relationships>'
    )
  });

  sheetInfos.forEach((sheet, i) => {
    files.push({ name: `xl/worksheets/sheet${i + 1}.xml`, data: encoder.encode(sheet.xml) });
  });

  // styles.xml збираємо ПІСЛЯ аркушів: реєстр наповнюється під час їх побудови.
  files.push({ name: 'xl/styles.xml', data: encoder.encode(styles.toXml()) });
  files.push({ name: 'xl/sharedStrings.xml', data: encoder.encode(strings.toXml()) });

  return window.TablesXlsxZip.zipWrite(files);
}

function exportXlsx() {
  try {
    syncActiveSheetFromGlobals();
    const bytes = buildXlsxPackage({ sheets });
    const blob = new Blob([bytes], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${normalizeFileName(workbookName)}.xlsx`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    setSaveBadge();
  } catch (e) {
    showInfoModal(`Не вдалося створити .xlsx: ${e?.message || 'помилка експорту'}`);
  }
}

window.TablesXlsxExport = {
  exportXlsx,
  buildXlsxPackage
};
