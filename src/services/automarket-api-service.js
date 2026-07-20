'use strict';

const crypto = require('node:crypto');
const { localDateKey } = require('./dealer-availability-service');

const DEFAULT_TIMEOUT_MS = 20000;
const AUTOMARKET_API_CONTRACT = 'NEXA_AUTOMARKET_API_V1';
const NEXA_API_SYNC_INSPECTOR_V1 = 'NEXA_API_SYNC_INSPECTOR_V1';
const CLIENT_VERSION = require('../../package.json').version;

const ACCOUNT_RESOURCE_PLANS = Object.freeze({
  dealer: Object.freeze([
    ['store', 'store:read'],
    ['dealer-summary', 'dealer:read'],
    ['listings', 'listings:read'],
    ['orders', 'orders:read'],
    ['agenda', 'agenda:read'],
    ['messages', 'messages:read'],
    ['resellers', 'resellers:read'],
    ['dealer-appointment-availability', 'dealer-appointment-availability:read'],
    ['dealer-agenda-calendar', 'dealer-agenda-calendar:read']
  ]),
  reseller: Object.freeze([
    ['reseller-profile', 'reseller-profile:read'],
    ['reseller-summary', 'reseller:read'],
    ['reseller-listings', 'reseller-listings:read'],
    ['reseller-appointments', 'reseller-appointments:read'],
    ['agenda', 'agenda:read'],
    ['messages', 'messages:read'],
    ['dealer-appointment-availability', 'dealer-appointment-availability:read'],
    ['dealer-agenda-calendar', 'dealer-agenda-calendar:read']
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
    ['api-keys-status', 'admin:read'],
    ['dealer-appointment-availability', 'dealer-appointment-availability:read'],
    ['dealer-agenda-calendar', 'dealer-agenda-calendar:read']
  ])
});

const SAFE_RESOURCES = new Set([
  'ping', 'connection-map', 'store', 'dealer-summary', 'listings', 'orders', 'agenda', 'messages', 'message-thread', 'message-send', 'message-read', 'resellers',
  'reseller-profile', 'reseller-summary', 'reseller-listings', 'reseller-appointments',
  'admin-summary', 'stores', 'users', 'validation', 'api-keys-status', 'dealer-appointment-availability', 'dealer-agenda-calendar', 'appointment-create'
]);


