'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const { DatabaseService, normalizePhone } = require('../src/database/database');
const { SettingsService } = require('../src/services/settings-service');
const {
  AutoMarketApiService,
  NEXA_AUTOMARKET_APPOINTMENT_LEADS_V7,
  NEXA_AUTOMARKET_APPOINTMENT_RESERVATION_V8,
  cleanBaseUrl,
  deriveAppointmentCapabilities,
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

const dealerScopes = ['store:read', 'dealer:read', 'listings:read', 'orders:read', 'agenda:read', 'messages:read', 'messages:write', 'resellers:read', 'dealer-appointment-availability:read', 'dealer-agenda-calendar:read', 'appointment-create:write'];
const openSlotDate = new Date(Date.now() + 2 * 86400000);
openSlotDate.setHours(10, 0, 0, 0);
const blockedDate = new Date(Date.now() + 3 * 86400000);
const dateKey = function dateKey(value) { return value.getFullYear() + '-' + String(value.getMonth() + 1).padStart(2, '0') + '-' + String(value.getDate()).padStart(2, '0'); };
const responses = {
  ping: { ok: true, data: { account_type: 'dealer', owner_type: 'dealer', account_id: 'dealer-7', owner_id: 'dealer-7', user_id: 'user-7', store_id: 'store-7', api_version: 'v1' } },
  'connection-map': {
    ok: true,
    allowed_scopes: dealerScopes.slice(),
    permissions: dealerScopes.slice(),
    allowed_endpoints: ['messages-thread','messages-send','messages-read','dealer-appointment-availability','dealer-agenda-calendar','appointment-create-from-thread','reserve-appointment-slot'],
    appointment_create_aliases: ['appointment-create','lead-appointment-create','nexa-appointment-create','appointment-create-from-thread','reserve-appointment-slot','agenda-reserve-appointment','lead-appointment-reserve'],
    reserve_slot_contract: 'Dealer Agenda Reserve Appointment',
    messages_write_enabled: true,
    message_send_endpoint: 'message-send',
    two_way_chat_enabled: true,
    dealer_appointment_availability_enabled: true,
    dealer_appointment_availability_endpoint: 'dealer-appointment-availability',
    dealer_agenda_calendar_enabled: true,
    dealer_agenda_calendar_endpoint: 'dealer-agenda-calendar',
    appointment_create_enabled: true,
    appointment_create_endpoint: 'appointment-create',
    data: { contract: 'NEXA_AUTOMARKET_API_V1', account_type: 'dealer', owner_type: 'dealer', account_id: 'dealer-7', owner_id: 'dealer-7', user_id: 'user-7', store_id: 'store-7', api_version: 'v1', available_resources: ['store','dealer-summary','orders','messages','listings','agenda','resellers','dealer-appointment-availability','dealer-agenda-calendar','appointment-create'] }
  },
  store: { ok: true, data: { store_id: 'store-7', store_name: 'Demo Motors', city: 'Naples', status: 'active', public_store_url: 'https://example.com/store/demo-motors', server_private_value: 'must-not-enter-cache', secret_transport_value: 'must-not-enter-cache' } },
  'dealer-summary': { ok: true, data: { total_listings: 5, active_listings: 4, unreviewed_orders: 1, agenda_contacts: 2, unread_messages: 2 } },
  orders: { ok: true, data: [{ id: 'order-1', name: 'Customer One', email: 'customer@example.com', phone: '(786) 555-3333', status: 'new', order_type: 'dealer_appointment', source_context: 'nexa_smart_office_bot_dealer', source_label: 'Nexa Smart Office Bot', created_by_platform: 'Nexa Smart Office Bot', appointment_date: '2026-07-22', appointment_time: '10:30', appointment_status: 'scheduled', appointment_result_status: '', appointment_commission_percent: 0, appointment_commission_amount: 0, created_at: '2026-07-17T10:00:00Z', server_private_value: 'remove-me' }] },
  messages: { ok: true, data: [{ thread_id: 'thread-1', subject: 'Admin announcement', unread_count: 1, is_announcement: 1, can_reply: 0, last_message_at: '2026-07-17T11:00:00Z' }] },
  listings: { ok: true, data: [{ id: 'listing-1', title: 'Vehicle One', price: 3200, status: 'active', listing_url: 'https://example.com/listing/vehicle-one' }] },
  agenda: { ok: true, data: [
    { contact_id: 'agenda-1', name: 'Agenda Contact', phone: '786-555-3333', email: 'contact@example.com', location: 'Miami', last_seen_at: '2026-07-17T11:00:00Z' },
    { contact_id: 'agenda-2', name: 'Second Contact', phone: '+1 (239) 555-0100', email: 'second@example.com', location: 'Naples', last_seen_at: '2026-07-16T11:00:00Z' }
  ] },
  resellers: { ok: true, data: [{ reseller_id: 'reseller-1', reseller_name: 'Reseller One', status: 'active', appointment_count: 1, last_activity: '2026-07-17T09:00:00Z' }] },
  'dealer-appointment-availability': { ok: true, data: {
    dealer_id: 'dealer-7', dealer_name: 'Demo Dealer', store_id: 'store-7', store_name: 'Demo Motors', phone: '239-555-0100',
    location: 'Naples, FL', slot_minutes: 30, weekly_schedule: { monday: { open: '09:00', close: '17:00' }, sunday: { is_off: true, private_note: 'remove-me' } },
    blocked_dates: [dateKey(blockedDate)], open_dates: [dateKey(openSlotDate)], booked_times: [{ date: dateKey(openSlotDate), start_time: '11:00', status: 'booked' }],
    verified_open_slots: [{ slot_id: 'verified-slot-1', date: dateKey(openSlotDate), start_time: '10:00', end_time: '10:30', available: true, server_private_value: 'remove-me' }],
    assigned_listings: [{ listing_id: 'listing-1', listing_title: 'Vehicle One', server_private_value: 'remove-me' }], server_private_value: 'remove-me'
  } },
  'dealer-agenda-calendar': { ok: true, data: {
    from: dateKey(openSlotDate), days_count: 14, appointment_count: 1, verified_open_slots: 1,
    stores: [{ store_id: 'store-7', store_name: 'Demo Motors', phone: '239-555-0100', weekly_schedule: { monday: { open: '09:00', close: '17:00' } }, blocked_dates: [dateKey(blockedDate)],
      days: [{ date: dateKey(openSlotDate), day_key: 'mon', day_name: 'Monday', reason: 'open', is_open: true, available_count: 1, available_slots: [{ slot_id: 'calendar-slot-1', start_time: '10:00', end_time: '10:30', available: true, booked_count: 0 }],
        appointments: [{ appointment_id: 'calendar-appt-1', order_id: 'calendar-appt-1', customer_name: 'Calendar Customer', appointment_time: '11:00', appointment_status: 'scheduled', order_type: 'dealer_appointment', source_context: 'nexa_smart_office_bot_dealer', source_label: 'Nexa Smart Office Bot', created_by_platform: 'Nexa Smart Office Bot', server_private_value: 'remove-me' }] }], private_store_value: 'remove-me' }],
    server_private_value: 'remove-me'
  } },
  'appointment-create': { ok: true, resource: 'appointment-create', data: { order_id: 'ord-contract-1', lead_id: 'ord-contract-1', appointment_id: 'remote-contract-1', source: 'Nexa Smart Office Bot', source_context: 'nexa_smart_office_bot_dealer', thread_id: 'thread-contract-1', customer_name: 'Customer Name', customer_phone: '7865553333', appointment_date: '2026-07-22', appointment_time: '10:30', appointment_status: 'scheduled', reserved: true, reserved_slot_key: '2026-07-22|10:30', refresh_resources: ['dealer-agenda-calendar','dealer-appointment-availability','orders','agenda'], software_next_step: 'refresh', lead_url: 'https://example.com/dealer/orders.php?highlight_order=ord-contract-1' } }
};

let requestedResources = [];
let requestedQueries = [];
let requestedOptions = [];
let forcedFailures = {};
const originalFetch = global.fetch;
global.fetch = async function fakeFetch(url, options) {
  assert.equal(options.headers.Authorization, 'Bearer test-api-key-value');
  assert.equal(options.headers['X-Nexa-Api-Key'], 'test-api-key-value');
  assert.equal(options.headers['X-Nexa-Client'], 'Nexa-Smart-Office-Bot/1.6.16');
  const parsed = new URL(url);
  const resource = parsed.searchParams.get('resource');
  requestedResources.push(resource);
  requestedQueries.push({ resource: resource, query: Object.fromEntries(parsed.searchParams.entries()) });
  requestedOptions.push({ resource: resource, method: options.method, body: options.body || '', idempotencyKey: options.headers['Idempotency-Key'] || '' });
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
    assert.equal(NEXA_AUTOMARKET_APPOINTMENT_LEADS_V7, 'NEXA_AUTOMARKET_APPOINTMENT_LEADS_V7');
    assert.equal(NEXA_AUTOMARKET_APPOINTMENT_RESERVATION_V8, 'NEXA_AUTOMARKET_APPOINTMENT_RESERVATION_V8');
    assert(resourcePlan({ account_type:'dealer', available_resources:['orders'], scopes:['orders:read'] }).some((item)=>item.resource === 'orders'));
    assert(resourcePlan({ account_type:'reseller', available_resources:['reseller-profile'], scopes:['reseller-profile:read'] }).some((item)=>item.resource === 'reseller-profile'));
    const resellerV7 = resourcePlan({ account_type:'reseller', available_resources:['orders','listings'], scopes:['reseller:read'] });
    assert(resellerV7.some((item)=>item.resource === 'orders'));
    assert(resellerV7.some((item)=>item.resource === 'listings'));
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
  await test('appointment creation requires both the V6 endpoint and write scope', function () {
    const ready = deriveAppointmentCapabilities({ scopes: ['dealer-agenda-calendar:read','appointment-create:write'] }, {
      dealer_agenda_calendar_enabled: true, dealer_agenda_calendar_endpoint: 'dealer-agenda-calendar',
      appointment_create_enabled: true, appointment_create_endpoint: 'appointment-create'
    });
    assert.equal(ready.calendarRead, true);
    assert.equal(ready.createWrite, true);
    const missingScope = deriveAppointmentCapabilities({ scopes: ['dealer-agenda-calendar:read'] }, { appointment_create_enabled: true, appointment_create_endpoint: 'appointment-create' });
    assert.equal(missingScope.createEndpoint, true);
    assert.equal(missingScope.createWrite, false);
    const disabled = deriveAppointmentCapabilities({ scopes: ['appointment-create:write'] }, { appointment_create_enabled: false, appointment_create_endpoint: 'appointment-create' });
    assert.equal(disabled.createWrite, false);
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
    assert.deepEqual(result.connectionMap.allowed_endpoints, ['messages-thread','messages-send','messages-read','dealer-appointment-availability','dealer-agenda-calendar','appointment-create-from-thread','reserve-appointment-slot']);
    assert.equal(result.connectionMap.appointment_create_aliases.includes('agenda-reserve-appointment'), true);
    assert.equal(result.identity.available_resources.includes('appointment-create'), true);
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
    const appointmentCapabilities = deriveAppointmentCapabilities(result.identity, result.connectionMap);
    assert.equal(appointmentCapabilities.availabilityRead, true);
    assert.equal(appointmentCapabilities.calendarRead, true);
    assert.equal(appointmentCapabilities.createWrite, true);
    assert.equal(result.connectionMap.dealer_agenda_calendar_endpoint, 'dealer-agenda-calendar');
    assert.equal(result.connectionMap.appointment_create_endpoint, 'appointment-create');
    assert.deepEqual(requestedResources, ['ping','connection-map']);
    assert(result.resources.some((entry)=>entry.resource === 'agenda'));
  });
  await test('appointment-create sends the thread Lead body and idempotency key', async function () {
    requestedOptions = [];
    const response = await apiService.createRemoteAppointment({
      listing_id: 'listing-45', customer_name: 'Customer Name', customer_phone: '7865553333', customer_email: 'optional@example.com',
      customer_location: 'Miami, FL', appointment_date: '2026-07-22', appointment_time: '10:30', notes: 'Customer wants to see the vehicle.',
      thread_id: 'thread-contract-1', start_at: 'must-not-be-forwarded'
    }, 'appointment-v6-idempotency');
    assert.equal(response.payload.appointment_id, 'remote-contract-1');
    assert.equal(response.payload.lead_id, 'ord-contract-1');
    assert.equal(response.payload.reserved, true);
    assert.equal(response.payload.reserved_slot_key, '2026-07-22|10:30');
    assert.deepEqual(response.payload.refresh_resources, ['dealer-agenda-calendar','dealer-appointment-availability','orders','agenda']);
    assert.equal(response.payload.software_next_step, 'refresh');
    assert.equal(response.payload.source, 'Nexa Smart Office Bot');
    const request = requestedOptions.find((item)=>item.resource === 'appointment-create');
    assert.equal(request.method, 'POST');
    assert.equal(request.idempotencyKey, 'appointment-v6-idempotency');
    assert.deepEqual(JSON.parse(request.body), {
      thread_id: 'thread-contract-1', listing_id: 'listing-45', customer_name: 'Customer Name', customer_phone: '7865553333', customer_email: 'optional@example.com',
      customer_location: 'Miami, FL', appointment_date: '2026-07-22', appointment_time: '10:30', notes: 'Customer wants to see the vehicle.'
    });
  });
  await test('appointment-create aliases normalize to the guarded Lead capability', async function () {
    for (const alias of ['lead-appointment-create','nexa-appointment-create','appointment-create-from-thread','reserve-appointment-slot','agenda-reserve-appointment','lead-appointment-reserve']) {
      const capabilities = deriveAppointmentCapabilities({ scopes: ['appointment-create:write'], available_resources: [alias] }, { allowed_endpoints: [alias], scopes: ['appointment-create:write'] });
      assert.equal(capabilities.createEndpoint, true);
      assert.equal(capabilities.createWrite, true);
      assert(capabilities.resources.includes('appointment-create'));
    }
  });
  await test('thread-derived Lead creation needs no listing or duplicated customer name', async function () {
    requestedOptions = [];
    const response = await apiService.createRemoteAppointment({
      thread_id: 'msg-thread-only', appointment_date: '2026-07-25', appointment_time: '11:00',
      customer_phone: '2395550199', notes: 'Customer confirmed appointment through Nexa Smart Office Bot.'
    }, 'thread-lead-idempotency');
    assert.equal(response.payload.lead_id, 'ord-contract-1');
    const request = requestedOptions.find((item)=>item.resource === 'appointment-create');
    assert.deepEqual(JSON.parse(request.body), {
      thread_id: 'msg-thread-only', customer_phone: '2395550199', appointment_date: '2026-07-25', appointment_time: '11:00',
      notes: 'Customer confirmed appointment through Nexa Smart Office Bot.'
    });
  });
  await test('first full synchronization loads every allowed dealer resource and diagnostics', async function () {
    requestedResources = [];
    const result = await notificationService.syncAutoMarket(false);
    assert.equal(result.ok, true);
    assert.equal(result.failureCount, 0);
    ['ping','connection-map','store','dealer-summary','listings','orders','agenda','messages','resellers','dealer-appointment-availability','dealer-agenda-calendar'].forEach(function expected(resource) {
      assert(requestedResources.includes(resource), 'resource not requested: ' + resource);
      const row = db.getIntegrationResourceStatus(resource);
      assert(row, 'missing inspector row: ' + resource);
      assert.equal(row.status, 'ok');
    });
    assert.equal(db.getIntegrationStatus().connected, 1);
    assert.equal(db.getIntegrationStatus().sync_state, 'ready');
    assert.equal(db.integrationCacheCount('agenda'), 2);
    assert.equal(db.integrationCacheCount('orders'), 1);
    const connectedLead = db.listIntegrationCache('orders', '', 10)[0];
    assert.equal(connectedLead.order_id, 'order-1');
    assert.equal(connectedLead.lead_id, 'order-1');
    assert.equal(connectedLead.customer_name, 'Customer One');
    assert.equal(connectedLead.customer_phone, '(786) 555-3333');
    assert.equal(connectedLead.source_context, 'nexa_smart_office_bot_dealer');
    assert.equal(connectedLead.source_label, 'Nexa Smart Office Bot');
    assert.equal(connectedLead.created_by_platform, 'Nexa Smart Office Bot');
    assert.equal(connectedLead.server_private_value, undefined);
    assert.equal(db.integrationCacheCount('dealer-appointment-availability'), 2);
    assert.equal(db.integrationCacheCount('dealer-agenda-calendar'), 2);
    const availabilityRequest = requestedQueries.find(function findRequest(item) { return item.resource === 'dealer-appointment-availability'; });
    assert.match(availabilityRequest.query.from, /^20\d{2}-\d{2}-\d{2}$/);
    assert.equal(availabilityRequest.query.days, '14');
    assert.equal(availabilityRequest.query.limit, '100');
    const calendarRequest = requestedQueries.find(function findRequest(item) { return item.resource === 'dealer-agenda-calendar'; });
    assert.match(calendarRequest.query.from, /^20\d{2}-\d{2}-\d{2}$/);
    assert.equal(calendarRequest.query.days, '14');
  });
  await test('dealer Agenda calendar keeps verified schedule and appointments while removing private fields', function () {
    const cached = db.listIntegrationCache('dealer-agenda-calendar', '', 10);
    const snapshot = cached.find(function findSnapshot(item) { return item.record_type === 'calendar_snapshot'; });
    const appointment = cached.find(function findAppointment(item) { return item.record_type === 'calendar_appointment'; });
    assert.equal(snapshot.stores[0].store_name, 'Demo Motors');
    assert.equal(snapshot.stores[0].blocked_dates[0], dateKey(blockedDate));
    assert.equal(snapshot.stores[0].days[0].day_key, 'mon');
    assert.equal(snapshot.stores[0].days[0].reason, 'open');
    assert.equal(snapshot.stores[0].days[0].available_count, 1);
    assert.equal(snapshot.stores[0].days[0].available_slots[0].booked_count, 0);
    assert.equal(snapshot.stores[0].private_store_value, undefined);
    assert.equal(snapshot.server_private_value, undefined);
    assert.equal(appointment.appointment_id, 'calendar-appt-1');
    assert.equal(appointment.customer_name, 'Calendar Customer');
    assert.equal(appointment.source_context, 'nexa_smart_office_bot_dealer');
    assert.equal(appointment.source_label, 'Nexa Smart Office Bot');
    assert.equal(appointment.created_by_platform, 'Nexa Smart Office Bot');
    assert.equal(appointment.server_private_value, undefined);
    assert.match(appointment.start_at, /^20\d{2}-\d{2}-\d{2}T11:00/);
  });
  await test('dealer availability keeps schedules, off dates and verified slots while removing private fields', function () {
    const cached = db.listIntegrationCache('dealer-appointment-availability', '', 10);
    const snapshot = cached.find(function findSnapshot(item) { return item.record_type === 'availability_snapshot'; });
    const slot = cached.find(function findSlot(item) { return item.record_type === 'verified_open_slot'; });
    assert.equal(snapshot.dealer_name, 'Demo Dealer');
    assert.equal(snapshot.slot_minutes, 30);
    assert.equal(snapshot.blocked_dates[0], dateKey(blockedDate));
    assert.equal(snapshot.weekly_schedule.sunday.is_off, true);
    assert.equal(snapshot.weekly_schedule.sunday.private_note, undefined);
    assert.equal(snapshot.assigned_listings[0].listing_title, 'Vehicle One');
    assert.equal(snapshot.assigned_listings[0].server_private_value, undefined);
    assert.equal(slot.slot_id, 'verified-slot-1');
    assert.equal(slot.server_private_value, undefined);
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
    assert.equal(context.connected_business.dealer_appointment_availability.dealer_name, 'Demo Dealer');
    assert.equal(context.connected_business.dealer_appointment_availability.verified_open_slots.length, 1);
    assert.equal(context.connected_business.dealer_appointment_availability.blocked_dates[0], dateKey(blockedDate));
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
