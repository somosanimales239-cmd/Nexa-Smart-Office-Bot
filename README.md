# Nexa Smart Office Bot

Nexa Smart Office Bot is a local-first Windows desktop application for contacts, leads, appointments, tasks, reminders, business alerts, AI suggestions, connected marketplace data and protected SQLite backups.

## Main features

- Local contacts, leads, agenda, tasks and reminders.
- User-configured OpenAI and DeepSeek providers.
- API keys protected with Electron `safeStorage`.
- Local SQLite workspace with additive migrations and backup recovery.
- Nexa Pulse notifications inside the application and through Windows.
- Full AutoMarket Pro synchronization after the API connection test.
- Account-aware support for Dealer, Reseller and Administrator keys.
- Read-only connected contacts, orders, listings, messages, appointments, stores and summaries.
- Phone normalization so common formats are treated as the same number.
- API Sync Inspector with status, item count, required scope, HTTP status, duration, last success and last error for every resource.
- GitHub Actions delivery for NSIS Installer, Portable EXE and Windows ZIP.

## Version 1.2.0

Version 1.2.0 replaces the connection-only behavior with a complete synchronization pipeline:

`ping → connection-map → account detection → allowed resources → protected local cache → dashboard and business views → per-resource diagnostics`

A failed optional resource no longer hides the data loaded successfully from other resources. Nexa shows the exact failed resource and missing scope while keeping the connected account available.

See `CONNECTED_BUSINESS_SETUP.md` and `API_SYNC_INSPECTOR.md`.
