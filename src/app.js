'use strict';

window.__NEXA_ERRORS__ = [];
window.addEventListener('error', (event) => window.__NEXA_ERRORS__.push(String(event.error?.message || event.message)));
window.addEventListener('unhandledrejection', (event) => window.__NEXA_ERRORS__.push(String(event.reason?.message || event.reason)));

const api = window.nexa;
const content = document.getElementById('app-content');
const pageTitle = document.getElementById('page-title');
const entityDialog = document.getElementById('entity-dialog');
const entityForm = document.getElementById('entity-form');
const dialogFields = document.getElementById('dialog-fields');
const dialogTitle = document.getElementById('dialog-title');
const dialogEyebrow = document.getElementById('dialog-eyebrow');
const confirmDialog = document.getElementById('confirm-dialog');

const state = {
  view: 'dashboard',
  meta: null,
  dashboard: null,
  contacts: [],
  leads: [],
  tasks: [],
  appointments: [],
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
  dashboard: 'Dashboard', contacts: 'Contacts', leads: 'Leads', agenda: 'Agenda', tasks: 'Tasks',
  ai: 'AI Suggestions', alerts: 'Alerts', activity: 'Activity', settings: 'Settings', about: 'About'
};

const esc = (value) => String(value ?? '').replace(/[&<>'"]/g, (char) => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', "'":'&#39;', '"':'&quot;' }[char]));
const formatDate = (value, includeTime = true) => {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return esc(value);
  return new Intl.DateTimeFormat(undefined, includeTime ? { dateStyle:'medium', timeStyle:'short' } : { dateStyle:'medium' }).format(date);
};
const inputDateTime = (value) => {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value).slice(0,16);
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0,16);
};
const toIso = (value) => value ? new Date(value).toISOString() : '';
const money = (value) => new Intl.NumberFormat(undefined, { style:'currency', currency:'USD', maximumFractionDigits:0 }).format(Number(value || 0));
const badge = (value, extra = '') => `<span class="badge ${esc(String(value).toLowerCase().replaceAll(' ','-'))} ${extra}">${esc(value)}</span>`;

function toast(message, type = 'success') {
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.textContent = message;
  document.getElementById('toast-region').appendChild(el);
  setTimeout(() => el.remove(), 4500);
}

async function confirmAction(title, message) {
  document.getElementById('confirm-title').textContent = title;
  document.getElementById('confirm-message').textContent = message;
  confirmDialog.showModal();
  return new Promise((resolve) => {
    confirmDialog.addEventListener('close', () => resolve(confirmDialog.returnValue === 'confirm'), { once: true });
  });
}

function setLoading() {
  content.innerHTML = '<div class="loading">Loading workspace…</div>';
}

async function refreshAll({ render = true } = {}) {
  const [meta, dashboard, contacts, leads, tasks, appointments, alerts, activity, suggestions, settings, backups] = await Promise.all([
    api.app.meta(), api.dashboard.summary(), api.contacts.list(), api.leads.list(), api.tasks.list(),
    api.appointments.list(), api.alerts.list(), api.activity.list(150), api.ai.list(50), api.settings.get(), api.backups.list()
  ]);
  Object.assign(state, { meta, dashboard, contacts, leads, tasks, appointments, alerts, activity, suggestions, settings, backups });
  document.getElementById('alert-count').textContent = String(alerts.length);
  document.getElementById('sidebar-version').textContent = `v${meta.version}`;
  updateProviderPill();
  if (render) renderView();
}

function updateProviderPill() {
  const pill = document.getElementById('provider-pill');
  const preferred = state.settings?.preferred_provider || 'openai';
  const configured = Boolean(state.settings?.secrets?.[preferred]?.configured);
  pill.classList.toggle('connected', configured);
  pill.querySelector('b').textContent = configured ? `${preferred === 'openai' ? 'OpenAI' : 'DeepSeek'} configured` : 'AI not configured';
}

function navigate(view) {
  state.view = view;
  state.search = '';
  pageTitle.textContent = viewTitles[view];
  document.querySelectorAll('.nav-item').forEach((button) => button.classList.toggle('active', button.dataset.view === view));
  renderView();
}

function sectionHeader(title, description, action = '') {
  return `<div class="section-header"><div><h2>${esc(title)}</h2><p>${esc(description)}</p></div>${action}</div>`;
}

