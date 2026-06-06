(function () {
  'use strict';

  function openModal(modal) {
    if (window.OfficeUI?.openModal?.(modal)) return;
    modal?.classList.remove('hidden');
    modal?.classList.add('active');
    modal?.setAttribute('aria-hidden', 'false');
  }

  function closeModal(modal) {
    if (window.OfficeUI?.closeModal?.(modal)) return;
    modal?.classList.remove('active');
    modal?.classList.remove('hidden');
    modal?.setAttribute('aria-hidden', 'true');
  }

  function initMenus(onAction) {
    let openMenuName = null;

    function closeMenus() {
      openMenuName = null;
      document.querySelectorAll('.menu-dropdown.open').forEach((dropdown) => dropdown.classList.remove('open'));
      document.querySelectorAll('.menu-title').forEach((title) => title.setAttribute('aria-expanded', 'false'));
    }

    function openMenu(name) {
      closeMenus();
      openMenuName = name;
      document.querySelector(`.menu-title[data-menu="${name}"]`)?.setAttribute('aria-expanded', 'true');
      document.querySelector(`.menu-dropdown[data-menu="${name}"]`)?.classList.add('open');
    }

    document.querySelectorAll('.menu-title').forEach((title) => {
      title.addEventListener('click', (event) => {
        event.stopPropagation();
        const name = title.dataset.menu;
        if (!name) return;
        if (openMenuName === name) closeMenus();
        else openMenu(name);
      });
    });

    document.querySelectorAll('.menu-item[data-action]').forEach((item) => {
      item.addEventListener('click', (event) => {
        event.stopPropagation();
        closeMenus();
        onAction?.(item.dataset.action);
      });
    });

    document.addEventListener('click', (event) => {
      if (!event.target.closest('.menu-item-wrap')) closeMenus();
    });

    document.addEventListener('office:overlayclose', (event) => {
      if (event.detail?.type === 'menu') openMenuName = null;
    });

    return { closeMenus, openMenu };
  }

  function renderHelpPanelContent(helpPanel) {
    const stepsWrap = helpPanel?.querySelector('.help-steps');
    if (!stepsWrap) return;
    stepsWrap.innerHTML = `
      <div class="help-step"><span class="step-num">1</span><span><strong>Додати блок</strong> — натисни потрібну фігуру в лівій панелі <strong>Блоки</strong>.</span></div>
      <div class="help-step"><span class="step-num">2</span><span><strong>Змінити текст</strong> — двічі натисни на блок або виділи його і натисни кнопку <strong>Текст</strong> на верхній панелі.</span></div>
      <div class="help-step"><span class="step-num">3</span><span><strong>З'єднати стрілкою</strong> — наведи на блок і потягни від білого кружечка до іншого блока. Для ромба: <span style="color:#15803d">Так</span> виходить ліворуч, <span style="color:#b91c1c">Ні</span> — праворуч.</span></div>
      <div class="help-step"><span class="step-num">4</span><span><strong>Підписати стрілку</strong> — виділи стрілку і натисни <strong>Підпис</strong> на верхній панелі.</span></div>
      <div class="help-step"><span class="step-num">5</span><span><strong>Маршрут стрілки</strong> — виділи стрілку і натисни <strong>Маршрут</strong> або клавішу <strong>R</strong>. Для циклів використовуй обхід ліворуч або праворуч.</span></div>
      <div class="help-step"><span class="step-num">6</span><span><strong>Колір блока</strong> — виділи блок і натисни потрібний колір у лівій панелі <strong>Кольори</strong>.</span></div>
      <div class="help-step"><span class="step-num">7</span><span><strong>Перемістити блок</strong> — тягни мишею або пальцем. Увімкнена сітка допоможе розміщувати все рівно.</span></div>
      <div class="help-step"><span class="step-num">8</span><span><strong>Прив'язка до сітки</strong> — кнопка <strong><i class="fa-solid fa-border-all"></i></strong> на верхній панелі або клавіша <strong>G</strong>. Коли кнопка підсвічена — прив'язка увімкнена.</span></div>
      <div class="help-step"><span class="step-num">9</span><span><strong>Масштаб</strong> — кнопки <strong>−</strong>, <strong>+</strong>, <strong>100%</strong> на верхній панелі або колесо миші.</span></div>
      <div class="help-step"><span class="step-num">10</span><span><strong>Файл</strong> — кнопки <strong>Новий</strong>, <strong>Відкрити</strong> і <strong>Зберегти</strong> є на верхній панелі, а також у меню <strong>Файл</strong>. PNG та JSON-збереження знаходяться саме в меню <strong>Файл</strong>.</span></div>
      <div class="help-step help-step-link"><span class="step-num">?</span><span>Потрібні приклади схем або пояснення типів блоків — відкрий <a href="manual.html" target="_blank" rel="noopener noreferrer">довідник</a>.</span></div>
    `;
  }

  window.ArtSchemesUI = {
    openModal,
    closeModal,
    initMenus,
    renderHelpPanelContent,
  };
}());
