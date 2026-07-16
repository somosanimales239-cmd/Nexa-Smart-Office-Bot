'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const root = path.resolve(__dirname, '..');
const dist = path.join(root, 'dist');
if (!fs.existsSync(dist)) throw new Error('dist directory does not exist.');

const files = fs.readdirSync(dist).filter((name) => /\.(exe|zip)$/i.test(name));
const installer = files.find((name) => /Setup.*\.exe$/i.test(name));
const portable = files.find((name) => /Portable.*\.exe$/i.test(name));
const zip = files.find((name) => /\.zip$/i.test(name));
const required = { installer, portable, zip };
for (const [type,name] of Object.entries(required)) {
  if (!name) throw new Error(`Missing ${type} artifact.`);
  const size = fs.statSync(path.join(dist,name)).size;
  if (size < 5 * 1024 * 1024) throw new Error(`${type} artifact is unexpectedly small: ${size} bytes.`);
}

const manifest = Object.fromEntries(Object.entries(required).map(([type,name]) => {
  const filePath = path.join(dist,name);
  return [type, {
    name,
    size: fs.statSync(filePath).size,
    sha256: crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex')
  }];
}));
manifest.generated_at = new Date().toISOString();
fs.writeFileSync(path.join(dist,'artifact-manifest.json'), JSON.stringify(manifest,null,2));
console.log(JSON.stringify(manifest,null,2));
console.log('PASS Installer, Portable and ZIP artifacts exist with valid minimum sizes.');