function renderView() {
  try {
    const renderer = {
      dashboard: renderDashboard, contacts: renderContacts, leads: renderLeads, agenda: renderAgenda,
      tasks: renderTasks, ai: renderAI, alerts: renderAlerts, activity: renderActivity,
      settings: renderSettings, about: renderAbout
    }[state.view];
    content.innerHTML = renderer();
    bindViewEvents();
  } catch (error) {
    content.innerHTML = `<div class="empty-state"><div><b>Unable to render this section</b>${esc(error.message)}</div></div>`;
    window.__NEXA_ERRORS__.push(error.message);
  }
}

function renderDashboard() {
  const d = state.dashboard || {};
  const stats = [
    ['Contacts', d.contacts || 0, 'People in your local workspace'],
    ['Active leads', d.activeLeads || 0, `${d.followUps || 0} need follow-up soon`],
    ['Pending tasks', d.pendingTasks || 0, `${d.overdueTasks || 0} overdue`],
    ["Today's meetings", d.todayAppointments || 0, `${d.activeAlerts || 0} active alerts`]
  ];
  const statHtml = stats.map(([label,value,help]) => `<article class="stat-card"><span>${label}</span><strong>${value}</strong><small>${help}</small></article>`).join('');
  const upcoming = (d.upcoming || []).length ? d.upcoming.map((item) => `<div class="list-item"><div class="list-item-main"><strong>${esc(item.title)}</strong><span>${formatDate(item.start_at)}</span></div>${badge(item.status,'info')}</div>`).join('') : emptyMini('No upcoming events','Create an appointment to build your schedule.');
  const priorities = (d.priorities || []).length ? d.priorities.map((item) => `<div class="list-item"><div class="list-item-main"><strong>${esc(item.title)}</strong><span>${item.due_at ? formatDate(item.due_at) : 'No due date'}</span></div>${badge(item.priority)}</div>`).join('') : emptyMini('No pending tasks','Add a task or follow-up.');
  return `
    ${sectionHeader('Your business at a glance','Local data, upcoming work and suggested priorities.', '<button class="primary-button" data-action="add-task">+ New task</button>')}
    <div class="grid stats-grid">${statHtml}</div>
    <div class="grid dashboard-grid">
      <article class="panel-card"><div class="panel-header"><div><h3>Upcoming agenda</h3><p>Next scheduled appointments</p></div><button class="ghost-button" data-go="agenda">Open agenda</button></div><div class="list">${upcoming}</div></article>
      <article class="panel-card"><div class="panel-header"><div><h3>Priority tasks</h3><p>Items that deserve attention</p></div><button class="ghost-button" data-go="tasks">Open tasks</button></div><div class="list">${priorities}</div></article>
      <article class="panel-card"><div class="panel-header"><div><h3>Smart assistant</h3><p>Get an action plan from your configured provider</p></div>${state.settings?.secrets?.[state.settings?.preferred_provider || 'openai']?.configured ? badge('Ready','success') : badge('Not configured','warning')}</div>
        <p class="muted">Nexa can review your pending work and suggest practical next actions. It never sends messages or edits records without your approval.</p>
        <button class="primary-button" data-go="ai">Generate suggestions</button>
      </article>
      <article class="panel-card"><div class="panel-header"><div><h3>Active alerts</h3><p>Overdue and upcoming work</p></div><strong>${state.alerts.length}</strong></div><div class="list">${state.alerts.slice(0,4).map(alertMini).join('') || emptyMini('No active alerts','You are caught up.')}</div></article>
    </div>`;
}

function emptyMini(title, text) {
  return `<div class="empty-state" style="min-height:130px"><div><b>${esc(title)}</b>${esc(text)}</div></div>`;
}
function alertMini(item) {
  return `<div class="list-item"><div class="list-item-main"><strong>${esc(item.title)}</strong><span>${esc(item.type)} · ${formatDate(item.date)}</span></div></div>`;
}

function toolbar(label, action, testid) {
  return `<div class="toolbar"><div class="search-box"><input id="view-search" type="search" value="${esc(state.search)}" placeholder="Search ${esc(label.toLowerCase())}…"></div><button class="primary-button" data-action="${action}" data-testid="${testid}">+ New ${esc(label.replace(/s$/,''))}</button></div>`;
}

