'use strict';

const NEXA_UI_CONTRACT_V1 = 'NEXA_UI_CONTRACT_V1';
const UI_TESTID_CONTRACT = 'data-testid values for dashboard, sidebar, contacts, leads, agenda, tasks, ai, alerts, activity, settings, about';
const UI_TESTID_EXTENDED_CONTRACT = 'data-testid values for connected-business, api-sync-inspector, messages, smart-notifications, ai-control';
const ACTION_CONTRACT = 'data-nexa-action on every actionable button/form';

window.__NEXA_ERRORS__ = [];
window.addEventListener('error', function captureError(event) {
  const message = event && event.error && event.error.message ? event.error.message : event.message;
  window.__NEXA_ERRORS__.push(String(message || 'Unknown renderer error'));
});
window.addEventListener('unhandledrejection', function captureRejection(event) {
  const reason = event && event.reason && event.reason.message ? event.reason.message : event.reason;
  window.__NEXA_ERRORS__.push(String(reason || 'Unhandled promise rejection'));
});

const api = window.nexa;
const modules = window.NexaModules || {};
const content = document.getElementById('app-content');
const pageTitle = document.getElementById('page-title');
const entityDialog = document.getElementById('entity-dialog');
const entityForm = document.getElementById('entity-form');
const dialogFields = document.getElementById('dialog-fields');
const dialogTitle = document.getElementById('dialog-title');
const dialogEyebrow = document.getElementById('dialog-eyebrow');
const confirmDialog = document.getElementById('confirm-dialog');
const aiSaveDialog = document.getElementById('ai-save-dialog');

const state = {
  view: 'dashboard',
  meta: null,
  dashboard: null,
  contacts: [],
  leads: [],
  tasks: [],
  appointments: [],
  reminders: [],
  alerts: [],
  activity: [],
  suggestions: [],
  settings: null,
  backups: [],
  integration: null,
  notifications: [],
  notificationPreferences: [],
  unreadNotifications: 0,
  activePulseEvent: null,
  search: '',
  activeAIRequest: null,
  aiResult: '',
  pages: {},
  agendaMode: 'month',
  agendaAnchor: new Date().toISOString(),
  aiPrefill: null,
  messageThreadId: '',
  messageConversation: null,
  messageDraft: '',
  messageDraftMeta: null,
  messageBusy: false,
  messageError: '',
  messageTab: 'inbox',
  messageKnowledge: [],
  knowledgeSummary: null,
  automation: null,
  messagePollBusy: false,
  messageLastPollAt: 0
};

const viewTitles = {
  dashboard: 'Dashboard',
  connected: 'Connected Business',
  'sync-inspector': 'API Sync Inspector',
  contacts: 'Contacts',
  leads: 'Leads',
  messages: 'Messages',
  agenda: 'Agenda',
  tasks: 'Tasks',
  ai: 'AI Suggestions',
  alerts: 'Alerts',
  notifications: 'Nexa Pulse',
  activity: 'Activity',
  settings: 'Settings',
  'ai-control': 'AI Control',
  about: 'About'
};

function esc(value) {
  const text = String(value === null || value === undefined ? '' : value);
  const entities = { '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' };
  return Array.from(text).map(function replaceCharacter(character) {
    return entities[character] || character;
  }).join('');
}

function formatDate(value, includeTime) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return esc(value);
  const options = includeTime === false ? { dateStyle: 'medium' } : { dateStyle: 'medium', timeStyle: 'short' };
  return new Intl.DateTimeFormat(undefined, options).format(date);
}

function inputDateTime(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value).slice(0, 16);
  const localDate = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return localDate.toISOString().slice(0, 16);
}

function toIso(value) {
  return value ? new Date(value).toISOString() : '';
}

function money(value) {
  return new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(Number(value || 0));
}

function badge(value, extra) {
  const className = String(value || '').toLowerCase().replaceAll(' ', '-');
  return '<span class="badge ' + esc(className) + ' ' + esc(extra || '') + '">' + esc(value) + '</span>';
}

function toast(message, type) {
  const element = document.createElement('div');
  element.className = 'toast ' + (type || 'success');
  element.textContent = message;
  document.getElementById('toast-region').appendChild(element);
  setTimeout(function removeToast() { element.remove(); }, 4500);
}

async function confirmAction(title, message) {
  document.getElementById('confirm-title').textContent = title;
  document.getElementById('confirm-message').textContent = message;
  confirmDialog.showModal();
  return new Promise(function awaitConfirmation(resolve) {
    confirmDialog.addEventListener('close', function confirmationClosed() {
      resolve(confirmDialog.returnValue === 'confirm');
    }, { once: true });
  });
}

function setLoading() {
  content.innerHTML = '<div class="loading">Loading workspace…</div>';
}

async function refreshAll(options) {
  const shouldRender = !options || options.render !== false;
  const results = await Promise.all([
    api.app.meta(),
    api.dashboard.summary(),
    api.contacts.list(),
    api.leads.list(),
    api.tasks.list(),
    api.appointments.list(),
    api.reminders.list(),
    api.alerts.list(),
    api.activity.list(150),
    api.ai.list(50),
    api.settings.get(),
    api.backups.list(),
    api.integration.get(),
    api.notifications.list(150, false),
    api.notifications.preferences(),
    api.messages.knowledgeList(''),
    api.messages.knowledgeSummary(),
    api.automation.get()
  ]);
  state.meta = results[0];
  state.dashboard = results[1];
  state.contacts = results[2];
  state.leads = results[3];
  state.tasks = results[4];
  state.appointments = results[5];
  state.reminders = results[6];
  state.alerts = results[7];
  state.activity = results[8];
  state.suggestions = results[9];
  state.settings = results[10];
  state.backups = results[11];
  state.integration = results[12];
  state.notifications = results[13] && Array.isArray(results[13].items) ? results[13].items : [];
  state.unreadNotifications = results[13] ? Number(results[13].unread || 0) : 0;
  state.notificationPreferences = Array.isArray(results[14]) ? results[14] : [];
  state.messageKnowledge = Array.isArray(results[15]) ? results[15] : [];
  state.knowledgeSummary = results[16] || null;
  state.automation = results[17] || null;
  document.getElementById('alert-count').textContent = String(state.alerts.length);
  document.getElementById('notification-count').textContent = String(state.unreadNotifications);
  document.getElementById('notification-bell-count').textContent = String(state.unreadNotifications);
  document.getElementById('notification-bell').classList.toggle('has-unread', state.unreadNotifications > 0);
  const messageCount = integrationRemote('messages').reduce(function countUnread(total, item) { return total + Number(item.unread_count || 0); }, 0);
  const messageCountElement = document.getElementById('message-count');
  if (messageCountElement) messageCountElement.textContent = String(messageCount);
  document.getElementById('sidebar-version').textContent = 'v' + state.meta.version;
  updateProviderPill();
  if (shouldRender) renderView();
}

function updateProviderPill() {
  const pill = document.getElementById('provider-pill');
  const preferred = state.settings && state.settings.preferred_provider ? state.settings.preferred_provider : 'openai';
  const providerState = state.settings && state.settings.secrets ? state.settings.secrets[preferred] : null;
  const configured = Boolean(providerState && providerState.configured);
  pill.classList.toggle('connected', configured);
  pill.querySelector('b').textContent = configured ? (preferred === 'openai' ? 'OpenAI configured' : 'DeepSeek configured') : 'AI not configured';
}

function navigate(view) {
  state.view = view;
  state.search = '';
  state.pages = {};
  pageTitle.textContent = viewTitles[view] || view;
  document.querySelectorAll('.nav-item').forEach(function updateNavigation(button) {
    button.classList.toggle('active', button.dataset.view === view);
  });
  renderView();
}

function sectionHeader(title, description, actionHtml) {
  return '<div class="section-header"><div><h2>' + esc(title) + '</h2><p>' + esc(description) + '</p></div>' + (actionHtml || '') + '</div>';
}

function emptyMini(title, text, testId) {
  const attribute = testId ? ' data-testid="' + esc(testId) + '"' : '';
  return '<div class="empty-state"' + attribute + ' style="min-height:130px"><div><b>' + esc(title) + '</b>' + esc(text) + '</div></div>';
}

function alertMini(item) {
  return '<div class="list-item"><div class="list-item-main"><strong>' + esc(item.title) + '</strong><span>' + esc(item.type) + ' · ' + formatDate(item.date) + '</span></div></div>';
}

function toolbar(label, createAction, searchAction, testId) {
  const singular = label.endsWith('s') ? label.slice(0, -1) : label;
  return '<div class="toolbar"><div class="search-box"><input id="view-search" data-nexa-action="' + esc(searchAction) + '" type="search" value="' + esc(state.search) + '" placeholder="Search ' + esc(label.toLowerCase()) + '…"></div><button class="primary-button" data-nexa-action="' + esc(createAction) + '" data-testid="' + esc(testId) + '">+ New ' + esc(singular) + '</button></div>';
}


const PAGE_SIZE = 40;

function pageKey(name) {
  return String(name || state.view || 'default');
}

function paginateItems(items, key) {
  const source = Array.isArray(items) ? items : [];
  const name = pageKey(key);
  const totalPages = Math.max(1, Math.ceil(source.length / PAGE_SIZE));
  const current = Math.min(Math.max(Number(state.pages[name] || 1), 1), totalPages);
  state.pages[name] = current;
  const start = (current - 1) * PAGE_SIZE;
  return { items: source.slice(start, start + PAGE_SIZE), current: current, totalPages: totalPages, total: source.length, start: start };
}

function renderPagination(result, key, label) {
  if (!result || result.total <= PAGE_SIZE) return '';
  const start = result.start + 1;
  const end = Math.min(result.start + PAGE_SIZE, result.total);
  return '<div class="pagination" data-pagination="' + esc(key) + '"><span>Showing ' + start + '–' + end + ' of ' + result.total + ' ' + esc(label || 'records') + '</span><div><button class="ghost-button" data-page-key="' + esc(key) + '" data-page="1"' + (result.current <= 1 ? ' disabled' : '') + '>First</button><button class="ghost-button" data-page-key="' + esc(key) + '" data-page="' + (result.current - 1) + '"' + (result.current <= 1 ? ' disabled' : '') + '>Previous</button><strong>Page ' + result.current + ' of ' + result.totalPages + '</strong><button class="ghost-button" data-page-key="' + esc(key) + '" data-page="' + (result.current + 1) + '"' + (result.current >= result.totalPages ? ' disabled' : '') + '>Next</button><button class="ghost-button" data-page-key="' + esc(key) + '" data-page="' + result.totalPages + '"' + (result.current >= result.totalPages ? ' disabled' : '') + '>Last</button></div></div>';
}

function normalizedPhone(value) {
  const digits = String(value || '').replace(/\D+/g, '');
  if (digits.length === 11 && digits.startsWith('1')) return digits.slice(1);
  return digits.length >= 10 ? digits.slice(-10) : digits;
}

function normalizedEmail(value) {
  return String(value || '').trim().toLowerCase();
}

function remoteItemId(resource, item, index) {
  const keys = {
    agenda: ['contact_id','id'], orders: ['order_id','appointment_id','id'], messages: ['thread_id','id'],
    'reseller-appointments': ['appointment_id','id'], listings: ['listing_id','id'], 'reseller-listings': ['assignment_id','listing_id','id'],
    resellers: ['reseller_id','id'], stores: ['store_id','id'], users: ['user_id','account_id','id'], validation: ['validation_id','id']
  };
  const candidates = keys[resource] || ['id','uuid'];
  for (const key of candidates) if (item && item[key] !== undefined && item[key] !== null && String(item[key]) !== '') return String(item[key]);
  return String(item && item.__item_id || resource + ':' + String(index || 0));
}

function remoteItem(resource, itemId) {
  const rows = integrationRemote(resource);
  return rows.find(function findItem(item, index) { return remoteItemId(resource, item, index) === String(itemId); }) || null;
}

function openConnectedDetail(resource, itemId) {
  const item = remoteItem(resource, itemId);
  if (!item) { toast('Connected record is no longer available. Synchronize again.', 'error'); return; }
  const dialog = document.getElementById('connected-detail-dialog');
  document.getElementById('connected-detail-eyebrow').textContent = String(resource || 'connected').replaceAll('-', ' ').toUpperCase();
  document.getElementById('connected-detail-title').textContent = remoteTitle(resource, item);
  const preferred = ['customer_name','listing_title','subject','name','email','phone','customer_phone','customer_email','customer_location','message','order_notes','status','appointment_status','sale_status','appointment_date','appointment_time','created_at','updated_at','last_message_at','message_count','unread_count','context_type','context_id','sender_type','receiver_type','source','order_type','commission_amount','dealer_status_note'];
  const entries = Object.entries(item).filter(function visible(entry) { return !entry[0].startsWith('__') && entry[1] !== null && entry[1] !== undefined && entry[1] !== ''; });
  entries.sort(function prioritize(a, b) { const ai=preferred.indexOf(a[0]); const bi=preferred.indexOf(b[0]); return (ai<0?999:ai)-(bi<0?999:bi); });
  document.getElementById('connected-detail-body').innerHTML = '<div class="connected-detail-grid">' + entries.map(function field(entry) {
    const value = Array.isArray(entry[1]) || typeof entry[1] === 'object' ? JSON.stringify(entry[1], null, 2) : valueLabel(entry[1]);
    return '<div class="connected-detail-field ' + (String(value).length > 90 ? 'wide' : '') + '"><span>' + esc(entry[0].replaceAll('_',' ')) + '</span><strong>' + esc(value) + '</strong></div>';
  }).join('') + '</div>';
  dialog.showModal();
}

function setAiPrefill(type, id, kind, focus) {
  state.aiPrefill = { type: type, id: String(id || ''), kind: kind || 'daily_priorities', focus: focus || '' };
  navigate('ai');
}

