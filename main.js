'use strict';

const { app, BrowserWindow, ipcMain, dialog, Notification, safeStorage, shell } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { DatabaseService } = require('./src/database/database');
const { SecretStore } = require('./src/services/secret-store');
const { AIService } = require('./src/services/ai-service');

let mainWindow = null;
let database = null;
let secretStore = null;
let aiService = null;
let notificationTimer = null;

const APP_VERSION = '1.0.0';


if (process.env.NEXA_UI_SMOKE === '1') {
  app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'nexa-smart-office-smoke-')));
} else if (process.env.PORTABLE_EXECUTABLE_DIR) {
  app.setPath('userData', path.join(process.env.PORTABLE_EXECUTABLE_DIR, 'Nexa Smart Office Bot Data'));
}

function serializeError(error) {
  return {
    ok: false,
    error: String(error?.message || error || 'Unknown error').slice(0, 2000)
  };
}

function safeHandler(channel, handler) {
  ipcMain.handle(channel, async (_event, payload) => {
    try {
      return { ok: true, data: await handler(payload || {}) };
    } catch (error) {
      console.error(`[${channel}]`, error);
      return serializeError(error);
    }
  });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1460,
    height: 920,
    minWidth: 1080,
    minHeight: 700,
    show: process.env.NEXA_UI_SMOKE !== '1',
    backgroundColor: '#0b1020',
    center: true,
    autoHideMenuBar: true,
    icon: path.join(__dirname, 'build', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true
    }
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\//i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });

  if (process.env.NEXA_UI_SMOKE === '1') {
    runSmokeWhenReady(mainWindow);
  }

  mainWindow.loadFile(path.join(__dirname, 'src', 'index.html'));

  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith('file://')) event.preventDefault();
  });

}

async function runSmokeWhenReady(window) {
  try {
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Renderer did not finish loading.')), 30000);
      window.webContents.once('did-finish-load', () => {
        clearTimeout(timeout);
        resolve();
      });
    });
    const deadline = Date.now() + 30000;
    let result = null;
    while (Date.now() < deadline) {
      result = await window.webContents.executeJavaScript(`(() => {
        const ready = document.body.dataset.ready === 'true';
        const required = ['nav-dashboard','nav-contacts','nav-leads','nav-agenda','nav-tasks','nav-ai','nav-alerts','nav-settings','app-content'];
        const missing = required.filter(id => !document.querySelector('[data-testid="' + id + '"]'));
        return { ready, missing, title: document.title, errors: window.__NEXA_ERRORS__ || [] };
      })()`);
      if (result.ready) break;
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    const ok = Boolean(result?.ready && result?.missing?.length === 0 && result?.errors?.length === 0);
    console.log(`NEXA_UI_SMOKE:${JSON.stringify({ ok, ...result })}`);
    app.exit(ok ? 0 : 1);
  } catch (error) {
    console.error(`NEXA_UI_SMOKE:${JSON.stringify({ ok: false, error: error.message })}`);
    app.exit(1);
  }
}

