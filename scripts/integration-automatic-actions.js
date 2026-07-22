'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DatabaseService } = require('../src/database/database');
const { AutomaticActionsService, NEXA_APPOINTMENT_BARE_ACCEPTANCE_GUARD_V1, NEXA_APPOINTMENT_CONTACT_CONTEXT_V3, NEXA_APPOINTMENT_PAGE_V7_SYNC_V1, NEXA_APPOINTMENT_PAGE_V8_SYNC_V1, NEXA_APPOINTMENT_REMOTE_COMMIT_VERIFICATION_V1, NEXA_PREBOOK_CONTACT_CHECKPOINT_V1, NEXA_STRUCTURED_APPOINTMENT_CONTACT_FORM_V1, appointmentContactRequest, appointmentContactReviewForm, contactFromConversation, extractCustomerContact, hasRecentAppointmentOffer, isShortAppointmentAcceptance, parseRequestedDateTime, safeDeferredKnowledge, usableCustomerName } = require('../src/services/automatic-actions-service');
const { MessageResponseEngine } = require('../src/services/message-response-engine');
const { registerAutomationIpc } = require('../src/ipc/automation-ipc');

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'nexa-auto-actions-'));
const database = new DatabaseService(path.join(temp, 'workspace.sqlite'));
let sentMessages = [];
let remoteMessageSequence = 0;
let currentThread = null;
let availabilityPayload = { slots: [] };
let availabilityFailure = false;
let lastAvailabilityQuery = null;
let availabilityFetchCount = 0;
let calendarFetchCount = 0;
let leadsFetchCount = 0;
let agendaFetchCount = 0;
let calendarPayload = { stores: [], appointment_count: 0, verified_open_slots: 0 };
let remoteOrdersPayload = [];
let remoteAgendaPayload = [];
let remoteAppointmentBody = null;
let remoteAppointmentFailure = null;
let remoteReservationMode = 'complete';
const apiService = {
  async fetchResource(resource) {
    if (resource === 'messages') return { payload: { threads: database.listIntegrationCache('messages', '', 100) } };
    if (resource === 'orders') {
      leadsFetchCount += 1;
      return { status: 200, durationMs: 1, receivedAt: new Date().toISOString(), payload: remoteOrdersPayload };
    }
    if (resource === 'agenda') {
      agendaFetchCount += 1;
      return { status: 200, durationMs: 1, receivedAt: new Date().toISOString(), payload: remoteAgendaPayload };
    }
    throw new Error('Unsupported test resource: ' + resource);
  },
  async fetchMessageThread(threadId) {
    return { status: 200, durationMs: 1, receivedAt: new Date().toISOString(), payload: currentThread(threadId) };
  },
  async sendMessage(threadId, body, clientId) {
    sentMessages.push({ threadId, body, clientId });
    remoteMessageSequence += 1;
    return { payload: { message_id: 'remote-' + remoteMessageSequence, thread_id: threadId, body, direction: 'outbound', sent_at: new Date().toISOString(), status: 'sent' } };
  },
  async markMessageRead() { return { payload: { status: 'read' } }; },
  async fetchDealerAppointmentAvailability(query) { availabilityFetchCount += 1; lastAvailabilityQuery = query; if (availabilityFailure) throw new Error('availability endpoint unavailable'); return { status: 200, durationMs: 1, receivedAt: new Date().toISOString(), payload: availabilityPayload }; },
  async fetchDealerAgendaCalendar() { calendarFetchCount += 1; return { payload: calendarPayload }; },
  async createRemoteAppointment(payload) {
    remoteAppointmentBody = payload;
    if (remoteAppointmentFailure) {
      const failure = remoteAppointmentFailure;
      remoteAppointmentFailure = null;
      if (failure.availability) availabilityPayload = failure.availability;
      if (failure.calendar) calendarPayload = failure.calendar;
      const error = new Error(failure.message || 'That appointment slot is already booked.');
      error.status = failure.status || 409;
      throw error;
    }
    if (remoteReservationMode === 'lead-only') {
      remoteOrdersPayload = [{ id: 'ord-partial-only', order_id: 'ord-partial-only', name: payload.customer_name, phone: payload.customer_phone, status: 'new', source_label: 'Nexa Smart Office Bot' }];
      return { raw: { ok: true, resource: 'appointment-create' }, payload: { order_id: 'ord-partial-only', lead_id: 'ord-partial-only', appointment_id: 'partial-appt', customer_name: payload.customer_name, customer_phone: payload.customer_phone, appointment_date: payload.appointment_date, appointment_time: payload.appointment_time, reserved: true } };
    }
    availabilityPayload = Object.assign({}, availabilityPayload, { verified_open_slots: [] });
    calendarPayload = { appointment_count: 1, verified_open_slots: 0, stores: [{ store_id: 'store-1', store_name: 'Main dealership', days: [{ date: payload.appointment_date, available_slots: [], appointments: [{ appointment_id: 'remote-appt-v6', order_id: 'ord-nexa-v6', lead_id: 'ord-nexa-v6', listing_id: payload.listing_id, customer_name: payload.customer_name, customer_phone: payload.customer_phone, customer_email: payload.customer_email, appointment_time: payload.appointment_time, appointment_status: 'scheduled', source: 'software' }] }] }] };
    remoteOrdersPayload = [{ id: 'ord-nexa-v6', order_id: 'ord-nexa-v6', lead_id: 'ord-nexa-v6', appointment_id: 'remote-appt-v6', name: payload.customer_name, phone: payload.customer_phone, email: payload.customer_email, status: 'new', order_type: 'reseller_appointment', source_context: 'nexa_smart_office_bot_reseller:assignment-1', source_label: 'Nexa Smart Office Bot', created_by_platform: 'Nexa Smart Office Bot', appointment_date: payload.appointment_date, appointment_time: payload.appointment_time, appointment_status: 'scheduled' }];
    remoteAgendaPayload = [{ id: 'agenda-contact-v8', name: payload.customer_name, phone: payload.customer_phone, email: payload.customer_email, source_type: 'appointment' }];
    return { raw: { ok: true, resource: 'appointment-create' }, payload: { order_id: 'ord-nexa-v6', lead_id: 'ord-nexa-v6', appointment_id: 'remote-appt-v6', source: 'Nexa Smart Office Bot', source_context: 'nexa_smart_office_bot_dealer', thread_id: payload.thread_id, customer_name: payload.customer_name, customer_phone: payload.customer_phone, appointment_date: payload.appointment_date, appointment_time: payload.appointment_time, appointment_status: 'scheduled', reserved: true, reserved_slot_key: payload.appointment_date + '|' + payload.appointment_time, refresh_resources: ['dealer-agenda-calendar','dealer-appointment-availability','orders','agenda'], lead_url: 'https://example.com/dealer/orders.php?highlight_order=ord-nexa-v6' } };
  }
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
  assert.equal(NEXA_APPOINTMENT_PAGE_V7_SYNC_V1, 'NEXA_APPOINTMENT_PAGE_V7_SYNC_V1');
  assert.equal(NEXA_APPOINTMENT_PAGE_V8_SYNC_V1, 'NEXA_APPOINTMENT_PAGE_V8_SYNC_V1');
  assert.equal(NEXA_APPOINTMENT_CONTACT_CONTEXT_V3, 'NEXA_APPOINTMENT_CONTACT_CONTEXT_V3');
  assert.equal(NEXA_APPOINTMENT_REMOTE_COMMIT_VERIFICATION_V1, 'NEXA_APPOINTMENT_REMOTE_COMMIT_VERIFICATION_V1');
  assert.equal(NEXA_STRUCTURED_APPOINTMENT_CONTACT_FORM_V1, 'NEXA_STRUCTURED_APPOINTMENT_CONTACT_FORM_V1');
  assert.equal(NEXA_PREBOOK_CONTACT_CHECKPOINT_V1, 'NEXA_PREBOOK_CONTACT_CHECKPOINT_V1');
  assert.equal(NEXA_APPOINTMENT_BARE_ACCEPTANCE_GUARD_V1, 'NEXA_APPOINTMENT_BARE_ACCEPTANCE_GUARD_V1');
  assert.equal(usableCustomerName('mi numero'), '', 'A contact phrase must never become the Dealer Lead customer name.');
  assert.equal(usableCustomerName('Mi número'), '', 'Accented contact phrases must never become a customer name.');
  assert.deepEqual(extractCustomerContact('mi numero es 239-444-6565'), {
    customer_name: '', customer_phone: '2394446565', customer_email: '', provided: true
  });
  assert.deepEqual(extractCustomerContact('Nombre: María López\nTeléfono: (239) 444-6565\nEmail: maria@example.com'), {
    customer_name: 'María López', customer_phone: '2394446565', customer_email: 'maria@example.com', provided: true
  });
  assert.deepEqual(extractCustomerContact('Nombre: ____________________\nTeléfono: __________________\nEmail (opcional): __________'), {
    customer_name: '', customer_phone: '', customer_email: '', provided: false
  });
  const structuredContactForm = appointmentContactRequest({ id: 'form-slot', start: new Date(2026, 6, 25, 11, 0, 0) }, 'es', {}, ['customer_name', 'customer_phone']);
  assert.match(structuredContactForm, /^Para completar la reserva/m);
  assert.match(structuredContactForm, /^Nombre: ____________________$/m);
  assert.match(structuredContactForm, /^Teléfono: __________________$/m);
  assert.match(structuredContactForm, /^Email \(opcional\): __________$/m);
  const phonePhraseConversation = contactFromConversation({
    thread: { participant_name: 'Standard Buyer' },
    messages: [
      { direction: 'outbound', body: structuredContactForm },
      { direction: 'inbound', sender_name: 'Standard Buyer', body: 'mi numero es 239-444-6565' }
    ]
  }, null, database);
  assert.equal(phonePhraseConversation.customer_name, '', 'The words before a supplied phone must not overwrite Customer Name.');
  assert.equal(phonePhraseConversation.customer_phone, '2394446565');
  const reviewForm = appointmentContactReviewForm({ id: 'review-slot', start: new Date(2026, 6, 23, 11, 0, 0) }, 'es', { customer_name: 'Samir Tabarcia' });
  assert.match(reviewForm, /^Nombre: Samir Tabarcia$/m);
  assert.match(reviewForm, /^Teléfono: __________________$/m);
  assert.match(reviewForm, /La cita todavía no está confirmada/i);
  assert.equal(hasRecentAppointmentOffer({ messages: [{ direction: 'outbound', body: '11:00 AM está disponible. ¿Desea que prepare la cita?' }] }), true);
  assert.equal(isShortAppointmentAcceptance('si'), true);
  assert.equal(isShortAppointmentAcceptance('Sí por favor'), true);
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
  availabilityPayload = {
    dealer_id: 'dealer-1', dealer_name: 'Main Dealer', store_id: 'store-1', store_name: 'Main dealership', phone: '239-555-0100', location: '100 Main Street', slot_minutes: 30,
    weekly_schedule: {}, blocked_dates: [], open_dates: [tomorrow.toISOString().slice(0, 10)],
    booked_times: [{ date: tomorrow.toISOString().slice(0, 10), start_time: '11:00', status: 'booked' }],
    verified_open_slots: [{ slot_id: 'slot-1', start_at: tomorrow.toISOString(), available: true, location: 'Main dealership' }]
  };
  saveBaseSettings({ auto_messages_enabled: '1', auto_appointments_enabled: '1', auto_appointments_send_confirmation: '0' });
  database.replaceIntegrationCache('messages', [{ thread_id: 'thread-offer', subject: 'Appointment options', unread_count: 1, can_reply: 1, is_announcement: 0, last_message_at: new Date().toISOString() }]);
  currentThread = function threadOffer(threadId) {
    return {
      thread: { thread_id: threadId, subject: 'Appointment options', participant_name: 'Customer Offer', customer_phone: '2395550102', can_reply: 1, is_announcement: 0 },
      messages: [{ message_id: 'inbound-offer', thread_id: threadId, direction: 'inbound', sender_type: 'customer', sender_name: 'Customer Offer', body: 'Is there an appointment available on ' + dateText + ' at 11:00 AM?', sent_at: new Date(Date.now() - 60000).toISOString(), is_read: 0 }]
    };
  };
  const offerResult = await service.runNow('test-professional-offer');
  assert.equal(offerResult.appointments_created, 0, 'An availability question must not create an appointment.');
  assert.equal(offerResult.messages_sent, 1);
  assert.match(sentMessages[0].body, /requested time is not available|time is no longer available/i);
  assert.match(sentMessages[0].body, /10:00 AM/i);
  assert.match(sentMessages[0].body, /convenient|reserve it|work for you/i);

  sentMessages = [];
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
  assert.match(lastAvailabilityQuery.from, /^20\d{2}-\d{2}-\d{2}$/);
  assert.equal(lastAvailabilityQuery.days, 14);
  assert.equal(lastAvailabilityQuery.store_id, undefined, 'A reseller/unknown test account must not be restricted to a dealer store.');
  const availabilityCache = database.listIntegrationCache('dealer-appointment-availability', '', 20);
  assert(availabilityCache.some((item) => item.record_type === 'availability_snapshot'));
  assert(availabilityCache.some((item) => item.slot_id === 'slot-1'));
  const appointments = database.listAppointments('Customer Two');
  assert.equal(appointments.length, 1);
  assert.equal(appointments[0].source_type, 'automatic-message');
  assert.equal(appointments[0].source_id, 'inbound-2');
  assert.equal(appointments[0].created_by, 'nexa-automatic-actions');
  await service.runNow('test-appointment-duplicate');
  assert.equal(database.listAppointments('Customer Two').length, 1, 'Automatic appointment must not duplicate.');

  database.replaceIntegrationCache('messages', [{ thread_id: 'thread-3', subject: 'Conflicting appointment', unread_count: 1, can_reply: 1, is_announcement: 0, last_message_at: new Date().toISOString() }]);
  currentThread = function threadThree(threadId) {
    return {
      thread: { thread_id: threadId, subject: 'Conflicting appointment', participant_name: 'Customer Three', customer_phone: '2395550101', can_reply: 1, is_announcement: 0 },
      messages: [{ message_id: 'inbound-3', thread_id: threadId, direction: 'inbound', sender_type: 'customer', sender_name: 'Customer Three', body: 'Can I schedule an appointment on ' + dateText + ' at 10:00 AM?', sent_at: new Date(Date.now() - 60000).toISOString(), is_read: 0 }]
    };
  };
  const collisionResult = await service.runNow('test-local-agenda-collision');
  assert.equal(collisionResult.appointments_created, 0);
  assert.equal(database.listAppointments('').length, 1, 'A verified remote slot must not overlap an existing local Agenda appointment.');

  const contactDay = new Date(tomorrow);
  contactDay.setDate(contactDay.getDate() + 2);
  contactDay.setHours(11, 0, 0, 0);
  const contactDateKey = contactDay.getFullYear() + '-' + String(contactDay.getMonth() + 1).padStart(2, '0') + '-' + String(contactDay.getDate()).padStart(2, '0');
  availabilityPayload = {
    store_id: 'store-1', store_name: 'Main dealership', phone: '239-555-0100', location: '100 Main Street',
    verified_open_slots: [{ slot_id: 'contact-slot', store_id: 'store-1', start_at: contactDay.toISOString(), available: true, location: 'Main dealership' }]
  };
  sentMessages = [];
  saveBaseSettings({ auto_messages_enabled: '1', auto_appointments_enabled: '1', auto_appointments_send_confirmation: '1', auto_appointments_create_remote: '0', auto_appointments_require_contact: '1' });
  database.replaceIntegrationCache('messages', [{ thread_id: 'thread-contact', subject: 'Appointment contact', unread_count: 1, can_reply: 1, is_announcement: 0, last_message_at: new Date().toISOString() }]);
  const contactThreadSnapshot = function threadMissingContact(threadId) {
    return {
      thread: { thread_id: threadId, subject: 'Appointment contact', can_reply: 1, is_announcement: 0 },
      messages: [
        { message_id: 'contact-request', thread_id: threadId, direction: 'inbound', sender_type: 'customer', body: 'Quiero una cita el ' + contactDateKey + ' a las 11:00 AM.', sent_at: new Date(Date.now() - 180000).toISOString(), is_read: 1 },
        { message_id: 'contact-offer', thread_id: threadId, direction: 'outbound', sender_type: 'dealer', body: 'La cita del ' + contactDateKey + ' a las 11:00 AM está disponible. ¿Le reservo esa hora?', sent_at: new Date(Date.now() - 120000).toISOString(), is_read: 1 },
        { message_id: 'contact-select', thread_id: threadId, direction: 'inbound', sender_type: 'customer', body: 'Sí, a las 11 está bien.', sent_at: new Date(Date.now() - 60000).toISOString(), is_read: 0 }
      ]
    };
  };
  currentThread = contactThreadSnapshot;
  database.createAutomaticActionEvent({
    dedupe_key: 'auto-appointment:contact-select:contact-slot', action_type: 'appointment_create', source_type: 'message', source_id: 'contact-select',
    thread_id: 'thread-contact', status: 'failed', engine: 'availability', summary: 'Old identity failure', error: 'Customer identity is not available for automatic appointment creation.'
  });
  const attentionBefore = notifications.filter((item) => item.title === 'Automatic appointment needs attention').length;
  const contactRequestResult = await service.runNow('test-missing-contact-request');
  assert.equal(contactRequestResult.appointments_created, 0);
  assert.equal(contactRequestResult.messages_sent, 1, 'Missing identity must produce a customer-facing request instead of stopping silently.');
  assert.match(sentMessages[0].body, /Nombre:\s*_+/i);
  assert.match(sentMessages[0].body, /Teléfono:\s*_+/i);
  assert.match(sentMessages[0].body, /Email \(opcional\):\s*_+/i);
  assert.match(sentMessages[0].body, /11:00 AM/i);
  assert.equal(notifications.filter((item) => item.title === 'Automatic appointment needs attention').length, attentionBefore, 'Missing identity should be a recoverable conversation step, not a terminal error notification.');

  database.replaceIntegrationCache('messages', [{ thread_id: 'thread-contact', subject: 'Appointment contact', unread_count: 1, can_reply: 1, is_announcement: 0, last_message_at: new Date().toISOString() }]);
  currentThread = function threadContactProvided(threadId) {
    const snapshot = contactThreadSnapshot(threadId);
    snapshot.messages.push({ message_id: 'contact-details', thread_id: threadId, direction: 'inbound', sender_type: 'customer', body: 'Mi nombre es Ana López y mi teléfono es 239-555-0188.', sent_at: new Date().toISOString(), is_read: 0 });
    return snapshot;
  };
  const recoveredContactResult = await service.runNow('test-contact-recovery');
  assert.equal(recoveredContactResult.appointments_created, 1, 'The same verified slot must be created after the customer supplies identity.');
  assert.equal(database.listAppointments('Ana López').length, 1);
  assert.equal(database.listAppointments('Ana López')[0].title, 'Website appointment · Ana López');
  assert.match(sentMessages[sentMessages.length - 1].body, /11:00 AM/i);
  assert.match(sentMessages[sentMessages.length - 1].body, /confirmad|confirmed/i);

  const remoteDay = new Date(tomorrow);
  remoteDay.setDate(remoteDay.getDate() + 1);
  remoteDay.setHours(14, 30, 0, 0);
  const remoteDateText = String(remoteDay.getMonth() + 1).padStart(2, '0') + '/' + String(remoteDay.getDate()).padStart(2, '0') + '/' + remoteDay.getFullYear();
  const remoteDateKey = remoteDay.getFullYear() + '-' + String(remoteDay.getMonth() + 1).padStart(2, '0') + '-' + String(remoteDay.getDate()).padStart(2, '0');
  database.saveIntegrationStatus({
    connected: 1,
    account_type: 'reseller',
    scopes_json: JSON.stringify(['reseller:read','agenda:read','messages:read','messages:write','dealer-appointment-availability:read','dealer-agenda-calendar:read','appointment-create:write']),
    connection_map_json: JSON.stringify({
      available_resources: ['orders','listings','agenda','messages','message-thread','message-send','message-read','dealer-appointment-availability','dealer-agenda-calendar','appointment-create'],
      dealer_appointment_availability_enabled: true,
      dealer_appointment_availability_endpoint: 'dealer-appointment-availability',
      dealer_agenda_calendar_enabled: true,
      dealer_agenda_calendar_endpoint: 'dealer-agenda-calendar',
      appointment_create_enabled: true,
      appointment_create_endpoint: 'appointment-create'
    })
  });
  calendarPayload = { stores: [{ store_id: 'store-1', days: [{ date: remoteDateKey, available_slots: [{ slot_id: 'remote-v6-slot', start_time: '14:30', end_time: '15:00', available: true }] }] }], appointment_count: 0, verified_open_slots: 1 };
  availabilityPayload = { store_id: 'store-1', store_name: 'Main dealership', phone: '239-555-0100', location: '100 Main Street', open_dates: [remoteDateKey], verified_open_slots: [{ slot_id: 'remote-v6-slot', listing_id: 'listing-77', start_at: remoteDay.toISOString(), available: true, location: '100 Main Street' }] };
  remoteAppointmentBody = null;
  sentMessages = [];
  saveBaseSettings({ auto_messages_enabled: '1', auto_appointments_enabled: '1', auto_appointments_create_remote: '0', auto_appointments_send_confirmation: '1' });
  database.replaceIntegrationCache('messages', [{ thread_id: 'thread-prebook-review', subject: 'Appointment contact review', unread_count: 1, can_reply: 1, is_announcement: 0, last_message_at: new Date().toISOString() }]);
  currentThread = function prebookReviewThread(threadId) {
    return {
      thread: { thread_id: threadId, subject: 'Appointment contact review', context_type: 'listing', context_id: 'listing-77', participant_name: 'Samir Tabarcia', can_reply: 1, is_announcement: 0 },
      messages: [
        { message_id: 'prebook-request', thread_id: threadId, direction: 'inbound', sender_type: 'customer', sender_name: 'Samir Tabarcia', body: 'Quiero la cita el ' + remoteDateText + ' a las 2:30 PM.', sent_at: new Date(Date.now() - 180000).toISOString(), is_read: 1 },
        { message_id: 'prebook-offer', thread_id: threadId, direction: 'outbound', sender_type: 'dealer', body: 'La Agenda confirma que el ' + remoteDateText + ' a las 2:30 PM está disponible. ¿Le reservo ese horario?', sent_at: new Date(Date.now() - 120000).toISOString(), is_read: 1 },
        { message_id: 'prebook-confirm', thread_id: threadId, direction: 'inbound', sender_type: 'customer', sender_name: 'Samir Tabarcia', body: 'si', sent_at: new Date(Date.now() - 60000).toISOString(), is_read: 0 }
      ]
    };
  };
  const prebookReviewResult = await service.runNow('test-prebook-contact-checkpoint');
  assert.equal(prebookReviewResult.appointments_created, 0, 'Customer acceptance must not create the website appointment before the contact form is returned.');
  assert.equal(prebookReviewResult.messages_sent, 1);
  assert.equal(remoteAppointmentBody, null, 'appointment-create must not run before the structured contact checkpoint.');
  assert.match(sentMessages[0].body, /^Nombre: Samir Tabarcia$/m);
  assert.match(sentMessages[0].body, /^Teléfono: __________________$/m);
  assert.match(sentMessages[0].body, /todavía no está confirmada/i);
  assert.doesNotMatch(sentMessages[0].body, /he reservado|cita (?:está|esta) confirmada/i);
  remoteAppointmentBody = null;
  remoteOrdersPayload = [];
  calendarFetchCount = 0;
  availabilityFetchCount = 0;
  leadsFetchCount = 0;
  agendaFetchCount = 0;
  saveBaseSettings({ auto_messages_enabled: '0', auto_appointments_enabled: '1', auto_appointments_create_remote: '1' });
  database.replaceIntegrationCache('messages', [{ thread_id: 'thread-v6', subject: 'Website appointment', unread_count: 1, can_reply: 1, is_announcement: 0, last_message_at: new Date().toISOString() }]);
  currentThread = function threadV6(threadId) {
    return {
      thread: { thread_id: threadId, subject: 'Website appointment', context_type: 'listing', context_id: 'listing-77', participant_name: 'Remote Customer', customer_phone: '7865553333', customer_email: 'remote@example.com', customer_location: 'Miami, FL', can_reply: 1, is_announcement: 0 },
      messages: [{ message_id: 'inbound-v6', thread_id: threadId, direction: 'inbound', sender_type: 'customer', sender_name: 'Remote Customer', body: 'Please book my appointment on ' + remoteDateText + ' at 2:30 PM.', sent_at: new Date(Date.now() - 60000).toISOString(), is_read: 0 }]
    };
  };
  const remoteResult = await service.runNow('test-v6-remote-appointment');
  assert.equal(remoteResult.appointments_created, 1);
  assert.deepEqual(remoteAppointmentBody, {
    thread_id: 'thread-v6', listing_id: 'listing-77', customer_name: 'Remote Customer', customer_phone: '7865553333', customer_email: 'remote@example.com',
    customer_location: 'Miami, FL', appointment_date: remoteDateKey, appointment_time: '14:30',
    notes: 'Customer confirmed the appointment through Nexa Smart Office Bot. Reserve this exact Dealer Agenda slot and add the completed appointment to Dealer Leads.'
  });
  assert.equal(calendarFetchCount, 2, 'Dealer Agenda calendar must refresh before evaluation and immediately after website creation.');
  assert.equal(availabilityFetchCount, 2, 'Dealer availability must refresh before evaluation and immediately after website creation.');
  assert.equal(leadsFetchCount, 1, 'Dealer Office Leads must refresh immediately after website creation.');
  assert.equal(agendaFetchCount, 1, 'Dealer Agenda contacts must refresh immediately after website creation.');
  const websiteCalendar = database.listIntegrationCache('dealer-agenda-calendar', '', 20);
  assert(websiteCalendar.some((item) => item.appointment_id === 'remote-appt-v6'));
  const websiteLeads = database.listIntegrationCache('orders', '', 20);
  assert.equal(websiteLeads.length, 1);
  assert.equal(websiteLeads[0].id, 'ord-nexa-v6');
  assert.equal(websiteLeads[0].source_context, 'nexa_smart_office_bot_reseller:assignment-1');
  const completedWebsiteAction = database.listAutomaticActionEvents(20).find((item) => item.source_id === 'inbound-v6');
  assert.ok(completedWebsiteAction);
  const completedWebsitePayload = JSON.parse(completedWebsiteAction.payload_json || '{}');
  assert.equal(completedWebsitePayload.website_refresh.marker, NEXA_APPOINTMENT_PAGE_V8_SYNC_V1);
  assert.equal(completedWebsitePayload.website_refresh.compatibility_marker, NEXA_APPOINTMENT_PAGE_V7_SYNC_V1);
  assert.equal(completedWebsitePayload.website_refresh.availability.refreshed, true);
  assert.equal(completedWebsitePayload.website_refresh.calendar.refreshed, true);
  assert.equal(completedWebsitePayload.website_refresh.leads.refreshed, true);
  assert.equal(completedWebsitePayload.website_refresh.agenda.refreshed, true);
  assert.equal(completedWebsitePayload.reserved_slot_key, remoteDateKey + '|14:30');
  assert.deepEqual(completedWebsitePayload.refresh_resources, ['dealer-agenda-calendar','dealer-appointment-availability','orders','agenda']);
  assert.equal(completedWebsitePayload.reservation_verification.marker, NEXA_APPOINTMENT_REMOTE_COMMIT_VERIFICATION_V1);
  assert.equal(completedWebsitePayload.reservation_verification.verified, true);
  assert.equal(completedWebsitePayload.reservation_verification.calendar_reserved, true);
  assert.equal(completedWebsitePayload.reservation_verification.lead_complete, true);
  assert.equal(completedWebsitePayload.reservation_verification.slot_removed_from_availability, true);
  assert.equal(service.getState().readiness.dealer_agenda_calendar_scope, true);
  assert.equal(service.getState().readiness.appointment_create_scope, true);

  const incompleteDay = new Date(remoteDay);
  incompleteDay.setDate(incompleteDay.getDate() + 1);
  incompleteDay.setHours(16, 0, 0, 0);
  const incompleteDateKey = incompleteDay.getFullYear() + '-' + String(incompleteDay.getMonth() + 1).padStart(2, '0') + '-' + String(incompleteDay.getDate()).padStart(2, '0');
  const incompleteDateText = String(incompleteDay.getMonth() + 1).padStart(2, '0') + '/' + String(incompleteDay.getDate()).padStart(2, '0') + '/' + incompleteDay.getFullYear();
  availabilityPayload = { store_id: 'store-1', verified_open_slots: [{ slot_id: 'lead-only-slot', store_id: 'store-1', start_at: incompleteDay.toISOString(), available: true }] };
  calendarPayload = { stores: [{ store_id: 'store-1', days: [{ date: incompleteDateKey, available_slots: [{ slot_id: 'lead-only-slot', start_time: '16:00', end_time: '16:30', available: true }], appointments: [] }] }], appointment_count: 0, verified_open_slots: 1 };
  remoteReservationMode = 'lead-only';
  sentMessages = [];
  saveBaseSettings({ auto_messages_enabled: '1', auto_appointments_enabled: '1', auto_appointments_create_remote: '1', auto_appointments_send_confirmation: '1' });
  database.replaceIntegrationCache('messages', [{ thread_id: 'thread-partial-reservation', subject: 'Incomplete website reservation', unread_count: 1, can_reply: 1, is_announcement: 0, last_message_at: new Date().toISOString() }]);
  currentThread = function partialReservationThread(threadId) {
    return { thread: { thread_id: threadId, participant_name: 'Complete Customer', customer_phone: '7865557777', can_reply: 1 }, messages: [
      { message_id: 'inbound-partial-reservation', thread_id: threadId, direction: 'inbound', sender_type: 'customer', sender_name: 'Complete Customer', body: 'Please book my appointment on ' + incompleteDateText + ' at 4:00 PM.', sent_at: new Date(Date.now() - 60000).toISOString(), is_read: 0 }
    ] };
  };
  const localCountBeforePartial = database.listAppointments('').length;
  const partialReservationResult = await service.runNow('test-lead-without-agenda-reservation');
  assert.equal(partialReservationResult.appointments_created, 0, 'A Lead by itself must never count as a completed appointment.');
  assert.equal(database.listAppointments('').length, localCountBeforePartial, 'Nexa must not create a local appointment for an unverified website reservation.');
  assert.equal(partialReservationResult.messages_sent, 1, 'The customer must receive a failure reply instead of a false confirmation.');
  assert.doesNotMatch(sentMessages[0].body, /appointment is confirmed|cita (?:está|esta) confirmada/i);
  const partialEvent = database.listAutomaticActionEvents(40).find((item) => item.source_id === 'inbound-partial-reservation' && item.action_type === 'appointment_create');
  assert.equal(partialEvent.status, 'failed');
  assert.match(partialEvent.error, /did not finish the reservation transaction/i);
  remoteReservationMode = 'complete';

  const raceDay = new Date(remoteDay);
  raceDay.setDate(raceDay.getDate() + 2);
  raceDay.setHours(15, 0, 0, 0);
  const raceDateKey = raceDay.getFullYear() + '-' + String(raceDay.getMonth() + 1).padStart(2, '0') + '-' + String(raceDay.getDate()).padStart(2, '0');
  const raceDateText = String(raceDay.getMonth() + 1).padStart(2, '0') + '/' + String(raceDay.getDate()).padStart(2, '0') + '/' + raceDay.getFullYear();
  const raceAlternative = new Date(raceDay); raceAlternative.setMinutes(30);
  availabilityPayload = { store_id: 'store-1', store_name: 'Main dealership', phone: '239-555-0100', location: '100 Main Street', verified_open_slots: [
    { slot_id: 'race-selected', listing_id: 'listing-77', start_at: raceDay.toISOString(), available: true },
    { slot_id: 'race-alternative', listing_id: 'listing-77', start_at: raceAlternative.toISOString(), available: true }
  ] };
  calendarPayload = { stores: [{ store_id: 'store-1', days: [{ date: raceDateKey, available_slots: [
    { slot_id: 'race-selected', start_time: '15:00', end_time: '15:30', available: true },
    { slot_id: 'race-alternative', start_time: '15:30', end_time: '16:00', available: true }
  ] }] }], appointment_count: 0, verified_open_slots: 2 };
  remoteAppointmentFailure = {
    status: 409,
    message: 'That appointment slot is already booked. Refresh availability and choose another slot.',
    availability: { store_id: 'store-1', store_name: 'Main dealership', phone: '239-555-0100', location: '100 Main Street', verified_open_slots: [
      { slot_id: 'race-alternative', listing_id: 'listing-77', start_at: raceAlternative.toISOString(), available: true }
    ] },
    calendar: { stores: [{ store_id: 'store-1', days: [{ date: raceDateKey, available_slots: [
      { slot_id: 'race-alternative', start_time: '15:30', end_time: '16:00', available: true }
    ] }] }], appointment_count: 1, verified_open_slots: 1 }
  };
  sentMessages = [];
  saveBaseSettings({ auto_messages_enabled: '1', auto_appointments_enabled: '1', auto_appointments_create_remote: '1', auto_appointments_send_confirmation: '1' });
  database.replaceIntegrationCache('messages', [{ thread_id: 'thread-v7-race', subject: 'Website slot race', unread_count: 1, can_reply: 1, is_announcement: 0, last_message_at: new Date().toISOString() }]);
  currentThread = function threadV7Race(threadId) {
    return { thread: { thread_id: threadId, subject: 'Website slot race', context_type: 'listing', context_id: 'listing-77', participant_name: 'Race Customer', customer_phone: '2395550177', can_reply: 1, is_announcement: 0 }, messages: [
      { message_id: 'inbound-v7-race', thread_id: threadId, direction: 'inbound', sender_type: 'customer', sender_name: 'Race Customer', body: 'Please book my appointment on ' + raceDateText + ' at 3:00 PM.', sent_at: new Date(Date.now() - 60000).toISOString(), is_read: 0 }
    ] };
  };
  const raceResult = await service.runNow('test-v7-slot-race');
  assert.equal(raceResult.appointments_created, 0);
  assert.equal(raceResult.messages_sent, 1, 'A website 409 must produce a customer-facing updated offer.');
  assert.match(sentMessages[0].body, /3:30 PM/i);
  assert.doesNotMatch(sentMessages[0].body, /confirmed|confirmada|confirmado/i);
  const raceEvent = database.listAutomaticActionEvents(30).find((item) => item.source_id === 'inbound-v7-race' && item.action_type === 'appointment_create');
  assert.equal(raceEvent.status, 'blocked');

  // Keep this historical regression fixture independent from the day the test
  // suite runs. Earlier dynamic fixtures can also land on July 25, 2026.
  database.listAppointments('Ana López').forEach((item) => database.deleteAppointment(item.id));
  const correctedSaturday = new Date(2026, 6, 25, 11, 0, 0, 0);
  const correctedTuesday = new Date(2026, 6, 21, 11, 0, 0, 0);
  availabilityPayload = {
    store_id: 'store-1', store_name: 'Main dealership', phone: '239-555-0100', location: '13500 Intrepid Lane, Fort Myers, Florida 33913',
    verified_open_slots: [
      { slot_id: 'wrong-tuesday-1100', store_id: 'store-1', start_at: correctedTuesday.toISOString(), available: true },
      { slot_id: 'correct-saturday-1000', store_id: 'store-1', start_at: new Date(2026, 6, 25, 10, 0, 0, 0).toISOString(), available: true },
      { slot_id: 'correct-saturday-1030', store_id: 'store-1', start_at: new Date(2026, 6, 25, 10, 30, 0, 0).toISOString(), available: true },
      { slot_id: 'correct-saturday-1100', store_id: 'store-1', start_at: correctedSaturday.toISOString(), available: true }
    ]
  };
  calendarPayload = { stores: [{ store_id: 'store-1', days: [{ date: '2026-07-25', available_slots: [
    { slot_id: 'correct-saturday-1000', start_time: '10:00', end_time: '10:30', available: true },
    { slot_id: 'correct-saturday-1030', start_time: '10:30', end_time: '11:00', available: true },
    { slot_id: 'correct-saturday-1100', start_time: '11:00', end_time: '11:30', available: true }
  ] }] }], appointment_count: 0, verified_open_slots: 3 };
  remoteAppointmentBody = null;
  sentMessages = [];
  saveBaseSettings({ auto_messages_enabled: '1', auto_appointments_enabled: '1', auto_appointments_create_remote: '1', auto_appointments_send_confirmation: '1', auto_appointments_require_contact: '1' });
  database.replaceIntegrationCache('messages', [{ thread_id: 'thread-date-correction', subject: 'Corrected Saturday appointment', unread_count: 1, can_reply: 1, is_announcement: 0, last_message_at: new Date().toISOString() }]);
  currentThread = function correctedDateNeedsPhone(threadId) {
    return {
      thread: { thread_id: threadId, subject: 'Corrected Saturday appointment', participant_name: 'Maria Customer', can_reply: 1, is_announcement: 0 },
      messages: [
        { message_id: 'wrong-contact-prompt', thread_id: threadId, direction: 'outbound', sender_type: 'dealer', body: 'Antes de completar la cita para martes, 21 de julio de 2026 a las 11:00 AM, necesito el nombre del cliente y un teléfono.', sent_at: new Date(Date.now() - 120000).toISOString(), is_read: 1 },
        { message_id: 'correct-date-exact', thread_id: threadId, direction: 'inbound', sender_type: 'customer', sender_name: 'Maria Customer', body: 'la fecha esta incorrecta es el sabado a las 11', sent_at: new Date(Date.now() - 60000).toISOString(), is_read: 0 }
      ]
    };
  };
  const correctedPromptResult = await service.runNow('test-date-correction-phone-prompt');
  assert.equal(correctedPromptResult.appointments_created, 0);
  assert.equal(correctedPromptResult.messages_sent, 1);
  const correctedPhonePrompt = sentMessages[sentMessages.length - 1].body;
  assert.match(correctedPhonePrompt, /sábado, 25 de julio/i);
  assert.match(correctedPhonePrompt, /11:00 AM/i);
  assert.match(correctedPhonePrompt, /teléfono|telefono|phone/i);
  assert.doesNotMatch(correctedPhonePrompt, /martes, 21 de julio/i);

  await new Promise((resolve) => setTimeout(resolve, 5));
  const correctedPhoneAt = new Date().toISOString();
  database.replaceIntegrationCache('messages', [{ thread_id: 'thread-date-correction', subject: 'Corrected Saturday appointment', unread_count: 1, can_reply: 1, is_announcement: 0, last_message_at: new Date().toISOString() }]);
  currentThread = function correctedDatePhoneProvided(threadId) {
    return {
      thread: { thread_id: threadId, subject: 'Corrected Saturday appointment', participant_name: 'Maria Customer', can_reply: 1, is_announcement: 0 },
      messages: [
        { message_id: 'wrong-contact-prompt', thread_id: threadId, direction: 'outbound', sender_type: 'dealer', body: 'Antes de completar la cita para martes, 21 de julio de 2026 a las 11:00 AM, necesito el nombre del cliente y un teléfono.', sent_at: new Date(Date.now() - 240000).toISOString(), is_read: 1 },
        { message_id: 'correct-date-exact', thread_id: threadId, direction: 'inbound', sender_type: 'customer', sender_name: 'Maria Customer', body: 'la fecha esta incorrecta es el sabado a las 11', sent_at: new Date(Date.now() - 180000).toISOString(), is_read: 1 },
        { message_id: 'corrected-phone-prompt', thread_id: threadId, direction: 'outbound', sender_type: 'dealer', body: correctedPhonePrompt, sent_at: new Date(Date.now() - 120000).toISOString(), is_read: 1 },
        { message_id: 'corrected-phone', thread_id: threadId, direction: 'inbound', sender_type: 'customer', sender_name: 'Maria Customer', body: 'mi teléfono es 239-555-0199', sent_at: correctedPhoneAt, is_read: 0 }
      ]
    };
  };
  const correctedDateResult = await service.runNow('test-date-correction-thread-lead');
  assert.equal(correctedDateResult.appointments_created, 1, 'The corrected Saturday selection must create one appointment Lead.');
  assert.equal(remoteAppointmentBody.thread_id, 'thread-date-correction');
  assert.equal(remoteAppointmentBody.appointment_date, '2026-07-25');
  assert.equal(remoteAppointmentBody.appointment_time, '11:00');
  assert.equal(remoteAppointmentBody.customer_phone, '2395550199');
  assert.equal(remoteAppointmentBody.customer_name, 'Maria Customer');
  assert.equal(remoteAppointmentBody.listing_id, '');
  const savedCorrectedAppointment = database.listAppointments('Maria Customer').find((item) => new Date(item.start_at).getDate() === 25 && new Date(item.start_at).getHours() === 11);
  assert.ok(savedCorrectedAppointment);
  assert.match(sentMessages[sentMessages.length - 1].body, /sábado, 25 de julio/i);
  assert.doesNotMatch(sentMessages[sentMessages.length - 1].body, /martes, 21 de julio/i);

  sentMessages = [];
  saveBaseSettings({ auto_messages_enabled: '1', auto_appointments_enabled: '1', auto_appointments_send_confirmation: '1' });
  database.replaceIntegrationCache('messages', [{ thread_id: 'thread-decline', subject: 'Appointment declined', unread_count: 1, can_reply: 1, is_announcement: 0, last_message_at: new Date().toISOString() }]);
  currentThread = function threadDecline(threadId) {
    return {
      thread: { thread_id: threadId, subject: 'Appointment declined', participant_name: 'Customer Decline', customer_phone: '2395550103', can_reply: 1, is_announcement: 0 },
      messages: [
        { message_id: 'decline-1', thread_id: threadId, direction: 'inbound', sender_type: 'customer', body: 'I would like an appointment.', sent_at: new Date(Date.now() - 180000).toISOString(), is_read: 1 },
        { message_id: 'decline-2', thread_id: threadId, direction: 'outbound', sender_type: 'dealer', body: 'The verified appointment time is 10:00 AM. Would that be convenient?', sent_at: new Date(Date.now() - 120000).toISOString(), is_read: 1 },
        { message_id: 'decline-3', thread_id: threadId, direction: 'inbound', sender_type: 'customer', body: 'No thanks, I do not want an appointment.', sent_at: new Date(Date.now() - 60000).toISOString(), is_read: 0 }
      ]
    };
  };
  const declineResult = await service.runNow('test-professional-decline');
  assert.equal(declineResult.messages_sent, 1);
  assert.match(sentMessages[0].body, /no problem|leave the appointment unscheduled/i);
  assert.match(sentMessages[0].body, /239-555-0100/);
  assert.match(sentMessages[0].body, /100 Main Street|13500 Intrepid Lane/);
  assert.match(sentMessages[0].body, /same chat/i);

  const dealerAddress = '13500 Intrepid Lane, Fort Myers, Florida 33913';
  availabilityPayload = {
    dealer_id: 'dealer-ezgo', dealer_name: 'Standard Dealer', store_id: 'store-ezgo', store_name: 'Standard Dealer',
    location: dealerAddress, phone: '239-799-1416', assigned_listings: [{ listing_id: 'listing-ezgo-2003', listing_title: '2003 EZGO Gol' }],
    verified_open_slots: []
  };
  calendarPayload = { stores: [{ store_id: 'store-ezgo', store_name: 'Standard Dealer', location: dealerAddress, days: [] }], appointment_count: 0, verified_open_slots: 0 };
  database.replaceIntegrationCache('orders', [{ id: 'order-ezgo-2003', order_id: 'order-ezgo-2003', listing_id: 'listing-ezgo-2003', store_id: 'store-ezgo', listing_title: '2003 EZGO Gol', customer_name: 'Standard Buyer' }]);
  database.replaceIntegrationCache('reseller-listings', [{ id: 'assignment-ezgo', assignment_id: 'assignment-ezgo', listing_id: 'listing-ezgo-2003', store_id: 'store-ezgo', listing_title: '2003 EZGO Gol', store_name: 'Standard Dealer', dealer_name: 'Standard Dealer' }]);
  sentMessages = [];
  saveBaseSettings({ auto_messages_enabled: '1', auto_appointments_enabled: '1' });
  database.replaceIntegrationCache('messages', [{ thread_id: 'thread-dealer-address', subject: '2003 EZGO Gol', context_type: 'order', context_id: 'order-ezgo-2003', unread_count: 1, can_reply: 1, is_announcement: 0, last_message_at: new Date().toISOString() }]);
  currentThread = function dealerAddressThread(threadId) {
    return {
      thread: { thread_id: threadId, subject: '2003 EZGO Gol', context_type: 'order', context_id: 'order-ezgo-2003', participant_name: 'Standard Buyer', can_reply: 1, is_announcement: 0 },
      messages: [
        { message_id: 'dealer-address-question', thread_id: threadId, direction: 'inbound', sender_type: 'buyer', body: 'New order request sent from listing.\n\nCustomer: Standard Buyer\nListing: 2003 EZGO Gol\nOrder notes: quiero saber más de este artículo y la dirección donde está', sent_at: new Date(Date.now() - 120000).toISOString(), is_read: 1 },
        { message_id: 'dealer-address-followup', thread_id: threadId, direction: 'inbound', sender_type: 'buyer', body: 'ok dame la direccion', sent_at: new Date(Date.now() - 60000).toISOString(), is_read: 0 }
      ]
    };
  };
  const originalMessageEngine = aiService.messageEngine;
  aiService.messageEngine = new MessageResponseEngine(database);
  const addressResult = await service.runNow('test-live-dealer-address-reply');
  aiService.messageEngine = originalMessageEngine;
  assert.equal(addressResult.messages_sent, 1, 'The synchronized dealer address must produce an automatic customer reply.');
  assert.match(sentMessages[0].body, new RegExp(dealerAddress));
  assert.doesNotMatch(sentMessages[0].body, /primero verificar|verificar[eé]|responder[eé] en breve/i);

  const state = service.getState();
  assert.equal(state.invariants.never_edits_existing_customer_records, true);
  assert.equal(state.invariants.appointment_lead_creation_requires_authorization, true);
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
