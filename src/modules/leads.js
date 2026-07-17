'use strict';

const NEXA_DELETE_CONFIRMATION_CONTRACT = 'confirmation marker: data-testid="confirm-delete-dialog"';
const NEXA_EMPTY_STATES_CONTRACT = 'empty-state markers: contacts-empty, leads-empty, tasks-empty';

(function registerLeadsModule(global) {
  const LEAD_ACTION_CONTRACT = 'data-nexa-action="lead-create|lead-edit|lead-delete|lead-search|lead-status-save"';
  const allowedStatuses = ['New', 'Contacted', 'Interested', 'Follow-up', 'Qualified', 'Won', 'Lost'];
  const moduleApi = {
    actionContract: LEAD_ACTION_CONTRACT,
    statuses: allowedStatuses,
    matches: function matches(lead, query) {
      const text = [lead.name, lead.company, lead.email, lead.phone, lead.status, lead.priority].join(' ').toLowerCase();
      return text.includes(String(query || '').toLowerCase());
    },
    save: function save(api, record) {
      return record && record.id ? api.leads.update(record) : api.leads.create(record);
    }
  };
  global.NexaModules = global.NexaModules || {};
  global.NexaModules.leads = moduleApi;
}(window));
