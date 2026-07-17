'use strict';

const crypto = require('node:crypto');

const DEFAULT_TIMEOUT_MS = 20000;
const AUTOMARKET_API_CONTRACT = 'NEXA_AUTOMARKET_API_V1';
const NEXA_API_SYNC_INSPECTOR_V1 = 'NEXA_API_SYNC_INSPECTOR_V1';

const ACCOUNT_RESOURCE_PLANS = Object.freeze({
  dealer: Object.freeze([
    ['store', 'store:read'],
    ['dealer-summary', 'dealer:read'],
    ['listings', 'listings:read'],
    ['orders', 'orders:read'],
    ['agenda', 'agenda:read'],
    ['messages', 'messages:read'],
    ['resellers', 'resellers:read']
  ]),
  reseller: Object.freeze([
    ['reseller-profile', 'reseller-profile:read'],
    ['reseller-summary', 'reseller:read'],
    ['reseller-listings', 'reseller-listings:read'],
    ['reseller-appointments', 'reseller-appointments:read'],
    ['agenda', 'agenda:read'],
    ['messages', 'messages:read']
  ]),
  admin: Object.freeze([
    ['admin-summary', 'admin:read'],
    ['stores', 'stores:read'],
    ['users', 'users:read'],
    ['listings', 'listings:read'],
    ['orders', 'orders:read'],
    ['agenda', 'agenda:read'],
    ['messages', 'messages:read'],
    ['resellers', 'resellers:read'],
    ['validation', 'validation:read'],
    ['api-keys-status', 'admin:read']
  ])
});

const SAFE_RESOURCES = new Set([
  'ping', 'connection-map', 'store', 'dealer-summary', 'listings', 'orders', 'agenda', 'messages', 'resellers',
  'reseller-profile', 'reseller-summary', 'reseller-listings', 'reseller-appointments',
  'admin-summary', 'stores', 'users', 'validation', 'api-keys-status'
]);


const RESOURCE_FIELD_ALLOWLISTS = Object.freeze({
  ping: ['contract','account_type','owner_type','account_id','owner_id','user_id','store_id','scopes','available_resources','api_version','status','message','ok'],
  'connection-map': ['contract','account_type','owner_type','account_id','owner_id','user_id','store_id','scopes','available_resources','allowed_resources','resources','api_version','security','rate_limit'],
  store: ['store_id','owner_id','store_name','store_slug','slug','headline','description','phone','email','location','address','city','state','zip','logo_url','banner_url','primary_color','store_template','status','public_store_url'],
  'dealer-summary': ['total_listings','active_listings','inactive_listings','draft_listings','new_orders','unreviewed_orders','pending_orders','completed_orders','agenda_contacts','unread_messages','reseller_appointments','upcoming_appointments','today_appointments','credit_applications'],
  listings: ['id','listing_id','store_id','title','listing_title','slug','category','subcategory','price','condition','status','quantity','description','short_description','main_image_url','listing_image_url','gallery_images','video_url','listing_url','financing_enabled','created_at','updated_at','year','make','model','trim','mileage','vin','stock_number','title_status','fuel_type','transmission','exterior_color','interior_color'],
  orders: ['id','order_id','listing_id','store_id','listing_title','listing_url','listing_image_url','customer_name','customer_email','customer_phone','customer_location','message','order_notes','order_type','source','status','created_at','updated_at','reseller_id','reseller_name','reseller_email','appointment_date','appointment_time','appointment_status','sale_status','sale_price','commission_percent','commission_amount','dealer_status_note'],
  agenda: ['id','contact_id','store_id','owner_id','name','email','phone','location','source_type','times_seen','first_seen_at','last_seen_at','created_from'],
  messages: ['id','thread_id','subject','context_type','context_id','store_id','sender_type','receiver_type','last_message_at','created_at','updated_at','message_count','unread_count','is_favorite','is_pinned','is_announcement','audience','can_reply','message_preview','last_message_preview'],
  resellers: ['id','reseller_id','reseller_name','reseller_email','reseller_phone','status','assigned_listings','appointment_count','pending_appointments','completed_appointments','positive_sales','commission_percent','commission_amount','last_activity','appointments'],
  'reseller-profile': ['reseller_id','name','email','phone','location','professional_title','bio','languages','rating','status','visibility','profile_image_url'],
  'reseller-summary': ['assigned_listings','appointments_created','appointments_pending','appointments_completed','positive_sales','commission_total','unread_messages','agenda_contacts'],
  'reseller-listings': ['id','assignment_id','listing_id','store_id','dealer_name','store_name','listing_title','listing_url','listing_image_url','price','category','status','commission_percent','agreement_status','created_at'],
  'reseller-appointments': ['id','appointment_id','listing_id','store_id','dealer_name','store_name','customer_name','customer_phone','customer_email','customer_location','appointment_date','appointment_time','appointment_status','sale_status','sale_price','commission_percent','commission_amount','dealer_note','created_at','updated_at'],
  'admin-summary': ['total_users','total_dealers','total_buyers','total_resellers','total_stores','active_stores','inactive_stores','pending_validations','total_listings','active_listings','total_orders','unreviewed_orders','total_messages'],
  stores: ['id','store_id','owner_id','store_name','slug','email','phone','location','status','logo_url','banner_url','listings_count','orders_count','created_at','updated_at','public_store_url'],
  users: ['id','user_id','account_id','name','email','role','status','location','created_at','last_login_at'],
  validation: ['id','validation_id','dealer_user_id','store_id','business_name','authorized_representative','phone','email','address','city','state','zip','driver_license_number','dealer_license_number','business_tax_account_number','business_tax_receipt_number','resale_certificate_number','status','submitted_at','reviewed_at','reviewed_by','admin_note'],
  'api-keys-status': ['id','key_id','name','owner_type','owner_id','status','scopes','expires_at','last_used_at','created_at','updated_at']
});

