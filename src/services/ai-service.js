'use strict';

const crypto = require('node:crypto');
const activeRequests = new Map();

const cleanBaseUrl = (url) => {
  const parsed = new URL(String(url || '').trim());
  if (parsed.protocol !== 'https:') throw new Error('DeepSeek base URL must use HTTPS.');
  return parsed.toString().replace(/\/+$/, '');
};

function extractOpenAIText(payload) {
  if (typeof payload?.output_text === 'string' && payload.output_text.trim()) return payload.output_text.trim();
  const parts = [];
  for (const item of payload?.output || []) {
    for (const content of item?.content || []) {
      if (typeof content?.text === 'string') parts.push(content.text);
    }
  }
  return parts.join('\n').trim();
}

class AIService {
  constructor(database, secretStore) {
    this.database = database;
    this.secretStore = secretStore;
  }

  async requestJson(url, options, requestId, timeoutMs = 45000) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new Error('Request timed out.')), timeoutMs);
    activeRequests.set(requestId, controller);
    try {
      const response = await fetch(url, { ...options, signal: controller.signal });
      const text = await response.text();
      let body;
      try { body = text ? JSON.parse(text) : {}; } catch (_) { body = { raw: text }; }
      if (!response.ok) {
        const message = body?.error?.message || body?.message || body?.raw || `HTTP ${response.status}`;
        throw new Error(String(message).slice(0, 1000));
      }
      return body;
    } finally {
      clearTimeout(timer);
      activeRequests.delete(requestId);
    }
  }

  cancel(requestId) {
    const controller = activeRequests.get(requestId);
    if (!controller) return false;
    controller.abort();
    return true;
  }

  async testConnection(provider) {
    const settings = this.database.getSettings();
    const requestId = `test-${provider}-${Date.now()}`;
    if (provider === 'openai') {
      const key = this.secretStore.get('openai');
      if (!key) throw new Error('OpenAI API key is not configured.');
      await this.requestJson('https://api.openai.com/v1/models', { headers: { Authorization: `Bearer ${key}` } }, requestId, 20000);
      return { ok: true, provider: 'openai', model: settings.openai_model };
    }
    if (provider === 'deepseek') {
      const key = this.secretStore.get('deepseek');
      if (!key) throw new Error('DeepSeek API key is not configured.');
      const baseUrl = cleanBaseUrl(settings.deepseek_base_url || 'https://api.deepseek.com');
      await this.requestJson(`${baseUrl}/models`, { headers: { Authorization: `Bearer ${key}` } }, requestId, 20000);
      return { ok: true, provider: 'deepseek', model: settings.deepseek_model };
    }
    throw new Error('Unsupported AI provider.');
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
    return {
      system: 'You are Nexa Smart Office Bot, a practical business productivity assistant. Give concrete suggestions only. Never claim you contacted anyone, changed records, or completed a task. The user must approve every action.',
      user: `${instructions[kind] || instructions.daily_priorities}\n\nUser focus: ${String(focus || '').trim() || 'No additional instructions.'}\n\nSelected record: ${JSON.stringify(entity)}\n\nCurrent office context: ${JSON.stringify(daily)}`
    };
  }

  async generate(input) {
    const settings = this.database.getSettings();
    const provider = input.provider || settings.preferred_provider || 'openai';
    const requestId = input.request_id || crypto.randomUUID();
    const prompt = this.buildPrompt(input.kind, input.related_type, input.related_id, input.focus);
    let responseText = '';

    if (provider === 'openai') {
      const key = this.secretStore.get('openai');
      if (!key) throw new Error('AI provider not configured: OpenAI API key is missing.');
      const body = await this.requestJson('https://api.openai.com/v1/responses', {
        method: 'POST',
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: settings.openai_model || 'gpt-5.6-luna',
          input: [
            { role: 'system', content: [{ type: 'input_text', text: prompt.system }] },
            { role: 'user', content: [{ type: 'input_text', text: prompt.user }] }
          ],
          max_output_tokens: 900
        })
      }, requestId);
      responseText = extractOpenAIText(body);
    } else if (provider === 'deepseek') {
      const key = this.secretStore.get('deepseek');
      if (!key) throw new Error('AI provider not configured: DeepSeek API key is missing.');
      const baseUrl = cleanBaseUrl(settings.deepseek_base_url || 'https://api.deepseek.com');
      const body = await this.requestJson(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: settings.deepseek_model || 'deepseek-v4-flash',
          messages: [
            { role: 'system', content: prompt.system },
            { role: 'user', content: prompt.user }
          ],
          max_tokens: 900,
          temperature: 0.4
        })
      }, requestId);
      responseText = String(body?.choices?.[0]?.message?.content || '').trim();
    } else {
      throw new Error('Unsupported AI provider.');
    }

    if (!responseText) throw new Error('The AI provider returned an empty response.');
    const saved = this.database.saveSuggestion({
      provider,
      kind: input.kind,
      related_type: input.related_type,
      related_id: input.related_id,
      prompt: prompt.user,
      response: responseText
    });
    return { request_id: requestId, suggestion: saved };
  }
}

module.exports = { AIService, extractOpenAIText };
