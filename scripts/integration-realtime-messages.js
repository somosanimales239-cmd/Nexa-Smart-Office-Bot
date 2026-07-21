'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DatabaseService } = require('../src/database/database');
const { SettingsService } = require('../src/services/settings-service');
const { AutoMarketApiService } = require('../src/services/automarket-api-service');
const { AIService } = require('../src/services/ai-service');
const { MessageResponseEngine, scoreKnowledge } = require('../src/services/message-response-engine');

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nexa-realtime-messages-'));
const database = new DatabaseService(path.join(tempDir, 'messages.sqlite'));
let passed = 0;

function test(name, fn) {
  return Promise.resolve().then(fn).then(function success() {
    passed += 1;
    console.log('PASS ' + name);
  }).catch(function failure(error) {
    console.error('FAIL ' + name + ': ' + (error.stack || error.message));
    process.exitCode = 1;
  });
}

class FakeSafeStorage {
  isEncryptionAvailable() { return true; }
  encryptString(value) { return Buffer.from('encrypted:' + value); }
  decryptString(buffer) { return buffer.toString().replace(/^encrypted:/, ''); }
}

const settings = new SettingsService(database, path.join(tempDir, 'secure', 'secrets.json'), new FakeSafeStorage());
settings.saveSettings({
  automarket_base_url: 'https://example.com',
  automarket_api_key: 'test-message-key',
  message_realtime_enabled: '1',
  message_poll_seconds: '5',
  message_ai_mode: 'knowledge_first',
  message_ai_fallback: '1'
});

const originalFetch = global.fetch;
const requests = [];
global.fetch = async function fakeFetch(url, options) {
  const parsed = new URL(url);
  const resource = parsed.searchParams.get('resource');
  requests.push({ resource: resource, method: options.method, headers: options.headers, query: Object.fromEntries(parsed.searchParams.entries()), body: options.body ? JSON.parse(options.body) : null });
  if (resource === 'message-thread') {
    return {
      ok: true,
      status: 200,
      text: async function text() {
        return JSON.stringify({ data: {
          thread: { thread_id: 'thread-1', subject: 'Trailer availability', participant_name: 'Customer One', can_reply: 1, secret_token: 'remove-me' },
          participants: [
            { type: 'buyer', id: 'buyer-1', name: 'Customer One', email: 'customer.one@example.com', favorite: false, private_phone_token: 'remove-me' },
            { type: 'dealer', id: 'dealer-1', name: 'Dealer', email: 'dealer@example.com', private_role_token: 'remove-me' }
          ],
          messages: [
            { message_id: 'm1', thread_id: 'thread-1', sender_type: 'customer', sender_name: 'Customer One', sender_email: 'customer.one@example.com', direction: 'inbound', body: 'Is this trailer still available?', sent_at: '2026-07-17T12:00:00Z', private_secret: 'remove-me' },
            { message_id: 'm2', thread_id: 'thread-1', sender_type: 'dealer', sender_name: 'Dealer', direction: 'outbound', body: 'Let me verify that for you.', sent_at: '2026-07-17T12:01:00Z' }
          ],
          count: 2
        } });
      }
    };
  }
  if (resource === 'message-send') {
    return {
      ok: true,
      status: 201,
      text: async function text() {
        const body = options.body ? JSON.parse(options.body) : {};
        return JSON.stringify({ data: { message_id: 'remote-client-1', thread_id: body.thread_id, body: body.message, direction: 'outbound', sender_type: 'dealer', sent_at: '2026-07-17T12:02:00Z', status: 'sent' } });
      }
    };
  }
  if (resource === 'message-read') {
    return { ok: true, status: 200, text: async function text() { return JSON.stringify({ data: { thread_id: 'thread-1', status: 'read' } }); } };
  }
  return { ok: true, status: 200, text: async function text() { return JSON.stringify({ data: {} }); } };
};

const api = new AutoMarketApiService(settings);
const ai = new AIService(database, settings);
const engine = new MessageResponseEngine(database);

