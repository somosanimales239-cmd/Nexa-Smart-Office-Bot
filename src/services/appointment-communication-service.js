'use strict';

const {
  compactAvailabilityContext,
  dailyScheduleWindow,
  dateAvailabilityState,
  isAppointmentAvailabilityIntent,
  localDateKey,
  parseRequestedDateTime
} = require('./dealer-availability-service');
const {
  appointmentResponse,
  appointmentTopicActive,
  classifyAppointmentMessage,
  conversationTimePreference,
  hasAppointmentTopicAnchor,
  isExplicitAppointmentTopicSwitch,
  normalize: libraryNormalize
} = require('./appointment-communication-library-service');

const NEXA_PRO_APPOINTMENT_COMMUNICATION_V1 = 'NEXA_PRO_APPOINTMENT_COMMUNICATION_V1';
const NEXA_CONTEXTUAL_TIME_SELECTION_V1 = 'NEXA_CONTEXTUAL_TIME_SELECTION_V1';
const NEXA_APPOINTMENT_STATE_MACHINE_V2 = 'NEXA_APPOINTMENT_STATE_MACHINE_V2';

function text(value) { return String(value === undefined || value === null ? '' : value).trim(); }
function normalized(value) { return libraryNormalize(value); }

function conversationMessages(conversation) {
  return conversation && Array.isArray(conversation.messages) ? conversation.messages : [];
}

function conversationAppointmentScope(conversation) {
  const thread = conversation && conversation.thread && typeof conversation.thread === 'object' ? conversation.thread : {};
  let payload = {};
  try { payload = typeof thread.payload_json === 'string' ? JSON.parse(thread.payload_json) : thread.payload_json || {}; } catch (_) { payload = {}; }
  const contextType = normalized(thread.context_type || payload.context_type);
  const contextId = text(thread.context_id || payload.context_id);
  return {
    store_id: text(thread.store_id || payload.store_id),
    dealer_id: text(thread.dealer_id || payload.dealer_id),
    listing_id: text(thread.listing_id || payload.listing_id || (/listing|vehicle|inventory/.test(contextType) ? contextId : ''))
  };
}

function scopeSlotsForConversation(slots, conversation) {
  const scope = conversationAppointmentScope(conversation);
  if (!scope.store_id && !scope.dealer_id && !scope.listing_id) return (slots || []).slice();
  return (slots || []).filter(function inConversationScope(slot) {
    if (!slot) return false;
    for (const key of ['store_id', 'dealer_id', 'listing_id']) {
      const expected = text(scope[key]);
      const actual = text(slot[key] || slot.raw && slot.raw[key]);
      if (expected && actual && expected !== actual) return false;
    }
    return true;
  });
}

function detectAppointmentLocale(message, conversation, fallback) {
  const source = normalized([message].concat(conversationMessages(conversation).slice(-10).map(function body(row) { return row && row.body; })).join(' '));
  const spanish = ['cita', 'horario', 'disponibilidad', 'disponible', 'manana', 'dia', 'ninguno', 'conviene', 'puedo', 'quiero', 'gracias', 'visita', 'reservar', 'agendar', 'ese', 'otra'];
  const english = ['appointment', 'schedule', 'availability', 'available', 'tomorrow', 'day', 'none', 'works', 'want', 'thanks', 'visit', 'book', 'that', 'another'];
  let es = 0;
  let en = 0;
  spanish.forEach(function score(word) { if (new RegExp('\\b' + word + '\\b').test(source)) es += 1; });
  english.forEach(function score(word) { if (new RegExp('\\b' + word + '\\b').test(source)) en += 1; });
  if (es === en && (fallback === 'es' || fallback === 'en')) return fallback;
  return es > en ? 'es' : 'en';
}

function appointmentConversationActive(conversation, latestMessage) {
  if (appointmentTopicActive(conversation, latestMessage)) return true;
  const rows = conversationMessages(conversation).slice(-20);
  return rows.some(function appointmentRow(row) {
    const body = text(row && row.body);
    return body !== text(latestMessage) && isAppointmentAvailabilityIntent(body);
  });
}

