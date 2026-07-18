'use strict';

const crypto = require('node:crypto');

const NEXA_GUARDED_AUTOMATIC_ACTIONS_V1 = 'NEXA_GUARDED_AUTOMATIC_ACTIONS_V1';
const NEXA_AUTOMATION_NO_CUSTOMER_MUTATION_OR_DELETE_V1 = 'NEXA_AUTOMATION_NO_CUSTOMER_MUTATION_OR_DELETE_V1';

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
  for (const key of ['slots', 'availability', 'items', 'records', 'rows', 'appointments', 'data']) {
    if (Array.isArray(payload[key])) return payload[key];
  }
  return [];
}

function nestedAvailability(record) {
  if (!record || typeof record !== 'object') return [];
  for (const key of ['dealer_appointment_availability', 'appointment_availability', 'available_slots', 'availability', 'slots']) {
    if (Array.isArray(record[key])) return record[key];
  }
  return [];
}

function availabilityStart(slot) {
  if (!slot || typeof slot !== 'object') return null;
  const direct = text(slot.start_at || slot.starts_at || slot.datetime);
  if (direct) {
    const parsed = new Date(direct);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }
  const date = text(slot.appointment_date || slot.date);
  const time = text(slot.start_time || slot.appointment_time || slot.time);
  if (!date) return null;
  const parsed = new Date(time ? date + ' ' + time : date);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function slotIdentity(slot, index) {
  return text(slot && (slot.slot_id || slot.availability_id || slot.id)) || crypto.createHash('sha256').update(JSON.stringify(slot || {}) + ':' + index).digest('hex').slice(0, 24);
}

function normalizeAvailability(payload, settings, referenceDate) {
  const now = referenceDate || new Date();
  const minNotice = clamp(settings.auto_appointments_min_notice_hours, 0, 168) * 3600000;
  const maxDate = new Date(now.getTime() + clamp(settings.auto_appointments_max_days, 1, 365) * 86400000);
  return listFromPayload(payload).map(function mapSlot(slot, index) {
    const start = availabilityStart(slot);
    if (!start) return null;
    const status = text(slot.status).toLowerCase();
    const isAvailable = slot.available === undefined ? !['unavailable', 'blocked', 'booked', 'closed', 'disabled'].includes(status) : Boolean(Number(slot.available) || slot.available === true || String(slot.available).toLowerCase() === 'true');
    if (!isAvailable || start.getTime() < now.getTime() + minNotice || start > maxDate) return null;
    const duration = clamp(slot.duration_minutes || settings.auto_appointments_duration_minutes, 10, 480);
    const end = slot.end_at ? new Date(slot.end_at) : new Date(start.getTime() + duration * 60000);
    return {
      id: slotIdentity(slot, index),
      start: start,
      end: Number.isNaN(end.getTime()) ? new Date(start.getTime() + duration * 60000) : end,
      location: text(slot.location || slot.address),
      raw: slot
    };
  }).filter(Boolean).sort(function sortSlots(a, b) { return a.start - b.start; });
}

const WEEKDAYS = {
  sunday: 0, domingo: 0, monday: 1, lunes: 1, tuesday: 2, martes: 2, wednesday: 3, miercoles: 3,
  thursday: 4, jueves: 4, friday: 5, viernes: 5, saturday: 6, sabado: 6
};

function parseTimeParts(message) {
  const source = text(message).toLowerCase();
  const match = source.match(/(?:\bat\s+|\ba\s+las?\s+|\b)(\d{1,2})(?::(\d{2}))?\s*(a\.?m\.?|p\.?m\.?)\b/i)
    || source.match(/\b(\d{1,2}):(\d{2})\b/);
  if (!match) return null;
  let hour = Number(match[1]);
  const minute = Number(match[2] || 0);
  const period = text(match[3]).replaceAll('.', '').toLowerCase();
  if (period === 'pm' && hour < 12) hour += 12;
  if (period === 'am' && hour === 12) hour = 0;
  if (hour > 23 || minute > 59) return null;
  return { hour: hour, minute: minute };
}

function parseRequestedDateTime(message, referenceDate) {
  const source = text(message).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const now = referenceDate ? new Date(referenceDate) : new Date();
  let date = null;
  const iso = source.match(/\b(20\d{2})-(\d{1,2})-(\d{1,2})\b/);
  const slash = source.match(/\b(\d{1,2})\/(\d{1,2})(?:\/(20\d{2}|\d{2}))?\b/);
  if (iso) date = new Date(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]));
  else if (slash) {
    let year = slash[3] ? Number(slash[3]) : now.getFullYear();
    if (year < 100) year += 2000;
    date = new Date(year, Number(slash[1]) - 1, Number(slash[2]));
  } else if (/\b(tomorrow|manana)\b/.test(source)) {
    date = new Date(now); date.setDate(date.getDate() + 1);
  } else if (/\b(today|hoy)\b/.test(source)) {
    date = new Date(now);
  } else {
    for (const pair of Object.entries(WEEKDAYS)) {
      if (new RegExp('\\b' + pair[0] + '\\b').test(source)) {
        date = new Date(now);
        let add = (pair[1] - date.getDay() + 7) % 7;
        if (add === 0) add = 7;
        date.setDate(date.getDate() + add);
        break;
      }
    }
  }
  const time = parseTimeParts(source);
  if (!date) return { date: null, time: time, exact: false };
  date.setHours(time ? time.hour : 0, time ? time.minute : 0, 0, 0);
  return { date: date, time: time, exact: Boolean(time) };
}