function renderContacts() {
  const q = state.search.toLowerCase();
  const rows = state.contacts.filter((x) => [x.name,x.company,x.email,x.phone,x.tags].some((v) => String(v || '').toLowerCase().includes(q)));
  return `${sectionHeader('Contacts','Keep customer and business relationships organized.')}${toolbar('Contacts','add-contact','new-contact')}${rows.length ? `<div class="table-wrap"><table><thead><tr><th>Name</th><th>Company</th><th>Phone</th><th>Email</th><th>Tags</th><th></th></tr></thead><tbody>${rows.map((x) => `<tr><td><b>${esc(x.name)}</b></td><td>${esc(x.company || '—')}</td><td>${esc(x.phone || '—')}</td><td>${esc(x.email || '—')}</td><td>${esc(x.tags || '—')}</td><td><div class="row-actions"><button data-edit-contact="${x.id}">Edit</button><button data-delete-contact="${x.id}">Delete</button></div></td></tr>`).join('')}</tbody></table></div>` : emptyMini('No contacts found','Create your first contact or change the search.')}`;
}

function renderLeads() {
  const q = state.search.toLowerCase();
  const rows = state.leads.filter((x) => [x.name,x.company,x.email,x.phone,x.status,x.priority].some((v) => String(v || '').toLowerCase().includes(q)));
  return `${sectionHeader('Leads','Track opportunities, priorities and the next follow-up.')}${toolbar('Leads','add-lead','new-lead')}${rows.length ? `<div class="table-wrap"><table><thead><tr><th>Lead</th><th>Status</th><th>Priority</th><th>Value</th><th>Next follow-up</th><th></th></tr></thead><tbody>${rows.map((x) => `<tr><td><b>${esc(x.name)}</b><br><span class="muted">${esc(x.company || x.contact_name || '')}</span></td><td>${badge(x.status)}</td><td>${badge(x.priority)}</td><td>${money(x.estimated_value)}</td><td>${formatDate(x.next_follow_up)}</td><td><div class="row-actions"><button data-ai-lead="${x.id}">Suggest</button><button data-edit-lead="${x.id}">Edit</button><button data-delete-lead="${x.id}">Delete</button></div></td></tr>`).join('')}</tbody></table></div>` : emptyMini('No leads found','Create a lead to begin tracking your pipeline.')}`;
}

function renderTasks() {
  const q = state.search.toLowerCase();
  const rows = state.tasks.filter((x) => [x.title,x.description,x.status,x.priority].some((v) => String(v || '').toLowerCase().includes(q)));
  return `${sectionHeader('Tasks','Manage work, follow-ups and deadlines.')}${toolbar('Tasks','add-task','new-task')}${rows.length ? `<div class="table-wrap"><table><thead><tr><th></th><th>Task</th><th>Priority</th><th>Status</th><th>Due</th><th></th></tr></thead><tbody>${rows.map((x) => `<tr><td><input style="width:auto" type="checkbox" data-toggle-task="${x.id}" ${x.status === 'Completed' ? 'checked' : ''}></td><td><b>${esc(x.title)}</b><br><span class="muted">${esc(x.description || '')}</span></td><td>${badge(x.priority)}</td><td>${badge(x.status)}</td><td>${formatDate(x.due_at)}</td><td><div class="row-actions"><button data-edit-task="${x.id}">Edit</button><button data-delete-task="${x.id}">Delete</button></div></td></tr>`).join('')}</tbody></table></div>` : emptyMini('No tasks found','Create a task to organize your next action.')}`;
}

