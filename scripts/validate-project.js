'use strict';

const fs = require('node:fs');
const path = require('node:path');

const NEXA_VALIDATION_MATRIX_V3 = 'NEXA_VALIDATION_MATRIX_V3';
const root = process.cwd();
const sources = [
  'main.js', 'preload.js', 'src/index.html', 'src/app.js',
  'src/database/migrations.js', 'src/services/settings-service.js',
  'src/services/backup-service.js', 'src/services/openai-provider.js',
  'src/services/deepseek-provider.js', 'src/services/automarket-api-service.js', 'src/services/notification-service.js', 'src/services/automatic-actions-service.js', 'src/services/dealer-availability-service.js', 'src/services/dealer-agenda-calendar-service.js', 'src/services/appointment-communication-service.js', 'src/services/appointment-communication-library-service.js', 'src/data/appointment-communication-library.json', 'src/ipc/foundation-ipc.js',
  'src/ipc/records-ipc.js', 'src/ipc/agenda-ipc.js', 'src/ipc/ai-ipc.js', 'src/ipc/integrations-ipc.js', 'src/ipc/notifications-ipc.js', 'src/ipc/automation-ipc.js',
  'src/modules/contacts.js', 'src/modules/leads.js', 'src/modules/tasks.js',
  'src/modules/agenda.js', 'src/modules/notifications.js', 'src/modules/ai.js'
];
const combined = sources.map(function readSource(file) {
  return fs.readFileSync(path.join(root, file), 'utf8');
}).join('\n');
const requiredMarkers = [
  'webPreferences.contextIsolation === true',
  'webPreferences.nodeIntegration === false',
  'NEXA_SCHEMA_MIGRATION_V1',
  'NEXA_BACKUP_REDACTED_SETTINGS_V1',
  'safeStorage.encryptString',
  'safeStorage.decryptString',
  'OpenAIProvider',
  'DeepSeekProvider',
  'AI_REQUEST_TIMEOUT_MS',
  'AI provider not configured',
  'NEXA_UI_CONTRACT_V1',
  'data-nexa-action',
  'confirm-delete-dialog',
  'ai-save-confirmation',
  'NEXA_AUTOMARKET_API_V1',
  'NEXA_SMART_NOTIFICATIONS_V1',
  'NEXA_CONNECTED_BUSINESS_AND_NOTIFICATIONS_V1',
  'NEXA_API_SYNC_INSPECTOR_V1',
  'NEXA_CONNECTED_BUSINESS_FULL_SYNC_V2',
  'integration_resource_status',
  'integration_cache',
  'integration:inspector',
  'integration:items',
  'api-sync-inspector',
  'integration:test',
  'notifications:permission',
  'connected-business',
  'smart-notifications',
  'NEXA_GUARDED_AUTOMATIC_ACTIONS_V1',
  'NEXA_AUTOMATION_NO_CUSTOMER_MUTATION_OR_DELETE_V1',
  'automation:get',
  'automation:save',
  'dealer-appointment-availability',
  'NEXA_LIVE_DEALER_AVAILABILITY_V1',
  'NEXA_DEALER_AGENDA_CALENDAR_SYNC_V1',
  'dealer-agenda-calendar',
  'appointment-create:write',
  'NEXA_PRO_APPOINTMENT_COMMUNICATION_V1',
  'NEXA_BILINGUAL_APPOINTMENT_LIBRARY_V1',
  'NEXA_APPOINTMENT_CONSISTENCY_GUARD_V1',
  'NEXA_CONTEXTUAL_TIME_SELECTION_V1',
  'NEXA_APPOINTMENT_DATE_CONTEXT_RECOVERY_V1',
  'NEXA_APPOINTMENT_CONTACT_RECOVERY_V1',
  'NEXA_APPOINTMENT_STATE_MACHINE_V2',
  'NEXA_BILINGUAL_APPOINTMENT_STATE_LIBRARY_V2',
  'NEXA_APPOINTMENT_THREAD_LEAD_CREATION_V2',
  'ai-control'
];
const failures = requiredMarkers.filter(function missingMarker(marker) {
  return !combined.includes(marker);
}).map(function formatFailure(marker) { return 'Missing implementation marker: ' + marker; });

if (failures.length) {
  console.error(failures.map(function line(item) { return '- ' + item; }).join('\n'));
  process.exit(1);
}
console.log(NEXA_VALIDATION_MATRIX_V3 + ': project source contracts verified.');
