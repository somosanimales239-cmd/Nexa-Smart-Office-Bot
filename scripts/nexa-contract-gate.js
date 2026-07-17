'use strict';

const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

const requirements = [
  ['src/database/migrations.js', 'migration marker: NEXA_SCHEMA_MIGRATION_V1'],
  ['src/services/backup-service.js', 'backup marker: NEXA_BACKUP_REDACTED_SETTINGS_V1'],
  ['src/ipc/records-ipc.js', 'confirmation marker: data-testid="confirm-delete-dialog"'],
  ['src/ipc/records-ipc.js', 'empty-state markers: contacts-empty, leads-empty, tasks-empty'],
  ['src/modules/ai.js', 'error marker: AI provider not configured'],
  ['src/modules/ai.js', 'timeout marker: AI_REQUEST_TIMEOUT_MS'],
  ['src/modules/ai.js', 'confirmation marker: data-testid="ai-save-confirmation"'],
  ['src/modules/notifications.js', 'notification marker: new Notification(...)'],
  ['main.js', "ipcMain.handle('app:health'"],
  ['preload.js', "ipcRenderer.invoke('app:health'"],
  ['.github/workflows/windows-build.yml', 'run: node scripts/integration-tests.js'],
  ['src/services/automarket-api-service.js', 'NEXA_AUTOMARKET_API_V1'],
  ['src/services/notification-service.js', 'NEXA_SMART_NOTIFICATIONS_V1'],
  ['src/ipc/integrations-ipc.js', 'integration:test'],
  ['src/ipc/notifications-ipc.js', 'notifications:permission'],
  ['src/index.html', 'data-testid="connected-business"'],
  ['src/index.html', 'data-testid="smart-notifications"']
];

const failures = [];
for (const [file, marker] of requirements) {
  const source = read(file);
  if (!source.includes(marker)) failures.push(file + ' is missing: ' + marker);
}

const packageJson = JSON.parse(read('package.json'));
for (const script of ['validate:delivery', 'validate:project', 'test', 'test:implementation', 'test:acceptance', 'ui:smoke']) {
  if (!packageJson.scripts || !packageJson.scripts[script]) failures.push('package.json is missing script: ' + script);
}

if (failures.length) {
  console.error(failures.join('\n'));
  process.exit(1);
}

console.log('NEXA_APPROVED_CONTRACT_GATE_V1: exact platform contract evidence verified.');
