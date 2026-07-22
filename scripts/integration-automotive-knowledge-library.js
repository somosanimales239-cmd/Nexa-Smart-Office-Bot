'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DatabaseService } = require('../src/database/database');
const { MessageResponseEngine, detectLocale, inferDealerSegment } = require('../src/services/message-response-engine');
const { AIService } = require('../src/services/ai-service');
const { availabilityCacheItems } = require('../src/services/dealer-availability-service');
const { calendarCacheItems } = require('../src/services/dealer-agenda-calendar-service');
const manifest = require('../src/data/automotive-dealer-library-manifest.json');
const library = require('../src/data/automotive-dealer-knowledge-library.json');

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nexa-auto-library-'));
const database = new DatabaseService(path.join(tempDir, 'library.sqlite'));
let passed = 0;

function test(name, fn) {
  try {
    fn();
    passed += 1;
    console.log('PASS ' + name);
  } catch (error) {
    console.error('FAIL ' + name + ': ' + (error.stack || error.message));
    process.exitCode = 1;
  }
}

test('bundled library contains exactly 2,880 knowledge records', function () {
  assert.equal(manifest.record_count, 2880);
  assert.equal(library.length, 2880);
  assert.equal(manifest.base_intents, 120);
  assert.equal(manifest.dealer_segments.length, 12);
  assert.equal(manifest.languages.length, 2);
  assert.equal(manifest.total_response_variants, 8640);
});

test('migration 6 installs every built-in record once', function () {
  const count = database.db.prepare('SELECT COUNT(*) AS count FROM response_knowledge WHERE built_in=1').get().count;
  assert.equal(count, 2880);
  database.migrate();
  const after = database.db.prepare('SELECT COUNT(*) AS count FROM response_knowledge WHERE built_in=1').get().count;
  assert.equal(after, 2880);
});

test('library summary reports languages, segments and variants', function () {
  const summary = database.knowledgeLibrarySummary();
  assert.equal(summary.built_in, 2880);
  assert.equal(summary.base_intents, 120);
  assert.equal(summary.dealer_segments, 12);
  assert.equal(summary.languages, 2);
  assert.equal(summary.response_variants, 8640);
  assert.equal(summary.categories, 9);
});

test('all built-in knowledge has triggers, response variants and safety metadata', function () {
  const bad = database.db.prepare(`SELECT COUNT(*) AS count FROM response_knowledge WHERE built_in=1 AND (
    triggers='' OR response='' OR response_variants_json='[]' OR locale NOT IN ('en','es') OR
    dealer_segment='' OR intent_key='' OR safety_level='' OR library_version=''
  )`).get().count;
  assert.equal(bad, 0);
});

test('Spanish financing question matches Spanish safe knowledge', function () {
  database.saveMessageThreadSnapshot(
    { thread_id: 'spanish-finance', subject: 'Financiamiento', can_reply: 1 },
    [{ message_id: 'sf-1', direction: 'inbound', sender_type: 'customer', body: '¿Cuánto sería el pago mensual y qué tasa de interés ofrecen?', sent_at: new Date().toISOString() }],
    { thread_id: 'spanish-finance' }
  );
  const engine = new MessageResponseEngine(database);
  const match = engine.match(database.getMessageConversationContext('spanish-finance', 20));
  assert.equal(match.matched, true);
  assert.equal(match.locale, 'es');
  assert.match(match.category, /Financing/i);
  assert.match(match.response, /estimado|pago|tasa/i);
  assert.doesNotMatch(match.response, /aprobado garantizado/i);
});

test('trailer availability chooses trailer dealer segment', function () {
  database.saveMessageThreadSnapshot(
    { thread_id: 'trailer-stock', subject: 'Cargo trailer availability', context_type: 'trailer listing', can_reply: 1 },
    [{ message_id: 'ts-1', direction: 'inbound', sender_type: 'customer', body: 'Is this enclosed trailer still available?', sent_at: new Date().toISOString() }],
    { thread_id: 'trailer-stock' }
  );
  const engine = new MessageResponseEngine(database);
  const conversation = database.getMessageConversationContext('trailer-stock', 20);
  assert.equal(inferDealerSegment(conversation), 'trailer');
  const match = engine.match(conversation);
  assert.equal(match.matched, true);
  assert.equal(match.dealerSegment, 'trailer');
  assert.equal(match.builtIn, true);
  assert.match(match.response, /trailer/i);
});

