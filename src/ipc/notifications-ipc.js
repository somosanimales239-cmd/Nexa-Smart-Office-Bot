'use strict';

const { registerIpcHandler } = require('./ipc-utils');

const NOTIFICATION_IPC_CONTRACT = 'IPC channels: notifications:list, notifications:preferences, notifications:save-preferences, notifications:permission, notifications:test, notifications:read, notifications:read-all, notifications:dismiss';

function registerNotificationsIpc(ipcMain, services) {
  const database = services.database;
  const notificationService = services.notificationService;
  const app = services.app;
  const dialog = services.dialog;
  const getMainWindow = services.getMainWindow;

  registerIpcHandler(ipcMain, 'notifications:list', function listNotifications(payload) {
    return {
      items: database.listNotificationEvents(payload.limit || 100, payload.unread_only === true),
      unread: database.countUnreadNotifications(),
      settings: database.getSettings()
    };
  });
  registerIpcHandler(ipcMain, 'notifications:preferences', function notificationPreferences() {
    return database.listNotificationPreferences();
  });
  registerIpcHandler(ipcMain, 'notifications:save-preferences', function saveNotificationPreferences(payload) {
    database.saveNotificationPreferences(payload.preferences || []);
    database.saveSettings(payload.settings || {});
    if (Object.prototype.hasOwnProperty.call(payload.settings || {}, 'notifications_start_with_windows')) {
      const enabled = String(payload.settings.notifications_start_with_windows) === '1';
      app.setLoginItemSettings({ openAtLogin: enabled, openAsHidden: true });
    }
    return {
      preferences: database.listNotificationPreferences(),
      settings: database.getSettings()
    };
  });
  registerIpcHandler(ipcMain, 'notifications:permission', async function requestNotificationPermission() {
    const result = await dialog.showMessageBox(getMainWindow(), {
      type: 'question',
      buttons: ['Not now', 'Allow notifications'],
      defaultId: 1,
      cancelId: 0,
      title: 'Allow Nexa smart notifications?',
      message: 'Nexa can show selected reminders and connected-business changes while the application is running.',
      detail: 'You control every notification category, quiet hours, sound, tray monitoring and Windows startup. You can turn them off at any time.'
    });
    if (result.response !== 1) return { granted: false, canceled: true };
    return notificationService.requestPermission();
  });
  registerIpcHandler(ipcMain, 'notifications:test', function testNotification() {
    return notificationService.testNotification();
  });
  registerIpcHandler(ipcMain, 'notifications:read', function readNotification(payload) {
    database.markNotificationRead(payload.id);
    return true;
  });
  registerIpcHandler(ipcMain, 'notifications:read-all', function readAllNotifications() {
    database.markAllNotificationsRead();
    return true;
  });
  registerIpcHandler(ipcMain, 'notifications:dismiss', function dismissNotification(payload) {
    database.dismissNotification(payload.id);
    return true;
  });
}

module.exports = {
  NOTIFICATION_IPC_CONTRACT,
  registerNotificationsIpc
};
