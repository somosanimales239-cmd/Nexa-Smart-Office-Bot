'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const { DatabaseService, normalizePhone } = require('../src/database/database');
const { SettingsService } = require('../src/services/settings-service');
const {
  AutoMarketApiService,
  cleanBaseUrl,
  deriveMessageCapabilities,
  resourcePlan,
  stableHash
} = require('../src/services/automarket-api-service');
const { NotificationService } = require('../src/services/notification-service');
const { registerIntegrationsIpc } = require('../src/ipc/integrations-ipc');

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nexa-full-api-sync-'));
const db = new DatabaseService(path.join(tempDir, 'test.sqlite'));
let passed = 0;

function test(name, fn) {
  return Promise.resolve().then(fn).then(function success() {
    passed += 1;
    console.log('PASS ' + name);
  }).catch(function failure(error) {
    console.error('FAIL ' + name + ': ' + (error.stack || error.message));
    process.exitCode = 1;
  });
}

class FakeSafeStorage {
  isEncryptionAvailable() { return true; }
  encryptString(value) { return Buffer.from('encrypted:' + value, 'utf8'); }
  decryptString(buffer) { return buffer.toString('utf8').replace(/^encrypted:/, ''); }
}

class FakeNotification {
  static shown = [];
  static isSupported() { return true; }
  constructor(options) { this.options = options; this.listeners = {}; }
  on(name, callback) { this.listeners[name] = callback; }
  show() { FakeNotification.shown.push(this.options); }
}

const settingsService = new SettingsService(db, path.join(tempDir, 'secure', 'secrets.json'), new FakeSafeStorage());
settingsService.saveSettings({
  automarket_base_url: 'https://example.com',
  automarket_api_key: 'test-api-key-value',
  automarket_sync_enabled: '1',
  automarket_poll_minutes: '5',
  automarket_max_items: '100'
});

const dealerScopes = ['store:read', 'dealer:read', 'listings:read', 'orders:read', 'agenda:read', 'messages:read', 'messages:write', 'resellers:read'];
const responses = {
  ping: { ok: true, data: { account_type: 'dealer', owner_type: 'dealer', account_id: 'dealer-7', owner_id: 'dealer-7', user_id: 'user-7', store_id: 'store-7', api_version: 'v1' } },
  'connection-map': {
    ok: true,
    allowed_scopes: dealerScopes.slice(),
    permissions: dealerScopes.slice(),
    allowed_endpoints: ['messages-thread','messages-send','messages-read'],
    messages_write_enabled: true,
    message_send_endpoint: 'message-send',
    two_way_chat_enabled: true,
    data: { contract: 'NEXA_AUTOMARKET_API_V1', account_type: 'dealer', owner_type: 'dealer', account_id: 'dealer-7', owner_id: 'dealer-7', user_id: 'user-7', store_id: 'store-7', api_version: 'v1', available_resources: ['store','dealer-summary','orders','messages','listings','agenda','resellers'] }
  },
  store: { ok: true, data: { store_id: 'store-7', store_name: 'Demo Motors', city: 'Naples', status: 'active', public_store_url: 'https://example.com/store/demo-motors', server_private_value: 'must-not-enter-cache', secret_transport_value: 'must-not-enter-cache' } },
  'dealer-summary': { ok: true, data: { total_listings: 5, active_listings: 4, unreviewed_orders: 1, agenda_contacts: 2, unread_messages: 2 } },
  orders: { ok: true, data: [{ order_id: 'order-1', customer_name: 'Customer One', customer_phone: '(786) 555-3333', status: 'unreviewed', created_at: '2026-07-17T10:00:00Z' }] },
  messages: { ok: true, data: [{ thread_id: 'thread-1', subject: 'Admin announcement', unread_count: 1, is_announcement: 1, can_reply: 0, last_message_at: '2026-07-17T11:00:00Z' }] },
  listings: { ok: true, data: [{ id: 'listing-1', title: 'Vehicle One', price: 3200, status: 'active', listing_url: 'https://example.com/listing/vehicle-one' }] },
  agenda: { ok: true, data: [
    { contact_id: 'agenda-1', name: 'Agenda Contact', phone: '786-555-3333', email: 'contact@example.com', location: 'Miami', last_seen_at: '2026-07-17T11:00:00Z' },
    { contact_id: 'agenda-2', name: 'Second Contact', phone: '+1 (239) 555-0100', email: 'second@example.com', location: 'Naples', last_seen_at: '2026-07-16T11:00:00Z' }
  ] },
  resellers: { ok: true, data: [{ reseller_id: 'reseller-1', reseller_name: 'Reseller One', status: 'active', appointment_count: 1, last_activity: '2026-07-17T09:00:00Z' }] }
};

