import { STORAGE_KEY } from './constants.js';

// Тонкий адаптер над спільним сховищем чернеток (office-draft-storage.js).
// Слайди — ES-модуль, тож фабрику беремо з глобального шару, а назовні
// віддаємо ті самі іменовані експорти, що й раніше.
if (!window.OfficeDraftStorage) {
  throw new Error('slides/js/storage.js: спершу підключіть office-draft-storage.js');
}

const storage = window.OfficeDraftStorage.createDraftStorage({
  dbName: 'plus_slides',
  storageKey: STORAGE_KEY
});

export const chooseNewerDraftRecord = storage.chooseNewerDraftRecord;
export const saveDraft = storage.saveDraft;
export const loadDraft = storage.loadDraft;
export const clearDraft = storage.clearDraft;
