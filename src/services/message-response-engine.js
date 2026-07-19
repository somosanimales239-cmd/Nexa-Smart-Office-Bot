'use strict';

const crypto = require('node:crypto');
const {
  filterSlotsAgainstAppointments,
  normalizeAvailability
} = require('./dealer-availability-service');
const { appointmentConversationPlan } = require('./appointment-communication-service');

const NEXA_KNOWLEDGE_FIRST_MESSAGE_ENGINE_V2 = 'NEXA_KNOWLEDGE_FIRST_MESSAGE_ENGINE_V2';
const NEXA_AUTOMOTIVE_KNOWLEDGE_LIBRARY_V1 = 'NEXA_AUTOMOTIVE_KNOWLEDGE_LIBRARY_V1';

const STOP_WORDS = new Set([
  'a','an','and','are','as','at','be','been','but','by','can','could','do','does','for','from','had','has','have','how','i','if','in','is','it','me','my','of','on','or','our','please','the','this','to','we','what','when','where','which','with','would','you','your',
  'de','del','el','ella','en','es','esta','este','esto','la','las','lo','los','me','mi','para','por','que','se','si','su','sus','un','una','y','yo','como','cuando','donde','puede','quiero','gracias','hola'
]);

const SEGMENT_HINTS = {
  'truck-commercial': ['truck','commercial','box truck','semi','tractor','dump truck','cargo van','camion','comercial'],
  motorcycle: ['motorcycle','bike','harley','scooter','motocicleta','moto'],
  powersports: ['atv','utv','side by side','powersports','jetski','personal watercraft','cuatrimoto'],
  'rv-camper': ['rv','camper','motorhome','fifth wheel','travel coach','casa rodante'],
  trailer: ['trailer','utility trailer','cargo trailer','enclosed trailer','remolque'],
  marine: ['boat','marine','pontoon','yacht','outboard','bote','barco','marino'],
  fleet: ['fleet','multiple vehicles','commercial account','flota'],
  'luxury-exotic': ['luxury','exotic','ferrari','lamborghini','bentley','rolls royce','lujo','exotico'],
  'heavy-equipment': ['excavator','loader','dozer','forklift','heavy equipment','maquinaria','equipo pesado'],
  'ev-hybrid': ['electric','ev','hybrid','battery','charging','electrico','hibrido'],
  'new-auto': ['brand new','new vehicle','factory order','nuevo de fabrica'],
  'used-auto': ['used','preowned','pre-owned','usado','seminuevo']
};

