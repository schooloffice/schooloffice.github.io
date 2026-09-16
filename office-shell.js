(function () {
  'use strict';

  function runCommand(command, detail = {}) {
    return window.OfficeUI?.runCommand?.(command, detail) || false;
  }

  function openFilePicker(input) {
    if (!input) return false;
    if (window.OfficeUI?.openFilePicker?.(input)) return true;
    input.click();
    return true;
  }

  function registerCommands(source, commandMap, options = {}) {
    if (!commandMap || typeof commandMap !== 'object') return [];
    return window.OfficeUI?.registerCommands?.(commandMap, { source, ...options }) || [];
  }

  function bootEditor({ source, commands, boot, options = {} } = {}) {
    const commandMap = typeof commands === 'function' ? commands() : commands;
    if (commandMap) registerCommands(source, commandMap, options);
    return typeof boot === 'function' ? boot() : undefined;
  }

  // Стартовий документ (E2): локальний файл редактора з прекешу sw.js. Повертає File, який редактор
  // відкриває тим самим шляхом, що й файл користувача, — з тими самими перевірками, лімітами й
  // підтвердженням заміни. Помилка мережі чи відсутній кеш — виняток для повідомлення учневі.
  async function loadStarterFile(path, fileName, type = '') {
    const response = await fetch(path);
    if (!response.ok) throw new Error(`Приклад недоступний (HTTP ${response.status})`);
    const blob = await response.blob();
    return new File([blob], fileName, { type: type || blob.type });
  }

  window.OfficeShell = {
    runCommand,
    openFilePicker,
    registerCommands,
    bootEditor,
    loadStarterFile
  };
}());
