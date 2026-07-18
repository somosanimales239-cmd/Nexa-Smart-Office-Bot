'use strict';

const crypto = require('node:crypto');
const { resourcePlan, stableHash } = require('./automarket-api-service');

const NEXA_SMART_NOTIFICATIONS_V1 = 'NEXA_SMART_NOTIFICATIONS_V1';
const NEXA_CONNECTED_BUSINESS_FULL_SYNC_V2 = 'NEXA_CONNECTED_BUSINESS_FULL_SYNC_V2';
const DEFAULT_RESOURCES = [
  'store', 'dealer-summary', 'listings', 'orders', 'agenda', 'messages', 'resellers',
  'reseller-profile', 'reseller-summary', 'reseller-listings', 'reseller-appointments',
  'admin-summary', 'stores', 'users', 'validation', 'api-keys-status', 'dealer-appointment-availability'
];

function nowIso() {
  return new Date().toISOString();
}

function listFromPayload(payload) {
  if (Array.isArray(payload)) return payload;
  if (!payload || typeof payload !== 'object') return [];
  for (const key of [
    'items', 'records', 'rows', 'listings', 'orders', 'contacts', 'agenda', 'messages', 'threads', 'resellers',
    'appointments', 'assignments', 'stores', 'users', 'validations', 'api_keys', 'slots', 'availability', 'data'
  ]) {
    if (Array.isArray(payload[key])) return payload[key];
  }
  return [];
}

function cacheItemsFromPayload(resource, payload) {
  const list = listFromPayload(payload);
  if (list.length) return list;
  if (payload && typeof payload === 'object' && !Array.isArray(payload)) return [payload];
  return [];
}

function resourceItemCount(payload) {
  if (Array.isArray(payload)) return payload.length;
  const list = listFromPayload(payload);
  if (list.length) return list.length;
  if (payload && typeof payload === 'object' && Object.keys(payload).length) return 1;
  return 0;
}

function numericSummary(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return {};
  const output = {};
  Object.entries(payload).forEach(function collectNumeric(entry) {
    const key = entry[0];
    const value = entry[1];
    if (typeof value === 'number' && Number.isFinite(value)) output[key] = value;
  });
  return output;
}

function itemIdentity(item, index) {
  if (!item || typeof item !== 'object') return String(index);
  for (const key of [
    'id', 'contact_id', 'order_id', 'listing_id', 'appointment_id', 'assignment_id', 'validation_id',
    'message_id', 'thread_id', 'reseller_id', 'store_id', 'user_id', 'account_id', 'uuid'
  ]) {
    if (item[key] !== undefined && item[key] !== null && String(item[key]) !== '') return String(item[key]);
  }
  return stableHash(item).slice(0, 20);
}

function itemLabel(resource, item) {
  if (!item || typeof item !== 'object') return resource;
  return String(
    item.title || item.listing_title || item.name || item.customer_name || item.reseller_name || item.store_name ||
    item.subject || item.business_name || item.email || item.phone || item.status || resource
  );
}

function statusErrorText(error, requiredScope) {
  const scope = String(error && error.scope || requiredScope || '').trim();
  const message = String(error && error.message || error || 'Unknown API error');
  return scope && !message.toLowerCase().includes(scope.toLowerCase()) ? message + ' · required scope: ' + scope : message;
}

