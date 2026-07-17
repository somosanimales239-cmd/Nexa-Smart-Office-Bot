'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const { DatabaseService } = require('../src/database/database');
const { extractOpenAIText } = require('../src/services/openai-provider');

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nexa-smart-office-'));
const dbPath = path.join(tempDir, 'test.sqlite');
let db;
let passed = 0;

function test(name, fn) {
  try {
    fn();
    passed += 1;
    console.log(`PASS ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}: ${error.stack || error.message}`);
    process.exitCode = 1;
  }
}

try {
  db = new DatabaseService(dbPath);

  test('database file is created', () => assert.equal(fs.existsSync(dbPath), true));
  test('migrations are idempotent', () => { db.migrate(); db.migrate(); assert.equal(db.db.prepare('SELECT COUNT(*) AS n FROM migrations').get().n, 5); });

  let contact;
  test('contact can be created', () => { contact = db.saveContact({ name:'Ana Rivera', company:'Rivera LLC', email:'ana@example.com', phone:'555-0101', tags:'VIP' }); assert.equal(contact.name,'Ana Rivera'); });
  test('contact can be updated without duplication', () => { const updated=db.saveContact({ ...contact, company:'Rivera Group' }); assert.equal(updated.company,'Rivera Group'); assert.equal(db.listContacts().length,1); });
  test('contact search works', () => assert.equal(db.listContacts('Rivera').length,1));

  let lead;
  test('lead can be created and linked', () => { lead=db.saveLead({ name:'Northwind Opportunity', contact_id:contact.id, status:'Interested', priority:'High', estimated_value:12500, next_follow_up:new Date(Date.now()-60000).toISOString() }); assert.equal(lead.contact_id,contact.id); });
  test('lead status persists', () => { lead=db.saveLead({ ...lead, status:'Qualified' }); assert.equal(db.listLeads()[0].status,'Qualified'); });

  let task;
  test('task can be created', () => { task=db.saveTask({ title:'Send proposal', due_at:new Date(Date.now()-60000).toISOString(), reminder_at:new Date(Date.now()-60000).toISOString(), priority:'High' }); assert.equal(task.status,'Pending'); });
  test('task completion toggles', () => { assert.equal(db.toggleTask(task.id).status,'Completed'); assert.equal(db.toggleTask(task.id).status,'Pending'); });

  let appointment;
  test('appointment can be created', () => { appointment=db.saveAppointment({ title:'Discovery call', start_at:new Date(Date.now()+3600000).toISOString(), reminder_at:new Date(Date.now()-1000).toISOString(), contact_id:contact.id, lead_id:lead.id }); assert.equal(appointment.title,'Discovery call'); });
  test('agenda returns linked names', () => { const item=db.listAppointments()[0]; assert.equal(item.contact_name,'Ana Rivera'); assert.equal(item.lead_name,'Northwind Opportunity'); });

  test('dashboard summary reflects records', () => { const summary=db.dashboardSummary(); assert.equal(summary.contacts,1); assert.equal(summary.activeLeads,1); assert.equal(summary.pendingTasks,1); });
  test('alerts include overdue task and lead follow-up', () => { const types=db.listAlerts().map((x)=>x.type); assert(types.includes('Overdue task')); assert(types.includes('Lead follow-up')); });
  test('custom reminder can be created and toggled', () => { const reminder=db.saveReminder({ title:'Call customer', remind_at:new Date(Date.now()-1000).toISOString() }); assert.equal(reminder.title,'Call customer'); assert.equal(db.toggleReminder(reminder.id).enabled,0); assert.equal(db.toggleReminder(reminder.id).enabled,1); });
  test('due notifications are found and marked', () => { const due=db.dueNotifications(); assert(due.length >= 3); db.markNotificationSent(due[0].entity_type,due[0].id); assert(db.dueNotifications().length < due.length); });


  test('connected business tables are created', () => {
    const names = db.db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((row)=>row.name);
    ['integration_status','integration_snapshots','integration_resource_status','integration_cache','integration_sync_runs','notification_preferences','notification_events'].forEach((name)=>assert(names.includes(name)));
  });
  test('integration status and snapshots persist', () => {
    db.saveIntegrationStatus({ connected:1, account_type:'dealer', store_id:'store-1', scopes_json:'["store:read"]', last_sync_at:new Date().toISOString() });
    assert.equal(db.getIntegrationStatus().connected,1);
    db.saveIntegrationSnapshot({ resource:'orders', payload_hash:'abc', item_count:2, payload_json:'[{"id":1},{"id":2}]', last_checked_at:new Date().toISOString(), last_changed_at:new Date().toISOString() });
    assert.equal(db.getIntegrationSnapshot('orders').item_count,2);
  });
  test('notification preferences and events persist', () => {
    db.saveNotificationPreferences([{ type:'remote_orders', enabled:1, desktop_enabled:1, in_app_enabled:1 }]);
    assert.equal(db.getNotificationPreference('remote_orders').desktop_enabled,1);
    const event=db.createNotificationEvent({ source:'automarket', type:'remote_orders', severity:'warning', title:'New order', body:'Order #100', dedupe_key:'order:100' });
    assert(event && event.id);
    assert.equal(db.countUnreadNotifications(),1);
    db.markNotificationRead(event.id);
    assert.equal(db.countUnreadNotifications(),0);
  });
  test('duplicate notification dedupe key is ignored', () => {
    const duplicate=db.createNotificationEvent({ source:'automarket', type:'remote_orders', title:'Duplicate', dedupe_key:'order:100' });
    assert.equal(duplicate,null);
  });

  test('settings update only allowed keys', () => { const settings=db.saveSettings({ preferred_provider:'deepseek', evil:'ignored' }); assert.equal(settings.preferred_provider,'deepseek'); assert.equal(settings.evil,undefined); });
  test('AI suggestion is stored', () => { db.saveSuggestion({ provider:'deepseek', kind:'lead_next_step', related_type:'lead', related_id:lead.id, prompt:'p', response:'r' }); assert.equal(db.listSuggestions()[0].response,'r'); });
  test('OpenAI response text extraction works', () => { const text=extractOpenAIText({ output:[{ content:[{ type:'output_text', text:'Useful suggestion' }] }] }); assert.equal(text,'Useful suggestion'); });

  const backupPath = path.join(tempDir,'backups','copy.sqlite');
  test('backup can be created', () => { const backup=db.createBackup(backupPath); assert.equal(fs.existsSync(backupPath),true); assert(backup.file_size > 0); });
  test('backup history is recorded', () => assert.equal(db.listBackups().length,1));

  test('activity log records operations', () => assert(db.listActivity(100).length >= 8));
  test('contact deletion does not delete lead', () => { db.deleteContact(contact.id); const remaining=db.listLeads()[0]; assert.equal(remaining.contact_id,null); });
  test('lead, task and appointment can be deleted', () => { assert.equal(db.deleteLead(lead.id),true); assert.equal(db.deleteTask(task.id),true); assert.equal(db.deleteAppointment(appointment.id),true); });
} finally {
  try { db?.close(); } catch (_) {}
  try { fs.rmSync(tempDir,{recursive:true,force:true}); } catch (_) {}
}

console.log(`\n${passed} integration tests passed.`);
if (process.exitCode) process.exit(process.exitCode);