let requestedResources = [];
let forcedFailures = {};
const originalFetch = global.fetch;
global.fetch = async function fakeFetch(url, options) {
  assert.equal(options.headers.Authorization, 'Bearer test-api-key-value');
  assert.equal(options.headers['X-Nexa-Api-Key'], 'test-api-key-value');
  assert.equal(options.headers['X-Nexa-Client'], 'Nexa-Smart-Office-Bot/1.6.4');
  const parsed = new URL(url);
  const resource = parsed.searchParams.get('resource');
  requestedResources.push(resource);
  if (forcedFailures[resource]) {
    const failure = forcedFailures[resource];
    return {
      ok: false,
      status: failure.status,
      text: async function text() { return JSON.stringify({ error: { message: failure.message, scope: failure.scope || '' } }); }
    };
  }
  const payload = responses[resource] || { ok: true, data: [] };
  return { ok: true, status: 200, text: async function text() { return JSON.stringify(payload); } };
};

const apiService = new AutoMarketApiService(settingsService);
const fakeWindow = { isDestroyed:()=>false, webContents:{ send:()=>{} }, isMinimized:()=>false, show:()=>{}, focus:()=>{} };
const notificationService = new NotificationService({
  database: db,
  settingsService: settingsService,
  apiService: apiService,
  Notification: FakeNotification,
  nativeImage: {},
  app: {},
  getMainWindow: function getMainWindow() { return fakeWindow; },
  iconPath: path.join(__dirname, '..', 'build', 'icon.png')
});

