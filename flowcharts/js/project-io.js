(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
    return;
  }
  root.FlowchartsProjectIO = factory();
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  function createProjectBridge(ctx) {
    const {
      core,
      state,
      projectFileInput,
      canvas,
      canvasContainer,
      titleDisplay,
      saveTitleModal,
      saveTitleInput,
      saveWithTitleBtn,
      saveWithoutTitleBtn,
      closeSaveTitleBtn,
      titleInput,
      saveButton,
      newProjectButton,
      saveProjectButton,
      openProjectButton,
      collectProjectData,
      saveSnapshot,
      restoreSnapshot,
      setDirty,
      flashSavedBadge,
      showMessageModal,
      sanitizeFilename,
      computeShapesBounds,
      clearConnectionSelection,
      hideAllHandles,
      updateConnectionBar,
      setZoom,
      scheduleRefresh,
      openModal,
      closeModal,
      renderTitle,
    } = ctx;

    function downloadProjectJson() {
      const project = collectProjectData();
      const filename = sanitizeFilename(state.diagramTitle || 'блок-схема');
      const blob = new Blob([JSON.stringify(project, null, 2)], { type: 'application/json;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.download = `${filename}.json`;
      link.href = url;
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 0);
      setDirty(false);
      flashSavedBadge();
    }

    function getImportErrorMessage(error) {
      if (error instanceof SyntaxError) {
        return 'Файл має помилку в JSON-форматі й не може бути відкритий.';
      }

      const message = String(error?.message || '');
      if (message.includes('Too many shapes')) {
        return 'У файлі занадто багато блоків. Максимум 500.';
      }
      if (message.includes('Too many connections')) {
        return 'У файлі занадто багато стрілок. Максимум 1000.';
      }
      if (message.includes('Invalid project data')) {
        return 'Це не схоже на JSON-проєкт із цього редактора.';
      }

      return 'Не вдалося відкрити проєкт. Перевір JSON-файл.';
    }

    function importProjectData(rawProject) {
      const parsed = core?.parseProject ? core.parseProject(rawProject) : (typeof rawProject === 'string' ? JSON.parse(rawProject) : rawProject);
      saveSnapshot();
      restoreSnapshot(parsed);
      setDirty(false);
      flashSavedBadge();
      showMessageModal('Проєкт завантажено.');
    }

    function openProjectFilePicker() {
      if (window.OfficeShell?.openFilePicker?.(projectFileInput)) return;
      projectFileInput.value = '';
      projectFileInput.click();
    }

    function runOfficeCommand(command) {
      return window.OfficeShell?.runCommand?.(command) || false;
    }

    function registerShellCommands(commandMap) {
      return window.OfficeShell?.registerCommands?.('flowcharts', commandMap) ||
        window.OfficeUI?.registerCommands?.(commandMap, { source: 'flowcharts' });
    }

    async function exportPng(options = {}) {
      const suppressTitle = !!options.suppressTitle;
      if (!window.html2canvas) {
        showMessageModal('html2canvas не завантажився. Перевір інтернет або скрипт.');
        return;
      }
      if (state.shapes.length === 0) {
        showMessageModal('Спочатку додай хоча б один блок.');
        return;
      }

      const prevScale = state.scale;
      const prevScroll = { left: canvasContainer.scrollLeft, top: canvasContainer.scrollTop };
      const prevTitleDisplay = titleDisplay ? titleDisplay.style.display : null;
      const prevTitleLeft = titleDisplay ? titleDisplay.style.left : '';
      const prevTitleTop = titleDisplay ? titleDisplay.style.top : '';
      const prevTitleTransform = titleDisplay ? titleDisplay.style.transform : '';
      const prevCanvasWidth = canvas.style.width;
      const prevCanvasHeight = canvas.style.height;
      if (suppressTitle && titleDisplay) titleDisplay.style.display = 'none';
      setZoom(1);
      await new Promise(resolve => setTimeout(resolve, 60));

      let bounds = computeShapesBounds();
      const pad = 90;
      if (!suppressTitle && titleDisplay && (state.diagramTitle || '').trim()) {
        titleDisplay.style.left = `${(bounds.minX + bounds.maxX) / 2}px`;
        titleDisplay.style.top = `${Math.max(24, bounds.minY - 70)}px`;
        titleDisplay.style.transform = 'translateX(-50%)';
        titleDisplay.style.display = '';
        await new Promise(resolve => requestAnimationFrame(resolve));
        bounds = computeShapesBounds();
      }

      const exportRight = Math.max(canvas.offsetWidth, bounds.maxX + pad);
      const exportBottom = Math.max(canvas.offsetHeight, bounds.maxY + pad);
      canvas.style.width = `${Math.ceil(exportRight)}px`;
      canvas.style.height = `${Math.ceil(exportBottom)}px`;
      await new Promise(resolve => requestAnimationFrame(resolve));

      const x = Math.max(0, bounds.minX - pad);
      const y = Math.max(0, bounds.minY - pad);
      const w = Math.max(1, Math.ceil((bounds.maxX - bounds.minX) + pad * 2));
      const h = Math.max(1, Math.ceil((bounds.maxY - bounds.minY) + pad * 2));

      const prevSel = state.selectedShape;
      prevSel?.classList.remove('selected');
      clearConnectionSelection(false);
      hideAllHandles();
      updateConnectionBar();

      try {
        const canvasSnapshot = await window.html2canvas(canvas, {
          backgroundColor: '#fafbff',
          x, y, width: w, height: h,
          scale: 2,
          useCORS: true,
        });
        const filename = sanitizeFilename(state.diagramTitle || 'блок-схема');
        const link = document.createElement('a');
        link.download = `${filename}.png`;
        link.href = canvasSnapshot.toDataURL('image/png');
        document.body.appendChild(link);
        link.click();
        link.remove();
        setDirty(false);
        flashSavedBadge();
      } catch (error) {
        console.error(error);
        showMessageModal('Не вдалося зберегти картинку. Спробуй інший браузер або зменш масштаб.');
      } finally {
        if (suppressTitle && titleDisplay) titleDisplay.style.display = prevTitleDisplay;
        if (!suppressTitle && titleDisplay) {
          titleDisplay.style.left = prevTitleLeft;
          titleDisplay.style.top = prevTitleTop;
          titleDisplay.style.transform = prevTitleTransform;
          titleDisplay.style.display = prevTitleDisplay;
        }
        canvas.style.width = prevCanvasWidth;
        canvas.style.height = prevCanvasHeight;
        if (prevSel) prevSel.classList.add('selected');
        setZoom(prevScale);
        canvasContainer.scrollLeft = prevScroll.left;
        canvasContainer.scrollTop = prevScroll.top;
        scheduleRefresh();
      }
    }

    function openSaveTitlePrompt() {
      if (!saveTitleModal) {
        exportPng();
        return;
      }
      if (saveTitleInput) {
        const current = (state.diagramTitle || titleInput?.value || '').trim();
        saveTitleInput.value = current;
      }
      openModal(saveTitleModal);
      setTimeout(() => saveTitleInput?.focus(), 40);
    }

    function bindProjectControls() {
      saveWithTitleBtn?.addEventListener('click', () => {
        const title = (saveTitleInput?.value || '').trim();
        if (!title) {
          showMessageModal('Введи назву або натисни "Зберегти без назви".');
          return;
        }
        state.diagramTitle = title;
        if (titleInput) titleInput.value = title;
        renderTitle();
        closeModal(saveTitleModal);
        exportPng();
      });

      saveWithoutTitleBtn?.addEventListener('click', () => {
        closeModal(saveTitleModal);
        exportPng({ suppressTitle: true });
      });

      closeSaveTitleBtn?.addEventListener('click', () => closeModal(saveTitleModal));

      saveButton?.addEventListener('click', openSaveTitlePrompt);
      newProjectButton?.addEventListener('click', () => ctx.clearButton?.click());
      saveProjectButton?.addEventListener('click', downloadProjectJson);
      openProjectButton?.addEventListener('click', openProjectFilePicker);
      projectFileInput.addEventListener('change', () => {
        const file = projectFileInput.files?.[0];
        if (!file) return;
        if (file.size > 2 * 1024 * 1024) {
          showMessageModal('Файл занадто великий. Максимум 2 МБ.');
          projectFileInput.value = '';
          return;
        }
        const reader = new FileReader();
        reader.onload = () => {
          try {
            importProjectData(String(reader.result || ''));
          } catch (error) {
            console.error(error);
            showMessageModal(getImportErrorMessage(error));
          }
        };
        reader.onerror = () => {
          showMessageModal('Не вдалося прочитати файл проєкту.');
        };
        reader.readAsText(file, 'utf-8');
      });
    }

    return {
      downloadProjectJson,
      getImportErrorMessage,
      importProjectData,
      openProjectFilePicker,
      runOfficeCommand,
      registerShellCommands,
      exportPng,
      openSaveTitlePrompt,
      bindProjectControls
    };
  }

  return {
    createProjectBridge
  };
}));
