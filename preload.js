'use strict';

const { contextBridge, ipcRenderer } = require('electron');

const invoke = async (channel, payload = {}) => {
  const result = await ipcRenderer.invoke(channel, payload);
  if (!result?.ok) throw new Error(result?.error || 'Operation failed.');
  return result.data;
};

contextBridge.exposeInMainWorld('nexa', Object.freeze({
  app: Object.freeze({ meta: () => invoke('app:meta') }),
  dashboard: Object.freeze({ summary: () => invoke('dashboard:summary') }),
  contacts: Object.freeze({
    list: (search = '') => invoke('contacts:list', { search }),
    save: (data) => invoke('contacts:save', data),
    delete: (id) => invoke('contacts:delete', { id })
  }),
  leads: Object.freeze({
    list: (search = '') => invoke('leads:list', { search }),
    save: (data) => invoke('leads:save', data),
    delete: (id) => invoke('leads:delete', { id })
  }),
  tasks: Object.freeze({
    list: (search = '') => invoke('tasks:list', { search }),
    save: (data) => invoke('tasks:save', data),
    toggle: (id) => invoke('tasks:toggle', { id }),
    delete: (id) => invoke('tasks:delete', { id })
  }),
  appointments: Object.freeze({
    list: (search = '') => invoke('appointments:list', { search }),
    save: (data) => invoke('appointments:save', data),
    delete: (id) => invoke('appointments:delete', { id })
  }),
  alerts: Object.freeze({ list: () => invoke('alerts:list') }),
  activity: Object.freeze({ list: (limit = 100) => invoke('activity:list', { limit }) }),
  settings: Object.freeze({
    get: () => invoke('settings:get'),
    save: (data) => invoke('settings:save', data),
    removeKey: (provider) => invoke('settings:remove-key', { provider })
  }),
  ai: Object.freeze({
    test: (provider) => invoke('ai:test', { provider }),
    generate: (data) => invoke('ai:generate', data),
    cancel: (requestId) => invoke('ai:cancel', { request_id: requestId }),
    list: (limit = 50) => invoke('ai:list', { limit })
  }),
  backups: Object.freeze({
    list: () => invoke('backups:list'),
    create: () => invoke('backups:create'),
    restore: (filePath) => invoke('backups:restore', { file_path: filePath }),
    openFolder: () => invoke('backups:open-folder')
  })
}));
