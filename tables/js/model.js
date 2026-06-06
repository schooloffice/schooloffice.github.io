'use strict';

// ---- Table model config and shared state ----
const DEFAULT_ROWS = 60;
const DEFAULT_COL_COUNT = 30; // A..AD
const MAX_CALC_DEPTH = 60;
const MAX_CELL_LEN = 200;

let ROWS = DEFAULT_ROWS;
let COL_COUNT = DEFAULT_COL_COUNT;
let COLS = buildCols(COL_COUNT);

let cellData = {};
let colWidths = {};
let cellStyles = {};

let calcDepth = 0;
let history = [];
let historyIndex = -1;

function setGridSize(rows, colCount) {
  ROWS = Math.max(1, Math.min(500, Number(rows) || 1));
  COL_COUNT = Math.max(1, Math.min(200, Number(colCount) || 1));
  COLS = buildCols(COL_COUNT);
}

window.TablesModel = {
  setGridSize
};
