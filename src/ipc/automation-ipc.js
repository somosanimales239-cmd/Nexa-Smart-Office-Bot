'use strict';

const { registerIpcHandler } = require('./ipc-utils');

const AUTOMATION_IPC_CONTRACT = 'IPC channels: automation:get, automation:save, automation:run-now, automation:pause';
const EDITABLE_AUTOMATION_SETTINGS = new Set([
  'auto_actions_enabled', 'auto_actions_run_interval_seconds',
  'auto_messages_enabled', 'messages_ai_enabled', 'auto_messages_knowledge_only', 'auto_messages_ai_fallback', 'auto_messages_min_confidence',
  'auto_messages_send_delay_seconds', 'auto_messages_max_per_hour', 'auto_messages_max_per_day',
  'auto_messages_quiet_start', 'auto_messages_quiet_end', 'auto_messages_languages', 'auto_messages_require_unread',
  'auto_messages_mark_read', 'auto_messages_allowed_safety', 'auto_messages_excluded_intents',
  'auto_appointments_enabled', 'auto_appointments_source', 'auto_appointments_offer_slots',
  'auto_appointments_duration_minutes', 'auto_appointments_min_notice_hours', 'auto_appointments_max_days',
  'auto_appointments_require_contact', 'auto_appointments_create_remote', 'auto_appointments_send_confirmation',
  'auto_appointments_timezone', 'auto_appointments_slot_limit'
]);

function cleanSettings(payload) {
  const output = {};
  Object.entries(payload || {}).forEach(function accept(entry) {
    if (EDITABLE_AUTOMATION_SETTINGS.has(entry[0])) output[entry[0]] = String(entry[1]);
  });
  output.auto_actions_no_delete_guard = '1';
  return output;
}

function registerAutomationIpc(ipcMain, services) {
  const database = services.database;
  const automationService = services.automationService;

  registerIpcHandler(ipcMain, 'automation:get', function getAutomation() {
    return automationService.getState();
  });

  registerIpcHandler(ipcMain, 'automation:save', function saveAutomation(payload) {
    const input = payload && typeof payload === 'object' ? payload : {};
    const settings = cleanSettings(input.settings || input);
    if (settings.auto_actions_enabled === '1') {
      if (input.user_authorized !== true) throw new Error('Explicit user authorization is required before automatic actions can be enabled.');
      settings.auto_actions_consent_at = new Date().toISOString();
    } else if (Object.prototype.hasOwnProperty.call(settings, 'auto_actions_enabled')) {
      settings.auto_actions_consent_at = '';
    }
    database.saveSettings(settings);
    database.log('authorized_settings', 'automatic_actions', null,
      settings.auto_actions_enabled === '1' ? 'Guarded autonomy enabled by user.' : 'Guarded autonomy settings updated.');
    automationService.restart();
    return automationService.getState();
  });

  registerIpcHandler(ipcMain, 'automation:run-now', async function runAutomationNow() {
    return automationService.runNow('manual');
  });

  registerIpcHandler(ipcMain, 'automation:pause', function pauseAutomation() {
    database.saveSettings({
      auto_actions_enabled: '0', auto_actions_consent_at: '', auto_messages_enabled: '0', auto_appointments_enabled: '0', auto_actions_no_delete_guard: '1'
    });
    database.log('paused', 'automatic_actions', null, 'Emergency pause selected by user.');
    automationService.restart();
    return automationService.getState();
  });
}

module.exports = {
  AUTOMATION_IPC_CONTRACT,
  EDITABLE_AUTOMATION_SETTINGS,
  registerAutomationIpc
};