function appointmentFollowUpType(message, hasContext, locale) {
  if (!hasContext) return 'none';
  const classified = classifyAppointmentMessage(message, locale || 'en', true);
  if (['same_day_alternative', 'reject_offered_times'].includes(classified.intent)) return 'same_day_alternative';
  if (classified.intent === 'next_day_alternative') return 'alternative';
  if (classified.intent === 'decline_appointment') return 'decline';
  if (['select_first', 'select_second', 'select_third'].includes(classified.intent)) return 'selection';
  if (classified.intent === 'accept_recommendation') return 'acceptance';
  if (parseRequestedDateTime(message, new Date()).time) return 'selection';
  return classified.matched ? 'contextual' : 'none';
}

function lastRequestedDate(conversation, latestMessage, referenceDate) {
  const rows = conversationMessages(conversation).slice(-24).reverse();
  let skippedLatest = false;
  for (const row of rows) {
    if (!row || normalized(row.direction) === 'outbound') continue;
    const body = text(row.body);
    if (!skippedLatest && body === text(latestMessage)) { skippedLatest = true; continue; }
    const rowReference = row.sent_at || row.created_at ? new Date(row.sent_at || row.created_at) : referenceDate;
    const parsed = parseRequestedDateTime(body, Number.isNaN(rowReference.getTime()) ? referenceDate : rowReference);
    if (parsed.date) return parsed.date;
  }
  return null;
}

function latestAppointmentDate(conversation, latestMessage, referenceDate) {
  const now = referenceDate || new Date();
  const current = parseRequestedDateTime(latestMessage, now);
  if (current.date) return current.date;
  const rows = conversationMessages(conversation).slice(-40).reverse();
  let skippedLatest = false;
  for (const row of rows) {
    if (!row) continue;
    const body = text(row.body);
    if (!skippedLatest && body === text(latestMessage) && normalized(row.direction) !== 'outbound') {
      skippedLatest = true;
      continue;
    }
    const rowReference = row.sent_at || row.created_at ? new Date(row.sent_at || row.created_at) : now;
    const parsed = parseRequestedDateTime(body, Number.isNaN(rowReference.getTime()) ? now : rowReference);
    if (parsed.date) return parsed.date;
  }
  return null;
}

function groupSlotsByDay(slots) {
  const groups = new Map();
  (slots || []).forEach(function addSlot(slot) {
    if (!slot || !(slot.start instanceof Date) || Number.isNaN(slot.start.getTime())) return;
    const key = localDateKey(slot.start);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(slot);
  });
  return Array.from(groups.entries()).map(function mapGroup(entry) {
    return { key: entry[0], date: new Date(entry[0] + 'T12:00:00'), slots: entry[1].sort(function sort(a, b) { return a.start - b.start; }) };
  }).sort(function sortGroups(a, b) { return a.date - b.date; });
}

function requestedOrdinal(message, classification) {
  const intent = classification && classification.intent;
  if (intent === 'select_first' || /\b(el primero|la primera|primero|first one|the first)\b/.test(normalized(message))) return 0;
  if (intent === 'select_second' || /\b(el segundo|la segunda|segundo|second one|the second)\b/.test(normalized(message))) return 1;
  if (intent === 'select_third' || /\b(el tercero|la tercera|tercero|third one|the third)\b/.test(normalized(message))) return 2;
  return null;
}

function formatDate(value, locale) {
  return new Intl.DateTimeFormat(locale === 'es' ? 'es-US' : 'en-US', { weekday: 'long', month: 'long', day: 'numeric' }).format(value);
}

function formatTime(value, locale) {
  return new Intl.DateTimeFormat(locale === 'es' ? 'es-US' : 'en-US', { hour: 'numeric', minute: '2-digit', hour12: true }).format(value)
    .replace(/\s+/g, ' ').replace(/a\.\s*m\./i, 'AM').replace(/p\.\s*m\./i, 'PM').trim();
}

function formatMinutes(value, locale) {
  const date = new Date(2020, 0, 1, Math.floor(value / 60), value % 60, 0, 0);
  return formatTime(date, locale);
}

