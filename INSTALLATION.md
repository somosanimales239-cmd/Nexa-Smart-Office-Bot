# Nexa Smart Office Bot 1.1.0 update

This is an update for an existing Nexa Smart Office Bot 1.0.1 workspace.

## Apply through Nexa Manual Delivery

1. Open **Manual Delivery** in Nexa App Builder Pro.
2. Select the existing **Nexa Smart Office Bot** project.
3. Create a new manual delivery.
4. Upload `Nexa_Smart_Office_Bot_v1.1.0_CONNECTED_BUSINESS_NOTIFICATIONS_UPDATE.zip`.
5. Review the modified and new files.
6. Press **Apply staged files** once.
7. Confirm that the project version is `1.1.0` and Windows readiness is green.
8. Press **Push to GitHub & Build**.
9. Wait for validation, UI smoke, NSIS, Portable, ZIP, installer/uninstaller testing, and artifact upload.

Do not create an AI Engineering Task. This update contains the source files and does not use the development OpenAI key.

## Existing local data

Migration 3 is additive. It does not delete or recreate contacts, leads, tasks, appointments, reminders, suggestions, settings, activity history, or backups.

The application creates these new tables on first launch:

- `integration_status`
- `integration_snapshots`
- `notification_preferences`
- `notification_events`

## After installing the Windows update

1. Open **Connected Business** and connect the AutoMarket Pro API key.
2. Open **Nexa Pulse** and explicitly allow notifications.
3. Select notification categories and delivery channels.
4. Send a test notification.
5. Optionally enable **Keep monitoring in tray** and **Start with Windows**.

See `CONNECTED_BUSINESS_SETUP.md` for scopes and security details.