const RESOURCE_FIELD_ALLOWLISTS = Object.freeze({
  ping: ['contract','account_type','owner_type','account_id','owner_id','user_id','store_id','scopes','allowed_scopes','permissions','available_resources','api_version','status','message','ok'],
  'connection-map': ['contract','account_type','owner_type','account_id','owner_id','user_id','store_id','scopes','allowed_scopes','permissions','available_resources','allowed_resources','resources','endpoints','allowed_endpoints','api_version','security','rate_limit','capabilities','message_capabilities','message_threads','message_thread','message_send','message_read','messages_read_enabled','messages_write_enabled','message_thread_endpoint','message_send_endpoint','message_read_endpoint','messages_thread_endpoint','messages_send_endpoint','messages_read_endpoint','two_way_chat','two_way_chat_enabled','dealer-appointment-availability','dealer_appointment_availability','dealer_appointment_availability_enabled','dealer_appointment_availability_endpoint','dealer-agenda-calendar','dealer_agenda_calendar','dealer_agenda_calendar_enabled','dealer_agenda_calendar_endpoint','appointment-create','appointment_create','appointment_create_enabled','appointment_create_endpoint','lead-appointment-create','nexa-appointment-create','appointment-create-from-thread','lead_appointment_create_endpoint','nexa_appointment_create_endpoint','appointment_create_from_thread_endpoint'],
  store: ['store_id','owner_id','store_name','store_slug','slug','headline','description','phone','email','location','address','city','state','zip','logo_url','banner_url','primary_color','store_template','status','public_store_url'],
  'dealer-summary': ['total_listings','active_listings','inactive_listings','draft_listings','new_orders','unreviewed_orders','pending_orders','completed_orders','agenda_contacts','unread_messages','reseller_appointments','upcoming_appointments','today_appointments','credit_applications'],
  listings: ['id','listing_id','store_id','title','listing_title','slug','category','subcategory','price','condition','status','quantity','description','short_description','main_image_url','listing_image_url','gallery_images','video_url','listing_url','financing_enabled','created_at','updated_at','year','make','model','trim','mileage','vin','stock_number','title_status','fuel_type','transmission','exterior_color','interior_color'],
  orders: ['id','order_id','listing_id','store_id','listing_title','listing_url','listing_image_url','customer_name','customer_email','customer_phone','customer_location','message','order_notes','order_type','source','status','created_at','updated_at','reseller_id','reseller_name','reseller_email','appointment_date','appointment_time','appointment_status','sale_status','sale_price','commission_percent','commission_amount','dealer_status_note'],
  agenda: ['id','contact_id','store_id','owner_id','name','email','phone','location','source_type','times_seen','first_seen_at','last_seen_at','created_from'],
  messages: ['id','thread_id','subject','context_type','context_id','store_id','sender_type','receiver_type','participant_name','participant_type','last_message_id','last_message_at','created_at','updated_at','message_count','unread_count','is_favorite','is_pinned','is_announcement','audience','can_reply','message_preview','last_message_preview','capabilities'],
  'message-thread': ['id','thread_id','subject','context_type','context_id','store_id','participant_name','participant_type','customer_name','customer_phone','customer_email','customer_location','sender_type','receiver_type','last_message_id','last_message_at','message_count','unread_count','is_announcement','can_reply','next_cursor','sync_cursor','created_at','updated_at'],
  'message-send': ['id','message_id','thread_id','client_message_id','sender_type','sender_id','sender_name','receiver_type','direction','body','body_format','sent_at','created_at','updated_at','status','is_read'],
  'message-read': ['thread_id','message_id','last_message_id','read_at','updated_at','status'],
  resellers: ['id','reseller_id','reseller_name','reseller_email','reseller_phone','status','assigned_listings','appointment_count','pending_appointments','completed_appointments','positive_sales','commission_percent','commission_amount','last_activity','appointments','availability','available_slots','appointment_availability','dealer_appointment_availability'],
  'reseller-profile': ['reseller_id','name','email','phone','location','professional_title','bio','languages','rating','status','visibility','profile_image_url','availability','available_slots','appointment_availability','dealer_appointment_availability'],
  'reseller-summary': ['assigned_listings','appointments_created','appointments_pending','appointments_completed','positive_sales','commission_total','unread_messages','agenda_contacts'],
  'reseller-listings': ['id','assignment_id','listing_id','store_id','dealer_name','store_name','listing_title','listing_url','listing_image_url','price','category','status','commission_percent','agreement_status','created_at'],
  'reseller-appointments': ['id','appointment_id','listing_id','store_id','dealer_name','store_name','customer_name','customer_phone','customer_email','customer_location','appointment_date','appointment_time','appointment_status','sale_status','sale_price','commission_percent','commission_amount','dealer_note','created_at','updated_at'],
  'admin-summary': ['total_users','total_dealers','total_buyers','total_resellers','total_stores','active_stores','inactive_stores','pending_validations','total_listings','active_listings','total_orders','unreviewed_orders','total_messages'],
  stores: ['id','store_id','owner_id','store_name','slug','email','phone','location','status','logo_url','banner_url','listings_count','orders_count','created_at','updated_at','public_store_url'],
  users: ['id','user_id','account_id','name','email','role','status','location','created_at','last_login_at'],
  validation: ['id','validation_id','dealer_user_id','store_id','business_name','authorized_representative','phone','email','address','city','state','zip','driver_license_number','dealer_license_number','business_tax_account_number','business_tax_receipt_number','resale_certificate_number','status','submitted_at','reviewed_at','reviewed_by','admin_note'],
  'api-keys-status': ['id','key_id','name','owner_type','owner_id','status','scopes','expires_at','last_used_at','created_at','updated_at'],
  'dealer-appointment-availability': [
    'id','slot_id','availability_id','record_type','dealer','store','dealer_id','dealer_name','dealer_phone','dealer_email','dealer_location',
    'reseller_id','store_id','store_name','store_phone','store_email','store_location','phone','email','location','address','city','state','zip',
    'listing_id','listing_title','listing_url','listing_image_url','assigned_listings','listings','assignment_id','category','price',
    'slot_minutes','slot_duration_minutes','duration_minutes','timezone','weekly_schedule','business_hours','dealer_schedule','availability_schedule',
    'blocked_dates','off_dates','days_off','closed_dates','unavailable_dates','open_dates','available_dates','special_open_dates',
    'available_times','open_times','booked_times','unavailable_times','blocked_times','booked_slots','verified_open_slots','verified_slots','open_slots',
    'available_slots','slots','availability','appointment_availability','dealer_appointment_availability','items','records','rows','data','result',
    'date','appointment_date','open_date','blocked_date','off_date','start_at','starts_at','datetime','date_time','end_at','ends_at',
    'start_time','appointment_time','time','from_time','open_time','end_time','to_time','close_time','start','end','from','to','open','close','opens_at','closes_at','times','hours','periods','intervals','ranges',
    'available','is_available','enabled','is_open','is_off','day_off','closed','blocked','booked','is_booked','is_blocked','status','state','verified','is_verified',
    'day','weekday','day_of_week','day_number','name','label','recurrence','capacity','notes','created_at','updated_at',
    'monday','tuesday','wednesday','thursday','friday','saturday','sunday','lunes','martes','miercoles','jueves','viernes','sabado','domingo'
  ],
  'dealer-agenda-calendar': [
    'id','calendar_id','record_type','dealer','store','stores','dealer_id','dealer_name','store_id','store_name','store_phone','store_email','store_location','phone','email','location','address','city','state','zip','timezone','slot_minutes','slot_duration_minutes',
    'from','to','days_count','weekly_schedule','business_hours','blocked_dates','off_dates','closed_dates','open_dates','days','date','day','weekday','label','is_open','is_off','closed','blocked','status','notes',
    'slots','available_slots','verified_open_slots','open_slots','booked_slots','unavailable_slots','available_times','booked_times','start_at','end_at','start_time','end_time','appointment_date','appointment_time','time','available','is_available','booked','is_booked','verified','capacity',
    'appointments','appointment_count','verified_open_slots_count','id','appointment_id','order_id','listing_id','listing_title','customer_name','customer_phone','customer_email','customer_location','appointment_status','source','created_at','updated_at','data','result','items','records','rows'
  ],
  'appointment-create': ['ok','resource','id','appointment_id','order_id','lead_id','thread_id','store_id','dealer_id','reseller_id','listing_id','customer_name','customer_phone','customer_email','customer_location','appointment_date','appointment_time','appointment_label','start_at','end_at','status','appointment_status','location','notes','source','source_context','reserved','lead_url','created_at','updated_at']
});

