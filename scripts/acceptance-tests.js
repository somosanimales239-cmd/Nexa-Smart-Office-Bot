'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const workflow = fs.readFileSync(path.join(root, '.github', 'workflows', 'windows-build.yml'), 'utf8');
const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));

const preload = fs.readFileSync(path.join(root, 'preload.js'), 'utf8');
const html = fs.readFileSync(path.join(root, 'src', 'index.html'), 'utf8');
const apiService = fs.readFileSync(path.join(root, 'src', 'services', 'automarket-api-service.js'), 'utf8');
assert.equal(preload.includes('integration:inspector'), true);
assert.equal(preload.includes('integration:items'), true);
assert.equal(html.includes('data-testid="api-sync-inspector"'), true);
assert.equal(apiService.includes('RESOURCE_FIELD_ALLOWLISTS'), true);

['npm ci', 'npm run validate', 'npm test', 'npm run test:implementation', 'npm run test:acceptance', 'npm run ui:smoke', 'npm run build:win', 'npm run verify:artifacts', 'actions/upload-artifact'].forEach(function requireWorkflowStep(marker) {
  assert.equal(workflow.includes(marker), true, 'Workflow missing: ' + marker);
});
['nsis', 'portable', 'zip'].forEach(function requireTarget(target) {
  const targets = packageJson.build.win.target.map(function targetName(entry) { return typeof entry === 'string' ? entry : entry.target; });
  assert.equal(targets.includes(target), true);
});
console.log('Acceptance tests passed.');
