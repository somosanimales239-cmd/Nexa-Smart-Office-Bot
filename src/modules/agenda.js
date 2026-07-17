'use strict';

(function registerAgendaModule(global) {
  const APPOINTMENT_ACTION_CONTRACT = 'data-nexa-action="appointment-create|appointment-edit|appointment-delete|appointment-complete|agenda-day|agenda-week"';
  const REMINDER_ACTION_CONTRACT = 'data-nexa-action="reminder-create|reminder-toggle|alert-refresh"';
  const moduleApi = {
    appointmentContract: APPOINTMENT_ACTION_CONTRACT,
    reminderContract: REMINDER_ACTION_CONTRACT,
    groupByDay: function groupByDay(appointments) {
      return (appointments || []).reduce(function group(result, item) {
        const key = String(item.start_at || '').slice(0, 10);
        if (!result[key]) result[key] = [];
        result[key].push(item);
        return result;
      }, {});
    },
    save: function save(api, record) {
      return record && record.id ? api.appointments.update(record) : api.appointments.create(record);
    }
  };
  global.NexaModules = global.NexaModules || {};
  global.NexaModules.agenda = moduleApi;
}(window));
