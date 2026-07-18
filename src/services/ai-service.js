'use strict';

const crypto = require('node:crypto');
const { OpenAIProvider } = require('./openai-provider');
const { DeepSeekProvider } = require('./deepseek-provider');
const { MessageResponseEngine } = require('./message-response-engine');

const PROVIDER_CLASSES = 'provider classes: OpenAIProvider, DeepSeekProvider';
const PROVIDER_METHODS = 'provider methods: testConnection, generateSuggestion, cancelRequest, getStatus';

class AIService {
  constructor(database, settingsService) {
    this.database = database;
    this.settingsService = settingsService;
    this.providers = {
      openai: new OpenAIProvider(settingsService),
      deepseek: new DeepSeekProvider(settingsService)
    };
    this.messageEngine = new MessageResponseEngine(database);
  }

  getProvider(providerName) {
    const provider = this.providers[String(providerName || '').toLowerCase()];
    if (!provider) throw new Error('Unsupported AI provider.');
    return provider;
  }

  getStatus(providerName) {
    return this.getProvider(providerName).getStatus();
  }

  cancel(requestId) {
    return Object.values(this.providers).some(function cancelProvider(provider) {
      return provider.cancelRequest(requestId);
    });
  }

  async testConnection(providerName) {
    const requestId = 'test-' + String(providerName || '') + '-' + Date.now();
    return this.getProvider(providerName).testConnection(requestId);
  }

  buildPrompt(kind, entityType, entityId, focus) {
    const entity = this.database.getEntityContext(entityType, entityId);
    const daily = this.database.dailyContext();
    const instructions = {
      daily_priorities: 'Create a short prioritized action plan for today. Use numbered steps and explain why each item matters.',
      lead_next_step: 'Recommend the best next step for this lead. Include timing, objective, and a short follow-up note draft.',
      agenda_optimization: 'Suggest a practical way to organize the upcoming agenda and reduce conflicts or missed follow-ups.',
      follow_up_draft: 'Write a concise professional follow-up note. Do not claim that it was sent.',
      stale_leads: 'Identify the leads that need attention and recommend a specific next action for each one.',
      message_response_strategy: 'Review the selected website message thread metadata and available safe preview. Explain the likely intent, what information should be verified, and draft a professional response for user approval. Never claim it was sent.',
      order_follow_up: 'Review the selected website order or lead. Summarize the customer need, missing information, urgency, and recommend a concrete follow-up plan with a draft reply for user approval.'
    };
    const instruction = instructions[kind] || instructions.daily_priorities;
    const userFocus = String(focus || '').trim() || 'No additional instructions.';
    return {
      system: 'You are Nexa Smart Office Bot, a practical business productivity assistant. Give concrete suggestions only. Never claim you contacted anyone, changed records, or completed a task. The user must approve every action.',
      user: instruction + '\n\nUser focus: ' + userFocus + '\n\nSelected record: ' + JSON.stringify(entity) + '\n\nCurrent office context: ' + JSON.stringify(daily)
    };
  }


  providerConfigured(providerName) {
    try {
      return Boolean(this.getProvider(providerName).getStatus().configured);
    } catch (error) {
      return false;
    }
  }

  buildMessageReplyPrompt(conversation, focus) {
    const thread = conversation && conversation.thread ? conversation.thread : {};
    const messages = conversation && Array.isArray(conversation.messages) ? conversation.messages.slice(-60) : [];
    const transcript = messages.map(function transcriptLine(row) {
      const direction = String(row.direction || '').toLowerCase() === 'outbound' ? 'BUSINESS' : 'CUSTOMER';
      const name = row.sender_name ? ' (' + row.sender_name + ')' : '';
      return '[' + direction + name + ' · ' + String(row.sent_at || row.created_at || '') + '] ' + String(row.body || '');
    }).join('\n');
    const daily = this.database.dailyContext();
    const extra = String(focus || '').trim() || 'Prepare the most helpful next response.';
    return {
      system: [
        'You are Nexa Smart Office Bot, drafting a real-time business chat reply for human approval.',
        'Use the complete conversation and the safe business context supplied below.',
        'Answer only what is supported by the conversation or business data.',
        'Never invent inventory, prices, availability, appointments, financing approval, policies, or actions.',
        'Do not say a message was sent. Do not include internal analysis.',
        'Return only the proposed customer-facing reply, concise and professional.'
      ].join(' '),
      user: 'Thread: ' + JSON.stringify(thread) + '\n\nConversation:\n' + transcript + '\n\nSafe business context: ' + JSON.stringify(daily.connected_business || {}) + '\n\nUser instruction: ' + extra
    };
  }

