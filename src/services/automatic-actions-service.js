'use strict';

const crypto = require('node:crypto');
const { deriveAppointmentCapabilities, deriveMessageCapabilities, extractAvailableResources, normalizeScopes, stableHash } = require('./automarket-api-service');
const {
  availabilityCacheItems,
  availabilityStart,
  isAppointmentAvailabilityIntent,
  localDateKey,
  normalizeAvailability,
  parseRequestedDateTime
} = require('./dealer-availability-service');
const { calendarAppointmentsFromCache, calendarCacheItems, calendarItemCount } = require('./dealer-agenda-calendar-service');
const { appointmentConfirmation, appointmentConversationPlan, detectAppointmentLocale, formatDate, formatTime, scopeSlotsForConversation } = require('./appointment-communication-service');
const { appointmentResponse } = require('./appointment-communication-library-service');

const NEXA_GUARDED_AUTOMATIC_ACTIONS_V1 = 'NEXA_GUARDED_AUTOMATIC_ACTIONS_V1';
const NEXA_AUTOMATION_NO_CUSTOMER_MUTATION_OR_DELETE_V1 = 'NEXA_AUTOMATION_NO_CUSTOMER_MUTATION_OR_DELETE_V1';
const NEXA_AUTOMATION_DIAGNOSTIC_RESULT_V2 = 'NEXA_AUTOMATION_DIAGNOSTIC_RESULT_V2';
const NEXA_APPOINTMENT_CONTACT_RECOVERY_V1 = 'NEXA_APPOINTMENT_CONTACT_RECOVERY_V1';
const NEXA_APPOINTMENT_THREAD_LEAD_CREATION_V2 = 'NEXA_APPOINTMENT_THREAD_LEAD_CREATION_V2';
const NEXA_APPOINTMENT_PAGE_V7_SYNC_V1 = 'NEXA_APPOINTMENT_PAGE_V7_SYNC_V1';
const NEXA_APPOINTMENT_PAGE_V8_SYNC_V1 = 'NEXA_APPOINTMENT_PAGE_V8_SYNC_V1';
const NEXA_APPOINTMENT_CONTACT_CONTEXT_V3 = 'NEXA_APPOINTMENT_CONTACT_CONTEXT_V3';
const NEXA_APPOINTMENT_REMOTE_COMMIT_VERIFICATION_V1 = 'NEXA_APPOINTMENT_REMOTE_COMMIT_VERIFICATION_V1';
const NEXA_STRUCTURED_APPOINTMENT_CONTACT_FORM_V1 = 'NEXA_STRUCTURED_APPOINTMENT_CONTACT_FORM_V1';
const NEXA_PREBOOK_CONTACT_CHECKPOINT_V1 = 'NEXA_PREBOOK_CONTACT_CHECKPOINT_V1';
const NEXA_APPOINTMENT_BARE_ACCEPTANCE_GUARD_V1 = 'NEXA_APPOINTMENT_BARE_ACCEPTANCE_GUARD_V1';

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

function usableCustomerName(value) {
  const candidate = text(value);
  if (!candidate) return '';
  const generic = candidate.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const invalidNames = [
    'buyer', 'standard buyer', 'customer', 'standard customer', 'cliente', 'comprador', 'user', 'usuario', 'website customer',
    'mi numero', 'mi numero es', 'este es mi numero', 'numero', 'numero de telefono', 'mi telefono', 'mi telefono es', 'telefono',
    'my number', 'my number is', 'this is my number', 'number', 'phone number', 'my phone', 'my phone is', 'phone', 'contact phone'
  ];
  if (invalidNames.includes(generic)) return '';
  if (!/[A-Za-zÀ-ÿ]/.test(candidate) || /\d{7,}/.test(candidate)) return '';
  if (/^(?:mi|my|este es mi|this is my)?\s*(?:numero|number|telefono|phone|celular|cell|contacto|contact)(?:\s+(?:de telefono|phone|es|is))?$/i.test(generic)) return '';
  if (/^[_\s.-]+$/.test(candidate)) return '';
  return candidate;
}

function isAppointmentContactPrompt(value) {
  const body = text(value).toLowerCase();
  if (!body) return false;
  if (body.includes('antes de completar la cita') || body.includes('before i complete the appointment')) return true;
  if (body.includes('crear el lead') || body.includes('create the lead')) return true;
  if ((body.includes('mantengo') || body.includes('i am keeping')) && (body.includes('teléfono') || body.includes('telefono') || body.includes('phone number'))) return true;
  if ((body.includes('antes de confirmar') || body.includes('before confirming') || body.includes('before i confirm'))
    && (body.includes('teléfono') || body.includes('telefono') || body.includes('phone number'))) return true;
  if ((body.includes('copie y complete') || body.includes('copy and fill in'))
    && (body.includes('teléfono:') || body.includes('telefono:') || body.includes('phone:'))) return true;
  if ((body.includes('revise esta ficha') || body.includes('review this form'))
    && (body.includes('teléfono:') || body.includes('telefono:') || body.includes('phone:'))) return true;
  return false;
}

