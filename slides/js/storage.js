import { STORAGE_KEY } from './constants.js';

const draftStore = window.OfficeStorage.createDraftStore({
  app: 'slides',
  key: 'slides',
  fallbackKey: STORAGE_KEY,
  legacyKeys: [STORAGE_KEY]
});

export function chooseNewerDraftRecord(idbRecord, localRecord) {
  if (!idbRecord) return localRecord;
  if (!localRecord) return idbRecord;
  if (idbRecord.savedAt !== localRecord.savedAt) {
    return idbRecord.savedAt > localRecord.savedAt ? idbRecord : localRecord;
  }
  if (localRecord.payload === null) return localRecord;
  if (idbRecord.payload === null) return idbRecord;
  return idbRecord;
}

export function saveDraft(data) {
  return draftStore.save(data);
}

export function loadDraft() {
  return draftStore.load();
}

export function clearDraft() {
  return draftStore.clear();
}

export function flushDraft() {
  return draftStore.flush();
}
