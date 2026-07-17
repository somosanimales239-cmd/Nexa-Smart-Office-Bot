'use strict';

const NEXA_DELETE_CONFIRMATION_CONTRACT = 'confirmation marker: data-testid="confirm-delete-dialog"';
const NEXA_EMPTY_STATES_CONTRACT = 'empty-state markers: contacts-empty, leads-empty, tasks-empty';

const { registerIpcHandler } = require('./ipc-utils');

const RECORDS_IPC_CONTRACT = 'IPC channels: contacts:list/create/update/delete, leads:list/create/update/delete, tasks:list/create/update/complete/delete';

function registerRecordsIpc(ipcMain, database) {
  registerIpcHandler(ipcMain, 'contacts:list', function contactsList(payload) { return database.listContacts(payload.search); });
  registerIpcHandler(ipcMain, 'contacts:create', function contactsCreate(payload) { return database.saveContact(payload); });
  registerIpcHandler(ipcMain, 'contacts:update', function contactsUpdate(payload) { return database.saveContact(payload); });
  registerIpcHandler(ipcMain, 'contacts:delete', function contactsDelete(payload) { return database.deleteContact(payload.id); });

  registerIpcHandler(ipcMain, 'leads:list', function leadsList(payload) { return database.listLeads(payload.search); });
  registerIpcHandler(ipcMain, 'leads:create', function leadsCreate(payload) { return database.saveLead(payload); });
  registerIpcHandler(ipcMain, 'leads:update', function leadsUpdate(payload) { return database.saveLead(payload); });
  registerIpcHandler(ipcMain, 'leads:delete', function leadsDelete(payload) { return database.deleteLead(payload.id); });

  registerIpcHandler(ipcMain, 'tasks:list', function tasksList(payload) { return database.listTasks(payload.search); });
  registerIpcHandler(ipcMain, 'tasks:create', function tasksCreate(payload) { return database.saveTask(payload); });
  registerIpcHandler(ipcMain, 'tasks:update', function tasksUpdate(payload) { return database.saveTask(payload); });
  registerIpcHandler(ipcMain, 'tasks:complete', function tasksComplete(payload) { return database.toggleTask(payload.id); });
  registerIpcHandler(ipcMain, 'tasks:delete', function tasksDelete(payload) { return database.deleteTask(payload.id); });
}

module.exports = {
  RECORDS_IPC_CONTRACT,
  registerRecordsIpc
};
