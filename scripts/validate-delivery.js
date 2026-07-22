'use strict';

const fs = require('node:fs');
const path = require('node:path');

const root = process.cwd();
const NEXA_BUILD_ONCE_GATE_V1 = 'NEXA_BUILD_ONCE_GATE_V1';
const requiredFiles = [
  'main.js',
  'preload.js',
  'src/index.html',
  'src/app.js',
  'src/database/database.js',
  'src/database/migrations.js',
  'src/services/settings-service.js',
  'src/services/backup-service.js',
  'src/services/openai-provider.js',
  'src/services/deepseek-provider.js',
  'src/services/ai-service.js',
  'src/services/automatic-actions-service.js',
  'src/services/dealer-availability-service.js',
  'src/services/dealer-agenda-calendar-service.js',
  'src/services/dealer-contact-service.js',
  'src/services/appointment-communication-service.js',
  'src/services/appointment-communication-library-service.js',
  'src/data/appointment-communication-library.json',
  'src/ipc/foundation-ipc.js',
  'src/ipc/records-ipc.js',
  'src/ipc/agenda-ipc.js',
  'src/ipc/ai-ipc.js',
  'src/ipc/automation-ipc.js',
  'package-lock.json',
  '.github/workflows/windows-build.yml'
];

const failures = requiredFiles.filter(function missingFile(file) {
  return !fs.existsSync(path.join(root, file));
}).map(function formatFailure(file) { return 'Missing required delivery file: ' + file; });

const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
['validate:delivery', 'validate:project', 'test', 'test:implementation', 'test:acceptance', 'ui:smoke', 'build:win'].forEach(function requireScript(name) {
  if (!packageJson.scripts || typeof packageJson.scripts[name] !== 'string' || !packageJson.scripts[name].trim()) failures.push('Missing npm script: ' + name);
});

const targets = packageJson.build && packageJson.build.win ? packageJson.build.win.target : [];
const targetNames = Array.isArray(targets) ? targets.map(function targetName(entry) { return typeof entry === 'string' ? entry : entry.target; }) : [];
['nsis', 'portable', 'zip'].forEach(function requireTarget(target) {
  if (!targetNames.includes(target)) failures.push('Windows target is missing: ' + target);
});

if (packageJson.build && packageJson.build.asar !== true) failures.push('ASAR packaging must be enabled.');
const packagedFiles = packageJson.build && Array.isArray(packageJson.build.files) ? packageJson.build.files : [];
if (!packagedFiles.includes('package-lock.json')) failures.push('package-lock.json must be included as runtime evidence.');

if (failures.length) {
  console.error(failures.map(function line(item) { return '- ' + item; }).join('\n'));
  process.exit(1);
}
console.log(NEXA_BUILD_ONCE_GATE_V1 + ': delivery graph verified.');