function toValidDate(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function remoteAppointmentDate(item) {
  if (!item) return null;
  const combined = [item.appointment_date || '', item.appointment_time || ''].join(' ').trim();
  return toValidDate(combined) || toValidDate(item.start_at) || toValidDate(item.updated_at) || toValidDate(item.created_at);
}

function agendaEvents() {
  const events = [];
  state.appointments.forEach(function appointment(item) {
    const date = toValidDate(item.start_at); if (!date) return;
    events.push({ id:item.id, kind:'appointment', source:'Local appointment', title:item.title, detail:item.contact_name || item.lead_name || item.description || '', status:item.status, date:date, local:true, item:item });
  });
  state.tasks.forEach(function task(item) {
    const date = toValidDate(item.due_at); if (!date) return;
    events.push({ id:item.id, kind:'task', source:'Local task', title:item.title, detail:item.description || '', status:item.status, date:date, local:true, item:item });
  });
  state.reminders.forEach(function reminder(item) {
    const date = toValidDate(item.remind_at); if (!date) return;
    events.push({ id:item.id, kind:'reminder', source:'Local reminder', title:item.title, detail:item.entity_type || '', status:Number(item.enabled)===1?'Enabled':'Paused', date:date, local:true, item:item });
  });
  ['orders','reseller-appointments'].forEach(function resource(resource) {
    integrationRemote(resource).forEach(function connected(item,index) {
      const date = remoteAppointmentDate(item); if (!date || !(item.appointment_date || item.appointment_time || String(item.order_type || '').toLowerCase().includes('appointment') || resource === 'reseller-appointments')) return;
      events.push({ id:remoteItemId(resource,item,index), kind:'connected', resource:resource, source:resource==='orders'?'Website order':'Reseller appointment', title:item.customer_name || item.listing_title || 'Connected appointment', detail:item.listing_title || item.store_name || item.dealer_name || '', status:item.appointment_status || item.status || item.sale_status || 'Pending', date:date, local:false, item:item });
    });
  });
  return events.sort(function sortEvents(a,b){ return a.date-b.date; });
}

function dateKey(date) {
  const d = new Date(date.getTime() - date.getTimezoneOffset()*60000);
  return d.toISOString().slice(0,10);
}

function startOfWeek(date) {
  const d = new Date(date); const day=(d.getDay()+6)%7; d.setHours(0,0,0,0); d.setDate(d.getDate()-day); return d;
}

function addDays(date, days) { const d=new Date(date); d.setDate(d.getDate()+days); return d; }

function eventChip(event) {
  const action = event.local ? (event.kind === 'task' ? 'task-edit' : event.kind === 'appointment' ? 'appointment-edit' : '') : 'connected-detail';
  const attrs = event.local ? ' data-record-id="' + esc(event.id) + '"' : ' data-resource="' + esc(event.resource) + '" data-item-id="' + esc(event.id) + '"';
  return '<button class="calendar-event ' + esc(event.kind) + '" data-nexa-action="' + esc(action || 'agenda-noop') + '"' + attrs + ' title="' + esc(event.title + ' · ' + event.source) + '"><span></span>' + esc(event.title) + '</button>';
}

function renderView() {
  try {
    const renderers = {
      dashboard: renderDashboard,
      connected: renderConnectedBusiness,
      'sync-inspector': renderApiSyncInspector,
      contacts: renderContacts,
      leads: renderLeads,
      messages: renderMessages,
      agenda: renderAgenda,
      tasks: renderTasks,
      ai: renderAI,
      alerts: renderAlerts,
      notifications: renderSmartNotifications,
      activity: renderActivity,
      settings: renderSettings,
      'ai-control': renderAIControl,
      about: renderAbout
    };
    const renderer = renderers[state.view] || renderDashboard;
    content.innerHTML = renderer();
    bindViewEvents();
  } catch (error) {
    content.innerHTML = '<div class="empty-state"><div><b>Unable to render this section</b>' + esc(error.message) + '</div></div>';
    window.__NEXA_ERRORS__.push(error.message);
  }
}


function integrationRemote(resource) {
  const integration = state.integration || {};
  const remote = integration.remote && typeof integration.remote === 'object' ? integration.remote : {};
  return Array.isArray(remote[resource]) ? remote[resource] : [];
}

function integrationResourceStatus(resource) {
  const integration = state.integration || {};
  const resources = Array.isArray(integration.resources) ? integration.resources : [];
  return resources.find(function findResource(row) { return row.resource === resource; }) || null;
}

function connectedAccountLabel(status) {
  const type = String(status && status.account_type || 'unknown').toLowerCase();
  if (type === 'dealer') return 'Dealer account';
  if (type === 'reseller') return 'Reseller account';
  if (type === 'admin') return 'Administrator account';
  return 'Connected account';
}

function remoteMatches(item, query) {
  const value = String(query || '').trim().toLowerCase();
  if (!value) return true;
  const phoneDigits = value.replace(/\D+/g, '');
  const haystack = Object.values(item || {}).filter(function scalar(entry) {
    return ['string', 'number', 'boolean'].includes(typeof entry);
  }).join(' ').toLowerCase();
  const itemPhone = String(item && (item.__normalized_phone || item.phone || item.customer_phone || item.reseller_phone) || '').replace(/\D+/g, '');
  return haystack.includes(value) || (phoneDigits && itemPhone.includes(phoneDigits));
}

function remoteStatusBadge(resource) {
  const row = integrationResourceStatus(resource);
  if (!row) return badge('Not synced', 'warning');
  if (row.status === 'ok') return badge('Loaded ' + String(row.item_count || 0), 'success');
  if (row.status === 'syncing') return badge('Syncing', 'info');
  if (row.status === 'forbidden') return badge('Missing scope', 'warning');
  return badge('Failed', 'danger');
}

function remoteReadOnlyNote() {
  return '<p class="connected-readonly-note">Connected records are read-only copies from AutoMarket Pro. Edit the original record on the website.</p>';
}

function renderDashboard() {
  const dashboard = state.dashboard || {};
  const integration = state.integration || {};
  const integrationStatus = integration.status || {};
  const connected = Number(integrationStatus.connected || 0) === 1;
  const remoteSummary = integrationSnapshot('dealer-summary') || integrationSnapshot('reseller-summary') || integrationSnapshot('admin-summary') || {};
  const remoteContacts = integrationRemote('agenda').length;
  const remoteOrders = integrationRemote('orders').length + integrationRemote('reseller-appointments').length;
  const remoteListings = integrationRemote('listings').length + integrationRemote('reseller-listings').length;
  const stats = [
    ['Contacts', dashboard.contacts || 0, 'Local workspace · ' + String(remoteContacts) + ' connected'],
    ['Active leads', dashboard.activeLeads || 0, String(dashboard.followUps || 0) + ' need follow-up soon'],
    ['Pending tasks', dashboard.pendingTasks || 0, String(dashboard.overdueTasks || 0) + ' overdue'],
    ["Today's meetings", dashboard.todayAppointments || 0, String(dashboard.activeAlerts || 0) + ' active alerts']
  ];
  const statHtml = stats.map(function renderStat(item) {
    return '<article class="stat-card"><span>' + esc(item[0]) + '</span><strong>' + esc(item[1]) + '</strong><small>' + esc(item[2]) + '</small></article>';
  }).join('');
  const upcoming = (dashboard.upcoming || []).map(function renderUpcoming(item) {
    return '<div class="list-item"><div class="list-item-main"><strong>' + esc(item.title) + '</strong><span>' + formatDate(item.start_at) + '</span></div>' + badge(item.status, 'info') + '</div>';
  }).join('') || emptyMini('No upcoming events', 'Create an appointment to build your schedule.');
  const priorities = (dashboard.priorities || []).map(function renderPriority(item) {
    return '<div class="list-item"><div class="list-item-main"><strong>' + esc(item.title) + '</strong><span>' + (item.due_at ? formatDate(item.due_at) : 'No due date') + '</span></div>' + badge(item.priority) + '</div>';
  }).join('') || emptyMini('No pending tasks', 'Add a task or follow-up.');
  const providerName = state.settings && state.settings.preferred_provider ? state.settings.preferred_provider : 'openai';
  const providerConfigured = Boolean(state.settings && state.settings.secrets && state.settings.secrets[providerName] && state.settings.secrets[providerName].configured);
  const alerts = state.alerts.slice(0, 4).map(alertMini).join('') || emptyMini('No active alerts', 'You are caught up.');
  const connectedPanel = connected
    ? '<article class="panel-card connected-dashboard-card"><div class="panel-header"><div><h3>' + esc(connectedAccountLabel(integrationStatus)) + '</h3><p>AutoMarket Pro live cache</p></div>' + badge(String(integrationStatus.sync_state || 'connected'), integrationStatus.sync_state === 'ready' ? 'success' : 'warning') + '</div>' +
      '<div class="connected-dashboard-stats"><div><span>Listings</span><strong>' + esc(remoteSummary.active_listings !== undefined ? remoteSummary.active_listings : remoteListings) + '</strong></div><div><span>Orders</span><strong>' + esc(remoteSummary.total_orders !== undefined ? remoteSummary.total_orders : remoteOrders) + '</strong></div><div><span>Agenda contacts</span><strong>' + esc(remoteSummary.agenda_contacts !== undefined ? remoteSummary.agenda_contacts : remoteContacts) + '</strong></div><div><span>Unread messages</span><strong>' + esc(remoteSummary.unread_messages || remoteSummary.total_messages || integrationRemote('messages').length) + '</strong></div></div>' +
      '<div class="button-row"><button class="ghost-button" data-go="connected" data-nexa-action="navigate-connected">Open connected data</button><button class="ghost-button" data-go="sync-inspector" data-nexa-action="navigate-sync-inspector">Open sync inspector</button></div></article>'
    : '<article class="panel-card connected-dashboard-card"><div class="panel-header"><div><h3>Connected Business</h3><p>AutoMarket Pro is not connected</p></div>' + badge('Not connected', 'warning') + '</div><p class="muted">Connect a scoped API key to load contacts, listings, orders, messages and account-specific resources.</p><button class="primary-button" data-go="connected" data-nexa-action="navigate-connected">Connect website</button></article>';
  return sectionHeader('Your business at a glance', 'Local data, connected business activity and suggested priorities.', '<button class="primary-button" data-nexa-action="task-create">+ New task</button>') +
    '<div class="grid stats-grid">' + statHtml + '</div>' +
    '<div class="grid dashboard-grid">' +
      connectedPanel +
      '<article class="panel-card"><div class="panel-header"><div><h3>Upcoming agenda</h3><p>Next scheduled appointments</p></div><button class="ghost-button" data-go="agenda" data-nexa-action="agenda-day">Open agenda</button></div><div class="list">' + upcoming + '</div></article>' +
      '<article class="panel-card"><div class="panel-header"><div><h3>Priority tasks</h3><p>Items that deserve attention</p></div><button class="ghost-button" data-go="tasks" data-nexa-action="navigate-tasks">Open tasks</button></div><div class="list">' + priorities + '</div></article>' +
      '<article class="panel-card"><div class="panel-header"><div><h3>Smart assistant</h3><p>Get an action plan from your configured provider</p></div>' + (providerConfigured ? badge('Ready', 'success') : badge('Not configured', 'warning')) + '</div><p class="muted">Nexa can review pending work and prepare next actions. Messages and appointments run automatically only when the user authorizes precise AI Control parameters; customer records remain read-only.</p><button class="primary-button" data-go="ai" data-nexa-action="navigate-ai">Generate suggestions</button></article>' +
      '<article class="panel-card"><div class="panel-header"><div><h3>Active alerts</h3><p>Overdue and upcoming work</p></div><strong>' + state.alerts.length + '</strong></div><div class="list">' + alerts + '</div></article>' +
    '</div>';
}

function renderContacts() {
  const local = state.contacts.map(function mapLocal(contact) {
    return { key:'local:'+contact.id, local:true, id:contact.id, name:contact.name, company:contact.company, phone:contact.phone, email:contact.email, location:'', tags:contact.tags, source:'Local', item:contact };
  });
  const map = new Map();
  local.forEach(function addLocal(row) {
    const identity = normalizedPhone(row.phone) || normalizedEmail(row.email) || row.key;
    map.set(identity || row.key, row);
  });
  integrationRemote('agenda').forEach(function addRemote(contact,index) {
    const identity = normalizedPhone(contact.phone) || normalizedEmail(contact.email) || ('name:'+String(contact.name||'').toLowerCase());
    const existing = map.get(identity);
    if (existing) {
      existing.source = 'Local + Website'; existing.remote = contact; existing.location = existing.location || contact.location || ''; existing.times_seen = contact.times_seen || 1;
    } else {
      map.set(identity || ('remote:'+index), { key:'remote:'+remoteItemId('agenda',contact,index), local:false, id:remoteItemId('agenda',contact,index), name:contact.name || 'Unnamed contact', company:contact.source_type || contact.created_from || '', phone:contact.phone, email:contact.email, location:contact.location, tags:'', times_seen:contact.times_seen || 1, source:'Website', item:contact });
    }
  });
  const query=String(state.search||'').toLowerCase();
  const rows=Array.from(map.values()).filter(function filter(row){ return remoteMatches(row,query); }).sort(function sort(a,b){ return String(a.name||'').localeCompare(String(b.name||'')); });
  const page=paginateItems(rows,'contacts');
  const body=page.items.map(function renderContact(row){
    const actions=row.local?'<button data-nexa-action="contact-edit" data-record-id="'+esc(row.id)+'">Edit</button><button data-nexa-action="contact-delete" data-record-id="'+esc(row.id)+'">Delete</button>':'<button data-nexa-action="connected-detail" data-resource="agenda" data-item-id="'+esc(row.id)+'">View</button>';
    return '<tr><td><b>'+esc(row.name)+'</b><br><span class="muted">'+esc(row.company||'')+'</span></td><td>'+esc(row.phone||'—')+'</td><td>'+esc(row.email||'—')+'</td><td>'+esc(row.location||'—')+'</td><td>'+badge(row.source,row.local&&row.remote?'success':row.local?'info':'warning')+'</td><td>'+esc(row.times_seen||'—')+'</td><td><div class="row-actions">'+actions+'</div></td></tr>';
  }).join('');
  const table=body?'<div class="table-wrap tall-table"><table><thead><tr><th>Name</th><th>Phone</th><th>Email</th><th>Location</th><th>Source</th><th>Seen</th><th></th></tr></thead><tbody>'+body+'</tbody></table></div>'+renderPagination(page,'contacts','contacts'):emptyMini('No contacts found','Create a local contact or synchronize the website.','contacts-empty');
  return sectionHeader('Contacts','Local contacts and AutoMarket Pro agenda contacts are unified in one searchable workspace.','<div class="button-row"><span class="summary-pill">'+rows.length+' total</span><button class="primary-button" data-nexa-action="contact-create">+ New contact</button></div>')+toolbar('Contacts','contact-create','contact-search','new-contact')+table;
}

function renderLeads() {
  const unified=[];
  state.leads.forEach(function localLead(lead){ unified.push({id:lead.id,local:true,resource:'lead',name:lead.name,listing:lead.company||lead.contact_name||'',phone:lead.phone,email:lead.email,status:lead.status,priority:lead.priority,value:lead.estimated_value,date:lead.next_follow_up||lead.updated_at,source:lead.source||'Local',item:lead}); });
  integrationRemote('orders').forEach(function orderLead(order,index){ unified.push({id:remoteItemId('orders',order,index),local:false,resource:'orders',name:order.customer_name||'Website lead',listing:order.listing_title||order.order_type||'',phone:order.customer_phone,email:order.customer_email,status:order.status||order.appointment_status||'new',priority:String(order.status||'').toLowerCase().includes('unreview')?'High':'Medium',value:order.sale_price||0,date:order.appointment_date||order.updated_at||order.created_at,source:order.source||'Orders',item:order}); });
  integrationRemote('reseller-appointments').forEach(function resellerLead(order,index){ unified.push({id:remoteItemId('reseller-appointments',order,index),local:false,resource:'reseller-appointments',name:order.customer_name||'Reseller lead',listing:order.listing_title||order.store_name||'',phone:order.customer_phone,email:order.customer_email,status:order.appointment_status||order.sale_status||'pending',priority:'Medium',value:order.sale_price||order.commission_amount||0,date:order.appointment_date||order.updated_at||order.created_at,source:'Reseller',item:order}); });
  const rows=unified.filter(function filter(row){ return remoteMatches(row,state.search); }).sort(function sort(a,b){ return (toValidDate(b.date)||new Date(0))-(toValidDate(a.date)||new Date(0)); });
  const page=paginateItems(rows,'leads');
  const body=page.items.map(function renderLead(row){
    const actions=row.local?'<button data-nexa-action="ai-generate" data-ai-lead="'+esc(row.id)+'">Suggest</button><button data-nexa-action="lead-edit" data-record-id="'+esc(row.id)+'">Edit</button><button data-nexa-action="lead-delete" data-record-id="'+esc(row.id)+'">Delete</button>':'<button data-nexa-action="connected-ai" data-related-type="order" data-resource="'+esc(row.resource)+'" data-item-id="'+esc(row.id)+'">Ask AI</button><button data-nexa-action="connected-detail" data-resource="'+esc(row.resource)+'" data-item-id="'+esc(row.id)+'">Details</button>';
    return '<tr><td><b>'+esc(row.name)+'</b><br><span class="muted">'+esc(row.listing||'')+'</span></td><td>'+esc(row.phone||'—')+'<br><span class="muted">'+esc(row.email||'—')+'</span></td><td>'+badge(row.status)+'</td><td>'+badge(row.priority)+'</td><td>'+money(row.value)+'</td><td>'+formatDate(row.date)+'</td><td>'+badge(row.source,'info')+'</td><td><div class="row-actions">'+actions+'</div></td></tr>';
  }).join('');
  const table=body?'<div class="table-wrap tall-table"><table><thead><tr><th>Lead / listing</th><th>Contact</th><th>Status</th><th>Priority</th><th>Value</th><th>Activity</th><th>Source</th><th></th></tr></thead><tbody>'+body+'</tbody></table></div>'+renderPagination(page,'leads','leads'):emptyMini('No leads found','Create a lead or synchronize orders:read.','leads-empty');
  return sectionHeader('Leads','Orders from the website and reseller appointments now appear directly in the main lead pipeline.','<div class="button-row"><span class="summary-pill">'+rows.length+' total</span><button class="primary-button" data-nexa-action="lead-create">+ New lead</button></div>')+toolbar('Leads','lead-create','lead-search','new-lead')+table;
}

function renderTasks() {
  const rows=state.tasks.filter(function filterTask(task){ return modules.tasks?modules.tasks.matches(task,state.search):true; });
  const page=paginateItems(rows,'tasks');
  const body=page.items.map(function renderTask(task){ const checked=task.status==='Completed'?' checked':''; return '<tr><td><input style="width:auto" type="checkbox" data-nexa-action="task-complete" data-record-id="'+esc(task.id)+'"'+checked+'></td><td><b>'+esc(task.title)+'</b><br><span class="muted">'+esc(task.description||'')+'</span></td><td>'+badge(task.priority)+'</td><td>'+badge(task.status)+'</td><td>'+formatDate(task.due_at)+'</td><td><div class="row-actions"><button data-nexa-action="task-edit" data-record-id="'+esc(task.id)+'">Edit</button><button data-nexa-action="task-delete" data-record-id="'+esc(task.id)+'">Delete</button></div></td></tr>'; }).join('');
  const table=body?'<div class="table-wrap tall-table"><table><thead><tr><th></th><th>Task</th><th>Priority</th><th>Status</th><th>Due</th><th></th></tr></thead><tbody>'+body+'</tbody></table></div>'+renderPagination(page,'tasks','tasks'):emptyMini('No tasks found','Create a task to organize your next action.','tasks-empty');
  return sectionHeader('Tasks','Manage work, follow-ups and deadlines. Every list is limited to 40 records per page.')+toolbar('Tasks','task-create','task-search','new-task')+table;
}

function messageCapabilities() {
  const status=state.integration&&state.integration.status?state.integration.status:{};
  let map={};
  try { map=JSON.parse(status.connection_map_json||'{}'); } catch(error) { map={}; }
  let scopes=[];
  try { scopes=JSON.parse(status.scopes_json||'[]'); } catch(error) { scopes=[]; }
  const available=[].concat(map.available_resources||map.allowed_resources||map.resources||[]).map(function normalizeResource(item){ return typeof item==='string'?item:String(item&&item.resource||item&&item.name||''); });
  return {
    read:scopes.includes('messages:read')||!scopes.length,
    write:scopes.includes('messages:write'),
    fullThread:available.includes('message-thread')||available.includes('messages-thread')||Boolean(map.message_threads||map.capabilities&&map.capabilities.message_threads),
    send:available.includes('message-send')||available.includes('messages-send')||Boolean(map.message_send||map.capabilities&&map.capabilities.message_send),
    markRead:available.includes('message-read')||Boolean(map.message_read||map.capabilities&&map.capabilities.message_read)
  };
}

function selectedMessageThread() {
  const rows=integrationRemote('messages');
  return rows.find(function findThread(item,index){ return remoteItemId('messages',item,index)===state.messageThreadId; })||null;
}

function latestInboundMessage() {
  const rows=state.messageConversation&&Array.isArray(state.messageConversation.messages)?state.messageConversation.messages:[];
  const inbound=rows.filter(function inboundOnly(row){ return String(row.direction||'').toLowerCase()!=='outbound'; });
  return inbound.length?inbound[inbound.length-1]:rows[rows.length-1]||null;
}

function renderConversationBubbles() {
  const conversation=state.messageConversation;
  const messages=conversation&&Array.isArray(conversation.messages)?conversation.messages:[];
  if(state.messageBusy&&!messages.length) return '<div class="message-loading"><span></span><b>Loading complete conversation…</b></div>';
  if(state.messageError&&!messages.length) return '<div class="message-api-warning"><b>Full conversation is not available yet</b><p>'+esc(state.messageError)+'</p><small>The website API must expose <code>message-thread</code> with <code>messages:read</code>.</small></div>';
  if(!messages.length) return emptyMini('Open a conversation','Select a thread on the left to load the complete history.');
  return messages.map(function bubble(row){
    const outbound=String(row.direction||'').toLowerCase()==='outbound';
    const name=row.sender_name||row.sender_type||(outbound?'Business':'Customer');
    const status=outbound&&row.status?'<span>'+esc(row.status)+'</span>':'';
    return '<article class="conversation-bubble '+(outbound?'outbound':'inbound')+'"><div class="conversation-meta"><b>'+esc(name)+'</b><time>'+formatDate(row.sent_at||row.created_at)+'</time></div><p>'+esc(row.body||'')+'</p>'+status+'</article>';
  }).join('');
}

function renderKnowledgeCenter() {
  const summary=state.knowledgeSummary||{};
  const filtered=state.messageKnowledge.filter(function filterKnowledge(row){return remoteMatches(row,state.search); });
  const page=paginateItems(filtered,'message-knowledge');
  const rows=page.items.map(function knowledgeRow(row){
    const isBuiltIn=Number(row.built_in||0)===1;
    const enabled=Number(row.enabled||0)===1;
    const control=isBuiltIn
      ? '<button class="ghost-button" data-nexa-action="message-knowledge-toggle" data-knowledge-id="'+esc(row.id)+'" data-enabled="'+(enabled?'0':'1')+'">'+(enabled?'Disable':'Enable')+'</button>'
      : '<button class="danger-button" data-nexa-action="message-knowledge-delete" data-knowledge-id="'+esc(row.id)+'">Delete</button>';
    return '<article class="knowledge-card '+(enabled?'':'knowledge-disabled')+'"><div><div class="knowledge-badges">'+badge(isBuiltIn?'Built-in':'Custom',isBuiltIn?'info':'success')+badge(String(row.locale||'auto').toUpperCase(),'')+badge(String(row.dealer_segment||'all dealers').replaceAll('-',' '),'')+(enabled?'':badge('Disabled','warning'))+'</div><span>'+esc(row.category||'General')+'</span><h3>'+esc(row.label||'Approved reply')+'</h3><p><b>Triggers:</b> '+esc(row.triggers)+'</p><p>'+esc(row.response)+'</p><small>Intent: '+esc(row.intent_key||'custom')+' · Safety: '+esc(row.safety_level||'standard')+' · Used '+esc(row.use_count||0)+' times</small></div>'+control+'</article>';
  }).join('')||emptyMini('No matching knowledge','Try another phrase or create a custom approved response.');
  const summaryCards='<div class="knowledge-summary-grid"><article><span>Built-in library</span><strong>'+esc(summary.built_in||0)+'</strong><small>Installed for every user</small></article><article><span>Natural variants</span><strong>'+esc(summary.response_variants||0)+'</strong><small>Three approved variations per built-in record</small></article><article><span>Dealer types</span><strong>'+esc(summary.dealer_segments||0)+'</strong><small>Auto, truck, motorcycle, RV, trailer, marine and more</small></article><article><span>Languages</span><strong>'+esc(summary.languages||0)+'</strong><small>English and Spanish</small></article></div>';
  const safety='<div class="knowledge-safety-note"><b>Automotive safety guard</b><span>The built-in library never promises financing approval, unverified inventory, discounts, appointments, warranties, legal outcomes, or sensitive-document handling. Nexa escalates those cases or asks for verified data.</span></div>';
  return summaryCards+safety+'<div class="message-knowledge-layout"><article class="panel-card"><div class="panel-header"><div><h3>Custom business knowledge</h3><p>Add dealership-specific policies or teach Nexa from a reply you reviewed and approved.</p></div>'+badge('Knowledge first','success')+'</div><div class="form-grid"><label>Label<input id="knowledge-label" value="Approved customer reply"></label><label>Category<input id="knowledge-category" value="Custom dealership knowledge"></label><label class="span-2">Customer words or intent<textarea id="knowledge-triggers" placeholder="Example: what are your hours, when are you open"></textarea></label><label class="span-2">Approved response<textarea id="knowledge-response" placeholder="Write the response Nexa may suggest when this intent matches."></textarea></label></div><div class="dialog-actions"><button class="primary-button" data-nexa-action="message-knowledge-save">Save custom knowledge</button></div></article><article class="panel-card"><div class="panel-header"><div><h3>Automotive Dealer Library</h3><p>'+filtered.length+' matching of '+state.messageKnowledge.length+' total records · Library '+esc(summary.library_version||'1.0.0')+'</p></div></div><div class="message-inbox-toolbar knowledge-search"><input id="view-search" data-nexa-action="message-search" type="search" value="'+esc(state.search)+'" placeholder="Search category, intent, vehicle type, English or Spanish…"><span>40 per page</span></div><div class="knowledge-list">'+rows+'</div>'+renderPagination(page,'message-knowledge','knowledge records')+'</article></div>';
}

function renderMessages() {
  if(state.messageTab==='knowledge'){
    return sectionHeader('Messages','Build the local knowledge engine that handles common customer questions before AI is used.','<div class="button-row"><button class="ghost-button" data-nexa-action="message-tab-inbox">Inbox</button><button class="primary-button" data-nexa-action="message-tab-knowledge">Knowledge Engine</button></div>')+renderKnowledgeCenter();
  }
  const rows=integrationRemote('messages').filter(function filterMessage(item){ return remoteMatches(item,state.search); }).sort(function sortMessages(a,b){ const announcement=Number(Boolean(b.is_announcement))-Number(Boolean(a.is_announcement)); if(announcement)return announcement; return (toValidDate(b.last_message_at||b.updated_at||b.created_at)||new Date(0))-(toValidDate(a.last_message_at||a.updated_at||a.created_at)||new Date(0)); });
  const page=paginateItems(rows,'messages');
  const selected=selectedMessageThread();
  const capabilities=messageCapabilities();
  const threadCards=page.items.map(function renderThread(item,index){
    const id=remoteItemId('messages',item,index+page.start); const unread=Number(item.unread_count||0); const active=id===state.messageThreadId;
    return '<button class="message-thread-card '+(active?'active ':'')+(item.is_announcement?'announcement ':'')+(unread?'unread':'')+'" data-nexa-action="message-thread-open" data-thread-id="'+esc(id)+'"><div class="message-thread-icon">'+(item.is_announcement?'!':'✉')+'</div><div><span>'+esc(item.is_announcement?'ADMIN ANNOUNCEMENT':item.participant_name||item.sender_type||item.context_type||'CONVERSATION')+'</span><strong>'+esc(item.subject||'Conversation')+'</strong><p>'+esc(item.last_message_preview||item.message_preview||'Open to read the conversation')+'</p><small>'+formatDate(item.last_message_at||item.updated_at||item.created_at)+' · '+esc(item.message_count||0)+' messages</small></div>'+(unread?'<em>'+esc(unread)+'</em>':'')+'</button>';
  }).join('')||emptyMini('No website messages loaded','Synchronize messages:read and inspect the API resource status.');
  const thread=state.messageConversation&&state.messageConversation.thread?state.messageConversation.thread:selected||{};
  const canReply=Boolean(state.messageThreadId)&&!Boolean(thread.is_announcement)&&thread.can_reply!==false&&Number(thread.can_reply)!==0;
  const latest=latestInboundMessage();
  const draftMeta=state.messageDraftMeta?'<div class="draft-source">'+badge(state.messageDraftMeta.engine==='knowledge'?(state.messageDraftMeta.built_in?'Automotive library':'Custom knowledge'):'AI fallback',state.messageDraftMeta.engine==='knowledge'?'success':'info')+(state.messageDraftMeta.confidence?'<span>'+Math.round(Number(state.messageDraftMeta.confidence)*100)+'% confidence</span>':'')+(state.messageDraftMeta.category?'<span>'+esc(state.messageDraftMeta.category)+'</span>':'')+(state.messageDraftMeta.safety_level&&state.messageDraftMeta.safety_level!=='standard'?'<span>Safety: '+esc(state.messageDraftMeta.safety_level)+'</span>':'')+'</div>':'';
  const composer=canReply?'<div class="message-composer">'+draftMeta+'<textarea id="message-composer" maxlength="8000" placeholder="Write a reply or let Nexa prepare one…">'+esc(state.messageDraft)+'</textarea><div class="message-composer-actions"><label class="teach-toggle"><input id="message-teach-after-send" type="checkbox"> Teach Nexa from this approved reply</label><button class="ghost-button" data-nexa-action="message-prepare-reply" '+(state.messageBusy?'disabled':'')+'>✦ Prepare reply</button><button class="primary-button" data-nexa-action="message-send-reply" '+(!capabilities.send||!capabilities.write||state.messageBusy?'disabled':'')+'>Send reply</button></div></div>':'<div class="message-readonly"><b>This conversation is read-only.</b><span>Announcements and threads without reply permission cannot be answered.</span></div>';
  const conversationHeader=state.messageThreadId?'<div class="conversation-header"><div><span>'+esc(thread.context_type||'MESSAGE THREAD')+'</span><h3>'+esc(thread.subject||selected&&selected.subject||'Conversation')+'</h3><p>'+esc(thread.participant_name||selected&&selected.participant_name||selected&&selected.sender_type||'Customer conversation')+'</p></div><div class="button-row"><button class="ghost-button" data-nexa-action="message-mark-read" '+(!capabilities.markRead?'disabled':'')+'>Mark read</button><button class="ghost-button" data-nexa-action="message-thread-refresh" '+(state.messageBusy?'disabled':'')+'>↻ Refresh</button><button class="ghost-button" data-nexa-action="message-open-ai">Open in AI Suggestions</button></div></div>':'<div class="conversation-header"><div><span>MESSAGE CENTER</span><h3>Select a conversation</h3><p>Complete history, knowledge-first suggestions, manual sending and user-authorized automatic actions.</p></div></div>';
  const settings='<div class="message-live-settings"><label><input id="message-realtime-enabled" type="checkbox" '+(String(state.settings&&state.settings.message_realtime_enabled||'1')==='1'?'checked':'')+'> Live refresh</label><label>Every <select id="message-poll-seconds"><option value="3"'+(String(state.settings&&state.settings.message_poll_seconds)==='3'?' selected':'')+'>3 sec</option><option value="5"'+(String(state.settings&&state.settings.message_poll_seconds||'5')==='5'?' selected':'')+'>5 sec</option><option value="10"'+(String(state.settings&&state.settings.message_poll_seconds)==='10'?' selected':'')+'>10 sec</option><option value="15"'+(String(state.settings&&state.settings.message_poll_seconds)==='15'?' selected':'')+'>15 sec</option></select></label><button class="ghost-button" data-nexa-action="message-settings-save">Save</button><span class="live-indicator"><i></i>'+(state.messageBusy?'Synchronizing':'Ready')+'</span></div>';
  return sectionHeader('Messages','Mirror website conversations, prepare replies locally first, and send manually or through explicitly authorized AI Control rules.','<div class="button-row">'+remoteStatusBadge('messages')+'<button class="ghost-button" data-nexa-action="message-tab-knowledge">Knowledge Engine</button><button class="primary-button" data-integration-sync="1" data-nexa-action="integration-sync">Sync inbox</button></div>')+settings+'<div class="message-workspace"><aside class="message-inbox"><div class="message-inbox-toolbar"><input id="view-search" data-nexa-action="message-search" type="search" value="'+esc(state.search)+'" placeholder="Search conversations…"><span>'+rows.length+' threads</span></div><div class="message-thread-list">'+threadCards+'</div>'+renderPagination(page,'messages','message threads')+'</aside><section class="conversation-panel">'+conversationHeader+'<div class="conversation-scroll" id="conversation-scroll">'+renderConversationBubbles()+'</div>'+composer+'</section></div>';
}

function renderAgenda() {
  const query=String(state.search||'').toLowerCase();
  const events=agendaEvents().filter(function filter(event){ return remoteMatches({title:event.title,detail:event.detail,source:event.source,status:event.status},query); });
  const anchor=toValidDate(state.agendaAnchor)||new Date();
  let calendar='';
  if(state.agendaMode==='week'){
    const start=startOfWeek(anchor);
    calendar='<div class="calendar-week">'+Array.from({length:7},function(_,index){ const day=addDays(start,index); const key=dateKey(day); const dayEvents=events.filter(function(event){return dateKey(event.date)===key;}); return '<section class="calendar-week-day '+(key===dateKey(new Date())?'today':'')+'"><header><span>'+day.toLocaleDateString(undefined,{weekday:'short'})+'</span><strong>'+day.getDate()+'</strong></header><div>'+dayEvents.map(eventChip).join('')+(dayEvents.length?'': '<span class="calendar-empty">No items</span>')+'</div></section>'; }).join('')+'</div>';
  } else {
    const first=new Date(anchor.getFullYear(),anchor.getMonth(),1); const gridStart=startOfWeek(first);
    calendar='<div class="calendar-weekdays">'+['Mon','Tue','Wed','Thu','Fri','Sat','Sun'].map(function(day){return '<span>'+day+'</span>';}).join('')+'</div><div class="calendar-month">'+Array.from({length:42},function(_,index){ const day=addDays(gridStart,index); const key=dateKey(day); const dayEvents=events.filter(function(event){return dateKey(event.date)===key;}); const visible=dayEvents.slice(0,4); return '<section class="calendar-day '+(day.getMonth()!==anchor.getMonth()?'outside ':'')+(key===dateKey(new Date())?'today':'')+'"><header><span>'+day.getDate()+'</span><small>'+dayEvents.length+'</small></header><div>'+visible.map(eventChip).join('')+(dayEvents.length>4?'<button class="calendar-more" data-nexa-action="agenda-day-focus" data-day="'+key+'">+'+(dayEvents.length-4)+' more</button>':'')+'</div></section>'; }).join('')+'</div>';
  }
  const page=paginateItems(events,'agenda-list');
  const list=page.items.map(function eventRow(event){ const action=event.local?(event.kind==='task'?'task-edit':event.kind==='appointment'?'appointment-edit':'agenda-noop'):'connected-detail'; const attrs=event.local?' data-record-id="'+esc(event.id)+'"':' data-resource="'+esc(event.resource)+'" data-item-id="'+esc(event.id)+'"'; return '<div class="agenda-work-item"><div class="agenda-date-block"><strong>'+event.date.toLocaleDateString(undefined,{month:'short',day:'numeric'})+'</strong><span>'+event.date.toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})+'</span></div><div><b>'+esc(event.title)+'</b><span>'+esc(event.detail||event.source)+'</span></div>'+badge(event.kind,'info')+badge(event.status||'scheduled')+'<button class="ghost-button" data-nexa-action="'+esc(action)+'"'+attrs+'>'+(event.local?'Open':'Details')+'</button></div>'; }).join('')||emptyMini('Nothing scheduled','Create a task, appointment or synchronize website appointments.');
  const label=state.agendaMode==='week'?'Week of '+formatDate(startOfWeek(anchor),false):anchor.toLocaleDateString(undefined,{month:'long',year:'numeric'});
  const controls='<div class="agenda-controls"><button class="ghost-button" data-nexa-action="agenda-prev">‹</button><button class="ghost-button" data-nexa-action="agenda-today">Today</button><button class="ghost-button" data-nexa-action="agenda-next">›</button><strong>'+esc(label)+'</strong><button class="'+(state.agendaMode==='month'?'primary-button':'ghost-button')+'" data-nexa-action="agenda-month">Month</button><button class="'+(state.agendaMode==='week'?'primary-button':'ghost-button')+'" data-nexa-action="agenda-week">Week</button></div>';
  return sectionHeader('Agenda','A visual command center for local tasks, appointments, reminders and website appointments.','<div class="button-row"><button class="secondary-button" data-nexa-action="task-create">+ Task</button><button class="primary-button" data-nexa-action="appointment-create">+ Appointment</button></div>')+toolbar('Agenda items','appointment-create','appointment-search','new-appointment')+'<article class="panel-card calendar-panel">'+controls+calendar+'</article><article class="panel-card agenda-work-panel"><div class="panel-header"><div><h3>Organized work</h3><p>Everything with a date, in chronological order</p></div><strong>'+events.length+'</strong></div><div class="agenda-work-list">'+list+'</div>'+renderPagination(page,'agenda-list','agenda items')+'</article>';
}

