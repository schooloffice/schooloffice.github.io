'use strict';

window.ArtVector = window.ArtVector || {};

(() => {
  const storageKey = window.ArtVector.constants.STORAGE_KEY;
  const draftStore = window.OfficeStorage.createDraftStore({
    app: 'vector',
    key: 'vector',
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

  window.ArtVector.vectorStorage = {
    saveDraft: payload => draftStore.save(payload),
    loadDraft: () => draftStore.load(),
    clearDraft: () => draftStore.clear(),
    flushDraft: () => draftStore.flush(),
    chooseNewerDraftRecord
  };
})();