test('language detector distinguishes common English and Spanish requests', function () {
  assert.equal(detectLocale('Do you have financing and what is the price?'), 'en');
  assert.equal(detectLocale('¿Tienen financiamiento y cuál es el precio?'), 'es');
});

test('built-in knowledge can be disabled but not deleted', function () {
  const row = database.db.prepare('SELECT id FROM response_knowledge WHERE built_in=1 LIMIT 1').get();
  const disabled = database.setResponseKnowledgeEnabled(row.id, false);
  assert.equal(disabled.enabled, 0);
  assert.throws(function removeBuiltIn() { database.deleteResponseKnowledge(row.id); }, /cannot be deleted/i);
  const enabled = database.setResponseKnowledgeEnabled(row.id, true);
  assert.equal(enabled.enabled, 1);
});

test('custom approved knowledge remains editable and takes priority', function () {
  const custom = database.saveResponseKnowledge({
    label: 'Custom Saturday hours',
    category: 'Custom dealership knowledge',
    triggers: 'are you open saturday, saturday hours',
    response: 'Yes. Our verified Saturday hours are 9 AM to 3 PM.',
    locale: 'en',
    dealer_segment: 'all-dealers'
  });
  assert.equal(custom.built_in, 0);
  database.saveMessageThreadSnapshot(
    { thread_id: 'custom-hours', subject: 'Hours', can_reply: 1 },
    [{ message_id: 'ch-1', direction: 'inbound', sender_type: 'customer', body: 'Are you open Saturday?', sent_at: new Date().toISOString() }],
    { thread_id: 'custom-hours' }
  );
  const engine = new MessageResponseEngine(database);
  const match = engine.match(database.getMessageConversationContext('custom-hours', 20));
  assert.equal(match.matched, true);
  assert.equal(match.builtIn, false);
  assert.match(match.response, /9 AM to 3 PM/);
  assert.equal(database.deleteResponseKnowledge(custom.id), true);
});

test('organic response variants are deterministic and not always identical', function () {
  const rows = database.db.prepare("SELECT response_variants_json FROM response_knowledge WHERE built_in=1 AND intent_key='availability_now' LIMIT 10").all();
  const unique = new Set();
  rows.forEach(function inspect(row) {
    const variants = JSON.parse(row.response_variants_json);
    assert.equal(variants.length, 3);
    variants.forEach(function add(value) { unique.add(value); });
  });
  assert.ok(unique.size >= 6);
});

test('live website availability becomes dynamic Knowledge and respects a blocked day', function () {
  const offDate = new Date();
  offDate.setDate(offDate.getDate() + 1);
  offDate.setHours(0, 0, 0, 0);
  const openDate = new Date(offDate);
  openDate.setDate(openDate.getDate() + 1);
  openDate.setHours(10, 0, 0, 0);
  const key = function dateKey(value) { return value.getFullYear() + '-' + String(value.getMonth() + 1).padStart(2, '0') + '-' + String(value.getDate()).padStart(2, '0'); };
  const payload = {
    dealer_id: 'dealer-live', dealer_name: 'Live Dealer', store_name: 'Live Store', slot_minutes: 30,
    blocked_dates: [key(offDate)], open_dates: [key(openDate)],
    verified_open_slots: [{ slot_id: 'live-slot', start_at: openDate.toISOString(), available: true, location: 'Main showroom' }]
  };
  database.replaceIntegrationCache('dealer-appointment-availability', availabilityCacheItems(payload));
  database.saveMessageThreadSnapshot(
    { thread_id: 'live-off-date', subject: 'Cita', can_reply: 1 },
    [{ message_id: 'live-off-1', direction: 'inbound', sender_type: 'customer', body: '¿Tienen cita mañana?', sent_at: new Date().toISOString() }],
    { thread_id: 'live-off-date' }
  );
  const match = new MessageResponseEngine(database).match(database.getMessageConversationContext('live-off-date', 20));
  assert.equal(match.matched, true);
  assert.equal(match.dynamic, true);
  assert.equal(match.libraryVersion, 'website-live');
  assert.match(match.response, /día off|fecha bloqueada|bloquead[oa](?:\s+en)?(?:\s+su)?\s+Agenda/i);
  assert.match(match.response, /siguiente fecha disponible|próxima fecha disponible|siguiente fecha con disponibilidad/i);
  assert.match(match.response, /Agenda|horas de cita verificadas|horario verificado/i);
});

