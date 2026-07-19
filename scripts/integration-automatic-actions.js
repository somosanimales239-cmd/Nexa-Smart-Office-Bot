'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DatabaseService } = require('../src/database/database');
const { AutomaticActionsService, parseRequestedDateTime, safeDeferredKnowledge } = require('../src/services/automatic-actions-service');
const { registerAutomationIpc } = require('../src/ipc/automation-ipc');

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'nexa-auto-actions-'));
const database = new DatabaseService(path.join(temp, 'workspace.sqlite'));
let sentMessages = [];
let currentThread = null;
let availabilityPayload = { slots: [] };
let availabilityFailure = false;
const apiService = {
  async fetchResource(resource) {
    if (resource !== 'messages') throw new Error('Unsupported test resource: ' + resource);
    return { payload: { threads: database.listIntegrationCache('messages', '', 100) } };
  },
  async fetchMessageThread(threadId) {
    return { status: 200, durationMs: 1, receivedAt: new Date().toISOString(), payload: currentThread(threadId) };
  },
  async sendMessage(threadId, body, clientId) {
    sentMessages.push({ threadId, body, clientId });
    return { payload: { message_id: 'remote-' + sentMessages.length, thread_id: threadId, body, direction: 'outbound', sent_at: new Date().toISOString(), status: 'sent' } };
  },
  async markMessageRead() { return { payload: { status: 'read' } }; },
  async fetchDealerAppointmentAvailability() { if (availabilityFailure) throw new Error('availability endpoint unavailable'); return { payload: availabilityPayload }; },
  async createRemoteAppointment() { return { payload: { appointment_id: 'remote-appt-1' } }; }
};
const settingsService = {
  getPublicSettings() { return Object.assign({ preferred_provider: 'openai' }, database.getSettings()); }
};
const aiService = {
  messageEngine: {
    match(conversation) {
      const latest = conversation.messages[conversation.messages.length - 1];
      return {
        matched: true, confidence: 0.97, latestMessage: latest.body, knowledgeId: 'test-knowledge',
        label: 'Availability response', category: 'Inventory', intentKey: 'inventory_question', locale: 'en',
        dealerSegment: 'used-auto', safetyLevel: 'standard', requiredContext: [], response: 'Yes, I can help you with that.'
      };
    }
  },
  async generateMessageReply(input) {
    const draft = database.saveMessageDraft({ thread_id: input.thread_id, source: 'ai', provider: 'openai', body: 'AI reply' });
    return { engine: 'ai', provider: 'openai', draft };
  }
};
const notifications = [];
const notificationService = {
  createNotification(input) { notifications.push(input); return { id: 'notice-' + notifications.length }; },
  async deliverPending() { return true; }
};
const service = new AutomaticActionsService({ database, settingsService, apiService, aiService, notificationService });

function saveBaseSettings(extra) {
  database.saveSettings(Object.assign({
    auto_actions_enabled: '1', auto_actions_consent_at: new Date().toISOString(), auto_actions_run_interval_seconds: '15',
    auto_messages_enabled: '1', messages_ai_enabled: '1', auto_messages_knowledge_only: '1', auto_messages_ai_fallback: '0',
    auto_messages_min_confidence: '0.88', auto_messages_send_delay_seconds: '0', auto_messages_max_per_hour: '20',
    auto_messages_max_per_day: '100', auto_messages_quiet_start: '00:00', auto_messages_quiet_end: '00:00',
    auto_messages_languages: 'en,es', auto_messages_require_unread: '1', auto_messages_mark_read: '1',
    auto_messages_allowed_safety: 'standard', auto_messages_excluded_intents: 'legal_issue,emergency_issue,complaint,refund_dispute,payment_dispute,financing_approval',
    auto_appointments_enabled: '0', auto_appointments_offer_slots: '1', auto_appointments_duration_minutes: '30',
    auto_appointments_min_notice_hours: '0', auto_appointments_max_days: '60', auto_appointments_require_contact: '1',
    auto_appointments_create_remote: '0', auto_appointments_send_confirmation: '0', auto_appointments_slot_limit: '50',
    auto_actions_no_delete_guard: '1'
  }, extra || {}));
}

