import { createThumbSnapshot } from './export.js';
import { pushHistory } from './history.js';
import { state } from './state.js';
import { $$ } from './utils.js';

let draggedSlideId = null;

export function renderSlideList({
  host,
  closeColorPopover,
  confirmDeleteSlide,
  duplicateSlide,
  markDirty,
  moveSlide,
  renderAll,
  setStatusRight
}) {
  host.innerHTML = '';
  state.slides.forEach((slide, index) => {
    const card = document.createElement('div');
    card.className = `slide-card${slide.id === state.currentSlideId ? ' active' : ''}`;
    card.draggable = true;
    card.dataset.slideId = slide.id;

    card.addEventListener('click', () => {
      state.currentSlideId = slide.id;
      state.selectedElementId = null;
      closeColorPopover();
      renderAll();
      setStatusRight('Слайд вибрано');
    });

    const startDrag = event => {
      draggedSlideId = slide.id;
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData('text/plain', slide.id);
      requestAnimationFrame(() => card.classList.add('dragging-card'));
    };
    card.addEventListener('dragstart', startDrag);
    card.addEventListener('dragend', () => {
      draggedSlideId = null;
      card.classList.remove('dragging-card');
      $$('.slide-card.drag-over').forEach(node => node.classList.remove('drag-over'));
    });
    card.addEventListener('dragover', event => {
      event.preventDefault();
      if (draggedSlideId && draggedSlideId !== slide.id) card.classList.add('drag-over');
    });
    card.addEventListener('dragleave', () => card.classList.remove('drag-over'));
    card.addEventListener('drop', event => {
      event.preventDefault();
      card.classList.remove('drag-over');
      const fromId = draggedSlideId || event.dataTransfer.getData('text/plain');
      if (fromId && fromId !== slide.id) reorderSlides(fromId, slide.id, { markDirty, renderAll });
    });

    const head = document.createElement('div');
    head.className = 'slide-card-head';

    const titleWrap = document.createElement('div');
    titleWrap.className = 'slide-card-title-wrap';

    const dragHandle = document.createElement('button');
    dragHandle.type = 'button';
    dragHandle.className = 'slide-drag-handle';
    dragHandle.title = 'Перетягни, щоб змінити порядок';
    dragHandle.innerHTML = '<i class="fa-solid fa-grip-vertical"></i>';
    dragHandle.draggable = true;
    dragHandle.addEventListener('dragstart', startDrag);
    dragHandle.addEventListener('click', event => event.stopPropagation());

    const title = document.createElement('div');
    title.className = 'slide-card-title';
    title.textContent = `Слайд ${index + 1}`;
    titleWrap.append(dragHandle, title);

    const cardActions = document.createElement('div');
    cardActions.className = 'slide-card-actions';
    cardActions.appendChild(makeMiniAction('fa-solid fa-arrow-up', 'Перемістити вгору', () => moveSlideById(slide.id, -1, moveSlide)));
    cardActions.appendChild(makeMiniAction('fa-solid fa-arrow-down', 'Перемістити вниз', () => moveSlideById(slide.id, 1, moveSlide)));
    cardActions.appendChild(makeMiniAction('fa-regular fa-copy', 'Дублювати слайд', () => duplicateSlide(slide.id)));
    cardActions.appendChild(makeMiniAction('fa-regular fa-trash-can', 'Видалити слайд', () => confirmDeleteSlide(slide.id)));

    head.append(titleWrap, cardActions);

    const thumbButton = document.createElement('button');
    thumbButton.type = 'button';
    thumbButton.className = 'slide-thumb-button';
    thumbButton.draggable = false;

    const thumb = document.createElement('div');
    thumb.className = 'slide-thumb';
    thumb.appendChild(createThumbSnapshot(slide));
    thumbButton.appendChild(thumb);

    card.append(head, thumbButton);
    host.appendChild(card);
  });
}

function reorderSlides(fromId, toId, { markDirty, renderAll }) {
  const fromIndex = state.slides.findIndex(slide => slide.id === fromId);
  const toIndex = state.slides.findIndex(slide => slide.id === toId);
  if (fromIndex === -1 || toIndex === -1 || fromIndex === toIndex) return;
  pushHistory();
  const [slide] = state.slides.splice(fromIndex, 1);
  state.slides.splice(toIndex, 0, slide);
  state.currentSlideId = slide.id;
  renderAll();
  markDirty('Порядок слайдів змінено');
}

function moveSlideById(slideId, direction, moveSlide) {
  const index = state.slides.findIndex(slide => slide.id === slideId);
  if (index === -1) return;
  state.currentSlideId = slideId;
  moveSlide(direction);
}

function makeMiniAction(iconClass, title, handler) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'mini-btn';
  button.title = title;
  button.innerHTML = `<i class="${iconClass}"></i>`;
  button.addEventListener('click', event => {
    event.stopPropagation();
    handler();
  });
  return button;
}