function lastOfferedGroupKey(conversation, groups, locale) {
  const outbound = conversationMessages(conversation).slice(-20).reverse().filter(function onlyOutbound(row) { return normalized(row && row.direction) === 'outbound'; });
  for (const row of outbound) {
    const body = normalized(row && row.body);
    for (const group of groups) {
      if (body.includes(normalized(formatDate(group.date, locale)))) return group.key;
    }
    const rowReference = row.sent_at || row.created_at ? new Date(row.sent_at || row.created_at) : new Date();
    const parsed = parseRequestedDateTime(text(row && row.body), Number.isNaN(rowReference.getTime()) ? new Date() : rowReference);
    if (parsed.date) return localDateKey(parsed.date);
    let best = null;
    groups.forEach(function countTimes(group) {
      const matches = group.slots.filter(function mentioned(slot) { return body.includes(normalized(formatTime(slot.start, locale))); }).length;
      if (matches && (!best || matches > best.matches)) best = { key: group.key, matches: matches };
    });
    if (best) return best.key;
  }
  return '';
}

function previousOrEarliestDay(conversation, latestMessage, groups, referenceDate, locale) {
  const activeDate = latestAppointmentDate(conversation, latestMessage, referenceDate);
  if (activeDate) return localDateKey(activeDate);
  const offered = lastOfferedGroupKey(conversation, groups, locale);
  if (offered) return offered;
  return groups.length ? groups[0].key : '';
}

function slotMinutes(slot) { return slot.start.getHours() * 60 + slot.start.getMinutes(); }

function slotMatchesRequestedTime(slot, requestedTime) {
  if (!slot || !requestedTime) return false;
  const hour = slot.start.getHours();
  if (slot.start.getMinutes() !== requestedTime.minute) return false;
  if (hour === requestedTime.hour) return true;
  return requestedTime.ambiguous === true && hour % 12 === requestedTime.hour % 12;
}

function rankSlotsForPreference(slots, preference, limit) {
  const source = (slots || []).slice();
  let matched = source.slice();
  let preferenceMatched = true;
  if (preference && preference.type === 'after') {
    matched = source.filter(function after(slot) { return slotMinutes(slot) >= preference.minutes; }).sort(function closestAfter(a, b) { return a.start - b.start; });
    if (!matched.length) { preferenceMatched = false; matched = source.sort(function latest(a, b) { return b.start - a.start; }); }
  } else if (preference && preference.type === 'before') {
    matched = source.filter(function before(slot) { return slotMinutes(slot) <= preference.minutes; }).sort(function closestBefore(a, b) { return b.start - a.start; });
    if (!matched.length) { preferenceMatched = false; matched = source.sort(function earliest(a, b) { return a.start - b.start; }); }
  } else if (preference && preference.type === 'period') {
    matched = source.filter(function inPeriod(slot) { const minutes = slotMinutes(slot); return minutes >= preference.start && minutes < preference.end; }).sort(function chronological(a, b) { return a.start - b.start; });
    if (!matched.length) {
      preferenceMatched = false;
      const center = (preference.start + preference.end) / 2;
      matched = source.sort(function nearestPeriod(a, b) { return Math.abs(slotMinutes(a) - center) - Math.abs(slotMinutes(b) - center); });
    }
  } else matched.sort(function chronological(a, b) { return a.start - b.start; });
  return { slots: matched.slice(0, Math.max(1, Number(limit || 3))), preferenceMatched: preferenceMatched };
}

function previouslyOfferedSlots(conversation, group, locale) {
  const outbound = conversationMessages(conversation).slice(-12).reverse().find(function appointmentOffer(row) {
    if (normalized(row && row.direction) !== 'outbound') return false;
    const body = normalized(row && row.body);
    return group.slots.some(function hasTime(slot) { return body.includes(normalized(formatTime(slot.start, locale))); });
  });
  if (!outbound) return [];
  const body = normalized(outbound.body);
  return group.slots.filter(function mentioned(slot) { return body.includes(normalized(formatTime(slot.start, locale))); });
}

function lastOfferedSlots(conversation, groups, locale, contextDay) {
  const fixedGroup = contextDay ? groups.find(function sameDay(group) { return group.key === contextDay; }) : null;
  const outbound = conversationMessages(conversation).slice(-24).reverse().filter(function appointmentOffer(row) {
    return normalized(row && row.direction) === 'outbound';
  });
  for (const row of outbound) {
    const body = normalized(row && row.body);
    const rowReference = row.sent_at || row.created_at ? new Date(row.sent_at || row.created_at) : new Date();
    const parsed = parseRequestedDateTime(text(row && row.body), Number.isNaN(rowReference.getTime()) ? new Date() : rowReference);
    const parsedKey = parsed.date ? localDateKey(parsed.date) : '';
    if (contextDay && parsedKey && parsedKey !== contextDay) continue;
    const rowGroups = fixedGroup ? [fixedGroup] : groups;
    const candidates = rowGroups.reduce(function flatten(output, group) { return output.concat(group.slots); }, []);
    const mentioned = candidates.map(function withPosition(slot) {
      return { slot: slot, position: body.indexOf(normalized(formatTime(slot.start, locale))) };
    }).filter(function mentionedTime(item) { return item.position >= 0; })
      .sort(function responseOrder(a, b) { return a.position - b.position || a.slot.start - b.slot.start; })
      .filter(function unique(item, index, rows) { return rows.findIndex(function same(candidate) { return candidate.slot.id === item.slot.id; }) === index; })
      .map(function unwrap(item) { return item.slot; });
    if (mentioned.length) return mentioned;
  }
  return [];
}

