'use strict';

const NEXA_AI_NOT_CONFIGURED_CONTRACT = 'error marker: AI provider not configured';
const NEXA_AI_TIMEOUT_CONTRACT = 'timeout marker: AI_REQUEST_TIMEOUT_MS';

const AI_REQUEST_TIMEOUT_MS = 45000;

function extractOpenAIText(payload) {
  if (payload && typeof payload.output_text === 'string' && payload.output_text.trim()) {
    return payload.output_text.trim();
  }
  const parts = [];
  const output = payload && Array.isArray(payload.output) ? payload.output : [];
  output.forEach(function eachOutput(item) {
    const contentItems = item && Array.isArray(item.content) ? item.content : [];
    contentItems.forEach(function eachContent(content) {
      if (content && typeof content.text === 'string') parts.push(content.text);
    });
  });
  return parts.join('\n').trim();
}

class OpenAIProvider {
  constructor(settingsService) {
    this.settingsService = settingsService;
    this.controllers = new Map();
  }

  getStatus() {
    const settings = this.settingsService.getPublicSettings();
    return {
      provider: 'openai',
      configured: Boolean(settings.secrets && settings.secrets.openai && settings.secrets.openai.configured),
      model: settings.openai_model || ''
    };
  }

  cancelRequest(requestId) {
    const controller = this.controllers.get(String(requestId || ''));
    if (!controller) return false;
    controller.abort();
    return true;
  }

  async request(url, options, requestId, timeoutMs) {
    const controller = new AbortController();
    const timeout = Number(timeoutMs) || AI_REQUEST_TIMEOUT_MS;
    const timer = setTimeout(function abortTimedOutRequest() {
      controller.abort(new Error('Request timed out.'));
    }, timeout);
    this.controllers.set(requestId, controller);
    try {
      const response = await fetch(url, Object.assign({}, options, { signal: controller.signal }));
      const rawText = await response.text();
      let body = {};
      try { body = rawText ? JSON.parse(rawText) : {}; } catch (error) { body = { raw: rawText }; }
      if (!response.ok) {
        const message = body && body.error && body.error.message ? body.error.message : body.message || body.raw || 'HTTP ' + response.status;
        throw new Error(String(message).slice(0, 1000));
      }
      return body;
    } finally {
      clearTimeout(timer);
      this.controllers.delete(requestId);
    }
  }

  async testConnection(requestId) {
    const key = this.settingsService.getSecret('openai');
    if (!key) throw new Error('AI provider not configured: OpenAI API key is missing.');
    const settings = this.settingsService.getPublicSettings();
    await this.request('https://api.openai.com/v1/models', {
      headers: { Authorization: 'Bearer ' + key }
    }, requestId, 20000);
    return { provider: 'openai', model: settings.openai_model || '' };
  }

  async generateSuggestion(input, requestId) {
    const key = this.settingsService.getSecret('openai');
    if (!key) throw new Error('AI provider not configured: OpenAI API key is missing.');
    const settings = this.settingsService.getPublicSettings();
    const model = String(settings.openai_model || '').trim();
    if (!model) throw new Error('OpenAI model is not configured.');
    const body = await this.request('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: model,
        input: [
          { role: 'system', content: [{ type: 'input_text', text: input.system }] },
          { role: 'user', content: [{ type: 'input_text', text: input.user }] }
        ],
        max_output_tokens: 900
      })
    }, requestId, AI_REQUEST_TIMEOUT_MS);
    const text = extractOpenAIText(body);
    if (!text) throw new Error('The AI provider returned an empty response.');
    return text;
  }
}

module.exports = {
  AI_REQUEST_TIMEOUT_MS,
  OpenAIProvider,
  extractOpenAIText
};