(async function run() {
  await test('message tables are created by migration 5', function () {
    const names = new Set(database.db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(function row(item) { return item.name; }));
    ['message_threads','message_entries','message_reply_drafts','message_outbox','response_knowledge'].forEach(function required(name) { assert.equal(names.has(name), true); });
  });

  await test('message settings are allowed and persisted', function () {
    const saved = database.saveSettings({ message_poll_seconds: '10', message_ai_mode: 'knowledge_first', message_learning_enabled: '1' });
    assert.equal(saved.message_poll_seconds, '10');
    assert.equal(saved.message_learning_enabled, '1');
  });

  await test('full message thread is requested and sensitive extras are discarded', async function () {
    const response = await api.fetchMessageThread('thread-1', { limit: 100 });
    assert.equal(response.payload.thread.thread_id, 'thread-1');
    assert.equal(response.payload.thread.secret_token, undefined);
    assert.equal(response.payload.messages.length, 2);
    assert.equal(response.payload.messages[0].body, 'Is this trailer still available?');
    assert.equal(response.payload.messages[0].sender_email, 'customer.one@example.com');
    assert.equal(response.payload.messages[0].private_secret, undefined);
    assert.equal(response.payload.thread.participants[0].email, 'customer.one@example.com');
    assert.equal(response.payload.thread.participants[0].private_phone_token, undefined);
    const request = requests.find(function find(item) { return item.resource === 'message-thread'; });
    assert.equal(request.query.mark_read, '0', 'Synchronizing a conversation must not mark it read.');
    database.saveMessageThreadSnapshot(response.payload.thread, response.payload.messages, { thread_id: 'thread-1' });
    const conversation = database.getMessageConversationContext('thread-1', 100);
    assert.equal(conversation.messages.length, 2);
    assert.equal(JSON.parse(conversation.thread.payload_json).participants[0].email, 'customer.one@example.com');
  });

  await test('approved knowledge scores and drafts before external AI', async function () {
    const knowledge = database.saveResponseKnowledge({ label: 'Availability', category: 'Inventory', triggers: 'still available, is it available, available trailer', response: 'Yes, it is currently available. Would you like to schedule a time to see it?' });
    assert.ok(scoreKnowledge('Is this trailer still available?', knowledge) >= 0.72);
    const match = engine.match(database.getMessageConversationContext('thread-1', 100));
    assert.equal(match.matched, true);
    const result = await ai.generateMessageReply({ thread_id: 'thread-1', provider: 'openai' });
    assert.equal(result.engine, 'knowledge');
    assert.match(result.draft.body, /currently available|current availability/i);
  });

  await test('AI fallback receives the complete conversation when knowledge does not match', async function () {
    database.saveMessageThreadSnapshot(
      { thread_id: 'thread-ai', subject: 'Financing question', participant_name: 'Customer Two', can_reply: 1 },
      [
        { message_id: 'ai-1', thread_id: 'thread-ai', sender_type: 'customer', sender_name: 'Customer Two', direction: 'inbound', body: 'I have an unusual multi-company export request that does not fit a standard retail transaction.', sent_at: '2026-07-17T13:00:00Z' },
        { message_id: 'ai-2', thread_id: 'thread-ai', sender_type: 'dealer', sender_name: 'Dealer', direction: 'outbound', body: 'Please explain the structure you need reviewed.', sent_at: '2026-07-17T13:01:00Z' },
        { message_id: 'ai-3', thread_id: 'thread-ai', sender_type: 'customer', sender_name: 'Customer Two', direction: 'inbound', body: 'It involves three foreign entities, a custom escrow arrangement, and documentation outside your normal process. Who should review it?', sent_at: '2026-07-17T13:02:00Z' }
      ],
      { thread_id: 'thread-ai' }
    );
    let captured = null;
    ai.providers.openai = {
      getStatus: function getStatus() { return { configured: true, provider: 'openai', model: 'test-model' }; },
      generateSuggestion: async function generateSuggestion(prompt) { captured = prompt; return 'This request needs specialized human review. I can summarize the entities, escrow structure, and required documents for an authorized manager.'; },
      cancelRequest: function cancelRequest() { return false; }
    };
    const result = await ai.generateMessageReply({ thread_id: 'thread-ai', provider: 'openai' });
    assert.equal(result.engine, 'ai');
    assert.match(result.draft.body, /specialized human review/i);
    assert.match(captured.user, /unusual multi-company export request/i);
    assert.match(captured.user, /custom escrow arrangement/i);
    assert.match(captured.user, /Who should review it/i);
  });

  await test('message send uses POST, bearer auth and idempotency key', async function () {
    const response = await api.sendMessage('thread-1', 'Yes, it is available.', 'client-1');
    assert.equal(response.payload.message_id, 'remote-client-1');
    const request = requests.find(function find(item) { return item.resource === 'message-send'; });
    assert.equal(request.method, 'POST');
    assert.equal(request.headers.Authorization, 'Bearer test-message-key');
    assert.equal(request.headers['Idempotency-Key'], 'client-1');
    assert.equal(request.body.thread_id, 'thread-1');
    assert.equal(request.body.message, 'Yes, it is available.');
    assert.equal(Object.prototype.hasOwnProperty.call(request.body, 'body'), false);
  });

  await test('outbox and sent draft state are durable', function () {
    database.createMessageOutbox({ client_message_id: 'client-2', thread_id: 'thread-1', body: 'Approved reply' });
    const sent = database.updateMessageOutbox('client-2', { status: 'sent', remote_message_id: 'remote-2' });
    assert.equal(sent.status, 'sent');
    const draft = database.saveMessageDraft({ thread_id: 'thread-1', source: 'manual', body: 'Approved reply' });
    assert.equal(database.markMessageDraftSent(draft.id, 'remote-2').status, 'sent');
  });

  await test('message read endpoint is supported', async function () {
    const response = await api.markMessageRead('thread-1', 'm2');
    assert.equal(response.payload.status, 'read');
  });

  await test('renderer contains complete conversation and approval controls', function () {
    const renderer = fs.readFileSync(path.join(__dirname, '..', 'src', 'app.js'), 'utf8');
    const preload = fs.readFileSync(path.join(__dirname, '..', 'preload.js'), 'utf8');
    const ipc = fs.readFileSync(path.join(__dirname, '..', 'src', 'ipc', 'messages-ipc.js'), 'utf8');
    assert.match(renderer, /message-thread-open/);
    assert.match(renderer, /Send reply/);
    assert.match(renderer, /Knowledge Engine/);
    assert.match(preload, /messages:send/);
    assert.match(ipc, /user_confirmed !== true/);
  });

  global.fetch = originalFetch;
  database.close();
  if (!process.exitCode) console.log('NEXA_REALTIME_MESSAGES_V1: ' + passed + '/9 passed.');
}()).catch(function fatal(error) {
  global.fetch = originalFetch;
  try { database.close(); } catch (_) { /* ignore */ }
  console.error(error.stack || error.message);
  process.exit(1);
});