function renderAI() {
  const provider = state.settings && state.settings.preferred_provider ? state.settings.preferred_provider : 'openai';
  const providerState = state.settings && state.settings.secrets ? state.settings.secrets[provider] : null;
  const configured = Boolean(providerState && providerState.configured);
  const suggestionPage = paginateItems(state.suggestions, 'ai-history');
  const history = suggestionPage.items.map(function renderSuggestion(item) {
    return '<div class="list-item"><div class="list-item-main"><strong>' + esc(String(item.kind || '').replaceAll('_', ' ')) + '</strong><span>' + esc(item.provider) + ' · ' + formatDate(item.created_at) + '</span></div><button class="ghost-button" data-nexa-action="ai-show-suggestion" data-show-suggestion="' + esc(item.id) + '">View</button></div>';
  }).join('') || emptyMini('No suggestions yet', 'Generate the first suggestion when an AI provider is configured.');
  const statusBadge = configured ? badge('Configured', 'success') : badge('Not configured', 'warning');
  const providerOptions = '<option value="openai"' + (provider === 'openai' ? ' selected' : '') + '>OpenAI</option><option value="deepseek"' + (provider === 'deepseek' ? ' selected' : '') + '>DeepSeek</option>';
  return sectionHeader('AI Suggestions', 'Use approved local knowledge first, then your selected AI provider only when the conversation needs it.') +
    '<div class="grid ai-layout">' +
      '<article class="panel-card"><div class="panel-header"><div><h3>Generate a suggestion</h3><p>Manual AI workspace; automatic permissions are managed separately in AI Control</p></div>' + statusBadge + '</div><div class="form-grid">' +
        '<label>Provider<select id="ai-provider" data-nexa-action="ai-provider-select">' + providerOptions + '</select></label>' +
        '<label>Suggestion type<select id="ai-kind"><option value="daily_priorities">Daily priorities</option><option value="lead_next_step">Lead next step</option><option value="agenda_optimization">Agenda optimization</option><option value="follow_up_draft">Follow-up note draft</option><option value="stale_leads">Stale leads</option><option value="live_message_reply">Live conversation reply</option><option value="message_response_strategy">Message response strategy</option><option value="order_follow_up">Order / lead follow-up</option></select></label>' +
        '<label>Related record type<select id="ai-related-type"><option value="">Entire workspace</option><option value="lead">Lead</option><option value="contact">Contact</option><option value="task">Task</option><option value="appointment">Appointment</option><option value="message">Website message</option><option value="order">Website order / lead</option></select></label>' +
        '<label>Related record<select id="ai-related-id"><option value="">None selected</option></select></label>' +
        '<label class="span-2">What should Nexa focus on?<textarea id="ai-focus" placeholder="Example: Help me prioritize follow-ups before Friday.">' + esc(state.aiPrefill && state.aiPrefill.focus || '') + '</textarea></label>' +
      '</div><div class="dialog-actions" style="padding-top:14px"><button class="secondary-button" id="ai-cancel" data-nexa-action="ai-cancel"' + (state.activeAIRequest ? '' : ' disabled') + '>Cancel</button><button class="primary-button" id="ai-generate" data-nexa-action="ai-generate" data-testid="generate-suggestion">Generate suggestion</button></div><p class="ai-status" id="ai-status">' + (configured ? 'Ready to use the selected provider.' : 'AI provider not configured') + '</p></article>' +
      '<article class="panel-card"><div class="panel-header"><div><h3>Suggestion</h3><p>Review before turning it into an action</p></div></div><div class="ai-output" id="ai-output">' + esc(state.aiResult || 'Your generated suggestion will appear here.') + '</div><div class="dialog-actions"><button class="secondary-button" data-nexa-action="ai-save-note" id="ai-save-note">Save note</button><button class="primary-button" data-nexa-action="ai-save-task" id="ai-save-task">Save task</button></div></article>' +
      '<article class="panel-card" style="grid-column:1/-1"><div class="panel-header"><div><h3>Recent suggestions</h3><p>Stored locally in your workspace</p></div></div><div class="list">' + history + '</div>' + renderPagination(suggestionPage, 'ai-history', 'suggestions') + '</article>' +
    '</div>';
}