function registerIpc() {
  safeHandler('app:meta', () => ({ version: APP_VERSION, platform: process.platform, dataPath: app.getPath('userData') }));
  safeHandler('dashboard:summary', () => database.dashboardSummary());

  safeHandler('contacts:list', ({ search }) => database.listContacts(search));
  safeHandler('contacts:save', (payload) => database.saveContact(payload));
  safeHandler('contacts:delete', ({ id }) => database.deleteContact(id));

  safeHandler('leads:list', ({ search }) => database.listLeads(search));
  safeHandler('leads:save', (payload) => database.saveLead(payload));
  safeHandler('leads:delete', ({ id }) => database.deleteLead(id));

  safeHandler('tasks:list', ({ search }) => database.listTasks(search));
  safeHandler('tasks:save', (payload) => database.saveTask(payload));
  safeHandler('tasks:toggle', ({ id }) => database.toggleTask(id));
  safeHandler('tasks:delete', ({ id }) => database.deleteTask(id));

  safeHandler('appointments:list', ({ search }) => database.listAppointments(search));
  safeHandler('appointments:save', (payload) => database.saveAppointment(payload));
  safeHandler('appointments:delete', ({ id }) => database.deleteAppointment(id));

  safeHandler('alerts:list', () => database.listAlerts());
  safeHandler('activity:list', ({ limit }) => database.listActivity(limit));

  safeHandler('settings:get', () => ({ ...database.getSettings(), secrets: secretStore.publicStatus() }));
  safeHandler('settings:save', (payload) => {
    const { openai_key, deepseek_key, ...publicSettings } = payload;
    database.saveSettings(publicSettings);
    if (typeof openai_key === 'string' && openai_key.trim()) secretStore.save('openai', openai_key);
    if (typeof deepseek_key === 'string' && deepseek_key.trim()) secretStore.save('deepseek', deepseek_key);
    return { ...database.getSettings(), secrets: secretStore.publicStatus() };
  });
  safeHandler('settings:remove-key', ({ provider }) => {
    if (!['openai', 'deepseek'].includes(provider)) throw new Error('Invalid provider.');
    secretStore.save(provider, '');
    return secretStore.publicStatus();
  });

  safeHandler('ai:test', ({ provider }) => aiService.testConnection(provider));
  safeHandler('ai:generate', (payload) => aiService.generate(payload));
  safeHandler('ai:cancel', ({ request_id }) => aiService.cancel(request_id));
  safeHandler('ai:list', ({ limit }) => database.listSuggestions(limit));

  safeHandler('backups:list', () => database.listBackups());
  safeHandler('backups:create', () => {
    const backupDir = path.join(app.getPath('userData'), 'backups');
    const fileName = `nexa-smart-office-${new Date().toISOString().replaceAll(':', '-').replaceAll('.', '-')}.sqlite`;
    const backup = database.createBackup(path.join(backupDir, fileName));
    pruneBackups(backupDir);
    return backup;
  });
  safeHandler('backups:restore', async ({ file_path }) => {
    const backupDir = path.resolve(app.getPath('userData'), 'backups');
    const requested = path.resolve(String(file_path || ''));
    if (!requested.startsWith(`${backupDir}${path.sep}`)) throw new Error('Backup path is outside the managed backup folder.');
    const result = await dialog.showMessageBox(mainWindow, {
      type: 'warning',
      buttons: ['Cancel', 'Restore backup'],
      defaultId: 0,
      cancelId: 0,
      title: 'Restore database backup',
      message: 'Current local data will be replaced. A safety copy will be created first.'
    });
    if (result.response !== 1) return { restored: false, canceled: true };
    return database.restoreBackup(requested);
  });
  safeHandler('backups:open-folder', async () => {
    const backupDir = path.join(app.getPath('userData'), 'backups');
    fs.mkdirSync(backupDir, { recursive: true });
    await shell.openPath(backupDir);
    return true;
  });
}

function pruneBackups(backupDir) {
  const settings = database.getSettings();
  const retention = Math.max(1, Math.min(Number(settings.backup_retention) || 10, 50));
  const files = fs.readdirSync(backupDir)
    .filter((name) => name.endsWith('.sqlite'))
    .map((name) => ({ name, path: path.join(backupDir, name), mtime: fs.statSync(path.join(backupDir, name)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime);
  for (const file of files.slice(retention)) {
    try { fs.unlinkSync(file.path); } catch (_) { /* keep running */ }
  }
}

function startNotificationLoop() {
  const check = () => {
    try {
      const settings = database.getSettings();
      if (settings.notifications_enabled !== '1' || !Notification.isSupported()) return;
      for (const item of database.dueNotifications()) {
        new Notification({ title: item.title, body: item.body, silent: false }).show();
        database.markNotificationSent(item.entity_type, item.id);
      }
    } catch (error) {
      console.error('[notifications]', error);
    }
  };
  check();
  notificationTimer = setInterval(check, 60000);
}

function maybeAutomaticBackup() {
  try {
    const settings = database.getSettings();
    if (settings.automatic_backups !== '1') return;
    const backups = database.listBackups();
    const last = backups[0]?.created_at ? Date.parse(backups[0].created_at) : 0;
    if (Date.now() - last < 24 * 3600000) return;
    const backupDir = path.join(app.getPath('userData'), 'backups');
    const fileName = `automatic-${new Date().toISOString().slice(0, 10)}.sqlite`;
    database.createBackup(path.join(backupDir, fileName));
    pruneBackups(backupDir);
  } catch (error) {
    console.error('[automatic-backup]', error);
  }
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.whenReady().then(() => {
    app.setAppUserModelId('com.nexa.smartofficebot');
    const userData = app.getPath('userData');
    database = new DatabaseService(path.join(userData, 'nexa-smart-office.sqlite'));
    secretStore = new SecretStore(path.join(userData, 'secure', 'secrets.json'), safeStorage);
    aiService = new AIService(database, secretStore);
    registerIpc();
    createWindow();
    startNotificationLoop();
    maybeAutomaticBackup();

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  if (notificationTimer) clearInterval(notificationTimer);
  try { database?.close(); } catch (_) { /* ignore shutdown errors */ }
});
