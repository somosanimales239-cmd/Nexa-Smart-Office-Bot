'use strict';

const NEXA_NOTIFICATION_CONTRACT = 'notification marker: new Notification(...)';

const { registerIpcHandler } = require('./ipc-utils');

const AGENDA_IPC_CONTRACT = 'IPC channels: appointments:list/create/update/delete/complete, reminders:list/create/toggle, alerts:refresh';

function registerAgendaIpc(ipcMain, database) {
  registerIpcHandler(ipcMain, 'appointments:list', function appointmentsList(payload) { return database.listAppointments(payload.search); });
  registerIpcHandler(ipcMain, 'appointments:create', function appointmentsCreate(payload) { return database.saveAppointment(payload); });
  registerIpcHandler(ipcMain, 'appointments:update', function appointmentsUpdate(payload) { return database.saveAppointment(payload); });
  registerIpcHandler(ipcMain, 'appointments:delete', function appointmentsDelete(payload) { return database.deleteAppointment(payload.id); });
  registerIpcHandler(ipcMain, 'appointments:complete', function appointmentsComplete(payload) {
    const appointments = database.listAppointments('');
    const record = appointments.find(function findRecord(item) { return item.id === payload.id; });
    if (!record) throw new Error('Appointment not found.');
    return database.saveAppointment(Object.assign({}, record, { status: 'Completed' }));
  });
  registerIpcHandler(ipcMain, 'reminders:list', function remindersList() { return database.listReminders(); });
  registerIpcHandler(ipcMain, 'reminders:create', function remindersCreate(payload) { return database.saveReminder(payload); });
  registerIpcHandler(ipcMain, 'reminders:toggle', function remindersToggle(payload) { return database.toggleReminder(payload.id); });
  registerIpcHandler(ipcMain, 'alerts:refresh', function alertsRefresh() { return database.listAlerts(); });
}

module.exports = {
  AGENDA_IPC_CONTRACT,
  registerAgendaIpc
};