function renderAlerts() {
  const alertPage=paginateItems(state.alerts,'alerts');
  const alertCards=alertPage.items.map(function renderAlert(alert){ return '<article class="alert-card '+esc(alert.level)+'"><div class="alert-marker"></div><div><h3>'+esc(alert.title)+'</h3><p class="muted" style="margin:0">'+esc(alert.type)+' · '+formatDate(alert.date)+'</p></div>'+badge(alert.level)+'</article>'; }).join('')||emptyMini('No active alerts','There is nothing urgent right now.');
  const reminderPage=paginateItems(state.reminders,'reminders');
  const reminderRows=reminderPage.items.map(function renderReminder(reminder){ const enabled=Number(reminder.enabled)===1; return '<div class="list-item"><div class="list-item-main"><strong>'+esc(reminder.title)+'</strong><span>'+formatDate(reminder.remind_at)+' · '+(enabled?'Enabled':'Paused')+'</span></div><button class="ghost-button" data-nexa-action="reminder-toggle" data-record-id="'+esc(reminder.id)+'">'+(enabled?'Pause':'Enable')+'</button></div>'; }).join('')||emptyMini('No custom reminders','Create a reminder for an important follow-up.');
  return sectionHeader('Alerts','Overdue tasks, due follow-ups and upcoming appointments.','<button class="primary-button" data-nexa-action="reminder-create">+ Reminder</button>')+'<div class="grid">'+alertCards+'</div>'+renderPagination(alertPage,'alerts','alerts')+'<article class="panel-card"><div class="panel-header"><div><h3>Custom reminders</h3><p>Local reminders that work without AI</p></div><button class="ghost-button" data-nexa-action="alert-refresh">Refresh</button></div><div class="list">'+reminderRows+'</div>'+renderPagination(reminderPage,'reminders','reminders')+'</article>';
}

function integrationSnapshot(resource) {
  const integration = state.integration || {};
  const snapshots = Array.isArray(integration.snapshots) ? integration.snapshots : [];
  const row = snapshots.find(function findSnapshot(item) { return item.resource === resource; });
  if (!row || !row.payload_json) return null;
  try { return JSON.parse(row.payload_json); } catch (error) { return null; }
}

function dataList(payload) {
  if (Array.isArray(payload)) return payload;
  if (!payload || typeof payload !== 'object') return [];
  const keys = ['items', 'records', 'rows', 'listings', 'orders', 'contacts', 'agenda', 'messages', 'threads', 'resellers', 'appointments', 'assignments', 'stores', 'users', 'validations', 'data'];
  for (const key of keys) if (Array.isArray(payload[key])) return payload[key];
  return [];
}

