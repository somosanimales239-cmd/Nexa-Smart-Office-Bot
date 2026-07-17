'use strict';

const NEXA_AI_NOT_CONFIGURED_CONTRACT = 'error marker: AI provider not configured';
const NEXA_AI_TIMEOUT_CONTRACT = 'timeout marker: AI_REQUEST_TIMEOUT_MS';

const { AI_REQUEST_TIMEOUT_MS } = require('./openai-provider');

function normalizeBaseUrl(value) {
  const parsed = new URL(String(value || '').trim());
  if (parsed.protocol !== 'https:') throw new Error('DeepSeek base URL must use HTTPS.');
  let result = parsed.toString();
  while (result.endsWith('/')) result = result.slice(0, -1);
  return result;
}

class DeepSeekProvider {
  constructor(settingsService) {
    this.settingsService = settingsService;
    this.controllers = new Map();
  }

  getStatus() {
    const settings = this.settingsService.getPublicSettings();
    return {
      provider: 'deepseek',
      configured: Boolean(settings.secrets && settings.secrets.deepseek && settings.secrets.deepseek.configured),
      model: settings.deepseek_model || '',
      baseUrl: settings.deepseek_base_url || ''
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
    const key = this.settingsService.getSecret('deepseek');
    if (!key) throw new Error('AI provider not configured: DeepSeek API key is missing.');
    const settings = this.settingsService.getPublicSettings();
    const baseUrl = normalizeBaseUrl(settings.deepseek_base_url || 'https://api.deepseek.com');
    await this.request(baseUrl + '/models', {
      headers: { Authorization: 'Bearer ' + key }
    }, requestId, 20000);
    return { provider: 'deepseek', model: settings.deepseek_model || '', baseUrl: baseUrl };
  }

  async generateSuggestion(input, requestId) {
    const key = this.settingsService.getSecret('deepseek');
    if (!key) throw new Error('AI provider not configured: DeepSeek API key is missing.');
    const settings = this.settingsService.getPublicSettings();
    const model = String(settings.deepseek_model || '').trim();
    if (!model) throw new Error('DeepSeek model is not configured.');
    const baseUrl = normalizeBaseUrl(settings.deepseek_base_url || 'https://api.deepseek.com');
    const body = await this.request(baseUrl + '/chat/completions', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: model,
        messages: [
          { role: 'system', content: input.system },
          { role: 'user', content: input.user }
        ],
        max_tokens: 900,
        temperature: 0.4
      })
    }, requestId, AI_REQUEST_TIMEOUT_MS);
    const choices = body && Array.isArray(body.choices) ? body.choices : [];
    const text = choices[0] && choices[0].message ? String(choices[0].message.content || '').trim() : '';
    if (!text) throw new Error('The AI provider returned an empty response.');
    return text;
  }
}

module.exports = {
  DeepSeekProvider,
  normalizeBaseUrl
};
