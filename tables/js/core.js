'use strict';

/*
  Tables core facade.
  The actual domain logic lives in:
  - model.js
  - storage.js
  - addressing.js
  - formula-engine.js
*/

loadStateFromStorage();

window.TablesCore = {
  addressing: window.TablesAddressing,
  formulaEngine: window.TablesFormulaEngine,
  model: window.TablesModel,
  storage: window.TablesStorage
};