  async generateMessageReply(input) {
    const threadId = String(input && input.thread_id || '').trim();
    if (!threadId) throw new Error('Select a message thread first.');
    const conversation = this.database.getMessageConversationContext(threadId, 120);
    if (!conversation) throw new Error('The selected conversation is not available locally.');
    const settings = this.settingsService.getPublicSettings();
    const mode = input && input.force_ai_only === true ? 'ai_only' : String(settings.message_ai_mode || 'knowledge_first');
    const allowFallback = input && input.force_ai_fallback === true ? true : String(settings.message_ai_fallback || '1') === '1';
    const localMatch = this.messageEngine.match(conversation);
    if (mode !== 'ai_only' && localMatch.matched) {
      this.database.incrementKnowledgeUse(localMatch.knowledgeId);
      const savedLocal = this.database.saveMessageDraft({
        thread_id: threadId,
        source: 'knowledge',
        provider: null,
        confidence: localMatch.confidence,
        trigger_text: localMatch.latestMessage,
        body: localMatch.response
      });
      return {
        engine: 'knowledge',
        confidence: localMatch.confidence,
        knowledge_id: localMatch.knowledgeId,
        label: localMatch.label,
        category: localMatch.category,
        intent_key: localMatch.intentKey,
        locale: localMatch.locale,
        dealer_segment: localMatch.dealerSegment,
        safety_level: localMatch.safetyLevel,
        required_context: localMatch.requiredContext,
        built_in: localMatch.builtIn,
        library_version: localMatch.libraryVersion,
        draft: savedLocal
      };
    }
    if (!allowFallback && mode !== 'ai_only') {
      throw new Error('No approved knowledge reply matched this message. AI fallback is disabled.');
    }
    const providerName = String(input.provider || settings.preferred_provider || 'openai').toLowerCase();
    if (!this.providerConfigured(providerName)) {
      throw new Error('No approved knowledge reply matched and the selected AI provider is not configured.');
    }
    const requestId = input.request_id || crypto.randomUUID();
    const prompt = this.buildMessageReplyPrompt(conversation, input.focus);
    const responseText = await this.getProvider(providerName).generateSuggestion(prompt, requestId);
    const saved = this.database.saveSuggestion({
      provider: providerName,
      kind: 'live_message_reply',
      related_type: 'message',
      related_id: threadId,
      prompt: prompt.user,
      response: responseText
    });
    const draft = this.database.saveMessageDraft({
      thread_id: threadId,
      source: 'ai',
      provider: providerName,
      confidence: 0,
      trigger_text: localMatch.latestMessage || '',
      body: responseText
    });
    return { engine: 'ai', provider: providerName, request_id: requestId, suggestion: saved, draft: draft, local_confidence: localMatch.confidence || 0 };
  }

  async generate(input) {
    const settings = this.settingsService.getPublicSettings();
    const providerName = input.provider || settings.preferred_provider || 'openai';
    const requestId = input.request_id || crypto.randomUUID();
    const prompt = this.buildPrompt(input.kind, input.related_type, input.related_id, input.focus);
    const responseText = await this.getProvider(providerName).generateSuggestion(prompt, requestId);
    const saved = this.database.saveSuggestion({
      provider: providerName,
      kind: input.kind,
      related_type: input.related_type,
      related_id: input.related_id,
      prompt: prompt.user,
      response: responseText
    });
    return { request_id: requestId, suggestion: saved };
  }
}

module.exports = {
  AIService,
  PROVIDER_CLASSES,
  PROVIDER_METHODS
};
