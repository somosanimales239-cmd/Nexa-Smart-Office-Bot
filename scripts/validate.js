'use strict';

const childProcess = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const javascriptFiles = [];
function collect(directory) {
  fs.readdirSync(directory, { withFileTypes: true }).forEach(function visit(entry) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) collect(full);
    if (entry.isFile() && entry.name.endsWith('.js')) javascriptFiles.push(full);
  });
}
collect(root);
const filtered = javascriptFiles.filter(function excludeGenerated(file) {
  return !file.includes(path.sep + 'node_modules' + path.sep) && !file.includes(path.sep + 'dist' + path.sep);
});
filtered.forEach(function checkSyntax(file) {
  childProcess.execFileSync(process.execPath, ['--check', file], { stdio: 'inherit' });
});
childProcess.execFileSync(process.execPath, [path.join(root, 'scripts', 'validate-delivery.js')], { stdio: 'inherit', cwd: root });
childProcess.execFileSync(process.execPath, [path.join(root, 'scripts', 'validate-project.js')], { stdio: 'inherit', cwd: root });
console.log('All JavaScript syntax and project validators passed.');
