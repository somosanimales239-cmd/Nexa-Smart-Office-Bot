'use strict';

const NEXA_SCHEMA_MIGRATION_CONTRACT = 'migration marker: NEXA_SCHEMA_MIGRATION_V1';
const NEXA_BACKUP_CONTRACT = 'backup marker: NEXA_BACKUP_REDACTED_SETTINGS_V1';

const path = require('node:path');
const fs = require('node:fs');
const { registerIpcHandler } = require('./ipc-utils');

const FOUNDATION_IPC_CONTRACT = 'IPC channels: db:query, settings:get, settings:save, settings:test-key, backup:create, backup:list, backup:restore, activity:list';

function registerFoundationIpc(ipcMain, services) {
  const database = services.database;
  const settingsService = services.settingsService;
  const backupService = services.backupService;
  const aiService = services.aiService;
  const app = services.app;
  const shell = services.shell;
  const dialog = services.dialog;
  const getMainWindow = services.getMainWindow;

  registerIpcHandler(ipcMain, 'app:meta', function appMeta() {
    return { version: services.appVersion, platform: process.platform, dataPath: app.getPath('userData') };
  });
  registerIpcHandler(ipcMain, 'dashboard:summary', function dashboardSummary() { return database.dashboardSummary(); });
  registerIpcHandler(ipcMain, 'db:query', function namedDatabaseQuery(payload) {
    const queryName = String(payload.name || '');
    if (queryName === 'dashboard-summary') return database.dashboardSummary();
    if (queryName === 'alerts') return database.listAlerts();
    throw new Error('Unsupported named database query.');
  });
  registerIpcHandler(ipcMain, 'activity:list', function activityList(payload) { return database.listActivity(payload.limit); });
  registerIpcHandler(ipcMain, 'settings:get', function settingsGet() { return settingsService.getPublicSettings(); });
  registerIpcHandler(ipcMain, 'settings:save', function settingsSave(payload) { return settingsService.saveSettings(payload); });
  registerIpcHandler(ipcMain, 'settings:remove-key', function settingsRemoveKey(payload) { return settingsService.removeSecret(payload.provider); });
  registerIpcHandler(ipcMain, 'settings:test-key', function settingsTestKey(payload) { return aiService.testConnection(payload.provider); });
  registerIpcHandler(ipcMain, 'backup:list', function backupList() { return backupService.list(); });
  registerIpcHandler(ipcMain, 'backup:create', function backupCreate() { return backupService.create('manual'); });
  registerIpcHandler(ipcMain, 'backup:restore', async function backupRestore(payload) {
    const result = await dialog.showMessageBox(getMainWindow(), {
      type: 'warning',
      buttons: ['Cancel', 'Restore backup'],
      defaultId: 0,
      cancelId: 0,
      title: 'Restore database backup',
      message: 'Current local data will be replaced. A safety copy will be created first.'
    });
    if (result.response !== 1) return { restored: false, canceled: true };
    return backupService.restore(payload.file_path);
  });
  registerIpcHandler(ipcMain, 'backup:open-folder', async function backupOpenFolder() {
    const backupDirectory = path.join(app.getPath('userData'), 'backups');
    fs.mkdirSync(backupDirectory, { recursive: true });
    await shell.openPath(backupDirectory);
    return true;
  });
}

module.exports = {
  FOUNDATION_IPC_CONTRACT,
  registerFoundationIpc
};
