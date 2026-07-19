'use strict';

const crypto = require('node:crypto');
const library = require('../data/appointment-communication-library.json');

const NEXA_BILINGUAL_APPOINTMENT_LIBRARY_V1 = 'NEXA_BILINGUAL_APPOINTMENT_LIBRARY_V1';

function text(value) { return String(value === undefined || value === null ? '' : value).trim(); }
function normalize(value) {
  return text(value).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s:/.-]/g, ' ').replace(/\s+/g, ' ').trim();
}

function localeData(locale) {
  return library.locales[locale === 'es' ? 'es' : 'en'];
}

function containsPhrase(source, phrase) {
  const wanted = normalize(phrase);
  if (!source || !wanted) return false;
  return source === wanted || source.includes(wanted);
}

function bestPhraseMatch(source, phrases) {
  let best = '';
  (phrases || []).forEach(function inspect(phrase) {
    const wanted = normalize(phrase);
    if (wanted.length > best.length && containsPhrase(source, wanted)) best = wanted;
  });
  return best;
}

function classifyAppointmentMessage(message, locale, appointmentContextActive) {
  const source = normalize(message);
  if (!source) return { matched: false, intent: 'none', confidence: 0, phrase: '', locale: locale === 'es' ? 'es' : 'en' };
  const locales = locale === 'es' ? ['es', 'en'] : ['en', 'es'];
  let best = null;
  locales.forEach(function inspectLocale(candidateLocale) {
    const data = localeData(candidateLocale);
    Object.entries(data.intents || {}).forEach(function inspectIntent(entry) {
      const phrase = bestPhraseMatch(source, entry[1]);
      if (!phrase) return;
      const confidence = source === phrase ? 1 : Math.min(0.99, 0.86 + Math.min(phrase.length, 65) / 500);
      if (!best || confidence > best.confidence || (confidence === best.confidence && phrase.length > best.phrase.length)) {
        best = { matched: true, intent: entry[0], confidence: confidence, phrase: phrase, locale: candidateLocale };
      }
    });
  });
  if (best) return best;
  if (appointmentContextActive) {
    for (const candidateLocale of locales) {
      const phrase = bestPhraseMatch(source, localeData(candidateLocale).intents.context_reference || []);
      if (phrase) return { matched: true, intent: 'context_reference', confidence: 0.94, phrase: phrase, locale: candidateLocale };
    }
  }
  return { matched: false, intent: 'none', confidence: 0, phrase: '', locale: locale === 'es' ? 'es' : 'en' };
}

function isExplicitAppointmentTopicSwitch(message) {
  const source = normalize(message);
  return ['es', 'en'].some(function switched(locale) {
    return Boolean(bestPhraseMatch(source, localeData(locale).explicit_topic_switches || []));
  });
}

function hasAppointmentTopicAnchor(message) {
  const source = normalize(message);
  if (!source || isExplicitAppointmentTopicSwitch(source)) return false;
  return ['es', 'en'].some(function anchored(locale) {
    const data = localeData(locale);
    if (bestPhraseMatch(source, data.topic_anchors || [])) return true;
    return Object.entries(data.intents || {}).some(function appointmentIntent(entry) {
      if (!['appointment_request', 'confirm_status', 'reschedule', 'cancel'].includes(entry[0])) return false;
      return Boolean(bestPhraseMatch(source, entry[1] || []));
    });
  });
}

function looksLikeAppointmentDealerReply(message) {
  const source = normalize(message);
  return /\b(agenda|appointment|cita|verified time|verified appointment|hora verificada|horario verificado|next available|siguiente fecha|le reservo|shall i reserve|prepare the appointment|prepare la cita|day off|fecha bloqueada)\b/.test(source);
}

function appointmentTopicActive(conversation, latestMessage) {
  const rows = conversation && Array.isArray(conversation.messages) ? conversation.messages.slice(-24) : [];
  const previous = rows.slice();
  for (let index = previous.length - 1; index >= 0; index -= 1) {
    const row = previous[index];
    if (normalize(row && row.direction) !== 'outbound' && text(row && row.body) === text(latestMessage)) {
      previous.splice(index, 1);
      break;
    }
  }
  let active = false;
  previous.forEach(function inspect(row) {
    const body = text(row && row.body);
    const direction = normalize(row && row.direction);
    if (isExplicitAppointmentTopicSwitch(body)) active = false;
    else if (hasAppointmentTopicAnchor(body) || (direction === 'outbound' && looksLikeAppointmentDealerReply(body))) active = true;
    const classified = classifyAppointmentMessage(body, 'es', active);
    if (classified.intent === 'decline_appointment' || classified.intent === 'cancel') active = false;
  });
  return active;
}

function deterministicIndex(seed, length) {
  if (!length) return 0;
  return crypto.createHash('sha256').update(text(seed)).digest().readUInt32BE(0) % length;
}

