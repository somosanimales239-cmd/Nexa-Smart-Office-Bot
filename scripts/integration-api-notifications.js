'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const { DatabaseService } = require('../src/database/database');
const { SettingsService } = require('../src/services/settings-service');
const { AutoMarketApiService, cleanBaseUrl, stableHash } = require('../src/services/automarket-api-service');
const { NotificationService } = require('../src/services/notification-service');

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nexa-connected-business-'));
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
  automarket_api_key: 'ak_live_test_key',
  automarket_sync_enabled: '1',
  automarket_poll_minutes: '5'
});

const responses = {
  ping: { ok: true, data: { account_type: 'dealer', store_id: 'store-7' } },
  'connection-map': { ok: true, data: { resources: ['store','dealer-summary','orders','messages','listings','agenda','resellers'] } },
  store: { ok: true, data: { store_name: 'Demo Motors', city: 'Naples' } },
  'dealer-summary': { ok: true, data: { active_listings: 4, unreviewed_orders: 1 } },
  orders: { ok: true, data: [{ id: 'order-1', customer_name: 'Customer One', status: 'unreviewed' }] },
  messages: { ok: true, data: { unread_threads: 2 } },
  listings: { ok: true, data: [{ id: 'listing-1', title: 'Vehicle One', status: 'active' }] },
  agenda: { ok: true, data: [{ id: 'agenda-1', name: 'Agenda Contact', phone: '555-0100' }] },
  resellers: { ok: true, data: [{ id: 'reseller-1', name: 'Reseller One', status: 'new' }] }
};

const originalFetch = global.fetch;
global.fetch = async function fakeFetch(url, options) {
  assert.equal(options.headers.Authorization, 'Bearer ak_live_test_key');
  const resource = new URL(url).searchParams.get('resource');
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
  await test('API connection uses ping and connection-map', async function () {
    const result = await apiService.testConnection();
    assert.equal(result.ping.account_type, 'dealer');
    assert(Array.isArray(result.connectionMap.resources));
  });
  await test('first synchronization creates a baseline without remote-change spam', async function () {
    const result = await notificationService.syncAutoMarket(false);
    assert(result.resources.includes('orders'));
    assert.equal(db.getIntegrationStatus().connected,1);
    assert(db.getIntegrationSnapshot('orders'));
  });
  await test('a second synchronization detects a new order', async function () {
    responses.orders.data.push({ id:'order-2', customer_name:'Customer Two', status:'unreviewed' });
    const result = await notificationService.syncAutoMarket(false);
    assert(result.changes.some((item)=>item && item.type === 'remote_orders'));
  });
  await test('desktop permission is explicit and test notification is delivered', async function () {
    await notificationService.requestPermission();
    assert.equal(db.getSettings().notifications_user_consent,'1');
    await notificationService.testNotification();
    assert(FakeNotification.shown.length >= 1);
  });
  await test('API key is never exposed by public settings', function () {
    const settings = settingsService.getPublicSettings();
    assert.equal(settings.secrets.automarket.configured,true);
    assert.equal(JSON.stringify(settings).includes('ak_live_test_key'),false);
  });

  global.fetch = originalFetch;
  db.close();
  fs.rmSync(tempDir,{recursive:true,force:true});
  console.log('\n' + passed + ' connected-business and notification tests passed.');
  if (process.exitCode) process.exit(process.exitCode);
}()).catch(function fatal(error) {
  global.fetch = originalFetch;
  try { db.close(); } catch (_) {}
  try { fs.rmSync(tempDir,{recursive:true,force:true}); } catch (_) {}
  console.error(error.stack || error.message);
  process.exit(1);
});