function isAppointmentIntent(message) {
  return /\b(appointment|schedule|availability|available time|book|test drive|cita|agendar|disponibilidad|hora disponible|reservar|prueba de manejo)\b/i.test(text(message));
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

  getState() {
    const settings = this.settingsService.getPublicSettings();
    const summary = this.database.automaticActionSummary();
    const integration = this.database.getIntegrationStatus();
    const map = safeJson(integration.connection_map_json, {});
    const available = safeJson(integration.scopes_json, []);
    return {
      settings: settings,
      summary: summary,
      running: this.running,
      timer_active: Boolean(this.timer),
      last_run_at: this.lastRunAt,
      last_result: this.lastResult,
      integration: {
        connected: Number(integration.connected || 0) === 1,
        account_type: integration.account_type || '',
        available_resources: Array.isArray(map.available_resources) ? map.available_resources : Array.isArray(map.resources) ? map.resources : [],
        scopes: Array.isArray(available) ? available : [],
        appointment_create: Boolean(map.appointment_create || (map.capabilities && map.capabilities.appointment_create))
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
      const response = await this.apiService.fetchDealerAppointmentAvailability({ limit: clamp(settings.auto_appointments_slot_limit, 1, 100) });
      const items = listFromPayload(response.payload);
      this.database.replaceIntegrationCache('dealer-appointment-availability', items);
      return normalizeAvailability(response.payload, settings, new Date());
    } catch (error) {
      const cached = this.database.listIntegrationCache('dealer-appointment-availability', '', 100);
      if (cached.length) return normalizeAvailability(cached, settings, new Date());
      const resellerSlots = [];
      for (const resource of ['resellers', 'reseller-profile', 'reseller-summary']) {
        const rows = this.database.listIntegrationCache(resource, '', 100);
        rows.forEach(function collect(row) {
          const payload = safeJson(row.payload_json, row);
          resellerSlots.push.apply(resellerSlots, nestedAvailability(payload));
        });
      }
      return normalizeAvailability(resellerSlots, settings, new Date());
    }
  }

  async refreshCandidateThreads(settings) {
    const metadata = this.database.listIntegrationCache('messages', '', 100);
    const unreadOnly = enabled(settings.auto_messages_require_unread);
    const candidates = metadata.filter(function eligible(item) {
      if (Number(item.is_announcement || 0) === 1 || item.can_reply === false || Number(item.can_reply) === 0) return false;
      return !unreadOnly || Number(item.unread_count || 0) > 0;
    }).slice(0, 20);
    for (const item of candidates) {
      const threadId = text(item.thread_id || item.id);
      if (!threadId) continue;
      try {
        const response = await this.apiService.fetchMessageThread(threadId, { limit: 120 });
        const payload = response.payload || {};
        const thread = payload.thread && typeof payload.thread === 'object' ? payload.thread : item;
        this.database.saveMessageThreadSnapshot(Object.assign({}, item, thread, { thread_id: threadId }), Array.isArray(payload.messages) ? payload.messages : [], { thread_id: threadId, cursor: payload.next_cursor });
      } catch (_) { /* A failed thread remains visible for manual review. */ }
    }
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
      if (enabled(settings.auto_appointments_create_remote) && integration.appointment_create) {
        const remote = await this.apiService.createRemoteAppointment({
          thread_id: candidate.thread_id, customer_name: customerName, customer_phone: customerPhone, customer_email: customerEmail,
          start_at: slot.start.toISOString(), end_at: slot.end.toISOString(), location: slot.location,
          listing_id: payload.listing_id || thread.context_id || null, notes: 'Created by Nexa guarded automatic actions with explicit user authorization.'
        }, dedupeKey);
        remoteAppointmentId = text(remote.payload && (remote.payload.appointment_id || remote.payload.id));
      }
      const reminder = slot.start.getTime() - Date.now() > 24 * 3600000 ? new Date(slot.start.getTime() - 24 * 3600000).toISOString() : new Date(Math.max(Date.now(), slot.start.getTime() - 2 * 3600000)).toISOString();
      const saved = this.database.saveAppointment({
        title: 'Website appointment · ' + customerName,
        description: 'Created from an authorized customer conversation. Thread: ' + candidate.thread_id + (slot.location ? '\nLocation: ' + slot.location : ''),
        start_at: slot.start.toISOString(), end_at: slot.end.toISOString(), status: 'Scheduled', reminder_at: reminder,
        source_type: 'automatic-message', source_id: sourceMessageId, thread_id: candidate.thread_id,
        remote_appointment_id: remoteAppointmentId, created_by: 'nexa-automatic-actions'
      });
      this.database.completeAutomaticActionEvent(event.id, { status: 'completed', engine: 'availability', confidence: 1, summary: 'Appointment created from dealer availability', payload: { appointment_id: saved.id, remote_appointment_id: remoteAppointmentId, slot_id: slot.id } });
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
    if (!enabled(settings.auto_appointments_enabled) || !isAppointmentIntent(message)) return { handled: false };
    const requested = parseRequestedDateTime(message, new Date());
    let match = null;
    if (requested.date && requested.exact) {
      match = slots.find(function exactSlot(slot) { return Math.abs(slot.start.getTime() - requested.date.getTime()) <= 15 * 60000; }) || null;
    }
    if (match) {
      const created = await this.createAppointmentFromSlot(candidate, conversation, match, settings);
      if (created.created && enabled(settings.auto_messages_enabled) && enabled(settings.auto_appointments_send_confirmation) && this.canSendMore(settings)) {
        const confirmation = 'Your appointment is scheduled for ' + formatSlot(match) + (match.location ? ' at ' + match.location : '') + '. Please let us know if you need to make a change.';
        await this.sendAutomaticMessage(candidate.thread_id, confirmation, candidate.inbound_message_id, { engine: 'availability', confidence: 1 }, settings, 'Appointment confirmation sent');
      }
      return { handled: true, appointment: created };
    }
    if (enabled(settings.auto_appointments_offer_slots) && enabled(settings.auto_messages_enabled) && slots.length && this.canSendMore(settings)) {
      const sameDay = requested.date ? slots.filter(function requestedDay(slot) { return slot.start.toDateString() === requested.date.toDateString(); }) : slots;
      const suggestions = (sameDay.length ? sameDay : slots).slice(0, 3);
      const body = 'These appointment times are currently available: ' + suggestions.map(formatSlot).join('; ') + '. Which one works best for you?';
      const sent = await this.sendAutomaticMessage(candidate.thread_id, body, candidate.inbound_message_id, { engine: 'availability', confidence: 1 }, settings, 'Available appointment times sent');
      return { handled: true, offered: sent };
    }
    return { handled: false };
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
    if (!enabled(settings.auto_messages_enabled) || !this.canSendMore(settings) || inQuietHours(settings, new Date())) return { skipped: true, reason: 'messages_disabled_or_limited' };
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
        if (Array.isArray(match.requiredContext) && match.requiredContext.length) return { skipped: true, reason: 'missing_verified_context' };
        this.database.incrementKnowledgeUse(match.knowledgeId);
        const draft = this.database.saveMessageDraft({ thread_id: candidate.thread_id, source: 'knowledge-auto', confidence: match.confidence, trigger_text: match.latestMessage, body: match.response });
        result = { engine: 'knowledge', confidence: match.confidence, draft: draft, body: match.response };
      } else {
        const match = this.aiService.messageEngine.match(conversation);
        if (match.matched && match.confidence >= number(settings.auto_messages_min_confidence, 0.88)
          && String(match.safetyLevel || 'standard') === String(settings.auto_messages_allowed_safety || 'standard')
          && (!Array.isArray(match.requiredContext) || match.requiredContext.length === 0)) {
          if (languages.length && !languages.includes(String(match.locale || '').toLowerCase())) return { skipped: true, reason: 'language' };
          this.database.incrementKnowledgeUse(match.knowledgeId);
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
    if (this.running) return { skipped: true, reason: 'already_running', last_result: this.lastResult };
    const settings = this.settings();
    if (!enabled(settings.auto_actions_enabled) || !text(settings.auto_actions_consent_at)) {
      return { skipped: true, reason: 'not_authorized', state: this.getState() };
    }
    this.running = true;
    const result = { trigger: trigger || 'manual', started_at: nowIso(), messages_sent: 0, appointments_created: 0, skipped: 0, failed: 0 };
    try {
      if (enabled(settings.auto_messages_enabled) || enabled(settings.auto_appointments_enabled)) await this.refreshCandidateThreads(settings);
      const slots = enabled(settings.auto_appointments_enabled) ? await this.cacheAvailability(settings) : [];
      const candidates = this.database.listAutomaticMessageCandidates(50);
      for (const candidate of candidates) {
        const action = await this.processMessageCandidate(candidate, settings, slots);
        if (action && action.sent) result.messages_sent += 1;
        else if (action && action.appointment && action.appointment.created) result.appointments_created += 1;
        else if (action && action.failed) result.failed += 1;
        else result.skipped += 1;
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
  availabilityStart,
  classifyRisk,
  inQuietHours,
  isAppointmentIntent,
  normalizeAvailability,
  parseRequestedDateTime
};
