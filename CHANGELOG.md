# Changelog

## 1.4.0

- Rebuilt Messages as a split inbox and full-conversation workspace.
- Added authorized full-thread loading through the `message-thread` API resource.
- Added near-real-time refresh intervals of 3, 5, 10 or 15 seconds while a conversation is open.
- Added inbound and outbound message bubbles, sender identity, timestamps and delivery status.
- Added a durable local cache for message threads, entries, reply drafts and outbox attempts.
- Added a Knowledge Engine that checks approved local answers before using OpenAI or DeepSeek.
- Added confidence-based matching and usage counts for reusable response knowledge.
- Added AI fallback with the complete bounded conversation and safe connected-business context.
- Added user-confirmed sending through `message-send` with idempotency protection.
- Added `message-read` support.
- Added an optional “Teach Nexa from this approved reply” workflow.
- Added a website capability banner when the connected API still exposes metadata only.
- Updated AI Suggestions with a Live conversation reply mode.
- Preserved all v1.3.0 scrolling, 40-record pagination, visual agenda, contacts, leads and connected workspace behavior.