function renderAgenda() {
  const q = state.search.toLowerCase();
  const rows = state.appointments.filter((x) => [x.title,x.description,x.contact_name,x.lead_name].some((v) => String(v || '').toLowerCase().includes(q)));
  const grouped = rows.reduce((acc,item) => { const key = String(item.start_at).slice(0,10); (acc[key] ||= []).push(item); return acc; }, {});
  const agenda = Object.keys(grouped).sort().map((day) => `<div class="agenda-day"><h3>${formatDate(day,false)}</h3>${grouped[day].map((x) => `<div class="timeline-item"><div class="timeline-time">${new Date(x.start_at).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'})}</div><div class="timeline-dot"></div><div class="timeline-content"><div class="list-item"><div class="list-item-main"><strong>${esc(x.title)}</strong><span>${esc(x.contact_name || x.lead_name || x.description || 'Local appointment')}</span></div><div class="row-actions"><button data-edit-appointment="${x.id}">Edit</button><button data-delete-appointment="${x.id}">Delete</button></div></div></div></div>`).join('')}</div>`).join('');
  return `${sectionHeader('Agenda','A simple daily and weekly view of local appointments.')}${toolbar('Appointments','add-appointment','new-appointment')}${agenda || emptyMini('No appointments found','Create your first appointment or change the search.')}`;
}

function renderAI() {
  const provider = state.settings?.preferred_provider || 'openai';
  const configured = state.settings?.secrets?.[provider]?.configured;
  const history = state.suggestions.slice(0,8).map((item) => `<div class="list-item"><div class="list-item-main"><strong>${esc(item.kind.replaceAll('_',' '))}</strong><span>${esc(item.provider)} · ${formatDate(item.created_at)}</span></div><button class="ghost-button" data-show-suggestion="${item.id}">View</button></div>`).join('');
  return `${sectionHeader('AI Suggestions','Use your own provider key to get practical, approval-only recommendations.')}
    <div class="grid ai-layout">
      <article class="panel-card">
        <div class="panel-header"><div><h3>Generate a suggestion</h3><p>No automatic messages or record changes</p></div>${configured ? badge('Configured','success') : badge('Not configured','warning')}</div>
        <div class="form-grid">
          <label>Provider<select id="ai-provider"><option value="openai" ${provider==='openai'?'selected':''}>OpenAI</option><option value="deepseek" ${provider==='deepseek'?'selected':''}>DeepSeek</option></select></label>
          <label>Suggestion type<select id="ai-kind"><option value="daily_priorities">Daily priorities</option><option value="lead_next_step">Lead next step</option><option value="agenda_optimization">Agenda optimization</option><option value="follow_up_draft">Follow-up note draft</option><option value="stale_leads">Stale leads</option></select></label>
          <label>Related record type<select id="ai-related-type"><option value="">Entire workspace</option><option value="lead">Lead</option><option value="contact">Contact</option><option value="task">Task</option><option value="appointment">Appointment</option></select></label>
          <label>Related record<select id="ai-related-id"><option value="">None selected</option></select></label>
          <label class="span-2">What should Nexa focus on?<textarea id="ai-focus" placeholder="Example: Help me prioritize follow-ups before Friday."></textarea></label>
        </div>
        <div class="dialog-actions" style="padding-top:14px"><button class="secondary-button" id="ai-cancel" ${state.activeAIRequest?'':'disabled'}>Cancel</button><button class="primary-button" id="ai-generate" data-testid="generate-suggestion">Generate suggestion</button></div>
        <p class="ai-status" id="ai-status">${configured ? 'Ready to use the selected provider.' : 'Configure an API key in Settings first.'}</p>
      </article>
      <article class="panel-card"><div class="panel-header"><div><h3>Suggestion</h3><p>Review before turning it into an action</p></div></div><div class="ai-output" id="ai-output">${esc(state.aiResult || 'Your generated suggestion will appear here.')}</div></article>
      <article class="panel-card" style="grid-column:1/-1"><div class="panel-header"><div><h3>Recent suggestions</h3><p>Stored locally in your workspace</p></div></div><div class="list">${history || emptyMini('No suggestions yet','Generate the first suggestion when an AI provider is configured.')}</div></article>
    </div>`;
}

function renderAlerts() {
  return `${sectionHeader('Alerts','Overdue tasks, due follow-ups and upcoming appointments.')}<div class="grid">${state.alerts.length ? state.alerts.map((x) => `<article class="alert-card ${x.level}"><div class="alert-marker"></div><div><h3>${esc(x.title)}</h3><p class="muted" style="margin:0">${esc(x.type)} · ${formatDate(x.date)}</p></div>${badge(x.level)}</article>`).join('') : emptyMini('No active alerts','There is nothing urgent right now.')}</div>`;
}

function renderActivity() {
  return `${sectionHeader('Activity','A local audit trail of important changes.')}<article class="panel-card">${state.activity.length ? state.activity.map((x) => `<div class="activity-item"><div class="activity-icon">${esc(x.action.slice(0,1).toUpperCase())}</div><div><strong>${esc(x.action.replaceAll('_',' '))} · ${esc(x.entity_type)}</strong><div class="muted">${esc(x.details || x.entity_id || '')}</div></div><time class="muted">${formatDate(x.created_at)}</time></div>`).join('') : emptyMini('No activity yet','Changes to records will appear here.')}</article>`;
}

function renderSettings() {
  const s = state.settings || {};
  const secret = s.secrets || {};
  const backupRows = state.backups.slice(0,8).map((x) => `<div class="list-item"><div class="list-item-main"><strong>${esc(x.file_path.split(/[\\/]/).pop())}</strong><span>${formatDate(x.created_at)} · ${(Number(x.file_size)/1024).toFixed(1)} KB</span></div><button class="ghost-button" data-restore-backup="${esc(x.file_path)}">Restore</button></div>`).join('');
  return `${sectionHeader('Settings','Configure AI providers, notifications and local backups.')}
    <form id="settings-form" class="grid settings-grid">
      <article class="setting-block"><div class="panel-header"><div><h3>AI provider</h3><p>Keys are encrypted with Electron safeStorage</p></div></div>
        <label>Preferred provider<select name="preferred_provider"><option value="openai" ${s.preferred_provider==='openai'?'selected':''}>OpenAI</option><option value="deepseek" ${s.preferred_provider==='deepseek'?'selected':''}>DeepSeek</option></select></label>
        <label>OpenAI model<input name="openai_model" value="${esc(s.openai_model || 'gpt-5.6-luna')}"></label>
        <label>OpenAI API key<input name="openai_key" type="password" autocomplete="off" placeholder="Paste a new key to replace the saved key"></label>
        <div class="key-state"><span>Stored key: <b>${esc(secret.openai?.masked || 'Not configured')}</b></span><span><button type="button" class="ghost-button" data-test-provider="openai">Test</button> <button type="button" class="danger-button" data-remove-key="openai">Remove</button></span></div>
        <label>DeepSeek model<input name="deepseek_model" value="${esc(s.deepseek_model || 'deepseek-v4-flash')}"></label>
        <label>DeepSeek base URL<input name="deepseek_base_url" value="${esc(s.deepseek_base_url || 'https://api.deepseek.com')}"></label>
        <label>DeepSeek API key<input name="deepseek_key" type="password" autocomplete="off" placeholder="Paste a new key to replace the saved key"></label>
        <div class="key-state"><span>Stored key: <b>${esc(secret.deepseek?.masked || 'Not configured')}</b></span><span><button type="button" class="ghost-button" data-test-provider="deepseek">Test</button> <button type="button" class="danger-button" data-remove-key="deepseek">Remove</button></span></div>
        <p class="muted">Secure storage: ${secret.secureStorageAvailable ? 'Available' : 'Unavailable — keys cannot be saved on this system.'}</p>
      </article>
      <article class="setting-block"><div class="panel-header"><div><h3>Workspace behavior</h3><p>Local notifications and backup retention</p></div></div>
        <label>Windows notifications<select name="notifications_enabled"><option value="1" ${s.notifications_enabled==='1'?'selected':''}>Enabled</option><option value="0" ${s.notifications_enabled==='0'?'selected':''}>Disabled</option></select></label>
        <label>Automatic daily backup<select name="automatic_backups"><option value="1" ${s.automatic_backups==='1'?'selected':''}>Enabled</option><option value="0" ${s.automatic_backups==='0'?'selected':''}>Disabled</option></select></label>
        <label>Backups to retain<input name="backup_retention" type="number" min="1" max="50" value="${esc(s.backup_retention || '10')}"></label>
        <div><button class="primary-button" type="submit" data-testid="save-settings">Save settings</button></div>
      </article>
      <article class="panel-card" style="grid-column:1/-1"><div class="panel-header"><div><h3>Database backups</h3><p>Manual and automatic copies of the local SQLite workspace</p></div><div><button type="button" class="secondary-button" id="open-backups">Open folder</button> <button type="button" class="primary-button" id="create-backup">Create backup</button></div></div><div class="list">${backupRows || emptyMini('No backups recorded','Create a backup before major changes.')}</div></article>
    </form>`;
}

function renderAbout() {
  return `${sectionHeader('About','A local-first office assistant built for controlled, practical work.')}
    <div class="grid split-grid"><article class="panel-card"><p class="eyebrow">PRODUCT</p><h2>Nexa Smart Office Bot</h2><p class="muted">Version ${esc(state.meta?.version || '1.0.0')}</p><p>Contacts, leads, agenda, tasks, alerts, backups and approval-only AI suggestions in one Windows desktop application.</p></article>
    <article class="panel-card"><p class="eyebrow">PRIVACY</p><h3>Your business data stays local</h3><p class="muted">The SQLite workspace and backups are stored on this computer. Only the context required for a suggestion is sent to the AI provider you select.</p></article>
    <article class="panel-card"><p class="eyebrow">AI CONTROL</p><h3>No automatic actions</h3><p class="muted">Nexa never sends messages, changes customer records, creates appointments or deletes data based only on an AI response.</p></article>
    <article class="panel-card"><p class="eyebrow">DATA LOCATION</p><h3>Local application data</h3><p class="muted">${esc(state.meta?.dataPath || 'Available after application startup')}</p></article></div>`;
}

function field(name, label, value = '', options = {}) {
  const cls = options.full ? 'span-2' : '';
  if (options.type === 'textarea') return `<label class="${cls}">${esc(label)}<textarea name="${name}">${esc(value)}</textarea></label>`;
  if (options.type === 'select') return `<label class="${cls}">${esc(label)}<select name="${name}">${options.items.map(([v,l]) => `<option value="${esc(v)}" ${String(value)===String(v)?'selected':''}>${esc(l)}</option>`).join('')}</select></label>`;
  return `<label class="${cls}">${esc(label)}<input name="${name}" type="${options.type || 'text'}" value="${esc(value)}" ${options.step ? `step="${options.step}"` : ''}></label>`;
}

function openEntity(type, record = {}) {
  entityForm.dataset.type = type;
  entityForm.dataset.id = record.id || '';
  dialogEyebrow.textContent = type.toUpperCase();
  dialogTitle.textContent = `${record.id ? 'Edit' : 'New'} ${type}`;
  let html = '';
  if (type === 'contact') html = field('name','Name',record.name,'') + field('company','Company',record.company) + field('phone','Phone',record.phone) + field('email','Email',record.email,{type:'email'}) + field('tags','Tags',record.tags,{full:true}) + field('notes','Notes',record.notes,{type:'textarea',full:true});
  if (type === 'lead') html = field('name','Lead name',record.name) + field('company','Company',record.company) + field('phone','Phone',record.phone) + field('email','Email',record.email,{type:'email'}) + field('contact_id','Related contact',record.contact_id,{type:'select',items:[['','None'],...state.contacts.map((x)=>[x.id,x.name])]}) + field('source','Source',record.source) + field('status','Status',record.status || 'New',{type:'select',items:['New','Contacted','Interested','Follow-up','Qualified','Won','Lost'].map((x)=>[x,x])}) + field('priority','Priority',record.priority || 'Medium',{type:'select',items:['Low','Medium','High'].map((x)=>[x,x])}) + field('estimated_value','Estimated value',record.estimated_value || 0,{type:'number',step:'0.01'}) + field('next_follow_up','Next follow-up',inputDateTime(record.next_follow_up),{type:'datetime-local'}) + field('notes','Notes',record.notes,{type:'textarea',full:true});
  if (type === 'task') html = field('title','Task title',record.title,{full:true}) + field('due_at','Due date',inputDateTime(record.due_at),{type:'datetime-local'}) + field('reminder_at','Reminder',inputDateTime(record.reminder_at),{type:'datetime-local'}) + field('priority','Priority',record.priority || 'Medium',{type:'select',items:['Low','Medium','High'].map((x)=>[x,x])}) + field('status','Status',record.status || 'Pending',{type:'select',items:['Pending','Completed','Canceled'].map((x)=>[x,x])}) + field('description','Description',record.description,{type:'textarea',full:true});
  if (type === 'appointment') html = field('title','Title',record.title,{full:true}) + field('start_at','Starts',inputDateTime(record.start_at),{type:'datetime-local'}) + field('end_at','Ends',inputDateTime(record.end_at),{type:'datetime-local'}) + field('reminder_at','Reminder',inputDateTime(record.reminder_at),{type:'datetime-local'}) + field('status','Status',record.status || 'Scheduled',{type:'select',items:['Scheduled','Completed','Canceled'].map((x)=>[x,x])}) + field('contact_id','Contact',record.contact_id,{type:'select',items:[['','None'],...state.contacts.map((x)=>[x.id,x.name])]}) + field('lead_id','Lead',record.lead_id,{type:'select',items:[['','None'],...state.leads.map((x)=>[x.id,x.name])]}) + field('description','Description',record.description,{type:'textarea',full:true});
  dialogFields.innerHTML = html;
  entityDialog.showModal();
}

async function submitEntity(event) {
  event.preventDefault();
  const type = entityForm.dataset.type;
  const data = Object.fromEntries(new FormData(entityForm).entries());
  if (entityForm.dataset.id) data.id = entityForm.dataset.id;
  for (const key of ['due_at','reminder_at','next_follow_up','start_at','end_at']) if (key in data) data[key] = toIso(data[key]);
  if (type === 'contact') await api.contacts.save(data);
  if (type === 'lead') await api.leads.save(data);
  if (type === 'task') await api.tasks.save(data);
  if (type === 'appointment') await api.appointments.save(data);
  entityDialog.close();
  toast(`${type[0].toUpperCase()+type.slice(1)} saved.`);
  await refreshAll();
}

function populateAIRelated() {
  const type = document.getElementById('ai-related-type')?.value || '';
  const select = document.getElementById('ai-related-id');
  if (!select) return;
  const collection = type === 'lead' ? state.leads : type === 'contact' ? state.contacts : type === 'task' ? state.tasks : type === 'appointment' ? state.appointments : [];
  select.innerHTML = '<option value="">None selected</option>' + collection.map((x) => `<option value="${x.id}">${esc(x.name || x.title)}</option>`).join('');
}

async function generateAI() {
  const provider = document.getElementById('ai-provider').value;
  if (!state.settings?.secrets?.[provider]?.configured) {
    toast(`${provider === 'openai' ? 'OpenAI' : 'DeepSeek'} is not configured.`, 'error');
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
      provider,
      kind: document.getElementById('ai-kind').value,
      related_type: document.getElementById('ai-related-type').value,
      related_id: document.getElementById('ai-related-id').value,
      focus: document.getElementById('ai-focus').value
    });
    state.aiResult = result.suggestion.response;
    toast('Suggestion generated.');
    await refreshAll({ render:false });
  } catch (error) {
    toast(error.message, 'error');
  } finally {
    state.activeAIRequest = null;
    renderView();
  }
}

