'use strict';

const NEXA_UI_CONTRACT_V1 = 'NEXA_UI_CONTRACT_V1';
const UI_TESTID_CONTRACT = 'data-testid values for dashboard, sidebar, contacts, leads, agenda, tasks, ai, alerts, activity, settings, about';
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
  search: '',
  activeAIRequest: null,
  aiResult: ''
};

const viewTitles = {
  dashboard: 'Dashboard',
  contacts: 'Contacts',
  leads: 'Leads',
  agenda: 'Agenda',
  tasks: 'Tasks',
  ai: 'AI Suggestions',
  alerts: 'Alerts',
  activity: 'Activity',
  settings: 'Settings',
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
    api.backups.list()
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
  document.getElementById('alert-count').textContent = String(state.alerts.length);
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

function renderView() {
  try {
    const renderers = {
      dashboard: renderDashboard,
      contacts: renderContacts,
      leads: renderLeads,
      agenda: renderAgenda,
      tasks: renderTasks,
      ai: renderAI,
      alerts: renderAlerts,
      activity: renderActivity,
      settings: renderSettings,
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

function renderDashboard() {
  const dashboard = state.dashboard || {};
  const stats = [
    ['Contacts', dashboard.contacts || 0, 'People in your local workspace'],
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
  return sectionHeader('Your business at a glance', 'Local data, upcoming work and suggested priorities.', '<button class="primary-button" data-nexa-action="task-create">+ New task</button>') +
    '<div class="grid stats-grid">' + statHtml + '</div>' +
    '<div class="grid dashboard-grid">' +
      '<article class="panel-card"><div class="panel-header"><div><h3>Upcoming agenda</h3><p>Next scheduled appointments</p></div><button class="ghost-button" data-go="agenda" data-nexa-action="agenda-day">Open agenda</button></div><div class="list">' + upcoming + '</div></article>' +
      '<article class="panel-card"><div class="panel-header"><div><h3>Priority tasks</h3><p>Items that deserve attention</p></div><button class="ghost-button" data-go="tasks" data-nexa-action="navigate-tasks">Open tasks</button></div><div class="list">' + priorities + '</div></article>' +
      '<article class="panel-card"><div class="panel-header"><div><h3>Smart assistant</h3><p>Get an action plan from your configured provider</p></div>' + (providerConfigured ? badge('Ready', 'success') : badge('Not configured', 'warning')) + '</div><p class="muted">Nexa can review your pending work and suggest practical next actions. It never sends messages or edits records without approval.</p><button class="primary-button" data-go="ai" data-nexa-action="navigate-ai">Generate suggestions</button></article>' +
      '<article class="panel-card"><div class="panel-header"><div><h3>Active alerts</h3><p>Overdue and upcoming work</p></div><strong>' + state.alerts.length + '</strong></div><div class="list">' + alerts + '</div></article>' +
    '</div>';
}

function renderContacts() {
  const rows = state.contacts.filter(function filterContact(contact) {
    return modules.contacts ? modules.contacts.matches(contact, state.search) : true;
  });
  const body = rows.map(function renderContact(contact) {
    return '<tr><td><b>' + esc(contact.name) + '</b></td><td>' + esc(contact.company || '—') + '</td><td>' + esc(contact.phone || '—') + '</td><td>' + esc(contact.email || '—') + '</td><td>' + esc(contact.tags || '—') + '</td><td><div class="row-actions"><button data-nexa-action="contact-edit" data-record-id="' + esc(contact.id) + '">Edit</button><button data-nexa-action="contact-delete" data-record-id="' + esc(contact.id) + '">Delete</button></div></td></tr>';
  }).join('');
  const table = body ? '<div class="table-wrap"><table><thead><tr><th>Name</th><th>Company</th><th>Phone</th><th>Email</th><th>Tags</th><th></th></tr></thead><tbody>' + body + '</tbody></table></div>' : emptyMini('No contacts found', 'Create your first contact or change the search.', 'contacts-empty');
  return sectionHeader('Contacts', 'Keep customer and business relationships organized.') + toolbar('Contacts', 'contact-create', 'contact-search', 'new-contact') + table;
}

function renderLeads() {
  const rows = state.leads.filter(function filterLead(lead) {
    return modules.leads ? modules.leads.matches(lead, state.search) : true;
  });
  const body = rows.map(function renderLead(lead) {
    return '<tr><td><b>' + esc(lead.name) + '</b><br><span class="muted">' + esc(lead.company || lead.contact_name || '') + '</span></td><td>' + badge(lead.status) + '</td><td>' + badge(lead.priority) + '</td><td>' + money(lead.estimated_value) + '</td><td>' + formatDate(lead.next_follow_up) + '</td><td><div class="row-actions"><button data-nexa-action="ai-generate" data-ai-lead="' + esc(lead.id) + '">Suggest</button><button data-nexa-action="lead-edit" data-record-id="' + esc(lead.id) + '">Edit</button><button data-nexa-action="lead-delete" data-record-id="' + esc(lead.id) + '">Delete</button></div></td></tr>';
  }).join('');
  const table = body ? '<div class="table-wrap"><table><thead><tr><th>Lead</th><th>Status</th><th>Priority</th><th>Value</th><th>Next follow-up</th><th></th></tr></thead><tbody>' + body + '</tbody></table></div>' : emptyMini('No leads found', 'Create a lead to begin tracking your pipeline.', 'leads-empty');
  return sectionHeader('Leads', 'Track opportunities, priorities and the next follow-up.') + toolbar('Leads', 'lead-create', 'lead-search', 'new-lead') + table;
}

function renderTasks() {
  const rows = state.tasks.filter(function filterTask(task) {
    return modules.tasks ? modules.tasks.matches(task, state.search) : true;
  });
  const body = rows.map(function renderTask(task) {
    const checked = task.status === 'Completed' ? ' checked' : '';
    return '<tr><td><input style="width:auto" type="checkbox" data-nexa-action="task-complete" data-record-id="' + esc(task.id) + '"' + checked + '></td><td><b>' + esc(task.title) + '</b><br><span class="muted">' + esc(task.description || '') + '</span></td><td>' + badge(task.priority) + '</td><td>' + badge(task.status) + '</td><td>' + formatDate(task.due_at) + '</td><td><div class="row-actions"><button data-nexa-action="task-edit" data-record-id="' + esc(task.id) + '">Edit</button><button data-nexa-action="task-delete" data-record-id="' + esc(task.id) + '">Delete</button></div></td></tr>';
  }).join('');
  const table = body ? '<div class="table-wrap"><table><thead><tr><th></th><th>Task</th><th>Priority</th><th>Status</th><th>Due</th><th></th></tr></thead><tbody>' + body + '</tbody></table></div>' : emptyMini('No tasks found', 'Create a task to organize your next action.', 'tasks-empty');
  return sectionHeader('Tasks', 'Manage work, follow-ups and deadlines.') + toolbar('Tasks', 'task-create', 'task-search', 'new-task') + table;
}

function renderAgenda() {
  const query = String(state.search || '').toLowerCase();
  const rows = state.appointments.filter(function filterAppointment(appointment) {
    const text = [appointment.title, appointment.description, appointment.contact_name, appointment.lead_name].join(' ').toLowerCase();
    return text.includes(query);
  });
  const grouped = modules.agenda ? modules.agenda.groupByDay(rows) : {};
  const agenda = Object.keys(grouped).sort().map(function renderDay(day) {
    const entries = grouped[day].map(function renderAppointment(appointment) {
      const time = new Date(appointment.start_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      return '<div class="timeline-item"><div class="timeline-time">' + esc(time) + '</div><div class="timeline-dot"></div><div class="timeline-content"><div class="list-item"><div class="list-item-main"><strong>' + esc(appointment.title) + '</strong><span>' + esc(appointment.contact_name || appointment.lead_name || appointment.description || 'Local appointment') + '</span></div><div class="row-actions"><button data-nexa-action="appointment-complete" data-record-id="' + esc(appointment.id) + '">Complete</button><button data-nexa-action="appointment-edit" data-record-id="' + esc(appointment.id) + '">Edit</button><button data-nexa-action="appointment-delete" data-record-id="' + esc(appointment.id) + '">Delete</button></div></div></div></div>';
    }).join('');
    return '<div class="agenda-day"><h3>' + formatDate(day, false) + '</h3>' + entries + '</div>';
  }).join('');
  const viewButtons = '<div class="row-actions"><button class="ghost-button" data-nexa-action="agenda-day">Day</button><button class="ghost-button" data-nexa-action="agenda-week">Week</button></div>';
  return sectionHeader('Agenda', 'A simple daily and weekly view of local appointments.', viewButtons) + toolbar('Appointments', 'appointment-create', 'appointment-search', 'new-appointment') + (agenda || emptyMini('No appointments found', 'Create your first appointment or change the search.'));
}

function renderAI() {
  const provider = state.settings && state.settings.preferred_provider ? state.settings.preferred_provider : 'openai';
  const providerState = state.settings && state.settings.secrets ? state.settings.secrets[provider] : null;
  const configured = Boolean(providerState && providerState.configured);
  const history = state.suggestions.slice(0, 8).map(function renderSuggestion(item) {
    return '<div class="list-item"><div class="list-item-main"><strong>' + esc(String(item.kind || '').replaceAll('_', ' ')) + '</strong><span>' + esc(item.provider) + ' · ' + formatDate(item.created_at) + '</span></div><button class="ghost-button" data-nexa-action="ai-show-suggestion" data-show-suggestion="' + esc(item.id) + '">View</button></div>';
  }).join('') || emptyMini('No suggestions yet', 'Generate the first suggestion when an AI provider is configured.');
  const statusBadge = configured ? badge('Configured', 'success') : badge('Not configured', 'warning');
  const providerOptions = '<option value="openai"' + (provider === 'openai' ? ' selected' : '') + '>OpenAI</option><option value="deepseek"' + (provider === 'deepseek' ? ' selected' : '') + '>DeepSeek</option>';
  return sectionHeader('AI Suggestions', 'Use your own provider key to get practical, approval-only recommendations.') +
    '<div class="grid ai-layout">' +
      '<article class="panel-card"><div class="panel-header"><div><h3>Generate a suggestion</h3><p>No automatic messages or record changes</p></div>' + statusBadge + '</div><div class="form-grid">' +
        '<label>Provider<select id="ai-provider" data-nexa-action="ai-provider-select">' + providerOptions + '</select></label>' +
        '<label>Suggestion type<select id="ai-kind"><option value="daily_priorities">Daily priorities</option><option value="lead_next_step">Lead next step</option><option value="agenda_optimization">Agenda optimization</option><option value="follow_up_draft">Follow-up note draft</option><option value="stale_leads">Stale leads</option></select></label>' +
        '<label>Related record type<select id="ai-related-type"><option value="">Entire workspace</option><option value="lead">Lead</option><option value="contact">Contact</option><option value="task">Task</option><option value="appointment">Appointment</option></select></label>' +
        '<label>Related record<select id="ai-related-id"><option value="">None selected</option></select></label>' +
        '<label class="span-2">What should Nexa focus on?<textarea id="ai-focus" placeholder="Example: Help me prioritize follow-ups before Friday."></textarea></label>' +
      '</div><div class="dialog-actions" style="padding-top:14px"><button class="secondary-button" id="ai-cancel" data-nexa-action="ai-cancel"' + (state.activeAIRequest ? '' : ' disabled') + '>Cancel</button><button class="primary-button" id="ai-generate" data-nexa-action="ai-generate" data-testid="generate-suggestion">Generate suggestion</button></div><p class="ai-status" id="ai-status">' + (configured ? 'Ready to use the selected provider.' : 'AI provider not configured') + '</p></article>' +
      '<article class="panel-card"><div class="panel-header"><div><h3>Suggestion</h3><p>Review before turning it into an action</p></div></div><div class="ai-output" id="ai-output">' + esc(state.aiResult || 'Your generated suggestion will appear here.') + '</div><div class="dialog-actions"><button class="secondary-button" data-nexa-action="ai-save-note" id="ai-save-note">Save note</button><button class="primary-button" data-nexa-action="ai-save-task" id="ai-save-task">Save task</button></div></article>' +
      '<article class="panel-card" style="grid-column:1/-1"><div class="panel-header"><div><h3>Recent suggestions</h3><p>Stored locally in your workspace</p></div></div><div class="list">' + history + '</div></article>' +
    '</div>';
}

function renderAlerts() {
  const alertCards = state.alerts.map(function renderAlert(alert) {
    return '<article class="alert-card ' + esc(alert.level) + '"><div class="alert-marker"></div><div><h3>' + esc(alert.title) + '</h3><p class="muted" style="margin:0">' + esc(alert.type) + ' · ' + formatDate(alert.date) + '</p></div>' + badge(alert.level) + '</article>';
  }).join('') || emptyMini('No active alerts', 'There is nothing urgent right now.');
  const reminderRows = state.reminders.map(function renderReminder(reminder) {
    const enabled = Number(reminder.enabled) === 1;
    return '<div class="list-item"><div class="list-item-main"><strong>' + esc(reminder.title) + '</strong><span>' + formatDate(reminder.remind_at) + ' · ' + (enabled ? 'Enabled' : 'Paused') + '</span></div><button class="ghost-button" data-nexa-action="reminder-toggle" data-record-id="' + esc(reminder.id) + '">' + (enabled ? 'Pause' : 'Enable') + '</button></div>';
  }).join('') || emptyMini('No custom reminders', 'Create a reminder for an important follow-up.');
  return sectionHeader('Alerts', 'Overdue tasks, due follow-ups and upcoming appointments.', '<button class="primary-button" data-nexa-action="reminder-create">+ Reminder</button>') + '<div class="grid">' + alertCards + '</div><article class="panel-card"><div class="panel-header"><div><h3>Custom reminders</h3><p>Local reminders that work without AI</p></div><button class="ghost-button" data-nexa-action="alert-refresh">Refresh</button></div><div class="list">' + reminderRows + '</div></article>';
}

function renderActivity() {
  const items = state.activity.map(function renderActivityItem(item) {
    return '<div class="activity-item"><div class="activity-icon">' + esc(String(item.action || '').slice(0, 1).toUpperCase()) + '</div><div><strong>' + esc(String(item.action || '').replaceAll('_', ' ')) + ' · ' + esc(item.entity_type) + '</strong><div class="muted">' + esc(item.details || item.entity_id || '') + '</div></div><time class="muted">' + formatDate(item.created_at) + '</time></div>';
  }).join('') || emptyMini('No activity yet', 'Changes to records will appear here.');
  return sectionHeader('Activity', 'A local audit trail of important changes.') + '<article class="panel-card">' + items + '</article>';
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

function renderAbout() {
  return sectionHeader('About', 'A local-first office assistant built for controlled, practical work.') +
    '<div class="grid split-grid">' +
      '<article class="panel-card"><p class="eyebrow">PRODUCT</p><h2>Nexa Smart Office Bot</h2><p class="muted">Version ' + esc(state.meta && state.meta.version ? state.meta.version : '1.0.0') + '</p><p>Contacts, leads, agenda, tasks, alerts, backups and approval-only AI suggestions in one Windows desktop application.</p></article>' +
      '<article class="panel-card"><p class="eyebrow">PRIVACY</p><h3>Your business data stays local</h3><p class="muted">The SQLite workspace and backups are stored on this computer. Only selected context is sent to the AI provider.</p></article>' +
      '<article class="panel-card"><p class="eyebrow">AI CONTROL</p><h3>No automatic actions</h3><p class="muted">Nexa never sends messages, changes customer records, creates appointments or deletes data based only on an AI response.</p></article>' +
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
  select.innerHTML = '<option value="">None selected</option>' + collection.map(function option(item) {
    return '<option value="' + esc(item.id) + '">' + esc(item.name || item.title) + '</option>';
  }).join('');
}

async function generateAI() {
  const provider = document.getElementById('ai-provider').value;
  const providerState = state.settings && state.settings.secrets ? state.settings.secrets[provider] : null;
  if (!providerState || !providerState.configured) {
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
    const result = await api.ai.generate({
      request_id: requestId,
      provider: provider,
      kind: document.getElementById('ai-kind').value,
      related_type: document.getElementById('ai-related-type').value,
      related_id: document.getElementById('ai-related-id').value,
      focus: document.getElementById('ai-focus').value
    });
    state.aiResult = result.suggestion.response;
    toast('Suggestion generated.');
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
      renderView();
      const nextSearch = document.getElementById('view-search');
      if (nextSearch) nextSearch.focus();
    });
  }

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
}

document.querySelectorAll('.nav-item').forEach(function bindNavigation(button) {
  button.addEventListener('click', function navigationClicked() { navigate(button.dataset.view); });
});
document.getElementById('refresh-button').addEventListener('click', async function refreshWorkspace() { setLoading(); await refreshAll(); toast('Workspace refreshed.'); });
document.getElementById('quick-add-button').addEventListener('click', function quickAddTask() { openEntity('task'); });
document.querySelectorAll('[data-close-dialog]').forEach(function bindCloseDialog(button) {
  button.addEventListener('click', function closeDialog() { entityDialog.close(); });
});
entityForm.addEventListener('submit', function submitForm(event) {
  submitEntity(event).catch(function reportError(error) { toast(error.message, 'error'); });
});

async function initialize() {
  try {
    setLoading();
    await refreshAll();
    document.body.dataset.ready = 'true';
    setInterval(async function periodicRefresh() {
      try {
        state.alerts = await api.alerts.list();
        document.getElementById('alert-count').textContent = String(state.alerts.length);
        if (state.view === 'alerts' || state.view === 'dashboard') {
          state.dashboard = await api.dashboard.summary();
          renderView();
        }
      } catch (error) {
        void error;
      }
    }, 60000);
  } catch (error) {
    content.innerHTML = '<div class="empty-state"><div><b>Application startup failed</b>' + esc(error.message) + '</div></div>';
    window.__NEXA_ERRORS__.push(error.message);
  }
}

window.NEXA_UI_CONTRACT_V1 = NEXA_UI_CONTRACT_V1;
window.NEXA_UI_TESTID_CONTRACT = UI_TESTID_CONTRACT;
window.NEXA_ACTION_CONTRACT = ACTION_CONTRACT;
initialize();
