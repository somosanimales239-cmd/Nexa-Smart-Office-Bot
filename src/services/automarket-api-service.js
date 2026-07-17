'use strict';

const crypto = require('node:crypto');

const DEFAULT_TIMEOUT_MS = 15000;
const AUTOMARKET_API_CONTRACT = 'NEXA_AUTOMARKET_API_V1';

function cleanBaseUrl(value) {
  const text = String(value || '').trim();
  if (!text) return '';
  let parsed;
  try {
    parsed = new URL(text);
  } catch (error) {
    throw new Error('Enter a valid HTTPS website or API URL.');
  }
  if (parsed.protocol !== 'https:' && parsed.hostname !== 'localhost') {
    throw new Error('The connected website must use HTTPS.');
  }
  parsed.hash = '';
  parsed.search = '';
  const pathname = parsed.pathname.replace(/\/+$/, '');
  if (/\/api\/v1\/index\.php$/i.test(pathname)) {
    parsed.pathname = pathname;
  } else {
    parsed.pathname = (pathname === '/' ? '' : pathname) + '/api/v1/index.php';
  }
  return parsed.toString().replace(/\/$/, '');
}

function stableHash(value) {
  return crypto.createHash('sha256').update(JSON.stringify(value === undefined ? null : value)).digest('hex');
}

function unwrapPayload(payload) {
  if (!payload || typeof payload !== 'object') return payload;
  if (Object.prototype.hasOwnProperty.call(payload, 'data')) return payload.data;
  if (Object.prototype.hasOwnProperty.call(payload, 'result')) return payload.result;
  return payload;
}

class AutoMarketApiService {
  constructor(settingsService) {
    this.settingsService = settingsService;
    this.activeController = null;
  }

  getConfiguration() {
    const publicSettings = this.settingsService.getPublicSettings();
    return {
      baseUrl: cleanBaseUrl(publicSettings.automarket_base_url || ''),
      configured: Boolean(publicSettings.secrets && publicSettings.secrets.automarket && publicSettings.secrets.automarket.configured),
      pollMinutes: Math.min(Math.max(Number(publicSettings.automarket_poll_minutes || 5), 1), 120),
      syncEnabled: String(publicSettings.automarket_sync_enabled || '0') === '1'
    };
  }

  async request(resource, query, options) {
    const configuration = this.getConfiguration();
    if (!configuration.baseUrl) throw new Error('AutoMarket website URL is not configured.');
    const apiKey = this.settingsService.getSecret('automarket');
    if (!apiKey) throw new Error('AutoMarket API key is not configured.');

    const url = new URL(configuration.baseUrl);
    url.searchParams.set('resource', String(resource || 'ping'));
    Object.entries(query || {}).forEach(function appendQuery(entry) {
      const key = entry[0];
      const value = entry[1];
      if (value !== undefined && value !== null && String(value) !== '') url.searchParams.set(key, String(value));
    });

    const controller = new AbortController();
    this.activeController = controller;
    const timeoutMs = Math.min(Math.max(Number(options && options.timeoutMs) || DEFAULT_TIMEOUT_MS, 3000), 60000);
    const timeout = setTimeout(function abortRequest() { controller.abort(); }, timeoutMs);
    try {
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          Accept: 'application/json',
          Authorization: 'Bearer ' + apiKey,
          'X-Nexa-Client': 'Nexa-Smart-Office-Bot/1.1.0'
        },
        signal: controller.signal,
        redirect: 'error'
      });
      const text = await response.text();
      let payload = null;
      try {
        payload = text ? JSON.parse(text) : {};
      } catch (error) {
        throw new Error('The website returned an invalid API response (HTTP ' + response.status + ').');
      }
      if (!response.ok) {
        const message = payload && (payload.error || payload.message) ? (payload.error || payload.message) : 'API request failed';
        throw new Error(String(message) + ' (HTTP ' + response.status + ')');
      }
      return {
        resource: resource,
        url: url.toString(),
        payload: unwrapPayload(payload),
        raw: payload,
        status: response.status,
        receivedAt: new Date().toISOString()
      };
    } catch (error) {
      if (error && error.name === 'AbortError') throw new Error('The connected website did not respond before the timeout.');
      throw error;
    } finally {
      clearTimeout(timeout);
      if (this.activeController === controller) this.activeController = null;
    }
  }

  cancel() {
    if (this.activeController) this.activeController.abort();
  }

  async testConnection() {
    const ping = await this.request('ping');
    const map = await this.request('connection-map');
    return {
      ok: true,
      ping: ping.payload,
      connectionMap: map.payload,
      testedAt: new Date().toISOString()
    };
  }

  async fetchResource(resource, query) {
    return this.request(resource, query || {});
  }

  async fetchDashboard(resources) {
    const requested = Array.from(new Set((resources || []).filter(Boolean)));
    const output = {};
    for (const resource of requested) {
      try {
        output[resource] = (await this.fetchResource(resource, resource === 'listings' ? { status: 'active', limit: 50 } : { limit: 50 })).payload;
      } catch (error) {
        output[resource] = { __error: error.message };
      }
    }
    return output;
  }
}

module.exports = {
  AUTOMARKET_API_CONTRACT,
  AutoMarketApiService,
  cleanBaseUrl,
  stableHash
};