async function bindViewEvents() {
  document.querySelectorAll('[data-go]').forEach((el) => el.addEventListener('click', () => navigate(el.dataset.go)));
  const search = document.getElementById('view-search');
  if (search) search.addEventListener('input', (event) => { state.search = event.target.value; renderView(); document.getElementById('view-search')?.focus(); });

  document.querySelectorAll('[data-action="add-contact"]').forEach((x) => x.addEventListener('click', () => openEntity('contact')));
  document.querySelectorAll('[data-action="add-lead"]').forEach((x) => x.addEventListener('click', () => openEntity('lead')));
  document.querySelectorAll('[data-action="add-task"]').forEach((x) => x.addEventListener('click', () => openEntity('task')));
  document.querySelectorAll('[data-action="add-appointment"]').forEach((x) => x.addEventListener('click', () => openEntity('appointment')));

  document.querySelectorAll('[data-edit-contact]').forEach((x) => x.addEventListener('click', () => openEntity('contact', state.contacts.find((r) => r.id === x.dataset.editContact))));
  document.querySelectorAll('[data-edit-lead]').forEach((x) => x.addEventListener('click', () => openEntity('lead', state.leads.find((r) => r.id === x.dataset.editLead))));
  document.querySelectorAll('[data-edit-task]').forEach((x) => x.addEventListener('click', () => openEntity('task', state.tasks.find((r) => r.id === x.dataset.editTask))));
  document.querySelectorAll('[data-edit-appointment]').forEach((x) => x.addEventListener('click', () => openEntity('appointment', state.appointments.find((r) => r.id === x.dataset.editAppointment))));

  bindDeletes('contact', state.contacts, api.contacts.delete);
  bindDeletes('lead', state.leads, api.leads.delete);
  bindDeletes('task', state.tasks, api.tasks.delete);
  bindDeletes('appointment', state.appointments, api.appointments.delete);

  document.querySelectorAll('[data-toggle-task]').forEach((x) => x.addEventListener('change', async () => { await api.tasks.toggle(x.dataset.toggleTask); await refreshAll(); }));
  document.querySelectorAll('[data-ai-lead]').forEach((x) => x.addEventListener('click', () => { navigate('ai'); setTimeout(() => { document.getElementById('ai-kind').value='lead_next_step'; document.getElementById('ai-related-type').value='lead'; populateAIRelated(); document.getElementById('ai-related-id').value=x.dataset.aiLead; },0); }));

  if (state.view === 'ai') {
    document.getElementById('ai-related-type').addEventListener('change', populateAIRelated);
    document.getElementById('ai-generate').addEventListener('click', generateAI);
    document.getElementById('ai-cancel').addEventListener('click', async () => { if (state.activeAIRequest) await api.ai.cancel(state.activeAIRequest); });
    document.querySelectorAll('[data-show-suggestion]').forEach((x) => x.addEventListener('click', () => { const s=state.suggestions.find((r)=>r.id===x.dataset.showSuggestion); state.aiResult=s?.response || ''; renderView(); }));
  }

  const settingsForm = document.getElementById('settings-form');
  if (settingsForm) {
    settingsForm.addEventListener('submit', async (event) => {
      event.preventDefault();
      const data = Object.fromEntries(new FormData(settingsForm).entries());
      await api.settings.save(data);
      toast('Settings saved.');
      await refreshAll();
    });
    document.querySelectorAll('[data-test-provider]').forEach((x) => x.addEventListener('click', async () => { try { x.disabled=true; await api.ai.test(x.dataset.testProvider); toast(`${x.dataset.testProvider} connection successful.`); } catch(error) { toast(error.message,'error'); } finally { x.disabled=false; } }));
    document.querySelectorAll('[data-remove-key]').forEach((x) => x.addEventListener('click', async () => { if (await confirmAction('Remove API key','The encrypted key will be deleted from this computer.')) { await api.settings.removeKey(x.dataset.removeKey); toast('API key removed.'); await refreshAll(); } }));
    document.getElementById('create-backup').addEventListener('click', async () => { await api.backups.create(); toast('Backup created.'); await refreshAll(); });
    document.getElementById('open-backups').addEventListener('click', () => api.backups.openFolder());
    document.querySelectorAll('[data-restore-backup]').forEach((x) => x.addEventListener('click', async () => { const result=await api.backups.restore(x.dataset.restoreBackup); if (result.restored) { toast('Backup restored.'); await refreshAll(); } }));
  }
}

