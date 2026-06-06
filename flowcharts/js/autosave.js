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
    let autosaveRaf = 0;

    function clear() {
      try {
        localStorage.removeItem(storageKey);
      } catch (error) {
        console.warn('Flowchart editor: failed to clear autosave.', error);
      }
    }

    function persist() {
      try {
        const project = collectProjectData?.();
        if (!hasProjectContent(project)) {
          localStorage.removeItem(storageKey);
          return;
        }

        localStorage.setItem(storageKey, JSON.stringify({
          savedAt: new Date().toISOString(),
          project,
        }));
      } catch (error) {
        console.warn('Flowchart editor: autosave failed.', error);
      }
    }

    function schedule() {
      if (autosaveRaf) return;
      autosaveRaf = requestAnimationFrame(() => {
        autosaveRaf = 0;
        persist();
      });
    }

    function readDraft() {
      try {
        const raw = localStorage.getItem(storageKey);
        if (!raw) return null;
        const draft = JSON.parse(raw);
        if (!draft || typeof draft !== 'object' || !draft.project) return null;
        const parsedProject = parseProject ? parseProject(draft.project) : draft.project;
        if (!hasProjectContent(parsedProject)) return null;
        return {
          savedAt: draft.savedAt || null,
          project: parsedProject,
        };
      } catch (error) {
        console.warn('Flowchart editor: failed to read autosave.', error);
        clear();
        return null;
      }
    }

    function promptRestore() {
      const draft = readDraft();
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
