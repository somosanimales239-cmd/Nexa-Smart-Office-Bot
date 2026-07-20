'use strict';

const crypto = require('node:crypto');
const { deriveAppointmentCapabilities, deriveMessageCapabilities, stableHash } = require('./automarket-api-service');
const {
  availabilityCacheItems,
  availabilityStart,
  isAppointmentAvailabilityIntent,
  localDateKey,
  normalizeAvailability,
  parseRequestedDateTime
} = require('./dealer-availability-service');
const { calendarAppointmentsFromCache, calendarCacheItems, calendarItemCount } = require('./dealer-agenda-calendar-service');
const { appointmentConfirmation, appointmentConversationPlan } = require('./appointment-communication-service');

const NEXA_GUARDED_AUTOMATIC_ACTIONS_V1 = 'NEXA_GUARDED_AUTOMATIC_ACTIONS_V1';
const NEXA_AUTOMATION_NO_CUSTOMER_MUTATION_OR_DELETE_V1 = 'NEXA_AUTOMATION_NO_CUSTOMER_MUTATION_OR_DELETE_V1';
const NEXA_AUTOMATION_DIAGNOSTIC_RESULT_V2 = 'NEXA_AUTOMATION_DIAGNOSTIC_RESULT_V2';

function text(value) { return String(value === undefined || value === null ? '' : value).trim(); }
function number(value, fallback) { const parsed = Number(value); return Number.isFinite(parsed) ? parsed : fallback; }
function enabled(value) { return String(value || '0') === '1'; }
function nowIso() { return new Date().toISOString(); }
function parseCsv(value) { return text(value).split(',').map(function clean(item) { return item.trim().toLowerCase(); }).filter(Boolean); }
function safeJson(value, fallback) { try { return JSON.parse(String(value || '')); } catch (_) { return fallback; } }
function clamp(value, minimum, maximum) { return Math.min(Math.max(number(value, minimum), minimum), maximum); }

function listFromPayload(payload) {
  if (Array.isArray(payload)) return payload;
  if (!payload || typeof payload !== 'object') return [];
  for (const key of ['verified_open_slots', 'open_slots', 'available_slots', 'slots', 'availability', 'dealer_appointment_availability', 'items', 'records', 'rows', 'appointments', 'threads', 'messages', 'data']) {
    if (Array.isArray(payload[key])) return payload[key];
  }
  return [];
}

function isAppointmentIntent(message) {
  return isAppointmentAvailabilityIntent(message);
}

function classifyRisk(message, excludedIntents) {
  const source = text(message).toLowerCase();
  const matches = [];
  const patterns = {
    financing_approval: /\b(approved|approval|apr|interest rate|monthly payment|credit score|financing approval|aprobado|aprobacion|tasa|pago mensual|credito)\b/,
    legal_issue: /\b(lawyer|legal|lawsuit|attorney|demand letter|abogado|legal|demanda)\b/,
    emergency_issue: /\b(emergency|danger|unsafe|accident|injury|police|emergencia|peligro|accidente|herida|policia)\b/,
    complaint: /\b(complaint|angry|scam|fraud|terrible|queja|enojado|estafa|fraude)\b/,
    refund_dispute: /\b(refund|chargeback|return my money|reembolso|devolver.*dinero)\b/,
    payment_dispute: /\b(payment dispute|wrong charge|charged twice|disputa.*pago|cobro.*incorrecto)\b/
  };
  Object.entries(patterns).forEach(function inspect(entry) { if (entry[1].test(source)) matches.push(entry[0]); });
  const blocked = matches.find(function excluded(item) { return excludedIntents.includes(item); });
  return { blocked: Boolean(blocked), intent: blocked || matches[0] || 'standard' };
}

function inQuietHours(settings, date) {
  const current = date || new Date();
  const start = text(settings.auto_messages_quiet_start || '22:00').split(':').map(Number);
  const end = text(settings.auto_messages_quiet_end || '07:00').split(':').map(Number);
  const nowMinutes = current.getHours() * 60 + current.getMinutes();
  const startMinutes = (start[0] || 0) * 60 + (start[1] || 0);
  const endMinutes = (end[0] || 0) * 60 + (end[1] || 0);
  if (startMinutes === endMinutes) return false;
  return startMinutes < endMinutes ? nowMinutes >= startMinutes && nowMinutes < endMinutes : nowMinutes >= startMinutes || nowMinutes < endMinutes;
}

function formatSlot(slot) {
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(slot.start);
}

function slotConflictsWithLocalAgenda(slot, appointments) {
  if (!slot || !(slot.start instanceof Date) || !(slot.end instanceof Date)) return true;
  return (appointments || []).some(function overlaps(appointment) {
    if (String(appointment.status || '').toLowerCase() !== 'scheduled') return false;
    const start = new Date(appointment.start_at);
    if (Number.isNaN(start.getTime())) return false;
    const end = appointment.end_at ? new Date(appointment.end_at) : new Date(start.getTime() + 30 * 60000);
    const safeEnd = Number.isNaN(end.getTime()) ? new Date(start.getTime() + 30 * 60000) : end;
    return slot.start < safeEnd && slot.end > start;
  });
}

