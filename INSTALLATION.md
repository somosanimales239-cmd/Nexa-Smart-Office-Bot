# Nexa Smart Office Bot 1.6.1 Installation

This is one complete source replacement for an existing Nexa Smart Office Bot project. Do not combine it with 1.6.0 or older patches.

## Apply through Manual Delivery

1. Open **Manual Delivery** in Nexa App Builder Pro.
2. Select the existing **Nexa Smart Office Bot** project.
3. Create one new manual delivery.
4. Upload the single ZIP for version 1.6.1.
5. Select **Apply staged files** once.
6. Confirm the application version is `1.6.1`.
7. Run **Local build validation**.
8. When the local gate is green, select **Push to GitHub & Build**.

## Existing user data

Migration 8 is additive and idempotent. It preserves:

- Contacts, leads, orders, tasks and appointments.
- Message history, drafts and outbox records.
- AutoMarket Pro connection settings and encrypted API key.
- AI provider settings and encrypted provider keys.
- Notification preferences and AI Control authorization.
- Custom approved knowledge.
- The 2,880-record Automotive Dealer Knowledge Library.

For users who already authorized automatic messages in 1.6.0, migration 8 initializes the new Messages switch from that existing authorization. The switch can then be controlled independently from Messages.

## First check after installing the EXE

1. Open **Messages**.
2. Confirm the badges show whether AI Control is authorized and whether website sending is available.
3. Turn **AI Messages ON** when automatic message interaction is desired.
4. Open a conversation and leave **Block automatic AI replies for this conversation** unchecked for threads Nexa may answer.
5. Use a test notification and confirm it opens the related section or exact conversation.
6. Review **AI Control → Action History** for skipped, blocked, sent or failed actions.

If **Website send unavailable** appears, the connected page has not advertised `message-send`/`messages:write`; Nexa will continue reading and analyzing but cannot truthfully send through the page until that API capability exists.