function resolveSlotSelection(message, conversation, slots, referenceDate, locale, preference, followUpType, classification) {
  const now = referenceDate || new Date();
  const requested = parseRequestedDateTime(message, now);
  const groups = groupSlotsByDay(slots);
  if (requested.date && requested.exact) {
    const selected = (slots || []).find(function exact(slot) { return Math.abs(slot.start.getTime() - requested.date.getTime()) <= 15 * 60000; }) || null;
    return { selected: selected, requested: requested, reference_day: localDateKey(requested.date) };
  }
  const contextDay = requested.date ? localDateKey(requested.date) : previousOrEarliestDay(conversation, message, groups, now, locale);
  const daySlots = contextDay ? (groups.find(function sameDay(group) { return group.key === contextDay; }) || {}).slots || [] : [];
  const contextualPool = contextDay ? daySlots : slots;
  const ranked = rankSlotsForPreference(contextualPool, preference, 3).slots;
  const offered = lastOfferedSlots(conversation, groups, locale, contextDay);
  const ordinal = requestedOrdinal(message, classification);
  if (ordinal !== null) return { selected: offered[ordinal] || ranked[ordinal] || null, requested: requested, reference_day: contextDay };
  if (requested.time) {
    const pool = contextDay ? daySlots : (slots || []);
    let matching = offered.filter(function offeredTime(slot) { return slotMatchesRequestedTime(slot, requested.time); });
    if (!matching.length) matching = pool.filter(function sameTime(slot) { return slotMatchesRequestedTime(slot, requested.time); });
    if (!matching.length && contextDay) {
      const broadOffered = lastOfferedSlots(conversation, groups, locale, '').filter(function offeredTime(slot) { return slotMatchesRequestedTime(slot, requested.time); });
      const offeredDays = new Set(broadOffered.map(function day(slot) { return localDateKey(slot.start); }));
      if (offeredDays.size === 1) matching = broadOffered;
    }
    return { selected: matching.length ? matching[0] : null, requested: requested, reference_day: contextDay };
  }
  if (followUpType === 'acceptance') return { selected: offered[0] || ranked[0] || null, requested: requested, reference_day: contextDay };
  return { selected: null, requested: requested, reference_day: contextDay };
}

function requestedTimeWasOffered(conversation, requestedTime) {
  if (!requestedTime) return false;
  return conversationMessages(conversation).slice(-16).reverse().some(function offered(row) {
    if (normalized(row && row.direction) !== 'outbound') return false;
    const body = normalized(row && row.body);
    const matches = body.matchAll(/\b(\d{1,2})(?::(\d{2}))\s*(am|pm)?\b/g);
    for (const match of matches) {
      let hour = Number(match[1]);
      const minute = Number(match[2] || 0);
      const period = match[3] || '';
      if (period === 'pm' && hour < 12) hour += 12;
      if (period === 'am' && hour === 12) hour = 0;
      if (minute !== requestedTime.minute) continue;
      if (hour === requestedTime.hour || requestedTime.ambiguous === true && hour % 12 === requestedTime.hour % 12) return true;
    }
    return false;
  });
}

