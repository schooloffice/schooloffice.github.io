'use strict';

/* text/core/draft-storage.js — тонкий адаптер над спільним сховищем чернеток.
 * Механізм живе в office-draft-storage.js; тут лишаються тільки ключі
 * цього редактора.
 */
const ArtDraftStorage = window.OfficeDraftStorage.createDraftStorage({
  dbName: 'plus_text',
  storageKey: 'plus_text_draft'
});