function calendarAppointmentsAsConflicts(rows) {
  return calendarAppointmentsFromCache(rows).filter(function active(item) {
    return !['cancelled','canceled','completed','no-show','no_show'].includes(String(item.appointment_status || item.status || '').toLowerCase());
  }).map(function conflict(item) {
    return Object.assign({}, item, { status: 'scheduled' });
  });
}


function safeDeferredKnowledge(match) {
  const required = Array.isArray(match && match.requiredContext) ? match.requiredContext : [];
  if (!required.length) return true;
  const response = text(match && match.response).toLowerCase();
  if (!response) return false;
  const verificationLanguage = /\b(check|verify|confirm|review|look into|validate|revisar|verificar|confirmar|comprobar|consultar)\b/.test(response);
  const riskyCommitment = /\b(approved|guaranteed|confirmed appointment|your appointment is confirmed|available now|final price|apr is|monthly payment is|aprobado|garantizado|cita confirmada|precio final)\b/.test(response);
  return verificationLanguage && !riskyCommitment;
}

class AutomaticActionsService {
  constructor(options) {
    const input = options || {};
    this.database = input.database;
    this.settingsService = input.settingsService;
    this.apiService = input.apiService;
    this.aiService = input.aiService;
    this.notificationService = input.notificationService;
    this.timer = null;
    this.running = false;
    this.lastRunAt = null;
    this.lastResult = null;
  }

  settings() { return this.database.getSettings(); }

  messageReadiness(settingsInput) {
    const settings = settingsInput || this.settings();
    const publicSettings = this.settingsService.getPublicSettings();
    const integration = this.database.getIntegrationStatus();
    const map = safeJson(integration.connection_map_json, {});
    const scopes = safeJson(integration.scopes_json, []);
    const messageCapabilities = deriveMessageCapabilities({ scopes: scopes }, map);
    const appointmentCapabilities = deriveAppointmentCapabilities({ scopes: scopes }, map);
    const preferred = text(publicSettings.preferred_provider || 'openai');
    const provider = publicSettings.secrets && publicSettings.secrets[preferred] ? publicSettings.secrets[preferred] : {};
    return {
      authorized: enabled(settings.auto_actions_enabled) && Boolean(text(settings.auto_actions_consent_at)),
      master_enabled: enabled(settings.auto_actions_enabled),
      consent_saved: Boolean(text(settings.auto_actions_consent_at)),
      messages_authorized: enabled(settings.auto_messages_enabled),
      messages_switch_on: enabled(settings.messages_ai_enabled),
      appointments_authorized: enabled(settings.auto_appointments_enabled),
      integration_connected: Number(integration.connected || 0) === 1,
      message_list_available: messageCapabilities.resources.includes('messages') || !messageCapabilities.resources.length,
      full_thread_available: messageCapabilities.fullThread,
      message_send_available: messageCapabilities.send,
      message_read_available: messageCapabilities.markRead,
      two_way_chat_ready: messageCapabilities.twoWayChat,
      messages_read_scope: messageCapabilities.read,
      messages_write_scope: messageCapabilities.write,
      message_scopes_advertised: messageCapabilities.scopesAdvertised,
      dealer_availability_endpoint: appointmentCapabilities.availabilityEndpoint,
      dealer_availability_scope: appointmentCapabilities.availabilityRead,
      dealer_agenda_calendar_endpoint: appointmentCapabilities.calendarEndpoint,
      dealer_agenda_calendar_scope: appointmentCapabilities.calendarRead,
      appointment_create_endpoint: appointmentCapabilities.createEndpoint,
      appointment_create_scope: appointmentCapabilities.createWrite,
      knowledge_only: enabled(settings.auto_messages_knowledge_only),
      ai_fallback_enabled: enabled(settings.auto_messages_ai_fallback),
      preferred_provider: preferred,
      provider_configured: Boolean(provider && provider.configured),
      in_quiet_hours: inQuietHours(settings, new Date()),
      rate_limit_available: this.canSendMore(settings),
      marker: NEXA_AUTOMATION_DIAGNOSTIC_RESULT_V2
    };
  }

