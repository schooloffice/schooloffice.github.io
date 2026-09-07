'use strict';

/* vector/js/storage.js — тонкий адаптер над спільним сховищем чернеток.
 * Механізм живе в office-draft-storage.js; тут лишаються тільки ключі
 * цього редактора.
 */
window.ArtVector = window.ArtVector || {};

(() => {
  const { constants } = window.ArtVector;
  window.ArtVector.vectorStorage = window.OfficeDraftStorage.createDraftStorage({
    dbName: 'plus_vector',
    storageKey: constants.STORAGE_KEY
  });
})();
