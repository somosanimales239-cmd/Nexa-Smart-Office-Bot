'use strict';

const NEXA_SCHEMA_MIGRATION_CONTRACT = 'migration marker: NEXA_SCHEMA_MIGRATION_V1';

const NEXA_SCHEMA_MIGRATION_V1 = 'NEXA_SCHEMA_MIGRATION_V1';
const REQUIRED_TABLES = 'tables: contacts, leads, appointments, tasks, reminders, ai_suggestions, settings, activity_logs, migrations';

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