  getState() {
    const settings = this.settingsService.getPublicSettings();
    const summary = this.database.automaticActionSummary();
    const integration = this.database.getIntegrationStatus();
    const map = safeJson(integration.connection_map_json, {});
    const available = safeJson(integration.scopes_json, []);
    const appointmentCapabilities = deriveAppointmentCapabilities({ scopes: available }, map);
    return {
      settings: settings,
      summary: summary,
      running: this.running,
      timer_active: Boolean(this.timer),
      last_run_at: this.lastRunAt,
      last_result: this.lastResult,
      readiness: this.messageReadiness(settings),
      integration: {
        connected: Number(integration.connected || 0) === 1,
        account_type: integration.account_type || '',
        available_resources: Array.isArray(map.available_resources) ? map.available_resources : Array.isArray(map.resources) ? map.resources : [],
        scopes: Array.isArray(available) ? available : [],
        dealer_agenda_calendar: appointmentCapabilities.calendarRead,
        appointment_create: appointmentCapabilities.createWrite && appointmentCapabilities.calendarRead && appointmentCapabilities.availabilityRead,
        appointment_capabilities: appointmentCapabilities
      },
      invariants: {
        never_changes_customer_records: true,
        never_deletes_data: true,
        never_replies_to_announcements: true,
        logs_every_action: true,
        marker: NEXA_AUTOMATION_NO_CUSTOMER_MUTATION_OR_DELETE_V1
      }
    };
  }

