'use strict';

const { DatabaseSync } = require('node:sqlite');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { applyMigrations } = require('./migrations');

const nowIso = () => new Date().toISOString();
const id = () => crypto.randomUUID();
const normalizeText = (value) => String(value ?? '').trim();
const nullable = (value) => {
  const text = normalizeText(value);
  return text === '' ? null : text;
};
const normalizePhone = (value) => {
  const digits = String(value ?? '').replace(/\D+/g, '');
  if (!digits) return '';
  if (digits.length === 11 && digits.startsWith('1')) return digits.slice(1);
  if (digits.length >= 10) return digits.slice(-10);
  return digits;
};
const normalizeEmail = (value) => normalizeText(value).toLowerCase();
const integrationItemIdentity = (resource, item, index = 0) => {
  if (!item || typeof item !== 'object') return `${resource}:${index}`;
  const keysByResource = {
    agenda: ['contact_id', 'id'], orders: ['order_id', 'appointment_id', 'id'], messages: ['thread_id', 'message_id', 'id'],
    listings: ['listing_id', 'id'], resellers: ['reseller_id', 'appointment_id', 'id'], stores: ['store_id', 'id'],
    users: ['user_id', 'account_id', 'id'], validation: ['validation_id', 'id'], 'reseller-profile': ['reseller_id', 'id'],
    'reseller-listings': ['assignment_id', 'listing_id', 'id'], 'reseller-appointments': ['appointment_id', 'id'],
    store: ['store_id', 'id'], 'dealer-summary': ['store_id', 'id'], 'reseller-summary': ['reseller_id', 'id'],
    'admin-summary': ['id'], 'api-keys-status': ['id']
  };
  const keys = keysByResource[resource] || ['id', 'uuid'];
  for (const key of keys) {
    if (item[key] !== undefined && item[key] !== null && String(item[key]) !== '') return String(item[key]);
  }
  return crypto.createHash('sha256').update(JSON.stringify(item)).digest('hex').slice(0, 24);
};

class DatabaseService {
  constructor(databasePath) {
    this.databasePath = databasePath;
    fs.mkdirSync(path.dirname(databasePath), { recursive: true });
    this.open();
  }

  open() {
    this.db = new DatabaseSync(this.databasePath);
    this.db.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;');
    this.migrate();
  }

  close() {
    if (this.db) {
      this.db.close();
      this.db = null;
    }
  }

