'use strict';

const NEXA_AI_NOT_CONFIGURED_CONTRACT = 'error marker: AI provider not configured';
const NEXA_AI_TIMEOUT_CONTRACT = 'timeout marker: AI_REQUEST_TIMEOUT_MS';
const NEXA_AI_SAVE_CONFIRMATION_CONTRACT = 'confirmation marker: data-testid="ai-save-confirmation"';

(function registerAiModule(global) {
  const AI_ACTION_CONTRACT = 'data-nexa-action="ai-provider-select|ai-test-connection|ai-generate|ai-cancel|ai-save-task|ai-save-note"';
  const moduleApi = {
    actionContract: AI_ACTION_CONTRACT,
    providerNotConfiguredMessage: 'AI provider not configured',
    generate: function generate(api, payload) { return api.ai.generate(payload); },
    cancel: function cancel(api, requestId) { return api.ai.cancel(requestId); },
    saveTask: function saveTask(api, payload) { return api.ai.saveTask(payload); },
    saveNote: function saveNote(api, payload) { return api.ai.saveNote(payload); }
  };
  global.NexaModules = global.NexaModules || {};
  global.NexaModules.ai = moduleApi;
}(window));
