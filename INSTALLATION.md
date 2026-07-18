# Nexa Smart Office Bot 1.6.0 Installation

This package is one complete source replacement for the existing Nexa Smart Office Bot project.

1. Open Manual Delivery in Nexa App Builder Pro.
2. Select the existing Nexa Smart Office Bot project.
3. Create a new manual delivery.
4. Upload the single ZIP for version 1.6.0.
5. Apply staged files once.
6. Confirm the application version is 1.6.0.
7. Run Local build validation.
8. When validation is green, select Push to GitHub and Build.

Do not combine this package with version 1.5.0 or older patches.

## Existing data preservation

Migration 7 is additive and idempotent. It preserves:

- Contacts, leads, orders, tasks, reminders and appointments.
- Message history, drafts and outbox records.
- AutoMarket Pro API configuration.
- Encrypted website and AI provider keys.
- Notification preferences.
- Custom approved knowledge.
- The 2,880-record built-in automotive library.

## First use after installation

1. Open AI Control.
2. Review the hard boundaries.
3. Leave Automatic actions disabled until all parameters are configured.
4. Enable only the desired message and appointment actions.
5. Check the explicit authorization box.
6. Save authorization.
7. Use Run authorized actions now for the first supervised test.
8. Review Action History before leaving background operation enabled.

The Emergency pause button disables automatic messages and appointments immediately without deleting existing data.
