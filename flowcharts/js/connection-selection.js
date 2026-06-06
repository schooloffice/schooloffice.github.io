(function () {
  'use strict';

  function setButtonLabel(button, label) {
    if (!button) return;
    const span = button.querySelector('span');
    if (span) span.textContent = label;
    else button.textContent = label;
  }

  function createLabelModal() {
    const modal = document.createElement('div');
    modal.id = 'connection-label-modal';
    modal.className = 'modal';
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    modal.setAttribute('aria-labelledby', 'connection-label-modal-title');
    modal.innerHTML = `
      <div class="modal-content">
        <h2 id="connection-label-modal-title"><i class="fa-solid fa-tag"></i> Підпис стрілки</h2>
        <p>Введи довільний підпис для стрілки або залиш поле порожнім, щоб прибрати власний підпис.</p>
        <input id="connection-label-input" type="text" maxlength="40"
          aria-label="Підпис стрілки"
          style="width:100%;padding:12px;border:2px solid var(--light-border);border-radius:10px;font-size:16px;font-family:var(--font);font-weight:800;margin-bottom:14px;display:block;">
        <div class="modal-buttons">
          <button class="modal-btn cancel-btn" id="cancel-connection-label">Скасувати</button>
          <button class="modal-btn ok-btn" id="save-connection-label"><i class="fa-solid fa-check"></i> Зберегти</button>
        </div>
      </div>
    `;
    document.body.appendChild(modal);

    return {
      modal,
      input: modal.querySelector('#connection-label-input'),
      cancelButton: modal.querySelector('#cancel-connection-label'),
      saveButton: modal.querySelector('#save-connection-label'),
    };
  }

  function createConnectionSelectionController(options) {
    const {
      state,
      routeModes,
      routeModeLabels,
      selectionStateEl,
      routeButton,
      labelButton,
      editShapeButton,
      deleteButton,
      saveSnapshot,
      updateConnection,
      deselectAll,
      hideAllHandles,
      openModal,
      closeModal,
    } = options || {};

    const modes = Array.isArray(routeModes) && routeModes.length ? routeModes : ['auto'];
    const labels = routeModeLabels || {};
    let pendingConnectionLabelId = null;
    const labelModal = createLabelModal();

    function clearConnectionSelection(updateBar = true) {
      if (state?.selectedConnId) {
        const path = document.getElementById(state.selectedConnId);
        if (path) {
          path.setAttribute('stroke', path._origStroke || '#555');
          path.setAttribute('stroke-width', '2.8');
          path.removeAttribute('stroke-dasharray');
          path.setAttribute('marker-end', path._origMarker || 'url(#arrowhead)');
        }
      }
      if (state) state.selectedConnId = null;
      if (updateBar) updateConnectionBar();
    }

    function selectConnection(connId) {
      deselectAll?.(false);
      hideAllHandles?.();
      if (state?.selectedConnId === connId) {
        clearConnectionSelection();
        return;
      }
      clearConnectionSelection(false);
      if (state) state.selectedConnId = connId;

      const path = document.getElementById(connId);
      if (path) {
        path._origStroke = path.getAttribute('stroke');
        path._origMarker = path.getAttribute('marker-end');
        path.setAttribute('stroke', '#e91e63');
        path.setAttribute('stroke-width', '3.5');
        path.setAttribute('stroke-dasharray', '9 4');
        path.setAttribute('marker-end', 'url(#arrowhead-selected)');
      }
      updateConnectionBar();
    }

    function updateConnectionBar() {
      const hasSelectedConn = !!state?.selectedConnId;
      const hasShapeSelected = !!state?.selectedShape;
      const hasAnySelection = hasSelectedConn || hasShapeSelected;

      if (selectionStateEl) {
        if (hasSelectedConn) {
          const conn = state.connections.find((c) => c.id === state.selectedConnId);
          const label = conn?.type === 'yes' ? 'стрілка Так' : conn?.type === 'no' ? 'стрілка Ні' : 'стрілка';
          selectionStateEl.textContent = `Вибрано: ${label}`;
          selectionStateEl.classList.remove('is-empty');
        } else if (hasShapeSelected) {
          const shapeData = state.shapes.find((shape) => shape.id === state.selectedShape.id);
          const text = String(shapeData?.textRaw || '').trim() || 'блок';
          selectionStateEl.textContent = `Вибрано: ${text}`;
          selectionStateEl.classList.remove('is-empty');
        } else {
          selectionStateEl.textContent = 'Нічого не вибрано';
          selectionStateEl.classList.add('is-empty');
        }
      }

      if (routeButton) {
        if (!hasSelectedConn) {
          routeButton.disabled = true;
          setButtonLabel(routeButton, 'Маршрут');
        } else {
          routeButton.disabled = false;
          const conn = state.connections.find((c) => c.id === state.selectedConnId);
          const mode = modes.includes(conn?.routeMode) ? conn.routeMode : 'auto';
          setButtonLabel(routeButton, `Маршрут: ${labels[mode]}`);
        }
      }

      if (labelButton) {
        labelButton.disabled = !hasSelectedConn;
        const conn = hasSelectedConn ? state.connections.find((c) => c.id === state.selectedConnId) : null;
        setButtonLabel(labelButton, conn?.label ? 'Підпис: змінити' : 'Підпис');
      }

      if (editShapeButton) editShapeButton.disabled = !hasShapeSelected || hasSelectedConn;
      if (deleteButton) deleteButton.disabled = !hasAnySelection;
    }

    function cycleSelectedConnectionRouteMode() {
      if (!state?.selectedConnId) return;
      const conn = state.connections.find((item) => item.id === state.selectedConnId);
      if (!conn) return;

      const current = modes.includes(conn.routeMode) ? conn.routeMode : 'auto';
      const next = modes[(modes.indexOf(current) + 1) % modes.length];
      saveSnapshot?.();
      conn.routeMode = next;
      updateConnection?.(conn.id);
      updateConnectionBar();
    }

    function editSelectedConnectionLabel() {
      if (!state?.selectedConnId) return;
      const conn = state.connections.find((item) => item.id === state.selectedConnId);
      if (!conn) return;
      pendingConnectionLabelId = conn.id;
      if (labelModal.input) labelModal.input.value = conn.label ?? '';
      openModal?.(labelModal.modal);
      setTimeout(() => labelModal.input?.focus(), 40);
    }

    function saveConnectionLabel() {
      if (!pendingConnectionLabelId) {
        closeModal?.(labelModal.modal);
        return;
      }

      const conn = state.connections.find((item) => item.id === pendingConnectionLabelId);
      pendingConnectionLabelId = null;
      if (!conn) {
        closeModal?.(labelModal.modal);
        return;
      }

      const normalized = (labelModal.input?.value || '').trim();
      saveSnapshot?.();
      conn.label = normalized || null;
      updateConnection?.(conn.id);
      updateConnectionBar();
      closeModal?.(labelModal.modal);
    }

    routeButton?.addEventListener('click', cycleSelectedConnectionRouteMode);
    labelButton?.addEventListener('click', editSelectedConnectionLabel);
    labelModal.cancelButton?.addEventListener('click', () => {
      pendingConnectionLabelId = null;
      closeModal?.(labelModal.modal);
    });
    labelModal.saveButton?.addEventListener('click', saveConnectionLabel);
    labelModal.input?.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        saveConnectionLabel();
      }
    });

    return {
      clearConnectionSelection,
      selectConnection,
      updateConnectionBar,
      cycleSelectedConnectionRouteMode,
      editSelectedConnectionLabel,
    };
  }

  window.FlowchartsConnectionSelection = {
    createConnectionSelectionController,
  };
})();
