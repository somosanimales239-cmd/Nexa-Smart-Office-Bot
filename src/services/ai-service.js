'use strict';

const crypto = require('node:crypto');
const { OpenAIProvider } = require('./openai-provider');
const { DeepSeekProvider } = require('./deepseek-provider');

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
      stale_leads: 'Identify the leads that need attention and recommend a specific next action for each one.'
    };
    const instruction = instructions[kind] || instructions.daily_priorities;
    const userFocus = String(focus || '').trim() || 'No additional instructions.';
    return {
      system: 'You are Nexa Smart Office Bot, a practical business productivity assistant. Give concrete suggestions only. Never claim you contacted anyone, changed records, or completed a task. The user must approve every action.',
      user: instruction + '\n\nUser focus: ' + userFocus + '\n\nSelected record: ' + JSON.stringify(entity) + '\n\nCurrent office context: ' + JSON.stringify(daily)
    };
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
