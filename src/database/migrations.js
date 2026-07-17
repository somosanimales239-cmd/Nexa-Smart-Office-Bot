'use strict';

const NEXA_SCHEMA_MIGRATION_CONTRACT = 'migration marker: NEXA_SCHEMA_MIGRATION_V1';

const NEXA_SCHEMA_MIGRATION_V1 = 'NEXA_SCHEMA_MIGRATION_V1';
const REQUIRED_TABLES = 'tables: contacts, leads, appointments, tasks, reminders, ai_suggestions, settings, activity_logs, migrations, integration_status, integration_snapshots, notification_preferences, notification_events';

const nowIso = function nowIso() {
  return new Date().toISOString();
};

function applyMigrations(database) {
  database.exec([
    'CREATE TABLE IF NOT EXISTS migrations (',
    'id INTEGER PRIMARY KEY,',
    'name TEXT NOT NULL,',
    'applied_at TEXT NOT NULL',
    ');'
  ].join(' '));

  const appliedRows = database.prepare('SELECT id FROM migrations ORDER BY id').all();
  const applied = new Set(appliedRows.map(function mapRow(row) { return Number(row.id); }));
  const migrations = [
    {
      id: 1,
      name: 'NEXA_SCHEMA_MIGRATION_V1',
      sql: [
        'CREATE TABLE IF NOT EXISTS contacts (id TEXT PRIMARY KEY, name TEXT NOT NULL, company TEXT, phone TEXT, email TEXT, tags TEXT NOT NULL DEFAULT \'\', notes TEXT NOT NULL DEFAULT \'\', created_at TEXT NOT NULL, updated_at TEXT NOT NULL);',
        'CREATE INDEX IF NOT EXISTS idx_contacts_name ON contacts(name);',
        'CREATE TABLE IF NOT EXISTS leads (id TEXT PRIMARY KEY, contact_id TEXT, name TEXT NOT NULL, company TEXT, phone TEXT, email TEXT, source TEXT, status TEXT NOT NULL DEFAULT \'New\', priority TEXT NOT NULL DEFAULT \'Medium\', estimated_value REAL NOT NULL DEFAULT 0, next_follow_up TEXT, notes TEXT NOT NULL DEFAULT \'\', created_at TEXT NOT NULL, updated_at TEXT NOT NULL, FOREIGN KEY(contact_id) REFERENCES contacts(id) ON DELETE SET NULL);',
        'CREATE INDEX IF NOT EXISTS idx_leads_status ON leads(status);',
        'CREATE TABLE IF NOT EXISTS tasks (id TEXT PRIMARY KEY, title TEXT NOT NULL, description TEXT NOT NULL DEFAULT \'\', due_at TEXT, priority TEXT NOT NULL DEFAULT \'Medium\', status TEXT NOT NULL DEFAULT \'Pending\', related_type TEXT, related_id TEXT, reminder_at TEXT, notification_sent_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);',
        'CREATE INDEX IF NOT EXISTS idx_tasks_status_due ON tasks(status, due_at);',
        'CREATE TABLE IF NOT EXISTS appointments (id TEXT PRIMARY KEY, title TEXT NOT NULL, description TEXT NOT NULL DEFAULT \'\', start_at TEXT NOT NULL, end_at TEXT, status TEXT NOT NULL DEFAULT \'Scheduled\', contact_id TEXT, lead_id TEXT, reminder_at TEXT, notification_sent_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, FOREIGN KEY(contact_id) REFERENCES contacts(id) ON DELETE SET NULL, FOREIGN KEY(lead_id) REFERENCES leads(id) ON DELETE SET NULL);',
        'CREATE INDEX IF NOT EXISTS idx_appointments_start ON appointments(start_at);',
        'CREATE TABLE IF NOT EXISTS reminders (id TEXT PRIMARY KEY, entity_type TEXT NOT NULL, entity_id TEXT, title TEXT NOT NULL, remind_at TEXT NOT NULL, enabled INTEGER NOT NULL DEFAULT 1, notification_sent_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);',
        'CREATE INDEX IF NOT EXISTS idx_reminders_due ON reminders(enabled, remind_at);',
        'CREATE TABLE IF NOT EXISTS ai_suggestions (id TEXT PRIMARY KEY, provider TEXT NOT NULL, kind TEXT NOT NULL, related_type TEXT, related_id TEXT, prompt TEXT NOT NULL, response TEXT NOT NULL, created_at TEXT NOT NULL);',
        'CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT NOT NULL);',
        'CREATE TABLE IF NOT EXISTS activity_logs (id INTEGER PRIMARY KEY AUTOINCREMENT, action TEXT NOT NULL, entity_type TEXT NOT NULL, entity_id TEXT, details TEXT NOT NULL DEFAULT \'\', created_at TEXT NOT NULL);',
        'CREATE INDEX IF NOT EXISTS idx_activity_created ON activity_logs(created_at DESC);',
        'CREATE TABLE IF NOT EXISTS backup_history (id TEXT PRIMARY KEY, file_path TEXT NOT NULL, file_size INTEGER NOT NULL, created_at TEXT NOT NULL);'
      ].join(' ')
    },
    {
      id: 2,
      name: 'settings-defaults',
      sql: [
        "INSERT OR IGNORE INTO settings(key, value, updated_at) VALUES ('preferred_provider', 'openai', datetime('now'));",
        "INSERT OR IGNORE INTO settings(key, value, updated_at) VALUES ('openai_model', 'gpt-4.1-mini', datetime('now'));",
        "INSERT OR IGNORE INTO settings(key, value, updated_at) VALUES ('deepseek_model', 'deepseek-chat', datetime('now'));",
        "INSERT OR IGNORE INTO settings(key, value, updated_at) VALUES ('deepseek_base_url', 'https://api.deepseek.com', datetime('now'));",
        "INSERT OR IGNORE INTO settings(key, value, updated_at) VALUES ('notifications_enabled', '1', datetime('now'));",
        "INSERT OR IGNORE INTO settings(key, value, updated_at) VALUES ('automatic_backups', '1', datetime('now'));",
        "INSERT OR IGNORE INTO settings(key, value, updated_at) VALUES ('backup_retention', '10', datetime('now'));"
      ].join(' ')
    },
    {
      id: 3,
      name: 'NEXA_CONNECTED_BUSINESS_AND_NOTIFICATIONS_V1',
      sql: [
        `CREATE TABLE IF NOT EXISTS integration_status (integration_id TEXT PRIMARY KEY, connected INTEGER NOT NULL DEFAULT 0, account_type TEXT, account_id TEXT, store_id TEXT, scopes_json TEXT NOT NULL DEFAULT '[]', connection_map_json TEXT NOT NULL DEFAULT '{}', last_sync_at TEXT, last_error TEXT NOT NULL DEFAULT '', updated_at TEXT NOT NULL);`,
        `CREATE TABLE IF NOT EXISTS integration_snapshots (resource TEXT PRIMARY KEY, payload_hash TEXT NOT NULL, item_count INTEGER NOT NULL DEFAULT 0, payload_json TEXT NOT NULL DEFAULT 'null', last_checked_at TEXT NOT NULL, last_changed_at TEXT NOT NULL);`,
        'CREATE TABLE IF NOT EXISTS notification_preferences (type TEXT PRIMARY KEY, enabled INTEGER NOT NULL DEFAULT 1, desktop_enabled INTEGER NOT NULL DEFAULT 1, in_app_enabled INTEGER NOT NULL DEFAULT 1, updated_at TEXT NOT NULL);',
        `CREATE TABLE IF NOT EXISTS notification_events (id TEXT PRIMARY KEY, source TEXT NOT NULL, type TEXT NOT NULL, severity TEXT NOT NULL DEFAULT 'info', title TEXT NOT NULL, body TEXT NOT NULL DEFAULT '', entity_type TEXT, entity_id TEXT, action_url TEXT, metadata_json TEXT NOT NULL DEFAULT '{}', dedupe_key TEXT NOT NULL UNIQUE, created_at TEXT NOT NULL, read_at TEXT, delivered_at TEXT, delivery_channel TEXT, dismissed_at TEXT);`,
        'CREATE INDEX IF NOT EXISTS idx_notification_events_created ON notification_events(created_at DESC);',
        'CREATE INDEX IF NOT EXISTS idx_notification_events_unread ON notification_events(read_at, dismissed_at, created_at DESC);',
        "INSERT OR IGNORE INTO settings(key, value, updated_at) VALUES ('automarket_base_url', '', datetime('now'));",
        "INSERT OR IGNORE INTO settings(key, value, updated_at) VALUES ('automarket_sync_enabled', '0', datetime('now'));",
        "INSERT OR IGNORE INTO settings(key, value, updated_at) VALUES ('automarket_poll_minutes', '5', datetime('now'));",
        "INSERT OR IGNORE INTO settings(key, value, updated_at) VALUES ('notifications_user_consent', '0', datetime('now'));",
        "INSERT OR IGNORE INTO settings(key, value, updated_at) VALUES ('notifications_consent_at', '', datetime('now'));",
        "INSERT OR IGNORE INTO settings(key, value, updated_at) VALUES ('notifications_sound', '1', datetime('now'));",
        "INSERT OR IGNORE INTO settings(key, value, updated_at) VALUES ('notifications_minimize_to_tray', '1', datetime('now'));",
        "INSERT OR IGNORE INTO settings(key, value, updated_at) VALUES ('notifications_start_with_windows', '0', datetime('now'));",
        "INSERT OR IGNORE INTO settings(key, value, updated_at) VALUES ('notifications_quiet_start', '22:00', datetime('now'));",
        "INSERT OR IGNORE INTO settings(key, value, updated_at) VALUES ('notifications_quiet_end', '07:00', datetime('now'));",
        "INSERT OR IGNORE INTO notification_preferences(type, enabled, desktop_enabled, in_app_enabled, updated_at) VALUES ('local_task_due',1,1,1,datetime('now'));",
        "INSERT OR IGNORE INTO notification_preferences(type, enabled, desktop_enabled, in_app_enabled, updated_at) VALUES ('local_appointment_due',1,1,1,datetime('now'));",
        "INSERT OR IGNORE INTO notification_preferences(type, enabled, desktop_enabled, in_app_enabled, updated_at) VALUES ('local_reminder',1,1,1,datetime('now'));",
        "INSERT OR IGNORE INTO notification_preferences(type, enabled, desktop_enabled, in_app_enabled, updated_at) VALUES ('remote_orders',1,1,1,datetime('now'));",
        "INSERT OR IGNORE INTO notification_preferences(type, enabled, desktop_enabled, in_app_enabled, updated_at) VALUES ('remote_messages',1,1,1,datetime('now'));",
        "INSERT OR IGNORE INTO notification_preferences(type, enabled, desktop_enabled, in_app_enabled, updated_at) VALUES ('remote_resellers',1,1,1,datetime('now'));",
        "INSERT OR IGNORE INTO notification_preferences(type, enabled, desktop_enabled, in_app_enabled, updated_at) VALUES ('remote_agenda',1,0,1,datetime('now'));",
        "INSERT OR IGNORE INTO notification_preferences(type, enabled, desktop_enabled, in_app_enabled, updated_at) VALUES ('remote_listings',1,0,1,datetime('now'));",
        "INSERT OR IGNORE INTO notification_preferences(type, enabled, desktop_enabled, in_app_enabled, updated_at) VALUES ('remote_connection',1,1,1,datetime('now'));",
        "INSERT OR IGNORE INTO notification_preferences(type, enabled, desktop_enabled, in_app_enabled, updated_at) VALUES ('remote_business_update',1,0,1,datetime('now'));",
        "INSERT OR IGNORE INTO notification_preferences(type, enabled, desktop_enabled, in_app_enabled, updated_at) VALUES ('system_test',1,1,1,datetime('now'));"
      ].join(' ')
    }
  ];

  migrations.forEach(function applyMigration(migration) {
    if (applied.has(migration.id)) return;
    database.exec('BEGIN IMMEDIATE');
    try {
      database.exec(migration.sql);
      database.prepare('INSERT INTO migrations(id, name, applied_at) VALUES (?, ?, ?)').run(migration.id, migration.name, nowIso());
      database.exec('COMMIT');
    } catch (error) {
      try { database.exec('ROLLBACK'); } catch (rollbackError) { void rollbackError; }
      throw error;
    }
  });

  return {
    marker: NEXA_SCHEMA_MIGRATION_V1,
    tables: REQUIRED_TABLES
  };
}

module.exports = {
  NEXA_SCHEMA_MIGRATION_V1,
  REQUIRED_TABLES,
  applyMigrations
};
