'use strict';

const AUTOMOTIVE_DEALER_LIBRARY = require('../data/automotive-dealer-knowledge-library.json');
const AUTOMOTIVE_DEALER_LIBRARY_MANIFEST = require('../data/automotive-dealer-library-manifest.json');

const NEXA_SCHEMA_MIGRATION_CONTRACT = 'migration marker: NEXA_SCHEMA_MIGRATION_V1';

const NEXA_SCHEMA_MIGRATION_V1 = 'NEXA_SCHEMA_MIGRATION_V1';
const REQUIRED_TABLES = 'tables: contacts, leads, appointments, tasks, reminders, ai_suggestions, settings, activity_logs, migrations, integration_status, integration_snapshots, integration_resource_status, integration_cache, integration_sync_runs, notification_preferences, notification_events, message_threads, message_entries, message_reply_drafts, message_outbox, response_knowledge';

const nowIso = function nowIso() {
  return new Date().toISOString();
};

function tableColumns(database, tableName) {
  return new Set(database.prepare('PRAGMA table_info(' + tableName + ')').all().map(function mapColumn(row) {
    return String(row.name || '');
  }));
}

function addColumnIfMissing(database, tableName, columnName, definition) {
  const columns = tableColumns(database, tableName);
  if (!columns.has(columnName)) database.exec('ALTER TABLE ' + tableName + ' ADD COLUMN ' + columnName + ' ' + definition + ';');
}

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
        "INSERT OR IGNORE INTO settings(key, value, updated_at) VALUES ('automarket_max_items', '100', datetime('now'));",
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
    },
    {
      id: 4,
      name: 'NEXA_CONNECTED_BUSINESS_FULL_SYNC_V2',
      apply: function applyConnectedBusinessFullSync(database) {
        addColumnIfMissing(database, 'integration_status', 'owner_type', 'TEXT');
        addColumnIfMissing(database, 'integration_status', 'owner_id', 'TEXT');
        addColumnIfMissing(database, 'integration_status', 'user_id', 'TEXT');
        addColumnIfMissing(database, 'integration_status', 'api_version', 'TEXT');
        addColumnIfMissing(database, 'integration_status', 'sync_state', "TEXT NOT NULL DEFAULT 'idle'");
        addColumnIfMissing(database, 'integration_status', 'last_attempt_at', 'TEXT');
        addColumnIfMissing(database, 'integration_status', 'last_success_at', 'TEXT');
        addColumnIfMissing(database, 'integration_status', 'resource_success_count', 'INTEGER NOT NULL DEFAULT 0');
        addColumnIfMissing(database, 'integration_status', 'resource_failure_count', 'INTEGER NOT NULL DEFAULT 0');
        database.exec([
          `CREATE TABLE IF NOT EXISTS integration_resource_status (
            resource TEXT PRIMARY KEY,
            account_type TEXT,
            required_scope TEXT,
            allowed INTEGER NOT NULL DEFAULT 1,
            status TEXT NOT NULL DEFAULT 'never',
            item_count INTEGER NOT NULL DEFAULT 0,
            http_status INTEGER NOT NULL DEFAULT 0,
            last_error TEXT NOT NULL DEFAULT '',
            last_started_at TEXT,
            last_checked_at TEXT,
            last_success_at TEXT,
            duration_ms INTEGER NOT NULL DEFAULT 0,
            payload_hash TEXT NOT NULL DEFAULT '',
            updated_at TEXT NOT NULL
          );`,
          `CREATE TABLE IF NOT EXISTS integration_cache (
            resource TEXT NOT NULL,
            item_id TEXT NOT NULL,
            normalized_phone TEXT NOT NULL DEFAULT '',
            normalized_email TEXT NOT NULL DEFAULT '',
            search_text TEXT NOT NULL DEFAULT '',
            sort_date TEXT,
            payload_hash TEXT NOT NULL,
            payload_json TEXT NOT NULL,
            first_seen_at TEXT NOT NULL,
            last_seen_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            PRIMARY KEY(resource, item_id)
          );`,
          'CREATE INDEX IF NOT EXISTS idx_integration_cache_resource ON integration_cache(resource, updated_at DESC);',
          'CREATE INDEX IF NOT EXISTS idx_integration_cache_phone ON integration_cache(normalized_phone);',
          'CREATE INDEX IF NOT EXISTS idx_integration_cache_email ON integration_cache(normalized_email);',
          `CREATE TABLE IF NOT EXISTS integration_sync_runs (
            id TEXT PRIMARY KEY,
            account_type TEXT,
            status TEXT NOT NULL,
            trigger_type TEXT NOT NULL,
            started_at TEXT NOT NULL,
            completed_at TEXT,
            planned_resources INTEGER NOT NULL DEFAULT 0,
            successful_resources INTEGER NOT NULL DEFAULT 0,
            failed_resources INTEGER NOT NULL DEFAULT 0,
            error_summary TEXT NOT NULL DEFAULT ''
          );`,
          'CREATE INDEX IF NOT EXISTS idx_integration_sync_runs_started ON integration_sync_runs(started_at DESC);',
          "INSERT OR IGNORE INTO settings(key, value, updated_at) VALUES ('automarket_max_items', '100', datetime('now'));"
        ].join(' '));
      }
    },
    {
      id: 5,
      name: 'NEXA_REALTIME_MESSAGES_AND_KNOWLEDGE_V1',
      sql: [
        `CREATE TABLE IF NOT EXISTS message_threads (
          thread_id TEXT PRIMARY KEY,
          subject TEXT NOT NULL DEFAULT '',
          context_type TEXT NOT NULL DEFAULT '',
          context_id TEXT,
          participant_name TEXT NOT NULL DEFAULT '',
          participant_type TEXT NOT NULL DEFAULT '',
          can_reply INTEGER NOT NULL DEFAULT 0,
          is_announcement INTEGER NOT NULL DEFAULT 0,
          last_message_id TEXT,
          last_message_at TEXT,
          sync_cursor TEXT,
          last_synced_at TEXT,
          payload_json TEXT NOT NULL DEFAULT '{}',
          updated_at TEXT NOT NULL
        );`,
        `CREATE TABLE IF NOT EXISTS message_entries (
          message_id TEXT PRIMARY KEY,
          thread_id TEXT NOT NULL,
          sender_type TEXT NOT NULL DEFAULT '',
          sender_id TEXT,
          sender_name TEXT NOT NULL DEFAULT '',
          receiver_type TEXT NOT NULL DEFAULT '',
          direction TEXT NOT NULL DEFAULT 'unknown',
          body TEXT NOT NULL DEFAULT '',
          body_format TEXT NOT NULL DEFAULT 'text',
          sent_at TEXT,
          status TEXT NOT NULL DEFAULT '',
          is_read INTEGER NOT NULL DEFAULT 0,
          payload_json TEXT NOT NULL DEFAULT '{}',
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          FOREIGN KEY(thread_id) REFERENCES message_threads(thread_id) ON DELETE CASCADE
        );`,
        'CREATE INDEX IF NOT EXISTS idx_message_entries_thread_sent ON message_entries(thread_id, sent_at, created_at);',
        `CREATE TABLE IF NOT EXISTS message_reply_drafts (
          id TEXT PRIMARY KEY,
          thread_id TEXT NOT NULL,
          source TEXT NOT NULL,
          provider TEXT,
          confidence REAL NOT NULL DEFAULT 0,
          trigger_text TEXT NOT NULL DEFAULT '',
          body TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'draft',
          sent_message_id TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );`,
        'CREATE INDEX IF NOT EXISTS idx_message_reply_drafts_thread ON message_reply_drafts(thread_id, created_at DESC);',
        `CREATE TABLE IF NOT EXISTS message_outbox (
          client_message_id TEXT PRIMARY KEY,
          thread_id TEXT NOT NULL,
          body TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'pending',
          error TEXT NOT NULL DEFAULT '',
          remote_message_id TEXT,
          created_at TEXT NOT NULL,
          sent_at TEXT,
          updated_at TEXT NOT NULL
        );`,
        `CREATE TABLE IF NOT EXISTS response_knowledge (
          id TEXT PRIMARY KEY,
          label TEXT NOT NULL,
          category TEXT NOT NULL DEFAULT 'General',
          triggers TEXT NOT NULL,
          response TEXT NOT NULL,
          enabled INTEGER NOT NULL DEFAULT 1,
          use_count INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );`,
        'CREATE INDEX IF NOT EXISTS idx_response_knowledge_enabled ON response_knowledge(enabled, category, updated_at DESC);',
        "INSERT OR IGNORE INTO settings(key, value, updated_at) VALUES ('message_realtime_enabled', '1', datetime('now'));",
        "INSERT OR IGNORE INTO settings(key, value, updated_at) VALUES ('message_poll_seconds', '5', datetime('now'));",
        "INSERT OR IGNORE INTO settings(key, value, updated_at) VALUES ('message_ai_mode', 'knowledge_first', datetime('now'));",
        "INSERT OR IGNORE INTO settings(key, value, updated_at) VALUES ('message_ai_fallback', '1', datetime('now'));",
        "INSERT OR IGNORE INTO settings(key, value, updated_at) VALUES ('message_learning_enabled', '0', datetime('now'));",
        "INSERT OR IGNORE INTO settings(key, value, updated_at) VALUES ('message_send_confirmation', '1', datetime('now'));"
      ].join(' ')
    },
    {
      id: 6,
      name: 'NEXA_AUTOMOTIVE_DEALER_KNOWLEDGE_LIBRARY_V1',
      apply: function installAutomotiveDealerKnowledgeLibrary(database) {
        addColumnIfMissing(database, 'response_knowledge', 'intent_key', "TEXT NOT NULL DEFAULT ''");
        addColumnIfMissing(database, 'response_knowledge', 'locale', "TEXT NOT NULL DEFAULT 'en'");
        addColumnIfMissing(database, 'response_knowledge', 'dealer_segment', "TEXT NOT NULL DEFAULT 'generic'");
        addColumnIfMissing(database, 'response_knowledge', 'tags_json', "TEXT NOT NULL DEFAULT '[]'");
        addColumnIfMissing(database, 'response_knowledge', 'response_variants_json', "TEXT NOT NULL DEFAULT '[]'");
        addColumnIfMissing(database, 'response_knowledge', 'required_context_json', "TEXT NOT NULL DEFAULT '[]'");
        addColumnIfMissing(database, 'response_knowledge', 'safety_level', "TEXT NOT NULL DEFAULT 'standard'");
        addColumnIfMissing(database, 'response_knowledge', 'built_in', 'INTEGER NOT NULL DEFAULT 0');
        addColumnIfMissing(database, 'response_knowledge', 'library_version', "TEXT NOT NULL DEFAULT ''");
        addColumnIfMissing(database, 'response_knowledge', 'source', "TEXT NOT NULL DEFAULT 'User approved'");
        database.exec('CREATE INDEX IF NOT EXISTS idx_response_knowledge_library ON response_knowledge(built_in, locale, dealer_segment, intent_key);');
        database.exec('CREATE INDEX IF NOT EXISTS idx_response_knowledge_category ON response_knowledge(category, enabled, locale);');
        const insert = database.prepare(`
          INSERT OR IGNORE INTO response_knowledge(
            id, label, category, triggers, response, enabled, use_count, created_at, updated_at,
            intent_key, locale, dealer_segment, tags_json, response_variants_json, required_context_json,
            safety_level, built_in, library_version, source
          ) VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);
        const installedAt = nowIso();
        AUTOMOTIVE_DEALER_LIBRARY.forEach(function seedKnowledge(record) {
          insert.run(
            String(record.id), String(record.label), String(record.category), String(record.triggers), String(record.response),
            Number(record.enabled) === 0 ? 0 : 1, installedAt, installedAt, String(record.intent_key || ''),
            String(record.locale || 'en'), String(record.dealer_segment || 'generic'), JSON.stringify(record.tags || []),
            JSON.stringify(record.response_variants || [record.response]), JSON.stringify(record.required_context || []),
            String(record.safety_level || 'standard'), 1, String(record.library_version || AUTOMOTIVE_DEALER_LIBRARY_MANIFEST.version),
            String(record.source || AUTOMOTIVE_DEALER_LIBRARY_MANIFEST.name)
          );
        });
        database.prepare(`INSERT OR REPLACE INTO settings(key, value, updated_at) VALUES ('automotive_knowledge_library_version', ?, ?)`)
          .run(String(AUTOMOTIVE_DEALER_LIBRARY_MANIFEST.version), installedAt);
        database.prepare(`INSERT OR REPLACE INTO settings(key, value, updated_at) VALUES ('automotive_knowledge_library_count', ?, ?)`)
          .run(String(AUTOMOTIVE_DEALER_LIBRARY_MANIFEST.record_count), installedAt);
      }
    }

  ];

  migrations.forEach(function applyMigration(migration) {
    if (applied.has(migration.id)) return;
    database.exec('BEGIN IMMEDIATE');
    try {
      if (typeof migration.apply === 'function') migration.apply(database);
      else database.exec(migration.sql);
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