  transaction(fn) {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const result = fn();
      this.db.exec('COMMIT');
      return result;
    } catch (error) {
      try { this.db.exec('ROLLBACK'); } catch (_) { /* ignore rollback failure */ }
      throw error;
    }
  }

  migrate() {
    applyMigrations(this.db);
  }

  log(action, entityType, entityId = null, details = '') {
    this.db.prepare('INSERT INTO activity_logs(action, entity_type, entity_id, details, created_at) VALUES (?, ?, ?, ?, ?)')
      .run(action, entityType, entityId, normalizeText(details), nowIso());
  }

  listContacts(search = '') {
    const q = `%${normalizeText(search)}%`;
    return this.db.prepare(`
      SELECT * FROM contacts
      WHERE name LIKE ? OR COALESCE(company, '') LIKE ? OR COALESCE(email, '') LIKE ? OR COALESCE(phone, '') LIKE ? OR tags LIKE ?
      ORDER BY updated_at DESC
    `).all(q, q, q, q, q);
  }

  saveContact(data) {
    const recordId = normalizeText(data.id) || id();
    const name = normalizeText(data.name);
    if (!name) throw new Error('Contact name is required.');
    const existing = this.db.prepare('SELECT id, created_at FROM contacts WHERE id = ?').get(recordId);
    const timestamp = nowIso();
    this.db.prepare(`
      INSERT INTO contacts(id, name, company, phone, email, tags, notes, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        name=excluded.name, company=excluded.company, phone=excluded.phone, email=excluded.email,
        tags=excluded.tags, notes=excluded.notes, updated_at=excluded.updated_at
    `).run(recordId, name, nullable(data.company), nullable(data.phone), nullable(data.email), normalizeText(data.tags), normalizeText(data.notes), existing?.created_at || timestamp, timestamp);
    this.log(existing ? 'updated' : 'created', 'contact', recordId, name);
    return this.db.prepare('SELECT * FROM contacts WHERE id = ?').get(recordId);
  }

  deleteContact(recordId) {
    const result = this.db.prepare('DELETE FROM contacts WHERE id = ?').run(recordId);
    if (result.changes) this.log('deleted', 'contact', recordId);
    return result.changes > 0;
  }

  listLeads(search = '') {
    const q = `%${normalizeText(search)}%`;
    return this.db.prepare(`
      SELECT l.*, c.name AS contact_name
      FROM leads l LEFT JOIN contacts c ON c.id = l.contact_id
      WHERE l.name LIKE ? OR COALESCE(l.company, '') LIKE ? OR COALESCE(l.email, '') LIKE ? OR COALESCE(l.phone, '') LIKE ? OR l.status LIKE ?
      ORDER BY CASE l.priority WHEN 'High' THEN 1 WHEN 'Medium' THEN 2 ELSE 3 END, l.updated_at DESC
    `).all(q, q, q, q, q);
  }

  saveLead(data) {
    const recordId = normalizeText(data.id) || id();
    const name = normalizeText(data.name);
    if (!name) throw new Error('Lead name is required.');
    const timestamp = nowIso();
    const existing = this.db.prepare('SELECT id, created_at FROM leads WHERE id = ?').get(recordId);
    const allowedStatuses = new Set(['New', 'Contacted', 'Interested', 'Follow-up', 'Qualified', 'Won', 'Lost']);
    const allowedPriorities = new Set(['Low', 'Medium', 'High']);
    const status = allowedStatuses.has(data.status) ? data.status : 'New';
    const priority = allowedPriorities.has(data.priority) ? data.priority : 'Medium';
    const estimated = Number.isFinite(Number(data.estimated_value)) ? Number(data.estimated_value) : 0;
    this.db.prepare(`
      INSERT INTO leads(id, contact_id, name, company, phone, email, source, status, priority, estimated_value, next_follow_up, notes, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        contact_id=excluded.contact_id, name=excluded.name, company=excluded.company, phone=excluded.phone,
        email=excluded.email, source=excluded.source, status=excluded.status, priority=excluded.priority,
        estimated_value=excluded.estimated_value, next_follow_up=excluded.next_follow_up,
        notes=excluded.notes, updated_at=excluded.updated_at
    `).run(recordId, nullable(data.contact_id), name, nullable(data.company), nullable(data.phone), nullable(data.email), nullable(data.source), status, priority, estimated, nullable(data.next_follow_up), normalizeText(data.notes), existing?.created_at || timestamp, timestamp);
    this.log(existing ? 'updated' : 'created', 'lead', recordId, `${name} · ${status}`);
    return this.db.prepare('SELECT * FROM leads WHERE id = ?').get(recordId);
  }

  deleteLead(recordId) {
    const result = this.db.prepare('DELETE FROM leads WHERE id = ?').run(recordId);
    if (result.changes) this.log('deleted', 'lead', recordId);
    return result.changes > 0;
  }

  listTasks(search = '') {
    const q = `%${normalizeText(search)}%`;
    return this.db.prepare(`
      SELECT * FROM tasks
      WHERE title LIKE ? OR description LIKE ? OR priority LIKE ? OR status LIKE ?
      ORDER BY CASE status WHEN 'Pending' THEN 1 WHEN 'Completed' THEN 2 ELSE 3 END,
               CASE WHEN due_at IS NULL THEN 1 ELSE 0 END, due_at ASC, updated_at DESC
    `).all(q, q, q, q);
  }

  saveTask(data) {
    const recordId = normalizeText(data.id) || id();
    const title = normalizeText(data.title);
    if (!title) throw new Error('Task title is required.');
    const timestamp = nowIso();
    const existing = this.db.prepare('SELECT id, created_at FROM tasks WHERE id = ?').get(recordId);
    const priority = ['Low', 'Medium', 'High'].includes(data.priority) ? data.priority : 'Medium';
    const status = ['Pending', 'Completed', 'Canceled'].includes(data.status) ? data.status : 'Pending';
    this.db.prepare(`
      INSERT INTO tasks(id, title, description, due_at, priority, status, related_type, related_id, reminder_at, notification_sent_at, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        title=excluded.title, description=excluded.description, due_at=excluded.due_at, priority=excluded.priority,
        status=excluded.status, related_type=excluded.related_type, related_id=excluded.related_id,
        reminder_at=excluded.reminder_at,
        notification_sent_at=CASE WHEN tasks.reminder_at IS NOT excluded.reminder_at OR tasks.status IS NOT excluded.status THEN NULL ELSE tasks.notification_sent_at END,
        updated_at=excluded.updated_at
    `).run(recordId, title, normalizeText(data.description), nullable(data.due_at), priority, status, nullable(data.related_type), nullable(data.related_id), nullable(data.reminder_at), existing?.notification_sent_at || null, existing?.created_at || timestamp, timestamp);
    this.log(existing ? 'updated' : 'created', 'task', recordId, `${title} · ${status}`);
    return this.db.prepare('SELECT * FROM tasks WHERE id = ?').get(recordId);
  }

  toggleTask(recordId) {
    const task = this.db.prepare('SELECT * FROM tasks WHERE id = ?').get(recordId);
    if (!task) throw new Error('Task not found.');
    const status = task.status === 'Completed' ? 'Pending' : 'Completed';
    this.db.prepare('UPDATE tasks SET status = ?, updated_at = ? WHERE id = ?').run(status, nowIso(), recordId);
    this.log('status_changed', 'task', recordId, status);
    return this.db.prepare('SELECT * FROM tasks WHERE id = ?').get(recordId);
  }

  deleteTask(recordId) {
    const result = this.db.prepare('DELETE FROM tasks WHERE id = ?').run(recordId);
    if (result.changes) this.log('deleted', 'task', recordId);
    return result.changes > 0;
  }

  listAppointments(search = '') {
    const q = `%${normalizeText(search)}%`;
    return this.db.prepare(`
      SELECT a.*, c.name AS contact_name, l.name AS lead_name
      FROM appointments a
      LEFT JOIN contacts c ON c.id = a.contact_id
      LEFT JOIN leads l ON l.id = a.lead_id
      WHERE a.title LIKE ? OR a.description LIKE ? OR COALESCE(c.name, '') LIKE ? OR COALESCE(l.name, '') LIKE ?
      ORDER BY a.start_at ASC
    `).all(q, q, q, q);
  }

  saveAppointment(data) {
    const recordId = normalizeText(data.id) || id();
    const title = normalizeText(data.title);
    if (!title) throw new Error('Appointment title is required.');
    const startAt = normalizeText(data.start_at);
    if (!startAt) throw new Error('Appointment start date and time are required.');
    const timestamp = nowIso();
    const existing = this.db.prepare('SELECT id, created_at, notification_sent_at FROM appointments WHERE id = ?').get(recordId);
    const status = ['Scheduled', 'Completed', 'Canceled'].includes(data.status) ? data.status : 'Scheduled';
    this.db.prepare(`
      INSERT INTO appointments(id, title, description, start_at, end_at, status, contact_id, lead_id, reminder_at, notification_sent_at, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        title=excluded.title, description=excluded.description, start_at=excluded.start_at, end_at=excluded.end_at,
        status=excluded.status, contact_id=excluded.contact_id, lead_id=excluded.lead_id,
        reminder_at=excluded.reminder_at,
        notification_sent_at=CASE WHEN appointments.reminder_at IS NOT excluded.reminder_at OR appointments.status IS NOT excluded.status THEN NULL ELSE appointments.notification_sent_at END,
        updated_at=excluded.updated_at
    `).run(recordId, title, normalizeText(data.description), startAt, nullable(data.end_at), status, nullable(data.contact_id), nullable(data.lead_id), nullable(data.reminder_at), existing?.notification_sent_at || null, existing?.created_at || timestamp, timestamp);
    this.log(existing ? 'updated' : 'created', 'appointment', recordId, `${title} · ${startAt}`);
    return this.db.prepare('SELECT * FROM appointments WHERE id = ?').get(recordId);
  }

  deleteAppointment(recordId) {
    const result = this.db.prepare('DELETE FROM appointments WHERE id = ?').run(recordId);
    if (result.changes) this.log('deleted', 'appointment', recordId);
    return result.changes > 0;
  }

  listReminders() {
    return this.db.prepare('SELECT * FROM reminders ORDER BY remind_at ASC').all();
  }

  saveReminder(data) {
    const recordId = normalizeText(data.id) || id();
    const title = normalizeText(data.title);
    const remindAt = normalizeText(data.remind_at);
    if (!title || !remindAt) throw new Error('Reminder title and date are required.');
    const timestamp = nowIso();
    const existing = this.db.prepare('SELECT id, created_at FROM reminders WHERE id = ?').get(recordId);
    this.db.prepare('INSERT INTO reminders(id, entity_type, entity_id, title, remind_at, enabled, notification_sent_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET entity_type=excluded.entity_type, entity_id=excluded.entity_id, title=excluded.title, remind_at=excluded.remind_at, enabled=excluded.enabled, notification_sent_at=NULL, updated_at=excluded.updated_at')
      .run(recordId, normalizeText(data.entity_type) || 'general', nullable(data.entity_id), title, remindAt, data.enabled === false || data.enabled === 0 ? 0 : 1, null, existing?.created_at || timestamp, timestamp);
    this.log(existing ? 'updated' : 'created', 'reminder', recordId, title);
    return this.db.prepare('SELECT * FROM reminders WHERE id = ?').get(recordId);
  }

  toggleReminder(recordId) {
    const row = this.db.prepare('SELECT enabled FROM reminders WHERE id = ?').get(recordId);
    if (!row) throw new Error('Reminder not found.');
    const enabled = Number(row.enabled) === 1 ? 0 : 1;
    this.db.prepare('UPDATE reminders SET enabled = ?, notification_sent_at = NULL, updated_at = ? WHERE id = ?').run(enabled, nowIso(), recordId);
    this.log('toggled', 'reminder', recordId, enabled ? 'enabled' : 'disabled');
    return this.db.prepare('SELECT * FROM reminders WHERE id = ?').get(recordId);
  }

  dashboardSummary() {
    const scalar = (sql, ...params) => Number(this.db.prepare(sql).get(...params).value || 0);
    const now = nowIso();
    const today = now.slice(0, 10);
    const weekEnd = new Date(Date.now() + 7 * 86400000).toISOString();
    return {
      contacts: scalar('SELECT COUNT(*) AS value FROM contacts'),
      activeLeads: scalar("SELECT COUNT(*) AS value FROM leads WHERE status NOT IN ('Won','Lost')"),
      followUps: scalar("SELECT COUNT(*) AS value FROM leads WHERE status NOT IN ('Won','Lost') AND next_follow_up IS NOT NULL AND next_follow_up <= ?", weekEnd),
      pendingTasks: scalar("SELECT COUNT(*) AS value FROM tasks WHERE status='Pending'"),
      overdueTasks: scalar("SELECT COUNT(*) AS value FROM tasks WHERE status='Pending' AND due_at IS NOT NULL AND due_at < ?", now),
      todayAppointments: scalar("SELECT COUNT(*) AS value FROM appointments WHERE substr(start_at, 1, 10)=? AND status='Scheduled'", today),
      activeAlerts: this.listAlerts().length,
      upcoming: this.db.prepare("SELECT * FROM appointments WHERE status='Scheduled' AND start_at >= ? ORDER BY start_at LIMIT 6").all(now),
      priorities: this.db.prepare("SELECT * FROM tasks WHERE status='Pending' ORDER BY CASE priority WHEN 'High' THEN 1 WHEN 'Medium' THEN 2 ELSE 3 END, due_at LIMIT 6").all()
    };
  }

  listAlerts() {
    const now = nowIso();
    const next24h = new Date(Date.now() + 24 * 3600000).toISOString();
    const alerts = [];
    for (const task of this.db.prepare("SELECT * FROM tasks WHERE status='Pending' AND due_at IS NOT NULL AND due_at < ? ORDER BY due_at").all(now)) {
      alerts.push({ id: `task-overdue-${task.id}`, level: 'danger', type: 'Overdue task', title: task.title, date: task.due_at, entity_type: 'task', entity_id: task.id });
    }
    for (const lead of this.db.prepare("SELECT * FROM leads WHERE status NOT IN ('Won','Lost') AND next_follow_up IS NOT NULL AND next_follow_up <= ? ORDER BY next_follow_up").all(now)) {
      alerts.push({ id: `lead-followup-${lead.id}`, level: 'warning', type: 'Lead follow-up', title: lead.name, date: lead.next_follow_up, entity_type: 'lead', entity_id: lead.id });
    }
    for (const appointment of this.db.prepare("SELECT * FROM appointments WHERE status='Scheduled' AND start_at >= ? AND start_at <= ? ORDER BY start_at").all(now, next24h)) {
      alerts.push({ id: `appointment-upcoming-${appointment.id}`, level: 'info', type: 'Upcoming appointment', title: appointment.title, date: appointment.start_at, entity_type: 'appointment', entity_id: appointment.id });
    }
    return alerts.slice(0, 100);
  }

  dueNotifications() {
    const now = nowIso();
    const taskRows = this.db.prepare("SELECT id, title, reminder_at FROM tasks WHERE status='Pending' AND reminder_at IS NOT NULL AND reminder_at <= ? AND notification_sent_at IS NULL").all(now);
    const appointmentRows = this.db.prepare("SELECT id, title, reminder_at FROM appointments WHERE status='Scheduled' AND reminder_at IS NOT NULL AND reminder_at <= ? AND notification_sent_at IS NULL").all(now);
    const reminderRows = this.db.prepare('SELECT id, title, remind_at AS reminder_at FROM reminders WHERE enabled=1 AND remind_at <= ? AND notification_sent_at IS NULL').all(now);
    return [
      ...taskRows.map((row) => ({ ...row, entity_type: 'task', body: 'Task reminder' })),
      ...appointmentRows.map((row) => ({ ...row, entity_type: 'appointment', body: 'Appointment reminder' })),
      ...reminderRows.map((row) => ({ ...row, entity_type: 'reminder', body: 'Reminder' }))
    ];
  }

  markNotificationSent(entityType, recordId) {
    if (entityType === 'task') this.db.prepare('UPDATE tasks SET notification_sent_at=? WHERE id=?').run(nowIso(), recordId);
    if (entityType === 'appointment') this.db.prepare('UPDATE appointments SET notification_sent_at=? WHERE id=?').run(nowIso(), recordId);
    if (entityType === 'reminder') this.db.prepare('UPDATE reminders SET notification_sent_at=? WHERE id=?').run(nowIso(), recordId);
  }

  listActivity(limit = 100) {
    const safeLimit = Math.min(Math.max(Number(limit) || 100, 1), 500);
    return this.db.prepare('SELECT * FROM activity_logs ORDER BY id DESC LIMIT ?').all(safeLimit);
  }

  getSettings() {
    const rows = this.db.prepare('SELECT key, value FROM settings').all();
    return Object.fromEntries(rows.map((row) => [row.key, row.value]));
  }

  saveSettings(values) {
    const allowed = new Set(['preferred_provider', 'openai_model', 'deepseek_model', 'deepseek_base_url', 'notifications_enabled', 'automatic_backups', 'backup_retention', 'automarket_base_url', 'automarket_sync_enabled', 'automarket_poll_minutes', 'notifications_user_consent', 'notifications_consent_at', 'notifications_sound', 'notifications_minimize_to_tray', 'notifications_start_with_windows', 'notifications_quiet_start', 'notifications_quiet_end', 'message_realtime_enabled', 'message_poll_seconds', 'message_ai_mode', 'message_ai_fallback', 'message_learning_enabled', 'message_send_confirmation']);
    const statement = this.db.prepare(`
      INSERT INTO settings(key, value, updated_at) VALUES (?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at
    `);
    this.transaction(() => {
      for (const [key, value] of Object.entries(values || {})) {
        if (!allowed.has(key)) continue;
        statement.run(key, normalizeText(value), nowIso());
      }
    });
    this.log('updated', 'settings', null, Object.keys(values || {}).join(', '));
    return this.getSettings();
  }

  saveSuggestion(data) {
    const suggestionId = id();
    this.db.prepare(`INSERT INTO ai_suggestions(id, provider, kind, related_type, related_id, prompt, response, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(suggestionId, data.provider, data.kind, nullable(data.related_type), nullable(data.related_id), data.prompt, data.response, nowIso());
    this.log('generated', 'ai_suggestion', suggestionId, `${data.provider} · ${data.kind}`);
    return this.db.prepare('SELECT * FROM ai_suggestions WHERE id = ?').get(suggestionId);
  }

  listSuggestions(limit = 50) {
    return this.db.prepare('SELECT * FROM ai_suggestions ORDER BY created_at DESC LIMIT ?').all(Math.min(Math.max(Number(limit) || 50, 1), 200));
  }

  getEntityContext(type, entityId) {
    if (!entityId) return null;
    if (type === 'contact') return this.db.prepare('SELECT * FROM contacts WHERE id = ?').get(entityId) || null;
    if (type === 'lead') return this.db.prepare('SELECT * FROM leads WHERE id = ?').get(entityId) || null;
    if (type === 'task') return this.db.prepare('SELECT * FROM tasks WHERE id = ?').get(entityId) || null;
    if (type === 'appointment') return this.db.prepare('SELECT * FROM appointments WHERE id = ?').get(entityId) || null;
    if (type === 'message') return this.getMessageConversationContext(entityId, 80);
    if (type === 'order') return this.findIntegrationCacheItem(['orders','reseller-appointments'], entityId);
    return null;
  }

  dailyContext() {
    const connectedStatus = this.getIntegrationStatus();
    const connectedSummary = this.listIntegrationCache('dealer-summary', '', 1)[0]
      || this.listIntegrationCache('reseller-summary', '', 1)[0]
      || this.listIntegrationCache('admin-summary', '', 1)[0]
      || {};
    const connectedListings = this.listIntegrationCache('listings', '', 30).concat(this.listIntegrationCache('reseller-listings', '', 30));
    return {
      summary: this.dashboardSummary(),
      alerts: this.listAlerts().slice(0, 20),
      leads: this.db.prepare("SELECT id, name, company, status, priority, next_follow_up, notes FROM leads WHERE status NOT IN ('Won','Lost') ORDER BY next_follow_up LIMIT 20").all(),
      tasks: this.db.prepare("SELECT id, title, due_at, priority, status, description FROM tasks WHERE status='Pending' ORDER BY due_at LIMIT 20").all(),
      appointments: this.db.prepare("SELECT id, title, start_at, status, description FROM appointments WHERE status='Scheduled' AND start_at >= ? ORDER BY start_at LIMIT 20").all(nowIso()),
      connected_business: {
        connected: Number(connectedStatus.connected || 0) === 1,
        account_type: connectedStatus.account_type || null,
        store_id: connectedStatus.store_id || null,
        sync_state: connectedStatus.sync_state || 'idle',
        last_sync_at: connectedStatus.last_sync_at || null,
        summary: connectedSummary,
        recent_orders: this.listIntegrationCache('orders', '', 40),
        reseller_appointments: this.listIntegrationCache('reseller-appointments', '', 15),
        agenda_contacts: this.listIntegrationCache('agenda', '', 15),
        unread_message_threads: this.listIntegrationCache('messages', '', 40).filter(function unread(item) { return Number(item.unread_count || 0) > 0 || Number(item.is_announcement || 0) === 1; }),
        listings_needing_attention: connectedListings.filter(function needsAttention(item) {
          return !item.main_image_url || item.price === null || item.price === undefined || Number(item.price) <= 0 || String(item.status || '').toLowerCase() !== 'active';
        }).slice(0, 15),
        resellers: this.listIntegrationCache('resellers', '', 15)
      }
    };
  }


  saveMessageThreadSnapshot(thread, entries, options) {
    const source = thread && typeof thread === 'object' ? thread : {};
    const threadId = normalizeText(source.thread_id || source.id || (options && options.thread_id));
    if (!threadId) throw new Error('Message thread ID is required.');
    const rows = Array.isArray(entries) ? entries : [];
    const timestamp = nowIso();
    const existing = this.db.prepare('SELECT thread_id FROM message_threads WHERE thread_id=?').get(threadId);
    const last = rows.length ? rows[rows.length - 1] : null;
    const payloadJson = JSON.stringify(source);
    this.transaction(() => {
      this.db.prepare(`
        INSERT INTO message_threads(thread_id, subject, context_type, context_id, participant_name, participant_type,
          can_reply, is_announcement, last_message_id, last_message_at, sync_cursor, last_synced_at, payload_json, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(thread_id) DO UPDATE SET subject=excluded.subject, context_type=excluded.context_type,
          context_id=excluded.context_id, participant_name=excluded.participant_name, participant_type=excluded.participant_type,
          can_reply=excluded.can_reply, is_announcement=excluded.is_announcement, last_message_id=excluded.last_message_id,
          last_message_at=excluded.last_message_at, sync_cursor=excluded.sync_cursor, last_synced_at=excluded.last_synced_at,
          payload_json=excluded.payload_json, updated_at=excluded.updated_at
      `).run(
        threadId,
        normalizeText(source.subject || 'Conversation'),
        normalizeText(source.context_type), nullable(source.context_id),
        normalizeText(source.participant_name || source.customer_name || source.sender_name),
        normalizeText(source.participant_type || source.sender_type),
        source.can_reply === false || Number(source.can_reply) === 0 ? 0 : 1,
        Number(Boolean(source.is_announcement)),
        nullable(source.last_message_id || (last && (last.message_id || last.id))),
        nullable(source.last_message_at || (last && (last.sent_at || last.created_at))),
        nullable(source.next_cursor || source.sync_cursor || (options && options.cursor)),
        timestamp, payloadJson, timestamp
      );
      const upsert = this.db.prepare(`
        INSERT INTO message_entries(message_id, thread_id, sender_type, sender_id, sender_name, receiver_type,
          direction, body, body_format, sent_at, status, is_read, payload_json, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(message_id) DO UPDATE SET sender_type=excluded.sender_type, sender_id=excluded.sender_id,
          sender_name=excluded.sender_name, receiver_type=excluded.receiver_type, direction=excluded.direction,
          body=excluded.body, body_format=excluded.body_format, sent_at=excluded.sent_at, status=excluded.status,
          is_read=excluded.is_read, payload_json=excluded.payload_json, updated_at=excluded.updated_at
      `);
      rows.forEach((entry, index) => {
        const messageId = normalizeText(entry && (entry.message_id || entry.id)) || crypto.createHash('sha256').update(threadId + ':' + index + ':' + JSON.stringify(entry || {})).digest('hex').slice(0, 32);
        const sentAt = nullable(entry && (entry.sent_at || entry.created_at || entry.updated_at));
        const direction = normalizeText(entry && entry.direction) || (String(entry && entry.sender_type || '').toLowerCase().includes('dealer') || String(entry && entry.sender_type || '').toLowerCase().includes('admin') ? 'outbound' : 'inbound');
        const createdAt = sentAt || timestamp;
        upsert.run(
          messageId, threadId, normalizeText(entry && entry.sender_type), nullable(entry && entry.sender_id),
          normalizeText(entry && (entry.sender_name || entry.customer_name)), normalizeText(entry && entry.receiver_type),
          direction, normalizeText(entry && (entry.body || entry.message || entry.text || entry.content)),
          normalizeText(entry && entry.body_format) || 'text', sentAt, normalizeText(entry && entry.status),
          Number(Boolean(entry && entry.is_read)), JSON.stringify(entry || {}), createdAt, timestamp
        );
      });
    });
    this.log(existing ? 'synced' : 'created', 'message_thread', threadId, rows.length + ' message(s) cached');
    return this.getMessageConversationContext(threadId, 200);
  }

  getMessageConversationContext(threadId, limit = 100) {
    const wanted = normalizeText(threadId);
    if (!wanted) return null;
    const thread = this.db.prepare('SELECT * FROM message_threads WHERE thread_id=?').get(wanted)
      || this.findIntegrationCacheItem(['messages'], wanted)
      || { thread_id: wanted, subject: 'Conversation', can_reply: 0 };
    const safeLimit = Math.min(Math.max(Number(limit) || 100, 1), 500);
    const messages = this.db.prepare('SELECT * FROM message_entries WHERE thread_id=? ORDER BY COALESCE(sent_at, created_at) ASC LIMIT ?').all(wanted, safeLimit);
    const drafts = this.db.prepare('SELECT * FROM message_reply_drafts WHERE thread_id=? ORDER BY created_at DESC LIMIT 20').all(wanted);
    const outbox = this.db.prepare('SELECT * FROM message_outbox WHERE thread_id=? ORDER BY created_at DESC LIMIT 20').all(wanted);
    return { thread: thread, messages: messages, drafts: drafts, outbox: outbox };
  }

  saveMessageDraft(values) {
    const draftId = normalizeText(values && values.id) || id();
    const threadId = normalizeText(values && values.thread_id);
    const body = normalizeText(values && values.body);
    if (!threadId || !body) throw new Error('Thread and reply text are required.');
    const timestamp = nowIso();
    this.db.prepare(`
      INSERT INTO message_reply_drafts(id, thread_id, source, provider, confidence, trigger_text, body, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET source=excluded.source, provider=excluded.provider, confidence=excluded.confidence,
        trigger_text=excluded.trigger_text, body=excluded.body, status=excluded.status, updated_at=excluded.updated_at
    `).run(draftId, threadId, normalizeText(values.source || 'manual'), nullable(values.provider), Number(values.confidence || 0),
      normalizeText(values.trigger_text), body, normalizeText(values.status || 'draft'), timestamp, timestamp);
    this.log('created', 'message_reply_draft', draftId, normalizeText(values.source || 'manual'));
    return this.db.prepare('SELECT * FROM message_reply_drafts WHERE id=?').get(draftId);
  }

  markMessageDraftSent(draftId, remoteMessageId) {
    if (!draftId) return null;
    this.db.prepare("UPDATE message_reply_drafts SET status='sent', sent_message_id=?, updated_at=? WHERE id=?")
      .run(nullable(remoteMessageId), nowIso(), normalizeText(draftId));
    return this.db.prepare('SELECT * FROM message_reply_drafts WHERE id=?').get(normalizeText(draftId)) || null;
  }

  createMessageOutbox(values) {
    const clientId = normalizeText(values && values.client_message_id) || id();
    const timestamp = nowIso();
    this.db.prepare(`
      INSERT INTO message_outbox(client_message_id, thread_id, body, status, error, created_at, updated_at)
      VALUES (?, ?, ?, 'pending', '', ?, ?)
      ON CONFLICT(client_message_id) DO NOTHING
    `).run(clientId, normalizeText(values.thread_id), normalizeText(values.body), timestamp, timestamp);
    return this.db.prepare('SELECT * FROM message_outbox WHERE client_message_id=?').get(clientId);
  }

  updateMessageOutbox(clientId, values) {
    const status = normalizeText(values && values.status) || 'pending';
    const sentAt = status === 'sent' ? nowIso() : null;
    this.db.prepare('UPDATE message_outbox SET status=?, error=?, remote_message_id=?, sent_at=COALESCE(?, sent_at), updated_at=? WHERE client_message_id=?')
      .run(status, normalizeText(values && values.error), nullable(values && values.remote_message_id), sentAt, nowIso(), normalizeText(clientId));
    return this.db.prepare('SELECT * FROM message_outbox WHERE client_message_id=?').get(normalizeText(clientId)) || null;
  }

  listResponseKnowledge(search = '') {
    const q = '%' + normalizeText(search).toLowerCase() + '%';
    return this.db.prepare(`SELECT * FROM response_knowledge
      WHERE lower(label) LIKE ? OR lower(category) LIKE ? OR lower(triggers) LIKE ? OR lower(response) LIKE ?
      ORDER BY enabled DESC, use_count DESC, updated_at DESC`).all(q, q, q, q);
  }

  saveResponseKnowledge(values) {
    const knowledgeId = normalizeText(values && values.id) || id();
    const label = normalizeText(values && values.label) || 'Approved reply';
    const triggers = normalizeText(values && values.triggers);
    const response = normalizeText(values && values.response);
    if (!triggers || !response) throw new Error('Knowledge triggers and response are required.');
    const timestamp = nowIso();
    this.db.prepare(`
      INSERT INTO response_knowledge(id, label, category, triggers, response, enabled, use_count, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?)
      ON CONFLICT(id) DO UPDATE SET label=excluded.label, category=excluded.category, triggers=excluded.triggers,
        response=excluded.response, enabled=excluded.enabled, updated_at=excluded.updated_at
    `).run(knowledgeId, label, normalizeText(values.category || 'General'), triggers, response,
      values.enabled === false || Number(values.enabled) === 0 ? 0 : 1, timestamp, timestamp);
    this.log('saved', 'response_knowledge', knowledgeId, label);
    return this.db.prepare('SELECT * FROM response_knowledge WHERE id=?').get(knowledgeId);
  }

  deleteResponseKnowledge(knowledgeId) {
    const result = this.db.prepare('DELETE FROM response_knowledge WHERE id=?').run(normalizeText(knowledgeId));
    if (result.changes) this.log('deleted', 'response_knowledge', normalizeText(knowledgeId));
    return result.changes > 0;
  }

  incrementKnowledgeUse(knowledgeId) {
    this.db.prepare('UPDATE response_knowledge SET use_count=use_count+1, updated_at=? WHERE id=?').run(nowIso(), normalizeText(knowledgeId));
  }



  getIntegrationStatus() {
    return this.db.prepare("SELECT * FROM integration_status WHERE integration_id='automarket'").get() || {
      integration_id: 'automarket', connected: 0, account_type: null, account_id: null, store_id: null,
      owner_type: null, owner_id: null, user_id: null, api_version: null, scopes_json: '[]', connection_map_json: '{}',
      sync_state: 'idle', last_sync_at: null, last_attempt_at: null, last_success_at: null,
      resource_success_count: 0, resource_failure_count: 0, last_error: '', updated_at: null
    };
  }

  saveIntegrationStatus(values) {
    const current = this.getIntegrationStatus();
    const next = Object.assign({}, current, values || {});
    this.db.prepare(`
      INSERT INTO integration_status(
        integration_id, connected, account_type, account_id, store_id, scopes_json, connection_map_json,
        last_sync_at, last_error, updated_at, owner_type, owner_id, user_id, api_version, sync_state,
        last_attempt_at, last_success_at, resource_success_count, resource_failure_count
      ) VALUES ('automarket', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(integration_id) DO UPDATE SET
        connected=excluded.connected, account_type=excluded.account_type, account_id=excluded.account_id,
        store_id=excluded.store_id, scopes_json=excluded.scopes_json, connection_map_json=excluded.connection_map_json,
        last_sync_at=excluded.last_sync_at, last_error=excluded.last_error, updated_at=excluded.updated_at,
        owner_type=excluded.owner_type, owner_id=excluded.owner_id, user_id=excluded.user_id,
        api_version=excluded.api_version, sync_state=excluded.sync_state, last_attempt_at=excluded.last_attempt_at,
        last_success_at=excluded.last_success_at, resource_success_count=excluded.resource_success_count,
        resource_failure_count=excluded.resource_failure_count
    `).run(
      Number(next.connected) ? 1 : 0, nullable(next.account_type), nullable(next.account_id), nullable(next.store_id),
      normalizeText(next.scopes_json || '[]'), normalizeText(next.connection_map_json || '{}'), nullable(next.last_sync_at),
      normalizeText(next.last_error), nowIso(), nullable(next.owner_type), nullable(next.owner_id), nullable(next.user_id),
      nullable(next.api_version), normalizeText(next.sync_state || 'idle'), nullable(next.last_attempt_at),
      nullable(next.last_success_at), Number(next.resource_success_count || 0), Number(next.resource_failure_count || 0)
    );
    return this.getIntegrationStatus();
  }

  getIntegrationSnapshot(resource) {
    return this.db.prepare('SELECT * FROM integration_snapshots WHERE resource = ?').get(normalizeText(resource)) || null;
  }

  listIntegrationSnapshots() {
    return this.db.prepare('SELECT * FROM integration_snapshots ORDER BY resource').all();
  }

  saveIntegrationSnapshot(values) {
    const previous = this.getIntegrationSnapshot(values.resource);
    const nextHash = normalizeText(values.payload_hash);
    const checkedAt = normalizeText(values.last_checked_at || nowIso());
    const changedAt = previous && previous.payload_hash === nextHash
      ? previous.last_changed_at
      : normalizeText(values.last_changed_at || checkedAt);
    this.db.prepare(`
      INSERT INTO integration_snapshots(resource, payload_hash, item_count, payload_json, last_checked_at, last_changed_at)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(resource) DO UPDATE SET payload_hash=excluded.payload_hash, item_count=excluded.item_count,
        payload_json=excluded.payload_json, last_checked_at=excluded.last_checked_at, last_changed_at=excluded.last_changed_at
    `).run(normalizeText(values.resource), nextHash, Number(values.item_count || 0),
      normalizeText(values.payload_json || 'null'), checkedAt, changedAt);
    return this.getIntegrationSnapshot(values.resource);
  }

  getIntegrationResourceStatus(resource) {
    return this.db.prepare('SELECT * FROM integration_resource_status WHERE resource=?').get(normalizeText(resource)) || null;
  }

  listIntegrationResourceStatus() {
    return this.db.prepare(`
      SELECT * FROM integration_resource_status
      ORDER BY CASE resource WHEN 'ping' THEN 0 WHEN 'connection-map' THEN 1 ELSE 2 END, resource
    `).all();
  }

  saveIntegrationResourceStatus(values) {
    const resource = normalizeText(values.resource);
    if (!resource) throw new Error('Integration resource is required.');
    const current = this.getIntegrationResourceStatus(resource) || {};
    const next = Object.assign({}, current, values || {});
    this.db.prepare(`
      INSERT INTO integration_resource_status(
        resource, account_type, required_scope, allowed, status, item_count, http_status, last_error,
        last_started_at, last_checked_at, last_success_at, duration_ms, payload_hash, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(resource) DO UPDATE SET
        account_type=excluded.account_type, required_scope=excluded.required_scope, allowed=excluded.allowed,
        status=excluded.status, item_count=excluded.item_count, http_status=excluded.http_status,
        last_error=excluded.last_error, last_started_at=excluded.last_started_at,
        last_checked_at=excluded.last_checked_at, last_success_at=excluded.last_success_at,
        duration_ms=excluded.duration_ms, payload_hash=excluded.payload_hash, updated_at=excluded.updated_at
    `).run(
      resource, nullable(next.account_type), normalizeText(next.required_scope), Number(next.allowed === 0 ? 0 : 1),
      normalizeText(next.status || 'never'), Number(next.item_count || 0), Number(next.http_status || 0),
      normalizeText(next.last_error), nullable(next.last_started_at), nullable(next.last_checked_at),
      nullable(next.last_success_at), Number(next.duration_ms || 0), normalizeText(next.payload_hash), nowIso()
    );
    return this.getIntegrationResourceStatus(resource);
  }

  beginIntegrationSyncRun(triggerType, accountType, plannedResources) {
    const runId = id();
    this.db.prepare(`
      INSERT INTO integration_sync_runs(id, account_type, status, trigger_type, started_at, planned_resources)
      VALUES (?, ?, 'running', ?, ?, ?)
    `).run(runId, nullable(accountType), normalizeText(triggerType || 'automatic'), nowIso(), Number(plannedResources || 0));
    return runId;
  }

  finishIntegrationSyncRun(runId, values) {
    this.db.prepare(`
      UPDATE integration_sync_runs
      SET account_type=?, status=?, completed_at=?, planned_resources=?, successful_resources=?, failed_resources=?, error_summary=?
      WHERE id=?
    `).run(nullable(values.account_type), normalizeText(values.status || 'completed'), nowIso(),
      Number(values.planned_resources || 0), Number(values.successful_resources || 0), Number(values.failed_resources || 0),
      normalizeText(values.error_summary), runId);
    return this.db.prepare('SELECT * FROM integration_sync_runs WHERE id=?').get(runId) || null;
  }

  listIntegrationSyncRuns(limit = 20) {
    return this.db.prepare('SELECT * FROM integration_sync_runs ORDER BY started_at DESC LIMIT ?')
      .all(Math.min(Math.max(Number(limit) || 20, 1), 100));
  }

  replaceIntegrationCache(resource, items) {
    const resourceName = normalizeText(resource);
    const records = Array.isArray(items) ? items : [];
    const seenAt = nowIso();
    const ids = [];
    const upsert = this.db.prepare(`
      INSERT INTO integration_cache(
        resource, item_id, normalized_phone, normalized_email, search_text, sort_date,
        payload_hash, payload_json, first_seen_at, last_seen_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(resource, item_id) DO UPDATE SET
        normalized_phone=excluded.normalized_phone, normalized_email=excluded.normalized_email,
        search_text=excluded.search_text, sort_date=excluded.sort_date, payload_hash=excluded.payload_hash,
        payload_json=excluded.payload_json, last_seen_at=excluded.last_seen_at, updated_at=excluded.updated_at
    `);
    this.transaction(() => {
      records.forEach((item, index) => {
        const itemId = integrationItemIdentity(resourceName, item, index);
        ids.push(itemId);
        const phone = normalizePhone(item && (item.phone || item.customer_phone || item.reseller_phone));
        const email = normalizeEmail(item && (item.email || item.customer_email || item.reseller_email));
        const searchText = Object.values(item || {}).filter(function scalar(value) {
          return ['string', 'number', 'boolean'].includes(typeof value);
        }).join(' ').toLowerCase() + ' ' + phone + ' ' + email;
        const sortDate = nullable(item && (item.updated_at || item.created_at || item.last_seen_at || item.last_message_at || item.appointment_date || item.start_at));
        const payloadJson = JSON.stringify(item || {});
        const payloadHash = crypto.createHash('sha256').update(payloadJson).digest('hex');
        const existing = this.db.prepare('SELECT first_seen_at FROM integration_cache WHERE resource=? AND item_id=?').get(resourceName, itemId);
        upsert.run(resourceName, itemId, phone, email, searchText, sortDate, payloadHash, payloadJson,
          existing && existing.first_seen_at ? existing.first_seen_at : seenAt, seenAt, seenAt);
      });
      if (ids.length) {
        const placeholders = ids.map(function placeholder() { return '?'; }).join(',');
        this.db.prepare(`DELETE FROM integration_cache WHERE resource=? AND item_id NOT IN (${placeholders})`).run(resourceName, ...ids);
      } else {
        this.db.prepare('DELETE FROM integration_cache WHERE resource=?').run(resourceName);
      }
    });
    return this.listIntegrationCache(resourceName, '', 500);
  }

  listIntegrationCache(resource, search = '', limit = 100) {
    const resourceName = normalizeText(resource);
    const safeLimit = Math.min(Math.max(Number(limit) || 100, 1), 500);
    const query = normalizeText(search).toLowerCase();
    const normalizedPhoneQuery = normalizePhone(search);
    const phonePattern = normalizedPhoneQuery ? '%' + normalizedPhoneQuery + '%' : '__NEXA_NO_PHONE_MATCH__';
    const rows = query
      ? this.db.prepare(`
          SELECT * FROM integration_cache
          WHERE resource=? AND (search_text LIKE ? OR normalized_phone LIKE ? OR normalized_email LIKE ?)
          ORDER BY COALESCE(sort_date, updated_at) DESC LIMIT ?
        `).all(resourceName, '%' + query + '%', phonePattern, '%' + query + '%', safeLimit)
      : this.db.prepare('SELECT * FROM integration_cache WHERE resource=? ORDER BY COALESCE(sort_date, updated_at) DESC LIMIT ?')
          .all(resourceName, safeLimit);
    return rows.map(function parseRow(row) {
      let payload = {};
      try { payload = JSON.parse(row.payload_json || '{}'); } catch (_) { payload = {}; }
      return Object.assign({}, payload, {
        __resource: row.resource,
        __item_id: row.item_id,
        __normalized_phone: row.normalized_phone,
        __normalized_email: row.normalized_email,
        __first_seen_at: row.first_seen_at,
        __last_seen_at: row.last_seen_at
      });
    });
  }


  findIntegrationCacheItem(resources, itemId) {
    const wanted=String(itemId || '');
    for (const resource of (resources || [])) {
      const row=this.db.prepare('SELECT * FROM integration_cache WHERE resource=? AND item_id=?').get(normalizeText(resource),wanted);
      if (row) {
        let payload={}; try { payload=JSON.parse(row.payload_json || '{}'); } catch (_) { payload={}; }
        return Object.assign({},payload,{__resource:row.resource,__item_id:row.item_id,__normalized_phone:row.normalized_phone,__normalized_email:row.normalized_email});
      }
    }
    return null;
  }

  integrationCacheCount(resource) {
    const row = this.db.prepare('SELECT COUNT(*) AS total FROM integration_cache WHERE resource=?').get(normalizeText(resource));
    return Number(row && row.total || 0);
  }

  connectedBusinessOverview() {
    const resources = this.listIntegrationResourceStatus();
    const remote = {};
    const limits = {
      agenda: 200, orders: 100, listings: 100, messages: 100, resellers: 100,
      'reseller-appointments': 100, 'reseller-listings': 100, stores: 100, users: 100, validation: 100,
      store: 1, 'dealer-summary': 1, 'reseller-profile': 1, 'reseller-summary': 1, 'admin-summary': 1,
      'api-keys-status': 20
    };
    Object.keys(limits).forEach((resource) => {
      remote[resource] = this.listIntegrationCache(resource, '', limits[resource]);
    });
    return {
      resources: resources,
      syncRuns: this.listIntegrationSyncRuns(20),
      remote: remote
    };
  }

  clearIntegrationData() {
    this.transaction(() => {
      this.db.exec('DELETE FROM integration_cache; DELETE FROM integration_resource_status; DELETE FROM integration_snapshots; DELETE FROM integration_sync_runs; DELETE FROM message_entries; DELETE FROM message_threads; DELETE FROM message_reply_drafts; DELETE FROM message_outbox;');
      this.saveIntegrationStatus({
        connected: 0, account_type: null, account_id: null, store_id: null, owner_type: null, owner_id: null,
        user_id: null, api_version: null, scopes_json: '[]', connection_map_json: '{}', sync_state: 'idle',
        last_sync_at: null, last_attempt_at: null, last_success_at: null, resource_success_count: 0,
        resource_failure_count: 0, last_error: 'Disconnected by user.'
      });
    });
  }

  createNotificationEvent(values) {
    const eventId = normalizeText(values.id) || id();
    try {
      this.db.prepare(`
        INSERT INTO notification_events(id, source, type, severity, title, body, entity_type, entity_id, action_url, metadata_json, dedupe_key, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(eventId, normalizeText(values.source || 'local'), normalizeText(values.type || 'general'),
        normalizeText(values.severity || 'info'), normalizeText(values.title || 'Nexa Smart Office Bot'),
        normalizeText(values.body || ''), nullable(values.entity_type), nullable(values.entity_id), nullable(values.action_url),
        normalizeText(values.metadata_json || '{}'), normalizeText(values.dedupe_key || eventId), nowIso());
    } catch (error) {
      if (String(error.message || '').toLowerCase().includes('unique')) return null;
      throw error;
    }
    this.log('created', 'notification', eventId, values.type || 'general');
    return this.db.prepare('SELECT * FROM notification_events WHERE id = ?').get(eventId);
  }

  listNotificationEvents(limit = 100, unreadOnly = false) {
    const safeLimit = Math.min(Math.max(Number(limit) || 100, 1), 500);
    if (unreadOnly) return this.db.prepare('SELECT * FROM notification_events WHERE read_at IS NULL AND dismissed_at IS NULL ORDER BY created_at DESC LIMIT ?').all(safeLimit);
    return this.db.prepare('SELECT * FROM notification_events WHERE dismissed_at IS NULL ORDER BY created_at DESC LIMIT ?').all(safeLimit);
  }

  listUndeliveredNotifications(limit = 20) {
    const safeLimit = Math.min(Math.max(Number(limit) || 20, 1), 100);
    return this.db.prepare('SELECT * FROM notification_events WHERE delivered_at IS NULL AND dismissed_at IS NULL ORDER BY created_at ASC LIMIT ?').all(safeLimit);
  }

  countUnreadNotifications() {
    const row = this.db.prepare('SELECT COUNT(*) AS total FROM notification_events WHERE read_at IS NULL AND dismissed_at IS NULL').get();
    return Number(row && row.total || 0);
  }

  markNotificationRead(eventId) {
    this.db.prepare('UPDATE notification_events SET read_at=COALESCE(read_at, ?) WHERE id=?').run(nowIso(), eventId);
  }

  markAllNotificationsRead() {
    this.db.prepare('UPDATE notification_events SET read_at=COALESCE(read_at, ?) WHERE dismissed_at IS NULL').run(nowIso());
  }

  markNotificationDelivered(eventId, channel) {
    this.db.prepare('UPDATE notification_events SET delivered_at=COALESCE(delivered_at, ?), delivery_channel=? WHERE id=?').run(nowIso(), normalizeText(channel), eventId);
  }

  dismissNotification(eventId) {
    this.db.prepare('UPDATE notification_events SET dismissed_at=COALESCE(dismissed_at, ?), read_at=COALESCE(read_at, ?) WHERE id=?').run(nowIso(), nowIso(), eventId);
  }

  listNotificationPreferences() {
    return this.db.prepare('SELECT * FROM notification_preferences ORDER BY type').all();
  }

  getNotificationPreference(type) {
    return this.db.prepare('SELECT * FROM notification_preferences WHERE type=?').get(normalizeText(type)) || null;
  }

  saveNotificationPreferences(preferences) {
    const statement = this.db.prepare(`
      INSERT INTO notification_preferences(type, enabled, desktop_enabled, in_app_enabled, updated_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(type) DO UPDATE SET enabled=excluded.enabled, desktop_enabled=excluded.desktop_enabled,
        in_app_enabled=excluded.in_app_enabled, updated_at=excluded.updated_at
    `);
    this.transaction(() => {
      (preferences || []).forEach(function savePreference(preference) {
        statement.run(normalizeText(preference.type), Number(preference.enabled) ? 1 : 0,
          Number(preference.desktop_enabled) ? 1 : 0, Number(preference.in_app_enabled) ? 1 : 0, nowIso());
      });
    });
    return this.listNotificationPreferences();
  }

  createBackup(backupPath) {
    fs.mkdirSync(path.dirname(backupPath), { recursive: true });
    if (fs.existsSync(backupPath)) fs.unlinkSync(backupPath);
    const escaped = backupPath.replaceAll("'", "''");
    this.db.exec(`VACUUM INTO '${escaped}'`);
    const stat = fs.statSync(backupPath);
    const backupId = id();
    this.db.prepare('INSERT INTO backup_history(id, file_path, file_size, created_at) VALUES (?, ?, ?, ?)')
      .run(backupId, backupPath, stat.size, nowIso());
    this.log('created', 'backup', backupId, path.basename(backupPath));
    return { id: backupId, file_path: backupPath, file_size: stat.size, created_at: nowIso() };
  }

  listBackups() {
    return this.db.prepare('SELECT * FROM backup_history ORDER BY created_at DESC').all();
  }

  restoreBackup(backupPath) {
    if (!fs.existsSync(backupPath)) throw new Error('Backup file does not exist.');
    const safetyPath = `${this.databasePath}.before-restore-${Date.now()}.sqlite`;
    this.close();
    fs.copyFileSync(this.databasePath, safetyPath);
    try {
      fs.copyFileSync(backupPath, this.databasePath);
      this.open();
      this.log('restored', 'backup', null, path.basename(backupPath));
      return { restored: true, safety_copy: safetyPath };
    } catch (error) {
      try {
        fs.copyFileSync(safetyPath, this.databasePath);
        this.open();
      } catch (_) { /* preserve original error */ }
      throw error;
    }
  }
}

module.exports = { DatabaseService, integrationItemIdentity, normalizeEmail, normalizePhone };
