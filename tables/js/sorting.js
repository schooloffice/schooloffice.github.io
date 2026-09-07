// ---- Sorting ----
//
// Контракт сортування (аудит F11):
//
// 1. Ключ береться з моделі, а не з відображеного поля. Дати, відсотки й валюта
//    зберігаються числами і форматуються лише на екрані, тож текст «06.06.2026»
//    чи «1 234,00 ₴» дав би сортування за рядком.
// 2. Клітинка з формулою сортується за обчисленим значенням.
// 3. Порожні клітинки й формули з помилкою йдуть у кінець і за зростанням, і за
//    спаданням: інакше спадання піднімало б порожні рядки нагору.
// 4. Рядок, що переїхав, отримує формули, переписані так, ніби його скопіювали
//    на нове місце: відносні посилання зсуваються разом із рядком, абсолютні
//    (`$1`) лишаються, стовпці не змінюються. Переписування йде через
//    `offsetFormulaRefs` — той самий токенізатор, що й у копіюванні, а не
//    regex-підстановка.
//
// Свідомі межі, які сортування не бере на себе (так само поводяться Excel і
// Sheets, і змінювати це варто лише окремим рішенням):
//
// - Формула ПОЗА сортованим діапазоном, яка вказує всередину нього, не
//   переписується: після сортування вона описує вже інші дані.
// - Посилання на інший рядок того ж діапазону (напр. `=A2*10` у рядку 1) після
//   переїзду вказує на нового сусіда, а не на дані, з яких формула починалася.
// - Посилання, зсув якого виводить за межі таблиці, притискається до межі
//   (`refTokenToString`), а не перетворюється на `#REF!` — це поведінка
//   спільного адресного шару, а не сортування.

// Типізоване значення клітинки для порівняння: number | string | null(порожня).
function sortKeyForCell(id) {
  const raw = cellData[id];
  if (raw === undefined || raw === null || String(raw) === '') return null;

  const s = String(raw);
  if (s.startsWith('=')) {
    try {
      calcDepth = 0;
      const value = evaluateFormula(s.substring(1));
      return typeof value === 'number' ? value : String(value);
    } catch (e) {
      return null; // клітинка з помилкою йде в кінець, а не сортується за кодом
    }
  }

  const norm = s.replace(',', '.').trim();
  if (norm !== '' && Number.isFinite(Number(norm))) return Number(norm);
  return s;
}

function compareSortValues(a, b, desc = false) {
  const aEmpty = a === null || a === undefined || a === '';
  const bEmpty = b === null || b === undefined || b === '';
  if (aEmpty && bEmpty) return 0;
  // Порожні — завжди в кінці: напрямок сортування на них не діє.
  if (aEmpty) return 1;
  if (bEmpty) return -1;

  const aNum = typeof a === 'number';
  const bNum = typeof b === 'number';

  let result;
  if (aNum && bNum) result = a - b;
  else if (aNum !== bNum) result = aNum ? -1 : 1; // числа перед текстом
  else result = String(a).localeCompare(String(b), 'uk', { numeric: true, sensitivity: 'base' });

  return desc ? -result : result;
}

function sortSelection(desc = false) {
  const b = getBounds();
  if (b.rMin === b.rMax) {
    showInfoModal('Для сортування виділи кілька рядків.');
    return;
  }

  const rows = [];
  // Ключі всіх рядків рахуємо в одному циклі перерахунку: формули в стовпці
  // сортування часто спираються на ті самі клітинки.
  beginCalculation();
  try {
    for (let r = b.rMin; r <= b.rMax; r++) {
      const rowData = [];
      const rowStyles = [];
      for (let c = b.cMin; c <= b.cMax; c++) {
        const id = getCellId(c, r);
        rowData.push(cellData[id] ?? '');
        rowStyles.push(cellStyles[id] ?? '');
      }
      rows.push({ sourceRow: r, keyValue: sortKeyForCell(getCellId(b.cMin, r)), rowData, rowStyles });
    }
  } finally {
    endCalculation();
  }

  // Рівні ключі зберігають початковий порядок рядків — і за зростанням, і за
  // спаданням, тож повторне сортування не перемішує однакові значення.
  rows.sort((x, y) => compareSortValues(x.keyValue, y.keyValue, desc) || (x.sourceRow - y.sourceRow));

  rows.forEach((row, rowOffset) => {
    const targetRow = b.rMin + rowOffset;
    const rowDelta = targetRow - row.sourceRow;
    for (let c = b.cMin; c <= b.cMax; c++) {
      const id = getCellId(c, targetRow);
      const idx = c - b.cMin;
      const value = row.rowData[idx];
      const style = row.rowStyles[idx];

      const moved = (rowDelta !== 0 && typeof value === 'string' && value.startsWith('='))
        ? offsetFormulaRefs(value, rowDelta, 0)
        : value;

      if (moved === '') delete cellData[id];
      else cellData[id] = moved;
      if (style) cellStyles[id] = style;
      else delete cellStyles[id];
    }
  });

  rebuildGrid();
  recalculateAll();
  persistStateToStorage();
  setSaveBadge();
  saveToHistory();
}

window.TablesSorting = {
  compareSortValues,
  sortKeyForCell,
  sortSelection
};
