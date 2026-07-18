# Nexa Smart Office Bot 1.6.0

Nexa Smart Office Bot is a local-first Windows business assistant for connected website conversations, automotive dealer knowledge, contacts, leads, orders, agenda, tasks, notifications and controlled AI assistance.

## New in 1.6.0

- New AI Control section with explicit user authorization.
- Optional guarded automatic customer replies.
- Automotive Knowledge Library first, external AI fallback only when separately authorized.
- Dealer Appointment Availability synchronization.
- Automatic local calendar appointments from exact verified slots.
- Optional website appointment creation only when the connected API advertises that capability.
- Emergency pause.
- Complete automatic-action audit history.
- Updated About area describing the real autonomy and safety model.
- Removed the obsolete two-way-chat upgrade warning from the application interface.

## Built-in automotive knowledge

The application includes 2,880 bilingual dealership knowledge records, 120 core intentions, 12 dealer segments and 8,640 approved response variations. Custom user-approved knowledge has priority over the built-in library.

## Safety model

Automatic actions are disabled by default. Nexa may send messages or create appointments only after the user enables the master authorization and the specific feature parameters.

Nexa never automatically changes customer records and has no automatic delete operation. Contacts, leads, orders, reseller records and customer profiles remain read-only to automation. Sensitive conversations are routed to human review.

## Local data

SQLite data, encrypted API keys, AI provider keys, drafts, message cache, appointments, knowledge settings and the automation audit remain in the application's local data directory. Existing data is preserved during updates.

See `AUTOMATIC_ACTIONS.md`, `AUTOMOTIVE_KNOWLEDGE_LIBRARY.md`, `CONNECTED_BUSINESS_SETUP.md` and `MESSAGING_API_SERVER_CONTRACT.md` for configuration details.