function explicitBookingCommitment(message, hasContext, followUpType, selected, classification) {
  if (!selected) return false;
  if (classification && ['select_first', 'select_second', 'select_third', 'accept_recommendation', 'select_explicit_time'].includes(classification.intent)) return hasContext;
  const source = normalized(message);
  if (hasContext && classification && classification.intent === 'correct_date' && /\b\d{1,2}(?::\d{2})?\b/.test(source)) return true;
  if (hasContext && /\b(como te dije|la hora que te dije|as i said|the time i said)\b/.test(source) && /\b\d{1,2}(?::\d{2})?\b/.test(source)) return true;
  if (/\b(quiero (?:hacer |agendar |reservar )?(?:una |la )?cita|agendame|reservame|puede agendar|puedes agendar|hacer una cita|schedule (?:an|the|my) appointment|book (?:an|the|my) appointment|reserve (?:the|this) time|i ll take|tomare)\b/.test(source)) return true;
  if (/\b(can i schedule|could you schedule|please schedule|me conviene|me sirve|perfecto|that works|works for me)\b/.test(source)) return true;
  if (/\b(que tal|como seria|tienes|hay|puedo|podria|seria posible|what about|how about|do you have|is it available|is that available)\b/.test(source)) return false;
  if (hasContext && /\b(ok|okay|esta bien|de acuerdo|nos vemos|confirmado|confirmada|yes|si|sounds good|see you there)\b/.test(source)) return true;
  return hasContext && followUpType === 'acceptance';
}

function dealerLabel(contact, locale) {
  return text(contact.store_name || contact.dealer_name) || (locale === 'es' ? 'el dealer' : 'the dealer');
}

function joinedContactMethods(methods, locale) {
  const values = Array.isArray(methods) ? methods.filter(Boolean) : [];
  if (!values.length) return locale === 'es' ? 'escribirnos por este mismo chat' : 'message us in this same chat';
  if (values.length === 1) return values[0];
  if (values.length === 2) return values[0] + (locale === 'es' ? ' o ' : ' or ') + values[1];
  const finalMethod = values[values.length - 1];
  return values.slice(0, -1).join(', ') + (locale === 'es' ? ' o ' : ', or ') + finalMethod;
}

function contactAction(contact, locale, options) {
  const input = options && typeof options === 'object' ? options : {};
  const methods = [];
  if (contact.phone) methods.push(locale === 'es' ? 'llamarnos al ' + contact.phone : 'call us at ' + contact.phone);
  if (contact.email) methods.push(locale === 'es' ? 'escribir a ' + contact.email : 'email ' + contact.email);
  if (input.includeLocation !== false && contact.location) methods.push(locale === 'es' ? 'visitarnos en ' + contact.location : 'visit us at ' + contact.location);
  methods.push(locale === 'es' ? 'escribirnos por este mismo chat' : 'message us in this same chat');
  return joinedContactMethods(methods, locale);
}

function contactClosing(contact, locale, seed) {
  return appointmentResponse('decline', locale, { dealer: dealerLabel(contact, locale), contact: contactAction(contact, locale) }, seed);
}

function slotListText(daySlots, locale) {
  return (daySlots || []).map(function time(slot) { return formatTime(slot.start, locale); }).join(locale === 'es' ? ', ' : ', ');
}

function dayOffer(payload, group, locale, prefix, options) {
  const input = options || {};
  const contact = compactAvailabilityContext(payload, {}, input.referenceDate || new Date());
  const window = dailyScheduleWindow(payload, group.date, group.slots);
  const parts = [];
  if (prefix) parts.push(prefix);
  if (window) {
    parts.push(appointmentResponse(window.source === 'verified_slots' ? 'verified_window' : 'dealer_hours', locale, {
      dealer: dealerLabel(contact, locale), date: formatDate(group.date, locale),
      start: formatMinutes(window.start_minutes, locale), end: formatMinutes(window.end_minutes, locale)
    }, group.key));
  }
  const ranked = rankSlotsForPreference(group.slots, input.preference, 3);
  const recommended = ranked.slots[0] || null;
  const alternatives = ranked.slots.slice(1);
  if (!recommended) return { response: parts.join(' '), recommendedSlot: null, offeredSlots: [] };
  const variables = {
    recommended: formatTime(recommended.start, locale),
    alternatives: slotListText(alternatives, locale),
    alternatives_clause: alternatives.length
      ? (locale === 'es' ? ' También están disponibles ' : ' ') + slotListText(alternatives, locale) + '.'
      : '',
    options: slotListText(ranked.slots, locale),
    future_time: input.futurePreference ? formatTime(input.futurePreference.slot.start, locale) : '',
    future_date: input.futurePreference ? formatDate(input.futurePreference.group.date, locale) : ''
  };
  let responseKey = 'offer_without_preference';
  if (input.preference && !ranked.preferenceMatched && input.futurePreference) responseKey = 'preference_unavailable_with_future';
  else if (input.preference && !ranked.preferenceMatched) responseKey = 'preference_unavailable';
  else if (input.preference && alternatives.length) responseKey = 'offer_with_recommendation';
  else if (input.preference) responseKey = 'offer_single_recommendation';
  parts.push(appointmentResponse(responseKey, locale, Object.assign({ preference: input.preference && input.preference.label }, variables), group.key + '|' + text(input.preference && input.preference.source)));
  return { response: parts.filter(Boolean).join(' '), recommendedSlot: recommended, offeredSlots: ranked.slots };
}