function normalize(value) {
  return String(value || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
}

function tokens(value) {
  return Array.from(new Set(normalize(value).split(' ').filter(function keep(token) {
    return token.length > 1 && !STOP_WORDS.has(token);
  })));
}

function triggerParts(value) {
  return String(value || '').split(/[\n,;|]+/).map(normalize).filter(Boolean);
}

function safeJsonArray(value) {
  try {
    const parsed = JSON.parse(String(value || '[]'));
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    return [];
  }
}

function detectLocale(value) {
  const text = ' ' + normalize(value) + ' ';
  const spanish = [' que ',' como ',' cuando ',' donde ',' cuanto ',' precio ',' disponible ',' cita ',' financiamiento ',' credito ',' vehiculo ',' gracias ',' necesito ',' tienen ',' puedo ',' quiero ',' titulo ',' garantia '];
  const english = [' what ',' how ',' when ',' where ',' price ',' available ',' appointment ',' financing ',' credit ',' vehicle ',' thanks ',' need ',' have ',' can ',' want ',' title ',' warranty '];
  let es = 0;
  let en = 0;
  spanish.forEach(function count(word) { if (text.includes(word)) es += 1; });
  english.forEach(function count(word) { if (text.includes(word)) en += 1; });
  return es > en ? 'es' : 'en';
}

function inferDealerSegment(conversation) {
  const thread = conversation && conversation.thread ? conversation.thread : {};
  const rows = conversation && Array.isArray(conversation.messages) ? conversation.messages.slice(-12) : [];
  let payload = '';
  try { payload = JSON.stringify(thread); } catch (error) { payload = ''; }
  const combined = normalize([
    thread.subject, thread.context_type, thread.participant_type, payload,
    rows.map(function mapRow(row) { return row && row.body; }).join(' ')
  ].join(' '));
  let best = { segment: 'used-auto', score: 0 };
  Object.keys(SEGMENT_HINTS).forEach(function inspect(segment) {
    let score = 0;
    SEGMENT_HINTS[segment].forEach(function countHint(hint) {
      if (combined.includes(normalize(hint))) score += normalize(hint).split(' ').length;
    });
    if (score > best.score) best = { segment: segment, score: score };
  });
  return best.segment;
}

function scoreKnowledge(message, record, context) {
  const normalizedMessage = normalize(message);
  const messageTokens = tokens(message);
  const triggers = triggerParts(record && record.triggers);
  if (!normalizedMessage || !triggers.length) return 0;
  let best = 0;
  triggers.forEach(function scoreTrigger(trigger) {
    if (!trigger) return;
    if (normalizedMessage === trigger) best = Math.max(best, 1);
    if (normalizedMessage.includes(trigger) && trigger.length >= 5) best = Math.max(best, 0.92);
    const wanted = tokens(trigger);
    if (!wanted.length) return;
    const matches = wanted.filter(function matching(token) { return messageTokens.includes(token); }).length;
    const coverage = matches / wanted.length;
    const precision = matches / Math.max(messageTokens.length, 1);
    const score = Math.min(0.89, coverage * 0.72 + precision * 0.28);
    best = Math.max(best, score);
  });
  const locale = context && context.locale;
  const segment = context && context.segment;
  if (locale && record && record.locale) best += String(record.locale) === locale ? 0.07 : -0.04;
  if (segment && record && record.dealer_segment) {
    if (String(record.dealer_segment) === segment) best += 0.06;
    else if (String(record.dealer_segment) === 'used-auto') best += 0.01;
  }
  if (record && Number(record.built_in || 0) === 0) best += 0.18;
  return Number(Math.max(0, Math.min(1, best)).toFixed(3));
}

function deterministicIndex(seed, length) {
  if (!length) return 0;
  const digest = crypto.createHash('sha256').update(String(seed || '')).digest();
  return digest.readUInt32BE(0) % length;
}

function selectResponseVariant(record, conversation, latestMessage) {
  const variants = safeJsonArray(record && record.response_variants_json).filter(Boolean);
  if (!variants.length) return String(record && record.response || '');
  const thread = conversation && conversation.thread ? conversation.thread : {};
  const seed = [thread.thread_id, latestMessage, record.id, record.use_count].join('|');
  return String(variants[deterministicIndex(seed, variants.length)] || record.response || '');
}

function liveAvailabilityMatch(database, conversation, latestMessage, context) {
  if (!database || typeof database.listIntegrationCache !== 'function') return null;
  const cached = database.listIntegrationCache('dealer-appointment-availability', '', 500);
  if (!cached.length) return null;
  const settings = typeof database.getSettings === 'function' ? database.getSettings() : {};
  const now = new Date();
  const normalizedSlots = normalizeAvailability(cached, Object.assign({}, settings, {
    auto_appointments_min_notice_hours: 0,
    auto_appointments_max_days: Math.max(Number(settings.auto_appointments_max_days || 60), 14)
  }), now);
  const appointments = typeof database.listAppointments === 'function' ? database.listAppointments('') : [];
  const slots = filterSlotsAgainstAppointments(normalizedSlots, appointments);
  const plan = appointmentConversationPlan({
    payload: cached,
    slots: slots,
    conversation: conversation,
    message: latestMessage,
    locale: context.locale,
    referenceDate: now
  });
  if (!plan.relevant || !plan.response) return null;
  return {
    matched: true,
    confidence: 1,
    latestMessage: latestMessage,
    knowledgeId: 'live-dealer-appointment-availability',
    label: 'Live dealer appointment availability',
    category: 'Live website availability',
    intentKey: 'live_appointment_' + plan.decision,
    locale: plan.locale,
    dealerSegment: context.segment,
    safetyLevel: 'standard',
    requiredContext: [],
    builtIn: false,
    dynamic: true,
    libraryVersion: 'website-live',
    appointmentDecision: plan.decision,
    appointmentLibraryIntent: plan.libraryIntent || '',
    response: plan.response
  };
}

class MessageResponseEngine {
  constructor(database) {
    this.database = database;
    this.cachedRecords = null;
    this.cachedAt = 0;
  }

  latestInbound(conversation) {
    const rows = conversation && Array.isArray(conversation.messages) ? conversation.messages : [];
    const inbound = rows.filter(function inboundOnly(row) {
      return String(row.direction || '').toLowerCase() !== 'outbound';
    });
    return inbound.length ? inbound[inbound.length - 1] : rows[rows.length - 1] || null;
  }

  records() {
    if (!this.cachedRecords || Date.now() - this.cachedAt > 10000) {
      this.cachedRecords = this.database.listResponseKnowledge('').filter(function enabled(row) { return Number(row.enabled) === 1; });
      this.cachedAt = Date.now();
    }
    return this.cachedRecords;
  }

  invalidate() {
    this.cachedRecords = null;
    this.cachedAt = 0;
  }

  match(conversation) {
    const latest = this.latestInbound(conversation);
    const text = latest ? String(latest.body || '') : '';
    const context = { locale: detectLocale(text), segment: inferDealerSegment(conversation) };
    const liveMatch = liveAvailabilityMatch(this.database, conversation, text, context);
    if (liveMatch) return liveMatch;
    const records = this.records().filter(function languageFirst(row) {
      return !row.locale || String(row.locale) === 'auto' || String(row.locale) === context.locale;
    });
    let best = null;
    records.forEach(function compare(row) {
      const confidence = scoreKnowledge(text, row, context);
      if (!best || confidence > best.confidence || (confidence === best.confidence && Number(row.built_in || 0) < Number(best.record.built_in || 0))) {
        best = { record: row, confidence: confidence };
      }
    });
    if (!best || best.confidence < 0.72) {
      return { matched: false, confidence: best ? best.confidence : 0, latestMessage: text, locale: context.locale, dealerSegment: context.segment };
    }
    return {
      matched: true,
      confidence: best.confidence,
      latestMessage: text,
      knowledgeId: best.record.id,
      label: best.record.label,
      category: best.record.category,
      intentKey: best.record.intent_key || '',
      locale: best.record.locale || context.locale,
      dealerSegment: best.record.dealer_segment || context.segment,
      safetyLevel: best.record.safety_level || 'standard',
      requiredContext: safeJsonArray(best.record.required_context_json),
      builtIn: Number(best.record.built_in || 0) === 1,
      libraryVersion: best.record.library_version || '',
      response: selectResponseVariant(best.record, conversation, text)
    };
  }
}

module.exports = {
  MessageResponseEngine,
  NEXA_KNOWLEDGE_FIRST_MESSAGE_ENGINE_V2,
  NEXA_AUTOMOTIVE_KNOWLEDGE_LIBRARY_V1,
  detectLocale,
  inferDealerSegment,
  normalize,
  scoreKnowledge,
  selectResponseVariant,
  liveAvailabilityMatch,
  tokens
};