const LIST_CONTAINER_KEYS = Object.freeze(['items','records','rows','listings','orders','contacts','agenda','messages','threads','resellers','appointments','assignments','stores','users','validations','api_keys']);

function sanitizeRecord(resource, record) {
  if (!record || typeof record !== 'object' || Array.isArray(record)) return record;
  const allowed = new Set(RESOURCE_FIELD_ALLOWLISTS[resource] || []);
  const output = {};
  Object.entries(record).forEach(function keepAllowed(entry) {
    const key = entry[0];
    const value = entry[1];
    if (!allowed.has(key)) return;
    if (key === 'appointments' && Array.isArray(value)) {
      output[key] = value.map(function sanitizeAppointment(item) { return sanitizeRecord('reseller-appointments', item); });
      return;
    }
    output[key] = value;
  });
  return output;
}

function sanitizeResourcePayload(resource, payload) {
  if (Array.isArray(payload)) return payload.map(function sanitizeItem(item) { return sanitizeRecord(resource, item); });
  if (!payload || typeof payload !== 'object') return payload;
  const hasContainer = LIST_CONTAINER_KEYS.some(function hasList(key) { return Array.isArray(payload[key]); });
  if (!hasContainer) return sanitizeRecord(resource, payload);
  const output = sanitizeRecord(resource, payload);
  LIST_CONTAINER_KEYS.forEach(function sanitizeList(key) {
    if (Array.isArray(payload[key])) output[key] = payload[key].map(function sanitizeItem(item) { return sanitizeRecord(resource, item); });
  });
  for (const key of ['total','count','page','limit','next_cursor','has_more']) {
    if (Object.prototype.hasOwnProperty.call(payload, key)) output[key] = payload[key];
  }
  return output;
}

const RESOURCE_QUERIES = Object.freeze({
  listings: { limit: 100 },
  orders: { limit: 100 },
  agenda: { limit: 100 },
  messages: { limit: 100 },
  resellers: { limit: 100 },
  'reseller-listings': { limit: 100 },
  'reseller-appointments': { limit: 100 },
  stores: { limit: 100 },
  users: { limit: 100 },
  validation: { limit: 100 }
});

class AutoMarketApiError extends Error {
  constructor(message, details) {
    super(message);
    this.name = 'AutoMarketApiError';
    this.resource = details && details.resource ? details.resource : null;
    this.status = Number(details && details.status || 0);
    this.code = details && details.code ? details.code : '';
    this.scope = details && details.scope ? details.scope : '';
    this.retryable = Boolean(details && details.retryable);
  }
}

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