function contactFromConversation(conversation, override, database) {
  const thread = conversation && conversation.thread || {};
  const threadPayload = safeJson(thread.payload_json, {});
  const participants = [];
  if (Array.isArray(thread.participants)) participants.push.apply(participants, thread.participants);
  if (Array.isArray(threadPayload.participants)) participants.push.apply(participants, threadPayload.participants);
  const result = {
    customer_name: usableCustomerName(thread.participant_name || thread.customer_name || threadPayload.customer_name || threadPayload.participant_name),
    customer_phone: text(thread.customer_phone || thread.phone || threadPayload.customer_phone || threadPayload.phone),
    customer_email: text(thread.customer_email || thread.email || threadPayload.customer_email || threadPayload.email),
    customer_location: text(thread.customer_location || thread.location || threadPayload.customer_location || threadPayload.location)
  };
  for (const participant of participants) {
    const role = text(participant && (participant.role || participant.type || participant.participant_type || participant.sender_type)).toLowerCase();
    if (/dealer|store|admin|reseller|business|agent/.test(role)) continue;
    if (!result.customer_name) result.customer_name = usableCustomerName(participant && (participant.name || participant.display_name));
    if (!result.customer_phone) result.customer_phone = text(participant && participant.phone);
    if (!result.customer_email) result.customer_email = text(participant && participant.email);
  }
  const contextType = text(thread.context_type || threadPayload.context_type).toLowerCase();
  const contextId = text(thread.context_id || threadPayload.context_id);
  if (database && /order|lead/.test(contextType) && contextId && typeof database.listIntegrationCache === 'function') {
    const lead = database.listIntegrationCache('orders', '', 500).find(function matchingLead(item) {
      return [item && item.id, item && item.order_id, item && item.lead_id].map(text).includes(contextId);
    });
    if (lead) {
      if (!result.customer_name) result.customer_name = usableCustomerName(lead.customer_name || lead.name);
      if (!result.customer_phone) result.customer_phone = text(lead.customer_phone || lead.phone);
      if (!result.customer_email) result.customer_email = text(lead.customer_email || lead.email);
      if (!result.customer_location) result.customer_location = text(lead.customer_location || lead.location);
    }
  }
  const messages = conversation && Array.isArray(conversation.messages) ? conversation.messages.slice().reverse() : [];
  for (const row of messages) {
    if (String(row && row.direction || '').toLowerCase() === 'outbound') continue;
    const payload = safeJson(row && row.payload_json, {});
    if (!result.customer_name) result.customer_name = usableCustomerName(row && (row.sender_name || row.customer_name) || payload.sender_name || payload.customer_name);
    if (!result.customer_phone) result.customer_phone = text(row && row.customer_phone || payload.customer_phone || payload.phone);
    if (!result.customer_email) result.customer_email = text(row && (row.customer_email || row.sender_email) || payload.customer_email || payload.sender_email || payload.email);
    if (result.customer_name && (result.customer_phone || result.customer_email)) break;
  }
  let collectingContact = false;
  for (const row of (conversation && Array.isArray(conversation.messages) ? conversation.messages : [])) {
    const body = text(row && row.body);
    if (String(row && row.direction || '').toLowerCase() === 'outbound') {
      if (isAppointmentContactPrompt(body)) collectingContact = true;
      continue;
    }
    const suppliedFromChat = extractCustomerContact(body);
    const explicitName = /\b(mi nombre es|me llamo|my name is|i am)\b/i.test(body);
    if ((collectingContact || explicitName) && usableCustomerName(suppliedFromChat.customer_name)) result.customer_name = usableCustomerName(suppliedFromChat.customer_name);
    if (suppliedFromChat.customer_phone) result.customer_phone = suppliedFromChat.customer_phone;
    if (suppliedFromChat.customer_email) result.customer_email = suppliedFromChat.customer_email;
  }
  const supplied = override || {};
  if (usableCustomerName(supplied.customer_name)) result.customer_name = usableCustomerName(supplied.customer_name);
  if (text(supplied.customer_phone)) result.customer_phone = text(supplied.customer_phone);
  if (text(supplied.customer_email)) result.customer_email = text(supplied.customer_email);
  return result;
}

function extractCustomerContact(message) {
  const source = text(message);
  const labeledName = source.match(/(?:^|\n)\s*(?:customer name|customer|name|cliente|nombre)\s*:\s*([^\n,;]+)/i);
  const labeledPhone = source.match(/(?:^|\n)\s*(?:contact phone|phone number|n[uú]mero de tel[eé]fono|mi n[uú]mero|phone|telephone|tel(?:ephone)?|tel[eé]fono|celular|n[uú]mero)\s*:\s*([^\n,;]+)/i);
  const labeledEmail = source.match(/(?:^|\n)\s*(?:email|e-mail|correo(?: electr[oó]nico)?)\s*:\s*([^\s,;]+)/i);
  const emailMatch = source.match(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i);
  const phoneMatch = labeledPhone && labeledPhone[1].match(/(?:\+?\d[\d().\s-]{7,}\d)/) || source.match(/(?:\+?\d[\d().\s-]{7,}\d)/);
  const phoneDigits = phoneMatch ? phoneMatch[0].replace(/\D/g, '') : '';
  const customerPhone = phoneDigits.length >= 10 && phoneDigits.length <= 15 ? phoneDigits : '';
  let name = source;
  if (emailMatch) name = name.replace(emailMatch[0], ' ');
  if (phoneMatch) name = name.replace(phoneMatch[0], ' ');
  name = name.replace(/\b(mi nombre es|me llamo|nombre|name is|my name is|telefono|teléfono|phone number|phone|celular|número|numero|contacto|correo|email|es|soy)\b\s*[:=-]?/gi, ' ')
    .replace(/[^A-Za-zÀ-ÿ\u0027 -]/g, ' ').replace(/\s+/g, ' ').trim()
    .replace(/\b(?:y\s+mi|and\s+my|mi|my)\b\s*$/i, '').trim();
  const words = name.split(' ').filter(Boolean);
  const explicitName = /\b(mi nombre es|me llamo|my name is|i am)\b/i.test(source);
  const contactOnlyReply = /\b(?:mi\s+)?(?:n[uú]mero|tel[eé]fono|celular|contacto)|\b(?:my\s+)?(?:number|phone|cell|contact)\b/i.test(source);
  const plainName = words.length >= 1 && words.length <= 4 && !/[?]/.test(source)
    && !contactOnlyReply
    && !/\b(quiero|necesito|por que|porque|cita|horario|gracias|no|si|why|what|when|appointment|schedule|thanks|yes)\b/i.test(source);
  const labeledCustomerName = labeledName ? usableCustomerName(labeledName[1]) : '';
  const customerName = labeledCustomerName || ((explicitName || plainName) && name.length >= 2 ? usableCustomerName(name) : '');
  const labeledCustomerEmail = labeledEmail && !/^[_\s.-]+$/.test(labeledEmail[1]) ? labeledEmail[1] : '';
  const customerEmail = labeledCustomerEmail || (emailMatch ? emailMatch[0] : '');
  return { customer_name: customerName, customer_phone: customerPhone, customer_email: customerEmail, provided: Boolean(customerName || customerPhone || customerEmail) };
}

