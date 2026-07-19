# Nexa Smart Office Bot 1.6.5 Installation

This is one complete source replacement for the existing Nexa Smart Office Bot project.

1. Open Manual Delivery in Nexa App Builder Pro.
2. Select the existing Nexa Smart Office Bot project.
3. Create a new manual delivery.
4. Upload the single ZIP for version 1.6.5.
5. Apply staged files once.
6. Confirm the application version is 1.6.5.
7. Run Local build validation.
8. When validation is green, select Push to GitHub and Build.

Do not combine this package with version 1.6.0 or older patches.

## Existing data preservation

Migration 8 is additive and idempotent. It preserves contacts, leads, orders, tasks, appointments, message history, drafts, outbox, API configuration, encrypted keys, notifications, custom knowledge and the built-in automotive library.

The migration adds only:

- The Messages AI switch setting, enabled for an existing authorized installation unless the user turns it off.
- Per-thread automatic-reply block state and its local audit information.

## First supervised check

1. Open Messages and confirm **AI Messages ON**.
2. Open AI Control and review **Live Readiness**.
3. Press **Run authorized actions now** once.
4. Read the exact result shown. It will identify no unanswered messages, missing endpoint or scope, quiet hours, limits, confidence, safety, missing verified context, disabled fallback or another concrete reason.
5. Open Action History before leaving background operation active.

For live dealer scheduling, create or rotate the connected website API key with `dealer-appointment-availability:read`, then run **Test connection** and **Sync now**. AI Control should show both the endpoint and its read scope as Ready.

The per-thread checkbox blocks automatic replies only for that conversation. Nexa continues reading and analyzing it.
