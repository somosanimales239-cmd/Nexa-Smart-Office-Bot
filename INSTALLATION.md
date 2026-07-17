# Nexa Smart Office Bot 1.5.0 Installation

1. Open Manual Delivery in Nexa App Builder Pro.
2. Select the existing Nexa Smart Office Bot project.
3. Create a new manual delivery.
4. Upload the single ZIP for version 1.5.0.
5. Apply staged files once.
6. Confirm the application version is 1.5.0.
7. Run Local build validation.
8. When validation is green, select Push to GitHub and Build.

Do not combine this package with version 1.4.0 or older patches. This package is a complete source replacement.

## Existing user data

Migration 6 is additive and idempotent. It preserves:

- Contacts, leads, tasks and appointments.
- Message history and drafts.
- AutoMarket API configuration.
- Encrypted API and AI provider keys.
- Notifications and user settings.
- Custom approved knowledge.

The built-in library is installed only once by stable record IDs. Reopening the program or running the migration again does not create duplicates.
