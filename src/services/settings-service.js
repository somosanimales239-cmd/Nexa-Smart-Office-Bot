'use strict';

const fs = require('node:fs');
const path = require('node:path');

const SAFE_STORAGE_IMPLEMENTATION = 'secret marker: safeStorage.encryptString/decryptString';

class SettingsService {
  constructor(database, secretFile, safeStorage) {
    this.database = database;
    this.secretFile = secretFile;
    this.safeStorage = safeStorage;
    fs.mkdirSync(path.dirname(secretFile), { recursive: true });
  }

  secureStorageAvailable() {
    return Boolean(this.safeStorage && this.safeStorage.isEncryptionAvailable && this.safeStorage.isEncryptionAvailable());
  }

  readSecrets() {
    if (!fs.existsSync(this.secretFile)) return {};
    try {
      const parsed = JSON.parse(fs.readFileSync(this.secretFile, 'utf8'));
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch (error) {
      return {};
    }
  }

  writeSecrets(secrets) {
    fs.writeFileSync(this.secretFile, JSON.stringify(secrets, null, 2), { mode: 0o600 });
  }

  saveSecret(provider, value) {
    const clean = String(value || '').trim();
    const secrets = this.readSecrets();
    if (!clean) {
      delete secrets[provider];
      this.writeSecrets(secrets);
      return;
    }
    if (!this.secureStorageAvailable()) {
      throw new Error('Secure operating-system storage is not available. The API key was not saved.');
    }
    const encryptedBuffer = this.safeStorage.encryptString(clean);
    secrets[provider] = {
      encrypted: encryptedBuffer.toString('base64'),
      last4: clean.slice(-4),
      updated_at: new Date().toISOString()
    };
    this.writeSecrets(secrets);
  }

  getSecret(provider) {
    const entry = this.readSecrets()[provider];
    if (!entry || !entry.encrypted) return '';
    if (!this.secureStorageAvailable()) {
      throw new Error('Secure operating-system storage is not available.');
    }
    const buffer = Buffer.from(entry.encrypted, 'base64');
    return this.safeStorage.decryptString(buffer);
  }

  getPublicSettings() {
    const secrets = this.readSecrets();
    const settings = this.database.getSettings();
    return Object.assign({}, settings, {
      secrets: {
        secureStorageAvailable: this.secureStorageAvailable(),
        openai: secrets.openai ? { configured: true, masked: '••••' + String(secrets.openai.last4 || ''), updated_at: secrets.openai.updated_at } : { configured: false, masked: '' },
        deepseek: secrets.deepseek ? { configured: true, masked: '••••' + String(secrets.deepseek.last4 || ''), updated_at: secrets.deepseek.updated_at } : { configured: false, masked: '' }
      }
    });
  }

  saveSettings(payload) {
    const input = Object.assign({}, payload || {});
    const openaiKey = typeof input.openai_key === 'string' ? input.openai_key : '';
    const deepseekKey = typeof input.deepseek_key === 'string' ? input.deepseek_key : '';
    delete input.openai_key;
    delete input.deepseek_key;
    this.database.saveSettings(input);
    if (openaiKey.trim()) this.saveSecret('openai', openaiKey);
    if (deepseekKey.trim()) this.saveSecret('deepseek', deepseekKey);
    return this.getPublicSettings();
  }

  removeSecret(provider) {
    if (provider !== 'openai' && provider !== 'deepseek') throw new Error('Invalid provider.');
    this.saveSecret(provider, '');
    return this.getPublicSettings();
  }
}

module.exports = {
  SettingsService,
  SAFE_STORAGE_IMPLEMENTATION
};
