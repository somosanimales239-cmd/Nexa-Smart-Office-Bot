# Changelog

## 1.2.0

- Replaced connection-only behavior with complete account-aware API synchronization.
- Added strict `ping` and `connection-map` discovery before business resources.
- Added Dealer, Reseller and Administrator resource plans.
- Added API Sync Inspector with per-resource status, count, scope, HTTP code, duration and last error.
- Added synchronization run history and partial-success reporting.
- Added protected read-only connected-business cache in SQLite.
- Added safe-field allowlists that discard unexpected secret and sensitive response fields.
- Added normalized phone search for connected agenda contacts.
- Added connected contacts to Contacts, website inquiries to Leads and remote appointments to Agenda.
- Added connected account metrics and navigation to Dashboard.
- Added missing-scope detection without unnecessary HTTP calls.
- Preserved successful resources when another resource fails.
- Added idempotent upgrade migration from 1.1.0.
- Updated application version to 1.2.0.

## 1.1.0

- Added Connected Business API-key integration.
- Added encrypted AutoMarket Pro key storage.
- Added Nexa Pulse, Windows notifications, tray monitoring and notification preferences.
