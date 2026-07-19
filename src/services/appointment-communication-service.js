'use strict';

const {
  compactAvailabilityContext,
  dailyScheduleWindow,
  dateAvailabilityState,
  isAppointmentAvailabilityIntent,
  localDateKey,
  parseRequestedDateTime
} = require('./dealer-availability-service');

const NEXA_PRO_APPOINTMENT_COMMUNICATION_V1 = 'NEXA_PRO_APPOINTMENT_COMMUNICATION_V1';

function text(value) { return String(value === undefined || value === null ? '' : value).trim(); }
function normalized(value) {
  return text(value).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9\s:/.-]/g, ' ').replace(/\s+/g, ' ').trim();
}

function conversationMessages(conversation) {
  return conversation && Array.isArray(conversation.messages) ? conversation.messages : [];
}

function detectAppointmentLocale(message, conversation, fallback) {
  const source = normalized([message].concat(conversationMessages(conversation).slice(-8).map(function body(row) { return row && row.body; })).join(' '));
  const spanish = ['cita', 'horario', 'disponibilidad', 'manana', 'dia', 'ninguno', 'ninguna', 'conviene', 'puedo', 'quiero', 'gracias', 'dealer', 'visita', 'reservar', 'agendar'];
  const english = ['appointment', 'schedule', 'availability', 'tomorrow', 'day', 'none', 'works', 'available', 'want', 'thanks', 'dealer', 'visit', 'book'];
  let es = 0;
  let en = 0;
  spanish.forEach(function score(word) { if (new RegExp('\\b' + word + '\\b').test(source)) es += 1; });
  english.forEach(function score(word) { if (new RegExp('\\b' + word + '\\b').test(source)) en += 1; });
  if (es === en && (fallback === 'es' || fallback === 'en')) return fallback;
  return es > en ? 'es' : 'en';
}

function appointmentConversationActive(conversation, latestMessage) {
  const rows = conversationMessages(conversation).slice(-14);
  let removedLatest = false;
  const previous = rows.slice().reverse().filter(function previousOnly(row) {
    if (!removedLatest && String(row && row.direction || '').toLowerCase() !== 'outbound' && text(row && row.body) === text(latestMessage)) {
      removedLatest = true;
      return false;
    }
    return true;
  }).reverse();
  return previous.some(function appointmentRow(row) {
    const body = text(row && row.body);
    return isAppointmentAvailabilityIntent(body)
      || /\b(verified (?:appointment )?times?|horarios? verificados?|which one works|cual le conviene|alguno le resulta conveniente|prepare the appointment|prepare la cita)\b/i.test(normalized(body));
  });
}

function appointmentFollowUpType(message, hasContext) {
  if (!hasContext) return 'none';
  const source = normalized(message);
  const wantsAlternative = /\b(ningun|ninguno|ninguna|no puedo|no me sirve|no me conviene|otro dia|otra fecha|otro horario|mas tarde|mas temprano|none of those|none work|does not work|doesn t work|another day|another time|different day|different time|later time|earlier time)\b/.test(source);
  if (wantsAlternative) return 'alternative';
  const declines = /^(no|nope|nah)[.!\s]*$/.test(source)
    || /\b(no gracias|no quiero (?:hacer |agendar |reservar )?(?:una )?cita|prefiero no|ya no quiero|dejemoslo asi|no me interesa|don t want (?:an )?appointment|do not want (?:an )?appointment|no appointment|not interested|no thanks|never mind|not right now)\b/.test(source);
  if (declines) return 'decline';
  if (/\b(el primero|la primera|primero|first one|the first|el segundo|la segunda|segundo|second one|the second|el tercero|la tercera|tercero|third one|the third)\b/.test(source)) return 'selection';
  if (parseRequestedDateTime(message, new Date()).time) return 'selection';
  if (/\b(si|yes|perfecto|perfect|me conviene|me sirve|that works|works for me|tomare|i ll take)\b/.test(source)) return 'acceptance';
  return 'none';
}

