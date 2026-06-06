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

  window.OfficeShell = {
    runCommand,
    openFilePicker,
    registerCommands,
    bootEditor
  };
}());
