'use strict';

const NEXA_DELETE_CONFIRMATION_CONTRACT = 'confirmation marker: data-testid="confirm-delete-dialog"';
const NEXA_EMPTY_STATES_CONTRACT = 'empty-state markers: contacts-empty, leads-empty, tasks-empty';

(function registerContactsModule(global) {
  const CONTACT_ACTION_CONTRACT = 'data-nexa-action="contact-create|contact-edit|contact-delete|contact-search"';
  const moduleApi = {
    actionContract: CONTACT_ACTION_CONTRACT,
    matches: function matches(contact, query) {
      const text = [contact.name, contact.company, contact.email, contact.phone, contact.tags].join(' ').toLowerCase();
      return text.includes(String(query || '').toLowerCase());
    },
    save: function save(api, record) {
      return record && record.id ? api.contacts.update(record) : api.contacts.create(record);
    }
  };
  global.NexaModules = global.NexaModules || {};
  global.NexaModules.contacts = moduleApi;
}(window));
