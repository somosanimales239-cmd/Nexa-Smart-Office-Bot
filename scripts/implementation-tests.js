'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const main = fs.readFileSync(path.join(root, 'main.js'), 'utf8');
const preload = fs.readFileSync(path.join(root, 'preload.js'), 'utf8');
const html = fs.readFileSync(path.join(root, 'src', 'index.html'), 'utf8');

assert.equal(packageJson.build.asar, true);
assert.equal(main.includes('contextIsolation: true'), true);
assert.equal(main.includes('nodeIntegration: false'), true);
assert.equal(preload.includes("contacts:create"), true);
assert.equal(preload.includes("ai:generate"), true);
assert.equal(preload.includes("integration:test"), true);
assert.equal(preload.includes("integration:inspector"), true);
assert.equal(preload.includes("integration:items"), true);
assert.equal(preload.includes("notifications:permission"), true);
['dashboard', 'sidebar', 'connected-business', 'api-sync-inspector', 'contacts', 'leads', 'agenda', 'tasks', 'ai', 'alerts', 'smart-notifications', 'activity', 'settings', 'about'].forEach(function requireTestId(id) {
  assert.equal(html.includes('data-testid="' + id + '"'), true);
});
const integrationIpc = fs.readFileSync(path.join(root, 'src', 'ipc', 'integrations-ipc.js'), 'utf8');
const apiService = fs.readFileSync(path.join(root, 'src', 'services', 'automarket-api-service.js'), 'utf8');
const notificationService = fs.readFileSync(path.join(root, 'src', 'services', 'notification-service.js'), 'utf8');
const migrations = fs.readFileSync(path.join(root, 'src', 'database', 'migrations.js'), 'utf8');
assert.equal(integrationIpc.includes('integration:inspector'), true);
assert.equal(integrationIpc.includes('integration:items'), true);
assert.equal(apiService.includes('NEXA_API_SYNC_INSPECTOR_V1'), true);
assert.equal(notificationService.includes('NEXA_CONNECTED_BUSINESS_FULL_SYNC_V2'), true);
assert.equal(migrations.includes('integration_resource_status'), true);
assert.equal(migrations.includes('integration_cache'), true);
console.log('Implementation tests passed.');