test('live website Knowledge confirms only an exact verified open slot', function () {
  const cached = database.listIntegrationCache('dealer-appointment-availability', '', 20);
  const snapshot = cached.find(function find(item) { return item.record_type === 'availability_snapshot'; });
  const slot = snapshot.verified_open_slots[0];
  const date = new Date(slot.start_at);
  const requestDate = String(date.getMonth() + 1).padStart(2, '0') + '/' + String(date.getDate()).padStart(2, '0') + '/' + date.getFullYear();
  database.saveMessageThreadSnapshot(
    { thread_id: 'live-exact-slot', subject: 'Appointment', can_reply: 1 },
    [{ message_id: 'live-exact-1', direction: 'inbound', sender_type: 'customer', body: 'Can I schedule an appointment on ' + requestDate + ' at 10:00 AM?', sent_at: new Date().toISOString() }],
    { thread_id: 'live-exact-slot' }
  );
  const match = new MessageResponseEngine(database).match(database.getMessageConversationContext('live-exact-slot', 20));
  assert.equal(match.dynamic, true);
  assert.match(match.response, /available and verified/i);
  assert.match(match.response, /Main showroom/i);
});

test('Dealer Agenda booked appointments remove an otherwise open website slot from Knowledge', function () {
  const cached = database.listIntegrationCache('dealer-appointment-availability', '', 20);
  const snapshot = cached.find(function find(item) { return item.record_type === 'availability_snapshot'; });
  const slotDate = new Date(snapshot.verified_open_slots[0].start_at);
  const key = slotDate.getFullYear() + '-' + String(slotDate.getMonth() + 1).padStart(2, '0') + '-' + String(slotDate.getDate()).padStart(2, '0');
  database.replaceIntegrationCache('dealer-agenda-calendar', calendarCacheItems({
    appointment_count: 1,
    stores: [{ store_id: 'store-live', days: [{ date: key, appointments: [{ appointment_id: 'busy-website-slot', customer_name: 'Existing Customer', appointment_time: '10:00', appointment_status: 'scheduled', source: 'website' }] }] }]
  }));
  const requestDate = String(slotDate.getMonth() + 1).padStart(2, '0') + '/' + String(slotDate.getDate()).padStart(2, '0') + '/' + slotDate.getFullYear();
  database.saveMessageThreadSnapshot(
    { thread_id: 'calendar-booked-slot', subject: 'Appointment', can_reply: 1 },
    [{ message_id: 'calendar-booked-1', direction: 'inbound', sender_type: 'customer', body: 'Can I schedule an appointment on ' + requestDate + ' at 10:00 AM?', sent_at: new Date().toISOString() }],
    { thread_id: 'calendar-booked-slot' }
  );
  const match = new MessageResponseEngine(database).match(database.getMessageConversationContext('calendar-booked-slot', 20));
  assert.equal(match.dynamic, true);
  assert.doesNotMatch(match.response, /available and verified/i);
  assert.match(match.response, /no verified appointment times|does not show verified open appointment times|no other verified|does not show a verifiable opening/i);
});

