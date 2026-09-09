'use strict';

window.ArtMalyunky = window.ArtMalyunky || {};

(() => {
  const storageKey = window.ArtMalyunky.constants.STORAGE_KEY;
  const draftStore = window.OfficeStorage.createDraftStore({
    app: 'paint',
    key: 'paint',
    fallbackKey: storageKey,
    legacyKeys: [storageKey]
  });

  function chooseNewerDraftRecord(idbRecord, localRecord) {
    if (!idbRecord) return localRecord;
    if (!localRecord) return idbRecord;
    if (idbRecord.savedAt !== localRecord.savedAt) {
      return idbRecord.savedAt > localRecord.savedAt ? idbRecord : localRecord;
    }
    if (localRecord.payload === null) return localRecord;
    if (idbRecord.payload === null) return idbRecord;
    return idbRecord;
  }

  window.ArtMalyunky.paintStorage = {
    saveDraft: payload => draftStore.save(payload),
    loadDraft: () => draftStore.load(),
    clearDraft: () => draftStore.clear(),
    flushDraft: () => draftStore.flush(),
    chooseNewerDraftRecord
  };
})();
