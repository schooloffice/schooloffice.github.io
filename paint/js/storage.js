'use strict';

/* paint/js/storage.js — тонкий адаптер над спільним сховищем чернеток.
 * Механізм живе в office-draft-storage.js; тут лишаються тільки ключі
 * цього редактора.
 */
window.ArtMalyunky = window.ArtMalyunky || {};

(() => {
  const { constants } = window.ArtMalyunky;
  window.ArtMalyunky.paintStorage = window.OfficeDraftStorage.createDraftStorage({
    dbName: 'plus_paint',
    storageKey: constants.STORAGE_KEY
  });
})();
