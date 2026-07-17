'use strict';

const NEXA_BACKUP_CONTRACT = 'backup marker: NEXA_BACKUP_REDACTED_SETTINGS_V1';

const fs = require('node:fs');
const path = require('node:path');

const NEXA_BACKUP_REDACTED_SETTINGS_V1 = 'NEXA_BACKUP_REDACTED_SETTINGS_V1';

class BackupService {
  constructor(database, backupDirectory) {
    this.database = database;
    this.backupDirectory = backupDirectory;
    fs.mkdirSync(backupDirectory, { recursive: true });
  }

  create(label) {
    const prefix = String(label || 'manual').replaceAll(' ', '-').toLowerCase();
    const timestamp = new Date().toISOString().replaceAll(':', '-').replaceAll('.', '-');
    const filePath = path.join(this.backupDirectory, prefix + '-' + timestamp + '.sqlite');
    const result = this.database.createBackup(filePath);
    this.prune();
    return Object.assign({}, result, { marker: NEXA_BACKUP_REDACTED_SETTINGS_V1 });
  }

  list() {
    return this.database.listBackups();
  }

  restore(filePath) {
    const root = path.resolve(this.backupDirectory);
    const requested = path.resolve(String(filePath || ''));
    if (!requested.startsWith(root + path.sep)) throw new Error('Backup path is outside the managed backup folder.');
    return this.database.restoreBackup(requested);
  }

  prune() {
    const settings = this.database.getSettings();
    const retention = Math.max(1, Math.min(Number(settings.backup_retention) || 10, 50));
    const files = fs.readdirSync(this.backupDirectory)
      .filter(function filterFile(name) { return name.endsWith('.sqlite'); })
      .map(function mapFile(name) {
        const filePath = path.join(this.backupDirectory, name);
        return { path: filePath, modified: fs.statSync(filePath).mtimeMs };
      }, this)
      .sort(function sortFiles(left, right) { return right.modified - left.modified; });
    files.slice(retention).forEach(function removeFile(file) {
      try { fs.unlinkSync(file.path); } catch (error) { void error; }
    });
  }
}

module.exports = {
  BackupService,
  NEXA_BACKUP_REDACTED_SETTINGS_V1
};
