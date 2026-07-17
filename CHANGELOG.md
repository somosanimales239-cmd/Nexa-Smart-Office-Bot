# 1.0.1

- Added exact executable contract markers required by Nexa Local Build Validation.
- Added a direct, shared `app:health` IPC handler and preload invocation so the active Electron graph proves `ipcMain.handle` connectivity.
- Made the Windows workflow execute the contract-declared `node scripts/integration-tests.js` command directly.
- Preserved all contacts, leads, tasks, agenda, alerts, AI provider, backup and packaging functionality.

# Changelog

## 1.0.0 — 2026-07-16

- Added complete secure Electron shell.
- Added local SQLite migrations and durable business data.
- Added contacts, leads, tasks and agenda CRUD.
- Added alerts and Windows notifications.
- Added OpenAI Responses API provider.
- Added DeepSeek Chat Completions provider.
- Added encrypted API-key storage using Electron safeStorage.
- Added AI suggestion history and approval-only workflow.
- Added activity logging.
- Added manual and automatic database backups with restore safety copy.
- Added professional dark responsive interface.
- Added source validation, integration tests and Electron UI smoke.
- Added GitHub Actions packaging for NSIS Installer, Portable EXE and Windows ZIP.
- Added post-build artifact verification and SHA-256 manifest.