function nextAvailableGroup(groups, afterDate) {
  if (!groups.length) return null;
  if (afterDate) {
    const wanted = localDateKey(afterDate);
    return groups.find(function later(group) { return group.key > wanted; }) || null;
  }
  return groups[0];
}

function noFutureAvailability(payload, prefix, locale, seed) {
  const contact = compactAvailabilityContext(payload, {}, new Date());
  const response = appointmentResponse('no_future_slots', locale, { contact: contactAction(contact, locale), dealer: dealerLabel(contact, locale) }, seed);
  return { response: [prefix, response].filter(Boolean).join(' '), recommendedSlot: null, offeredSlots: [] };
}

function unavailableReply(payload, requestedDate, groups, locale, blocked, options) {
  const input = options || {};
  const next = nextAvailableGroup(groups, requestedDate);
  const dateLabel = requestedDate ? formatDate(requestedDate, locale) : '';
  let prefix = '';
  if (requestedDate && blocked) prefix = appointmentResponse('blocked_day', locale, { date: dateLabel }, localDateKey(requestedDate));
  else if (requestedDate) prefix = appointmentResponse('no_slots_day', locale, { date: dateLabel }, localDateKey(requestedDate));
  if (next) {
    const transitionKey = input.sameDayExhausted ? 'same_day_none_transition' : 'next_day_transition';
    const transition = appointmentResponse(transitionKey, locale, { date: formatDate(next.date, locale) }, next.key);
    let futurePreference = null;
    if (input.preference && !rankSlotsForPreference(next.slots, input.preference, 3).preferenceMatched) {
      const laterGroups = groups.filter(function later(group) { return group.key > next.key; });
      for (const later of laterGroups) {
        const rankedLater = rankSlotsForPreference(later.slots, input.preference, 3);
        if (rankedLater.preferenceMatched && rankedLater.slots.length) {
          futurePreference = { group: later, slot: rankedLater.slots[0] };
          break;
        }
      }
    }
    return dayOffer(payload, next, locale, [prefix, transition].filter(Boolean).join(' '), { preference: input.preference, futurePreference: futurePreference, referenceDate: input.referenceDate });
  }
  return noFutureAvailability(payload, prefix, locale, requestedDate && localDateKey(requestedDate));
}

function exactAvailableReply(payload, selected, daySlots, locale, referenceDate) {
  const group = { key: localDateKey(selected.start), date: new Date(localDateKey(selected.start) + 'T12:00:00'), slots: daySlots };
  const window = dailyScheduleWindow(payload, group.date, daySlots);
  const contact = compactAvailabilityContext(payload, {}, referenceDate || new Date());
  const parts = [];
  if (window) {
    parts.push(appointmentResponse(window.source === 'verified_slots' ? 'verified_window' : 'dealer_hours', locale, {
      dealer: dealerLabel(contact, locale), date: formatDate(group.date, locale),
      start: formatMinutes(window.start_minutes, locale), end: formatMinutes(window.end_minutes, locale)
    }, group.key));
  }
  parts.push(appointmentResponse('exact_available', locale, {
    time: formatTime(selected.start, locale), location: selected.location ? (locale === 'es' ? ' en ' : ' at ') + selected.location : ''
  }, selected.id));
  return parts.filter(Boolean).join(' ');
}

