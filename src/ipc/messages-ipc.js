'use strict';

const crypto = require('node:crypto');
const { registerIpcHandler } = require('./ipc-utils');

const MESSAGE_IPC_CONTRACT = 'IPC channels: messages:thread, messages:refresh, messages:draft, messages:send, messages:mark-read, messages:knowledge-list, messages:knowledge-save, messages:knowledge-delete';

function threadParts(payload) {
  const source = payload && typeof payload === 'object' ? payload : {};
  const thread = source.thread && typeof source.thread === 'object' ? source.thread : {};
  const messages = Array.isArray(source.messages) ? source.messages : [];
  return { thread: thread, messages: messages, cursor: source.next_cursor || source.cursor || null };
}

function registerMessagesIpc(ipcMain, services) {
  const database = services.database;
  const apiService = services.apiService;
  const aiService = services.aiService;

  registerIpcHandler(ipcMain, 'messages:thread', function getThread(payload) {
    return database.getMessageConversationContext(String(payload && payload.thread_id || ''), Number(payload && payload.limit || 120));
  });

  registerIpcHandler(ipcMain, 'messages:refresh', async function refreshThread(payload) {
    const threadId = String(payload && payload.thread_id || '').trim();
    const response = await apiService.fetchMessageThread(threadId, {
      limit: Number(payload && payload.limit || 120),
      cursor: payload && payload.cursor,
      after: payload && payload.after
    });
    const parts = threadParts(response.payload);
    if (!parts.thread.thread_id) parts.thread.thread_id = threadId;
    const conversation = database.saveMessageThreadSnapshot(parts.thread, parts.messages, { thread_id: threadId, cursor: parts.cursor });
    return {
      conversation: conversation,
      status: response.status,
      duration_ms: response.durationMs,
      received_at: response.receivedAt,
      has_more: Boolean(response.payload && response.payload.has_more),
      next_cursor: parts.cursor
    };
  });

  registerIpcHandler(ipcMain, 'messages:draft', async function draftReply(payload) {
    return aiService.generateMessageReply(payload || {});
  });

  registerIpcHandler(ipcMain, 'messages:send', async function sendReply(payload) {
    const input = payload && typeof payload === 'object' ? payload : {};
    if (input.user_confirmed !== true) throw new Error('The user must confirm before a website message can be sent.');
    const threadId = String(input.thread_id || '').trim();
    const body = String(input.body || '').trim();
    if (!threadId || !body) throw new Error('Thread and reply text are required.');
    const conversation = database.getMessageConversationContext(threadId, 5);
    const thread = conversation && conversation.thread ? conversation.thread : {};
    if (Number(thread.is_announcement || 0) === 1 || thread.can_reply === false || Number(thread.can_reply) === 0) {
      throw new Error('This thread is read-only and cannot receive replies.');
    }
    const clientMessageId = String(input.client_message_id || crypto.randomUUID());
    database.createMessageOutbox({ client_message_id: clientMessageId, thread_id: threadId, body: body });
    try {
      const response = await apiService.sendMessage(threadId, body, clientMessageId, input.reply_to_message_id || null);
      const remote = response.payload && typeof response.payload === 'object' ? response.payload : {};
      const messageId = String(remote.message_id || remote.id || clientMessageId);
      database.updateMessageOutbox(clientMessageId, { status: 'sent', remote_message_id: messageId });
      database.saveMessageThreadSnapshot(Object.assign({}, thread, {
        thread_id: threadId,
        last_message_id: messageId,
        last_message_at: remote.sent_at || remote.created_at || new Date().toISOString()
      }), [Object.assign({}, remote, {
        message_id: messageId,
        thread_id: threadId,
        body: remote.body || body,
        direction: 'outbound',
        sender_type: remote.sender_type || 'business',
        sent_at: remote.sent_at || remote.created_at || new Date().toISOString(),
        status: remote.status || 'sent',
        is_read: 1
      })], { thread_id: threadId });
      if (input.draft_id) database.markMessageDraftSent(input.draft_id, messageId);
      if (input.teach === true && input.trigger_text) {
        database.saveResponseKnowledge({
          label: input.knowledge_label || 'Approved reply · ' + new Date().toLocaleDateString(),
          category: input.knowledge_category || 'Approved conversations',
          triggers: String(input.trigger_text),
          response: body,
          enabled: true
        });
      }
      database.log('sent', 'website_message', messageId, 'User-approved reply in thread ' + threadId);
      return { sent: true, message: remote, client_message_id: clientMessageId, conversation: database.getMessageConversationContext(threadId, 120) };
    } catch (error) {
      database.updateMessageOutbox(clientMessageId, { status: 'failed', error: error.message });
      throw error;
    }
  });

  registerIpcHandler(ipcMain, 'messages:mark-read', async function markRead(payload) {
    const threadId = String(payload && payload.thread_id || '').trim();
    const response = await apiService.markMessageRead(threadId, payload && payload.last_message_id);
    return { marked: true, response: response.payload };
  });

  registerIpcHandler(ipcMain, 'messages:knowledge-list', function listKnowledge(payload) {
    return database.listResponseKnowledge(String(payload && payload.search || ''));
  });

  registerIpcHandler(ipcMain, 'messages:knowledge-save', function saveKnowledge(payload) {
    return database.saveResponseKnowledge(payload || {});
  });

  registerIpcHandler(ipcMain, 'messages:knowledge-delete', function deleteKnowledge(payload) {
    return { deleted: database.deleteResponseKnowledge(String(payload && payload.id || '')) };
  });
}

module.exports = {
  MESSAGE_IPC_CONTRACT,
  registerMessagesIpc
};