function phoneKey(value) { return text(value).replace(/\D/g, ''); }

function reservationTrue(value) {
  return value === true || value === 1 || ['1','true','yes','reserved','scheduled'].includes(text(value).toLowerCase());
}

function timeKey(value) {
  const source = text(value);
  const match = source.match(/\b(\d{1,2}):(\d{2})(?::\d{2})?\s*(AM|PM)?\b/i);
  if (!match) return '';
  let hour = Number(match[1]);
  const minute = Number(match[2]);
  const meridiem = text(match[3]).toUpperCase();
  if (meridiem === 'PM' && hour < 12) hour += 12;
  if (meridiem === 'AM' && hour === 12) hour = 0;
  if (hour > 23 || minute > 59) return '';
  return String(hour).padStart(2, '0') + ':' + String(minute).padStart(2, '0');
}

function recordDateTime(record) {
  const item = record && typeof record === 'object' ? record : {};
  let date = text(item.appointment_date || item.date);
  let time = timeKey(item.appointment_time || item.start_time || item.time);
  const startAt = text(item.start_at || item.starts_at || item.datetime || item.date_time);
  if ((!date || !time) && startAt) {
    const parsed = new Date(startAt);
    if (!Number.isNaN(parsed.getTime())) {
      if (!date) date = localDateKey(parsed);
      if (!time) time = String(parsed.getHours()).padStart(2, '0') + ':' + String(parsed.getMinutes()).padStart(2, '0');
    }
  }
  return { date: date.slice(0, 10), time: time };
}

function recordIdentifiers(record) {
  const item = record && typeof record === 'object' ? record : {};
  return [item.appointment_id, item.order_id, item.lead_id, item.id].map(text).filter(Boolean);
}

function reservationRecordMatches(record, expected) {
  const wantedIds = new Set(expected.ids || []);
  if (recordIdentifiers(record).some(function sameId(id) { return wantedIds.has(id); })) return true;
  const dateTime = recordDateTime(record);
  if (dateTime.date !== expected.appointment_date || dateTime.time !== expected.appointment_time) return false;
  const expectedStore = text(expected.store_id);
  if (expectedStore && text(record && record.store_id) && expectedStore !== text(record.store_id)) return false;
  const expectedPhone = phoneKey(expected.customer_phone);
  const actualPhone = phoneKey(record && (record.customer_phone || record.phone));
  const expectedName = usableCustomerName(expected.customer_name).toLowerCase();
  const actualName = usableCustomerName(record && (record.customer_name || record.name)).toLowerCase();
  return Boolean(expectedPhone && actualPhone && expectedPhone === actualPhone || expectedName && actualName && expectedName === actualName);
}

function leadContainsReservation(record, expected) {
  if (!record || !reservationRecordMatches(record, expected)) return false;
  const dateTime = recordDateTime(record);
  const name = usableCustomerName(record.customer_name || record.name);
  const phone = phoneKey(record.customer_phone || record.phone);
  return Boolean(name && phone && dateTime.date === expected.appointment_date && dateTime.time === expected.appointment_time);
}

function remoteReservationVerification(database, slot, remotePayload, expected, settings, websiteRefresh) {
  const remote = remotePayload && typeof remotePayload === 'object' ? remotePayload : {};
  const ids = recordIdentifiers(remote);
  const wanted = Object.assign({}, expected, { ids: ids });
  const calendarRows = calendarAppointmentsFromCache(database.listIntegrationCache('dealer-agenda-calendar', '', 500));
  const calendarAppointment = calendarRows.find(function findCalendar(item) { return reservationRecordMatches(item, wanted); }) || null;
  const orderRows = database.listIntegrationCache('orders', '', 500);
  const lead = orderRows.find(function findLead(item) { return reservationRecordMatches(item, wanted); }) || null;
  const leadsWereReadable = Boolean(websiteRefresh && websiteRefresh.leads && websiteRefresh.leads.refreshed);
  const leadEvidence = leadsWereReadable ? lead : (lead || remote);
  const remainingSlots = normalizeAvailability(database.listIntegrationCache('dealer-appointment-availability', '', 500), Object.assign({}, settings || {}, {
    auto_appointments_min_notice_hours: 0,
    auto_appointments_max_days: 365
  }), new Date());
  const slotStillAvailable = remainingSlots.some(function sameSlot(item) {
    if (text(slot && slot.id) && text(item.id) === text(slot.id)) return true;
    return localDateKey(item.start) === wanted.appointment_date
      && String(item.start.getHours()).padStart(2, '0') + ':' + String(item.start.getMinutes()).padStart(2, '0') === wanted.appointment_time
      && (!text(wanted.store_id) || !text(item.store_id) || text(item.store_id) === text(wanted.store_id));
  });
  const responseReserved = reservationTrue(remote.reserved);
  const calendarReserved = Boolean(calendarAppointment);
  const leadComplete = leadContainsReservation(leadEvidence, wanted);
  return {
    marker: NEXA_APPOINTMENT_REMOTE_COMMIT_VERIFICATION_V1,
    verified: Boolean(responseReserved && ids.length && calendarReserved && leadComplete && !slotStillAvailable),
    response_reserved: responseReserved,
    remote_id_present: ids.length > 0,
    calendar_reserved: calendarReserved,
    lead_complete: leadComplete,
    slot_removed_from_availability: !slotStillAvailable,
    calendar_appointment_id: calendarAppointment ? text(calendarAppointment.appointment_id || calendarAppointment.id) : '',
    lead_id: lead ? text(lead.lead_id || lead.order_id || lead.id) : ''
  };
}

