(function (root, factory) {
  'use strict';
  root.TablesXlsxCharts = factory();
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  // ---- Діаграми XLSX (DrawingML chart) ----
  // Експорт та імпорт стовпчастої (clustered column), лінійної й кругової діаграм, ряди яких
  // посилаються на одновимірні діапазони того самого аркуша. Модель — chart-model.js.
  // Решту (інші типи, дані з іншого аркуша, об'єкти малюнка) імпорт називає в попередженні.

  const NS = {
    a: 'http://schemas.openxmlformats.org/drawingml/2006/main',
    c: 'http://schemas.openxmlformats.org/drawingml/2006/chart',
    r: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships',
    xdr: 'http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing'
  };
  const CHART_CONTENT_TYPE = 'application/vnd.openxmlformats-officedocument.drawingml.chart+xml';
  const DRAWING_CONTENT_TYPE = 'application/vnd.openxmlformats-officedocument.drawing+xml';
  const EMU_PER_PX = 9525;
  // Типова геометрія Excel: рядок 15 pt = 20 px, колонка 8,43 символу = 64 px.
  const EXCEL_ROW_PX = 20;
  const EXCEL_COL_PX = 64;
  const MAX_ROWS = 500;
  const MAX_COLS = 200;
  const UNSUPPORTED_TYPE_LABELS = {
    area3DChart: 'об’ємна з областями', areaChart: 'з областями', bar3DChart: 'об’ємна стовпчаста',
    bubbleChart: 'бульбашкова', doughnutChart: 'кільцева', line3DChart: 'об’ємна лінійна',
    ofPieChart: 'вторинна кругова', pie3DChart: 'об’ємна кругова', radarChart: 'пелюсткова',
    scatterChart: 'точкова', stockChart: 'біржова', surface3DChart: 'поверхнева', surfaceChart: 'поверхнева'
  };
  const REF_RE = /^(?:'((?:[^']|'')+)'|([^'!]+))!\$?([A-Z]{1,3})\$?(\d+)(?::\$?([A-Z]{1,3})\$?(\d+))?$/i;

  const chartModel = () => globalThis.TablesChartModel;

  function xmlText(value) {
    return String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function xmlAttr(value) {
    return xmlText(value).replace(/"/g, '&quot;');
  }

  function relationshipsXml(items) {
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${items.join('')}</Relationships>`;
  }

  // ---- Експорт ----
  function cachePoints(values) {
    return values.map((value, index) => (value == null ? '' : `<c:pt idx="${index}"><c:v>${xmlText(value)}</c:v></c:pt>`)).join('');
  }

  function numRef(ref, numbers) {
    return `<c:numRef><c:f>${xmlText(ref)}</c:f><c:numCache><c:formatCode>General</c:formatCode><c:ptCount val="${numbers.length}"/>${cachePoints(numbers)}</c:numCache></c:numRef>`;
  }

  function strRef(ref, texts) {
    return `<c:strRef><c:f>${xmlText(ref)}</c:f><c:strCache><c:ptCount val="${texts.length}"/>${cachePoints(texts)}</c:strCache></c:strRef>`;
  }

  function chartXml(chart, rangeRef, valueAt) {
    const model = chartModel();
    const text = value => {
      const trimmed = String(value ?? '').trim();
      return trimmed === '' ? null : trimmed;
    };
    const read = range => model.chartRangeCells(range).map(([col, row]) => valueAt(col, row));
    let categoryXml = '';
    if (chart.categories) {
      const values = read(chart.categories);
      const numeric = values.every(value => text(value) == null || model.chartValueNumber(value) != null);
      categoryXml = `<c:cat>${numeric
        ? numRef(rangeRef(chart.categories), values.map(value => model.chartValueNumber(value)))
        : strRef(rangeRef(chart.categories), values.map(text))}</c:cat>`;
    }
    const seriesXml = chart.series.map((series, index) => {
      const nameXml = series.name
        ? `<c:tx>${strRef(rangeRef([series.name[0], series.name[1], series.name[0], series.name[1]]), [text(valueAt(series.name[0], series.name[1])) ?? ''])}</c:tx>`
        : '';
      const invert = chart.type === 'bar' ? '<c:invertIfNegative val="0"/>' : '';
      const marker = chart.type === 'line' ? '<c:marker><c:symbol val="circle"/><c:size val="5"/></c:marker>' : '';
      const smooth = chart.type === 'line' ? '<c:smooth val="0"/>' : '';
      const values = numRef(rangeRef(series.values), read(series.values).map(value => model.chartValueNumber(value)));
      return `<c:ser><c:idx val="${index}"/><c:order val="${index}"/>${nameXml}${invert}${marker}${categoryXml}<c:val>${values}</c:val>${smooth}</c:ser>`;
    }).join('');
    const axisIds = '<c:axId val="500000001"/><c:axId val="500000002"/>';
    let group;
    if (chart.type === 'bar') group = `<c:barChart><c:barDir val="col"/><c:grouping val="clustered"/><c:varyColors val="0"/>${seriesXml}<c:gapWidth val="150"/>${axisIds}</c:barChart>`;
    else if (chart.type === 'line') group = `<c:lineChart><c:grouping val="standard"/><c:varyColors val="0"/>${seriesXml}<c:marker val="1"/>${axisIds}</c:lineChart>`;
    else group = `<c:pieChart><c:varyColors val="1"/>${seriesXml}<c:firstSliceAng val="0"/></c:pieChart>`;
    const axes = chart.type === 'pie' ? '' : '<c:catAx><c:axId val="500000001"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="0"/><c:axPos val="b"/><c:numFmt formatCode="General" sourceLinked="1"/><c:tickLblPos val="nextTo"/><c:crossAx val="500000002"/><c:crosses val="autoZero"/><c:auto val="1"/><c:lblAlgn val="ctr"/><c:lblOffset val="100"/></c:catAx>'
      + '<c:valAx><c:axId val="500000002"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="0"/><c:axPos val="l"/><c:majorGridlines/><c:numFmt formatCode="General" sourceLinked="1"/><c:tickLblPos val="nextTo"/><c:crossAx val="500000001"/><c:crosses val="autoZero"/><c:crossBetween val="between"/></c:valAx>';
    const title = chart.title
      ? `<c:title><c:tx><c:rich><a:bodyPr/><a:lstStyle/><a:p><a:r><a:t>${xmlText(chart.title)}</a:t></a:r></a:p></c:rich></c:tx><c:overlay val="0"/></c:title><c:autoTitleDeleted val="0"/>`
      : '<c:autoTitleDeleted val="1"/>';
    const legend = chart.type === 'pie' || chart.series.length > 1 ? '<c:legend><c:legendPos val="r"/><c:overlay val="0"/></c:legend>' : '';
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><c:chartSpace xmlns:c="${NS.c}" xmlns:a="${NS.a}" xmlns:r="${NS.r}"><c:roundedCorners val="0"/><c:chart>${title}<c:plotArea><c:layout/>${group}${axes}</c:plotArea>${legend}<c:plotVisOnly val="1"/><c:dispBlanksAs val="gap"/></c:chart></c:chartSpace>`;
  }

  function anchorXml(chart, index, relId) {
    const [col, row] = chart.anchor;
    const [width, height] = chart.size;
    return `<xdr:oneCellAnchor><xdr:from><xdr:col>${col}</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>${row - 1}</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from>`
      + `<xdr:ext cx="${Math.round(width * EMU_PER_PX)}" cy="${Math.round(height * EMU_PER_PX)}"/>`
      + `<xdr:graphicFrame macro=""><xdr:nvGraphicFramePr><xdr:cNvPr id="${index + 2}" name="${xmlAttr(chart.title || `Діаграма ${index + 1}`)}"/><xdr:cNvGraphicFramePr/></xdr:nvGraphicFramePr>`
      + `<xdr:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/></xdr:xfrm><a:graphic><a:graphicData uri="${NS.c}"><c:chart xmlns:c="${NS.c}" xmlns:r="${NS.r}" r:id="${relId}"/></a:graphicData></a:graphic></xdr:graphicFrame><xdr:clientData/></xdr:oneCellAnchor>`;
  }

  // Частини пакета для діаграм одного аркуша. Діаграми без даних не пишуться
  // (describeExportLosses називає їх перед експортом).
  function buildSheetCharts({ sheet, chartStart, drawingIndex, rangeRef, valueAt }) {
    if (!chartModel()) return null;
    const charts = (sheet.charts || []).filter(chart => chart.series.length);
    if (!charts.length) return null;
    const anchors = [];
    const drawingRels = [];
    const parts = [];
    charts.forEach((chart, index) => {
      const relId = `rId${index + 1}`;
      const path = `xl/charts/chart${chartStart + index}.xml`;
      drawingRels.push(`<Relationship Id="${relId}" Type="${NS.r}/chart" Target="../charts/chart${chartStart + index}.xml"/>`);
      anchors.push(anchorXml(chart, index, relId));
      parts.push([path, chartXml(chart, rangeRef, valueAt)]);
    });
    return {
      sheetRels: relationshipsXml([`<Relationship Id="rId1" Type="${NS.r}/drawing" Target="../drawings/drawing${drawingIndex}.xml"/>`]),
      drawing: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><xdr:wsDr xmlns:xdr="${NS.xdr}" xmlns:a="${NS.a}">${anchors.join('')}</xdr:wsDr>`,
      drawingRels: relationshipsXml(drawingRels),
      charts: parts
    };
  }

  // ---- Імпорт ----
  function createImportStats() {
    return { unsupported: new Set(), detached: 0, tooLarge: 0, tooMany: 0, literalLabels: 0, objects: 0 };
  }

  function columnIndex(letters) {
    let index = 0;
    for (const ch of letters.toUpperCase()) index = index * 26 + ch.charCodeAt(0) - 64;
    return index - 1;
  }

  // Одновимірний діапазон того самого аркуша або причина, чому його не перенесено.
  function parseRef(formula, sheetName) {
    const match = REF_RE.exec(String(formula || '').trim());
    if (!match) return { error: 'detached' };
    const refSheet = match[1] != null ? match[1].replace(/''/g, "'") : match[2];
    if (refSheet.trim().toLowerCase() !== String(sheetName).trim().toLowerCase()) return { error: 'detached' };
    const c1 = columnIndex(match[3]);
    const r1 = Number(match[4]);
    const c2 = match[5] ? columnIndex(match[5]) : c1;
    const r2 = match[6] ? Number(match[6]) : r1;
    const range = [Math.min(c1, c2), Math.min(r1, r2), Math.max(c1, c2), Math.max(r1, r2)];
    if (range[1] < 1 || (range[0] !== range[2] && range[1] !== range[3])) return { error: 'detached' };
    if (range[3] > MAX_ROWS || range[2] >= MAX_COLS || Math.max(range[2] - range[0], range[3] - range[1]) + 1 > 500) return { error: 'tooLarge' };
    return { range };
  }

  function cachedText(refNode, helpers) {
    const cache = helpers.firstChild(refNode, 'strCache');
    return helpers.firstChild(helpers.firstChild(cache, 'pt'), 'v')?.textContent || '';
  }

  function parseChartPart(doc, sheetName, stats, helpers) {
    const { childrenByName, firstChild } = helpers;
    const chartNode = doc.getElementsByTagNameNS(NS.c, 'chart')[0];
    const plotArea = firstChild(chartNode, 'plotArea');
    const groups = Array.from(plotArea?.children || []).filter(element => /Chart$/.test(element.localName));
    if (groups.length !== 1) {
      stats.unsupported.add(groups.length ? 'комбінована' : 'без даних');
      return null;
    }
    const group = groups[0];
    let type;
    if (group.localName === 'barChart') {
      const direction = firstChild(group, 'barDir')?.getAttribute('val');
      const grouping = firstChild(group, 'grouping')?.getAttribute('val') || 'clustered';
      if (direction === 'bar') { stats.unsupported.add('лінійчата'); return null; }
      if (grouping !== 'clustered') { stats.unsupported.add('стовпчаста з накопиченням'); return null; }
      type = 'bar';
    } else if (group.localName === 'lineChart') {
      const grouping = firstChild(group, 'grouping')?.getAttribute('val') || 'standard';
      if (grouping !== 'standard') { stats.unsupported.add('лінійна з накопиченням'); return null; }
      type = 'line';
    } else if (group.localName === 'pieChart') {
      type = 'pie';
    } else {
      stats.unsupported.add(UNSUPPORTED_TYPE_LABELS[group.localName] || group.localName);
      return null;
    }

    const serNodes = childrenByName(group, 'ser');
    if (!serNodes.length || serNodes.length > (chartModel()?.CHART_MAX_SERIES || 12)) {
      if (serNodes.length) stats.tooLarge++;
      else stats.detached++;
      return null;
    }
    let categories = null;
    let firstName = '';
    const series = [];
    for (const [index, ser] of serNodes.entries()) {
      const values = parseRef(firstChild(firstChild(firstChild(ser, 'val'), 'numRef'), 'f')?.textContent, sheetName);
      if (values.error) { stats[values.error]++; return null; }
      let name = null;
      const nameRef = firstChild(firstChild(ser, 'tx'), 'strRef');
      if (nameRef) {
        const parsedName = parseRef(firstChild(nameRef, 'f')?.textContent, sheetName);
        if (parsedName.error || parsedName.range[0] !== parsedName.range[2] || parsedName.range[1] !== parsedName.range[3]) { stats.detached++; return null; }
        name = [parsedName.range[0], parsedName.range[1]];
        if (index === 0) firstName = cachedText(nameRef, helpers);
      }
      if (index === 0) {
        const cat = firstChild(ser, 'cat');
        const catRef = firstChild(cat, 'strRef') || firstChild(cat, 'numRef');
        if (catRef) {
          const parsedCategories = parseRef(firstChild(catRef, 'f')?.textContent, sheetName);
          if (parsedCategories.error) { stats[parsedCategories.error]++; return null; }
          categories = parsedCategories.range;
        } else if (cat) {
          stats.literalLabels++;
        }
      }
      series.push({ name, values: values.range });
    }

    // Excel показує назву ряду як автоматичну назву діаграми з одним рядом.
    const titleNode = firstChild(chartNode, 'title');
    const autoTitleDeleted = firstChild(chartNode, 'autoTitleDeleted')?.getAttribute('val') === '1';
    let title = '';
    if (titleNode) {
      const rich = Array.from(titleNode.getElementsByTagNameNS(NS.a, 't')).map(node => node.textContent || '').join('');
      const titleRef = firstChild(firstChild(titleNode, 'tx'), 'strRef');
      title = rich || (titleRef ? cachedText(titleRef, helpers) : '') || (series.length === 1 ? firstName : '');
    } else if (!autoTitleDeleted && series.length === 1) {
      title = firstName;
    }
    return { type, title: title.slice(0, 120), categories, series };
  }

  function anchorGeometry(anchor, sheet, helpers) {
    const { firstChild } = helpers;
    const number = (node, name) => Number(firstChild(node, name)?.textContent || 0) || 0;
    const columnPx = col => Number(sheet.colWidths?.[col]) || EXCEL_COL_PX;
    const from = firstChild(anchor, 'from');
    const col = number(from, 'col');
    const row = number(from, 'row');
    let width;
    let height;
    if (anchor.localName === 'twoCellAnchor') {
      const to = firstChild(anchor, 'to');
      width = (number(to, 'colOff') - number(from, 'colOff')) / EMU_PER_PX;
      for (let c = col; c < number(to, 'col'); c++) width += columnPx(c);
      height = (number(to, 'row') - row) * EXCEL_ROW_PX + (number(to, 'rowOff') - number(from, 'rowOff')) / EMU_PER_PX;
    } else {
      const ext = firstChild(anchor, 'ext');
      width = Number(ext?.getAttribute('cx') || 0) / EMU_PER_PX;
      height = Number(ext?.getAttribute('cy') || 0) / EMU_PER_PX;
    }
    const model = chartModel();
    return {
      anchor: [Math.max(0, Math.min(MAX_COLS - 1, col)), Math.max(1, Math.min(MAX_ROWS, row + 1))],
      size: [model.clampChartSize(width, 0), model.clampChartSize(height, 1)]
    };
  }

  // Діаграми з малюнка аркуша. Розширює rows/cols аркуша, щоб діапазони й якір були в його межах.
  function parseSheetCharts({ files, sheetPath, sheet, sheetName, helpers, stats }) {
    const { parseXml, relMap, firstChild, resolvePath } = helpers;
    const model = chartModel();
    const relsPath = sheetPath.replace(/([^/]+)$/, '_rels/$1.rels');
    if (!model || !files.has(relsPath)) return [];
    const drawingRel = Array.from(parseXml(files.get(relsPath), relsPath).getElementsByTagNameNS('*', 'Relationship'))
      .find(rel => /\/drawing$/.test(rel.getAttribute('Type') || ''));
    if (!drawingRel) return [];
    const drawingPath = resolvePath(sheetPath, drawingRel.getAttribute('Target') || '');
    if (!files.has(drawingPath)) return [];
    const drawing = parseXml(files.get(drawingPath), drawingPath);
    const drawingRelsPath = drawingPath.replace(/([^/]+)$/, '_rels/$1.rels');
    const chartPaths = files.has(drawingRelsPath) ? relMap(parseXml(files.get(drawingRelsPath), drawingRelsPath), drawingPath) : new Map();
    const charts = [];
    for (const anchor of Array.from(drawing.documentElement.children)) {
      if (!/Anchor$/.test(anchor.localName)) continue;
      const chartNode = firstChild(anchor, 'graphicFrame')?.getElementsByTagNameNS(NS.c, 'chart')[0];
      if (!chartNode) { stats.objects++; continue; }
      const chartPath = chartPaths.get(chartNode.getAttributeNS(NS.r, 'id') || chartNode.getAttribute('r:id'));
      if (!chartPath || !files.has(chartPath)) { stats.detached++; continue; }
      const parsed = parseChartPart(parseXml(files.get(chartPath), chartPath), sheetName, stats, helpers);
      if (!parsed) continue;
      if (charts.length >= model.CHART_MAX_PER_SHEET) { stats.tooMany++; continue; }
      const geometry = anchorGeometry(anchor, sheet, helpers);
      const ranges = [parsed.categories, ...parsed.series.flatMap(item => [item.values, item.name && [item.name[0], item.name[1], item.name[0], item.name[1]]])].filter(Boolean);
      sheet.rows = Math.max(sheet.rows, geometry.anchor[1], ...ranges.map(range => range[3]));
      sheet.cols = Math.max(sheet.cols, geometry.anchor[0] + 1, ...ranges.map(range => range[2] + 1));
      charts.push({ id: `chart${charts.length + 1}`, type: parsed.type, title: parsed.title, categories: parsed.categories, series: parsed.series, anchor: geometry.anchor, size: geometry.size });
    }
    return charts;
  }

  function reportImportLosses(stats, warnings) {
    if (!stats) return;
    if (stats.unsupported.size) warnings.add(`діаграми непідтримуваних типів: ${[...stats.unsupported].join(', ')}`);
    if (stats.detached) warnings.add(`діаграми з даними на іншому аркуші чи з кількох діапазонів: ${stats.detached}`);
    if (stats.tooLarge) warnings.add(`діаграми поза межами 500×200 або з понад ${chartModel()?.CHART_MAX_SERIES || 12} рядами: ${stats.tooLarge}`);
    if (stats.tooMany) warnings.add(`діаграми понад ${chartModel()?.CHART_MAX_PER_SHEET || 20} на аркуші: ${stats.tooMany}`);
    if (stats.literalLabels) warnings.add(`підписи діаграм, задані не діапазоном: ${stats.literalLabels}`);
    if (stats.objects) warnings.add(`зображення, фігури та інші об’єкти аркуша: ${stats.objects}`);
  }

  return { CHART_CONTENT_TYPE, DRAWING_CONTENT_TYPE, buildSheetCharts, createImportStats, parseSheetCharts, reportImportLosses };
}));
