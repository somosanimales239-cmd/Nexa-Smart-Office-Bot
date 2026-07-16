'use strict';

const { spawn } = require('node:child_process');
const electronPath = require('electron');

const child = spawn(electronPath, ['.'], {
  cwd: require('node:path').resolve(__dirname, '..'),
  env: { ...process.env, NEXA_UI_SMOKE: '1' },
  stdio: ['ignore','pipe','pipe']
});

let output = '';
const timer = setTimeout(() => {
  child.kill();
  console.error('UI smoke timed out.');
  process.exit(1);
}, 60000);

child.stdout.on('data', (chunk) => { output += chunk.toString(); process.stdout.write(chunk); });
child.stderr.on('data', (chunk) => { output += chunk.toString(); process.stderr.write(chunk); });
child.on('exit', (code) => {
  clearTimeout(timer);
  const marker = output.split(/\r?\n/).find((line) => line.startsWith('NEXA_UI_SMOKE:'));
  if (!marker) {
    console.error('UI smoke marker was not produced.');
    process.exit(1);
  }
  let result;
  try { result = JSON.parse(marker.slice('NEXA_UI_SMOKE:'.length)); } catch (_) { result = null; }
  if (code !== 0 || !result?.ok) process.exit(1);
  console.log('PASS Electron renderer opened with all required navigation and no uncaught errors.');
});
