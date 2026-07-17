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
  }),
  integration: Object.freeze({
    get: function get() { return invoke('integration:get'); },
    inspector: function inspector() { return invoke('integration:inspector'); },
    items: function items(resource, search, limit) { return invoke('integration:items', { resource: resource, search: search || '', limit: limit || 100 }); },
    save: function save(data) { return invoke('integration:save', data); },
    test: function test() { return invoke('integration:test'); },
    sync: function sync() { return invoke('integration:sync'); },
    resource: function resource(name, query) { return invoke('integration:resource', { resource: name, query: query || {} }); },
    disconnect: function disconnect() { return invoke('integration:disconnect'); }
  }),
  messages: Object.freeze({
    thread: function thread(threadId, limit) { return invoke('messages:thread', { thread_id: threadId, limit: limit || 120 }); },
    refresh: function refresh(threadId, options) { return invoke('messages:refresh', Object.assign({ thread_id: threadId }, options || {})); },
    draft: function draft(data) { return invoke('messages:draft', data || {}); },
    send: function send(data) { return invoke('messages:send', data || {}); },
    markRead: function markRead(threadId, lastMessageId) { return invoke('messages:mark-read', { thread_id: threadId, last_message_id: lastMessageId || null }); },
    knowledgeList: function knowledgeList(search) { return invoke('messages:knowledge-list', { search: search || '' }); },
    knowledgeSave: function knowledgeSave(data) { return invoke('messages:knowledge-save', data || {}); },
    knowledgeToggle: function knowledgeToggle(id, enabled) { return invoke('messages:knowledge-toggle', { id: id, enabled: enabled }); },
    knowledgeSummary: function knowledgeSummary() { return invoke('messages:knowledge-summary'); },
    knowledgeDelete: function knowledgeDelete(id) { return invoke('messages:knowledge-delete', { id: id }); }
  }),
  notifications: Object.freeze({
    list: function list(limit, unreadOnly) { return invoke('notifications:list', { limit: limit || 100, unread_only: unreadOnly === true }); },
    preferences: function preferences() { return invoke('notifications:preferences'); },
    savePreferences: function savePreferences(preferences, settings) { return invoke('notifications:save-preferences', { preferences: preferences || [], settings: settings || {} }); },
    requestPermission: function requestPermission() { return invoke('notifications:permission'); },
    test: function test() { return invoke('notifications:test'); },
    read: function read(id) { return invoke('notifications:read', { id: id }); },
    readAll: function readAll() { return invoke('notifications:read-all'); },
    dismiss: function dismiss(id) { return invoke('notifications:dismiss', { id: id }); },
    onNew: function onNew(callback) {
      if (typeof callback !== 'function') return function noop() {};
      const listener = function listener(event, payload) { callback(payload); };
      ipcRenderer.on('notification:new', listener);
      return function unsubscribe() { ipcRenderer.removeListener('notification:new', listener); };
    },
    onOpen: function onOpen(callback) {
      if (typeof callback !== 'function') return function noop() {};
      const eventListener = function eventListener(event, payload) { callback(payload); };
      const centerListener = function centerListener() { callback({ openCenter: true }); };
      ipcRenderer.on('notification:open', eventListener);
      ipcRenderer.on('notification:open-center', centerListener);
      return function unsubscribe() {
        ipcRenderer.removeListener('notification:open', eventListener);
        ipcRenderer.removeListener('notification:open-center', centerListener);
      };
    }
  })
}));