function lastRequestedDate(conversation, latestMessage, referenceDate) {
  const rows = conversationMessages(conversation).slice(-16).reverse();
  let skippedLatest = false;
  for (const row of rows) {
    if (!row || String(row.direction || '').toLowerCase() === 'outbound') continue;
    const body = text(row.body);
    if (!skippedLatest && body === text(latestMessage)) { skippedLatest = true; continue; }
    const parsed = parseRequestedDateTime(body, referenceDate);
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

function requestedOrdinal(message) {
  const source = normalized(message);
  if (/\b(el primero|la primera|primero|first one|the first)\b/.test(source)) return 0;
  if (/\b(el segundo|la segunda|segundo|second one|the second)\b/.test(source)) return 1;
  if (/\b(el tercero|la tercera|tercero|third one|the third)\b/.test(source)) return 2;
  return null;
}

function previousOrEarliestDay(conversation, latestMessage, groups, referenceDate) {
  const previousDate = lastRequestedDate(conversation, latestMessage, referenceDate);
  if (previousDate) return localDateKey(previousDate);
  return groups.length ? groups[0].key : '';
}

function resolveSlotSelection(message, conversation, slots, referenceDate) {
  const now = referenceDate || new Date();
  const requested = parseRequestedDateTime(message, now);
  const groups = groupSlotsByDay(slots);
  if (requested.date && requested.exact) {
    const selected = (slots || []).find(function exact(slot) { return Math.abs(slot.start.getTime() - requested.date.getTime()) <= 15 * 60000; }) || null;
    return { selected: selected, requested: requested, reference_day: localDateKey(requested.date) };
  }
  const contextDay = requested.date ? localDateKey(requested.date) : previousOrEarliestDay(conversation, message, groups, now);
  const daySlots = contextDay ? (groups.find(function sameDay(group) { return group.key === contextDay; }) || {}).slots || [] : [];
  const ordinal = requestedOrdinal(message);
  if (ordinal !== null) return { selected: daySlots[ordinal] || null, requested: requested, reference_day: contextDay };
  if (requested.time) {
    const pool = daySlots.length ? daySlots : (slots || []);
    const matching = pool.filter(function sameTime(slot) {
      return slot.start.getHours() === requested.time.hour && slot.start.getMinutes() === requested.time.minute;
    });
    return { selected: matching.length ? matching[0] : null, requested: requested, reference_day: contextDay };
  }
  return { selected: null, requested: requested, reference_day: contextDay };
}

function explicitBookingCommitment(message, hasContext, followUpType, selected) {
  if (!selected) return false;
  const source = normalized(message);
  if (/\b(quiero (?:hacer |agendar |reservar )?(?:una |la )?cita|agendame|reservame|puede agendar|puedes agendar|hacer una cita|schedule (?:an|the|my) appointment|book (?:an|the|my) appointment|reserve (?:the|this) time|i ll take|tomare)\b/.test(source)) return true;
  if (/\b(can i schedule|could you schedule|please schedule|me conviene|me sirve|perfecto|that works|works for me)\b/.test(source)) return true;
  return hasContext && ['selection', 'acceptance'].includes(followUpType);
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

function dealerLabel(contact, locale) {
  return text(contact.store_name || contact.dealer_name) || (locale === 'es' ? 'el dealer' : 'the dealer');
}

function contactClosing(contact, locale) {
  const name = dealerLabel(contact, locale);
  const methods = [];
  if (contact.phone) methods.push(locale === 'es' ? 'llamarnos al ' + contact.phone : 'call us at ' + contact.phone);
  if (contact.email) methods.push(locale === 'es' ? 'escribir a ' + contact.email : 'email ' + contact.email);
  if (contact.location) methods.push(locale === 'es' ? 'visitarnos en ' + contact.location : 'visit us at ' + contact.location);
  methods.push(locale === 'es' ? 'escribirnos por este mismo chat' : 'message us in this same chat');
  if (locale === 'es') return 'Entendido, no hay problema y gracias por avisarnos. Si más adelante desea coordinar una visita con ' + name + ', puede ' + methods.join(', ') + '. Con gusto le ayudaremos cuando le resulte conveniente.';
  return 'Understood—no problem, and thank you for letting us know. If you would like to arrange a visit with ' + name + ' later, you can ' + methods.join(', ') + '. We will be happy to help whenever it is convenient for you.';
}

function slotListText(daySlots, locale) {
  const shown = daySlots.slice(0, 8);
  let result = shown.map(function time(slot) { return formatTime(slot.start, locale); }).join(', ');
  if (daySlots.length > shown.length) result += locale === 'es' ? ' y ' + (daySlots.length - shown.length) + ' horarios adicionales' : ' and ' + (daySlots.length - shown.length) + ' additional times';
  return result;
}

function dayOffer(payload, group, locale, prefix) {
  const contact = compactAvailabilityContext(payload, {}, new Date());
  const label = dealerLabel(contact, locale);
  const window = dailyScheduleWindow(payload, group.date, group.slots);
  const parts = [];
  if (prefix) parts.push(prefix);
  if (window) {
    if (window.source === 'verified_slots') {
      parts.push(locale === 'es'
        ? 'Los horarios verificados de cita para el ' + formatDate(group.date, locale) + ' están entre ' + formatMinutes(window.start_minutes, locale) + ' y ' + formatMinutes(window.end_minutes, locale) + '.'
        : 'The verified appointment times for ' + formatDate(group.date, locale) + ' run from ' + formatMinutes(window.start_minutes, locale) + ' to ' + formatMinutes(window.end_minutes, locale) + '.');
    } else {
      parts.push(locale === 'es'
        ? 'El horario de ' + label + ' para el ' + formatDate(group.date, locale) + ' es de ' + formatMinutes(window.start_minutes, locale) + ' a ' + formatMinutes(window.end_minutes, locale) + '.'
        : label + ' is available on ' + formatDate(group.date, locale) + ' from ' + formatMinutes(window.start_minutes, locale) + ' to ' + formatMinutes(window.end_minutes, locale) + '.');
    }
  }
  parts.push(locale === 'es'
    ? 'Las horas disponibles verificadas para cita son: ' + slotListText(group.slots, locale) + '. ¿Le resulta conveniente alguno de estos horarios?'
    : 'The verified appointment times available are: ' + slotListText(group.slots, locale) + '. Would any of these times be convenient for you?');
  return parts.join(' ');
}

function nextAvailableGroup(groups, afterDate, excludeFirstWhenUnknown) {
  if (!groups.length) return null;
  if (afterDate) {
    const wanted = localDateKey(afterDate);
    return groups.find(function later(group) { return group.key > wanted; }) || null;
  }
  return excludeFirstWhenUnknown && groups.length > 1 ? groups[1] : groups[0];
}

function unavailableReply(payload, requestedDate, groups, locale, blocked) {
  const next = nextAvailableGroup(groups, requestedDate, false);
  const dateLabel = requestedDate ? formatDate(requestedDate, locale) : '';
  let prefix = '';
  if (requestedDate && blocked) {
    prefix = locale === 'es'
      ? 'El ' + dateLabel + ' está marcado como día off o fecha bloqueada en el horario verificado.'
      : dateLabel + ' is marked as a day off or blocked date in the verified schedule.';
  } else if (requestedDate) {
    prefix = locale === 'es'
      ? 'El dealer puede tener horario de atención el ' + dateLabel + ', pero no aparecen horas de cita verificadas disponibles para ese día.'
      : 'The dealer may have business hours on ' + dateLabel + ', but there are no verified appointment times available that day.';
  }
  if (next) {
    const transition = locale === 'es'
      ? (prefix ? prefix + ' ' : '') + 'El siguiente día con disponibilidad verificada es el ' + formatDate(next.date, locale) + '.'
      : (prefix ? prefix + ' ' : '') + 'The next day with verified availability is ' + formatDate(next.date, locale) + '.';
    return dayOffer(payload, next, locale, transition);
  }
  const contact = compactAvailabilityContext(payload, {}, new Date());
  return (prefix ? prefix + ' ' : '') + (locale === 'es'
    ? 'No aparecen otros horarios verificados en la ventana actual. Puede comunicarse con ' + dealerLabel(contact, locale) + (contact.phone ? ' al ' + contact.phone : '') + ' o escribirnos por este chat para que le ayudemos.'
    : 'No other verified times appear in the current window. You can contact ' + dealerLabel(contact, locale) + (contact.phone ? ' at ' + contact.phone : '') + ' or message us here so we can help.');
}

function exactAvailableReply(payload, selected, daySlots, locale) {
  const group = { key: localDateKey(selected.start), date: new Date(localDateKey(selected.start) + 'T12:00:00'), slots: daySlots };
  const window = dailyScheduleWindow(payload, group.date, daySlots);
  const contact = compactAvailabilityContext(payload, {}, new Date());
  const parts = [];
  if (window) {
    parts.push(window.source === 'verified_slots'
      ? (locale === 'es'
        ? 'Los horarios verificados de cita para ese día están entre ' + formatMinutes(window.start_minutes, locale) + ' y ' + formatMinutes(window.end_minutes, locale) + '.'
        : 'The verified appointment times that day run from ' + formatMinutes(window.start_minutes, locale) + ' to ' + formatMinutes(window.end_minutes, locale) + '.')
      : (locale === 'es'
        ? 'El horario de ' + dealerLabel(contact, locale) + ' ese día es de ' + formatMinutes(window.start_minutes, locale) + ' a ' + formatMinutes(window.end_minutes, locale) + '.'
        : dealerLabel(contact, locale) + ' is available that day from ' + formatMinutes(window.start_minutes, locale) + ' to ' + formatMinutes(window.end_minutes, locale) + '.'));
  }
  parts.push(locale === 'es'
    ? 'La hora de las ' + formatTime(selected.start, locale) + ' está disponible y verificada' + (selected.location ? ' en ' + selected.location : '') + '. ¿Desea que prepare la cita?'
    : formatTime(selected.start, locale) + ' is available and verified' + (selected.location ? ' at ' + selected.location : '') + '. Would you like me to prepare the appointment?');
  return parts.join(' ');
}

function appointmentConversationPlan(input) {
  const options = input || {};
  const payload = options.payload || [];
  const slots = Array.isArray(options.slots) ? options.slots : [];
  const conversation = options.conversation || {};
  const message = text(options.message);
  const now = options.referenceDate || new Date();
  const hasContext = appointmentConversationActive(conversation, message);
  const followUpType = appointmentFollowUpType(message, hasContext);
  const directIntent = isAppointmentAvailabilityIntent(message);
  const locale = detectAppointmentLocale(message, conversation, options.locale);
  const relevant = directIntent || (hasContext && followUpType !== 'none');
  if (!relevant) return { relevant: false, locale: locale, decision: 'none', response: '' };
  const contact = compactAvailabilityContext(payload, {}, now);
  if (followUpType === 'decline') {
    return { relevant: true, locale: locale, decision: 'decline', response: contactClosing(contact, locale), shouldCreate: false, selectedSlot: null };
  }
  const groups = groupSlotsByDay(slots);
  const selection = resolveSlotSelection(message, conversation, slots, now);
  const requested = selection.requested;
  const requestedDate = requested.date || lastRequestedDate(conversation, message, now);
  if (followUpType === 'alternative') {
    const next = nextAvailableGroup(groups, requestedDate || (groups[0] && groups[0].date), true);
    if (next) {
      const prefix = locale === 'es'
        ? 'Claro, busquemos otra opción. El siguiente día con disponibilidad verificada es el ' + formatDate(next.date, locale) + '.'
        : 'Of course—let’s find another option. The next day with verified availability is ' + formatDate(next.date, locale) + '.';
      return { relevant: true, locale: locale, decision: 'offer_next_day', response: dayOffer(payload, next, locale, prefix), shouldCreate: false, selectedSlot: null };
    }
    return { relevant: true, locale: locale, decision: 'no_availability', response: unavailableReply(payload, requestedDate, groups, locale, false), shouldCreate: false, selectedSlot: null };
  }
  if (selection.selected) {
    const daySlots = groups.find(function sameDay(group) { return group.key === localDateKey(selection.selected.start); });
    const shouldCreate = explicitBookingCommitment(message, hasContext, followUpType, selection.selected);
    return {
      relevant: true,
      locale: locale,
      decision: shouldCreate ? 'select_slot' : 'exact_available',
      response: exactAvailableReply(payload, selection.selected, daySlots ? daySlots.slots : [selection.selected], locale),
      shouldCreate: shouldCreate,
      selectedSlot: selection.selected,
      requested: requested
    };
  }
  if (requested.date) {
    const requestedKey = localDateKey(requested.date);
    const group = groups.find(function sameDay(item) { return item.key === requestedKey; });
    const blocked = dateAvailabilityState(payload, requested.date).blocked;
    if (group && group.slots.length) {
      const prefix = requested.exact
        ? (locale === 'es' ? 'La hora solicitada no está disponible, pero sí hay otras opciones verificadas ese mismo día.' : 'The requested time is not available, but there are other verified options that same day.')
        : '';
      return { relevant: true, locale: locale, decision: 'offer_same_day', response: dayOffer(payload, group, locale, prefix), shouldCreate: false, selectedSlot: null, requested: requested };
    }
    return { relevant: true, locale: locale, decision: blocked ? 'blocked_day' : 'offer_next_day', response: unavailableReply(payload, requested.date, groups, locale, blocked), shouldCreate: false, selectedSlot: null, requested: requested };
  }
  if (groups.length) {
    return { relevant: true, locale: locale, decision: 'offer_first_day', response: dayOffer(payload, groups[0], locale, ''), shouldCreate: false, selectedSlot: null, requested: requested };
  }
  return { relevant: true, locale: locale, decision: 'no_availability', response: unavailableReply(payload, null, groups, locale, false), shouldCreate: false, selectedSlot: null, requested: requested };
}

function appointmentConfirmation(slot, locale, payload) {
  const contact = compactAvailabilityContext(payload || [], {}, new Date());
  const name = dealerLabel(contact, locale);
  if (locale === 'es') {
    return 'Su cita quedó programada para el ' + formatDate(slot.start, locale) + ' a las ' + formatTime(slot.start, locale)
      + (slot.location ? ' en ' + slot.location : contact.location ? ' en ' + contact.location : '')
      + '. Si necesita cambiarla, comuníquese con ' + name + (contact.phone ? ' al ' + contact.phone : '') + ' o escríbanos por este chat.';
  }
  return 'Your appointment is scheduled for ' + formatDate(slot.start, locale) + ' at ' + formatTime(slot.start, locale)
    + (slot.location ? ' at ' + slot.location : contact.location ? ' at ' + contact.location : '')
    + '. If you need to change it, contact ' + name + (contact.phone ? ' at ' + contact.phone : '') + ' or message us in this chat.';
}

module.exports = {
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
  resolveSlotSelection
};