function valueLabel(value) {
  if (value === null || value === undefined || value === '') return '—';
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (typeof value === 'number') return String(value);
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

function renderConnectedSummary(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return emptyMini('No summary cached', 'Press Sync now after connecting your API key.');
  const entries = Object.entries(payload).filter(function filterSummary(entry) {
    return ['string', 'number', 'boolean'].includes(typeof entry[1]);
  }).slice(0, 16);
  if (!entries.length) return emptyMini('No summary fields', 'The connected endpoint did not return summary values.');
  return '<div class="connected-metrics">' + entries.map(function renderMetric(entry) {
    return '<div class="connected-metric"><span>' + esc(entry[0].replaceAll('_', ' ')) + '</span><strong>' + esc(valueLabel(entry[1])) + '</strong></div>';
  }).join('') + '</div>';
}

function remoteTitle(resource, item) {
  if (!item || typeof item !== 'object') return resource;
  return item.title || item.listing_title || item.name || item.customer_name || item.reseller_name || item.store_name || item.subject || item.business_name || item.email || item.phone || resource;
}

function remoteSubtitle(resource, item) {
  if (!item || typeof item !== 'object') return '';
  if (resource === 'messages') return [item.is_announcement ? 'Admin announcement' : item.context_type, item.unread_count ? item.unread_count + ' unread' : '', item.last_message_at].filter(Boolean).join(' · ');
  if (resource === 'listings' || resource === 'reseller-listings') return [item.status, item.category, item.price !== undefined ? money(item.price) : ''].filter(Boolean).join(' · ');
  if (resource === 'orders' || resource === 'reseller-appointments') return [item.status || item.appointment_status, item.customer_phone, item.appointment_date].filter(Boolean).join(' · ');
  return [item.status, item.company, item.location, item.updated_at || item.created_at].filter(Boolean).join(' · ');
}

function renderConnectedRows(resource, payloadOrItems, limit) {
  const items=Array.isArray(payloadOrItems)?payloadOrItems:dataList(payloadOrItems);
  const ordered=resource==='messages'?items.slice().sort(function announcementsFirst(a,b){return Number(Boolean(b.is_announcement))-Number(Boolean(a.is_announcement));}):items;
  const key='connected:'+resource;
  const page=paginateItems(ordered,key);
  const rows=page.items.slice(0,Number(limit||PAGE_SIZE));
  if(!rows.length)return emptyMini('No '+resource+' cached','Open API Sync Inspector to see whether this resource loaded or failed.');
  return '<div class="connected-record-list">'+rows.map(function renderRemoteItem(item,index){ const title=remoteTitle(resource,item); const subtitle=remoteSubtitle(resource,item); const url=item.listing_url||item.public_store_url||item.profile_url||''; const announcement=item.is_announcement?'<span class="connected-announcement">Announcement</span>':''; const link=url?'<a class="ghost-button connected-open-link" href="'+esc(url)+'" target="_blank" rel="noreferrer">Open</a>':''; const id=remoteItemId(resource,item,index+page.start); return '<div class="connected-record '+(item.is_announcement?'announcement':'')+'"><div><strong>'+esc(title)+'</strong><span>'+esc(valueLabel(subtitle))+'</span></div><div class="connected-record-actions">'+announcement+(item.status?badge(item.status):'')+'<button class="ghost-button" data-nexa-action="connected-detail" data-resource="'+esc(resource)+'" data-item-id="'+esc(id)+'">Details</button>'+link+'</div></div>'; }).join('')+'</div>'+renderPagination(page,key,resource);
}

function connectedResourceDefinitions(accountType) {
  const definitions = {
    dealer: [
      ['store', 'Store profile', 'Public business profile and status'],
      ['dealer-summary', 'Dealer summary', 'Listings, orders, messages and appointments'],
      ['listings', 'Listings', 'Inventory, images, pricing and status'],
      ['orders', 'Orders and appointments', 'Customer inquiries and reseller appointments'],
      ['agenda', 'Agenda contacts', 'Customers and repeat contacts'],
      ['messages', 'Message activity', 'Safe thread metadata and announcements'],
      ['resellers', 'Resellers', 'Appointments, sales and commission activity']
    ],
    reseller: [
      ['reseller-profile', 'Reseller profile', 'Connected reseller identity and status'],
      ['reseller-summary', 'Reseller summary', 'Assignments, appointments, sales and commissions'],
      ['reseller-listings', 'Assigned listings', 'Listings available to promote'],
      ['reseller-appointments', 'Appointments', 'Customers, outcomes and commissions'],
      ['agenda', 'Agenda contacts', 'Connected customer directory'],
      ['messages', 'Message activity', 'Safe thread metadata and announcements']
    ],
    admin: [
      ['admin-summary', 'Platform summary', 'Users, dealers, stores, listings and orders'],
      ['stores', 'Stores', 'Dealer stores and marketplace activity'],
      ['users', 'Users', 'Safe account metadata without passwords'],
      ['listings', 'Listings', 'Marketplace inventory'],
      ['orders', 'Orders', 'Platform order and appointment records'],
      ['agenda', 'Agenda contacts', 'Connected contacts'],
      ['messages', 'Message activity', 'Safe thread metadata and announcements'],
      ['resellers', 'Resellers', 'Reseller performance and appointments'],
      ['validation', 'Dealer validation', 'Pending and reviewed validation metadata'],
      ['api-keys-status', 'API key status', 'Non-secret API integration health']
    ]
  };
  return definitions[String(accountType || '').toLowerCase()] || [];
}

function parseIntegrationJson(value, fallback) {
  try { return value ? JSON.parse(value) : fallback; } catch (error) { return fallback; }
}

function renderConnectionProgress(resources) {
  const rows = Array.isArray(resources) ? resources : [];
  const ok = rows.filter(function successful(row) { return row.status === 'ok'; }).length;
  const failed = rows.filter(function failedRow(row) { return ['failed', 'forbidden'].includes(row.status); }).length;
  const syncing = rows.filter(function syncingRow(row) { return row.status === 'syncing'; }).length;
  const total = rows.length;
  const percent = total ? Math.round((ok / total) * 100) : 0;
  return '<div class="sync-progress"><div class="sync-progress-head"><span>' + ok + ' loaded · ' + failed + ' failed · ' + syncing + ' working</span><strong>' + percent + '%</strong></div><div class="sync-progress-track"><span style="width:' + percent + '%"></span></div></div>';
}

function renderConnectedBusiness() {
  const integration = state.integration || {};
  const settings = integration.settings || state.settings || {};
  const secrets = settings.secrets || {};
  const status = integration.status || {};
  const resources = Array.isArray(integration.resources) ? integration.resources : [];
  const connected = Number(status.connected || 0) === 1;
  const keyState = secrets.automarket || { configured: false, masked: '' };
  const accountType = String(status.account_type || 'unknown').toLowerCase();
  const connectionMap = parseIntegrationJson(status.connection_map_json, {});
  const scopes = parseIntegrationJson(status.scopes_json, []);
  const definitions = connectedResourceDefinitions(accountType);
  const identityPayload = integrationRemote(accountType === 'dealer' ? 'store' : accountType === 'reseller' ? 'reseller-profile' : 'admin-summary')[0] || {};
  const summaryPayload = integrationRemote(accountType === 'dealer' ? 'dealer-summary' : accountType === 'reseller' ? 'reseller-summary' : 'admin-summary')[0] || {};
  const resourceCards = definitions.map(function renderResourceDefinition(definition) {
    const resource = definition[0];
    const title = definition[1];
    const description = definition[2];
    const items = integrationRemote(resource);
    return '<article class="panel-card connected-resource-card"><div class="panel-header"><div><h3>' + esc(title) + '</h3><p>' + esc(description) + '</p></div>' + remoteStatusBadge(resource) + '</div>' +
      (['store', 'dealer-summary', 'reseller-profile', 'reseller-summary', 'admin-summary', 'api-keys-status'].includes(resource)
        ? renderConnectedSummary(items[0] || integrationSnapshot(resource))
        : renderConnectedRows(resource, items, 40)) + '</article>';
  }).join('');
  return sectionHeader('Connected Business', 'A real read-only sync from AutoMarket Pro, separated by account type and API scope.', '<div class="button-row"><button class="secondary-button" data-go="sync-inspector" data-nexa-action="navigate-sync-inspector">API Sync Inspector</button><button class="primary-button" data-integration-sync="1" data-nexa-action="integration-sync">Sync now</button></div>') +
    '<div class="connection-hero ' + (connected ? 'connected' : '') + '">' +
      '<div class="connection-orb"><img src="assets/nexa-ai-orb.svg" alt="Nexa connected assistant"><span></span></div>' +
      '<div><p class="eyebrow">SECURE WEBSITE CONNECTION</p><h2>' + (connected ? esc(connectedAccountLabel(status)) + ' connected' : 'Connect your AutoMarket Pro website') + '</h2><p>' + (connected ? 'Nexa detected the account, loaded the resources granted to this key, and saved a local read-only cache.' : 'Create a scoped key in AutoMarket Pro, paste it once, and Nexa protects it with Windows secure storage.') + '</p></div>' +
      '<div class="connection-status">' + badge(connected ? String(status.sync_state || 'connected') : 'Not connected', connected && status.sync_state === 'ready' ? 'success' : 'warning') + '<span>Last success: ' + formatDate(status.last_success_at || status.last_sync_at) + '</span></div>' +
    '</div>' +
    '<form id="integration-form" class="grid connection-grid" data-nexa-action="integration-save">' +
      '<article class="setting-block"><div class="panel-header"><div><h3>API connection</h3><p>Bearer key + X-Nexa-Api-Key fallback</p></div></div>' +
        '<label>Website URL<input name="automarket_base_url" type="url" placeholder="https://yourdomain.com" value="' + esc(settings.automarket_base_url || '') + '"></label>' +
        '<label>API key<input name="automarket_api_key" type="password" autocomplete="off" placeholder="Paste a new key to connect or rotate"></label>' +
        '<div class="key-state"><span>Stored key: <b>' + esc(keyState.configured ? keyState.masked : 'Not configured') + '</b></span><span>Encrypted by Windows</span></div>' +
        '<label>Automatic sync<select name="automarket_sync_enabled"><option value="1"' + (settings.automarket_sync_enabled === '1' ? ' selected' : '') + '>Enabled</option><option value="0"' + (settings.automarket_sync_enabled !== '1' ? ' selected' : '') + '>Disabled</option></select></label>' +
        '<label>Check for updates every<select name="automarket_poll_minutes">' + [1,5,15,30,60].map(function option(minutes) { return '<option value="' + minutes + '"' + (String(settings.automarket_poll_minutes || '5') === String(minutes) ? ' selected' : '') + '>' + minutes + ' minute' + (minutes === 1 ? '' : 's') + '</option>'; }).join('') + '</select></label>' +
        '<label>Maximum records per resource<select name="automarket_max_items">' + [25,50,100].map(function maxOption(limit) { return '<option value="' + limit + '"' + (String(settings.automarket_max_items || '100') === String(limit) ? ' selected' : '') + '>' + limit + '</option>'; }).join('') + '</select></label>' +
        '<div class="button-row"><button class="primary-button" type="submit" data-nexa-action="integration-save">Save connection</button><button class="secondary-button" type="button" id="integration-test" data-nexa-action="integration-test">Test and load data</button><button class="danger-button" type="button" id="integration-disconnect" data-nexa-action="integration-disconnect">Disconnect</button></div>' +
      '</article>' +
      '<article class="setting-block"><div class="panel-header"><div><h3>Connected identity</h3><p>Account type, ownership and granted resources</p></div></div>' +
        '<div class="connection-facts"><div><span>Account type</span><strong>' + esc(status.account_type || 'Waiting') + '</strong></div><div><span>Owner type</span><strong>' + esc(status.owner_type || '—') + '</strong></div><div><span>Account ID</span><strong>' + esc(status.account_id || status.owner_id || '—') + '</strong></div><div><span>Store ID</span><strong>' + esc(status.store_id || '—') + '</strong></div><div><span>API version</span><strong>' + esc(status.api_version || connectionMap.api_version || 'v1') + '</strong></div><div><span>Scopes</span><strong>' + esc(Array.isArray(scopes) ? scopes.length : 0) + '</strong></div></div>' +
        renderConnectionProgress(resources) +
        '<p class="muted">Nexa never imports passwords, server secrets, raw SQLite files, API-key hashes or sensitive document images. Full message bodies are cached only when the authorized message-thread endpoint grants access, and remain local to this computer.</p>' +
      '</article>' +
    '</form>' +
    '<div class="grid connected-identity-grid"><article class="panel-card"><div class="panel-header"><div><h3>Connected profile</h3><p>Store, reseller or administrator identity</p></div></div>' + renderConnectedSummary(identityPayload) + '</article><article class="panel-card"><div class="panel-header"><div><h3>Business summary</h3><p>Current account activity totals</p></div></div>' + renderConnectedSummary(summaryPayload) + '</article></div>' +
    '<div class="grid connected-data-grid">' + (resourceCards || emptyMini('No account resources discovered', 'Use Test and discover, then open API Sync Inspector for details.')) + '</div>';
}

function inspectorStatusBadge(row) {
  const status = String(row && row.status || 'never');
  if (status === 'ok') return badge('OK', 'success');
  if (status === 'syncing') return badge('Working', 'info');
  if (status === 'forbidden') return badge('Forbidden', 'warning');
  if (status === 'failed') return badge('Failed', 'danger');
  return badge('Waiting', 'warning');
}

function renderApiSyncInspector() {
  const integration = state.integration || {};
  const status = integration.status || {};
  const resources = Array.isArray(integration.resources) ? integration.resources : [];
  const runs = Array.isArray(integration.syncRuns) ? integration.syncRuns : [];
  const query = String(state.search || '').toLowerCase();
  const filtered = resources.filter(function filterResource(row) {
    return [row.resource, row.status, row.required_scope, row.last_error].join(' ').toLowerCase().includes(query);
  });
  const inspectorPage = paginateItems(filtered, 'inspector');
  const body = inspectorPage.items.map(function renderInspectorRow(row) {
    const error = row.last_error || '—';
    return '<tr><td><b>' + esc(row.resource) + '</b></td><td>' + inspectorStatusBadge(row) + '</td><td>' + esc(row.item_count || 0) + '</td><td>' + esc(row.required_scope || '—') + '</td><td>' + esc(row.http_status || '—') + '</td><td>' + esc(row.duration_ms ? row.duration_ms + ' ms' : '—') + '</td><td>' + formatDate(row.last_success_at || row.last_checked_at) + '</td><td class="inspector-error">' + esc(error) + '</td></tr>';
  }).join('');
  const table = body
    ? '<div class="table-wrap inspector-table"><table><thead><tr><th>Resource</th><th>Status</th><th>Count</th><th>Required scope</th><th>HTTP</th><th>Time</th><th>Last success</th><th>Last error</th></tr></thead><tbody>' + body + '</tbody></table></div>'
    : emptyMini('No API resource history', 'Test the connection or run a synchronization to create diagnostic rows.');
  const runRows = runs.map(function renderRun(run) {
    return '<div class="sync-run"><div><strong>' + esc(run.trigger_type) + ' synchronization</strong><span>' + formatDate(run.started_at) + ' · ' + esc(run.account_type || 'unknown') + '</span></div><div class="sync-run-counts"><span>' + esc(run.successful_resources || 0) + ' OK</span><span>' + esc(run.failed_resources || 0) + ' failed</span>' + badge(run.status, run.status === 'completed' ? 'success' : run.status === 'partial' ? 'warning' : 'danger') + '</div></div>';
  }).join('') || emptyMini('No sync runs yet', 'The complete run history will appear here.');
  return sectionHeader('API Sync Inspector', 'See exactly what is loading, what failed, which scope is required and when each resource last succeeded.', '<div class="button-row"><button class="secondary-button" data-go="connected" data-nexa-action="navigate-connected">Connection settings</button><button class="primary-button" data-integration-sync="1" data-nexa-action="integration-sync">Sync all resources</button></div>') +
    '<div class="inspector-hero"><div><p class="eyebrow">LIVE API DIAGNOSTICS</p><h2>' + esc(connectedAccountLabel(status)) + '</h2><p>' + esc(status.last_error || 'All available resources are reporting normally.') + '</p></div><div class="inspector-hero-state">' + badge(status.sync_state || 'idle', status.sync_state === 'ready' ? 'success' : status.sync_state === 'partial' ? 'warning' : 'info') + '<span>Last attempt: ' + formatDate(status.last_attempt_at) + '</span></div></div>' +
    renderConnectionProgress(resources) +
    '<div class="toolbar inspector-toolbar"><div class="search-box"><input id="view-search" data-nexa-action="integration-inspector-search" type="search" value="' + esc(state.search) + '" placeholder="Search resource, scope or error…"></div><button class="ghost-button" data-integration-sync="1" data-nexa-action="integration-retry-failed">Retry failed resources</button></div>' +
    '<article class="panel-card"><div class="panel-header"><div><h3>Resource status</h3><p>Ping → connection-map → account-specific resources</p></div><strong>' + esc(resources.length) + '</strong></div>' + table + renderPagination(inspectorPage, 'inspector', 'resources') + '</article>' +
    '<article class="panel-card"><div class="panel-header"><div><h3>Recent synchronization runs</h3><p>Manual and automatic background history</p></div></div><div class="sync-run-list">' + runRows + '</div></article>';
}

const notificationTypeLabels = {
  local_task_due: ['Task reminders', 'Local tasks that reached their reminder time'],
  local_appointment_due: ['Appointment reminders', 'Local appointments that reached their reminder time'],
  local_reminder: ['Custom reminders', 'Manual reminders created inside Nexa'],
  remote_orders: ['Orders', 'New order and reseller appointment activity from AutoMarket Pro'],
  remote_messages: ['Message activity', 'New thread metadata or unread-count changes'],
  remote_resellers: ['Reseller activity', 'New reseller appointments or records'],
  remote_agenda: ['Connected agenda', 'New or changed agenda contacts'],
  remote_listings: ['Listings', 'New or changed inventory records'],
  remote_connection: ['Connection health', 'Disconnected API, permissions or recovery'],
  remote_business_update: ['Business summaries', 'Changes in dealer or admin totals'],
  system_test: ['System notices', 'Permission tests and important Nexa status']
};

function renderSmartNotifications() {
  const settings = state.settings || {};
  const consent = settings.notifications_user_consent === '1';
  const events = state.notifications || [];
  const notificationPage = paginateItems(events, 'notifications');
  const cards = notificationPage.items.map(function renderNotificationEvent(event) {
    const unreadClass = event.read_at ? '' : ' unread';
    return '<article class="pulse-event ' + esc(event.severity || 'info') + unreadClass + '" data-notification-id="' + esc(event.id) + '">' +
      '<div class="pulse-event-icon"><img src="assets/nexa-ai-orb.svg" alt=""></div>' +
      '<div class="pulse-event-copy"><div><span>' + esc(String(event.type || '').replaceAll('_', ' ')) + '</span><time>' + formatDate(event.created_at) + '</time></div><strong>' + esc(event.title) + '</strong><p>' + esc(event.body) + '</p></div>' +
      '<div class="pulse-event-actions"><button class="ghost-button" data-nexa-action="notification-read" data-notification-id="' + esc(event.id) + '">' + (event.read_at ? 'Read' : 'Mark read') + '</button><button class="icon-button" data-nexa-action="notification-dismiss" data-notification-id="' + esc(event.id) + '" aria-label="Dismiss">×</button></div>' +
    '</article>';
  }).join('') || emptyMini('Nexa Pulse is quiet', 'New reminders and connected-business updates will appear here.');
  const preferences = state.notificationPreferences.map(function renderPreference(preference) {
    const label = notificationTypeLabels[preference.type] || [preference.type.replaceAll('_', ' '), 'Notification category'];
    return '<div class="preference-row" data-preference-type="' + esc(preference.type) + '"><div><strong>' + esc(label[0]) + '</strong><span>' + esc(label[1]) + '</span></div>' +
      '<label class="switch-label"><input type="checkbox" data-pref="enabled"' + (preference.enabled ? ' checked' : '') + '><span>Enabled</span></label>' +
      '<label class="switch-label"><input type="checkbox" data-pref="in_app_enabled"' + (preference.in_app_enabled ? ' checked' : '') + '><span>In app</span></label>' +
      '<label class="switch-label"><input type="checkbox" data-pref="desktop_enabled"' + (preference.desktop_enabled ? ' checked' : '') + '><span>Windows</span></label></div>';
  }).join('');
  return sectionHeader('Nexa Pulse', 'A permission-controlled notification assistant for local work and your connected business.', '<button class="secondary-button" id="notifications-mark-all" data-nexa-action="notification-read-all">Mark all read</button>') +
    '<div class="pulse-hero">' +
      '<div class="pulse-ai-stage"><div class="pulse-halo"></div><img src="assets/nexa-ai-orb.svg" alt="Nexa AI assistant"><span class="pulse-thought t1"></span><span class="pulse-thought t2"></span><span class="pulse-thought t3"></span></div>' +
      '<div class="pulse-thought-cloud"><p class="eyebrow">YOUR NOTIFICATION ASSISTANT</p><h2>' + (consent ? 'I am watching the work you approved.' : 'Would you like me to notify you?') + '</h2><p>' + (consent ? 'Choose exactly what appears inside Nexa and what may appear as a small Windows notification.' : 'Nexa will not show desktop notifications until you explicitly grant permission. You can change every category later.') + '</p><div class="button-row"><button class="primary-button" id="notification-permission" data-nexa-action="notification-permission">' + (consent ? 'Permission granted' : 'Enable notifications') + '</button><button class="secondary-button" id="notification-test" data-nexa-action="notification-test">Send test</button></div></div>' +
      '<div class="pulse-unread"><span>Unread</span><strong>' + state.unreadNotifications + '</strong><small>notifications</small></div>' +
    '</div>' +
    '<div class="grid pulse-layout">' +
      '<article class="panel-card pulse-feed"><div class="panel-header"><div><h3>Notification center</h3><p>Larger, detailed alerts inside the application</p></div></div><div class="pulse-events">' + cards + '</div>' + renderPagination(notificationPage, 'notifications', 'notifications') + '</article>' +
      '<form id="notification-preferences-form" class="panel-card pulse-preferences" data-nexa-action="notification-preferences-save"><div class="panel-header"><div><h3>What should Nexa tell you?</h3><p>Each category can be in-app, Windows, both or disabled.</p></div></div><div class="preference-list">' + preferences + '</div>' +
        '<div class="preference-behavior"><label>Sound<select name="notifications_sound"><option value="1"' + (settings.notifications_sound !== '0' ? ' selected' : '') + '>On</option><option value="0"' + (settings.notifications_sound === '0' ? ' selected' : '') + '>Silent</option></select></label>' +
        '<label>Closing the window<select name="notifications_minimize_to_tray"><option value="1"' + (settings.notifications_minimize_to_tray !== '0' ? ' selected' : '') + '>Keep monitoring in tray</option><option value="0"' + (settings.notifications_minimize_to_tray === '0' ? ' selected' : '') + '>Exit application</option></select></label>' +
        '<label>Start with Windows<select name="notifications_start_with_windows"><option value="1"' + (settings.notifications_start_with_windows === '1' ? ' selected' : '') + '>Enabled</option><option value="0"' + (settings.notifications_start_with_windows !== '1' ? ' selected' : '') + '>Disabled</option></select></label>' +
        '<label>Quiet hours start<input name="notifications_quiet_start" type="time" value="' + esc(settings.notifications_quiet_start || '22:00') + '"></label>' +
        '<label>Quiet hours end<input name="notifications_quiet_end" type="time" value="' + esc(settings.notifications_quiet_end || '07:00') + '"></label></div>' +
        '<button class="primary-button" type="submit" data-nexa-action="notification-preferences-save">Save notification choices</button></form>' +
    '</div>';
}

function showPulseToast(event) {
  if (!event) return;
  state.activePulseEvent = event;
  const panel = document.getElementById('nexa-pulse-toast');
  document.getElementById('pulse-toast-title').textContent = event.title || 'Nexa Pulse';
  document.getElementById('pulse-toast-body').textContent = event.body || '';
  panel.hidden = false;
  panel.classList.remove('leaving');
  panel.classList.add('visible');
  clearTimeout(showPulseToast.timer);
  showPulseToast.timer = setTimeout(hidePulseToast, 12000);
}

function hidePulseToast() {
  const panel = document.getElementById('nexa-pulse-toast');
  if (!panel || panel.hidden) return;
  panel.classList.add('leaving');
  setTimeout(function finishHide() { panel.hidden = true; panel.classList.remove('visible', 'leaving'); }, 260);
}

function renderActivity() {
  const page=paginateItems(state.activity,'activity');
  const items=page.items.map(function renderActivityItem(item){ return '<div class="activity-item"><div class="activity-icon">'+esc(String(item.action||'').slice(0,1).toUpperCase())+'</div><div><strong>'+esc(String(item.action||'').replaceAll('_',' '))+' · '+esc(item.entity_type)+'</strong><div class="muted">'+esc(item.details||item.entity_id||'')+'</div></div><time class="muted">'+formatDate(item.created_at)+'</time></div>'; }).join('')||emptyMini('No activity yet','Changes to records will appear here.');
  return sectionHeader('Activity','A local audit trail of important changes.')+'<article class="panel-card activity-scroll">'+items+renderPagination(page,'activity','activity records')+'</article>';
}

function backupName(filePath) {
  return String(filePath || '').replaceAll('\\', '/').split('/').pop();
}

function renderSettings() {
  const settings = state.settings || {};
  const secrets = settings.secrets || {};
  const backups = state.backups.slice(0, 8).map(function renderBackup(backup) {
    const size = (Number(backup.file_size) / 1024).toFixed(1);
    return '<div class="list-item"><div class="list-item-main"><strong>' + esc(backupName(backup.file_path)) + '</strong><span>' + formatDate(backup.created_at) + ' · ' + size + ' KB</span></div><button class="ghost-button" data-nexa-action="backup-restore" data-restore-backup="' + esc(backup.file_path) + '">Restore</button></div>';
  }).join('') || emptyMini('No backups recorded', 'Create a backup before major changes.');
  const preferredOpenAI = settings.preferred_provider === 'openai' ? ' selected' : '';
  const preferredDeepSeek = settings.preferred_provider === 'deepseek' ? ' selected' : '';
  return sectionHeader('Settings', 'Configure AI providers, notifications and local backups.') +
    '<form id="settings-form" class="grid settings-grid" data-nexa-action="settings-save">' +
      '<article class="setting-block"><div class="panel-header"><div><h3>AI provider</h3><p>Keys are encrypted with Electron safeStorage</p></div></div>' +
        '<label>Preferred provider<select name="preferred_provider"><option value="openai"' + preferredOpenAI + '>OpenAI</option><option value="deepseek"' + preferredDeepSeek + '>DeepSeek</option></select></label>' +
        '<label>OpenAI model<input name="openai_model" value="' + esc(settings.openai_model || 'gpt-4.1-mini') + '"></label>' +
        '<label>OpenAI API key<input name="openai_key" type="password" autocomplete="off" placeholder="Paste a new key to replace the saved key"></label>' +
        '<div class="key-state"><span>Stored key: <b>' + esc(secrets.openai && secrets.openai.masked ? secrets.openai.masked : 'Not configured') + '</b></span><span><button type="button" class="ghost-button" data-nexa-action="ai-test-connection" data-test-provider="openai">Test</button> <button type="button" class="danger-button" data-nexa-action="settings-remove-key" data-remove-key="openai">Remove</button></span></div>' +
        '<label>DeepSeek model<input name="deepseek_model" value="' + esc(settings.deepseek_model || 'deepseek-chat') + '"></label>' +
        '<label>DeepSeek base URL<input name="deepseek_base_url" value="' + esc(settings.deepseek_base_url || 'https://api.deepseek.com') + '"></label>' +
        '<label>DeepSeek API key<input name="deepseek_key" type="password" autocomplete="off" placeholder="Paste a new key to replace the saved key"></label>' +
        '<div class="key-state"><span>Stored key: <b>' + esc(secrets.deepseek && secrets.deepseek.masked ? secrets.deepseek.masked : 'Not configured') + '</b></span><span><button type="button" class="ghost-button" data-nexa-action="ai-test-connection" data-test-provider="deepseek">Test</button> <button type="button" class="danger-button" data-nexa-action="settings-remove-key" data-remove-key="deepseek">Remove</button></span></div>' +
        '<p class="muted">Secure storage: ' + (secrets.secureStorageAvailable ? 'Available' : 'Unavailable — keys cannot be saved on this system.') + '</p>' +
      '</article>' +
      '<article class="setting-block"><div class="panel-header"><div><h3>Workspace behavior</h3><p>Local notifications and backup retention</p></div></div>' +
        '<label>Windows notifications<select name="notifications_enabled"><option value="1"' + (settings.notifications_enabled === '1' ? ' selected' : '') + '>Enabled</option><option value="0"' + (settings.notifications_enabled === '0' ? ' selected' : '') + '>Disabled</option></select></label>' +
        '<label>Automatic daily backup<select name="automatic_backups"><option value="1"' + (settings.automatic_backups === '1' ? ' selected' : '') + '>Enabled</option><option value="0"' + (settings.automatic_backups === '0' ? ' selected' : '') + '>Disabled</option></select></label>' +
        '<label>Backups to retain<input name="backup_retention" type="number" min="1" max="50" value="' + esc(settings.backup_retention || '10') + '"></label>' +
        '<div><button class="primary-button" type="submit" data-testid="save-settings" data-nexa-action="settings-save">Save settings</button></div>' +
      '</article>' +
      '<article class="panel-card" style="grid-column:1/-1"><div class="panel-header"><div><h3>Database backups</h3><p>Manual and automatic copies of the local SQLite workspace</p></div><div><button type="button" class="secondary-button" id="open-backups" data-nexa-action="backup-open">Open folder</button> <button type="button" class="primary-button" id="create-backup" data-nexa-action="backup-create">Create backup</button></div></div><div class="list">' + backups + '</div></article>' +
    '</form>';
}

function automationOption(value, label, current) {
  return '<option value="' + esc(value) + '"' + (String(current) === String(value) ? ' selected' : '') + '>' + esc(label) + '</option>';
}

function renderAIControl() {
  const automation = state.automation || {};
  const settings = automation.settings || state.settings || {};
  const summary = automation.summary || {};
  const integration = automation.integration || {};
  const enabledMaster = String(settings.auto_actions_enabled || '0') === '1';
  const actions = Array.isArray(summary.recent) ? summary.recent : [];
  const page = paginateItems(actions, 'automatic-actions');
  const availability = integrationRemote('dealer-appointment-availability');
  const rows = page.items.map(function actionRow(row) {
    let payload = {};
    try { payload = JSON.parse(row.payload_json || '{}'); } catch (_) { payload = {}; }
    return '<tr><td>' + formatDate(row.created_at) + '</td><td>' + esc(String(row.action_type || '').replaceAll('_', ' ')) + '</td><td>' + badge(row.status || 'unknown', row.status === 'completed' ? 'success' : row.status === 'failed' ? 'danger' : row.status === 'blocked' ? 'warning' : 'info') + '</td><td>' + esc(row.engine || '—') + '</td><td>' + (row.confidence ? Math.round(Number(row.confidence) * 100) + '%' : '—') + '</td><td>' + esc(row.summary || row.error || payload.message || '—') + '</td></tr>';
  }).join('') || '<tr><td colspan="6">No automatic actions have been performed. AI Control is disabled by default.</td></tr>';
  const activeLabel = enabledMaster ? badge('Authorized and active', 'success') : badge('Disabled', 'warning');
  const timerLabel = automation.timer_active ? badge('Background guard ready', 'info') : badge('Stopped', 'warning');
  const connectedLabel = integration.connected ? badge('Website connected', 'success') : badge('Website not connected', 'warning');
  return sectionHeader('AI Control', 'Give Nexa limited autonomy only inside parameters you explicitly authorize. Customer records remain read-only and automatic deletion is impossible.', '<div class="button-row">' + activeLabel + timerLabel + connectedLabel + '</div>') +
    '<form id="automation-form" class="automation-layout" data-nexa-action="automation-save">' +
      '<article class="panel-card autonomy-master"><div class="panel-header"><div><p class="eyebrow">MASTER AUTHORIZATION</p><h2>Guarded automatic actions</h2><p>Nexa can send customer messages and create appointments from verified dealer availability while the program is running.</p></div><div class="autonomy-orb"><img src="assets/nexa-ai-orb.svg" alt="Nexa AI"><span></span><span></span><span></span></div></div>' +
        '<div class="automation-grid">' +
          '<label>Automatic actions<select name="auto_actions_enabled">' + automationOption('0','Disabled',settings.auto_actions_enabled) + automationOption('1','Enabled',settings.auto_actions_enabled) + '</select></label>' +
          '<label>Background check interval<select name="auto_actions_run_interval_seconds">' + [5,10,15,30,60,120].map(function seconds(value){return automationOption(String(value),value+' seconds',settings.auto_actions_run_interval_seconds||'15');}).join('') + '</select></label>' +
          '<label class="authorization-check span-2"><input id="automation-user-consent" type="checkbox"> I authorize Nexa to perform only the actions enabled below. I understand every automatic action is logged and can be stopped immediately.</label>' +
        '</div>' +
        '<div class="button-row"><button class="primary-button" type="submit" data-nexa-action="automation-save">Save authorization</button><button class="secondary-button" type="button" id="automation-run-now" data-nexa-action="automation-run-now"' + (!enabledMaster ? ' disabled' : '') + '>Run authorized actions now</button><button class="danger-button" type="button" id="automation-pause" data-nexa-action="automation-pause">Emergency pause</button></div>' +
      '</article>' +
      '<article class="panel-card"><div class="panel-header"><div><p class="eyebrow">AUTOMATIC MESSAGES</p><h3>Customer reply parameters</h3><p>Knowledge Library first. External AI fallback is a separate opt-in.</p></div>' + badge(String(summary.messages_sent || 0) + ' sent', 'info') + '</div>' +
        '<div class="automation-grid">' +
          '<label>Automatic message sending<select name="auto_messages_enabled">' + automationOption('0','Disabled',settings.auto_messages_enabled) + automationOption('1','Enabled',settings.auto_messages_enabled) + '</select></label>' +
          '<label>Response engine<select name="auto_messages_knowledge_only">' + automationOption('1','Knowledge Library only',settings.auto_messages_knowledge_only) + automationOption('0','Knowledge + authorized AI fallback',settings.auto_messages_knowledge_only) + '</select></label>' +
          '<label>External AI fallback<select name="auto_messages_ai_fallback">' + automationOption('0','Disabled',settings.auto_messages_ai_fallback) + automationOption('1','Enabled',settings.auto_messages_ai_fallback) + '</select></label>' +
          '<label>Minimum local confidence<input name="auto_messages_min_confidence" type="number" min="0.72" max="1" step="0.01" value="' + esc(settings.auto_messages_min_confidence || '0.88') + '"></label>' +
          '<label>Delay before sending<input name="auto_messages_send_delay_seconds" type="number" min="0" max="3600" value="' + esc(settings.auto_messages_send_delay_seconds || '20') + '"><small>Seconds after the latest customer message.</small></label>' +
          '<label>Hourly limit<input name="auto_messages_max_per_hour" type="number" min="1" max="100" value="' + esc(settings.auto_messages_max_per_hour || '12') + '"></label>' +
          '<label>Daily limit<input name="auto_messages_max_per_day" type="number" min="1" max="1000" value="' + esc(settings.auto_messages_max_per_day || '60') + '"></label>' +
          '<label>Require unread message<select name="auto_messages_require_unread">' + automationOption('1','Yes',settings.auto_messages_require_unread) + automationOption('0','No',settings.auto_messages_require_unread) + '</select></label>' +
          '<label>Mark answered thread read<select name="auto_messages_mark_read">' + automationOption('1','Yes',settings.auto_messages_mark_read) + automationOption('0','No',settings.auto_messages_mark_read) + '</select></label>' +
          '<label>Quiet hours start<input name="auto_messages_quiet_start" type="time" value="' + esc(settings.auto_messages_quiet_start || '22:00') + '"></label>' +
          '<label>Quiet hours end<input name="auto_messages_quiet_end" type="time" value="' + esc(settings.auto_messages_quiet_end || '07:00') + '"></label>' +
          '<label>Allowed languages<input name="auto_messages_languages" value="' + esc(settings.auto_messages_languages || 'en,es') + '"><small>Comma separated.</small></label>' +
          '<label class="span-2">Never answer automatically<input name="auto_messages_excluded_intents" value="' + esc(settings.auto_messages_excluded_intents || '') + '"><small>Financing approvals, legal issues, emergencies, complaints and payment/refund disputes remain human-review only.</small></label>' +
        '</div>' +
      '</article>' +
      '<article class="panel-card"><div class="panel-header"><div><p class="eyebrow">AUTOMATIC APPOINTMENTS</p><h3>Dealer Appointment Availability</h3><p>Nexa reads verified slots from the website and creates calendar appointments only when the customer selects an available date and time.</p></div>' + badge(String(availability.length) + ' slots loaded', availability.length ? 'success' : 'warning') + '</div>' +
        '<div class="automation-grid">' +
          '<label>Automatic appointment creation<select name="auto_appointments_enabled">' + automationOption('0','Disabled',settings.auto_appointments_enabled) + automationOption('1','Enabled',settings.auto_appointments_enabled) + '</select></label>' +
          '<label>Availability source<input name="auto_appointments_source" value="dealer-appointment-availability" readonly></label>' +
          '<label>Offer open slots<select name="auto_appointments_offer_slots">' + automationOption('1','Yes',settings.auto_appointments_offer_slots) + automationOption('0','No',settings.auto_appointments_offer_slots) + '</select></label>' +
          '<label>Default duration<input name="auto_appointments_duration_minutes" type="number" min="10" max="480" value="' + esc(settings.auto_appointments_duration_minutes || '30') + '"><small>Minutes.</small></label>' +
          '<label>Minimum notice<input name="auto_appointments_min_notice_hours" type="number" min="0" max="168" value="' + esc(settings.auto_appointments_min_notice_hours || '2') + '"><small>Hours.</small></label>' +
          '<label>Maximum booking window<input name="auto_appointments_max_days" type="number" min="1" max="365" value="' + esc(settings.auto_appointments_max_days || '60') + '"><small>Days.</small></label>' +
          '<label>Require customer identity<select name="auto_appointments_require_contact">' + automationOption('1','Yes',settings.auto_appointments_require_contact) + automationOption('0','No',settings.auto_appointments_require_contact) + '</select></label>' +
          '<label>Create appointment on website<select name="auto_appointments_create_remote">' + automationOption('0','Local calendar only',settings.auto_appointments_create_remote) + automationOption('1','Website + local calendar when API permits',settings.auto_appointments_create_remote) + '</select></label>' +
          '<label>Send confirmation<select name="auto_appointments_send_confirmation">' + automationOption('1','Yes, when automatic messages are authorized',settings.auto_appointments_send_confirmation) + automationOption('0','No',settings.auto_appointments_send_confirmation) + '</select></label>' +
          '<label>Availability limit<input name="auto_appointments_slot_limit" type="number" min="1" max="100" value="' + esc(settings.auto_appointments_slot_limit || '50') + '"></label>' +
        '</div>' +
        '<div class="availability-preview">' + (availability.slice(0,8).map(function slotPreview(slot){return '<div><strong>' + esc(slot.appointment_date || slot.date || formatDate(slot.start_at)) + '</strong><span>' + esc(slot.start_time || slot.appointment_time || '') + '</span><small>' + esc(slot.location || slot.address || 'Dealer location') + '</small></div>';}).join('') || '<p>No availability has been synchronized yet. Nexa will read Dealer Appointment Availability during the next authorized cycle.</p>') + '</div>' +
      '</article>' +
      '<article class="panel-card autonomy-boundaries"><div class="panel-header"><div><p class="eyebrow">HARD BOUNDARIES</p><h3>Rules that cannot be disabled</h3></div>' + badge('Protected', 'success') + '</div><div class="boundary-grid"><div><b>Customer records</b><span>Nexa never edits contacts, leads, orders, reseller records or customer profiles automatically.</span></div><div><b>No deletion</b><span>Automatic actions have no delete operation and cannot erase messages, appointments, records or files.</span></div><div><b>Read-only announcements</b><span>Admin announcements and threads without reply permission are never answered.</span></div><div><b>Full audit trail</b><span>Every automatic send, appointment, blocked action and failure is recorded locally.</span></div></div></article>' +
      '<article class="panel-card automation-history"><div class="panel-header"><div><p class="eyebrow">ACTION HISTORY</p><h3>Authorized automation audit</h3><p>' + esc(summary.total || 0) + ' total · ' + esc(summary.completed || 0) + ' completed · ' + esc(summary.failed || 0) + ' failed</p></div></div><div class="table-wrap"><table><thead><tr><th>Time</th><th>Action</th><th>Status</th><th>Engine</th><th>Confidence</th><th>Summary</th></tr></thead><tbody>' + rows + '</tbody></table></div>' + renderPagination(page,'automatic-actions','automatic actions') + '</article>' +
    '</form>';
}

function renderAbout() {
  const automation = state.automation || {};
  const autoSettings = automation.settings || state.settings || {};
  const active = String(autoSettings.auto_actions_enabled || '0') === '1';
  return sectionHeader('About', 'A local-first business assistant with user-controlled guarded autonomy.') +
    '<div class="grid split-grid">' +
      '<article class="panel-card"><p class="eyebrow">PRODUCT</p><h2>Nexa Smart Office Bot</h2><p class="muted">Version ' + esc(state.meta && state.meta.version ? state.meta.version : '1.0.0') + '</p><p>Connected messages, automotive knowledge, contacts, leads, calendar, tasks, alerts, backups and controlled AI actions in one Windows desktop application.</p></article>' +
      '<article class="panel-card"><p class="eyebrow">PRIVACY</p><h3>Your business data stays local</h3><p class="muted">The SQLite workspace, automation audit and backups are stored on this computer. External AI receives only the minimum safe context when the user enables fallback.</p></article>' +
      '<article class="panel-card"><p class="eyebrow">AI CONTROL</p><h3>Guarded automatic actions · ' + (active ? 'Enabled' : 'Disabled') + '</h3><p class="muted">With explicit authorization, Nexa may send messages and create appointments from verified dealer availability. It never changes customer records and has no automatic delete capability.</p><div class="button-row">' + badge(String(autoSettings.auto_messages_enabled || '0') === '1' ? 'Messages authorized' : 'Messages manual', String(autoSettings.auto_messages_enabled || '0') === '1' ? 'success' : 'warning') + badge(String(autoSettings.auto_appointments_enabled || '0') === '1' ? 'Appointments authorized' : 'Appointments manual', String(autoSettings.auto_appointments_enabled || '0') === '1' ? 'success' : 'warning') + '</div></article>' +
      '<article class="panel-card"><p class="eyebrow">SAFETY BOUNDARIES</p><h3>Human-owned business records</h3><p class="muted">Contacts, leads, orders, reseller records and customer profiles remain read-only to automation. Sensitive, legal, financial and dispute messages are escalated for human review.</p></article>' +
      '<article class="panel-card"><p class="eyebrow">DATA LOCATION</p><h3>Local application data</h3><p class="muted">' + esc(state.meta && state.meta.dataPath ? state.meta.dataPath : 'Available after application startup') + '</p></article>' +
    '</div>';
}

function field(name, label, value, options) {
  const settings = options || {};
  const className = settings.full ? 'span-2' : '';
  if (settings.type === 'textarea') return '<label class="' + className + '">' + esc(label) + '<textarea name="' + esc(name) + '">' + esc(value || '') + '</textarea></label>';
  if (settings.type === 'select') {
    const choices = (settings.items || []).map(function renderOption(item) {
      const selected = String(value || '') === String(item[0]) ? ' selected' : '';
      return '<option value="' + esc(item[0]) + '"' + selected + '>' + esc(item[1]) + '</option>';
    }).join('');
    return '<label class="' + className + '">' + esc(label) + '<select name="' + esc(name) + '">' + choices + '</select></label>';
  }
  const step = settings.step ? ' step="' + esc(settings.step) + '"' : '';
  return '<label class="' + className + '">' + esc(label) + '<input name="' + esc(name) + '" type="' + esc(settings.type || 'text') + '" value="' + esc(value || '') + '"' + step + '></label>';
}

function openEntity(type, record) {
  const current = record || {};
  entityForm.dataset.type = type;
  entityForm.dataset.id = current.id || '';
  dialogEyebrow.textContent = type.toUpperCase();
  dialogTitle.textContent = (current.id ? 'Edit ' : 'New ') + type;
  let html = '';
  if (type === 'contact') {
    html = field('name', 'Name', current.name) + field('company', 'Company', current.company) + field('phone', 'Phone', current.phone) + field('email', 'Email', current.email, { type: 'email' }) + field('tags', 'Tags', current.tags, { full: true }) + field('notes', 'Notes', current.notes, { type: 'textarea', full: true });
  }
  if (type === 'lead') {
    const contacts = [['', 'None']].concat(state.contacts.map(function contactOption(item) { return [item.id, item.name]; }));
    const statuses = ['New', 'Contacted', 'Interested', 'Follow-up', 'Qualified', 'Won', 'Lost'].map(function statusOption(item) { return [item, item]; });
    const priorities = ['Low', 'Medium', 'High'].map(function priorityOption(item) { return [item, item]; });
    html = field('name', 'Lead name', current.name) + field('company', 'Company', current.company) + field('phone', 'Phone', current.phone) + field('email', 'Email', current.email, { type: 'email' }) + field('contact_id', 'Related contact', current.contact_id, { type: 'select', items: contacts }) + field('source', 'Source', current.source) + field('status', 'Status', current.status || 'New', { type: 'select', items: statuses }) + field('priority', 'Priority', current.priority || 'Medium', { type: 'select', items: priorities }) + field('estimated_value', 'Estimated value', current.estimated_value || 0, { type: 'number', step: '0.01' }) + field('next_follow_up', 'Next follow-up', inputDateTime(current.next_follow_up), { type: 'datetime-local' }) + field('notes', 'Notes', current.notes, { type: 'textarea', full: true });
  }
  if (type === 'task') {
    const priorities = ['Low', 'Medium', 'High'].map(function priorityOption(item) { return [item, item]; });
    const statuses = ['Pending', 'Completed', 'Canceled'].map(function statusOption(item) { return [item, item]; });
    html = field('title', 'Task title', current.title, { full: true }) + field('due_at', 'Due date', inputDateTime(current.due_at), { type: 'datetime-local' }) + field('reminder_at', 'Reminder', inputDateTime(current.reminder_at), { type: 'datetime-local' }) + field('priority', 'Priority', current.priority || 'Medium', { type: 'select', items: priorities }) + field('status', 'Status', current.status || 'Pending', { type: 'select', items: statuses }) + field('description', 'Description', current.description, { type: 'textarea', full: true });
  }
  if (type === 'appointment') {
    const contacts = [['', 'None']].concat(state.contacts.map(function contactOption(item) { return [item.id, item.name]; }));
    const leads = [['', 'None']].concat(state.leads.map(function leadOption(item) { return [item.id, item.name]; }));
    const statuses = ['Scheduled', 'Completed', 'Canceled'].map(function statusOption(item) { return [item, item]; });
    html = field('title', 'Title', current.title, { full: true }) + field('start_at', 'Starts', inputDateTime(current.start_at), { type: 'datetime-local' }) + field('end_at', 'Ends', inputDateTime(current.end_at), { type: 'datetime-local' }) + field('reminder_at', 'Reminder', inputDateTime(current.reminder_at), { type: 'datetime-local' }) + field('status', 'Status', current.status || 'Scheduled', { type: 'select', items: statuses }) + field('contact_id', 'Contact', current.contact_id, { type: 'select', items: contacts }) + field('lead_id', 'Lead', current.lead_id, { type: 'select', items: leads }) + field('description', 'Description', current.description, { type: 'textarea', full: true });
  }
  if (type === 'reminder') {
    const relatedTypes = ['general', 'contact', 'lead', 'task', 'appointment'].map(function relatedOption(item) { return [item, item]; });
    html = field('title', 'Reminder title', current.title, { full: true }) + field('remind_at', 'Remind at', inputDateTime(current.remind_at), { type: 'datetime-local' }) + field('entity_type', 'Related type', current.entity_type || 'general', { type: 'select', items: relatedTypes });
  }
  dialogFields.innerHTML = html;
  entityDialog.showModal();
}

async function submitEntity(event) {
  event.preventDefault();
  const type = entityForm.dataset.type;
  const data = Object.fromEntries(new FormData(entityForm).entries());
  if (entityForm.dataset.id) data.id = entityForm.dataset.id;
  ['due_at', 'reminder_at', 'next_follow_up', 'start_at', 'end_at', 'remind_at'].forEach(function convertDate(key) {
    if (Object.prototype.hasOwnProperty.call(data, key)) data[key] = toIso(data[key]);
  });
  if (type === 'contact') await (data.id ? api.contacts.update(data) : api.contacts.create(data));
  if (type === 'lead') await (data.id ? api.leads.update(data) : api.leads.create(data));
  if (type === 'task') await (data.id ? api.tasks.update(data) : api.tasks.create(data));
  if (type === 'appointment') await (data.id ? api.appointments.update(data) : api.appointments.create(data));
  if (type === 'reminder') await api.reminders.create(data);
  entityDialog.close();
  toast(type.slice(0, 1).toUpperCase() + type.slice(1) + ' saved.');
  await refreshAll();
}


async function loadMessageThread(threadId, silent) {
  const activeComposer=document.getElementById('message-composer');
  const userEditing=Boolean(activeComposer&&document.activeElement===activeComposer);
  if(activeComposer)state.messageDraft=activeComposer.value;
  const wanted=String(threadId||'').trim();
  if(!wanted)return;
  state.messageThreadId=wanted;
  state.messageBusy=true;
  state.messageError='';
  if(!silent)renderView();
  try {
    const result=await api.messages.refresh(wanted,{limit:160});
    state.messageConversation=result.conversation||null;
    const latestDraft=state.messageConversation&&Array.isArray(state.messageConversation.drafts)?state.messageConversation.drafts[0]:null;
    if(!silent&&latestDraft&&latestDraft.status==='draft'&&!state.messageDraft){state.messageDraft=latestDraft.body||'';state.messageDraftMeta={engine:latestDraft.source,confidence:latestDraft.confidence,draft_id:latestDraft.id};}
  } catch(error) {
    state.messageError=error.message;
    try { state.messageConversation=await api.messages.thread(wanted,160); } catch(localError) { void localError; }
    if(!silent)toast(error.message,'error');
  } finally {
    state.messageBusy=false;
    if(state.view==='messages'&&!(silent&&userEditing))renderView();
  }
}

async function prepareMessageReply() {
  if(!state.messageThreadId)return;
  const provider=state.settings&&state.settings.preferred_provider||'openai';
  state.messageBusy=true;
  state.messageError='';
  renderView();
  try {
    const result=await api.messages.draft({thread_id:state.messageThreadId,provider:provider,focus:'Reply to the latest customer message using the complete conversation. Keep the reply concise and professional.'});
    state.messageDraft=result.draft&&result.draft.body||'';
    state.messageDraftMeta={engine:result.engine,confidence:result.confidence||0,draft_id:result.draft&&result.draft.id,provider:result.provider||null,label:result.label||'',category:result.category||'',safety_level:result.safety_level||'',built_in:Boolean(result.built_in),library_version:result.library_version||''};
    toast(result.engine==='knowledge'?'Reply prepared from approved knowledge.':'Reply prepared with '+String(result.provider||'AI')+'.');
  } catch(error) { state.messageError=error.message; toast(error.message,'error'); }
  finally { state.messageBusy=false; if(state.view==='messages')renderView(); }
}

async function sendMessageReply() {
  const composer=document.getElementById('message-composer');
  const body=String(composer&&composer.value||state.messageDraft||'').trim();
  if(!body){toast('Write or prepare a reply first.','error');return;}
  const confirmed=await confirmAction('Send website reply','Send this reply to the customer now? Nexa will not send anything without this confirmation.');
  if(!confirmed)return;
  const latest=latestInboundMessage();
  state.messageBusy=true;renderView();
  try {
    const result=await api.messages.send({thread_id:state.messageThreadId,body:body,user_confirmed:true,draft_id:state.messageDraftMeta&&state.messageDraftMeta.draft_id||null,teach:Boolean(document.getElementById('message-teach-after-send')&&document.getElementById('message-teach-after-send').checked),trigger_text:latest&&latest.body||'',knowledge_label:'Approved reply for '+String(selectedMessageThread()&&selectedMessageThread().subject||'customer conversation')});
    state.messageConversation=result.conversation||state.messageConversation;
    state.messageDraft='';state.messageDraftMeta=null;
    const refreshedKnowledge=await Promise.all([api.messages.knowledgeList(''),api.messages.knowledgeSummary()]);state.messageKnowledge=refreshedKnowledge[0];state.knowledgeSummary=refreshedKnowledge[1];
    toast('Reply sent after user approval.');
  } catch(error) { toast(error.message,'error'); }
  finally { state.messageBusy=false; if(state.view==='messages')renderView(); }
}

async function markCurrentMessageRead() {
  if(!state.messageThreadId)return;
  const rows=state.messageConversation&&Array.isArray(state.messageConversation.messages)?state.messageConversation.messages:[];
  const last=rows.length?rows[rows.length-1]:null;
  try { await api.messages.markRead(state.messageThreadId,last&&last.message_id||null); toast('Conversation marked as read.'); await api.integration.sync(); await refreshAll(); }
  catch(error){toast(error.message,'error');}
}

async function saveMessageKnowledgeForm() {
  const label=document.getElementById('knowledge-label');
  const category=document.getElementById('knowledge-category');
  const triggers=document.getElementById('knowledge-triggers');
  const response=document.getElementById('knowledge-response');
  try {
    await api.messages.knowledgeSave({label:label&&label.value,category:category&&category.value,triggers:triggers&&triggers.value,response:response&&response.value,enabled:true});
    const refreshed=await Promise.all([api.messages.knowledgeList(''),api.messages.knowledgeSummary()]);state.messageKnowledge=refreshed[0];state.knowledgeSummary=refreshed[1];
    toast('Approved response knowledge saved.');renderView();
  } catch(error){toast(error.message,'error');}
}

async function saveMessageSettings() {
  const enabled=document.getElementById('message-realtime-enabled');
  const seconds=document.getElementById('message-poll-seconds');
  state.settings=await api.settings.save({message_realtime_enabled:enabled&&enabled.checked?'1':'0',message_poll_seconds:seconds&&seconds.value||'5'});
  toast('Message assistant settings saved.');renderView();
}

async function pollActiveMessageThread() {
  if(state.messagePollBusy||state.view!=='messages'||state.messageTab!=='inbox'||!state.messageThreadId)return;
  if(String(state.settings&&state.settings.message_realtime_enabled||'1')!=='1')return;
  const seconds=Math.min(Math.max(Number(state.settings&&state.settings.message_poll_seconds||5),3),60);
  if(Date.now()-Number(state.messageLastPollAt||0)<seconds*1000)return;
  state.messageLastPollAt=Date.now();
  state.messagePollBusy=true;
  try { await loadMessageThread(state.messageThreadId,true); }
  finally { state.messagePollBusy=false; }
}

function populateAIRelated() {
  const typeElement = document.getElementById('ai-related-type');
  const select = document.getElementById('ai-related-id');
  if (!typeElement || !select) return;
  const type = typeElement.value;
  let collection = [];
  if (type === 'lead') collection = state.leads;
  if (type === 'contact') collection = state.contacts;
  if (type === 'task') collection = state.tasks;
  if (type === 'appointment') collection = state.appointments;
  if (type === 'message') collection = integrationRemote('messages').map(function messageOption(item,index){ return { id:remoteItemId('messages',item,index), name:item.subject || 'Conversation', title:item.subject || 'Conversation' }; });
  if (type === 'order') collection = integrationRemote('orders').concat(integrationRemote('reseller-appointments')).map(function orderOption(item,index){ return { id:remoteItemId(item.__resource || (item.order_id ? 'orders' : 'reseller-appointments'),item,index), name:item.customer_name || item.listing_title || 'Connected order', title:item.customer_name || item.listing_title || 'Connected order' }; });
  select.innerHTML = '<option value="">None selected</option>' + collection.map(function option(item) {
    return '<option value="' + esc(item.id) + '">' + esc(item.name || item.title) + '</option>';
  }).join('');
  if (state.aiPrefill && state.aiPrefill.type === type) select.value = state.aiPrefill.id;
}

async function generateAI() {
  const provider = document.getElementById('ai-provider').value;
  const providerState = state.settings && state.settings.secrets ? state.settings.secrets[provider] : null;
  const kind = document.getElementById('ai-kind').value;
  if (kind !== 'live_message_reply' && (!providerState || !providerState.configured)) {
    toast('AI provider not configured', 'error');
    navigate('settings');
    return;
  }
  const requestId = crypto.randomUUID();
  state.activeAIRequest = requestId;
  document.getElementById('ai-status').textContent = 'Waiting for the selected AI provider…';
  document.getElementById('ai-generate').disabled = true;
  document.getElementById('ai-cancel').disabled = false;
  try {
    const relatedType = document.getElementById('ai-related-type').value;
    const relatedId = document.getElementById('ai-related-id').value;
    let result;
    if (kind === 'live_message_reply') {
      if (relatedType !== 'message' || !relatedId) throw new Error('Select a website message thread for a live reply.');
      result = await api.messages.draft({ request_id: requestId, provider: provider, thread_id: relatedId, focus: document.getElementById('ai-focus').value });
      state.aiResult = result.draft.body;
      state.messageThreadId = relatedId;
      state.messageDraft = result.draft.body;
      state.messageDraftMeta = { engine: result.engine, confidence: result.confidence || 0, draft_id: result.draft.id, provider: result.provider || null };
      toast(result.engine === 'knowledge' ? 'Reply prepared from approved knowledge.' : 'Live reply prepared with AI.');
    } else {
      result = await api.ai.generate({ request_id: requestId, provider: provider, kind: kind, related_type: relatedType, related_id: relatedId, focus: document.getElementById('ai-focus').value });
      state.aiResult = result.suggestion.response;
      toast('Suggestion generated.');
    }
    await refreshAll({ render: false });
  } catch (error) {
    toast(error.message, 'error');
  } finally {
    state.activeAIRequest = null;
    renderView();
  }
}

async function saveAiResult(preferredChoice) {
  if (!state.aiResult) {
    toast('Generate a suggestion first.', 'error');
    return;
  }
  aiSaveDialog.showModal();
  const choice = await new Promise(function waitForAiChoice(resolve) {
    aiSaveDialog.addEventListener('close', function aiDialogClosed() {
      resolve(aiSaveDialog.returnValue || preferredChoice || 'cancel');
    }, { once: true });
  });
  if (choice === 'task') {
    await api.ai.saveTask({ title: 'AI suggested action', description: state.aiResult, suggestion: state.aiResult });
    toast('Suggestion saved as a task.');
    await refreshAll();
  }
  if (choice === 'note') {
    await api.ai.saveNote({ note: state.aiResult, suggestion: state.aiResult });
    toast('Suggestion saved as a note in Activity.');
    await refreshAll();
  }
}

function bindDeletes(type, collection, deleter) {
  document.querySelectorAll('[data-nexa-action="' + type + '-delete"]').forEach(function bindDelete(button) {
    button.addEventListener('click', async function deleteRecord() {
      const recordId = button.dataset.recordId;
      const record = collection.find(function findRecord(item) { return item.id === recordId; });
      const label = record && (record.name || record.title) ? (record.name || record.title) : type;
      const confirmed = await confirmAction('Delete ' + type, 'Delete “' + label + '”? This action cannot be undone.');
      if (!confirmed) return;
      await deleter(recordId);
      toast(type.slice(0, 1).toUpperCase() + type.slice(1) + ' deleted.');
      await refreshAll();
    });
  });
}

function bindViewEvents() {
  document.querySelectorAll('[data-go]').forEach(function bindGo(element) {
    element.addEventListener('click', function navigateFromButton() { navigate(element.dataset.go); });
  });
  const search = document.getElementById('view-search');
  if (search) {
    search.addEventListener('input', function searchRecords(event) {
      state.search = event.target.value;
      state.pages = {};
      renderView();
      const nextSearch = document.getElementById('view-search');
      if (nextSearch) nextSearch.focus();
    });
  }


  document.querySelectorAll('[data-page-key]').forEach(function bindPagination(button) {
    button.addEventListener('click', function changePage() {
      if (button.disabled) return;
      state.pages[button.dataset.pageKey] = Math.max(1, Number(button.dataset.page || 1));
      renderView();
      content.scrollTo({ top: 0, behavior: 'smooth' });
    });
  });
  document.querySelectorAll('[data-nexa-action="connected-detail"]').forEach(function bindConnectedDetail(button) {
    button.addEventListener('click', function showDetail() { openConnectedDetail(button.dataset.resource, button.dataset.itemId); });
  });
  document.querySelectorAll('[data-nexa-action="connected-ai"]').forEach(function bindConnectedAi(button) {
    button.addEventListener('click', function askAi() {
      const type=button.dataset.relatedType || (button.dataset.resource==='messages'?'message':'order');
      const kind=type==='message'?'live_message_reply':'order_follow_up';
      setAiPrefill(type,button.dataset.itemId,kind,type==='message'?'Review this website conversation and suggest the safest useful response or next action.':'Review this website lead and recommend the next follow-up action.');
    });
  });
  document.querySelectorAll('[data-nexa-action="message-thread-open"]').forEach(function bindMessageThread(button) {
    button.addEventListener('click', function openMessageThread() { state.messageDraft=''; state.messageDraftMeta=null; loadMessageThread(button.dataset.threadId,false); });
  });
  const messageRefresh=document.querySelector('[data-nexa-action="message-thread-refresh"]');
  if(messageRefresh)messageRefresh.addEventListener('click',function refreshMessageThread(){loadMessageThread(state.messageThreadId,false);});
  const messagePrepare=document.querySelector('[data-nexa-action="message-prepare-reply"]');
  if(messagePrepare)messagePrepare.addEventListener('click',prepareMessageReply);
  const messageSend=document.querySelector('[data-nexa-action="message-send-reply"]');
  if(messageSend)messageSend.addEventListener('click',sendMessageReply);
  const messageMarkRead=document.querySelector('[data-nexa-action="message-mark-read"]');
  if(messageMarkRead)messageMarkRead.addEventListener('click',markCurrentMessageRead);
  const messageOpenAi=document.querySelector('[data-nexa-action="message-open-ai"]');
  if(messageOpenAi)messageOpenAi.addEventListener('click',function openMessageInAi(){setAiPrefill('message',state.messageThreadId,'live_message_reply','Prepare a customer-facing reply from the complete conversation.');});
  const messageSettingsSave=document.querySelector('[data-nexa-action="message-settings-save"]');
  if(messageSettingsSave)messageSettingsSave.addEventListener('click',saveMessageSettings);
  const messageComposer=document.getElementById('message-composer');
  if(messageComposer)messageComposer.addEventListener('input',function preserveDraft(){state.messageDraft=messageComposer.value;});
  const conversationScroll=document.getElementById('conversation-scroll');
  if(conversationScroll&&!(messageComposer&&messageComposer.matches(':focus')))conversationScroll.scrollTop=conversationScroll.scrollHeight;
  document.querySelectorAll('[data-nexa-action="message-tab-inbox"]').forEach(function bindInbox(button){button.addEventListener('click',function(){state.messageTab='inbox';state.search='';renderView();});});
  document.querySelectorAll('[data-nexa-action="message-tab-knowledge"]').forEach(function bindKnowledge(button){button.addEventListener('click',function(){state.messageTab='knowledge';state.search='';renderView();});});
  const knowledgeSave=document.querySelector('[data-nexa-action="message-knowledge-save"]');
  if(knowledgeSave)knowledgeSave.addEventListener('click',saveMessageKnowledgeForm);
  document.querySelectorAll('[data-nexa-action="message-knowledge-toggle"]').forEach(function bindKnowledgeToggle(button){button.addEventListener('click',async function(){await api.messages.knowledgeToggle(button.dataset.knowledgeId,Number(button.dataset.enabled)===1);const refreshed=await Promise.all([api.messages.knowledgeList(''),api.messages.knowledgeSummary()]);state.messageKnowledge=refreshed[0];state.knowledgeSummary=refreshed[1];toast(Number(button.dataset.enabled)===1?'Built-in knowledge enabled.':'Built-in knowledge disabled.');renderView();});});
  document.querySelectorAll('[data-nexa-action="message-knowledge-delete"]').forEach(function bindKnowledgeDelete(button){button.addEventListener('click',async function(){const confirmed=await confirmAction('Delete approved response','Remove this custom knowledge record from the local response engine?');if(!confirmed)return;await api.messages.knowledgeDelete(button.dataset.knowledgeId);const refreshed=await Promise.all([api.messages.knowledgeList(''),api.messages.knowledgeSummary()]);state.messageKnowledge=refreshed[0];state.knowledgeSummary=refreshed[1];toast('Knowledge record deleted.');renderView();});});
  if(state.view==='messages'&&state.messageTab==='inbox'&&!state.messageThreadId){const first=integrationRemote('messages')[0];if(first)setTimeout(function autoOpenFirst(){if(state.view==='messages'&&!state.messageThreadId)loadMessageThread(remoteItemId('messages',first,0),false);},0);}
  document.querySelectorAll('[data-nexa-action="agenda-prev"],[data-nexa-action="agenda-next"],[data-nexa-action="agenda-today"],[data-nexa-action="agenda-month"],[data-nexa-action="agenda-week"]').forEach(function bindAgendaControl(button) {
    button.addEventListener('click', function controlAgenda() {
      const action=button.dataset.nexaAction; const anchor=toValidDate(state.agendaAnchor)||new Date();
      if(action==='agenda-today') state.agendaAnchor=new Date().toISOString();
      if(action==='agenda-month') state.agendaMode='month';
      if(action==='agenda-week') state.agendaMode='week';
      if(action==='agenda-prev'){ if(state.agendaMode==='month') anchor.setMonth(anchor.getMonth()-1); else anchor.setDate(anchor.getDate()-7); state.agendaAnchor=anchor.toISOString(); }
      if(action==='agenda-next'){ if(state.agendaMode==='month') anchor.setMonth(anchor.getMonth()+1); else anchor.setDate(anchor.getDate()+7); state.agendaAnchor=anchor.toISOString(); }
      renderView();
    });
  });
  document.querySelectorAll('[data-nexa-action="agenda-day-focus"]').forEach(function bindAgendaDay(button) {
    button.addEventListener('click', function focusDay(){ state.agendaMode='week'; state.agendaAnchor=new Date(button.dataset.day+'T12:00:00').toISOString(); renderView(); });
  });

  document.querySelectorAll('[data-nexa-action]').forEach(function bindAction(element) {
    const action = element.getAttribute('data-nexa-action');
    if (element.dataset.nexaBound === '1') return;
    element.dataset.nexaBound = '1';
    if (action === 'contact-create') element.addEventListener('click', function createContact() { openEntity('contact'); });
    if (action === 'lead-create') element.addEventListener('click', function createLead() { openEntity('lead'); });
    if (action === 'task-create') element.addEventListener('click', function createTask() { openEntity('task'); });
    if (action === 'appointment-create') element.addEventListener('click', function createAppointment() { openEntity('appointment'); });
    if (action === 'reminder-create') element.addEventListener('click', function createReminder() { openEntity('reminder'); });
    if (action === 'contact-edit') element.addEventListener('click', function editContact() { openEntity('contact', state.contacts.find(function findRecord(item) { return item.id === element.dataset.recordId; })); });
    if (action === 'lead-edit') element.addEventListener('click', function editLead() { openEntity('lead', state.leads.find(function findRecord(item) { return item.id === element.dataset.recordId; })); });
    if (action === 'task-edit') element.addEventListener('click', function editTask() { openEntity('task', state.tasks.find(function findRecord(item) { return item.id === element.dataset.recordId; })); });
    if (action === 'appointment-edit') element.addEventListener('click', function editAppointment() { openEntity('appointment', state.appointments.find(function findRecord(item) { return item.id === element.dataset.recordId; })); });
    if (action === 'task-complete') element.addEventListener('change', async function completeTask() { await api.tasks.complete(element.dataset.recordId); await refreshAll(); });
    if (action === 'appointment-complete') element.addEventListener('click', async function completeAppointment() { await api.appointments.complete(element.dataset.recordId); await refreshAll(); });
    if (action === 'reminder-toggle') element.addEventListener('click', async function toggleReminder() { await api.reminders.toggle(element.dataset.recordId); await refreshAll(); });
    if (action === 'alert-refresh') element.addEventListener('click', async function refreshAlerts() { await refreshAll(); toast('Alerts refreshed.'); });
    if (action === 'ai-generate' && element.dataset.aiLead) element.addEventListener('click', function suggestLead() {
      navigate('ai');
      setTimeout(function selectLead() {
        document.getElementById('ai-kind').value = 'lead_next_step';
        document.getElementById('ai-related-type').value = 'lead';
        populateAIRelated();
        document.getElementById('ai-related-id').value = element.dataset.aiLead;
      }, 0);
    });
  });

  bindDeletes('contact', state.contacts, api.contacts.delete);
  bindDeletes('lead', state.leads, api.leads.delete);
  bindDeletes('task', state.tasks, api.tasks.delete);
  bindDeletes('appointment', state.appointments, api.appointments.delete);

  if (state.view === 'ai') {
    document.getElementById('ai-related-type').addEventListener('change', populateAIRelated);
    if (state.aiPrefill) { document.getElementById('ai-kind').value = state.aiPrefill.kind || 'daily_priorities'; document.getElementById('ai-related-type').value = state.aiPrefill.type || ''; }
    populateAIRelated();
    document.getElementById('ai-provider').addEventListener('change', function selectProvider(event) { api.ai.selectProvider(event.target.value); });
    document.getElementById('ai-generate').addEventListener('click', generateAI);
    document.getElementById('ai-cancel').addEventListener('click', async function cancelAI() { if (state.activeAIRequest) await api.ai.cancel(state.activeAIRequest); });
    document.querySelectorAll('[data-show-suggestion]').forEach(function bindSuggestion(element) {
      element.addEventListener('click', function showSuggestion() {
        const suggestion = state.suggestions.find(function findSuggestion(item) { return item.id === element.dataset.showSuggestion; });
        state.aiResult = suggestion ? suggestion.response : '';
        renderView();
      });
    });
    document.getElementById('ai-save-note').addEventListener('click', function saveNote() { saveAiResult('note'); });
    document.getElementById('ai-save-task').addEventListener('click', function saveTask() { saveAiResult('task'); });
  }

  const automationForm = document.getElementById('automation-form');
  if (automationForm) {
    automationForm.addEventListener('submit', async function saveAutomation(event) {
      event.preventDefault();
      const data = Object.fromEntries(new FormData(automationForm).entries());
      const userAuthorized = Boolean(document.getElementById('automation-user-consent') && document.getElementById('automation-user-consent').checked);
      if (String(data.auto_actions_enabled || '0') === '1') {
        const confirmed = await confirmAction('Authorize guarded automatic actions', 'Nexa will be permitted to send messages and/or create appointments only according to the parameters shown. Customer records remain read-only and no automatic delete operation exists.');
        if (!confirmed) return;
      }
      try {
        const saved = await api.automation.save(data, userAuthorized);
        state.automation = saved;
        state.settings = saved.settings || state.settings;
        toast(String(data.auto_actions_enabled || '0') === '1' ? 'AI Control authorization saved.' : 'Automatic actions disabled.');
        await refreshAll();
      } catch (error) { toast(error.message, 'error'); }
    });
    const runNow = document.getElementById('automation-run-now');
    if (runNow) runNow.addEventListener('click', async function runAutomation() {
      try {
        runNow.disabled = true;
        runNow.textContent = 'Running authorized actions…';
        const result = await api.automation.runNow();
        if (result.skipped) toast('Automatic cycle skipped: ' + String(result.reason || 'not ready') + '.', 'error');
        else toast('Automatic cycle complete: ' + String(result.messages_sent || 0) + ' messages, ' + String(result.appointments_created || 0) + ' appointments.');
        await refreshAll();
      } catch (error) { toast(error.message, 'error'); }
      finally { runNow.disabled = false; runNow.textContent = 'Run authorized actions now'; }
    });
    const pause = document.getElementById('automation-pause');
    if (pause) pause.addEventListener('click', async function emergencyPause() {
      const confirmed = await confirmAction('Emergency pause', 'Immediately disable automatic messages and automatic appointment creation? Existing records will not be deleted.');
      if (!confirmed) return;
      state.automation = await api.automation.pause();
      toast('All automatic actions paused.');
      await refreshAll();
    });
  }

  const settingsForm = document.getElementById('settings-form');
  if (settingsForm) {
    settingsForm.addEventListener('submit', async function saveSettings(event) {
      event.preventDefault();
      const data = Object.fromEntries(new FormData(settingsForm).entries());
      await api.settings.save(data);
      toast('Settings saved.');
      await refreshAll();
    });
    document.querySelectorAll('[data-test-provider]').forEach(function bindProviderTest(element) {
      element.addEventListener('click', async function testProvider() {
        try {
          element.disabled = true;
          await api.settings.testKey(element.dataset.testProvider);
          toast(element.dataset.testProvider + ' connection successful.');
        } catch (error) {
          toast(error.message, 'error');
        } finally {
          element.disabled = false;
        }
      });
    });
    document.querySelectorAll('[data-remove-key]').forEach(function bindRemoveKey(element) {
      element.addEventListener('click', async function removeKey() {
        const confirmed = await confirmAction('Remove API key', 'The encrypted key will be deleted from this computer.');
        if (!confirmed) return;
        await api.settings.removeKey(element.dataset.removeKey);
        toast('API key removed.');
        await refreshAll();
      });
    });
    document.getElementById('create-backup').addEventListener('click', async function createBackup() { await api.backups.create(); toast('Backup created.'); await refreshAll(); });
    document.getElementById('open-backups').addEventListener('click', function openBackupFolder() { api.backups.openFolder(); });
    document.querySelectorAll('[data-restore-backup]').forEach(function bindRestore(element) {
      element.addEventListener('click', async function restoreBackup() {
        const result = await api.backups.restore(element.dataset.restoreBackup);
        if (result.restored) { toast('Backup restored.'); await refreshAll(); }
      });
    });
  }

  const integrationForm = document.getElementById('integration-form');
  if (integrationForm) {
    integrationForm.addEventListener('submit', async function saveIntegration(event) {
      event.preventDefault();
      const button = integrationForm.querySelector('[type="submit"]');
      try {
        button.disabled = true;
        const data = Object.fromEntries(new FormData(integrationForm).entries());
        await api.integration.save(data);
        toast('Connected business settings saved.');
        await refreshAll();
      } catch (error) {
        toast(error.message, 'error');
      } finally {
        button.disabled = false;
      }
    });
    const testButton = document.getElementById('integration-test');
    if (testButton) testButton.addEventListener('click', async function testIntegration() {
      try {
        testButton.disabled = true;
        const data = Object.fromEntries(new FormData(integrationForm).entries());
        await api.integration.save(data);
        const testResult = await api.integration.test();
        const syncResult = await api.integration.sync();
        if (syncResult.failureCount) {
          toast('Connection verified for ' + String(testResult.identity && testResult.identity.account_type || 'account') + ', but ' + String(syncResult.failureCount) + ' resources need attention.', 'error');
          navigate('sync-inspector');
        } else {
          toast('Connection verified and ' + String(syncResult.successCount || 0) + ' resources loaded.');
        }
        await refreshAll();
      } catch (error) {
        toast(error.message, 'error');
      } finally {
        testButton.disabled = false;
      }
    });
    const disconnectButton = document.getElementById('integration-disconnect');
    if (disconnectButton) disconnectButton.addEventListener('click', async function disconnectIntegration() {
      const confirmed = await confirmAction('Disconnect website', 'Remove the encrypted API key, stop automatic synchronization, and clear the local connected-business cache? Local contacts, leads, tasks and notification history will remain.');
      if (!confirmed) return;
      await api.integration.disconnect();
      toast('Connected business disconnected.');
      await refreshAll();
    });
  }

  const syncButtons = Array.from(document.querySelectorAll('[data-integration-sync]'));
  syncButtons.forEach(function bindSync(button) {
    button.addEventListener('click', async function syncConnectedBusiness() {
      const originalText = button.textContent;
      try {
        syncButtons.forEach(function disableSync(item) { item.disabled = true; });
        button.textContent = 'Synchronizing…';
        const result = await api.integration.sync();
        if (result.failureCount) {
          toast('Synchronization completed: ' + String(result.successCount || 0) + ' loaded, ' + String(result.failureCount) + ' failed. Open API Sync Inspector.', 'error');
          navigate('sync-inspector');
        } else {
          toast('Connected business synchronized: ' + String(result.successCount || (result.resources || []).length) + ' resources loaded.');
        }
        await refreshAll();
      } catch (error) {
        toast(error.message, 'error');
        navigate('sync-inspector');
        await refreshAll();
      } finally {
        syncButtons.forEach(function enableSync(item) { item.disabled = false; });
        button.textContent = originalText;
      }
    });
  });

  const notificationForm = document.getElementById('notification-preferences-form');
  if (notificationForm) {
    notificationForm.addEventListener('submit', async function saveNotificationPreferences(event) {
      event.preventDefault();
      const preferences = Array.from(notificationForm.querySelectorAll('[data-preference-type]')).map(function mapPreference(row) {
        const value = function checked(name) { const input = row.querySelector('[data-pref="' + name + '"]'); return input && input.checked ? 1 : 0; };
        return { type: row.dataset.preferenceType, enabled: value('enabled'), in_app_enabled: value('in_app_enabled'), desktop_enabled: value('desktop_enabled') };
      });
      const formValues = Object.fromEntries(new FormData(notificationForm).entries());
      await api.notifications.savePreferences(preferences, formValues);
      toast('Notification choices saved.');
      await refreshAll();
    });
    const permissionButton = document.getElementById('notification-permission');
    if (permissionButton) permissionButton.addEventListener('click', async function requestPermission() {
      try {
        permissionButton.disabled = true;
        await api.notifications.requestPermission();
        toast('Windows notification permission recorded.');
        await refreshAll();
      } catch (error) {
        toast(error.message, 'error');
      } finally {
        permissionButton.disabled = false;
      }
    });
    const testNotificationButton = document.getElementById('notification-test');
    if (testNotificationButton) testNotificationButton.addEventListener('click', async function testNotification() {
      try { await api.notifications.test(); toast('Test notification created.'); } catch (error) { toast(error.message, 'error'); }
    });
    const markAllButton = document.getElementById('notifications-mark-all');
    if (markAllButton) markAllButton.addEventListener('click', async function markAllRead() {
      await api.notifications.readAll();
      await refreshAll();
    });
    document.querySelectorAll('[data-nexa-action="notification-read"]').forEach(function bindNotificationRead(button) {
      button.addEventListener('click', async function readNotification() {
        await api.notifications.read(button.dataset.notificationId);
        await refreshAll();
      });
    });
    document.querySelectorAll('[data-nexa-action="notification-dismiss"][data-notification-id]').forEach(function bindNotificationDismiss(button) {
      button.addEventListener('click', async function dismissNotification() {
        await api.notifications.dismiss(button.dataset.notificationId);
        await refreshAll();
      });
    });
  }
}

document.querySelectorAll('.nav-item').forEach(function bindNavigation(button) {
  button.addEventListener('click', function navigationClicked() { navigate(button.dataset.view); });
});
document.getElementById('refresh-button').addEventListener('click', async function refreshWorkspace() { setLoading(); await refreshAll(); toast('Workspace refreshed.'); });
document.getElementById('quick-add-button').addEventListener('click', function quickAddTask() { openEntity('task'); });
document.getElementById('notification-bell').addEventListener('click', function openNotificationCenter() { navigate('notifications'); });
document.getElementById('pulse-toast-open').addEventListener('click', async function openPulseNotification() { if (state.activePulseEvent && state.activePulseEvent.id) await api.notifications.read(state.activePulseEvent.id); hidePulseToast(); navigate('notifications'); await refreshAll(); });
document.getElementById('pulse-toast-dismiss').addEventListener('click', async function dismissPulseNotification() { if (state.activePulseEvent && state.activePulseEvent.id) await api.notifications.dismiss(state.activePulseEvent.id); hidePulseToast(); await refreshAll({ render: state.view === 'notifications' }); });
document.querySelectorAll('[data-close-dialog]').forEach(function bindCloseDialog(button) {
  button.addEventListener('click', function closeDialog() { entityDialog.close(); });
});
entityForm.addEventListener('submit', function submitForm(event) {
  submitEntity(event).catch(function reportError(error) { toast(error.message, 'error'); });
});

async function initialize() {
  try {
    api.notifications.onNew(function receiveNotification(event) {
      state.notifications.unshift(event);
      state.unreadNotifications += 1;
      document.getElementById('notification-count').textContent = String(state.unreadNotifications);
      document.getElementById('notification-bell-count').textContent = String(state.unreadNotifications);
      document.getElementById('notification-bell').classList.add('has-unread');
      showPulseToast(event);
      if (state.view === 'notifications') renderView();
    });
    api.notifications.onOpen(function openNotificationFromSystem(event) {
      if (event && event.openCenter) {
        navigate('notifications');
        return;
      }
      state.activePulseEvent = event || null;
      navigate('notifications');
      refreshAll();
    });
    setLoading();
    await refreshAll();
    document.body.dataset.ready = 'true';
    setInterval(async function periodicRefresh() {
      try {
        state.alerts = await api.alerts.list();
        const notificationResult = await api.notifications.list(150, false);
        state.notifications = notificationResult.items || [];
        state.unreadNotifications = Number(notificationResult.unread || 0);
        document.getElementById('alert-count').textContent = String(state.alerts.length);
        document.getElementById('notification-count').textContent = String(state.unreadNotifications);
        document.getElementById('notification-bell-count').textContent = String(state.unreadNotifications);
        document.getElementById('notification-bell').classList.toggle('has-unread', state.unreadNotifications > 0);
  const messageCount = integrationRemote('messages').reduce(function countUnread(total, item) { return total + Number(item.unread_count || 0); }, 0);
  const messageCountElement = document.getElementById('message-count');
  if (messageCountElement) messageCountElement.textContent = String(messageCount);
        if (state.view === 'alerts' || state.view === 'dashboard' || state.view === 'notifications') {
          state.dashboard = await api.dashboard.summary();
          renderView();
        }
      } catch (error) {
        void error;
      }
    }, 60000);
    setInterval(function messageRealtimeTick(){ pollActiveMessageThread().catch(function ignorePollError(){ /* displayed in Messages */ }); }, 1000);
  } catch (error) {
    content.innerHTML = '<div class="empty-state"><div><b>Application startup failed</b>' + esc(error.message) + '</div></div>';
    window.__NEXA_ERRORS__.push(error.message);
  }
}

window.NEXA_UI_CONTRACT_V1 = NEXA_UI_CONTRACT_V1;
window.NEXA_UI_TESTID_CONTRACT = UI_TESTID_CONTRACT;
window.NEXA_ACTION_CONTRACT = ACTION_CONTRACT;
window.NEXA_UI_TESTID_EXTENDED_CONTRACT = UI_TESTID_EXTENDED_CONTRACT;
initialize();
