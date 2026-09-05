'use strict';

// ---- Імпорт .xlsx ----
// Обсяг першого кроку: значення, формули і числові формати, плюс те
// форматування, яке лягає на закритий словник стилів ПЛЮС Таблиць.
// Усе, що не лягає (об'єднані клітинки, діаграми, макроси, чужі функції),
// не мовчить: підрахунок потрапляє у звіт після імпорту.
//
// Результат перед застосуванням проходить ту саму validateWorkbookPayload,
// що й .arttab, — недовірений файл не має власного шляху в стан застосунку.

const XLSX_MAX_FILE_BYTES = 10 * 1024 * 1024;

// Вбудовані numFmtId, які Excel не оголошує у styles.xml.
const XLSX_BUILTIN_FORMAT_CODES = {
  0: 'General', 1: '0', 2: '0.00', 3: '#,##0', 4: '#,##0.00',
  9: '0%', 10: '0.00%', 11: '0.00E+00',
  5: '$#,##0_);($#,##0)', 6: '$#,##0_);[Red]($#,##0)',
  7: '$#,##0.00_);($#,##0.00)', 8: '$#,##0.00_);[Red]($#,##0.00)',
  14: 'mm-dd-yy', 15: 'd-mmm-yy', 16: 'd-mmm', 17: 'mmm-yy',
  18: 'h:mm AM/PM', 19: 'h:mm:ss AM/PM', 20: 'h:mm', 21: 'h:mm:ss',
  22: 'm/d/yy h:mm',
  37: '#,##0 ;(#,##0)', 38: '#,##0 ;[Red](#,##0)',
  39: '#,##0.00;(#,##0.00)', 40: '#,##0.00;[Red](#,##0.00)',
  41: '_(* #,##0_);_(* (#,##0);_(* "-"_);_(@_)',
  42: '_("$"* #,##0_);_("$"* (#,##0);_("$"* "-"_);_(@_)',
  43: '_(* #,##0.00_);_(* (#,##0.00);_(* "-"??_);_(@_)',
  44: '_("$"* #,##0.00_);_("$"* (#,##0.00);_("$"* "-"??_);_(@_)',
  45: 'mm:ss', 46: '[h]:mm:ss', 47: 'mmss.0', 48: '##0.0E+0', 49: '@'
};

function xfi() { return window.TablesXlsxFormat; }

