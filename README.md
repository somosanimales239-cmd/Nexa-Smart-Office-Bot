# Nexa Smart Office Bot

Nexa Smart Office Bot is a local-first Windows desktop application for managing contacts, leads, appointments, tasks, reminders, alerts, AI suggestions and SQLite backups.

## Main features

- Contact management with search, tags and notes.
- Lead pipeline with status, priority, estimated value and follow-up dates.
- Local agenda with linked contacts and leads.
- Task management, due dates and Windows reminders.
- Actionable alerts for overdue tasks, lead follow-ups and upcoming appointments.
- User-configured OpenAI and DeepSeek providers.
- API keys encrypted with Electron `safeStorage`.
- Local SQLite workspace using Node's built-in `node:sqlite` module.
- Manual and automatic backups with restore protection.
- GitHub Actions build for NSIS Installer, Portable EXE and Windows ZIP.

## Security model

The renderer runs with `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`, a restrictive Content Security Policy and a narrow preload bridge. API keys are never exposed to the renderer after storage and are not included in logs, backups or builds.

## Build

The included GitHub Actions workflow runs validation, integration tests, Electron UI smoke, Windows packaging and artifact verification before publishing the downloadable workflow artifact.