  start() {
    this.stop();
    const settings = this.settings();
    const seconds = clamp(settings.auto_actions_run_interval_seconds, 5, 300);
    this.timer = setInterval(() => { this.runNow('timer').catch(function ignoreAutomationError() {}); }, seconds * 1000);
    if (enabled(settings.auto_actions_enabled)) setTimeout(() => { this.runNow('startup').catch(function ignoreStartupError() {}); }, 3500);
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  restart() { this.start(); }

  async notify(title, body, severity, dedupeKey, metadata) {
    if (!this.notificationService || typeof this.notificationService.createNotification !== 'function') return null;
    const event = this.notificationService.createNotification({
      source: 'automation', type: 'automatic_action', severity: severity || 'info', title: title, body: body,
      metadata: metadata || {}, dedupeKey: dedupeKey
    });
    if (event && typeof this.notificationService.deliverPending === 'function') await this.notificationService.deliverPending();
    return event;
  }

  async cacheAvailability(settings) {
    try {
      const integration = this.database.getIntegrationStatus();
      const query = {
        from: localDateKey(new Date()),
        days: 14,
        limit: clamp(settings.auto_appointments_slot_limit, 1, 100)
      };
      if (String(integration.account_type || '').toLowerCase() === 'dealer' && text(integration.store_id)) query.store_id = text(integration.store_id);
      const response = await this.apiService.fetchDealerAppointmentAvailability(query);
      const items = availabilityCacheItems(response.payload);
      this.database.replaceIntegrationCache('dealer-appointment-availability', items);
      const calendarRows = this.database.listIntegrationCache('dealer-agenda-calendar', '', 500);
      const calendarSnapshot = calendarRows.find(function snapshot(item) { return item && item.record_type === 'calendar_snapshot'; });
      const localAppointments = this.database.listAppointments('').concat(calendarAppointmentsAsConflicts(calendarRows));
      const livePayload = calendarSnapshot ? [response.payload, calendarSnapshot] : response.payload;
      return normalizeAvailability(livePayload, settings, new Date()).filter(function noLocalConflict(slot) {
        return !slotConflictsWithLocalAgenda(slot, localAppointments);
      });
    } catch (error) {
      const cached = this.database.listIntegrationCache('dealer-appointment-availability', '', 500);
      const calendarRows = this.database.listIntegrationCache('dealer-agenda-calendar', '', 500);
      const calendarSnapshot = calendarRows.find(function snapshot(item) { return item && item.record_type === 'calendar_snapshot'; });
      const localAppointments = this.database.listAppointments('').concat(calendarAppointmentsAsConflicts(calendarRows));
      const cachedPayload = calendarSnapshot ? cached.concat([calendarSnapshot]) : cached;
      if (cachedPayload.length) return normalizeAvailability(cachedPayload, settings, new Date()).filter(function noCachedConflict(slot) {
        return !slotConflictsWithLocalAgenda(slot, localAppointments);
      });
      const resellerAvailability = [];
      for (const resource of ['resellers', 'reseller-profile', 'reseller-summary']) {
        const rows = this.database.listIntegrationCache(resource, '', 100);
        rows.forEach(function collect(row) {
          const payload = safeJson(row.payload_json, row);
          resellerAvailability.push(payload);
        });
      }
      return normalizeAvailability(resellerAvailability, settings, new Date()).filter(function noEmbeddedConflict(slot) {
        return !slotConflictsWithLocalAgenda(slot, localAppointments);
      });
    }
  }

  async cacheDealerAgendaCalendar(settings, queryInput) {
    const integration = this.database.getIntegrationStatus();
    const map = safeJson(integration.connection_map_json, {});
    const scopes = safeJson(integration.scopes_json, []);
    const capabilities = deriveAppointmentCapabilities({ scopes: scopes }, map);
    if (!capabilities.calendarRead) return { refreshed: false, reason: 'dealer_agenda_calendar_not_authorized' };
    const query = Object.assign({ from: localDateKey(new Date()), days: 14 }, queryInput || {});
    if (String(integration.account_type || '').toLowerCase() === 'dealer' && text(integration.store_id)) query.store_id = text(integration.store_id);
    const response = await this.apiService.fetchDealerAgendaCalendar(query);
    const items = calendarCacheItems(response.payload);
    this.database.replaceIntegrationCache('dealer-agenda-calendar', items);
    const checkedAt = response.receivedAt || nowIso();
    if (typeof this.database.saveIntegrationSnapshot === 'function') {
      this.database.saveIntegrationSnapshot({
        resource: 'dealer-agenda-calendar', payload_hash: stableHash(response.payload), item_count: calendarItemCount(response.payload),
        payload_json: JSON.stringify(response.payload || {}), last_checked_at: checkedAt, last_changed_at: checkedAt
      });
    }
    if (typeof this.database.saveIntegrationResourceStatus === 'function') {
      this.database.saveIntegrationResourceStatus({
        resource: 'dealer-agenda-calendar', account_type: integration.account_type || '', required_scope: 'dealer-agenda-calendar:read',
        allowed: 1, status: 'ok', item_count: calendarItemCount(response.payload), http_status: response.status || 200,
        last_error: '', last_checked_at: checkedAt, last_success_at: checkedAt, duration_ms: response.durationMs || 0,
        payload_hash: stableHash(response.payload)
      });
    }
    return { refreshed: true, count: items.length, payload: response.payload };
  }

  async refreshMessageMetadata() {
    if (!this.apiService || typeof this.apiService.fetchResource !== 'function') return { attempted: false, loaded: this.database.listIntegrationCache('messages', '', 100).length, error: '' };
    try {
      const response = await this.apiService.fetchResource('messages', { limit: 100 });
      const items = listFromPayload(response.payload);
      this.database.replaceIntegrationCache('messages', items);
      return { attempted: true, loaded: items.length, error: '' };
    } catch (error) {
      return { attempted: true, loaded: this.database.listIntegrationCache('messages', '', 100).length, error: error.message };
    }
  }

  async refreshCandidateThreads(settings) {
    const metadataResult = await this.refreshMessageMetadata();
    const metadata = this.database.listIntegrationCache('messages', '', 100);
    const unreadOnly = enabled(settings.auto_messages_require_unread);
    const candidates = metadata.filter(function eligible(item) {
      if (Number(item.is_announcement || 0) === 1 || item.can_reply === false || Number(item.can_reply) === 0) return false;
      return !unreadOnly || Number(item.unread_count || 0) > 0;
    }).slice(0, 50);
    const result = { metadata: metadataResult, planned: candidates.length, loaded: 0, failed: 0, errors: [] };
    for (const item of candidates) {
      const threadId = text(item.thread_id || item.id);
      if (!threadId) continue;
      try {
        const response = await this.apiService.fetchMessageThread(threadId, { limit: 120, markRead: false });
        const payload = response.payload || {};
        const thread = payload.thread && typeof payload.thread === 'object' ? payload.thread : item;
        this.database.saveMessageThreadSnapshot(Object.assign({}, item, thread, { thread_id: threadId }), Array.isArray(payload.messages) ? payload.messages : [], { thread_id: threadId, cursor: payload.next_cursor });
        result.loaded += 1;
      } catch (error) {
        result.failed += 1;
        result.errors.push({ thread_id: threadId, error: error.message });
      }
    }
    return result;
  }

  canSendMore(settings) {
    const now = new Date();
    const hourAgo = new Date(now.getTime() - 3600000).toISOString();
    const dayAgo = new Date(now.getTime() - 86400000).toISOString();
    return this.database.countAutomaticActions('message_send', hourAgo) < clamp(settings.auto_messages_max_per_hour, 1, 100)
      && this.database.countAutomaticActions('message_send', dayAgo) < clamp(settings.auto_messages_max_per_day, 1, 1000);
  }

  async sendAutomaticMessage(threadId, body, sourceMessageId, result, settings, summaryLabel) {
    const dedupeKey = 'auto-message:' + sourceMessageId;
    if (this.database.hasAutomaticActionEvent(dedupeKey)) return { skipped: true, reason: 'duplicate' };
    const event = this.database.createAutomaticActionEvent({
      dedupe_key: dedupeKey, action_type: 'message_send', source_type: 'message', source_id: sourceMessageId,
      thread_id: threadId, status: 'pending', engine: result.engine || '', confidence: result.confidence || result.local_confidence || 0,
      summary: summaryLabel || 'Automatic reply prepared', payload: { body: body }
    });
    if (!event) return { skipped: true, reason: 'duplicate' };
    const clientMessageId = crypto.randomUUID();
    this.database.createMessageOutbox({ client_message_id: clientMessageId, thread_id: threadId, body: body });
    try {
      const response = await this.apiService.sendMessage(threadId, body, clientMessageId, sourceMessageId);
      const remote = response.payload && typeof response.payload === 'object' ? response.payload : {};
      const messageId = text(remote.message_id || remote.id || clientMessageId);
      this.database.updateMessageOutbox(clientMessageId, { status: 'sent', remote_message_id: messageId });
      const conversation = this.database.getMessageConversationContext(threadId, 5) || {};
      this.database.saveMessageThreadSnapshot(Object.assign({}, conversation.thread || {}, {
        thread_id: threadId, last_message_id: messageId, last_message_at: remote.sent_at || remote.created_at || nowIso()
      }), [Object.assign({}, remote, {
        message_id: messageId, thread_id: threadId, body: remote.body || body, direction: 'outbound', sender_type: remote.sender_type || 'business', sent_at: remote.sent_at || remote.created_at || nowIso(), status: remote.status || 'sent', is_read: 1
      })], { thread_id: threadId });
      if (result.draft && result.draft.id) this.database.markMessageDraftSent(result.draft.id, messageId);
      this.database.completeAutomaticActionEvent(event.id, { status: 'completed', engine: result.engine || '', confidence: result.confidence || result.local_confidence || 0, summary: summaryLabel || 'Automatic reply sent', payload: { remote_message_id: messageId } });
      if (enabled(settings.auto_messages_mark_read)) {
        try { await this.apiService.markMessageRead(threadId, sourceMessageId); } catch (_) { /* non-fatal */ }
      }
      await this.notify('Nexa sent an authorized reply', summaryLabel || 'A customer message was answered using your AI Control rules.', 'success', 'auto-message-notification:' + sourceMessageId, { thread_id: threadId, message_id: messageId });
      return { sent: true, message_id: messageId };
    } catch (error) {
      this.database.updateMessageOutbox(clientMessageId, { status: 'failed', error: error.message });
      this.database.completeAutomaticActionEvent(event.id, { status: 'failed', engine: result.engine || '', summary: 'Automatic reply failed', error: error.message });
      await this.notify('Automatic reply needs attention', error.message, 'danger', 'auto-message-error:' + sourceMessageId, { thread_id: threadId });
      return { failed: true, error: error.message };
    }
  }

  async createAppointmentFromSlot(candidate, conversation, slot, settings) {
    const sourceMessageId = text(candidate.inbound_message_id);
    const dedupeKey = 'auto-appointment:' + sourceMessageId + ':' + slot.id;
    if (this.database.hasAutomaticActionEvent(dedupeKey) || this.database.findAppointmentBySource('automatic-message', sourceMessageId)) return { skipped: true, reason: 'duplicate' };
    const appointmentConflicts = this.database.listAppointments('').concat(calendarAppointmentsAsConflicts(this.database.listIntegrationCache('dealer-agenda-calendar', '', 500)));
    if (slotConflictsWithLocalAgenda(slot, appointmentConflicts)) return { skipped: true, reason: 'agenda_conflict' };
    const event = this.database.createAutomaticActionEvent({
      dedupe_key: dedupeKey, action_type: 'appointment_create', source_type: 'message', source_id: sourceMessageId,
      thread_id: candidate.thread_id, status: 'pending', engine: 'availability', confidence: 1,
      summary: 'Authorized appointment creation', payload: { slot_id: slot.id, start_at: slot.start.toISOString() }
    });
    if (!event) return { skipped: true, reason: 'duplicate' };
    try {
      const thread = conversation.thread || {};
      const payload = safeJson(thread.payload_json, {});
      const verifiedCustomerName = text(thread.participant_name || thread.customer_name || payload.customer_name || payload.participant_name);
      const customerPhone = text(thread.customer_phone || thread.phone || payload.customer_phone || payload.phone);
      const customerEmail = text(thread.customer_email || thread.email || payload.customer_email || payload.email);
      if (enabled(settings.auto_appointments_require_contact) && !verifiedCustomerName && !customerPhone && !customerEmail) throw new Error('Customer identity is not available for automatic appointment creation.');
      const customerName = verifiedCustomerName || 'Website customer';
      let remoteAppointmentId = null;
      const integration = this.getState().integration;
      let calendarRefresh = null;
      if (enabled(settings.auto_appointments_create_remote) && integration.appointment_create) {
        const appointmentDate = localDateKey(slot.start);
        const appointmentTime = String(slot.start.getHours()).padStart(2, '0') + ':' + String(slot.start.getMinutes()).padStart(2, '0');
        const listingId = text(slot.listing_id || payload.listing_id || thread.context_id);
        if (String(integration.account_type || '').toLowerCase() === 'reseller' && !listingId) throw new Error('A reseller appointment requires an assigned listing_id.');
        const remote = await this.apiService.createRemoteAppointment({
          listing_id: listingId, customer_name: customerName, customer_phone: customerPhone, customer_email: customerEmail,
          customer_location: text(payload.customer_location || thread.customer_location || slot.location),
          appointment_date: appointmentDate, appointment_time: appointmentTime,
          notes: 'Customer appointment created by Nexa guarded automatic actions with explicit user authorization.'
        }, dedupeKey);
        remoteAppointmentId = text(remote.payload && (remote.payload.appointment_id || remote.payload.id));
        try {
          calendarRefresh = await this.cacheDealerAgendaCalendar(settings, { from: appointmentDate, days: 14, store_id: slot.store_id || undefined });
        } catch (refreshError) {
          calendarRefresh = { refreshed: false, error: refreshError.message };
        }
      }
      const reminder = slot.start.getTime() - Date.now() > 24 * 3600000 ? new Date(slot.start.getTime() - 24 * 3600000).toISOString() : new Date(Math.max(Date.now(), slot.start.getTime() - 2 * 3600000)).toISOString();
      const saved = this.database.saveAppointment({
        title: 'Website appointment · ' + customerName,
        description: 'Created from an authorized customer conversation. Thread: ' + candidate.thread_id + (slot.location ? '\nLocation: ' + slot.location : ''),
        start_at: slot.start.toISOString(), end_at: slot.end.toISOString(), status: 'Scheduled', reminder_at: reminder,
        source_type: 'automatic-message', source_id: sourceMessageId, thread_id: candidate.thread_id,
        remote_appointment_id: remoteAppointmentId, created_by: 'nexa-automatic-actions'
      });
      this.database.completeAutomaticActionEvent(event.id, { status: 'completed', engine: 'availability', confidence: 1, summary: 'Appointment created from dealer availability', payload: { appointment_id: saved.id, remote_appointment_id: remoteAppointmentId, slot_id: slot.id, dealer_agenda_calendar_refresh: calendarRefresh } });
      await this.notify('Nexa created an authorized appointment', customerName + ' · ' + formatSlot(slot), 'success', 'auto-appointment-notification:' + sourceMessageId, { appointment_id: saved.id, thread_id: candidate.thread_id });
      return { created: true, appointment: saved, customerName: customerName };
    } catch (error) {
      this.database.completeAutomaticActionEvent(event.id, { status: 'failed', engine: 'availability', summary: 'Appointment creation failed', error: error.message });
      await this.notify('Automatic appointment needs attention', error.message, 'danger', 'auto-appointment-error:' + sourceMessageId, { thread_id: candidate.thread_id });
      return { failed: true, error: error.message };
    }
  }

  async processAppointmentCandidate(candidate, conversation, slots, settings) {
    const message = text(candidate.inbound_body);
    if (!enabled(settings.auto_appointments_enabled)) return { handled: false };
    const availabilityPayload = this.database.listIntegrationCache('dealer-appointment-availability', '', 500);
    const calendarSnapshot = this.database.listIntegrationCache('dealer-agenda-calendar', '', 500).find(function snapshot(item) { return item && item.record_type === 'calendar_snapshot'; });
    const liveAppointmentPayload = calendarSnapshot ? availabilityPayload.concat([calendarSnapshot]) : availabilityPayload;
    const plan = appointmentConversationPlan({
      payload: liveAppointmentPayload,
      slots: slots,
      conversation: conversation,
      message: message,
      referenceDate: new Date()
    });
    if (!plan.relevant) return { handled: false };
    if (plan.shouldCreate && plan.selectedSlot) {
      const created = await this.createAppointmentFromSlot(candidate, conversation, plan.selectedSlot, settings);
      if (created.created && enabled(settings.auto_messages_enabled) && enabled(settings.auto_appointments_send_confirmation) && this.canSendMore(settings)) {
        const confirmation = appointmentConfirmation(plan.selectedSlot, plan.locale, liveAppointmentPayload);
        await this.sendAutomaticMessage(candidate.thread_id, confirmation, candidate.inbound_message_id, { engine: 'availability', confidence: 1 }, settings, 'Appointment confirmation sent');
      }
      return { handled: true, appointment: created };
    }
    const isOffer = !['decline', 'no_availability'].includes(plan.decision);
    if (isOffer && !enabled(settings.auto_appointments_offer_slots)) return { handled: true, skipped: true, reason: 'appointment_slot_offers_disabled' };
    if (enabled(settings.auto_messages_enabled) && text(plan.response) && this.canSendMore(settings)) {
      const summary = plan.decision === 'decline' ? 'Appointment decline answered courteously'
        : plan.decision === 'offer_next_day' || plan.decision === 'blocked_day' ? 'Next available appointment day sent'
          : 'Available appointment hours sent';
      const sent = await this.sendAutomaticMessage(candidate.thread_id, plan.response, candidate.inbound_message_id, { engine: 'availability', confidence: 1 }, settings, summary);
      return { handled: true, offered: sent, sent: Boolean(sent && sent.sent), failed: Boolean(sent && sent.failed), error: sent && sent.error };
    }
    return { handled: false, reason: 'appointment_response_not_authorized' };
  }

  async processMessageCandidate(candidate, settings, slots) {
    const sourceMessageId = text(candidate.inbound_message_id);
    if (!sourceMessageId || this.database.hasAutomaticActionEvent('auto-message:' + sourceMessageId)) return { skipped: true, reason: 'already_processed' };
    if (enabled(settings.auto_messages_require_unread) && Number(candidate.inbound_is_read || 0) === 1) return { skipped: true, reason: 'read' };
    const delay = clamp(settings.auto_messages_send_delay_seconds, 0, 3600) * 1000;
    if (Date.parse(candidate.inbound_at || '') + delay > Date.now()) return { skipped: true, reason: 'delay' };
    const risk = classifyRisk(candidate.inbound_body, parseCsv(settings.auto_messages_excluded_intents));
    if (risk.blocked) {
      const event = this.database.createAutomaticActionEvent({
        dedupe_key: 'auto-message:' + sourceMessageId, action_type: 'message_review', source_type: 'message', source_id: sourceMessageId,
        thread_id: candidate.thread_id, status: 'blocked', engine: 'safety', confidence: 1, summary: 'Human review required: ' + risk.intent
      });
      if (event) await this.notify('Human review required', 'Nexa did not automatically answer a sensitive customer message.', 'warning', 'auto-review:' + sourceMessageId, { thread_id: candidate.thread_id, intent: risk.intent });
      return { skipped: true, reason: risk.intent };
    }
    const conversation = this.database.getMessageConversationContext(candidate.thread_id, 120);
    const appointment = await this.processAppointmentCandidate(candidate, conversation, slots, settings);
    if (appointment.handled) return appointment;
    if (Number(candidate.automation_blocked || 0) === 1) return { skipped: true, reason: 'thread_auto_reply_blocked' };
    if (!enabled(settings.auto_messages_enabled)) return { skipped: true, reason: 'automatic_messages_disabled' };
    if (!enabled(settings.messages_ai_enabled)) return { skipped: true, reason: 'messages_ai_switch_off' };
    if (!this.canSendMore(settings)) return { skipped: true, reason: 'message_limit_reached' };
    if (inQuietHours(settings, new Date())) return { skipped: true, reason: 'quiet_hours' };
    const languages = parseCsv(settings.auto_messages_languages);
    const providerSettings = this.settingsService.getPublicSettings();
    const previousFallback = providerSettings.message_ai_fallback;
    const previousMode = providerSettings.message_ai_mode;
    let result;
    try {
      if (enabled(settings.auto_messages_knowledge_only)) {
        const match = this.aiService.messageEngine.match(conversation);
        if (!match.matched || match.confidence < number(settings.auto_messages_min_confidence, 0.88)) return { skipped: true, reason: 'knowledge_confidence' };
        if (languages.length && !languages.includes(String(match.locale || '').toLowerCase())) return { skipped: true, reason: 'language' };
        if (String(match.safetyLevel || 'standard') !== String(settings.auto_messages_allowed_safety || 'standard')) return { skipped: true, reason: 'safety_level' };
        if (!safeDeferredKnowledge(match)) return { skipped: true, reason: 'missing_verified_context' };
        if (!match.dynamic) this.database.incrementKnowledgeUse(match.knowledgeId);
        const draft = this.database.saveMessageDraft({ thread_id: candidate.thread_id, source: 'knowledge-auto', confidence: match.confidence, trigger_text: match.latestMessage, body: match.response });
        result = { engine: 'knowledge', confidence: match.confidence, draft: draft, body: match.response };
      } else {
        const match = this.aiService.messageEngine.match(conversation);
        if (match.matched && match.confidence >= number(settings.auto_messages_min_confidence, 0.88)
          && String(match.safetyLevel || 'standard') === String(settings.auto_messages_allowed_safety || 'standard')
          && safeDeferredKnowledge(match)) {
          if (languages.length && !languages.includes(String(match.locale || '').toLowerCase())) return { skipped: true, reason: 'language' };
          if (!match.dynamic) this.database.incrementKnowledgeUse(match.knowledgeId);
          const draft = this.database.saveMessageDraft({ thread_id: candidate.thread_id, source: 'knowledge-auto', confidence: match.confidence, trigger_text: match.latestMessage, body: match.response });
          result = { engine: 'knowledge', confidence: match.confidence, draft: draft, body: match.response };
        } else {
          if (!enabled(settings.auto_messages_ai_fallback)) return { skipped: true, reason: 'ai_fallback_disabled' };
          result = await this.aiService.generateMessageReply({ thread_id: candidate.thread_id, provider: providerSettings.preferred_provider, focus: 'Prepare a safe, concise reply under the user-authorized automatic messaging policy.', force_ai_fallback: true, force_ai_only: true });
          result.body = result.draft && result.draft.body ? result.draft.body : '';
        }
      }
    } finally {
      void previousFallback; void previousMode;
    }
    if (!result || !text(result.body)) return { skipped: true, reason: 'empty_reply' };
    return this.sendAutomaticMessage(candidate.thread_id, result.body, sourceMessageId, result, settings, result.engine === 'knowledge' ? 'Knowledge Library reply sent' : 'AI-assisted reply sent');
  }

  async runNow(trigger) {
    if (this.running) return { cycle_skipped: true, reason: 'already_running', last_result: this.lastResult, marker: NEXA_AUTOMATION_DIAGNOSTIC_RESULT_V2 };
    const settings = this.settings();
    const readiness = this.messageReadiness(settings);
    if (!readiness.authorized) {
      return { cycle_skipped: true, reason: 'not_authorized', readiness: readiness, state: this.getState(), marker: NEXA_AUTOMATION_DIAGNOSTIC_RESULT_V2 };
    }
    if (!enabled(settings.auto_messages_enabled) && !enabled(settings.auto_appointments_enabled)) {
      return { cycle_skipped: true, reason: 'no_automatic_actions_enabled', readiness: readiness, state: this.getState(), marker: NEXA_AUTOMATION_DIAGNOSTIC_RESULT_V2 };
    }
    this.running = true;
    const result = {
      cycle_skipped: false,
      status: 'completed',
      trigger: trigger || 'manual',
      started_at: nowIso(),
      messages_sent: 0,
      appointments_created: 0,
      skipped_count: 0,
      failed_count: 0,
      candidate_count: 0,
      reason_counts: {},
      readiness: readiness,
      refresh: null,
      availability_count: 0,
      errors: [],
      marker: NEXA_AUTOMATION_DIAGNOSTIC_RESULT_V2
    };
    try {
      result.refresh = await this.refreshCandidateThreads(settings);
      if (result.refresh && Array.isArray(result.refresh.errors)) {
        result.refresh.errors.slice(0, 10).forEach(function addRefreshError(item) {
          result.errors.push({ phase: 'message-thread', thread_id: text(item && item.thread_id), error: text(item && item.error) });
        });
      }
      if (result.refresh && result.refresh.metadata && result.refresh.metadata.error) {
        result.errors.push({ phase: 'messages', thread_id: '', error: text(result.refresh.metadata.error) });
      }
      if (enabled(settings.auto_appointments_enabled)) {
        try { await this.cacheDealerAgendaCalendar(settings); } catch (calendarError) { result.errors.push({ phase: 'dealer-agenda-calendar', error: text(calendarError.message) }); }
      }
      const slots = enabled(settings.auto_appointments_enabled) ? await this.cacheAvailability(settings) : [];
      result.availability_count = slots.length;
      const candidates = this.database.listAutomaticMessageCandidates(50);
      result.candidate_count = candidates.length;
      for (const candidate of candidates) {
        let action;
        try {
          action = await this.processMessageCandidate(candidate, settings, slots);
        } catch (error) {
          action = { failed: true, reason: 'processing_error', error: error.message, thread_id: candidate.thread_id };
        }
        if (action && action.sent) result.messages_sent += 1;
        else if (action && action.appointment && action.appointment.created) result.appointments_created += 1;
        else if (action && action.failed) {
          result.failed_count += 1;
          const failedReason = text(action.reason || 'failed');
          result.reason_counts[failedReason] = Number(result.reason_counts[failedReason] || 0) + 1;
          if (action.error) result.errors.push({ phase: 'message-processing', thread_id: text(action.thread_id || candidate.thread_id), error: text(action.error) });
        } else {
          result.skipped_count += 1;
          const skippedReason = text(action && action.reason || 'no_action');
          result.reason_counts[skippedReason] = Number(result.reason_counts[skippedReason] || 0) + 1;
        }
      }
      if (!result.candidate_count) {
        result.no_work_reason = result.refresh && result.refresh.failed
          ? 'message_threads_failed_to_load'
          : (enabled(settings.auto_messages_require_unread) ? 'no_unread_replyable_messages' : 'no_unanswered_messages');
      }
      result.completed_at = nowIso();
      this.lastRunAt = result.completed_at;
      this.lastResult = result;
      return result;
    } finally {
      this.running = false;
    }
  }
}

module.exports = {
  AutomaticActionsService,
  NEXA_GUARDED_AUTOMATIC_ACTIONS_V1,
  NEXA_AUTOMATION_NO_CUSTOMER_MUTATION_OR_DELETE_V1,
  NEXA_AUTOMATION_DIAGNOSTIC_RESULT_V2,
  availabilityStart,
  classifyRisk,
  inQuietHours,
  isAppointmentIntent,
  normalizeAvailability,
  parseRequestedDateTime,
  safeDeferredKnowledge
};