(async function run() {
  await test('website URL is normalized to the versioned API endpoint', function () {
    assert.equal(cleanBaseUrl('https://example.com/store/'), 'https://example.com/store/api/v1/index.php');
    assert.equal(cleanBaseUrl('https://example.com/api/v1/index.php'), 'https://example.com/api/v1/index.php');
  });
  await test('stable hashes are deterministic', function () { assert.equal(stableHash({ a:1 }), stableHash({ a:1 })); });
  await test('phone normalization treats common US formats as the same contact', function () {
    assert.equal(normalizePhone('7865553333'), '7865553333');
    assert.equal(normalizePhone('(786) 555-3333'), '7865553333');
    assert.equal(normalizePhone('+1 786 555 3333'), '7865553333');
  });
  await test('account plans are different for dealer, reseller and admin', function () {
    assert(resourcePlan({ account_type:'dealer', available_resources:['orders'], scopes:['orders:read'] }).some((item)=>item.resource === 'orders'));
    assert(resourcePlan({ account_type:'reseller', available_resources:['reseller-profile'], scopes:['reseller-profile:read'] }).some((item)=>item.resource === 'reseller-profile'));
    assert(resourcePlan({ account_type:'admin', available_resources:['validation'], scopes:['validation:read'] }).some((item)=>item.resource === 'validation'));
  });
  await test('missing scopes remain visible in the synchronization plan', function () {
    const plan = resourcePlan({ account_type:'dealer', available_resources:['ORDERS','messages'], scopes:['ORDERS:READ'] });
    assert.equal(plan.find((item)=>item.resource === 'orders').scopeGranted, true);
    assert.equal(plan.find((item)=>item.resource === 'messages').scopeGranted, false);
  });
  await test('explicitly disabled message capabilities remain blocked', function () {
    const capabilities = deriveMessageCapabilities({ scopes: ['messages:read'] }, { capabilities: { message_threads: true, message_send: false, message_read: true } });
    assert.equal(capabilities.fullThread, true);
    assert.equal(capabilities.send, false);
    assert.equal(capabilities.markRead, true);
    assert.equal(capabilities.write, false);
  });
  await test('connection-map scopes are used when an older cached identity has an empty scope array', function () {
    const capabilities = deriveMessageCapabilities({ scopes: [] }, { scopes: ['Messages:Read','Messages:Write'], endpoints: ['messages-send'] });
    assert.equal(capabilities.read, true);
    assert.equal(capabilities.write, true);
    assert.equal(capabilities.send, true);
  });
  await test('API connection uses ping, connection-map and both authentication headers', async function () {
    requestedResources = [];
    const result = await apiService.testConnection();
    assert.equal(result.identity.account_type, 'dealer');
    assert.equal(result.identity.scopes.includes('messages:write'), true);
    assert.equal(result.identity.available_resources.includes('message-send'), true);
    assert.deepEqual(result.connectionMap.allowed_scopes, dealerScopes);
    assert.deepEqual(result.connectionMap.allowed_endpoints, ['messages-thread','messages-send','messages-read']);
    assert.equal(result.connectionMap.messages_write_enabled, true);
    assert.equal(result.connectionMap.message_send_endpoint, 'message-send');
    assert.equal(result.connectionMap.two_way_chat_enabled, true);
    const messageCapabilities = deriveMessageCapabilities(result.identity, result.connectionMap);
    assert.equal(messageCapabilities.fullThread, true);
    assert.equal(messageCapabilities.send, true);
    assert.equal(messageCapabilities.markRead, true);
    assert.equal(messageCapabilities.read, true);
    assert.equal(messageCapabilities.write, true);
    assert.equal(messageCapabilities.twoWayChat, true);
    assert.deepEqual(requestedResources, ['ping','connection-map']);
    assert(result.resources.some((entry)=>entry.resource === 'agenda'));
  });
  await test('first full synchronization loads every allowed dealer resource and diagnostics', async function () {
    requestedResources = [];
    const result = await notificationService.syncAutoMarket(false);
    assert.equal(result.ok, true);
    assert.equal(result.failureCount, 0);
    ['ping','connection-map','store','dealer-summary','listings','orders','agenda','messages','resellers'].forEach(function expected(resource) {
      assert(requestedResources.includes(resource), 'resource not requested: ' + resource);
      const row = db.getIntegrationResourceStatus(resource);
      assert(row, 'missing inspector row: ' + resource);
      assert.equal(row.status, 'ok');
    });
    assert.equal(db.getIntegrationStatus().connected, 1);
    assert.equal(db.getIntegrationStatus().sync_state, 'ready');
    assert.equal(db.integrationCacheCount('agenda'), 2);
    assert.equal(db.integrationCacheCount('orders'), 1);
  });
  await test('resource payloads are restricted to the documented safe fields', function () {
    const stored = db.listIntegrationCache('store', '', 1)[0];
    assert.equal(stored.store_name, 'Demo Motors');
    assert.equal(Object.prototype.hasOwnProperty.call(stored, 'server_private_value'), false);
    assert.equal(Object.prototype.hasOwnProperty.call(stored, 'secret_transport_value'), false);
  });
  await test('connected cache can search agenda contacts by normalized phone or name', function () {
    assert.equal(db.listIntegrationCache('agenda', '(786) 555-3333', 10).length, 1);
    assert.equal(db.listIntegrationCache('agenda', 'Agenda Contact', 10).length, 1);
    assert.equal(db.listIntegrationCache('agenda', 'not-found-name', 10).length, 0);
  });
  await test('AI daily context includes a bounded safe connected-business summary', function () {
    const context = db.dailyContext();
    assert.equal(context.connected_business.connected, true);
    assert.equal(context.connected_business.account_type, 'dealer');
    assert.equal(context.connected_business.recent_orders.length, 1);
    assert.equal(JSON.stringify(context.connected_business).includes('must-not-enter-cache'), false);
  });
  await test('dashboard overview exposes cached resources and sync history', function () {
    const overview = db.connectedBusinessOverview();
    assert.equal(overview.remote.agenda.length, 2);
    assert.equal(overview.remote.orders.length, 1);
    assert(overview.resources.length >= 9);
    assert(overview.syncRuns.length >= 1);
  });
  await test('a second synchronization detects a new order without duplicating the old one', async function () {
    responses.orders.data.push({ order_id:'order-2', customer_name:'Customer Two', customer_phone:'2395550000', status:'new', created_at:'2026-07-17T12:00:00Z' });
    const result = await notificationService.syncAutoMarket(false);
    assert(result.changes.some((item)=>item && item.type === 'remote_orders'));
    assert.equal(db.integrationCacheCount('orders'), 2);
  });
  await test('one failed resource produces a partial sync while keeping connected data available', async function () {
    forcedFailures.messages = { status:403, message:'Forbidden', scope:'messages:read' };
    const result = await notificationService.syncAutoMarket(true);
    assert.equal(result.partial, true);
    assert.equal(db.getIntegrationStatus().connected, 1);
    assert.equal(db.getIntegrationStatus().sync_state, 'partial');
    assert.equal(db.getIntegrationResourceStatus('messages').status, 'forbidden');
    assert(String(db.getIntegrationResourceStatus('messages').last_error).includes('messages:read'));
    delete forcedFailures.messages;
  });
  await test('missing scope is recorded without making the forbidden HTTP request', async function () {
    const originalAllowedScopes = responses['connection-map'].allowed_scopes;
    const originalPermissions = responses['connection-map'].permissions;
    responses['connection-map'].allowed_scopes = dealerScopes.filter((scope)=>scope !== 'messages:read');
    responses['connection-map'].permissions = dealerScopes.filter((scope)=>scope !== 'messages:read');
    requestedResources = [];
    const result = await notificationService.syncAutoMarket(true);
    assert.equal(result.partial, true);
    assert.equal(requestedResources.includes('messages'), false);
    assert.equal(db.getIntegrationResourceStatus('messages').allowed, 0);
    assert.equal(db.getIntegrationResourceStatus('messages').status, 'forbidden');
    responses['connection-map'].allowed_scopes = originalAllowedScopes;
    responses['connection-map'].permissions = originalPermissions;
  });
  await test('connected appointments create bounded 24-hour or 2-hour reminders', async function () {
    const future = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    db.replaceIntegrationCache('reseller-appointments', [{ appointment_id:'appt-soon', customer_name:'Upcoming Customer', appointment_date:future, appointment_status:'confirmed', reseller_id:'reseller-1' }]);
    const before = db.listNotificationEvents(500, false).length;
    await notificationService.processConnectedBusinessAlerts();
    const after = db.listNotificationEvents(500, false);
    assert(after.length > before);
    assert(after.some((event)=>String(event.title).includes('2 hours')));
    await notificationService.processConnectedBusinessAlerts();
    assert.equal(db.listNotificationEvents(500, false).filter((event)=>String(event.entity_id) === 'appt-soon').length, 1);
  });
  await test('desktop permission is explicit and test notification is delivered', async function () {
    await notificationService.requestPermission();
    assert.equal(db.getSettings().notifications_user_consent,'1');
    await notificationService.testNotification();
    assert(FakeNotification.shown.length >= 1);
  });
  await test('saving a new API key invalidates only the cached discovery contract', async function () {
    db.replaceIntegrationCache('messages', [{ thread_id:'keep-thread', subject:'Keep synchronized message cache' }]);
    db.replaceIntegrationCache('ping', [{ status:'old' }]);
    db.replaceIntegrationCache('connection-map', [{ scopes:['messages:read'] }]);
    db.saveIntegrationStatus({ connected:1, scopes_json:'["messages:read"]', connection_map_json:'{"old":true}', sync_state:'ready' });
    const handlers = {};
    registerIntegrationsIpc({ handle(channel, handler) { handlers[channel] = handler; } }, { database:db, settingsService, apiService, notificationService });
    const saved = await handlers['integration:save']({}, { automarket_base_url:'https://example.com', automarket_api_key:'new-key-with-write' });
    assert.equal(saved.ok, true);
    assert.equal(db.integrationCacheCount('ping'), 0);
    assert.equal(db.integrationCacheCount('connection-map'), 0);
    assert.equal(db.integrationCacheCount('messages'), 1, 'Changing credentials must not delete local conversation history.');
    assert.equal(db.getIntegrationStatus().connected, 0);
    assert.equal(db.getIntegrationStatus().connection_map_json, '{}');
    assert.equal(db.getIntegrationStatus().sync_state, 'credentials_changed');
  });
  await test('API key is never exposed by public settings or connected cache', function () {
    const settings = settingsService.getPublicSettings();
    assert.equal(settings.secrets.automarket.configured,true);
    assert.equal(JSON.stringify(settings).includes('test-api-key-value'),false);
    assert.equal(JSON.stringify(db.connectedBusinessOverview()).includes('test-api-key-value'),false);
  });
  await test('disconnect clears the remote cache without deleting local records', function () {
    db.saveContact({ name:'Local Contact', phone:'5550001' });
    db.clearIntegrationData();
    assert.equal(db.integrationCacheCount('agenda'), 0);
    assert.equal(db.listContacts().length, 1);
  });

  global.fetch = originalFetch;
  db.close();
  fs.rmSync(tempDir,{recursive:true,force:true});
  console.log('\n' + passed + ' full API synchronization and notification tests passed.');
  if (process.exitCode) process.exit(process.exitCode);
}()).catch(function fatal(error) {
  global.fetch = originalFetch;
  try { db.close(); } catch (_) {}
  try { fs.rmSync(tempDir,{recursive:true,force:true}); } catch (_) {}
  console.error(error.stack || error.message);
  process.exit(1);
});