function normalizeAccountType(value) {
  const text = String(value || '').trim().toLowerCase();
  if (text.includes('reseller')) return 'reseller';
  if (text.includes('dealer') || text.includes('store')) return 'dealer';
  if (text.includes('admin')) return 'admin';
  return text || 'unknown';
}

function normalizeStringArray(value) {
  if (!value) return [];
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) return normalizeStringArray(parsed);
    } catch (_) { /* comma-separated fallback */ }
    return value.split(',').map(function clean(item) { return item.trim(); }).filter(Boolean);
  }
  if (Array.isArray(value)) {
    return value.map(function mapItem(item) {
      if (typeof item === 'string') return item;
      if (item && typeof item === 'object') return item.resource || item.name || item.scope || item.id || '';
      return '';
    }).map(String).map(function clean(item) { return item.trim(); }).filter(Boolean);
  }
  if (typeof value === 'object') return Object.keys(value);
  return [];
}

function extractAvailableResources(connectionMap) {
  const map = connectionMap && typeof connectionMap === 'object' ? connectionMap : {};
  const source = map.available_resources || map.resources || map.endpoints || map.allowed_resources || [];
  return Array.from(new Set(normalizeStringArray(source).map(function normalize(resource) {
    return resource.replace(/^resource=/i, '').trim().toLowerCase();
  }).filter(function safe(resource) { return SAFE_RESOURCES.has(resource); })));
}

function deriveConnectionIdentity(pingPayload, connectionMap) {
  const ping = pingPayload && typeof pingPayload === 'object' ? pingPayload : {};
  const map = connectionMap && typeof connectionMap === 'object' ? connectionMap : {};
  const source = Object.assign({}, ping, map.identity || {}, map.account || {}, map);
  const accountType = normalizeAccountType(source.account_type || source.owner_type || source.role || source.user_type);
  return {
    contract: source.contract || map.contract || '',
    account_type: accountType,
    owner_type: source.owner_type || source.account_type || source.role || accountType,
    account_id: source.account_id || source.owner_id || source.user_id || source.reseller_id || null,
    owner_id: source.owner_id || source.account_id || null,
    user_id: source.user_id || null,
    store_id: source.store_id || null,
    scopes: Array.from(new Set(normalizeStringArray(source.scopes || source.allowed_scopes || map.scopes))),
    available_resources: extractAvailableResources(map),
    api_version: source.api_version || map.api_version || 'v1'
  };
}

function resourcePlan(identity) {
  const accountType = normalizeAccountType(identity && identity.account_type);
  const available = new Set(normalizeStringArray(identity && identity.available_resources).map(function lower(item) { return item.toLowerCase(); }));
  const scopes = new Set(normalizeStringArray(identity && identity.scopes));
  const configured = ACCOUNT_RESOURCE_PLANS[accountType] || [];
  const candidates = configured.length ? configured : Array.from(available).map(function makeEntry(resource) { return [resource, '']; });
  return candidates.filter(function allowed(entry) {
    const resource = entry[0];
    if (!SAFE_RESOURCES.has(resource)) return false;
    if (available.size && !available.has(resource)) return false;
    return true;
  }).map(function mapEntry(entry) {
    const requiredScope = entry[1] || '';
    return {
      resource: entry[0],
      requiredScope: requiredScope,
      scopeGranted: !requiredScope || !scopes.size || scopes.has(requiredScope),
      query: Object.assign({}, RESOURCE_QUERIES[entry[0]] || {})
    };
  });
}

