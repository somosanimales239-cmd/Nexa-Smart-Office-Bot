'use strict';

const { registerIpcHandler } = require('./ipc-utils');
const { stableHash } = require('../services/automarket-api-service');
const { cacheItemsFromPayload, resourceItemCount } = require('../services/notification-service');

const INTEGRATION_IPC_CONTRACT = 'IPC channels: integration:get, integration:save, integration:test, integration:sync, integration:inspector, integration:items, integration:resource, integration:disconnect';

function integrationState(database, settingsService) {
  const overview = database.connectedBusinessOverview();
  return {
    settings: settingsService.getPublicSettings(),
    status: database.getIntegrationStatus(),
    snapshots: database.listIntegrationSnapshots(),
    resources: overview.resources,
    syncRuns: overview.syncRuns,
    remote: overview.remote
  };
}

function registerIntegrationsIpc(ipcMain, services) {
  const database = services.database;
  const settingsService = services.settingsService;
  const apiService = services.apiService;
  const notificationService = services.notificationService;

  registerIpcHandler(ipcMain, 'integration:get', function getIntegration() {
    return integrationState(database, settingsService);
  });

  registerIpcHandler(ipcMain, 'integration:inspector', function getInspector() {
    return {
      status: database.getIntegrationStatus(),
      resources: database.listIntegrationResourceStatus(),
      syncRuns: database.listIntegrationSyncRuns(30)
    };
  });

  registerIpcHandler(ipcMain, 'integration:items', function getItems(payload) {
    const input = payload || {};
    return database.listIntegrationCache(String(input.resource || ''), String(input.search || ''), Number(input.limit || 100));
  });

  registerIpcHandler(ipcMain, 'integration:save', function saveIntegration(payload) {
    const input = Object.assign({}, payload || {});
    const key = typeof input.automarket_api_key === 'string' ? input.automarket_api_key : '';
    const previousSettings = settingsService.getPublicSettings();
    const previousUrl = String(previousSettings.automarket_base_url || '').trim();
    const nextUrl = Object.prototype.hasOwnProperty.call(input, 'automarket_base_url')
      ? String(input.automarket_base_url || '').trim()
      : previousUrl;
    delete input.automarket_api_key;
    database.saveSettings(input);
    if (key.trim()) settingsService.saveSecret('automarket', key);
    if (key.trim() || nextUrl !== previousUrl) {
      // A new key or website must never inherit a cached discovery contract.
      database.replaceIntegrationCache('ping', []);
      database.replaceIntegrationCache('connection-map', []);
      database.saveIntegrationStatus({
        connected: 0,
        account_type: null,
        account_id: null,
        store_id: null,
        owner_type: null,
        owner_id: null,
        user_id: null,
        api_version: null,
        scopes_json: '[]',
        connection_map_json: '{}',
        sync_state: 'credentials_changed',
        last_attempt_at: null,
        last_error: 'Connection settings changed. Run Test connection and Sync now.'
      });
    }
    return settingsService.getPublicSettings();
  });

  registerIpcHandler(ipcMain, 'integration:test', async function testIntegration() {
    const result = await apiService.testConnection();
    const identity = result.identity || {};
    result.diagnostics.forEach(function saveDiagnostic(diagnostic) {
      database.saveIntegrationResourceStatus({
        resource: diagnostic.resource,
        account_type: identity.account_type,
        required_scope: '',
        allowed: 1,
        status: 'ok',
        item_count: 1,
        http_status: diagnostic.httpStatus,
        last_error: '',
        last_started_at: diagnostic.checkedAt,
        last_checked_at: diagnostic.checkedAt,
        last_success_at: diagnostic.checkedAt,
        duration_ms: diagnostic.durationMs,
        payload_hash: stableHash(diagnostic.resource === 'ping' ? result.ping : result.connectionMap)
      });
    });
    database.saveIntegrationSnapshot({
      resource: 'ping', payload_hash: stableHash(result.ping), item_count: 1,
      payload_json: JSON.stringify(result.ping || {}), last_checked_at: result.testedAt, last_changed_at: result.testedAt
    });
    database.saveIntegrationSnapshot({
      resource: 'connection-map', payload_hash: stableHash(result.connectionMap), item_count: 1,
      payload_json: JSON.stringify(result.connectionMap || {}), last_checked_at: result.testedAt, last_changed_at: result.testedAt
    });
    database.replaceIntegrationCache('ping', [result.ping || {}]);
    database.replaceIntegrationCache('connection-map', [result.connectionMap || {}]);
    database.saveIntegrationStatus({
      connected: 1,
      account_type: identity.account_type,
      account_id: identity.account_id,
      store_id: identity.store_id,
      owner_type: identity.owner_type,
      owner_id: identity.owner_id,
      user_id: identity.user_id,
      api_version: identity.api_version,
      scopes_json: JSON.stringify(identity.scopes || []),
      connection_map_json: JSON.stringify(result.connectionMap || {}),
      sync_state: 'tested',
      last_attempt_at: result.testedAt,
      last_error: ''
    });
    return result;
  });

  registerIpcHandler(ipcMain, 'integration:sync', async function syncIntegration() {
    return notificationService.syncAutoMarket(true);
  });

  registerIpcHandler(ipcMain, 'integration:resource', async function fetchResource(payload) {
    const resource = String(payload.resource || 'ping');
    const query = payload.query && typeof payload.query === 'object' ? payload.query : {};
    const startedAt = new Date().toISOString();
    try {
      const response = await apiService.fetchResource(resource, query);
      const items = cacheItemsFromPayload(resource, response.payload);
      database.replaceIntegrationCache(resource, items);
      database.saveIntegrationSnapshot({
        resource: resource,
        payload_hash: stableHash(response.payload),
        item_count: resourceItemCount(response.payload),
        payload_json: JSON.stringify(response.payload || null),
        last_checked_at: response.receivedAt,
        last_changed_at: response.receivedAt
      });
      database.saveIntegrationResourceStatus({
        resource: resource,
        status: 'ok',
        item_count: resourceItemCount(response.payload),
        http_status: response.status,
        last_error: '',
        last_started_at: startedAt,
        last_checked_at: response.receivedAt,
        last_success_at: response.receivedAt,
        duration_ms: response.durationMs,
        payload_hash: stableHash(response.payload)
      });
      return response;
    } catch (error) {
      database.saveIntegrationResourceStatus({
        resource: resource,
        status: Number(error.status || 0) === 403 ? 'forbidden' : 'failed',
        http_status: Number(error.status || 0),
        last_error: error.message,
        last_started_at: startedAt,
        last_checked_at: new Date().toISOString()
      });
      throw error;
    }
  });

  registerIpcHandler(ipcMain, 'integration:disconnect', function disconnectIntegration() {
    settingsService.removeSecret('automarket');
    database.saveSettings({ automarket_sync_enabled: '0' });
    database.clearIntegrationData();
    return { disconnected: true };
  });
}

module.exports = {
  INTEGRATION_IPC_CONTRACT,
  integrationState,
  registerIntegrationsIpc
};
