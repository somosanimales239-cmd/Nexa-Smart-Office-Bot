'use strict';

const NEXA_KNOWLEDGE_FIRST_MESSAGE_ENGINE_V1 = 'NEXA_KNOWLEDGE_FIRST_MESSAGE_ENGINE_V1';

const STOP_WORDS = new Set([
  'a','an','and','are','as','at','be','been','but','by','can','could','do','does','for','from','had','has','have','how','i','if','in','is','it','me','my','of','on','or','our','please','the','this','to','we','what','when','where','which','with','would','you','your',
  'de','del','el','ella','en','es','esta','este','esto','la','las','lo','los','me','mi','para','por','que','se','si','su','sus','un','una','y','yo','como','cuando','donde','puede','quiero','gracias','hola'
]);

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

function scoreKnowledge(message, record) {
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
    const score = Math.min(0.89, coverage * 0.7 + precision * 0.3);
    best = Math.max(best, score);
  });
  return Number(best.toFixed(3));
}

class MessageResponseEngine {
  constructor(database) {
    this.database = database;
  }

  latestInbound(conversation) {
    const rows = conversation && Array.isArray(conversation.messages) ? conversation.messages : [];
    const inbound = rows.filter(function inboundOnly(row) {
      return String(row.direction || '').toLowerCase() !== 'outbound';
    });
    return inbound.length ? inbound[inbound.length - 1] : rows[rows.length - 1] || null;
  }

  match(conversation) {
    const latest = this.latestInbound(conversation);
    const text = latest ? String(latest.body || '') : '';
    const records = this.database.listResponseKnowledge('').filter(function enabled(row) { return Number(row.enabled) === 1; });
    let best = null;
    records.forEach(function compare(row) {
      const confidence = scoreKnowledge(text, row);
      if (!best || confidence > best.confidence) best = { record: row, confidence: confidence };
    });
    if (!best || best.confidence < 0.72) {
      return { matched: false, confidence: best ? best.confidence : 0, latestMessage: text };
    }
    return {
      matched: true,
      confidence: best.confidence,
      latestMessage: text,
      knowledgeId: best.record.id,
      label: best.record.label,
      category: best.record.category,
      response: best.record.response
    };
  }
}

module.exports = {
  MessageResponseEngine,
  NEXA_KNOWLEDGE_FIRST_MESSAGE_ENGINE_V1,
  normalize,
  scoreKnowledge,
  tokens
};