async function run() {
  assert.equal(safeDeferredKnowledge({ requiredContext: ['inventory'], response: 'I will verify current availability for you.' }), true);
  assert.equal(safeDeferredKnowledge({ requiredContext: ['inventory'], response: 'It is guaranteed available now.' }), false);
  assert.equal(database.getSettings().auto_actions_enabled, '0', 'Automation must default to disabled.');
  assert.equal(database.getSettings().auto_actions_no_delete_guard, '1');
  assert.equal(typeof service.deleteContact, 'undefined');
  assert.equal(typeof service.deleteLead, 'undefined');
  assert.equal(typeof service.deleteAppointment, 'undefined');

  const handlers = {};
  registerAutomationIpc({ handle(channel, handler) { handlers[channel] = handler; } }, { database, automationService: service });
  const denied = await handlers['automation:save']({}, { settings: { auto_actions_enabled: '1' }, user_authorized: false });
  assert.equal(denied.ok, false);
  assert.match(denied.error, /authorization/i);

  const contactsBefore = database.listContacts().length;
  const leadsBefore = database.listLeads().length;
  saveBaseSettings();
  database.replaceIntegrationCache('messages', [{ thread_id: 'thread-1', subject: 'Availability', unread_count: 1, can_reply: 1, is_announcement: 0, last_message_at: new Date().toISOString() }]);
  currentThread = function threadOne(threadId) {
    return {
      thread: { thread_id: threadId, subject: 'Availability', participant_name: 'Customer One', can_reply: 1, is_announcement: 0 },
      messages: [{ message_id: 'inbound-1', thread_id: threadId, direction: 'inbound', sender_type: 'customer', sender_name: 'Customer One', body: 'Is this vehicle available?', sent_at: new Date(Date.now() - 60000).toISOString(), is_read: 0 }]
    };
  };
  const first = await service.runNow('test-message');
  assert.equal(first.cycle_skipped, false);
  assert.equal(first.messages_sent, 1);
  assert.equal(first.skipped_count, 0);
  assert.equal(sentMessages.length, 1);
  assert.equal(sentMessages[0].body, 'Yes, I can help you with that.');
  assert.equal(database.listAutomaticActionEvents(10)[0].status, 'completed');
  const duplicate = await service.runNow('test-duplicate');
  assert.equal(sentMessages.length, 1, 'Automatic response must be idempotent.');
  assert.equal(database.listContacts().length, contactsBefore, 'Automation must never change contacts.');
  assert.equal(database.listLeads().length, leadsBefore, 'Automation must never change leads.');
  assert.equal(duplicate.cycle_skipped, false, 'A completed cycle with no work must not be reported as not ready.');
  assert.equal(duplicate.no_work_reason, 'no_unread_replyable_messages');

  saveBaseSettings({ messages_ai_enabled: '0' });
  database.replaceIntegrationCache('messages', [{ thread_id: 'thread-switch', subject: 'Switch', unread_count: 1, can_reply: 1, is_announcement: 0, last_message_at: new Date().toISOString() }]);
  currentThread = function threadSwitch(threadId) {
    return { thread: { thread_id: threadId, subject: 'Switch', participant_name: 'Customer Switch', can_reply: 1, is_announcement: 0 }, messages: [{ message_id: 'inbound-switch', thread_id: threadId, direction: 'inbound', sender_type: 'customer', body: 'Is it available?', sent_at: new Date(Date.now() - 60000).toISOString(), is_read: 0 }] };
  };
  const switchOff = await service.runNow('test-message-switch-off');
  assert.equal(switchOff.messages_sent, 0);
  assert.equal(switchOff.reason_counts.messages_ai_switch_off, 1, 'Messages AI switch must block automatic sends while continuing to process the inbox.');

  saveBaseSettings({ messages_ai_enabled: '1' });
  database.replaceIntegrationCache('messages', [{ thread_id: 'thread-blocked', subject: 'Blocked thread', unread_count: 1, can_reply: 1, is_announcement: 0, last_message_at: new Date().toISOString() }]);
  currentThread = function threadBlocked(threadId) {
    return { thread: { thread_id: threadId, subject: 'Blocked thread', participant_name: 'Customer Blocked', can_reply: 1, is_announcement: 0 }, messages: [{ message_id: 'inbound-blocked', thread_id: threadId, direction: 'inbound', sender_type: 'customer', body: 'Is it available?', sent_at: new Date(Date.now() - 60000).toISOString(), is_read: 0 }] };
  };
  await service.refreshCandidateThreads(database.getSettings());
  database.setMessageThreadAutomationBlocked('thread-blocked', true, 'Test block');
  const blockedThread = await service.runNow('test-thread-blocked');
  assert.equal(blockedThread.messages_sent, 0);
  assert.equal(blockedThread.reason_counts.thread_auto_reply_blocked, 1, 'Per-thread block must prevent automatic replies without deleting the conversation.');
  assert.equal(database.getMessageConversationContext('thread-blocked', 10).messages.length, 1, 'Blocked threads must still be read and cached.');

  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(10, 0, 0, 0);
  const dateText = String(tomorrow.getMonth() + 1).padStart(2, '0') + '/' + String(tomorrow.getDate()).padStart(2, '0') + '/' + tomorrow.getFullYear();
  const parsed = parseRequestedDateTime('Can I schedule an appointment on ' + dateText + ' at 10:00 AM?', new Date());
  assert.equal(parsed.exact, true);
  assert.equal(parsed.date.getHours(), 10);
  availabilityFailure = true;
  database.replaceIntegrationCache('resellers', [{ reseller_id: 'reseller-availability', dealer_appointment_availability: [{ slot_id: 'nested-slot', start_at: tomorrow.toISOString(), available: true, duration_minutes: 30 }] }]);
  const nestedSlots = await service.cacheAvailability(database.getSettings());
  assert.equal(nestedSlots.length, 1, 'Dealer Appointment Availability embedded in reseller data must remain usable.');
  availabilityFailure = false;
  sentMessages = [];
  availabilityPayload = { slots: [{ slot_id: 'slot-1', start_at: tomorrow.toISOString(), available: true, duration_minutes: 30, location: 'Main dealership' }] };
  saveBaseSettings({ auto_messages_enabled: '0', auto_appointments_enabled: '1' });
  database.replaceIntegrationCache('messages', [{ thread_id: 'thread-2', subject: 'Appointment', unread_count: 1, can_reply: 1, is_announcement: 0, last_message_at: new Date().toISOString() }]);
  currentThread = function threadTwo(threadId) {
    return {
      thread: { thread_id: threadId, subject: 'Appointment', participant_name: 'Customer Two', customer_phone: '2395550100', can_reply: 1, is_announcement: 0 },
      messages: [{ message_id: 'inbound-2', thread_id: threadId, direction: 'inbound', sender_type: 'customer', sender_name: 'Customer Two', body: 'Can I schedule an appointment on ' + dateText + ' at 10:00 AM?', sent_at: new Date(Date.now() - 60000).toISOString(), is_read: 0 }]
    };
  };
  const appointmentResult = await service.runNow('test-appointment');
  assert.equal(appointmentResult.appointments_created, 1);
  const appointments = database.listAppointments('Customer Two');
  assert.equal(appointments.length, 1);
  assert.equal(appointments[0].source_type, 'automatic-message');
  assert.equal(appointments[0].source_id, 'inbound-2');
  assert.equal(appointments[0].created_by, 'nexa-automatic-actions');
  await service.runNow('test-appointment-duplicate');
  assert.equal(database.listAppointments('Customer Two').length, 1, 'Automatic appointment must not duplicate.');

  const state = service.getState();
  assert.equal(state.invariants.never_changes_customer_records, true);
  assert.equal(state.invariants.never_deletes_data, true);
  assert.ok(notifications.length >= 2);
  database.close();
  fs.rmSync(temp, { recursive: true, force: true });
  console.log('Guarded automatic actions integration tests passed.');
}

run().catch(function failed(error) {
  try { database.close(); } catch (_) { /* ignore */ }
  fs.rmSync(temp, { recursive: true, force: true });
  console.error(error);
  process.exit(1);
});