const LIST_CONTAINER_KEYS = Object.freeze(['items','records','rows','listings','orders','contacts','agenda','messages','threads','resellers','appointments','assignments','stores','users','validations','api_keys','slots','availability']);
const MESSAGE_ENTRY_FIELDS = Object.freeze(['id','message_id','thread_id','client_message_id','sender_type','sender_id','sender_name','receiver_type','receiver_id','direction','body','message','text','content','body_format','sent_at','created_at','updated_at','status','is_read','attachments','reply_to_message_id']);

function sanitizeAvailabilityValue(value, depth) {
  if (depth > 7 || value === undefined) return undefined;
  if (value === null || ['string', 'number', 'boolean'].includes(typeof value)) return value;
  if (Array.isArray(value)) {
    return value.slice(0, 1000).map(function sanitizeItem(item) { return sanitizeAvailabilityValue(item, depth + 1); })
      .filter(function defined(item) { return item !== undefined; });
  }
  if (typeof value !== 'object') return undefined;
  const allowed = new Set(RESOURCE_FIELD_ALLOWLISTS['dealer-appointment-availability']);
  const output = {};
  Object.entries(value).forEach(function keep(entry) {
    const key = entry[0];
    if (!allowed.has(key) && !/^20\d{2}-\d{2}-\d{2}$/.test(key)) return;
    const safe = sanitizeAvailabilityValue(entry[1], depth + 1);
    if (safe !== undefined) output[key] = safe;
  });
  return output;
}