function renderTemplate(template, variables) {
  const values = variables || {};
  return text(template).replace(/\{\{([a-z0-9_]+)\}\}/gi, function replace(_, key) {
    return String(values[key] === undefined || values[key] === null ? '' : values[key]);
  }).replace(/\s+/g, ' ').replace(/\s+([,.!?;:])/g, '$1').trim();
}

function appointmentResponse(key, locale, variables, seed) {
  const templates = localeData(locale).responses[key] || [];
  if (!templates.length) return '';
  return renderTemplate(templates[deterministicIndex([key, locale, seed].join('|'), templates.length)], variables);
}

function hourMinutes(hour, minute, periodWord) {
  let value = Number(hour);
  const mins = Number(minute || 0);
  const period = normalize(periodWord).replaceAll('.', '');
  if (['pm', 'tarde', 'noche', 'evening', 'night'].includes(period) && value < 12) value += 12;
  if (['am', 'manana', 'morning'].includes(period) && value === 12) value = 0;
  if (value > 23 || mins > 59) return null;
  return value * 60 + mins;
}

function preferenceLabel(type, minutes, locale) {
  const hour = Math.floor(minutes / 60);
  const minute = minutes % 60;
  const date = new Date(2020, 0, 1, hour, minute, 0, 0);
  const timeLabel = new Intl.DateTimeFormat(locale === 'es' ? 'es-US' : 'en-US', { hour: 'numeric', minute: '2-digit', hour12: true }).format(date)
    .replace(/a\.\s*m\./i, 'AM').replace(/p\.\s*m\./i, 'PM').replace(/\s+/g, ' ').trim();
  if (locale === 'es') return (type === 'after' ? 'después de las ' : 'antes de las ') + timeLabel;
  return (type === 'after' ? 'after ' : 'before ') + timeLabel;
}

function extractTimePreference(message, locale) {
  const source = normalize(message);
  if (!source) return null;
  const timed = source.match(/\b(despues de|luego de|mas tarde de|after|later than|antes de|mas temprano de|before|earlier than)\s+(?:las?\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)?(?:\s*(?:de la|in the|at)\s+(manana|tarde|noche|morning|afternoon|evening|night))?\b/);
  if (timed) {
    const type = ['despues de', 'luego de', 'mas tarde de', 'after', 'later than'].includes(timed[1]) ? 'after' : 'before';
    const minutes = hourMinutes(timed[2], timed[3], timed[4] || timed[5]);
    if (minutes !== null) return { type: type, minutes: minutes, label: preferenceLabel(type, minutes, locale), source: timed[0] };
  }
  if (/\b(por la manana|en la manana|morning)\b/.test(source)) return { type: 'period', start: 8 * 60, end: 12 * 60, label: locale === 'es' ? 'por la mañana' : 'in the morning', source: 'morning' };
  if (/\b(por la tarde|en la tarde|afternoon)\b/.test(source)) return { type: 'period', start: 12 * 60, end: 17 * 60, label: locale === 'es' ? 'por la tarde' : 'in the afternoon', source: 'afternoon' };
  if (/\b(por la noche|en la noche|evening|at night)\b/.test(source)) return { type: 'period', start: 17 * 60, end: 24 * 60, label: locale === 'es' ? 'por la noche' : 'in the evening', source: 'evening' };
  return null;
}

function conversationTimePreference(conversation, latestMessage, locale) {
  const candidates = [latestMessage];
  const rows = conversation && Array.isArray(conversation.messages) ? conversation.messages.slice(-20).reverse() : [];
  rows.forEach(function add(row) {
    if (normalize(row && row.direction) !== 'outbound' && text(row && row.body) !== text(latestMessage)) candidates.push(row.body);
  });
  rows.forEach(function addDealerRestatement(row) {
    if (normalize(row && row.direction) === 'outbound') candidates.push(row.body);
  });
  for (const candidate of candidates) {
    const preference = extractTimePreference(candidate, locale);
    if (preference) return preference;
  }
  return null;
}

function libraryStatistics() {
  let intents = 0;
  let phrases = 0;
  let templates = 0;
  ['es', 'en'].forEach(function count(locale) {
    const data = localeData(locale);
    intents += Object.keys(data.intents || {}).length;
    Object.values(data.intents || {}).forEach(function countPhrases(values) { phrases += values.length; });
    Object.values(data.responses || {}).forEach(function countTemplates(values) { templates += values.length; });
  });
  return { contract: library.contract, version: library.version, locales: library.supported_locales.slice(), intents: intents, phrases: phrases, templates: templates };
}

module.exports = {
  NEXA_BILINGUAL_APPOINTMENT_LIBRARY_V1,
  appointmentResponse,
  appointmentTopicActive,
  classifyAppointmentMessage,
  conversationTimePreference,
  extractTimePreference,
  hasAppointmentTopicAnchor,
  isExplicitAppointmentTopicSwitch,
  libraryStatistics,
  normalize,
  renderTemplate
};
