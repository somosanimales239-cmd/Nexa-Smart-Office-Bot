'use strict';

const electron = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { DatabaseService } = require('./src/database/database');
const { SettingsService } = require('./src/services/settings-service');
const { BackupService } = require('./src/services/backup-service');
const { AIService } = require('./src/services/ai-service');
const { AutoMarketApiService } = require('./src/services/automarket-api-service');
const { NotificationService } = require('./src/services/notification-service');
const { AutomaticActionsService } = require('./src/services/automatic-actions-service');
const { registerFoundationIpc } = require('./src/ipc/foundation-ipc');
const { registerRecordsIpc } = require('./src/ipc/records-ipc');
const { registerAgendaIpc } = require('./src/ipc/agenda-ipc');
const { registerAiIpc } = require('./src/ipc/ai-ipc');
const { registerIntegrationsIpc } = require('./src/ipc/integrations-ipc');
const { registerNotificationsIpc } = require('./src/ipc/notifications-ipc');
const { registerMessagesIpc } = require('./src/ipc/messages-ipc');
const { registerAutomationIpc } = require('./src/ipc/automation-ipc');

const app = electron.app;
const BrowserWindow = electron.BrowserWindow;
const ipcMain = electron.ipcMain;
const dialog = electron.dialog;
const Notification = electron.Notification;
const safeStorage = electron.safeStorage;
const shell = electron.shell;
const Tray = electron.Tray;
const Menu = electron.Menu;
const nativeImage = electron.nativeImage;

const APP_VERSION = '1.6.11';
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
let apiService = null;
let notificationService = null;
let automationService = null;
let tray = null;
let isQuitting = false;

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
    show: process.env.NEXA_UI_SMOKE !== '1' && !process.argv.includes('--hidden'),
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
  mainWindow.on('close', function keepNotificationsRunning(event) {
    if (isQuitting || process.env.NEXA_UI_SMOKE === '1') return;
    const settings = database ? database.getSettings() : {};
    if ((settings.notifications_minimize_to_tray === '1' && settings.notifications_enabled === '1') || settings.auto_actions_enabled === '1') {
      event.preventDefault();
      mainWindow.hide();
      if (tray) tray.displayBalloon({
        title: 'Nexa Smart Office Bot is still running',
        content: settings.auto_actions_enabled === '1' ? 'Authorized automatic actions remain active in the system tray.' : 'Smart notifications remain active in the system tray.',
        iconType: 'info'
      });
    }
  });
  if (process.env.NEXA_UI_SMOKE === '1') runSmokeWhenReady(mainWindow);
}

function showMainWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) createWindow();
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

function createTray() {
  if (tray || process.env.NEXA_UI_SMOKE === '1') return;
  const icon = nativeImage.createFromPath(path.join(__dirname, 'build', 'icon.png')).resize({ width: 20, height: 20 });
  tray = new Tray(icon);
  tray.setToolTip('Nexa Smart Office Bot');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Open Nexa Smart Office Bot', click: showMainWindow },
    { label: 'Open Smart Notifications', click: function openNotifications() {
      showMainWindow();
      if (mainWindow) mainWindow.webContents.send('notification:open-center');
    } },
    { type: 'separator' },
    { label: 'Quit', click: function quitFromTray() { isQuitting = true; app.quit(); } }
  ]));
  tray.on('double-click', showMainWindow);
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
        '  var required = ["dashboard", "sidebar", "connected-business", "api-sync-inspector", "contacts", "leads", "agenda", "tasks", "ai", "alerts", "smart-notifications", "activity", "settings", "ai-control", "about"];',
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
        aiReady: Boolean(aiService),
        apiReady: Boolean(apiService),
        notificationsReady: Boolean(notificationService),
        automationReady: Boolean(automationService)
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
    apiService: apiService,
    notificationService: notificationService,
    automationService: automationService,
    nativeImage: nativeImage,
    appVersion: APP_VERSION,
    getMainWindow: function getMainWindow() { return mainWindow; }
  };
  registerFoundationIpc(ipcMain, services);
  registerRecordsIpc(ipcMain, database);
  registerAgendaIpc(ipcMain, database);
  registerAiIpc(ipcMain, services);
  registerIntegrationsIpc(ipcMain, services);
  registerNotificationsIpc(ipcMain, services);
  registerMessagesIpc(ipcMain, services);
  registerAutomationIpc(ipcMain, services);
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
    showMainWindow();
  });

  app.whenReady().then(function startApplication() {
    app.setAppUserModelId('com.nexa.smartofficebot');
    const userData = app.getPath('userData');
    database = new DatabaseService(path.join(userData, 'nexa-smart-office.sqlite'));
    settingsService = new SettingsService(database, path.join(userData, 'secure', 'secrets.json'), safeStorage);
    backupService = new BackupService(database, path.join(userData, 'backups'));
    aiService = new AIService(database, settingsService);
    apiService = new AutoMarketApiService(settingsService);
    notificationService = new NotificationService({
      database: database,
      settingsService: settingsService,
      apiService: apiService,
      Notification: Notification,
      nativeImage: nativeImage,
      app: app,
      getMainWindow: function getMainWindow() { return mainWindow; },
      iconPath: path.join(__dirname, 'src', 'assets', 'nexa-ai-orb.png')
    });
    automationService = new AutomaticActionsService({
      database: database,
      settingsService: settingsService,
      apiService: apiService,
      aiService: aiService,
      notificationService: notificationService
    });
    registerDirectHealthIpc();
    registerAllIpc();
    createWindow();
    createTray();
    notificationService.start();
    automationService.start();
    maybeAutomaticBackup();

    app.on('activate', function activateApplication() {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });
}

app.on('before-quit', function beforeQuit() {
  isQuitting = true;
  if (automationService) automationService.stop();
  if (notificationService) notificationService.stop();
});

app.on('window-all-closed', function closeApplication() {
  const settings = database ? database.getSettings() : {};
  const keepRunning = (settings.notifications_minimize_to_tray === '1' && settings.notifications_enabled === '1') || settings.auto_actions_enabled === '1';
  if (process.platform !== 'darwin' && !keepRunning) app.quit();
});

module.exports = {
  APP_VERSION,
  NOTIFICATION_IMPLEMENTATION_MARKER,
  webPreferences
};