function sanitizeCalendarValue(value, depth) {
  if (depth > 8 || value === undefined) return undefined;
  if (value === null || ['string', 'number', 'boolean'].includes(typeof value)) return value;
  if (Array.isArray(value)) {
    return value.slice(0, 1500).map(function sanitizeItem(item) { return sanitizeCalendarValue(item, depth + 1); })
      .filter(function defined(item) { return item !== undefined; });
  }
  if (typeof value !== 'object') return undefined;
  const allowed = new Set(RESOURCE_FIELD_ALLOWLISTS['dealer-agenda-calendar']);
  const output = {};
  Object.entries(value).forEach(function keep(entry) {
    const key = entry[0];
    if (!allowed.has(key) && !/^20\d{2}-\d{2}-\d{2}$/.test(key)) return;
    const safe = sanitizeCalendarValue(entry[1], depth + 1);
    if (safe !== undefined) output[key] = safe;
  });
  return output;
}

function sanitizeRecord(resource, record) {
  if (!record || typeof record !== 'object' || Array.isArray(record)) return record;
  if (resource === 'dealer-appointment-availability') return sanitizeAvailabilityValue(record, 0);
  if (resource === 'dealer-agenda-calendar') return sanitizeCalendarValue(record, 0);
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
    if (['availability','available_slots','appointment_availability','dealer_appointment_availability'].includes(key) && Array.isArray(value)) {
      output[key] = value.map(function sanitizeAvailability(item) { return sanitizeRecord('dealer-appointment-availability', item); });
      return;
    }
    output[key] = value;
  });
  return output;
}


function sanitizeMessageEntry(entry) {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return entry;
  const allowed = new Set(MESSAGE_ENTRY_FIELDS);
  const output = {};
  Object.entries(entry).forEach(function keep(entryPair) {
    const key = entryPair[0];
    const value = entryPair[1];
    if (!allowed.has(key)) return;
    if (key === 'attachments') {
      output.attachments = Array.isArray(value) ? value.slice(0, 20).map(function safeAttachment(item) {
        if (!item || typeof item !== 'object') return null;
        return {
          id: item.id || null,
          name: String(item.name || item.filename || '').slice(0, 255),
          type: String(item.type || item.mime_type || '').slice(0, 120),
          size: Number(item.size || 0),
          url: typeof item.url === 'string' && /^https:\/\//i.test(item.url) ? item.url : null
        };
      }).filter(Boolean) : [];
      return;
    }
    output[key] = value;
  });
  const body = output.body || output.message || output.text || output.content || '';
  output.body = String(body).slice(0, 12000);
  delete output.message;
  delete output.text;
  delete output.content;
  return output;
}

function sanitizeMessageThreadPayload(payload) {
  if (!payload || typeof payload !== 'object') return payload;
  const source = unwrapPayload(payload);
  const threadSource = source.thread && typeof source.thread === 'object' ? source.thread : source;
  const thread = sanitizeRecord('message-thread', threadSource);
  const entries = Array.isArray(source.messages) ? source.messages : Array.isArray(source.items) ? source.items : Array.isArray(source.entries) ? source.entries : [];
  return {
    thread: thread,
    messages: entries.map(sanitizeMessageEntry),
    next_cursor: source.next_cursor || source.cursor || null,
    has_more: Boolean(source.has_more),
    count: Number(source.count !== undefined ? source.count : entries.length)
  };
}

