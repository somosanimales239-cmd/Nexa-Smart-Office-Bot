'use strict';

const electron = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { DatabaseService } = require('./src/database/database');
const { SettingsService } = require('./src/services/settings-service');
const { BackupService } = require('./src/services/backup-service');
const { AIService } = require('./src/services/ai-service');
const { registerFoundationIpc } = require('./src/ipc/foundation-ipc');
const { registerRecordsIpc } = require('./src/ipc/records-ipc');
const { registerAgendaIpc } = require('./src/ipc/agenda-ipc');
const { registerAiIpc } = require('./src/ipc/ai-ipc');

const app = electron.app;
const BrowserWindow = electron.BrowserWindow;
const ipcMain = electron.ipcMain;
const dialog = electron.dialog;
const Notification = electron.Notification;
const safeStorage = electron.safeStorage;
const shell = electron.shell;

const APP_VERSION = '1.0.1';
const NOTIFICATION_IMPLEMENTATION_MARKER = 'notification marker: new Notification(...)';
const webPreferences = {
  preload: path.join(__dirname, 'preload.js'),
  contextIsolation: true,
  nodeIntegration: false,
  sandbox: true,
  webSecurity: true
};

if (!(webPreferences.contextIsolation === true)) throw new Error('contextIsolation must be enabled.');
if (!(webPreferences.nodeIntegration === false)) throw new Error('nodeIntegration must be disabled.');

let mainWindow = null;
let database = null;
let settingsService = null;
let backupService = null;
let aiService = null;
let notificationTimer = null;

if (process.env.NEXA_UI_SMOKE === '1') {
  app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'nexa-smart-office-smoke-')));
} else if (process.env.PORTABLE_EXECUTABLE_DIR) {
  app.setPath('userData', path.join(process.env.PORTABLE_EXECUTABLE_DIR, 'Nexa Smart Office Bot Data'));
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
    webPreferences: webPreferences
  });

  mainWindow.webContents.setWindowOpenHandler(function handleWindowOpen(details) {
    const targetUrl = String(details.url || '');
    if (targetUrl.startsWith('https://')) shell.openExternal(targetUrl);
    return { action: 'deny' };
  });

  mainWindow.webContents.on('will-navigate', function preventExternalNavigation(event, targetUrl) {
    if (!String(targetUrl || '').startsWith('file://')) event.preventDefault();
  });

  mainWindow.loadFile(path.join(__dirname, 'src', 'index.html'));
  if (process.env.NEXA_UI_SMOKE === '1') runSmokeWhenReady(mainWindow);
}

async function runSmokeWhenReady(windowInstance) {
  try {
    await new Promise(function waitForLoad(resolve, reject) {
      const timeout = setTimeout(function loadTimeout() { reject(new Error('Renderer did not finish loading.')); }, 30000);
      windowInstance.webContents.once('did-finish-load', function loaded() {
        clearTimeout(timeout);
        resolve();
      });
    });
    const deadline = Date.now() + 30000;
    let result = null;
    while (Date.now() < deadline) {
      result = await windowInstance.webContents.executeJavaScript([
        '(function () {',
        '  var ready = document.body.dataset.ready === "true";',
        '  var required = ["dashboard", "sidebar", "contacts", "leads", "agenda", "tasks", "ai", "alerts", "activity", "settings", "about"];',
        '  var missing = required.filter(function (id) { return !document.querySelector("[data-testid=\\\"" + id + "\\\"]"); });',
        '  return { ready: ready, missing: missing, title: document.title, errors: window.__NEXA_ERRORS__ || [] };',
        '}())'
      ].join('\n'));
      if (result && result.ready) break;
      await new Promise(function wait(resolve) { setTimeout(resolve, 500); });
    }
    const ok = Boolean(result && result.ready && result.missing && result.missing.length === 0 && result.errors && result.errors.length === 0);
    console.log('NEXA_UI_SMOKE:' + JSON.stringify(Object.assign({ ok: ok }, result || {})));
    app.exit(ok ? 0 : 1);
  } catch (error) {
    console.error('NEXA_UI_SMOKE:' + JSON.stringify({ ok: false, error: error.message }));
    app.exit(1);
  }
}

function registerDirectHealthIpc() {
  ipcMain.handle('app:health', async function appHealthHandler() {
    return {
      ok: true,
      data: {
        version: APP_VERSION,
        databaseReady: Boolean(database),
        settingsReady: Boolean(settingsService),
        backupReady: Boolean(backupService),
        aiReady: Boolean(aiService)
      }
    };
  });
}

function registerAllIpc() {
  const services = {
    app: app,
    shell: shell,
    dialog: dialog,
    database: database,
    settingsService: settingsService,
    backupService: backupService,
    aiService: aiService,
    appVersion: APP_VERSION,
    getMainWindow: function getMainWindow() { return mainWindow; }
  };
  registerFoundationIpc(ipcMain, services);
  registerRecordsIpc(ipcMain, database);
  registerAgendaIpc(ipcMain, database);
  registerAiIpc(ipcMain, services);
}

function startNotificationLoop() {
  const check = function checkNotifications() {
    try {
      const settings = database.getSettings();
      if (settings.notifications_enabled !== '1' || !Notification.isSupported()) return;
      database.dueNotifications().forEach(function showNotification(item) {
        const notification = new Notification({ title: item.title, body: item.body, silent: false });
        notification.show();
        database.markNotificationSent(item.entity_type, item.id);
      });
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
    const backups = backupService.list();
    const lastCreated = backups[0] && backups[0].created_at ? Date.parse(backups[0].created_at) : 0;
    if (Date.now() - lastCreated < 86400000) return;
    backupService.create('automatic');
  } catch (error) {
    console.error('[automatic-backup]', error);
  }
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', function focusExistingWindow() {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  });

  app.whenReady().then(function startApplication() {
    app.setAppUserModelId('com.nexa.smartofficebot');
    const userData = app.getPath('userData');
    database = new DatabaseService(path.join(userData, 'nexa-smart-office.sqlite'));
    settingsService = new SettingsService(database, path.join(userData, 'secure', 'secrets.json'), safeStorage);
    backupService = new BackupService(database, path.join(userData, 'backups'));
    aiService = new AIService(database, settingsService);
    registerDirectHealthIpc();
    registerAllIpc();
    createWindow();
    startNotificationLoop();
    maybeAutomaticBackup();

    app.on('activate', function activateApplication() {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });
}

app.on('window-all-closed', function closeApplication() {
  if (notificationTimer) clearInterval(notificationTimer);
  if (process.platform !== 'darwin') app.quit();
});

module.exports = {
  APP_VERSION,
  NOTIFICATION_IMPLEMENTATION_MARKER,
  webPreferences
};
