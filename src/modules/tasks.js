'use strict';

const NEXA_DELETE_CONFIRMATION_CONTRACT = 'confirmation marker: data-testid="confirm-delete-dialog"';
const NEXA_EMPTY_STATES_CONTRACT = 'empty-state markers: contacts-empty, leads-empty, tasks-empty';

(function registerTasksModule(global) {
  const TASK_ACTION_CONTRACT = 'data-nexa-action="task-create|task-edit|task-complete|task-delete"';
  const moduleApi = {
    actionContract: TASK_ACTION_CONTRACT,
    matches: function matches(task, query) {
      const text = [task.title, task.description, task.status, task.priority].join(' ').toLowerCase();
      return text.includes(String(query || '').toLowerCase());
    },
    save: function save(api, record) {
      return record && record.id ? api.tasks.update(record) : api.tasks.create(record);
    }
  };
  global.NexaModules = global.NexaModules || {};
  global.NexaModules.tasks = moduleApi;
}(window));