function errorDetails(payload, fallback) {
  if (!payload || typeof payload !== 'object') return { message: fallback, code: '', scope: '' };
  const nested = payload.error && typeof payload.error === 'object' ? payload.error : {};
  return {
    message: String(nested.message || payload.message || payload.error_description || (typeof payload.error === 'string' ? payload.error : '') || fallback),
    code: String(nested.code || payload.code || ''),
    scope: String(nested.scope || payload.required_scope || payload.scope || '')
  };
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
      maxItems: Math.min(Math.max(Number(publicSettings.automarket_max_items || 100), 10), 100),
      syncEnabled: String(publicSettings.automarket_sync_enabled || '0') === '1'
    };
  }

  async request(resource, query, options) {
    const resourceName = String(resource || 'ping').trim().toLowerCase();
    if (!SAFE_RESOURCES.has(resourceName)) throw new AutoMarketApiError('Unsupported API resource: ' + resourceName, { resource: resourceName });
    const configuration = this.getConfiguration();
    if (!configuration.baseUrl) throw new AutoMarketApiError('AutoMarket website URL is not configured.', { resource: resourceName });
    const apiKey = this.settingsService.getSecret('automarket');
    if (!apiKey) throw new AutoMarketApiError('AutoMarket API key is not configured.', { resource: resourceName });

    const url = new URL(configuration.baseUrl);
    url.searchParams.set('resource', resourceName);
    Object.entries(query || {}).forEach(function appendQuery(entry) {
      const key = entry[0];
      const value = entry[1];
      if (value !== undefined && value !== null && String(value) !== '') url.searchParams.set(key, String(value));
    });

    const controller = new AbortController();
    this.activeController = controller;
    const timeoutMs = Math.min(Math.max(Number(options && options.timeoutMs) || DEFAULT_TIMEOUT_MS, 3000), 60000);
    const timeout = setTimeout(function abortRequest() { controller.abort(); }, timeoutMs);
    const startedAt = Date.now();
    try {
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          Accept: 'application/json',
          Authorization: 'Bearer ' + apiKey,
          'X-Nexa-Api-Key': apiKey,
          'X-Nexa-Client': 'Nexa-Smart-Office-Bot/1.2.0'
        },
        signal: controller.signal,
        redirect: 'error'
      });
      const text = await response.text();
      let payload = null;
      try {
        payload = text ? JSON.parse(text) : {};
      } catch (error) {
        throw new AutoMarketApiError('The website returned an invalid JSON response (HTTP ' + response.status + ').', {
          resource: resourceName,
          status: response.status,
          retryable: response.status >= 500
        });
      }
      if (!response.ok) {
        const details = errorDetails(payload, 'API request failed');
        throw new AutoMarketApiError(details.message + ' (HTTP ' + response.status + ')', {
          resource: resourceName,
          status: response.status,
          code: details.code,
          scope: details.scope,
          retryable: response.status === 408 || response.status === 429 || response.status >= 500
        });
      }
      const unwrappedPayload = unwrapPayload(payload);
      const safePayload = sanitizeResourcePayload(resourceName, unwrappedPayload);
      return {
        resource: resourceName,
        url: url.toString(),
        payload: safePayload,
        raw: payload,
        status: response.status,
        durationMs: Date.now() - startedAt,
        receivedAt: new Date().toISOString()
      };
    } catch (error) {
      if (error && error.name === 'AbortError') {
        throw new AutoMarketApiError('The connected website did not respond before the timeout.', {
          resource: resourceName,
          code: 'timeout',
          retryable: true
        });
      }
      if (error instanceof AutoMarketApiError) throw error;
      throw new AutoMarketApiError(String(error && error.message || error), {
        resource: resourceName,
        code: 'network_error',
        retryable: true
      });
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
    const identity = deriveConnectionIdentity(ping.payload, map.payload);
    return {
      ok: true,
      ping: ping.payload,
      connectionMap: map.payload,
      identity: identity,
      resources: resourcePlan(identity),
      diagnostics: [ping, map].map(function diagnostic(response) {
        return { resource: response.resource, status: 'ok', httpStatus: response.status, durationMs: response.durationMs, checkedAt: response.receivedAt };
      }),
      testedAt: new Date().toISOString()
    };
  }

  async fetchResource(resource, query) {
    const configuration = this.getConfiguration();
    const merged = Object.assign({}, RESOURCE_QUERIES[resource] || {}, query || {});
    if (Object.prototype.hasOwnProperty.call(merged, 'limit')) merged.limit = Math.min(Number(merged.limit) || configuration.maxItems, configuration.maxItems);
    return this.request(resource, merged);
  }
}

module.exports = {
  ACCOUNT_RESOURCE_PLANS,
  AUTOMARKET_API_CONTRACT,
  AutoMarketApiError,
  AutoMarketApiService,
  NEXA_API_SYNC_INSPECTOR_V1,
  SAFE_RESOURCES,
  cleanBaseUrl,
  deriveConnectionIdentity,
  extractAvailableResources,
  normalizeAccountType,
  normalizeStringArray,
  resourcePlan,
  sanitizeRecord,
  sanitizeResourcePayload,
  stableHash,
  unwrapPayload
};