function bindDeletes(type, collection, deleter) {
  document.querySelectorAll(`[data-delete-${type}]`).forEach((button) => button.addEventListener('click', async () => {
    const recordId = button.dataset[`delete${type[0].toUpperCase()+type.slice(1)}`];
    const record = collection.find((x) => x.id === recordId);
    if (!await confirmAction(`Delete ${type}`, `Delete “${record?.name || record?.title || type}”? This action cannot be undone.`)) return;
    await deleter(recordId);
    toast(`${type[0].toUpperCase()+type.slice(1)} deleted.`);
    await refreshAll();
  }));
}

document.querySelectorAll('.nav-item').forEach((button) => button.addEventListener('click', () => navigate(button.dataset.view)));
document.getElementById('refresh-button').addEventListener('click', async () => { setLoading(); await refreshAll(); toast('Workspace refreshed.'); });
document.getElementById('quick-add-button').addEventListener('click', () => openEntity('task'));
document.querySelectorAll('[data-close-dialog]').forEach((button) => button.addEventListener('click', () => entityDialog.close()));
entityForm.addEventListener('submit', (event) => submitEntity(event).catch((error) => toast(error.message,'error')));

(async function init() {
  try {
    setLoading();
    await refreshAll();
    document.body.dataset.ready = 'true';
    setInterval(async () => {
      try {
        state.alerts = await api.alerts.list();
        document.getElementById('alert-count').textContent = String(state.alerts.length);
        if (state.view === 'alerts' || state.view === 'dashboard') {
          state.dashboard = await api.dashboard.summary();
          renderView();
        }
      } catch (_) { /* transient refresh errors stay out of the way */ }
    }, 60000);
  } catch (error) {
    content.innerHTML = `<div class="empty-state"><div><b>Application startup failed</b>${esc(error.message)}</div></div>`;
    window.__NEXA_ERRORS__.push(error.message);
  }
})();