function sanitizeResourcePayload(resource, payload) {
  if (resource === 'message-thread') return sanitizeMessageThreadPayload(payload);
  if (resource === 'message-send') return sanitizeMessageEntry(unwrapPayload(payload));
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
  validation: { limit: 100 },
  'dealer-appointment-availability': { limit: 100, days: 14 },
  'dealer-agenda-calendar': { days: 14 }
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

function unwrapDiscoveryPayload(resource, payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return payload;
  if (resource !== 'ping' && resource !== 'connection-map') return unwrapPayload(payload);
  const nested = unwrapPayload(payload);
  if (!nested || typeof nested !== 'object' || Array.isArray(nested) || nested === payload) return payload;
  // Some website versions advertise scopes/endpoints beside `data`; merge both
  // shapes and let the resource allowlist discard everything else.
  return Object.assign({}, payload, nested);
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
  if (typeof value === 'object') {
    return Object.entries(value).filter(function enabledEntry(entry) {
      const enabled = entry[1];
      return enabled !== false && enabled !== 0 && enabled !== '0' && enabled !== null;
    }).map(function entryName(entry) { return entry[0]; });
  }
  return [];
}

function normalizeResourceName(value) {
  const resource = String(value || '').replace(/^resource=/i, '').trim().toLowerCase();
  const aliases = {
    'messages-thread': 'message-thread',
    'messages-send': 'message-send',
    'messages-read': 'message-read',
    'dealer_appointment_availability': 'dealer-appointment-availability',
    'dealer_agenda_calendar': 'dealer-agenda-calendar',
    'appointment_create': 'appointment-create',
    'lead-appointment-create': 'appointment-create',
    'nexa-appointment-create': 'appointment-create',
    'appointment-create-from-thread': 'appointment-create',
    'lead_appointment_create': 'appointment-create',
    'nexa_appointment_create': 'appointment-create',
    'appointment_create_from_thread': 'appointment-create'
  };
  return aliases[resource] || resource;
}

function normalizeScopes() {
  const sources = Array.from(arguments);
  const scopes = sources.reduce(function combine(result, source) {
    return result.concat(normalizeStringArray(source));
  }, []).map(function normalizeScope(scope) { return scope.toLowerCase(); }).filter(Boolean);
  return Array.from(new Set(scopes));
}

function capabilityValueEnabled(value, expectedResource) {
  if (value === true || value === 1) return true;
  if (value === false || value === 0 || value === null || value === undefined) return false;
  const normalized = String(value).trim().toLowerCase();
  if (!normalized || ['0','false','disabled','blocked','no','off','unavailable','null'].includes(normalized)) return false;
  if (['1','true','enabled','ready','yes','on','available','active'].includes(normalized)) return true;
  if (!expectedResource) return false;
  const resource = normalizeResourceName(normalized);
  if (resource === expectedResource) return true;
  const queryMatch = normalized.match(/[?&]resource=([^&#]+)/i);
  if (queryMatch && normalizeResourceName(decodeURIComponent(queryMatch[1])) === expectedResource) return true;
  return normalized.includes('resource=' + expectedResource)
    || normalized.endsWith('/' + expectedResource)
    || normalized.endsWith('=' + expectedResource);
}

function capabilityState(map, names, expectedResource) {
  const source = map && typeof map === 'object' ? map : {};
  const containers = [
    source,
    source.capabilities && typeof source.capabilities === 'object' && !Array.isArray(source.capabilities) ? source.capabilities : {},
    source.message_capabilities && typeof source.message_capabilities === 'object' && !Array.isArray(source.message_capabilities) ? source.message_capabilities : {}
  ];
  let advertised = false;
  let enabled = false;
  let disabled = false;
  containers.forEach(function inspect(container) {
    names.forEach(function inspectName(name) {
      if (!Object.prototype.hasOwnProperty.call(container, name)) return;
      advertised = true;
      if (capabilityValueEnabled(container[name], expectedResource)) enabled = true;
      else disabled = true;
    });
  });
  const namedCapabilities = new Set(normalizeStringArray(source.capabilities).concat(normalizeStringArray(source.message_capabilities)).map(function normalizeName(name) {
    return String(name).toLowerCase().replaceAll('-', '_');
  }));
  if (names.some(function hasNamed(name) { return namedCapabilities.has(name); })) {
    advertised = true;
    enabled = true;
  }
  return { advertised: advertised, enabled: enabled && !disabled };
}

function extractAvailableResources(connectionMap) {
  const map = connectionMap && typeof connectionMap === 'object' ? connectionMap : {};
  const sources = [map.available_resources, map.allowed_resources, map.resources, map.endpoints, map.allowed_endpoints];
  const resources = sources.reduce(function combine(result, source) {
    return result.concat(normalizeStringArray(source));
  }, []).map(normalizeResourceName).filter(function safe(resource) { return SAFE_RESOURCES.has(resource); });
  const endpointFields = [
    ['message_thread_endpoint','message-thread'], ['messages_thread_endpoint','message-thread'],
    ['message_send_endpoint','message-send'], ['messages_send_endpoint','message-send'],
    ['message_read_endpoint','message-read'], ['messages_read_endpoint','message-read'],
    ['dealer_appointment_availability','dealer-appointment-availability'],
    ['dealer_appointment_availability_enabled','dealer-appointment-availability'],
    ['dealer_appointment_availability_endpoint','dealer-appointment-availability'],
    ['dealer_agenda_calendar','dealer-agenda-calendar'],
    ['dealer_agenda_calendar_enabled','dealer-agenda-calendar'],
    ['dealer_agenda_calendar_endpoint','dealer-agenda-calendar'],
    ['appointment_create','appointment-create'],
    ['appointment_create_enabled','appointment-create'],
    ['appointment_create_endpoint','appointment-create'],
    ['lead-appointment-create','appointment-create'],
    ['nexa-appointment-create','appointment-create'],
    ['appointment-create-from-thread','appointment-create'],
    ['lead_appointment_create_endpoint','appointment-create'],
    ['nexa_appointment_create_endpoint','appointment-create'],
    ['appointment_create_from_thread_endpoint','appointment-create']
  ];
  endpointFields.forEach(function addEndpoint(entry) {
    if (capabilityValueEnabled(map[entry[0]], entry[1])) resources.push(entry[1]);
  });
  return Array.from(new Set(resources));
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
    scopes: normalizeScopes(ping.scopes, ping.allowed_scopes, ping.permissions, map.scopes, map.allowed_scopes, map.permissions),
    available_resources: extractAvailableResources(map),
    api_version: source.api_version || map.api_version || 'v1'
  };
}

function deriveMessageCapabilities(identity, connectionMap) {
  const source = identity && typeof identity === 'object' ? identity : {};
  const map = connectionMap && typeof connectionMap === 'object' ? connectionMap : {};
  const resources = new Set(extractAvailableResources(map).concat(
    normalizeStringArray(source.available_resources).map(normalizeResourceName)
  ));
  const scopes = new Set(normalizeScopes(source.scopes, source.allowed_scopes, source.permissions, map.scopes, map.allowed_scopes, map.permissions));
  const threadState = capabilityState(map, ['message_threads','message_thread','message_thread_endpoint','messages_thread_endpoint'], 'message-thread');
  const sendState = capabilityState(map, ['message_send','message_send_endpoint','messages_send_endpoint','messages_write_enabled','two_way_chat','two_way_chat_enabled'], 'message-send');
  const readEndpointState = capabilityState(map, ['message_read','message_read_endpoint','messages_read_endpoint'], 'message-read');
  const readScopeState = capabilityState(map, ['messages_read_enabled'], null);
  const fullThread = threadState.advertised ? threadState.enabled : resources.has('message-thread');
  const send = sendState.advertised ? sendState.enabled : resources.has('message-send');
  const markRead = readEndpointState.advertised ? readEndpointState.enabled : resources.has('message-read');
  const scopesAdvertised = scopes.size > 0;
  return {
    read: scopesAdvertised ? scopes.has('messages:read') : (readScopeState.advertised ? readScopeState.enabled : true),
    write: scopesAdvertised ? scopes.has('messages:write') : send,
    fullThread: fullThread,
    send: send,
    markRead: markRead,
    twoWayChat: fullThread && send && markRead
      && (scopesAdvertised ? scopes.has('messages:read') && scopes.has('messages:write') : send),
    scopesAdvertised: scopesAdvertised,
    scopes: Array.from(scopes),
    resources: Array.from(resources)
  };
}

function deriveAppointmentCapabilities(identity, connectionMap) {
  const source = identity && typeof identity === 'object' ? identity : {};
  const map = connectionMap && typeof connectionMap === 'object' ? connectionMap : {};
  const resources = new Set(extractAvailableResources(map).concat(
    normalizeStringArray(source.available_resources).map(normalizeResourceName)
  ));
  const scopes = new Set(normalizeScopes(source.scopes, source.allowed_scopes, source.permissions, map.scopes, map.allowed_scopes, map.permissions));
  const availabilityState = capabilityState(map, ['dealer_appointment_availability','dealer_appointment_availability_enabled','dealer_appointment_availability_endpoint'], 'dealer-appointment-availability');
  const calendarState = capabilityState(map, ['dealer_agenda_calendar','dealer_agenda_calendar_enabled','dealer_agenda_calendar_endpoint'], 'dealer-agenda-calendar');
  const createState = capabilityState(map, ['appointment_create','appointment_create_enabled','appointment_create_endpoint','lead-appointment-create','nexa-appointment-create','appointment-create-from-thread','lead_appointment_create_endpoint','nexa_appointment_create_endpoint','appointment_create_from_thread_endpoint'], 'appointment-create');
  const scopesAdvertised = scopes.size > 0;
  const availabilityEndpoint = availabilityState.advertised ? availabilityState.enabled : resources.has('dealer-appointment-availability');
  const calendarEndpoint = calendarState.advertised ? calendarState.enabled : resources.has('dealer-agenda-calendar');
  const createEndpoint = createState.advertised ? createState.enabled : resources.has('appointment-create');
  return {
    availabilityEndpoint: availabilityEndpoint,
    availabilityRead: availabilityEndpoint && (!scopesAdvertised || scopes.has('dealer-appointment-availability:read')),
    calendarEndpoint: calendarEndpoint,
    calendarRead: calendarEndpoint && (!scopesAdvertised || scopes.has('dealer-agenda-calendar:read')),
    createEndpoint: createEndpoint,
    createWrite: createEndpoint && (!scopesAdvertised || scopes.has('appointment-create:write')),
    scopesAdvertised: scopesAdvertised,
    scopes: Array.from(scopes),
    resources: Array.from(resources)
  };
}

function resourcePlan(identity) {
  const accountType = normalizeAccountType(identity && identity.account_type);
  const available = new Set(normalizeStringArray(identity && identity.available_resources).map(normalizeResourceName));
  const scopes = new Set(normalizeStringArray(identity && identity.scopes).map(function lower(item) { return item.toLowerCase(); }));
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

    const requestOptions = options && typeof options === 'object' ? options : {};
    const method = String(requestOptions.method || 'GET').toUpperCase();
    const url = new URL(configuration.baseUrl);
    url.searchParams.set('resource', resourceName);
    Object.entries(query || {}).forEach(function appendQuery(entry) {
      const key = entry[0];
      const value = entry[1];
      if (value !== undefined && value !== null && String(value) !== '') url.searchParams.set(key, String(value));
    });

    const controller = new AbortController();
    this.activeController = controller;
    const timeoutMs = Math.min(Math.max(Number(requestOptions.timeoutMs) || DEFAULT_TIMEOUT_MS, 3000), 60000);
    const timeout = setTimeout(function abortRequest() { controller.abort(); }, timeoutMs);
    const startedAt = Date.now();
    try {
      const headers = {
        Accept: 'application/json',
        Authorization: 'Bearer ' + apiKey,
        'X-Nexa-Api-Key': apiKey,
        'X-Nexa-Client': 'Nexa-Smart-Office-Bot/' + CLIENT_VERSION
      };
      if (method !== 'GET') headers['Content-Type'] = 'application/json';
      if (requestOptions.idempotencyKey) headers['Idempotency-Key'] = String(requestOptions.idempotencyKey);
      const fetchOptions = {
        method: method,
        headers: headers,
        signal: controller.signal,
        redirect: 'error'
      };
      if (method !== 'GET' && requestOptions.body !== undefined) fetchOptions.body = JSON.stringify(requestOptions.body);
      const response = await fetch(url, fetchOptions);
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
      const unwrappedPayload = unwrapDiscoveryPayload(resourceName, payload);
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
    if (['dealer-appointment-availability','dealer-agenda-calendar'].includes(resource) && !merged.from) merged.from = localDateKey(new Date());
    if (['dealer-appointment-availability','dealer-agenda-calendar'].includes(resource)) merged.days = Math.min(Math.max(Number(merged.days) || 14, 1), 60);
    if (Object.prototype.hasOwnProperty.call(merged, 'limit')) merged.limit = Math.min(Number(merged.limit) || configuration.maxItems, configuration.maxItems);
    return this.request(resource, merged);
  }

  async fetchMessageThread(threadId, options) {
    const wanted = String(threadId || '').trim();
    if (!wanted) throw new AutoMarketApiError('Message thread ID is required.', { resource: 'message-thread' });
    const query = {
      thread_id: wanted,
      limit: Math.min(Math.max(Number(options && options.limit || 100), 1), 200),
      // Thread synchronization is read-only. Read state changes only through message-read.
      mark_read: options && options.markRead === true ? 1 : 0
    };
    if (options && options.after) query.after = String(options.after);
    if (options && options.cursor) query.cursor = String(options.cursor);
    return this.request('message-thread', query, { timeoutMs: 30000 });
  }

  async sendMessage(threadId, body, clientMessageId, replyToMessageId) {
    const wanted = String(threadId || '').trim();
    const text = String(body || '').trim();
    if (!wanted) throw new AutoMarketApiError('Message thread ID is required.', { resource: 'message-send' });
    if (!text) throw new AutoMarketApiError('Reply text is required.', { resource: 'message-send' });
    if (text.length > 8000) throw new AutoMarketApiError('Reply text cannot exceed 8,000 characters.', { resource: 'message-send' });
    const clientId = String(clientMessageId || crypto.randomUUID());
    return this.request('message-send', {}, {
      method: 'POST',
      timeoutMs: 30000,
      idempotencyKey: clientId,
      body: Object.assign(
        { thread_id: wanted, message: text },
        replyToMessageId ? { reply_to_message_id: String(replyToMessageId) } : {}
      )
    });
  }

  async markMessageRead(threadId, lastMessageId) {
    const wanted = String(threadId || '').trim();
    if (!wanted) throw new AutoMarketApiError('Message thread ID is required.', { resource: 'message-read' });
    return this.request('message-read', {}, {
      method: 'POST',
      timeoutMs: 20000,
      body: { thread_id: wanted, last_message_id: lastMessageId || null }
    });
  }

  async fetchDealerAppointmentAvailability(query) {
    return this.fetchResource('dealer-appointment-availability', Object.assign({ limit: 100, days: 14 }, query || {}));
  }

  async fetchDealerAgendaCalendar(query) {
    return this.fetchResource('dealer-agenda-calendar', Object.assign({ days: 14 }, query || {}));
  }

  async createRemoteAppointment(payload, idempotencyKey) {
    const input = payload && typeof payload === 'object' ? payload : {};
    if (!(input.appointment_date && input.appointment_time)) {
      throw new AutoMarketApiError('Appointment date and time are required.', { resource: 'appointment-create' });
    }
    const body = {};
    for (const key of ['thread_id','listing_id','customer_name','customer_phone','customer_email','customer_location','appointment_date','appointment_time','notes']) {
      if (input[key] !== undefined && input[key] !== null && String(input[key]).trim() !== '') body[key] = input[key];
    }
    if (!body.thread_id && !body.customer_name) throw new AutoMarketApiError('Message thread ID or customer name is required.', { resource: 'appointment-create' });
    if (!body.customer_phone) throw new AutoMarketApiError('Customer phone is required to create the appointment Lead.', { resource: 'appointment-create' });
    return this.request('appointment-create', {}, {
      method: 'POST',
      timeoutMs: 30000,
      idempotencyKey: String(idempotencyKey || crypto.randomUUID()),
      body: body
    });
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
  deriveAppointmentCapabilities,
  deriveMessageCapabilities,
  deriveConnectionIdentity,
  extractAvailableResources,
  normalizeAccountType,
  normalizeResourceName,
  normalizeScopes,
  normalizeStringArray,
  resourcePlan,
  sanitizeMessageEntry,
  sanitizeMessageThreadPayload,
  sanitizeRecord,
  sanitizeResourcePayload,
  stableHash,
  unwrapPayload
};
