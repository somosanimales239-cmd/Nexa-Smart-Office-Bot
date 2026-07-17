# Changelog

## 1.1.0 — Connected Business + Nexa Pulse

### Connected Business
- Added a secure AutoMarket Pro connector using a scoped API key.
- Added support for `Authorization: Bearer` against `/api/v1/index.php`.
- Added automatic endpoint normalization for a domain, subfolder, or complete API URL.
- Added `ping` and `connection-map` discovery before data synchronization.
- Added read-only synchronization for store, dealer/admin summaries, listings, orders, agenda contacts, message metadata, and reseller records when allowed by the key.
- Added encrypted API-key storage through Electron `safeStorage`.
- Added local resource snapshots and deterministic change detection.
- Added a Connected Business dashboard with cached API summaries and recent records.
- Added manual Sync, automatic polling, Test connection, key rotation, and Disconnect controls.

### Nexa Pulse notifications
- Added explicit user permission before desktop notifications are enabled.
- Added a professional in-app notification center with an animated AI assistant, thought-cloud presentation, unread count, severity, timestamps, read, dismiss, and mark-all-read controls.
- Added compact native Windows notifications with the Nexa AI image.
- Added independent choices for in-app and Windows delivery by category.
- Added quiet hours, sound control, system-tray monitoring, and optional Windows startup.
- Added local task, appointment, and reminder categories.
- Added connected-business order, message, reseller, agenda, listing, connection-health, and summary categories.
- Added first-sync baseline behavior to avoid notifying the user about every historical record.
- Added deduplication so the same remote change is not announced repeatedly.

### Background operation
- Added system tray support.
- Closing the window can keep the notification monitor running with user approval.
- Added tray commands to open the application, open Nexa Pulse, or quit fully.

### Data and testing
- Added SQLite migration 3 with integration status, resource snapshots, notification preferences, and notification events.
- Added 27 core integration tests and 7 connected-business/notification tests.
- Updated project, delivery, implementation, and contract validators.
- Updated application version to 1.1.0.
