'use strict';

const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const exists = (file) => fs.existsSync(path.join(root, file));
const checks = [];
const check = (name, condition, detail = '') => checks.push({ name, pass: Boolean(condition), detail });

const requiredFiles = [
  'package.json','main.js','preload.js','src/index.html','src/app.js','src/styles.css',
  'src/database/database.js','src/services/secret-store.js','src/services/ai-service.js',
  'scripts/integration-tests.js','scripts/ui-smoke.js','scripts/artifact-verify.js',
  '.github/workflows/windows-build.yml','build/icon.png'
];
requiredFiles.forEach((file) => check(`Required file: ${file}`, exists(file)));

const pkg = JSON.parse(read('package.json'));
const main = read('main.js');
const preload = read('preload.js');
const html = read('src/index.html');
const renderer = read('src/app.js');
const db = read('src/database/database.js');
const ai = read('src/services/ai-service.js');
const workflow = read('.github/workflows/windows-build.yml');

check('Package version is 1.0.0', pkg.version === '1.0.0');
check('Electron current stable pinned', pkg.devDependencies?.electron === '43.1.1');
check('electron-builder pinned', pkg.devDependencies?.['electron-builder'] === '26.15.3');
for (const script of ['validate','test','ui:smoke','build:win','verify:artifacts']) check(`npm script: ${script}`, Boolean(pkg.scripts?.[script]));
check('Explicit Windows appId', pkg.build?.appId === 'com.nexa.smartofficebot');
const targets = (pkg.build?.win?.target || []).map((target) => typeof target === 'string' ? target : target.target);
for (const target of ['nsis','portable','zip']) check(`Windows target: ${target}`, targets.includes(target));
check('NSIS installer preserves user data', pkg.build?.nsis?.deleteAppDataOnUninstall === false);
check('contextIsolation enabled', /contextIsolation\s*:\s*true/.test(main));
check('nodeIntegration disabled', /nodeIntegration\s*:\s*false/.test(main));
check('sandbox enabled', /sandbox\s*:\s*true/.test(main));
check('External navigation denied', /setWindowOpenHandler/.test(main) && /action:\s*'deny'/.test(main));
check('CSP restricts scripts', /Content-Security-Policy/.test(html) && /script-src 'self'/.test(html));
check('Preload exposes narrow API', /contextBridge\.exposeInMainWorld\('nexa'/.test(preload));
check('Renderer has no Node require', !/\brequire\s*\(/.test(renderer));
check('SQLite is local built-in module', /require\('node:sqlite'\)/.test(db));
check('SQLite WAL enabled', /journal_mode=WAL/i.test(db));
check('SQLite migrations table', /CREATE TABLE IF NOT EXISTS migrations/.test(db));
for (const table of ['contacts','leads','tasks','appointments','ai_suggestions','settings','activity_logs','backup_history']) check(`Database table: ${table}`, new RegExp(`CREATE TABLE IF NOT EXISTS ${table}`).test(db));
check('OpenAI Responses endpoint', /api\.openai\.com\/v1\/responses/.test(ai));
check('DeepSeek chat completions endpoint', /chat\/completions/.test(ai));
check('AI supports cancellation', /AbortController/.test(ai) && /cancel\(requestId\)/.test(ai));
check('No API key hardcoded', !/(sk-[A-Za-z0-9_-]{20,}|Bearer\s+[A-Za-z0-9_-]{20,})/.test([main,preload,renderer,db,ai].join('\n')));
check('safeStorage used for secrets', /safeStorage/.test(main) && /encryptString/.test(read('src/services/secret-store.js')));
for (const id of ['nav-dashboard','nav-contacts','nav-leads','nav-agenda','nav-tasks','nav-ai','nav-alerts','nav-settings','app-content']) check(`UI test ID: ${id}`, html.includes(`data-testid="${id}"`));
for (const action of ['contacts:save','leads:save','tasks:save','appointments:save','ai:generate','backups:create']) check(`IPC handler: ${action}`, main.includes(`'${action}'`) && preload.includes(`'${action}'`));
check('Workflow uses Windows runner', /runs-on:\s*windows-latest/.test(workflow));
check('Workflow installs Node 24', /node-version:\s*['"]?24/.test(workflow));
for (const command of ['npm run validate','npm test','npm run ui:smoke','npm run build:win','npm run verify:artifacts']) check(`Workflow command: ${command}`, workflow.includes(command));
check('Workflow uploads artifacts', /actions\/upload-artifact@v4/.test(workflow));
check('Build disables automatic GitHub publishing', /--publish never/.test(pkg.scripts['build:win']));

const prohibitedSourcePatterns = [
  [/fake connected/i, 'fake connected marker'],
  [/coming soon/i, 'coming soon marker'],
  [/fixed response/i, 'fixed response marker'],
  [/TODO:\s*implement/i, 'unimplemented TODO']
];
for (const [pattern,label] of prohibitedSourcePatterns) check(`No ${label}`, !pattern.test([main,preload,renderer,db,ai,html].join('\n')));

const failed = checks.filter((item) => !item.pass);
for (const item of checks) console.log(`${item.pass ? 'PASS' : 'FAIL'} ${item.name}${item.detail ? ` — ${item.detail}` : ''}`);
console.log(`\n${checks.length - failed.length}/${checks.length} validation checks passed.`);
if (failed.length) process.exit(1);