// ---- Розпізнавання формату числа ----
// Чужі файли майже ніколи не мають наших точних кодів, тому дивимось на зміст
// коду, а не на точний збіг рядка.
// Excel у неанглійській локалі пише в файл ЛОКАЛІЗОВАНІ роздільники:
// український "#.##0" — це те саме, що нейтральне "#,##0". Тому спершу
// зводимо роздільники до нейтральних: розрядний завжди ",", дробовий ".".
// Розрядний упізнаємо за тим, що після нього йде рівно три позиції розряду.
function normalizeSeparators(code) {
  return code
    .replace(/[.,](?=(##0|###))/g, ',')  // розрядний → ","
    .replace(/,(?!(##0|###))/g, '.');    // решта → дробовий "."
}

function numberClassForFormatCode(code) {
  const raw = String(code || '').trim();
  if (!raw || raw === 'General' || raw === '@') return '';

  const exact = xfi().NUMBER_CLASSES_BY_CODE[raw];
  if (exact) return exact;

  // Прибираємо літерали в лапках і екрановані символи, щоб не сплутати
  // текст усередині формату з кодами розрядів.
  const literals = raw.match(/"[^"]*"/g) || [];
  const stripped = raw.replace(/"[^"]*"/g, '').replace(/\\./g, '').toLowerCase();
  const bare = normalizeSeparators(stripped);
  const literalText = literals.join(' ').toLowerCase();

  // Наукового формату в ПЛЮС Таблицях немає — краще лишити без формату,
  // ніж показати 1,23E+05 як звичайне число з двома знаками.
  if (/e[+-]/.test(bare)) return '';

  const hasCurrency = /[₴$€£]/.test(raw) || /грн|uah/i.test(literalText);
  const hasDate = /[ymd]/.test(bare);
  const hasTime = /h/.test(bare) && /m/.test(bare);

  if (bare.includes('%')) return 'style-num-percent';
  if (hasCurrency) return 'style-num-currency-uah';
  if (hasDate && hasTime) return 'style-num-datetime';
  if (hasDate) return 'style-num-date';
  if (/0\.0/.test(bare)) return 'style-num-fixed2';
  if (/^[#,\s0]+$/.test(bare) && bare.includes('0')) return 'style-num-int';
  return '';
}

// Чи означає формат дату (для перетворення серіала у текст ми нічого не робимо —
// наш рушій уже тримає Excel-сумісні серіали, тож значення лишається числом).
function isDateClass(cls) {
  return cls === 'style-num-date' || cls === 'style-num-datetime';
}

// ---- Кольори ----
// Зіставляємо за ВІДТІНКОМ, а не за відстанню в RGB. Палітра заливок ПЛЮС
// Таблиць складається з пастельних тонів однакової світлості, тож насичений
// синій учителя за RGB опиняється «далеко» від усього і був би просто
// відкинутий — хоча за змістом це саме синій. Відтінок зберігає намір
// («цей рядок виділено синім»), а світлість підганяємо під свою палітру.
const COLOR_NEUTRAL_SATURATION = 0.15;
const COLOR_MAX_LIGHTNESS = 0.98;
const COLOR_MIN_LIGHTNESS = 0.04;

function hexToRgb(hex) {
  const s = String(hex || '').replace('#', '');
  const six = s.length === 8 ? s.slice(2) : s; // ARGB → RGB
  if (!/^[0-9a-fA-F]{6}$/.test(six)) return null;
  return [parseInt(six.slice(0, 2), 16), parseInt(six.slice(2, 4), 16), parseInt(six.slice(4, 6), 16)];
}

function rgbToHsl([r, g, b]) {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  const delta = max - min;

  if (delta === 0) return [0, 0, l];

  const s = l > 0.5 ? delta / (2 - max - min) : delta / (max + min);
  let h;
  if (max === rn) h = ((gn - bn) / delta) % 6;
  else if (max === gn) h = (bn - rn) / delta + 2;
  else h = (rn - gn) / delta + 4;

  h *= 60;
  if (h < 0) h += 360;
  return [h, s, l];
}

function hueDistance(a, b) {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
}

function nearestPaletteClass(hex, paletteByRgb, neutralClass) {
  const rgb = hexToRgb(hex);
  if (!rgb) return '';

  const upper = String(hex || '').replace('#', '').toUpperCase();
  const exactKey = upper.length === 8 ? upper.slice(2) : upper;
  if (paletteByRgb[exactKey]) return paletteByRgb[exactKey];

  const [hue, saturation, lightness] = rgbToHsl(rgb);
  // Майже біле або майже чорне — не фарбуємо: це «немає кольору», а не колір.
  if (lightness > COLOR_MAX_LIGHTNESS || lightness < COLOR_MIN_LIGHTNESS) return '';
  if (saturation < COLOR_NEUTRAL_SATURATION) return neutralClass || '';

  let best = '';
  let bestDistance = Infinity;
  for (const key of Object.keys(paletteByRgb)) {
    if (paletteByRgb[key] === neutralClass) continue; // нейтральний лише для сірого
    const candidate = hexToRgb(key);
    if (!candidate) continue;
    const [candidateHue, candidateSaturation] = rgbToHsl(candidate);
    if (candidateSaturation < COLOR_NEUTRAL_SATURATION) continue;
    const distance = hueDistance(hue, candidateHue);
    if (distance < bestDistance) { bestDistance = distance; best = paletteByRgb[key]; }
  }
  return best;
}

// ---- XML helpers ----
function parseXml(bytes, partName) {
  const text = new TextDecoder('utf-8').decode(bytes);
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  if (doc.getElementsByTagName('parsererror').length) {
    throw new Error(`Пошкоджена частина ${partName}`);
  }
  return doc;
}

function tags(node, name) {
  return node ? Array.from(node.getElementsByTagNameNS('*', name)) : [];
}

function firstTag(node, name) {
  const list = node ? node.getElementsByTagNameNS('*', name) : null;
  return list && list.length ? list[0] : null;
}

function attr(node, name) {
  if (!node) return null;
  // Атрибути r:id лежать у просторі імен relationships.
  if (name.includes(':')) {
    const local = name.split(':')[1];
    for (const a of Array.from(node.attributes)) {
      if (a.localName === local) return a.value;
    }
    return null;
  }
  return node.getAttribute(name);
}

// ---- Зсув формули для shared formulas ----
// Excel зберігає формулу протягуванням один раз (t="shared"), решта клітинок
// посилаються на неї через si. Щоб учень побачив формулу, а не лише число,
// зсуваємо відносні посилання на дельту рядків/колонок.
function shiftFormula(source, colDelta, rowDelta) {
  if (!colDelta && !rowDelta) return source;

  let out = '';
  let i = 0;
  const s = String(source);

  while (i < s.length) {
    // Рядкові літерали переносимо як є.
    if (s[i] === '"') {
      let j = i + 1;
      while (j < s.length && s[j] !== '"') j++;
      out += s.slice(i, Math.min(j + 1, s.length));
      i = j + 1;
      continue;
    }

    const rest = s.slice(i);
    const m = /^(\$?)([A-Z]{1,3})(\$?)([0-9]{1,7})(?![0-9A-Za-z_])/.exec(rest);
    if (m) {
      const [whole, colAbs, colLetters, rowAbs, rowDigits] = m;
      let col = colToIndex(colLetters);
      let row = parseInt(rowDigits, 10);
      if (!colAbs) col += colDelta;
      if (!rowAbs) row += rowDelta;
      out += (col < 0 || row < 1)
        ? '#REF!'
        : `${colAbs}${indexToCol(col)}${rowAbs}${row}`;
      i += whole.length;
      continue;
    }

    out += s[i];
    i++;
  }

  return out;
}

// ---- styles.xml ----
function readStyles(doc) {
  const fmt = xfi();
  if (!doc) return { xfs: [] };

  const formatCodes = { ...XLSX_BUILTIN_FORMAT_CODES };
  for (const node of tags(doc, 'numFmt')) {
    const id = Number(attr(node, 'numFmtId'));
    if (Number.isInteger(id)) formatCodes[id] = attr(node, 'formatCode') || '';
  }

  const fontsRoot = firstTag(doc, 'fonts');
  const fonts = tags(fontsRoot, 'font').map(node => {
    const colorNode = firstTag(node, 'color');
    return {
      bold: !!firstTag(node, 'b'),
      italic: !!firstTag(node, 'i'),
      underline: !!firstTag(node, 'u'),
      strike: !!firstTag(node, 'strike'),
      rgb: colorNode ? attr(colorNode, 'rgb') : null
    };
  });

  const fillsRoot = firstTag(doc, 'fills');
  const fills = tags(fillsRoot, 'fill').map(node => {
    const pattern = firstTag(node, 'patternFill');
    if (!pattern || attr(pattern, 'patternType') === 'none') return null;
    const fg = firstTag(pattern, 'fgColor');
    return fg ? attr(fg, 'rgb') : null;
  });

  const bordersRoot = firstTag(doc, 'borders');
  const borders = tags(bordersRoot, 'border').map(node =>
    ['left', 'right', 'top', 'bottom'].every(side => {
      const el = firstTag(node, side);
      return el && attr(el, 'style');
    })
  );

  const cellXfsRoot = firstTag(doc, 'cellXfs');
  const xfs = tags(cellXfsRoot, 'xf').map(node => {
    const classes = [];

    if (attr(node, 'applyNumberFormat') !== '0') {
      const cls = numberClassForFormatCode(formatCodes[Number(attr(node, 'numFmtId')) || 0]);
      if (cls) classes.push(cls);
    }

    const font = fonts[Number(attr(node, 'fontId')) || 0];
    if (font && attr(node, 'applyFont') !== '0') {
      if (font.bold) classes.push('style-text-bold');
      if (font.italic) classes.push('style-text-italic');
      if (font.underline) classes.push('style-text-underline');
      if (font.strike) classes.push('style-text-strike');
      if (font.rgb) {
        const cls = nearestPaletteClass(font.rgb, fmt.TEXT_COLORS_BY_RGB, 'style-text-slate');
        if (cls) classes.push(cls);
      }
    }

    const fillRgb = fills[Number(attr(node, 'fillId')) || 0];
    if (fillRgb && attr(node, 'applyFill') !== '0') {
      const cls = nearestPaletteClass(fillRgb, fmt.FILL_COLORS_BY_RGB, 'style-bg-gray');
      if (cls) classes.push(cls);
    }

    if (borders[Number(attr(node, 'borderId')) || 0]) classes.push('style-border-all');

    const alignment = firstTag(node, 'alignment');
    const horizontal = alignment ? attr(alignment, 'horizontal') : null;
    if (horizontal === 'left' || horizontal === 'center' || horizontal === 'right') {
      classes.push(`style-align-${horizontal}`);
    }

    const numberClass = classes.find(c => c.startsWith('style-num-')) || '';
    return { classes: [...new Set(classes)].join(' '), numberClass };
  });

  return { xfs };
}

// ---- worksheet ----
function readSheet(doc, sharedStrings, styles, report) {
  const cellData = {};
  const cellStyles = {};
  const colWidths = {};
  const sharedFormulas = new Map();
  let maxCol = 0;
  let maxRow = 1;

  for (const colNode of tags(firstTag(doc, 'cols'), 'col')) {
    const min = Number(attr(colNode, 'min'));
    const max = Number(attr(colNode, 'max'));
    const px = xfi().excelWidthToPx(attr(colNode, 'width'));
    if (!Number.isInteger(min) || !Number.isInteger(max) || px == null) continue;
    // Дуже широкі діапазони однакової ширини — це "стиль за замовчуванням",
    // а не свідомі ширини; такі не переносимо.
    if (max - min > 64) continue;
    for (let c = min; c <= max; c++) colWidths[c - 1] = px;
  }

  const mergeCount = tags(firstTag(doc, 'mergeCells'), 'mergeCell').length;
  if (mergeCount) report.merged += mergeCount;

  for (const cellNode of tags(firstTag(doc, 'sheetData'), 'c')) {
    const ref = attr(cellNode, 'r');
    const parsed = ref ? parseCellId(ref) : null;
    if (!parsed) continue;

    const styleIndex = Number(attr(cellNode, 's')) || 0;
    const style = styles.xfs[styleIndex];

    const valueNode = firstTag(cellNode, 'v');
    const type = attr(cellNode, 't') || 'n';
    const formulaNode = firstTag(cellNode, 'f');

    let value = null;

    if (formulaNode) {
      let formula = (formulaNode.textContent || '').trim();
      const shareType = attr(formulaNode, 't');
      const si = attr(formulaNode, 'si');

      if (shareType === 'shared' && si != null) {
        if (formula) {
          sharedFormulas.set(si, { formula, col: parsed.cIdx, row: parsed.r });
        } else {
          const master = sharedFormulas.get(si);
          formula = master ? shiftFormula(master.formula, parsed.cIdx - master.col, parsed.r - master.row) : '';
        }
      }

      if (formula) {
        // Беремо формулу лише тоді, коли наш рушій здатний її розібрати.
        // Інакше краще показати збережене значення, ніж #NAME? у кожній клітинці.
        let parseable = false;
        try {
          window.TablesFormulaParser.parseFormula(formula);
          parseable = true;
        } catch (e) {
          report.unsupportedFormulas++;
        }
        if (parseable) value = `=${formula}`;
      }
    }

    if (value == null) {
      const text = valueNode ? (valueNode.textContent || '') : '';
      if (type === 's') {
        const idx = Number(text);
        value = Number.isInteger(idx) ? (sharedStrings[idx] ?? '') : '';
      } else if (type === 'inlineStr') {
        const isNode = firstTag(cellNode, 'is');
        value = tags(isNode, 't').map(t => t.textContent || '').join('');
      } else if (type === 'b') {
        value = text === '1' ? 'TRUE' : 'FALSE';
      } else {
        value = text;
      }
    }

    value = String(value ?? '');
    if (value.length > MAX_CELL_LEN) {
      value = value.slice(0, MAX_CELL_LEN);
      report.truncatedCells++;
    }

    const id = `${indexToCol(parsed.cIdx)}${parsed.r}`;
    if (value !== '') {
      cellData[id] = value;
      maxCol = Math.max(maxCol, parsed.cIdx);
      maxRow = Math.max(maxRow, parsed.r);
    }
    if (style && style.classes) {
      cellStyles[id] = style.classes;
      maxCol = Math.max(maxCol, parsed.cIdx);
      maxRow = Math.max(maxRow, parsed.r);
    }
  }

  return { cellData, cellStyles, colWidths, maxCol, maxRow };
}

function readSharedStrings(doc) {
  if (!doc) return [];
  return tags(doc, 'si').map(si => {
    // <si> може містити кілька <r><t> (форматовані фрагменти) — склеюємо.
    const parts = tags(si, 't').map(t => t.textContent || '');
    return parts.join('');
  });
}

// ---- Складання книги ----
async function parseXlsxBytes(bytes, fallbackName) {
  if (bytes.length > XLSX_MAX_FILE_BYTES) {
    throw new Error(`Файл завеликий (максимум ${Math.round(XLSX_MAX_FILE_BYTES / 1024 / 1024)} МБ)`);
  }

  const parts = await window.TablesXlsxZip.zipRead(bytes);
  const workbookPart = parts.get('xl/workbook.xml');
  if (!workbookPart) throw new Error('Це не файл Excel: немає xl/workbook.xml');

  const workbookDoc = parseXml(workbookPart, 'xl/workbook.xml');
  const relsPart = parts.get('xl/_rels/workbook.xml.rels');
  const relTargets = new Map();
  if (relsPart) {
    for (const rel of tags(parseXml(relsPart, 'workbook.xml.rels'), 'Relationship')) {
      relTargets.set(attr(rel, 'Id'), String(attr(rel, 'Target') || '').replace(/^\/?xl\//, '').replace(/^\//, ''));
    }
  }

  const sharedStrings = readSharedStrings(
    parts.get('xl/sharedStrings.xml') ? parseXml(parts.get('xl/sharedStrings.xml'), 'sharedStrings.xml') : null
  );
  const styles = readStyles(
    parts.get('xl/styles.xml') ? parseXml(parts.get('xl/styles.xml'), 'styles.xml') : null
  );

  const report = { merged: 0, unsupportedFormulas: 0, truncatedCells: 0, droppedSheets: 0, clampedSheets: 0 };
  const sheetNodes = tags(firstTag(workbookDoc, 'sheets'), 'sheet');
  if (!sheetNodes.length) throw new Error('У книзі немає аркушів');

  const sheets = [];
  for (let i = 0; i < sheetNodes.length; i++) {
    if (sheets.length >= WORKBOOK_MAX_SHEETS) { report.droppedSheets++; continue; }

    const node = sheetNodes[i];
    const relId = attr(node, 'r:id');
    const target = relTargets.get(relId) || `worksheets/sheet${i + 1}.xml`;
    const part = parts.get(`xl/${target}`);
    if (!part) { report.droppedSheets++; continue; }

    const sheetDoc = parseXml(part, target);
    const read = readSheet(sheetDoc, sharedStrings, styles, report);

    const rows = Math.max(DEFAULT_ROWS, Math.min(500, read.maxRow));
    const cols = Math.max(DEFAULT_COL_COUNT, Math.min(200, read.maxCol + 1));
    if (read.maxRow > 500 || read.maxCol + 1 > 200) report.clampedSheets++;

    sheets.push({
      name: attr(node, 'name') || `Аркуш${i + 1}`,
      cellData: read.cellData,
      cellStyles: read.cellStyles,
      colWidths: read.colWidths,
      condRules: [],
      rows,
      cols
    });
  }

  if (!sheets.length) throw new Error('Не вдалося прочитати жодного аркуша');

  return {
    payload: { type: 'art-tables-workbook', version: 2, name: fallbackName, activeSheet: 0, sheets },
    report
  };
}

function describeImportReport(report) {
  const notes = [];
  if (report.merged) notes.push(`об'єднаних клітинок роз'єднано: ${report.merged}`);
  if (report.unsupportedFormulas) notes.push(`формул збережено як значення: ${report.unsupportedFormulas}`);
  if (report.truncatedCells) notes.push(`задовгих значень скорочено: ${report.truncatedCells}`);
  if (report.clampedSheets) notes.push(`аркушів обрізано за розміром: ${report.clampedSheets}`);
  if (report.droppedSheets) notes.push(`аркушів пропущено: ${report.droppedSheets}`);
  return notes;
}

async function importXlsxFile(file) {
  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const baseName = String(file.name || '').replace(/\.xlsx$/i, '') || DEFAULT_WORKBOOK_NAME;
    const { payload, report } = await parseXlsxBytes(bytes, baseName);

    // Той самий шлюз валідації, що й для .arttab.
    const validated = validateWorkbookPayload(payload);

    saveToHistory();

    workbookName = normalizeFileName(validated.name || DEFAULT_WORKBOOK_NAME);
    updateFileNameUi();

    sheets = validated.sheets;
    activeSheet = validated.activeSheet;
    rowFilter = null;
    loadGlobalsFromSheet(activeSheet);

    rebuildGrid();
    recalculateAll();
    renderSheetTabs();
    persistStateToStorage();
    persistUiState();
    setSaveBadge();
    saveToHistory();

    const notes = describeImportReport(report);
    if (notes.length) {
      showInfoModal(`Файл відкрито. Що не перенеслося повністю:\n• ${notes.join('\n• ')}`);
    }
  } catch (e) {
    showInfoModal(`Не вдалося відкрити .xlsx: ${e?.message || 'помилка читання'}`);
  }
}

function triggerXlsxImport() {
  const input = document.getElementById('xlsxFileInput');
  if (!input) return;
  if (window.OfficeUI?.openFilePicker?.(input)) return;
  input.value = '';
  input.click();
}

window.TablesXlsxImport = {
  importXlsxFile,
  triggerXlsxImport,
  parseXlsxBytes,
  numberClassForFormatCode,
  shiftFormula
};
