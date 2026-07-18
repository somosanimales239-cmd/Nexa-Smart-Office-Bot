'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DatabaseService } = require('../src/database/database');
const { AutomaticActionsService } = require('../src/services/automatic-actions-service');
const { registerMessagesIpc } = require('../src/ipc/messages-ipc');

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'nexa-message-control-'));
const database = new DatabaseService(path.join(temp, 'workspace.sqlite'));
let sent = [];
let restarts = 0;

const apiService = {
  async fetchMessageThread(threadId) {
    return {
      status: 200,
      durationMs: 1,
      receivedAt: new Date().toISOString(),
      payload: {
        thread: { thread_id: threadId, subject: 'Customer inquiry', participant_name: 'Customer', can_reply: 1, is_announcement: 0 },
        messages: [{
          message_id: 'incoming-control-1',
          thread_id: threadId,
          direction: 'inbound',
          sender_type: 'customer',
          sender_name: 'Customer',
          body: 'Is this vehicle available?',
          sent_at: new Date(Date.now() - 60000).toISOString(),
          is_read: 0
        }]
      }
    };
  },
  async sendMessage(threadId, body, clientId) {
    sent.push({ threadId, body, clientId });
    return { payload: { message_id: 'sent-' + sent.length, thread_id: threadId, body, direction: 'outbound', sent_at: new Date().toISOString(), status: 'sent' } };
  },
  async markMessageRead() { return { payload: { status: 'read' } }; },
  async fetchDealerAppointmentAvailability() { return { payload: { slots: [] } }; }
};

const settingsService = {
  getPublicSettings() { return Object.assign({ preferred_provider: 'openai' }, database.getSettings()); }
};

const aiService = {
  messageEngine: {
    invalidate() {},
    match(conversation) {
      const latest = conversation.messages[conversation.messages.length - 1];
      return {
        matched: true,
        confidence: 0.98,
        latestMessage: latest.body,
        knowledgeId: 'control-knowledge',
        locale: 'en',
        safetyLevel: 'standard',
        requiredContext: [],
        response: 'Yes, I can help verify availability.'
      };
    }
  }
};

const automationService = new AutomaticActionsService({
  database,
  settingsService,
  apiService,
  aiService,
  notificationService: { createNotification() { return null; }, async deliverPending() {} }
});
const originalRestart = automationService.restart.bind(automationService);
automationService.restart = function trackedRestart() { restarts += 1; return originalRestart(); };

function saveAutomationSettings() {
  database.saveSettings({
    auto_actions_enabled: '1',
    auto_actions_consent_at: new Date().toISOString(),
    auto_actions_run_interval_seconds: '300',
    auto_messages_enabled: '1',
    auto_messages_knowledge_only: '1',
    auto_messages_ai_fallback: '0',
    auto_messages_min_confidence: '0.88',
    auto_messages_send_delay_seconds: '0',
    auto_messages_max_per_hour: '20',
    auto_messages_max_per_day: '100',
    auto_messages_quiet_start: '00:00',
    auto_messages_quiet_end: '00:00',
    auto_messages_languages: 'en,es',
    auto_messages_require_unread: '1',
    auto_messages_mark_read: '0',
    auto_messages_allowed_safety: 'standard',
    auto_messages_excluded_intents: 'legal_issue,emergency_issue,complaint,refund_dispute,payment_dispute,financing_approval',
    auto_appointments_enabled: '0',
    auto_actions_no_delete_guard: '1'
  });
}

async function run() {
  const columns = database.db.prepare('PRAGMA table_info(message_threads)').all().map(function map(row) { return row.name; });
  assert.ok(columns.includes('auto_reply_blocked'), 'Migration 8 must add the per-thread auto-reply block.');
  assert.equal(database.getSettings().message_ai_interaction_enabled, '0', 'Fresh installations must keep Messages AI off until permitted.');

  const handlers = {};
  registerMessagesIpc({ handle(channel, handler) { handlers[channel] = handler; } }, {
    database,
    apiService,
    aiService,
    settingsService,
    automationService
  });
  assert.equal(typeof handlers['messages:ai-toggle'], 'function');
  assert.equal(typeof handlers['messages:auto-reply-block'], 'function');

  saveAutomationSettings();
  database.replaceIntegrationCache('messages', [{ thread_id: 'thread-control', unread_count: 1, can_reply: 1, is_announcement: 0 }]);

  const offRun = await automationService.runNow('switch-off');
  assert.equal(offRun.messages_sent, 0);
  assert.equal(sent.length, 0, 'Messages AI OFF must prevent automatic interaction.');

  const toggleOn = await handlers['messages:ai-toggle']({}, { enabled: true });
  assert.equal(toggleOn.ok, true);
  assert.equal(toggleOn.data.enabled, true);
  assert.equal(database.getSettings().message_ai_interaction_enabled, '1');
  assert.ok(restarts >= 1, 'Toggling Messages AI must restart the guarded scheduler.');

  const refreshed = await apiService.fetchMessageThread('thread-control');
  database.saveMessageThreadSnapshot(refreshed.payload.thread, refreshed.payload.messages, { thread_id: 'thread-control' });
  const block = await handlers['messages:auto-reply-block']({}, { thread_id: 'thread-control', blocked: true });
  assert.equal(block.ok, true);
  assert.equal(Number(block.data.thread.auto_reply_blocked), 1);

  const blockedRun = await automationService.runNow('thread-blocked');
  assert.equal(blockedRun.messages_sent, 0);
  assert.equal(sent.length, 0, 'A blocked conversation must still exist locally but receive no automatic reply.');
  assert.equal(database.getMessageConversationContext('thread-control', 20).messages.length, 1, 'Blocked conversations must remain readable.');

  const unblock = await handlers['messages:auto-reply-block']({}, { thread_id: 'thread-control', blocked: false });
  assert.equal(unblock.ok, true);
  assert.equal(Number(unblock.data.thread.auto_reply_blocked), 0);

  const sendRun = await automationService.runNow('thread-unblocked');
  assert.equal(sendRun.messages_sent, 1);
  assert.equal(sent.length, 1, 'Unblocking must allow AI Control to send under its existing authorization.');

  const renderer = fs.readFileSync(path.join(__dirname, '..', 'src', 'app.js'), 'utf8');
  const preload = fs.readFileSync(path.join(__dirname, '..', 'preload.js'), 'utf8');
  assert.match(renderer, /AI Messages/);
  assert.match(renderer, /Block automatic AI replies for this conversation/);
  assert.doesNotMatch(renderer, /Teach Nexa from this approved reply/);
  assert.match(renderer, /openNotificationTarget/);
  assert.match(renderer, /loadMessageThread\(target\.threadId,false\)/);
  assert.match(renderer, /notification-open-target/);
  assert.match(preload, /messages:ai-toggle/);
  assert.match(preload, /messages:auto-reply-block/);

  automationService.stop();
  database.close();
  fs.rmSync(temp, { recursive: true, force: true });
  console.log('NEXA_MESSAGE_AI_SWITCH_AND_ACTIONABLE_NOTIFICATIONS_V1: 10/10 passed.');
}

run().catch(function failed(error) {
  try { automationService.stop(); } catch (_) { /* ignore */ }
  try { database.close(); } catch (_) { /* ignore */ }
  fs.rmSync(temp, { recursive: true, force: true });
  console.error(error.stack || error.message);
  process.exit(1);
});
