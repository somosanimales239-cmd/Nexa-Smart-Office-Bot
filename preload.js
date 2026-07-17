'use strict';

const electron = require('electron');
const contextBridge = electron.contextBridge;
const ipcRenderer = electron.ipcRenderer;

async function invoke(channel, payload) {
  const result = await ipcRenderer.invoke(channel, payload || {});
  if (!result || result.ok !== true) throw new Error(result && result.error ? result.error : 'Operation failed.');
  return result.data;
}

contextBridge.exposeInMainWorld('nexa', Object.freeze({
  app: Object.freeze({
    meta: function meta() { return invoke('app:meta'); },
    health: async function health() {
      const result = await ipcRenderer.invoke('app:health', {});
      if (!result || result.ok !== true) throw new Error(result && result.error ? result.error : 'Health check failed.');
      return result.data;
    }
  }),
  dashboard: Object.freeze({
    summary: function summary() { return invoke('dashboard:summary'); }
  }),
  db: Object.freeze({
    query: function query(name, parameters) { return invoke('db:query', { name: name, parameters: parameters || {} }); }
  }),
  contacts: Object.freeze({
    list: function list(search) { return invoke('contacts:list', { search: search || '' }); },
    create: function create(data) { return invoke('contacts:create', data); },
    update: function update(data) { return invoke('contacts:update', data); },
    delete: function remove(id) { return invoke('contacts:delete', { id: id }); }
  }),
  leads: Object.freeze({
    list: function list(search) { return invoke('leads:list', { search: search || '' }); },
    create: function create(data) { return invoke('leads:create', data); },
    update: function update(data) { return invoke('leads:update', data); },
    delete: function remove(id) { return invoke('leads:delete', { id: id }); }
  }),
  tasks: Object.freeze({
    list: function list(search) { return invoke('tasks:list', { search: search || '' }); },
    create: function create(data) { return invoke('tasks:create', data); },
    update: function update(data) { return invoke('tasks:update', data); },
    complete: function complete(id) { return invoke('tasks:complete', { id: id }); },
    delete: function remove(id) { return invoke('tasks:delete', { id: id }); }
  }),
  appointments: Object.freeze({
    list: function list(search) { return invoke('appointments:list', { search: search || '' }); },
    create: function create(data) { return invoke('appointments:create', data); },
    update: function update(data) { return invoke('appointments:update', data); },
    complete: function complete(id) { return invoke('appointments:complete', { id: id }); },
    delete: function remove(id) { return invoke('appointments:delete', { id: id }); }
  }),
  reminders: Object.freeze({
    list: function list() { return invoke('reminders:list'); },
    create: function create(data) { return invoke('reminders:create', data); },
    toggle: function toggle(id) { return invoke('reminders:toggle', { id: id }); }
  }),
  alerts: Object.freeze({
    refresh: function refresh() { return invoke('alerts:refresh'); },
    list: function list() { return invoke('alerts:refresh'); }
  }),
  activity: Object.freeze({
    list: function list(limit) { return invoke('activity:list', { limit: limit || 100 }); }
  }),
  settings: Object.freeze({
    get: function get() { return invoke('settings:get'); },
    save: function save(data) { return invoke('settings:save', data); },
    testKey: function testKey(provider) { return invoke('settings:test-key', { provider: provider }); },
    removeKey: function removeKey(provider) { return invoke('settings:remove-key', { provider: provider }); }
  }),
  ai: Object.freeze({
    selectProvider: function selectProvider(provider) { return invoke('ai:provider-select', { provider: provider }); },
    testConnection: function testConnection(provider) { return invoke('ai:test-connection', { provider: provider }); },
    generate: function generate(data) { return invoke('ai:generate', data); },
    cancel: function cancel(requestId) { return invoke('ai:cancel', { request_id: requestId }); },
    list: function list(limit) { return invoke('ai:list', { limit: limit || 50 }); },
    saveTask: function saveTask(data) { return invoke('ai:save-task', data); },
    saveNote: function saveNote(data) { return invoke('ai:save-note', data); }
  }),
  backups: Object.freeze({
    list: function list() { return invoke('backup:list'); },
    create: function create() { return invoke('backup:create'); },
    restore: function restore(filePath) { return invoke('backup:restore', { file_path: filePath }); },
    openFolder: function openFolder() { return invoke('backup:open-folder'); }
  })
}));
