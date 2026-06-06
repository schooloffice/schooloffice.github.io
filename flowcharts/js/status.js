(function () {
  'use strict';

  function createStatusController({ dirtyDotEl, savedBadgeEl } = {}) {
    let dirtyBadgeTimer = 0;
    let savedBadgeTimer = 0;

    function setDirty(flag) {
      if (dirtyBadgeTimer) clearTimeout(dirtyBadgeTimer);
      if (dirtyDotEl) dirtyDotEl.style.opacity = flag ? '1' : '0';
    }

    function flashSavedBadge() {
      if (!savedBadgeEl) return;
      if (savedBadgeTimer) clearTimeout(savedBadgeTimer);
      savedBadgeEl.style.opacity = '1';
      savedBadgeTimer = setTimeout(() => {
        savedBadgeEl.style.opacity = '0';
      }, 1800);
    }

    function dispose() {
      if (dirtyBadgeTimer) clearTimeout(dirtyBadgeTimer);
      if (savedBadgeTimer) clearTimeout(savedBadgeTimer);
      dirtyBadgeTimer = 0;
      savedBadgeTimer = 0;
    }

    return {
      dispose,
      flashSavedBadge,
      setDirty,
    };
  }

  window.FlowchartsStatus = {
    createStatusController,
  };
}());
