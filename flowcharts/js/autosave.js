(function () {
  'use strict';

  function hasProjectContent(project) {
    return (project?.shapes?.length || 0) > 0
      || (project?.connections?.length || 0) > 0
      || !!String(project?.diagramTitle || '').trim();
  }

  function createAutosaveController({
    storageKey,
    collectProjectData,
    parseProject,
    onRestoreDraft,
    onDiscardDraft,
    showRestoreDraftModal,
  } = {}) {
    const draftStore = window.OfficeStorage.createDraftStore({
      app: 'flowcharts',
      key: 'flowcharts',
      fallbackKey: storageKey,
      legacyKeys: [storageKey],
      decodeLegacy(value) {
        if (!value?.project) return null;
        const savedAt = Date.parse(value.savedAt) || 0;
        return {
          schemaVersion: 1,
          savedAt,
          revision: savedAt * 1000,
          payload: value
        };
      }
    });
    let autosaveRaf = 0;

    function clear() {
      return draftStore.clear();
    }

    async function persist() {
      const project = collectProjectData?.();
      if (!hasProjectContent(project)) return clear();
      return draftStore.save({
        savedAt: new Date().toISOString(),
        project
      });
    }

    function schedule() {
      if (autosaveRaf) return;
      autosaveRaf = requestAnimationFrame(() => {
        autosaveRaf = 0;
        persist().catch(() => {});
      });
    }

    async function readDraft() {
      const draft = await draftStore.load();
      if (!draft || typeof draft !== 'object' || !draft.project) return null;
      const parsedProject = parseProject ? parseProject(draft.project) : draft.project;
      if (!hasProjectContent(parsedProject)) return null;
      return {
        savedAt: draft.savedAt || null,
        project: parsedProject,
      };
    }

    async function promptRestore() {
      let draft;
      try {
        draft = await readDraft();
      } catch {
        return;
      }
      if (!draft) return;
      const when = draft.savedAt
        ? new Date(draft.savedAt).toLocaleString('uk-UA')
        : 'невідомий час';

      showRestoreDraftModal?.(
        `Знайдено незбережену чернетку від ${when}. Хочеш продовжити роботу з нею або почати нову схему?`,
        () => onRestoreDraft?.(draft.project),
        () => {
          clear();
          onDiscardDraft?.();
        },
      );
    }

    return {
      clear,
      flush: () => draftStore.flush(),
      persist,
      promptRestore,
      readDraft,
      schedule,
    };
  }

  window.FlowchartsAutosave = {
    createAutosaveController,
  };
}());
