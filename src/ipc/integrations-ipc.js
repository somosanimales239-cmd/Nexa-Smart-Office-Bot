'use strict';

const { registerIpcHandler } = require('./ipc-utils');

const INTEGRATION_IPC_CONTRACT = 'IPC channels: integration:get, integration:save, integration:test, integration:sync, integration:resource, integration:disconnect';

function registerIntegrationsIpc(ipcMain, services) {
  const database = services.database;
  const settingsService = services.settingsService;
  const apiService = services.apiService;
  const notificationService = services.notificationService;

  registerIpcHandler(ipcMain, 'integration:get', function getIntegration() {
    return {
      settings: settingsService.getPublicSettings(),
      status: database.getIntegrationStatus(),
      snapshots: database.listIntegrationSnapshots()
    };
  });

  registerIpcHandler(ipcMain, 'integration:save', function saveIntegration(payload) {
    const input = Object.assign({}, payload || {});
    const key = typeof input.automarket_api_key === 'string' ? input.automarket_api_key : '';
    delete input.automarket_api_key;
    database.saveSettings(input);
    if (key.trim()) settingsService.saveSecret('automarket', key);
    return settingsService.getPublicSettings();
  });

  registerIpcHandler(ipcMain, 'integration:test', async function testIntegration() {
    const result = await apiService.testConnection();
    database.saveIntegrationStatus({ connected: 1, connection_map_json: JSON.stringify(result.connectionMap || {}), last_sync_at: result.testedAt, last_error: '' });
    return result;
  });

  registerIpcHandler(ipcMain, 'integration:sync', async function syncIntegration() {
    return notificationService.syncAutoMarket(true);
  });

  registerIpcHandler(ipcMain, 'integration:resource', async function fetchResource(payload) {
    const resource = String(payload.resource || 'ping');
    const query = payload.query && typeof payload.query === 'object' ? payload.query : {};
    const response = await apiService.fetchResource(resource, query);
    database.saveIntegrationSnapshot({
      resource: resource,
      payload_hash: require('../services/automarket-api-service').stableHash(response.payload),
      item_count: Array.isArray(response.payload) ? response.payload.length : 0,
      payload_json: JSON.stringify(response.payload || null),
      last_checked_at: response.receivedAt,
      last_changed_at: response.receivedAt
    });
    return response;
  });

  registerIpcHandler(ipcMain, 'integration:disconnect', function disconnectIntegration() {
    settingsService.removeSecret('automarket');
    database.saveSettings({ automarket_sync_enabled: '0' });
    database.saveIntegrationStatus({ connected: 0, last_error: 'Disconnected by user.' });
    return { disconnected: true };
  });
}

module.exports = {
  INTEGRATION_IPC_CONTRACT,
  registerIntegrationsIpc
};
