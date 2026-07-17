'use strict';

const NEXA_NOTIFICATION_CONTRACT = 'notification marker: new Notification(...)';

(function registerNotificationsModule(global) {
  const NOTIFICATION_ACTION_CONTRACT = 'data-nexa-action="reminder-create|reminder-toggle|alert-refresh"';
  global.NexaModules = global.NexaModules || {};
  global.NexaModules.notifications = {
    actionContract: NOTIFICATION_ACTION_CONTRACT,
    refresh: function refresh(api) { return api.alerts.refresh(); }
  };
}(window));