function appointmentConversationPlan(input) {
  const options = input || {};
  const payload = options.payload || [];
  const conversation = options.conversation || {};
  const slots = scopeSlotsForConversation(Array.isArray(options.slots) ? options.slots : [], conversation);
  const message = text(options.message);
  const now = options.referenceDate || new Date();
  const locale = detectAppointmentLocale(message, conversation, options.locale);
  const hasContext = appointmentConversationActive(conversation, message);
  const classification = classifyAppointmentMessage(message, locale, hasContext);
  const followUpType = appointmentFollowUpType(message, hasContext, locale);
  const directIntent = isAppointmentAvailabilityIntent(message) || hasAppointmentTopicAnchor(message);
  const relevant = !isExplicitAppointmentTopicSwitch(message) && (directIntent || (hasContext && (classification.matched || followUpType !== 'none')));
  if (!relevant) return { relevant: false, locale: locale, decision: 'none', response: '', libraryIntent: classification.intent };
  const contact = compactAvailabilityContext(payload, {}, now);
  if (followUpType === 'decline') {
    return { relevant: true, locale: locale, decision: 'decline', response: contactClosing(contact, locale, message), shouldCreate: false, selectedSlot: null, libraryIntent: classification.intent };
  }
  const groups = groupSlotsByDay(slots);
  const preference = conversationTimePreference(conversation, message, locale);
  const selection = resolveSlotSelection(message, conversation, slots, now, locale, preference, followUpType, classification);
  const requested = selection.requested;
  const priorRequestedDate = lastRequestedDate(conversation, message, now);
  const activeDate = latestAppointmentDate(conversation, message, now);
  const requestedDate = requested.date || activeDate || priorRequestedDate;
  const correctionPrefix = classification.intent === 'correct_date' && requestedDate
    ? appointmentResponse('date_correction_ack', locale, { date: formatDate(requestedDate, locale) }, localDateKey(requestedDate))
    : '';
  if (selection.selected) {
    const daySlots = groups.find(function sameDay(group) { return group.key === localDateKey(selection.selected.start); });
    const shouldCreate = explicitBookingCommitment(message, hasContext, followUpType, selection.selected, classification);
    return {
      relevant: true, locale: locale, decision: shouldCreate ? 'select_slot' : 'exact_available',
      response: [correctionPrefix, exactAvailableReply(payload, selection.selected, daySlots ? daySlots.slots : [selection.selected], locale, now)].filter(Boolean).join(' '),
      shouldCreate: shouldCreate, selectedSlot: selection.selected, requested: requested, preference: preference,
      libraryIntent: classification.intent
    };
  }
  if (followUpType === 'same_day_alternative') {
    const referenceKey = requestedDate ? localDateKey(requestedDate) : lastOfferedGroupKey(conversation, groups, locale);
    const referenceGroup = groups.find(function sameDay(group) { return group.key === referenceKey; });
    const referenceDate = requestedDate || (referenceGroup && referenceGroup.date) || (referenceKey ? new Date(referenceKey + 'T12:00:00') : null);
    const blocked = referenceDate ? dateAvailabilityState(payload, referenceDate, { verifiedSlots: referenceGroup && referenceGroup.slots }).blocked : false;
    if (referenceGroup && !blocked) {
      const offeredIds = new Set(previouslyOfferedSlots(conversation, referenceGroup, locale).map(function id(slot) { return slot.id; }));
      const remaining = referenceGroup.slots.filter(function notOffered(slot) { return !offeredIds.has(slot.id); });
      if (remaining.length) {
        const prefix = appointmentResponse('same_day_more_transition', locale, {}, referenceGroup.key);
        const offer = dayOffer(payload, Object.assign({}, referenceGroup, { slots: remaining }), locale, prefix, { preference: preference, referenceDate: now });
        return { relevant: true, locale: locale, decision: 'offer_same_day', response: offer.response, shouldCreate: false, selectedSlot: null, recommendedSlot: offer.recommendedSlot, offeredSlots: offer.offeredSlots, preference: preference, libraryIntent: classification.intent };
      }
    }
    const unavailable = unavailableReply(payload, referenceDate, groups, locale, blocked, { sameDayExhausted: true, preference: preference, referenceDate: now });
    return { relevant: true, locale: locale, decision: blocked ? 'blocked_day' : 'offer_next_day', response: unavailable.response, shouldCreate: false, selectedSlot: null, recommendedSlot: unavailable.recommendedSlot, offeredSlots: unavailable.offeredSlots, preference: preference, libraryIntent: classification.intent };
  }
  if (followUpType === 'alternative') {
    const offeredKey = lastOfferedGroupKey(conversation, groups, locale);
    const afterDate = offeredKey ? new Date(offeredKey + 'T12:00:00') : requestedDate || (groups[0] && groups[0].date);
    const next = nextAvailableGroup(groups, afterDate);
    if (next) {
      const prefix = appointmentResponse('alternative_transition', locale, { date: formatDate(next.date, locale) }, next.key);
      const offer = dayOffer(payload, next, locale, prefix, { preference: preference, referenceDate: now });
      return { relevant: true, locale: locale, decision: 'offer_next_day', response: offer.response, shouldCreate: false, selectedSlot: null, recommendedSlot: offer.recommendedSlot, offeredSlots: offer.offeredSlots, preference: preference, libraryIntent: classification.intent };
    }
    const none = noFutureAvailability(payload, '', locale, message);
    return { relevant: true, locale: locale, decision: 'no_availability', response: none.response, shouldCreate: false, selectedSlot: null, preference: preference, libraryIntent: classification.intent };
  }
  if (requestedDate) {
    const requestedKey = localDateKey(requestedDate);
    const group = groups.find(function sameDay(item) { return item.key === requestedKey; });
    const blocked = dateAvailabilityState(payload, requestedDate, { verifiedSlots: group && group.slots }).blocked;
    if (group && group.slots.length && !blocked) {
      const availabilityPrefix = requested.exact || requestedTimeWasOffered(conversation, requested.time)
        ? appointmentResponse('requested_time_unavailable', locale, {}, requestedKey) : '';
      const prefix = [correctionPrefix, availabilityPrefix].filter(Boolean).join(' ');
      const offer = dayOffer(payload, group, locale, prefix, { preference: preference, referenceDate: now });
      return { relevant: true, locale: locale, decision: 'offer_same_day', response: offer.response, shouldCreate: false, selectedSlot: null, recommendedSlot: offer.recommendedSlot, offeredSlots: offer.offeredSlots, requested: requested, preference: preference, libraryIntent: classification.intent };
    }
    const unavailable = unavailableReply(payload, requestedDate, groups, locale, blocked, { preference: preference, referenceDate: now });
    return { relevant: true, locale: locale, decision: blocked ? 'blocked_day' : 'offer_next_day', response: [correctionPrefix, unavailable.response].filter(Boolean).join(' '), shouldCreate: false, selectedSlot: null, recommendedSlot: unavailable.recommendedSlot, offeredSlots: unavailable.offeredSlots, requested: requested, preference: preference, libraryIntent: classification.intent };
  }
  if (groups.length) {
    const offer = dayOffer(payload, groups[0], locale, '', { preference: preference, referenceDate: now });
    return { relevant: true, locale: locale, decision: 'offer_first_day', response: offer.response, shouldCreate: false, selectedSlot: null, recommendedSlot: offer.recommendedSlot, offeredSlots: offer.offeredSlots, requested: requested, preference: preference, libraryIntent: classification.intent };
  }
  const none = noFutureAvailability(payload, '', locale, message);
  return { relevant: true, locale: locale, decision: 'no_availability', response: none.response, shouldCreate: false, selectedSlot: null, requested: requested, preference: preference, libraryIntent: classification.intent };
}

function appointmentConfirmation(slot, locale, payload) {
  const contact = compactAvailabilityContext(payload || [], {}, new Date());
  return appointmentResponse('confirmation', locale, {
    date: formatDate(slot.start, locale), time: formatTime(slot.start, locale),
    location: slot.location ? (locale === 'es' ? ' en ' : ' at ') + slot.location : contact.location ? (locale === 'es' ? ' en ' : ' at ') + contact.location : '',
    // The confirmation already places the appointment at the address. Keep
    // location out of the change-contact clause so it appears only once.
    contact: contactAction(contact, locale, { includeLocation: false }), dealer: dealerLabel(contact, locale)
  }, slot.id);
}

module.exports = {
  NEXA_CONTEXTUAL_TIME_SELECTION_V1,
  NEXA_APPOINTMENT_STATE_MACHINE_V2,
  NEXA_PRO_APPOINTMENT_COMMUNICATION_V1,
  appointmentConfirmation,
  appointmentConversationActive,
  appointmentConversationPlan,
  appointmentFollowUpType,
  contactClosing,
  detectAppointmentLocale,
  formatDate,
  formatTime,
  groupSlotsByDay,
  rankSlotsForPreference,
  resolveSlotSelection,
  scopeSlotsForConversation
};