test('order conversation returns the synchronized dealer address immediately and on follow-up', function () {
  const address = '13500 Intrepid Lane, Fort Myers, Florida 33913';
  database.replaceIntegrationCache('orders', [{
    id: 'order-ezgo-2003', order_id: 'order-ezgo-2003', listing_id: 'listing-ezgo-2003', store_id: 'store-ezgo',
    listing_title: '2003 EZGO Gol', customer_name: 'Standard Buyer'
  }]);
  database.replaceIntegrationCache('reseller-listings', [{
    id: 'assignment-ezgo', assignment_id: 'assignment-ezgo', listing_id: 'listing-ezgo-2003', store_id: 'store-ezgo',
    listing_title: '2003 EZGO Gol', store_name: 'Standard Dealer', dealer_name: 'Standard Dealer'
  }]);
  database.replaceIntegrationCache('dealer-appointment-availability', availabilityCacheItems({
    dealer_id: 'dealer-ezgo', dealer_name: 'Standard Dealer', store_id: 'store-ezgo', store_name: 'Standard Dealer',
    location: address, phone: '239-799-1416', assigned_listings: [{ listing_id: 'listing-ezgo-2003', listing_title: '2003 EZGO Gol' }],
    verified_open_slots: []
  }));
  const firstMessage = 'New order request sent from listing.\n\nCustomer: Standard Buyer\nListing: 2003 EZGO Gol\nOrder notes: I am interested.quiero saver mas de este articulo y la direccion donde esta';
  database.saveMessageThreadSnapshot(
    { thread_id: 'dealer-address-order', context_type: 'order', context_id: 'order-ezgo-2003', subject: '2003 EZGO Gol', can_reply: 1 },
    [{ message_id: 'dealer-address-1', direction: 'inbound', sender_type: 'buyer', body: firstMessage, sent_at: new Date().toISOString() }],
    { thread_id: 'dealer-address-order' }
  );
  const engine = new MessageResponseEngine(database);
  const first = engine.match(database.getMessageConversationContext('dealer-address-order', 20));
  assert.equal(first.dynamic, true);
  assert.equal(first.intentKey, 'live_dealer_address');
  assert.match(first.response, new RegExp(address));
  assert.doesNotMatch(first.response, /primero verificar|verificar[eé]|responder[eé] en breve/i);

  database.saveMessageThreadSnapshot(
    { thread_id: 'dealer-address-order', context_type: 'order', context_id: 'order-ezgo-2003', subject: '2003 EZGO Gol', can_reply: 1 },
    [
      { message_id: 'dealer-address-1', direction: 'inbound', sender_type: 'buyer', body: firstMessage, sent_at: new Date(Date.now() - 120000).toISOString() },
      { message_id: 'dealer-address-old-reply', direction: 'outbound', sender_type: 'dealer', body: 'Primero verificaré el local correcto.', sent_at: new Date(Date.now() - 60000).toISOString() },
      { message_id: 'dealer-address-2', direction: 'inbound', sender_type: 'buyer', body: 'ok dame la direccion', sent_at: new Date().toISOString() }
    ],
    { thread_id: 'dealer-address-order' }
  );
  const followUp = engine.match(database.getMessageConversationContext('dealer-address-order', 20));
  assert.equal(followUp.dynamic, true);
  assert.equal(followUp.locale, 'es');
  assert.match(followUp.response, new RegExp(address));
  assert.doesNotMatch(followUp.response, /primero verificar|verificar[eé]|responder[eé] en breve/i);
  const aiService = new AIService(database, {
    getPublicSettings: function settings() { return { secrets: {} }; },
    getSecret: function noSecret() { return ''; }
  });
  const aiPrompt = aiService.buildMessageReplyPrompt(database.getMessageConversationContext('dealer-address-order', 20), 'Answer the customer now.');
  assert.match(aiPrompt.system, /provide the verified address immediately/i);
  assert.match(aiPrompt.user, /thread_dealer_contact/);
  assert.match(aiPrompt.user, new RegExp(address));
});

database.close();
console.log('Automotive dealer knowledge library tests: ' + passed + '/14 passed.');
if (process.exitCode) process.exit(process.exitCode);
