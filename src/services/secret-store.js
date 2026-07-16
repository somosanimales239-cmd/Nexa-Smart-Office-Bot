'use strict';

const fs = require('node:fs');
const path = require('node:path');

class SecretStore {
  constructor(filePath, safeStorage) {
    this.filePath = filePath;
    this.safeStorage = safeStorage;
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
  }

  available() {
    return Boolean(this.safeStorage?.isEncryptionAvailable?.());
  }

  readFile() {
    if (!fs.existsSync(this.filePath)) return {};
    try {
      return JSON.parse(fs.readFileSync(this.filePath, 'utf8')) || {};
    } catch (_) {
      return {};
    }
  }

  writeFile(data) {
    fs.writeFileSync(this.filePath, JSON.stringify(data, null, 2), { mode: 0o600 });
  }

  save(name, value) {
    const clean = String(value || '').trim();
    const data = this.readFile();
    if (!clean) {
      delete data[name];
      this.writeFile(data);
      return;
    }
    if (!this.available()) throw new Error('Secure operating-system storage is not available. The API key was not saved.');
    data[name] = {
      encrypted: this.safeStorage.encryptString(clean).toString('base64'),
      last4: clean.slice(-4),
      updated_at: new Date().toISOString()
    };
    this.writeFile(data);
  }

  get(name) {
    const entry = this.readFile()[name];
    if (!entry?.encrypted) return '';
    if (!this.available()) throw new Error('Secure operating-system storage is not available.');
    return this.safeStorage.decryptString(Buffer.from(entry.encrypted, 'base64'));
  }

  publicStatus() {
    const data = this.readFile();
    return {
      secureStorageAvailable: this.available(),
      openai: data.openai ? { configured: true, masked: `••••${data.openai.last4 || ''}`, updated_at: data.openai.updated_at } : { configured: false, masked: '' },
      deepseek: data.deepseek ? { configured: true, masked: `••••${data.deepseek.last4 || ''}`, updated_at: data.deepseek.updated_at } : { configured: false, masked: '' }
    };
  }
}

module.exports = { SecretStore };
