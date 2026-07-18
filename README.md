# Nexa Smart Office Bot 1.6.1

Local-first Electron business assistant for Windows with AutoMarket Pro synchronization, complete conversations, an automotive dealership knowledge library, guarded AI actions and user-controlled automation.

## New in 1.6.1

- Added a visible **AI Messages ON/OFF** switch inside Messages.
- The Messages switch is independent from AI Control. Both must permit interaction before Nexa can answer automatically.
- Added a per-conversation checkbox: **Block automatic AI replies for this conversation**.
- A blocked conversation continues to synchronize, display, analyze and generate notifications, but Nexa does not answer it automatically.
- Added direct navigation from in-app and Windows notifications to the related conversation, appointment, lead, task, alert or API diagnostic.
- Added clear status badges for AI Control authorization and website send capability.
- Preserved manual reply preparation and manual sending.
- Preserved the 2,880-record bilingual Automotive Dealer Knowledge Library and 8,640 built-in response variants.

## Important behavior

The previous **Teach Nexa from this approved reply** option did not block automatic replies. It only saved a manually approved response as custom knowledge. Version 1.6.1 replaces that composer checkbox with the requested inverse safety control.

Automatic message interaction requires all applicable gates:

1. Connected website API and a valid API key.
2. `message-thread` and `message-send` support with `messages:read` and `messages:write`.
3. AI Control master authorization.
4. Automatic messages authorized in AI Control.
5. **AI Messages ON** in Messages.
6. The selected conversation is not blocked and is allowed to receive replies.
7. Confidence, rate, schedule, language and human-review safety rules pass.

When **AI Messages OFF**, Nexa still reads, synchronizes, analyzes and notifies. It does not automatically prepare through the background worker, send, mark read, or create message-driven appointments.

## Data safety

Migration 8 is additive and idempotent. It preserves contacts, leads, orders, conversations, drafts, appointments, settings, encrypted keys, custom knowledge and the complete built-in automotive library. Nexa never automatically deletes customer data.
