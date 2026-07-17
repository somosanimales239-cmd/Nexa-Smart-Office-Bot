'use strict';

const path = require('node:path');
const crypto = require('node:crypto');
const { stableHash } = require('./automarket-api-service');

const NEXA_SMART_NOTIFICATIONS_V1 = 'NEXA_SMART_NOTIFICATIONS_V1';
const DEFAULT_RESOURCES = ['store', 'dealer-summary', 'listings', 'orders', 'agenda', 'messages', 'resellers', 'admin-summary'];

function nowIso() {
  return new Date().toISOString();
}

function listFromPayload(payload) {
  if (Array.isArray(payload)) return payload;
  if (!payload || typeof payload !== 'object') return [];
  for (const key of ['items', 'records', 'rows', 'listings', 'orders', 'contacts', 'messages', 'resellers', 'data']) {
    if (Array.isArray(payload[key])) return payload[key];
  }
  return [];
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
  for (const key of ['id', 'order_id', 'listing_id', 'appointment_id', 'message_id', 'thread_id', 'reseller_id', 'uuid']) {
    if (item[key] !== undefined && item[key] !== null && String(item[key]) !== '') return String(item[key]);
  }
  return stableHash(item).slice(0, 20);
}

function itemLabel(resource, item) {
  if (!item || typeof item !== 'object') return resource;
  return String(item.title || item.name || item.customer_name || item.store_name || item.subject || item.email || item.phone || item.status || resource);
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
      await this.syncAutoMarket(false);
    }
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
    if (windowInstance && !windowInstance.isDestroyed()) {
      windowInstance.webContents.send('notification:new', event);
    }
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

  async syncAutoMarket(manual) {
    if (this.syncing) return { skipped: true, reason: 'sync_in_progress' };
    this.syncing = true;
    try {
      const test = await this.apiService.testConnection();
      const ping = test.ping && typeof test.ping === 'object' ? test.ping : {};
      this.database.saveIntegrationStatus({
        connected: 1,
        account_type: ping.account_type || ping.owner_type || ping.role || null,
        account_id: ping.account_id || ping.user_id || ping.owner_id || null,
        store_id: ping.store_id || null,
        scopes_json: JSON.stringify(ping.scopes || ping.allowed_scopes || []),
        connection_map_json: JSON.stringify(test.connectionMap || {}),
        last_sync_at: nowIso(),
        last_error: ''
      });
      const resources = this.resolveResources(test.connectionMap);
      const data = await this.apiService.fetchDashboard(resources);
      const changes = [];
      for (const resource of resources) {
        const payload = data[resource];
        if (payload && payload.__error) continue;
        const result = this.compareResource(resource, payload);
        changes.push.apply(changes, result);
      }
      if (manual) {
        this.createNotification({
          source: 'automarket', type: 'remote_connection', severity: 'success',
          title: 'Connected business synchronized',
          body: resources.length + ' API resource' + (resources.length === 1 ? '' : 's') + ' checked successfully.',
          dedupeKey: 'manual-sync:' + Date.now()
        });
      }
      await this.deliverPending();
      return { ok: true, resources: resources, data: data, changes: changes, connectionMap: test.connectionMap };
    } catch (error) {
      this.database.saveIntegrationStatus({ connected: 0, last_sync_at: nowIso(), last_error: error.message });
      this.createNotification({
        source: 'automarket', type: 'remote_connection', severity: 'danger',
        title: 'Connected business needs attention', body: error.message,
        dedupeKey: 'connection-error:' + stableHash(error.message + ':' + new Date().toISOString().slice(0, 13))
      });
      throw error;
    } finally {
      this.syncing = false;
    }
  }

  resolveResources(connectionMap) {
    const available = new Set();
    const map = connectionMap || {};
    const candidates = map.resources || map.available_resources || map.endpoints || map;
    if (Array.isArray(candidates)) {
      candidates.forEach(function addResource(item) {
        if (typeof item === 'string') available.add(item);
        else if (item && item.resource) available.add(String(item.resource));
        else if (item && item.name) available.add(String(item.name));
      });
    } else if (candidates && typeof candidates === 'object') {
      Object.keys(candidates).forEach(function addResourceName(key) { available.add(key); });
    }
    const preferred = DEFAULT_RESOURCES.filter(function filterResource(resource) {
      return available.size === 0 || available.has(resource);
    });
    return preferred.length ? preferred : ['ping'];
  }

  compareResource(resource, payload) {
    const previous = this.database.getIntegrationSnapshot(resource);
    const currentHash = stableHash(payload);
    const currentList = listFromPayload(payload);
    const currentSummary = numericSummary(payload);
    const currentIds = currentList.map(itemIdentity);
    const previousPayload = previous && previous.payload_json ? JSON.parse(previous.payload_json) : null;
    const previousList = listFromPayload(previousPayload);
    const previousIds = new Set(previousList.map(itemIdentity));
    const changes = [];

    if (previous && previous.payload_hash !== currentHash) {
      const newItems = currentList.filter(function filterNew(item, index) { return !previousIds.has(itemIdentity(item, index)); });
      newItems.slice(0, 8).forEach((item, index) => {
        const typeMap = {
          orders: 'remote_orders', messages: 'remote_messages', resellers: 'remote_resellers',
          agenda: 'remote_agenda', listings: 'remote_listings'
        };
        const type = typeMap[resource] || 'remote_business_update';
        const label = itemLabel(resource, item);
        const event = this.createNotification({
          source: 'automarket', type: type, severity: resource === 'orders' || resource === 'messages' ? 'warning' : 'info',
          title: this.resourceTitle(resource),
          body: label,
          entityType: resource,
          entityId: itemIdentity(item, index),
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
              source: 'automarket', type: resource === 'messages' ? 'remote_messages' : 'remote_business_update', severity: 'info',
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
      item_count: currentList.length,
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
      'admin-summary': 'Platform summary update', store: 'Store profile update'
    };
    return titles[resource] || 'Connected business update';
  }

  async requestPermission() {
    const settings = this.database.getSettings();
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
  NEXA_SMART_NOTIFICATIONS_V1,
  NotificationService,
  DEFAULT_RESOURCES,
  listFromPayload,
  numericSummary
};