function connectedAppointmentTime(item) {
  if (!item || typeof item !== 'object') return null;
  const dateValue = String(item.appointment_date || item.start_at || '').trim();
  const timeValue = String(item.appointment_time || '').trim();
  if (!dateValue) return null;
  let candidate = dateValue;
  if (timeValue && /^\d{4}-\d{2}-\d{2}$/.test(dateValue)) candidate = dateValue + ' ' + timeValue;
  const parsed = new Date(candidate);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

class NotificationService {
  constructor(options) {
    this.database = options.database;
    this.settingsService = options.settingsService;
    this.apiService = options.apiService;
    this.Notification = options.Notification;
    this.nativeImage = options.nativeImage;
    this.app = options.app;
    this.getMainWindow = options.getMainWindow;
    this.iconPath = options.iconPath;
    this.timer = null;
    this.syncing = false;
    this.lastApiCheck = 0;
  }

  start() {
    this.stop();
    this.tick().catch(function ignoreInitialError(error) { console.error('[notification-service]', error); });
    this.timer = setInterval(() => {
      this.tick().catch(function reportTickError(error) { console.error('[notification-service]', error); });
    }, 60000);
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async tick() {
    await this.processLocalAlerts();
    const settings = this.database.getSettings();
    const pollMinutes = Math.min(Math.max(Number(settings.automarket_poll_minutes || 5), 1), 120);
    const due = Date.now() - this.lastApiCheck >= pollMinutes * 60000;
    if (settings.automarket_sync_enabled === '1' && due) {
      this.lastApiCheck = Date.now();
      try {
        await this.syncAutoMarket(false);
      } catch (error) {
        console.error('[connected-business-sync]', error);
      }
    }
    await this.processConnectedBusinessAlerts();
    await this.deliverPending();
  }

  async processLocalAlerts() {
    const due = this.database.dueNotifications();
    for (const item of due) {
      const typeMap = { task: 'local_task_due', appointment: 'local_appointment_due', reminder: 'local_reminder' };
      const notificationType = typeMap[item.entity_type] || 'local_reminder';
      this.createNotification({
        source: 'local',
        type: notificationType,
        severity: item.entity_type === 'task' ? 'warning' : 'info',
        title: item.title,
        body: item.body,
        entityType: item.entity_type,
        entityId: item.id,
        dedupeKey: 'local:' + item.entity_type + ':' + item.id + ':' + String(item.date || '')
      });
      this.database.markNotificationSent(item.entity_type, item.id);
    }
  }

  async processConnectedBusinessAlerts() {
    const status = this.database.getIntegrationStatus();
    if (Number(status.connected || 0) !== 1) return;
    const now = Date.now();
    const candidates = this.database.listIntegrationCache('orders', '', 200)
      .concat(this.database.listIntegrationCache('reseller-appointments', '', 200));
    candidates.forEach((item, index) => {
      const appointment = connectedAppointmentTime(item);
      if (!appointment) return;
      const state = String(item.appointment_status || item.status || '').toLowerCase();
      if (['cancelled','canceled','completed','closed','no_show'].includes(state)) return;
      const remaining = appointment.getTime() - now;
      if (remaining <= 0 || remaining > 24 * 60 * 60 * 1000) return;
      const identity = item.appointment_id || item.order_id || item.id || itemIdentity(item, index);
      const customer = item.customer_name || item.listing_title || 'Customer appointment';
      const listing = item.listing_title ? ' for ' + item.listing_title : '';
      if (remaining <= 2 * 60 * 60 * 1000) {
        this.createNotification({
          source: 'automarket', type: item.reseller_id ? 'remote_resellers' : 'remote_orders', severity: 'warning',
          title: 'Appointment in less than 2 hours',
          body: customer + listing + ' · ' + appointment.toLocaleString(),
          entityType: 'connected-appointment', entityId: String(identity), metadata: item,
          dedupeKey: 'connected-appointment:2h:' + identity + ':' + appointment.toISOString()
        });
      } else {
        this.createNotification({
          source: 'automarket', type: item.reseller_id ? 'remote_resellers' : 'remote_orders', severity: 'info',
          title: 'Appointment within 24 hours',
          body: customer + listing + ' · ' + appointment.toLocaleString(),
          entityType: 'connected-appointment', entityId: String(identity), metadata: item,
          dedupeKey: 'connected-appointment:24h:' + identity + ':' + appointment.toISOString()
        });
      }
    });
  }

  preferenceEnabled(type, channel) {
    const preference = this.database.getNotificationPreference(type);
    if (!preference) return true;
    if (preference.enabled !== 1) return false;
    if (channel === 'desktop') return preference.desktop_enabled === 1;
    if (channel === 'in_app') return preference.in_app_enabled === 1;
    return true;
  }

  createNotification(input) {
    if (!this.preferenceEnabled(input.type, 'in_app') && !this.preferenceEnabled(input.type, 'desktop')) return null;
    const event = this.database.createNotificationEvent({
      source: input.source || 'local',
      type: input.type || 'general',
      severity: input.severity || 'info',
      title: input.title || 'Nexa Smart Office Bot',
      body: input.body || '',
      entity_type: input.entityType || null,
      entity_id: input.entityId || null,
      action_url: input.actionUrl || null,
      metadata_json: JSON.stringify(input.metadata || {}),
      dedupe_key: input.dedupeKey || crypto.randomUUID()
    });
    if (event) this.emitToRenderer(event);
    return event;
  }

  emitToRenderer(event) {
    const windowInstance = this.getMainWindow();
    if (windowInstance && !windowInstance.isDestroyed()) windowInstance.webContents.send('notification:new', event);
  }

  inQuietHours() {
    const settings = this.database.getSettings();
    const start = String(settings.notifications_quiet_start || '').trim();
    const end = String(settings.notifications_quiet_end || '').trim();
    if (!/^\d{2}:\d{2}$/.test(start) || !/^\d{2}:\d{2}$/.test(end) || start === end) return false;
    const current = new Date();
    const nowMinutes = current.getHours() * 60 + current.getMinutes();
    const parse = function parse(value) { const parts = value.split(':').map(Number); return parts[0] * 60 + parts[1]; };
    const startMinutes = parse(start);
    const endMinutes = parse(end);
    return startMinutes < endMinutes
      ? nowMinutes >= startMinutes && nowMinutes < endMinutes
      : nowMinutes >= startMinutes || nowMinutes < endMinutes;
  }

  async deliverPending() {
    const settings = this.database.getSettings();
    if (settings.notifications_user_consent !== '1' || settings.notifications_enabled !== '1') return;
    if (!this.Notification || !this.Notification.isSupported()) return;
    const quietHours = this.inQuietHours();
    const pending = this.database.listUndeliveredNotifications(20);
    for (const event of pending) {
      if (quietHours && event.type !== 'system_test') continue;
      if (!this.preferenceEnabled(event.type, 'desktop')) {
        this.database.markNotificationDelivered(event.id, 'suppressed');
        continue;
      }
      try {
        const notification = new this.Notification({
          title: event.title,
          body: event.body,
          icon: this.iconPath,
          silent: settings.notifications_sound === '0',
          urgency: event.severity === 'danger' ? 'critical' : 'normal',
          timeoutType: 'default'
        });
        notification.on('click', () => {
          const windowInstance = this.getMainWindow();
          if (windowInstance) {
            if (windowInstance.isMinimized()) windowInstance.restore();
            windowInstance.show();
            windowInstance.focus();
            windowInstance.webContents.send('notification:open', event);
          }
          this.database.markNotificationRead(event.id);
        });
        notification.show();
        this.database.markNotificationDelivered(event.id, 'desktop');
      } catch (error) {
        this.database.markNotificationDelivered(event.id, 'failed:' + error.message);
      }
    }
  }

  saveCoreDiagnostic(response, accountType) {
    this.database.saveIntegrationResourceStatus({
      resource: response.resource,
      account_type: accountType || null,
      required_scope: '',
      allowed: 1,
      status: 'ok',
      item_count: response.resource === 'ping' || response.resource === 'connection-map' ? 1 : resourceItemCount(response.payload),
      http_status: response.status,
      last_error: '',
      last_started_at: response.receivedAt,
      last_checked_at: response.receivedAt,
      last_success_at: response.receivedAt,
      duration_ms: response.durationMs,
      payload_hash: stableHash(response.payload)
    });
  }

  async syncAutoMarket(manual) {
    if (this.syncing) return { skipped: true, reason: 'sync_in_progress' };
    this.syncing = true;
    const triggerType = manual ? 'manual' : 'automatic';
    const attemptAt = nowIso();
    let runId = null;
    try {
      this.database.saveIntegrationStatus({ sync_state: 'discovering', last_attempt_at: attemptAt, last_error: '' });
      const test = await this.apiService.testConnection();
      const identity = test.identity || {};
      const plan = resourcePlan(identity);
      runId = this.database.beginIntegrationSyncRun(triggerType, identity.account_type, plan.length + 2);
      test.diagnostics.forEach((diagnostic) => {
        this.database.saveIntegrationResourceStatus({
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
          payload_hash: stableHash(diagnostic.resource === 'ping' ? test.ping : test.connectionMap)
        });
      });
      this.database.saveIntegrationSnapshot({
        resource: 'ping', payload_hash: stableHash(test.ping), item_count: 1, payload_json: JSON.stringify(test.ping || {}),
        last_checked_at: test.testedAt, last_changed_at: test.testedAt
      });
      this.database.saveIntegrationSnapshot({
        resource: 'connection-map', payload_hash: stableHash(test.connectionMap), item_count: 1,
        payload_json: JSON.stringify(test.connectionMap || {}), last_checked_at: test.testedAt, last_changed_at: test.testedAt
      });
      this.database.replaceIntegrationCache('ping', [test.ping || {}]);
      this.database.replaceIntegrationCache('connection-map', [test.connectionMap || {}]);
      this.database.saveIntegrationStatus({
        connected: 1,
        account_type: identity.account_type,
        account_id: identity.account_id,
        store_id: identity.store_id,
        owner_type: identity.owner_type,
        owner_id: identity.owner_id,
        user_id: identity.user_id,
        api_version: identity.api_version,
        scopes_json: JSON.stringify(identity.scopes || []),
        connection_map_json: JSON.stringify(test.connectionMap || {}),
        sync_state: 'syncing',
        last_attempt_at: attemptAt,
        last_error: ''
      });

      const resources = [];
      const data = {};
      const changes = [];
      const failures = [];
      let successCount = 0;
      for (const entry of plan) {
        const resource = entry.resource;
        resources.push(resource);
        const startedAt = nowIso();
        if (entry.scopeGranted === false) {
          const missingScopeError = 'Missing required scope: ' + entry.requiredScope;
          failures.push({ resource: resource, error: missingScopeError, status: 403, scope: entry.requiredScope || '' });
          data[resource] = { __error: missingScopeError };
          this.database.saveIntegrationResourceStatus({
            resource: resource,
            account_type: identity.account_type,
            required_scope: entry.requiredScope,
            allowed: 0,
            status: 'forbidden',
            item_count: this.database.integrationCacheCount(resource),
            http_status: 403,
            last_error: missingScopeError,
            last_started_at: startedAt,
            last_checked_at: nowIso(),
            duration_ms: 0
          });
          continue;
        }
        this.database.saveIntegrationResourceStatus({
          resource: resource,
          account_type: identity.account_type,
          required_scope: entry.requiredScope,
          allowed: 1,
          status: 'syncing',
          last_started_at: startedAt,
          last_error: ''
        });
        try {
          const response = await this.apiService.fetchResource(resource, entry.query);
          data[resource] = response.payload;
          const resourceChanges = this.compareResource(resource, response.payload);
          changes.push.apply(changes, resourceChanges);
          const cacheItems = cacheItemsFromPayload(resource, response.payload);
          this.database.replaceIntegrationCache(resource, cacheItems);
          const count = resourceItemCount(response.payload);
          this.database.saveIntegrationResourceStatus({
            resource: resource,
            account_type: identity.account_type,
            required_scope: entry.requiredScope,
            allowed: 1,
            status: 'ok',
            item_count: count,
            http_status: response.status,
            last_error: '',
            last_started_at: startedAt,
            last_checked_at: response.receivedAt,
            last_success_at: response.receivedAt,
            duration_ms: response.durationMs,
            payload_hash: stableHash(response.payload)
          });
          successCount += 1;
        } catch (error) {
          const errorText = statusErrorText(error, entry.requiredScope);
          failures.push({ resource: resource, error: errorText, status: Number(error.status || 0), scope: error.scope || entry.requiredScope || '' });
          data[resource] = { __error: errorText };
          this.database.saveIntegrationResourceStatus({
            resource: resource,
            account_type: identity.account_type,
            required_scope: entry.requiredScope,
            allowed: 1,
            status: Number(error.status || 0) === 403 ? 'forbidden' : 'failed',
            item_count: this.database.integrationCacheCount(resource),
            http_status: Number(error.status || 0),
            last_error: errorText,
            last_started_at: startedAt,
            last_checked_at: nowIso(),
            duration_ms: 0
          });
        }
      }

      const completedAt = nowIso();
      const failureCount = failures.length;
      const syncState = failureCount ? (successCount ? 'partial' : 'failed') : 'ready';
      const errorSummary = failures.map(function mapFailure(item) { return item.resource + ': ' + item.error; }).join(' | ');
      this.database.saveIntegrationStatus({
        connected: 1,
        sync_state: syncState,
        last_sync_at: completedAt,
        last_attempt_at: attemptAt,
        last_success_at: successCount ? completedAt : null,
        resource_success_count: successCount,
        resource_failure_count: failureCount,
        last_error: errorSummary
      });
      this.database.finishIntegrationSyncRun(runId, {
        account_type: identity.account_type,
        status: failureCount ? 'partial' : 'completed',
        planned_resources: plan.length + 2,
        successful_resources: successCount + 2,
        failed_resources: failureCount,
        error_summary: errorSummary
      });

      if (manual) {
        this.createNotification({
          source: 'automarket',
          type: 'remote_connection',
          severity: failureCount ? 'warning' : 'success',
          title: failureCount ? 'Connected business synchronized with warnings' : 'Connected business synchronized',
          body: successCount + ' resource' + (successCount === 1 ? '' : 's') + ' loaded' + (failureCount ? '; ' + failureCount + ' need attention.' : '.'),
          dedupeKey: 'manual-sync:' + Date.now()
        });
      }
      await this.deliverPending();
      return {
        ok: failureCount === 0,
        partial: failureCount > 0 && successCount > 0,
        accountType: identity.account_type,
        resources: resources,
        successCount: successCount,
        failureCount: failureCount,
        failures: failures,
        data: data,
        changes: changes,
        connectionMap: test.connectionMap,
        inspector: this.database.listIntegrationResourceStatus()
      };
    } catch (error) {
      const failedAt = nowIso();
      this.database.saveIntegrationStatus({
        connected: 0,
        sync_state: 'failed',
        last_sync_at: failedAt,
        last_attempt_at: attemptAt,
        resource_success_count: 0,
        resource_failure_count: 1,
        last_error: error.message
      });
      if (runId) {
        this.database.finishIntegrationSyncRun(runId, {
          status: 'failed', planned_resources: 2, successful_resources: 0, failed_resources: 1, error_summary: error.message
        });
      }
      this.createNotification({
        source: 'automarket',
        type: 'remote_connection',
        severity: 'danger',
        title: 'Connected business needs attention',
        body: error.message,
        dedupeKey: 'connection-error:' + stableHash(error.message + ':' + new Date().toISOString().slice(0, 13))
      });
      throw error;
    } finally {
      this.syncing = false;
    }
  }

  compareResource(resource, payload) {
    const previous = this.database.getIntegrationSnapshot(resource);
    const currentHash = stableHash(payload);
    const currentList = listFromPayload(payload);
    const currentSummary = numericSummary(payload);
    const previousPayload = previous && previous.payload_json ? JSON.parse(previous.payload_json) : null;
    const previousList = listFromPayload(previousPayload);
    const previousIds = new Set(previousList.map(itemIdentity));
    const changes = [];

    if (previous && previous.payload_hash !== currentHash) {
      const newItems = currentList.filter(function filterNew(item, index) { return !previousIds.has(itemIdentity(item, index)); });
      newItems.slice(0, 8).forEach((item, index) => {
        const typeMap = {
          orders: 'remote_orders', messages: 'remote_messages', resellers: 'remote_resellers',
          'reseller-appointments': 'remote_resellers', agenda: 'remote_agenda', listings: 'remote_listings',
          'reseller-listings': 'remote_listings', validation: 'remote_business_update'
        };
        const type = typeMap[resource] || 'remote_business_update';
        const label = itemLabel(resource, item);
        const event = this.createNotification({
          source: 'automarket',
          type: type,
          severity: resource === 'orders' || resource === 'messages' || resource === 'validation' ? 'warning' : 'info',
          title: this.resourceTitle(resource),
          body: label,
          entityType: resource,
          entityId: itemIdentity(item, index),
          actionUrl: item.listing_url || item.public_store_url || null,
          metadata: item,
          dedupeKey: 'api:' + resource + ':' + itemIdentity(item, index)
        });
        if (event) changes.push(event);
      });

      if (currentList.length === 0 && Object.keys(currentSummary).length) {
        const previousSummary = numericSummary(previousPayload);
        Object.entries(currentSummary).forEach((entry) => {
          const key = entry[0];
          const value = entry[1];
          const previousValue = Number(previousSummary[key] || 0);
          if (value > previousValue) {
            const event = this.createNotification({
              source: 'automarket',
              type: resource === 'messages' ? 'remote_messages' : 'remote_business_update',
              severity: 'info',
              title: this.resourceTitle(resource),
              body: key.replaceAll('_', ' ') + ': ' + value + ' (previously ' + previousValue + ')',
              metadata: { key: key, value: value, previous: previousValue },
              dedupeKey: 'api-summary:' + resource + ':' + key + ':' + value
            });
            if (event) changes.push(event);
          }
        });
      }
    }

    this.database.saveIntegrationSnapshot({
      resource: resource,
      payload_hash: currentHash,
      item_count: resourceItemCount(payload),
      payload_json: JSON.stringify(payload || null),
      last_checked_at: nowIso(),
      last_changed_at: previous && previous.payload_hash === currentHash ? previous.last_changed_at : nowIso()
    });
    return changes;
  }

  resourceTitle(resource) {
    const titles = {
      orders: 'New order activity', messages: 'New message activity', resellers: 'New reseller activity',
      agenda: 'Agenda update', listings: 'Listing update', 'dealer-summary': 'Dealer dashboard update',
      'reseller-summary': 'Reseller dashboard update', 'reseller-appointments': 'Reseller appointment update',
      'reseller-listings': 'Assigned listing update', 'dealer-appointment-availability': 'Dealer appointment availability', 'admin-summary': 'Platform summary update',
      stores: 'Store activity', users: 'User activity', validation: 'Dealer validation activity',
      store: 'Store profile update', 'reseller-profile': 'Reseller profile update'
    };
    return titles[resource] || 'Connected business update';
  }

  async requestPermission() {
    if (!this.Notification || !this.Notification.isSupported()) throw new Error('Windows notifications are not supported on this system.');
    this.database.saveSettings({ notifications_user_consent: '1', notifications_consent_at: nowIso(), notifications_enabled: '1' });
    const event = this.createNotification({
      source: 'system', type: 'system_test', severity: 'success',
      title: 'Nexa notifications are ready',
      body: 'You control which alerts appear in the application and on Windows.',
      dedupeKey: 'permission:' + Date.now()
    });
    await this.deliverPending();
    return { granted: true, event: event, settings: this.database.getSettings() };
  }

  async testNotification() {
    const event = this.createNotification({
      source: 'system', type: 'system_test', severity: 'info',
      title: 'Nexa Pulse test',
      body: 'This is how a compact Windows notification will appear while Smart Office Bot is running.',
      dedupeKey: 'test:' + Date.now()
    });
    await this.deliverPending();
    return event;
  }
}

module.exports = {
  DEFAULT_RESOURCES,
  NEXA_CONNECTED_BUSINESS_FULL_SYNC_V2,
  NEXA_SMART_NOTIFICATIONS_V1,
  NotificationService,
  cacheItemsFromPayload,
  connectedAppointmentTime,
  listFromPayload,
  numericSummary,
  resourceItemCount
};
