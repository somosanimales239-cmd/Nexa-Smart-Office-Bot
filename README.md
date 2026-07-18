# Nexa Smart Office Bot 1.6.2

Nexa Smart Office Bot is a local-first Windows business assistant for connected website conversations, automotive dealer knowledge, contacts, leads, orders, agenda, tasks, notifications and controlled AI assistance.

## New in 1.6.2

- Fixed false `Message send endpoint` and `messages:write scope` blocks caused by the connection-map safety filter removing valid capability fields.
- Preserved and normalized `scopes`, `allowed_scopes`, `permissions`, `endpoints` and `allowed_endpoints` from the safe connection contract.
- Added compatibility for singular/plural message endpoint names and case-insensitive scopes.
- Kept explicit server denials authoritative: a genuinely absent or disabled write capability still remains blocked.

## Existing 1.6.1 improvements

- Added a visible **AI Messages ON/OFF** switch inside Messages.
- Fixed the false **Automatic cycle skipped: not ready** result. A completed cycle with messages skipped for individual reasons is no longer misclassified as an unready cycle.
- Added exact automatic-cycle diagnostics for authorization, message endpoints, scopes, quiet hours, limits, confidence, missing verified context, AI fallback and per-thread blocks.
- Added a per-conversation option to block automatic replies while Nexa continues to synchronize, read, analyze and notify.
- Removed automatic Knowledge Engine learning from the send path. Knowledge is added only through deliberate user actions.
- Added notification deep links so in-app and Windows notifications open the related conversation, appointment, task, lead, contact or connected area.
- Prevented automatic processing of stale message threads that are no longer returned by the website API.

## Existing capabilities preserved

- Guarded AI Control and Emergency pause.
- Optional automatic messages and verified-slot appointments.
- 2,880 bilingual automotive dealer knowledge records and 8,640 approved response variations.
- Complete website conversation module, drafts, outbox and local audit history.
- Contacts, leads, orders, agenda, tasks, notifications and API Sync Inspector.

## Safety model

AI Messages can run only when both AI Control and the Messages switch authorize it. Blocking one conversation stops automatic sending for that thread but does not stop reading or manual AI review. Nexa never automatically changes customer records and has no automatic delete operation.

Existing SQLite data, encrypted API keys, provider keys, conversations, appointments, custom knowledge and settings are preserved during this update.
