// ---- Charts ----
function makeChart() {
  recalculateAll();
  const b = getBounds();
  const labels = [];
  const data = [];

  // Determine column layout:
  // 1 col selected  -> values only, labels = row numbers
  // 2 cols selected -> first col = labels, second col = values
  // 3+ cols selected -> all cols treated as separate datasets (use first col as labels if text)
  const colSpan = b.cMax - b.cMin;
  const isTwoCols = colSpan === 1;
  const isMultiDataset = colSpan >= 2;

  if (isMultiDataset) {
    // First column: check if it's text (labels) or numeric (data)
    const firstCellInp = cellInp[b.rMin]?.[b.cMin];
    const firstVal = parseFloat(firstCellInp?.value ?? '');
    const firstColIsLabels = isNaN(firstVal) && firstCellInp?.value.trim() !== '';

    const dataStartCol = firstColIsLabels ? b.cMin + 1 : b.cMin;
    const datasets = [];

    for (let c = dataStartCol; c <= b.cMax; c++) {
      const dsLabels = [];
      const dsData = [];
      // Use header row as dataset label if it looks like text
      const headerInp = cellInp[b.rMin]?.[c];
      const headerVal = parseFloat(headerInp?.value ?? '');
      const colLabel = (!isNaN(headerVal) || !headerInp?.value.trim())
        ? COLS[c]
        : headerInp.value.trim();

      const startRow = (!isNaN(headerVal)) ? b.rMin : b.rMin + 1;

      for (let r = startRow; r <= b.rMax; r++) {
        const inp = cellInp[r]?.[c];
        if (!inp) continue;
        const val = parseFloat(inp.value);
        if (!isNaN(val)) {
          dsData.push(val);
          let lbl = `R${r}`;
          if (firstColIsLabels) {
            const lblInp = cellInp[r]?.[b.cMin];
            if (lblInp?.value.trim()) lbl = lblInp.value.trim();
          }
          dsLabels.push(lbl);
        }
      }
      if (dsData.length > 0) datasets.push({ label: colLabel, data: dsData, labels: dsLabels });
    }

    if (datasets.length === 0) { showInfoModal('Виділіть клітинки з числами!'); return; }
    openModal('chartModal');
    renderChartMulti(datasets);
    return;
  }

  // 1 or 2 columns
  for (let r = b.rMin; r <= b.rMax; r++) {
    const valColIdx = isTwoCols ? b.cMax : b.cMin;
    const valInp = cellInp[r]?.[valColIdx];
    if (!valInp) continue;
    const val = parseFloat(valInp.value);

    if (!isNaN(val)) {
      data.push(val);
      let lbl = `R${r}`;
      if (isTwoCols) {
        const lblInp = cellInp[r]?.[b.cMin];
        if (lblInp?.value.trim()) lbl = lblInp.value.trim();
      }
      labels.push(lbl);
    }
  }

  if (data.length === 0) {
    showInfoModal('Виділіть клітинки з числами!');
    return;
  }

  openModal('chartModal');
  renderChart(labels, data);
}

function renderChart(lbls, dats) {
  if (chartObj) chartObj.destroy();
  const canvas = document.getElementById('theChart');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');

  const isPie = chartType === 'pie';

  chartObj = new Chart(ctx, {
    type: chartType,
    data: {
      labels: lbls,
      datasets: [{
        label: 'Значення',
        data: dats,
        backgroundColor: isPie
          ? ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#6366f1', '#14b8a6']
          : '#3b82f6',
        borderColor: chartType === 'line' ? '#3b82f6' : undefined,
        borderWidth: 1,
        tension: 0.4
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: isPie ? {} : { y: { beginAtZero: true } }
    }
  });
}

function renderChartMulti(datasets) {
  if (chartObj) chartObj.destroy();
  const canvas = document.getElementById('theChart');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');

  const palette = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#6366f1', '#14b8a6'];
  const isPie = chartType === 'pie';

  // Use labels from first dataset; merge all labels
  const allLabels = datasets.reduce((acc, ds) => {
    ds.labels.forEach(l => { if (!acc.includes(l)) acc.push(l); });
    return acc;
  }, []);

  const chartDatasets = datasets.map((ds, i) => ({
    label: ds.label,
    data: ds.data,
    backgroundColor: isPie ? palette : palette[i % palette.length],
    borderColor: chartType === 'line' ? palette[i % palette.length] : undefined,
    borderWidth: 1,
    tension: 0.4
  }));

  chartObj = new Chart(ctx, {
    type: chartType,
    data: {
      labels: allLabels,
      datasets: chartDatasets
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: isPie ? {} : { y: { beginAtZero: true } }
    }
  });
}

function setChartType(t) {
  chartType = t;
  if (chartObj) {
    if (chartObj.data.datasets.length > 1) {
      renderChartMulti(chartObj.data.datasets.map(ds => ({
        label: ds.label,
        data: ds.data,
        labels: chartObj.data.labels
      })));
    } else {
      renderChart(chartObj.data.labels, chartObj.data.datasets[0].data);
    }
  }
}

window.TablesCharts = {
  makeChart,
  renderChart,
  renderChartMulti,
  setChartType
};
