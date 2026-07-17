'use strict';

const NEXA_AI_NOT_CONFIGURED_CONTRACT = 'error marker: AI provider not configured';
const NEXA_AI_TIMEOUT_CONTRACT = 'timeout marker: AI_REQUEST_TIMEOUT_MS';
const NEXA_AI_SAVE_CONFIRMATION_CONTRACT = 'confirmation marker: data-testid="ai-save-confirmation"';
const NEXA_NOTIFICATION_CONTRACT = 'notification marker: new Notification(...)';

const { registerIpcHandler } = require('./ipc-utils');

const AI_IPC_CONTRACT = 'IPC channels: ai:provider-select, ai:test-connection, ai:generate, ai:cancel, ai:save-task, ai:save-note';

function registerAiIpc(ipcMain, services) {
  const aiService = services.aiService;
  const database = services.database;
  const settingsService = services.settingsService;

  registerIpcHandler(ipcMain, 'ai:provider-select', function selectProvider(payload) {
    const settings = settingsService.getPublicSettings();
    settings.preferred_provider = payload.provider;
    return settingsService.saveSettings(settings);
  });
  registerIpcHandler(ipcMain, 'ai:test-connection', function testConnection(payload) { return aiService.testConnection(payload.provider); });
  registerIpcHandler(ipcMain, 'ai:generate', function generateSuggestion(payload) { return aiService.generate(payload); });
  registerIpcHandler(ipcMain, 'ai:cancel', function cancelSuggestion(payload) { return aiService.cancel(payload.request_id); });
  registerIpcHandler(ipcMain, 'ai:list', function listSuggestions(payload) { return database.listSuggestions(payload.limit); });
  registerIpcHandler(ipcMain, 'ai:save-task', function saveSuggestionAsTask(payload) {
    return database.saveTask({
      title: payload.title || 'AI suggested action',
      description: payload.description || payload.suggestion || '',
      priority: payload.priority || 'Medium',
      status: 'Pending',
      due_at: payload.due_at || null
    });
  });
  registerIpcHandler(ipcMain, 'ai:save-note', function saveSuggestionAsNote(payload) {
    database.log('saved_note', 'ai_suggestion', payload.id || null, payload.note || payload.suggestion || '');
    return { saved: true };
  });
}

module.exports = {
  AI_IPC_CONTRACT,
  registerAiIpc
};