function contactFlowCancelled(message) {
  return /\b(no gracias|no quiero|cancelar|cancela|dejalo|déjalo|olvidalo|olvídalo|mejor no|never mind|no thanks|do not book|dont book|cancel it|forget it)\b/i.test(text(message));
}

function appointmentContactRequest(slot, locale, contact, missingFields) {
  const date = new Intl.DateTimeFormat(locale === 'es' ? 'es-US' : 'en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }).format(slot.start);
  const time = formatTime(slot.start, locale);
  const fields = Array.isArray(missingFields) ? missingFields : [];
  const known = contact && typeof contact === 'object' ? contact : {};
  const phoneOnly = (fields.length === 1 && fields[0] === 'customer_phone') || (Boolean(usableCustomerName(known.customer_name)) && !known.customer_phone);
  const nameOnly = fields.length === 1 && fields[0] === 'customer_name';
  if (locale === 'es') {
    const heading = nameOnly
      ? 'Para completar la reserva del ' + date + ' a las ' + time + ', ya tengo su teléfono. Copie y complete esta ficha:'
      : (phoneOnly
        ? 'Para completar la reserva del ' + date + ' a las ' + time + ', ya tengo su nombre. Copie y complete esta ficha:'
        : 'Para completar la reserva del ' + date + ' a las ' + time + ', copie y complete esta ficha:');
    const lines = [heading, ''];
    if (!phoneOnly) lines.push('Nombre: ____________________');
    if (!nameOnly) lines.push('Teléfono: __________________');
    if (!known.customer_email) lines.push('Email (opcional): __________');
    lines.push('', 'Mantendré esa fecha y hora mientras verifico y creo la reserva.');
    return lines.join('\n');
  }
  const heading = nameOnly
    ? 'To complete the reservation for ' + date + ' at ' + time + ', I already have your phone number. Copy and fill in this form:'
    : (phoneOnly
      ? 'To complete the reservation for ' + date + ' at ' + time + ', I already have your name. Copy and fill in this form:'
      : 'To complete the reservation for ' + date + ' at ' + time + ', copy and fill in this form:');
  const lines = [heading, ''];
  if (!phoneOnly) lines.push('Name: ______________________');
  if (!nameOnly) lines.push('Phone: _____________________');
  if (!known.customer_email) lines.push('Email (optional): __________');
  lines.push('', 'I will keep that date and time selected while I verify and create the reservation.');
  return lines.join('\n');
}

function appointmentContactReviewForm(slot, locale, contact) {
  const known = contact && typeof contact === 'object' ? contact : {};
  const customerName = usableCustomerName(known.customer_name);
  const customerPhone = phoneKey(known.customer_phone);
  const customerEmail = text(known.customer_email);
  const date = new Intl.DateTimeFormat(locale === 'es' ? 'es-US' : 'en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }).format(slot.start);
  const time = formatTime(slot.start, locale);
  if (locale === 'es') {
    return [
      'Antes de crear y confirmar la cita del ' + date + ' a las ' + time + ', revise esta ficha:',
      '',
      'Nombre: ' + (customerName || '____________________'),
      'Teléfono: ' + (customerPhone || '__________________'),
      'Email (opcional): ' + (customerEmail || '__________'),
      '',
      customerName && customerPhone
        ? 'Si los datos están correctos, responda: Confirmo datos. Si necesita corregirlos, copie la ficha y cambie el valor.'
        : 'Copie la ficha y complete los campos vacíos. Necesito por lo menos nombre y teléfono.',
      'La cita todavía no está confirmada; reservaré la hora en Dealer Agenda y crearé el Lead después de recibir esta ficha.'
    ].join('\n');
  }
  return [
    'Before creating and confirming the appointment for ' + date + ' at ' + time + ', review this form:',
    '',
    'Name: ' + (customerName || '____________________'),
    'Phone: ' + (customerPhone || '__________________'),
    'Email (optional): ' + (customerEmail || '__________'),
    '',
    customerName && customerPhone
      ? 'If the information is correct, reply: I confirm the information. To correct it, copy the form and change the value.'
      : 'Copy the form and complete the blank fields. I need at least a name and phone number.',
    'The appointment is not confirmed yet; I will reserve the Dealer Agenda time and create the Lead after receiving this form.'
  ].join('\n');
}

function hasRecentAppointmentOffer(conversation) {
  const messages = conversation && Array.isArray(conversation.messages) ? conversation.messages.slice(-16) : [];
  return messages.some(function offered(row) {
    if (String(row && row.direction || '').toLowerCase() !== 'outbound') return false;
    const body = text(row && row.body).toLowerCase();
    if (isAppointmentContactPrompt(body)) return false;
    return /(?:le reservo|desea que prepare|quiere que prepare|quiere que reserve|shall i reserve|would you like me to (?:prepare|book|reserve)|do you want me to (?:book|reserve))/.test(body);
  });
}

function isShortAppointmentAcceptance(message) {
  const source = text(message).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  return ['si', 'si por favor', 'por favor', 'dale', 'ok', 'okay', 'perfecto', 'de acuerdo', 'confirmo', 'yes', 'yes please', 'please', 'sounds good', 'i agree'].includes(source);
}

function pendingContactSelection(conversation, slots, referenceDate) {
  const messages = conversation && Array.isArray(conversation.messages) ? conversation.messages.slice(-40) : [];
  let requestIndex = -1;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const row = messages[index];
    if (String(row && row.direction || '').toLowerCase() !== 'outbound') continue;
    const body = text(row && row.body);
    if (isAppointmentContactPrompt(body)) {
      requestIndex = index;
      break;
    }
  }
  if (requestIndex < 0) return null;
  const request = messages[requestIndex];
  const requestBody = text(request && request.body).toLowerCase();
  const rowReference = request.sent_at || request.created_at ? new Date(request.sent_at || request.created_at) : referenceDate || new Date();
  const parsed = parseRequestedDateTime(request.body, Number.isNaN(rowReference.getTime()) ? referenceDate || new Date() : rowReference);
  if (!parsed.date || !parsed.time) return null;
  for (let index = requestIndex + 1; index < messages.length; index += 1) {
    const row = messages[index];
    const body = text(row && row.body);
    const direction = String(row && row.direction || '').toLowerCase();
    const laterReference = row && (row.sent_at || row.created_at) ? new Date(row.sent_at || row.created_at) : referenceDate || new Date();
    const later = parseRequestedDateTime(body, Number.isNaN(laterReference.getTime()) ? referenceDate || new Date() : laterReference);
    if (later.date && localDateKey(later.date) !== localDateKey(parsed.date)) return null;
    const explicitTime = /\b(a las|a la|hora|horario|at|time)\b/i.test(body);
    if (explicitTime && later.time && (later.time.hour !== parsed.time.hour || later.time.minute !== parsed.time.minute)) return null;
    if (direction === 'outbound' && body.toLowerCase() !== requestBody && later.date) return null;
  }
  const scoped = scopeSlotsForConversation(slots || [], conversation);
  const slot = scoped.find(function exact(candidate) {
    return Math.abs(candidate.start.getTime() - parsed.date.getTime()) <= 15 * 60000;
  }) || null;
  return { request: request, parsed: parsed, slot: slot, request_index: requestIndex };
}

function appointmentFailureReply(locale) {
  return locale === 'es'
    ? 'No pude completar esa reserva y no voy a marcarla como confirmada. La Agenda debe volver a verificar el horario; por favor elija una de las opciones verificadas que le mostraré o continúe por este chat para que el equipo le ayude.'
    : 'I could not complete that booking, so I will not mark it as confirmed. The Agenda must revalidate the time; please choose one of the verified options I provide or continue in this chat so the team can help.';
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
        never_edits_existing_customer_records: true,
        appointment_lead_creation_requires_authorization: true,
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

  saveConnectedResource(resource, response, items, requiredScope, itemCount) {
    const integration = this.database.getIntegrationStatus();
    const safeItems = Array.isArray(items) ? items : [];
    const checkedAt = response.receivedAt || nowIso();
    const count = Number.isFinite(Number(itemCount)) ? Number(itemCount) : safeItems.length;
    this.database.replaceIntegrationCache(resource, safeItems);
    if (typeof this.database.saveIntegrationSnapshot === 'function') {
      this.database.saveIntegrationSnapshot({
        resource: resource, payload_hash: stableHash(response.payload), item_count: count,
        payload_json: JSON.stringify(response.payload || {}), last_checked_at: checkedAt, last_changed_at: checkedAt
      });
    }
    if (typeof this.database.saveIntegrationResourceStatus === 'function') {
      this.database.saveIntegrationResourceStatus({
        resource: resource, account_type: integration.account_type || '', required_scope: requiredScope || '',
        allowed: 1, status: 'ok', item_count: count, http_status: response.status || 200,
        last_error: '', last_checked_at: checkedAt, last_success_at: checkedAt, duration_ms: response.durationMs || 0,
        payload_hash: stableHash(response.payload)
      });
    }
    return { refreshed: true, count: count, payload: response.payload };
  }

  async cacheDealerAppointmentAvailability(settings, queryInput) {
    const integration = this.database.getIntegrationStatus();
    const map = safeJson(integration.connection_map_json, {});
    const scopes = safeJson(integration.scopes_json, []);
    const capabilities = deriveAppointmentCapabilities({ scopes: scopes }, map);
    if (!capabilities.availabilityRead) return { refreshed: false, reason: 'dealer_appointment_availability_not_authorized' };
    const query = Object.assign({ from: localDateKey(new Date()), days: 14, limit: clamp(settings.auto_appointments_slot_limit, 1, 100) }, queryInput || {});
    if (String(integration.account_type || '').toLowerCase() === 'dealer' && text(integration.store_id)) query.store_id = text(integration.store_id);
    const response = await this.apiService.fetchDealerAppointmentAvailability(query);
    const items = availabilityCacheItems(response.payload);
    return this.saveConnectedResource('dealer-appointment-availability', response, items, 'dealer-appointment-availability:read', items.length);
  }

  async cacheDealerLeads(queryInput) {
    const integration = this.database.getIntegrationStatus();
    const map = safeJson(integration.connection_map_json, {});
    const scopes = normalizeScopes(safeJson(integration.scopes_json, []), map.scopes, map.allowed_scopes, map.permissions);
    const resources = extractAvailableResources(map);
    const accountType = String(integration.account_type || '').toLowerCase();
    const requiredScope = accountType === 'reseller' ? 'reseller:read' : 'orders:read';
    if (resources.length && !resources.includes('orders')) return { refreshed: false, reason: 'dealer_leads_resource_not_advertised' };
    if (scopes.length && !scopes.includes(requiredScope)) return { refreshed: false, reason: 'dealer_leads_scope_not_authorized', required_scope: requiredScope };
    const response = await this.apiService.fetchResource('orders', Object.assign({ limit: 100 }, queryInput || {}));
    const items = listFromPayload(response.payload);
    return this.saveConnectedResource('orders', response, items, requiredScope, items.length);
  }

  async cacheDealerAgendaContacts(queryInput) {
    const integration = this.database.getIntegrationStatus();
    const map = safeJson(integration.connection_map_json, {});
    const scopes = normalizeScopes(safeJson(integration.scopes_json, []), map.scopes, map.allowed_scopes, map.permissions);
    const resources = extractAvailableResources(map);
    if (resources.length && !resources.includes('agenda')) return { refreshed: false, reason: 'agenda_resource_not_advertised' };
    if (scopes.length && !scopes.includes('agenda:read')) return { refreshed: false, reason: 'agenda_scope_not_authorized', required_scope: 'agenda:read' };
    const response = await this.apiService.fetchResource('agenda', Object.assign({ limit: 100 }, queryInput || {}));
    const items = listFromPayload(response.payload);
    return this.saveConnectedResource('agenda', response, items, 'agenda:read', items.length);
  }

  async refreshAppointmentWebsiteState(settings, appointment) {
    const details = appointment && typeof appointment === 'object' ? appointment : {};
    const query = { from: text(details.appointment_date) || localDateKey(new Date()), days: 14 };
    if (text(details.store_id)) query.store_id = text(details.store_id);
    const result = { marker: NEXA_APPOINTMENT_PAGE_V8_SYNC_V1, compatibility_marker: NEXA_APPOINTMENT_PAGE_V7_SYNC_V1, availability: null, calendar: null, leads: null, agenda: null };
    try { result.availability = await this.cacheDealerAppointmentAvailability(settings, query); }
    catch (error) { result.availability = { refreshed: false, error: error.message }; }
    try { result.calendar = await this.cacheDealerAgendaCalendar(settings, query); }
    catch (error) { result.calendar = { refreshed: false, error: error.message }; }
    try { result.leads = await this.cacheDealerLeads({ limit: 100 }); }
    catch (error) { result.leads = { refreshed: false, error: error.message }; }
    try { result.agenda = await this.cacheDealerAgendaContacts({ limit: 100 }); }
    catch (error) { result.agenda = { refreshed: false, error: error.message }; }
    return result;
  }

  async refreshedUnavailableSlotReply(slot, conversation, settings, locale) {
    const refreshedSlots = await this.cacheAvailability(settings);
    const availabilityPayload = this.database.listIntegrationCache('dealer-appointment-availability', '', 500);
    const calendarSnapshot = this.database.listIntegrationCache('dealer-agenda-calendar', '', 500).find(function snapshot(item) { return item && item.record_type === 'calendar_snapshot'; });
    const payload = calendarSnapshot ? availabilityPayload.concat([calendarSnapshot]) : availabilityPayload;
    const date = localDateKey(slot.start);
    const time = formatTime(slot.start, locale);
    const message = locale === 'es'
      ? 'Quiero reservar una cita el ' + date + ' a las ' + time + '. Si ya no está disponible, ofréceme otros horarios verificados de ese día.'
      : 'I want to book an appointment on ' + date + ' at ' + time + '. If it is no longer available, offer other verified times that day.';
    const plan = appointmentConversationPlan({ payload: payload, slots: refreshedSlots, conversation: conversation, message: message, locale: locale, referenceDate: new Date() });
    return text(plan.response) || appointmentFailureReply(locale);
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

  async createAppointmentFromSlot(candidate, conversation, slot, settings, contactOverride) {
    const sourceMessageId = text(candidate.inbound_message_id);
    const dedupeKey = 'auto-appointment:' + sourceMessageId + ':' + slot.id;
    const contact = contactFromConversation(conversation, contactOverride, this.database);
    const integration = this.getState().integration;
    const remoteRequested = enabled(settings.auto_appointments_create_remote);
    if (remoteRequested && !integration.appointment_create) {
      return {
        failed: true,
        reason: 'website_appointment_creation_not_ready',
        error: 'The website reservation is authorized, but appointment-create is not ready. Nexa did not create or confirm a local-only appointment.'
      };
    }
    const missingFields = [];
    if (!contact.customer_name) missingFields.push('customer_name');
    if (!contact.customer_phone) missingFields.push('customer_phone');
    if (missingFields.length) {
      return { needsContact: true, reason: 'customer_identity_required', slot: slot, contact: contact, missing_fields: missingFields };
    }
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
      const customerName = contact.customer_name || 'Website customer';
      const customerPhone = contact.customer_phone;
      const customerEmail = contact.customer_email;
      let remoteAppointmentId = null;
      let websiteRefresh = null;
      let remoteLeadId = null;
      let remoteOrderId = null;
      let remoteReserved = false;
      let remoteLeadUrl = '';
      let remoteReservedSlotKey = '';
      let remoteRefreshResources = [];
      let reservationVerification = null;
      if (remoteRequested) {
        const appointmentDate = localDateKey(slot.start);
        const appointmentTime = String(slot.start.getHours()).padStart(2, '0') + ':' + String(slot.start.getMinutes()).padStart(2, '0');
        const contextType = text(thread.context_type || payload.context_type).toLowerCase();
        const contextListingId = contextType.includes('listing') ? text(thread.context_id || payload.context_id) : '';
        // For an order/Lead thread, context_id is the order ID. Omitting
        // listing_id lets AutoMarket Pro V7 derive the real listing safely.
        const listingId = text(slot.listing_id || payload.listing_id || contextListingId);
        const remote = await this.apiService.createRemoteAppointment({
          thread_id: candidate.thread_id, listing_id: listingId, customer_name: customerName, customer_phone: customerPhone, customer_email: customerEmail,
          customer_location: text(contact.customer_location || payload.customer_location || thread.customer_location || slot.location),
          appointment_date: appointmentDate, appointment_time: appointmentTime,
          notes: 'Customer confirmed the appointment through Nexa Smart Office Bot. Reserve this exact Dealer Agenda slot and add the completed appointment to Dealer Leads.'
        }, dedupeKey);
        const remotePayload = remote.payload && typeof remote.payload === 'object' ? remote.payload : {};
        remoteAppointmentId = text(remotePayload.appointment_id || remotePayload.lead_id || remotePayload.order_id || remotePayload.id);
        remoteLeadId = text(remotePayload.lead_id || remotePayload.order_id);
        remoteOrderId = text(remotePayload.order_id || remotePayload.lead_id);
        remoteReserved = reservationTrue(remotePayload.reserved);
        remoteLeadUrl = text(remotePayload.lead_url);
        remoteReservedSlotKey = text(remotePayload.reserved_slot_key);
        remoteRefreshResources = Array.isArray(remotePayload.refresh_resources) ? remotePayload.refresh_resources.map(text).filter(Boolean) : [];
        if (remote.raw && remote.raw.ok === false) throw new Error(text(remote.raw.message) || 'The website did not create the appointment Lead.');
        if (!remoteAppointmentId || !remoteReserved) throw new Error('The website created an incomplete Lead response but did not confirm reserved=true for the Dealer Agenda slot.');
        websiteRefresh = await this.refreshAppointmentWebsiteState(settings, {
          appointment_date: appointmentDate,
          store_id: slot.store_id || remotePayload.store_id || ''
        });
        const expectedReservation = {
          appointment_date: appointmentDate,
          appointment_time: appointmentTime,
          customer_name: customerName,
          customer_phone: customerPhone,
          store_id: text(slot.store_id || remotePayload.store_id)
        };
        reservationVerification = remoteReservationVerification(this.database, slot, remotePayload, expectedReservation, settings, websiteRefresh);
        if (!reservationVerification.verified) {
          // Never repeat the POST. Refresh the website state once more so a
          // hosting cache cannot cause a false failure or a duplicate Lead.
          websiteRefresh = await this.refreshAppointmentWebsiteState(settings, {
            appointment_date: appointmentDate,
            store_id: slot.store_id || remotePayload.store_id || ''
          });
          reservationVerification = remoteReservationVerification(this.database, slot, remotePayload, expectedReservation, settings, websiteRefresh);
        }
        if (!reservationVerification.verified) {
          const missing = [];
          if (!reservationVerification.calendar_reserved) missing.push('Dealer Agenda appointment');
          if (!reservationVerification.lead_complete) missing.push('completed Dealer Lead');
          if (!reservationVerification.slot_removed_from_availability) missing.push('blocked availability slot');
          throw new Error('The website did not finish the reservation transaction: missing ' + missing.join(', ') + '. Nexa did not confirm the appointment to the customer.');
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
      this.database.completeAutomaticActionEvent(event.id, { status: 'completed', engine: 'availability', confidence: 1, summary: 'Appointment Lead and Dealer Agenda reservation verified', payload: { appointment_id: saved.id, remote_appointment_id: remoteAppointmentId, lead_id: remoteLeadId, order_id: remoteOrderId, reserved: remoteReserved, reserved_slot_key: remoteReservedSlotKey, refresh_resources: remoteRefreshResources, lead_url: remoteLeadUrl, slot_id: slot.id, thread_id: candidate.thread_id, reservation_verification: reservationVerification, website_refresh: websiteRefresh } });
      await this.notify('Nexa created an authorized appointment', customerName + ' · ' + formatSlot(slot), 'success', 'auto-appointment-notification:' + sourceMessageId, { appointment_id: saved.id, thread_id: candidate.thread_id });
      return { created: true, appointment: saved, customerName: customerName, remote_appointment_id: remoteAppointmentId, lead_id: remoteLeadId, order_id: remoteOrderId, reserved: remoteReserved, reserved_slot_key: remoteReservedSlotKey, refresh_resources: remoteRefreshResources, lead_url: remoteLeadUrl, reservation_verification: reservationVerification, website_refresh: websiteRefresh };
    } catch (error) {
      if (Number(error && error.status || 0) === 409) {
        const appointmentDate = localDateKey(slot.start);
        const websiteRefresh = await this.refreshAppointmentWebsiteState(settings, { appointment_date: appointmentDate, store_id: slot.store_id || '' });
        this.database.completeAutomaticActionEvent(event.id, { status: 'blocked', engine: 'availability', summary: 'Website slot changed before reservation', error: error.message, payload: { slot_id: slot.id, thread_id: candidate.thread_id, website_refresh: websiteRefresh } });
        return { slotUnavailable: true, reason: 'website_slot_changed', error: error.message, website_refresh: websiteRefresh };
      }
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
    const locale = detectAppointmentLocale(message, conversation);
    const pendingContact = contactFlowCancelled(message) ? null : pendingContactSelection(conversation, slots, new Date());
    if (pendingContact) {
      if (!pendingContact.slot) {
        const requestedDate = localDateKey(pendingContact.parsed.date);
        const requestedTime = formatTime(pendingContact.parsed.date, locale);
        const revalidation = appointmentConversationPlan({
          payload: liveAppointmentPayload,
          slots: slots,
          conversation: conversation,
          message: locale === 'es' ? '¿Sigue disponible la cita el ' + requestedDate + ' a las ' + requestedTime + '?' : 'Is the appointment on ' + requestedDate + ' at ' + requestedTime + ' still available?',
          locale: locale,
          referenceDate: new Date()
        });
        const body = text(revalidation.response) || appointmentFailureReply(locale);
        if (enabled(settings.auto_messages_enabled) && this.canSendMore(settings)) {
          const sent = await this.sendAutomaticMessage(candidate.thread_id, body, candidate.inbound_message_id, { engine: 'availability', confidence: 1 }, settings, 'Appointment time revalidated after contact collection');
          return { handled: true, sent: Boolean(sent && sent.sent), failed: Boolean(sent && sent.failed), error: sent && sent.error, reason: sent && sent.failed ? 'appointment_revalidation_send_failed' : '' };
        }
        return { handled: true, skipped: true, reason: 'appointment_time_changed' };
      }
      const suppliedContact = extractCustomerContact(message);
      const recovered = await this.createAppointmentFromSlot(candidate, conversation, pendingContact.slot, settings, suppliedContact);
      if (recovered.created && enabled(settings.auto_messages_enabled) && enabled(settings.auto_appointments_send_confirmation) && this.canSendMore(settings)) {
        const confirmation = appointmentConfirmation(pendingContact.slot, locale, liveAppointmentPayload);
        const sent = await this.sendAutomaticMessage(candidate.thread_id, confirmation, candidate.inbound_message_id, { engine: 'availability', confidence: 1 }, settings, 'Appointment confirmation sent after contact collection');
        return { handled: true, appointment: recovered, confirmation: sent, failed: Boolean(sent && sent.failed), error: sent && sent.error };
      }
      if (recovered.created) return { handled: true, appointment: recovered };
      if (recovered.needsContact && enabled(settings.auto_messages_enabled) && this.canSendMore(settings)) {
        const sent = await this.sendAutomaticMessage(candidate.thread_id, appointmentContactRequest(pendingContact.slot, locale, recovered.contact, recovered.missing_fields), candidate.inbound_message_id, { engine: 'availability', confidence: 1 }, settings, 'Appointment contact information requested again');
        return { handled: true, sent: Boolean(sent && sent.sent), failed: Boolean(sent && sent.failed), error: sent && sent.error, reason: 'customer_identity_required' };
      }
      if ((recovered.failed || recovered.skipped || recovered.slotUnavailable) && enabled(settings.auto_messages_enabled) && this.canSendMore(settings)) {
        const reply = recovered.slotUnavailable ? await this.refreshedUnavailableSlotReply(pendingContact.slot, conversation, settings, locale) : appointmentFailureReply(locale);
        const sent = await this.sendAutomaticMessage(candidate.thread_id, reply, candidate.inbound_message_id, { engine: 'availability', confidence: 1 }, settings, recovered.slotUnavailable ? 'Updated appointment alternatives sent' : 'Appointment creation failure explained');
        return { handled: true, sent: Boolean(sent && sent.sent), failed: Boolean(sent && sent.failed), error: recovered.error || sent && sent.error, reason: recovered.reason || 'appointment_creation_failed' };
      }
      return { handled: true, appointment: recovered, reason: recovered.reason || 'appointment_creation_failed', failed: Boolean(recovered.failed), error: recovered.error };
    }
    const plan = appointmentConversationPlan({
      payload: liveAppointmentPayload,
      slots: slots,
      conversation: conversation,
      message: message,
      referenceDate: new Date()
    });
    if (!plan.relevant) return { handled: false };
    if (plan.shouldCreate && plan.selectedSlot) {
      if (hasRecentAppointmentOffer(conversation) || isShortAppointmentAcceptance(message)) {
        const contact = contactFromConversation(conversation, null, this.database);
        if (enabled(settings.auto_messages_enabled) && this.canSendMore(settings)) {
          const form = appointmentContactReviewForm(plan.selectedSlot, plan.locale, contact);
          const sent = await this.sendAutomaticMessage(candidate.thread_id, form, candidate.inbound_message_id, { engine: 'availability', confidence: 1 }, settings, 'Appointment contact checkpoint sent before website reservation');
          return { handled: true, sent: Boolean(sent && sent.sent), failed: Boolean(sent && sent.failed), error: sent && sent.error, reason: 'prebook_contact_checkpoint' };
        }
        return { handled: true, skipped: true, reason: 'prebook_contact_checkpoint_not_sent' };
      }
      const created = await this.createAppointmentFromSlot(candidate, conversation, plan.selectedSlot, settings);
      if (created.needsContact) {
        if (enabled(settings.auto_messages_enabled) && this.canSendMore(settings)) {
          const sent = await this.sendAutomaticMessage(candidate.thread_id, appointmentContactRequest(plan.selectedSlot, plan.locale, created.contact, created.missing_fields), candidate.inbound_message_id, { engine: 'availability', confidence: 1 }, settings, 'Appointment contact information requested');
          return { handled: true, sent: Boolean(sent && sent.sent), failed: Boolean(sent && sent.failed), error: sent && sent.error, reason: 'customer_identity_required' };
        }
        return { handled: true, skipped: true, reason: 'customer_identity_required' };
      }
      if (created.created && enabled(settings.auto_messages_enabled) && enabled(settings.auto_appointments_send_confirmation) && this.canSendMore(settings)) {
        const confirmation = appointmentConfirmation(plan.selectedSlot, plan.locale, liveAppointmentPayload);
        await this.sendAutomaticMessage(candidate.thread_id, confirmation, candidate.inbound_message_id, { engine: 'availability', confidence: 1 }, settings, 'Appointment confirmation sent');
      }
      if ((created.failed || created.skipped || created.slotUnavailable) && enabled(settings.auto_messages_enabled) && this.canSendMore(settings)) {
        const reply = created.slotUnavailable ? await this.refreshedUnavailableSlotReply(plan.selectedSlot, conversation, settings, plan.locale) : appointmentFailureReply(plan.locale);
        const sent = await this.sendAutomaticMessage(candidate.thread_id, reply, candidate.inbound_message_id, { engine: 'availability', confidence: 1 }, settings, created.slotUnavailable ? 'Updated appointment alternatives sent' : 'Appointment creation failure explained');
        return { handled: true, appointment: created, sent: Boolean(sent && sent.sent), failed: Boolean(sent && sent.failed), error: created.error || sent && sent.error, reason: created.reason || 'appointment_creation_failed' };
      }
      return { handled: true, appointment: created, failed: Boolean(created.failed), error: created.error, reason: created.reason || '' };
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
  NEXA_APPOINTMENT_CONTACT_RECOVERY_V1,
  NEXA_APPOINTMENT_THREAD_LEAD_CREATION_V2,
  NEXA_APPOINTMENT_PAGE_V7_SYNC_V1,
  NEXA_APPOINTMENT_PAGE_V8_SYNC_V1,
  NEXA_APPOINTMENT_CONTACT_CONTEXT_V3,
  NEXA_APPOINTMENT_REMOTE_COMMIT_VERIFICATION_V1,
  NEXA_STRUCTURED_APPOINTMENT_CONTACT_FORM_V1,
  NEXA_PREBOOK_CONTACT_CHECKPOINT_V1,
  NEXA_APPOINTMENT_BARE_ACCEPTANCE_GUARD_V1,
  availabilityStart,
  classifyRisk,
  inQuietHours,
  isAppointmentIntent,
  normalizeAvailability,
  parseRequestedDateTime,
  safeDeferredKnowledge,
  extractCustomerContact,
  usableCustomerName,
  appointmentContactRequest,
  appointmentContactReviewForm,
  contactFromConversation,
  hasRecentAppointmentOffer,
  isShortAppointmentAcceptance
};
