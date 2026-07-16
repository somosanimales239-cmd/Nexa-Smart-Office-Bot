'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const root = process.cwd();
const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));

test('Electron package has a valid active entry graph', () => {
  assert.match(String(packageJson.version || ''), /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/);
  assert.ok(fs.existsSync(path.join(root, packageJson.main || 'main.js')));
  assert.equal(typeof packageJson.scripts?.['ui:smoke'], 'string');
  assert.equal(typeof packageJson.scripts?.['validate:delivery'], 'string');
});

test('Electron security defaults are not explicitly disabled', () => {
  const source = fs.readFileSync(path.join(root, packageJson.main || 'main.js'), 'utf8');
  assert.doesNotMatch(source, /nodeIntegration\s*:\s*true/);
  assert.doesNotMatch(source, /contextIsolation\s*:\s*false/);
  assert.doesNotMatch(source, /webSecurity\s*:\s*false/);
});