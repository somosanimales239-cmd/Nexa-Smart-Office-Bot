# Nexa Smart Office Bot 1.2.0 update

This package updates an existing Nexa Smart Office Bot 1.1.0 workspace through Nexa App Builder Pro Manual Delivery.

## Apply the update

1. Open **Manual Delivery**.
2. Select the existing **Nexa Smart Office Bot** project.
3. Create a new manual delivery.
4. Upload `Nexa_Smart_Office_Bot_v1.2.0_FULL_API_SYNC_UPDATE.zip`.
5. Review the modified and new files.
6. Press **Apply staged files** once.
7. Confirm that the project version is `1.2.0` and Local build validation is green.
8. Press **Push to GitHub & Build**.
9. Wait for validation, tests, Electron UI smoke, NSIS, Portable, ZIP, installer testing and artifact upload.

Do not create an AI Engineering Task. This update contains the complete source changes and does not use the development OpenAI account.

## Existing data is preserved

Migration 4 is additive and idempotent. It preserves local contacts, leads, tasks, appointments, reminders, notification history, settings, API keys and backups.

It adds:

- Detailed resource status.
- Protected connected-business cache.
- Synchronization run history.
- Extended connected-account identity and health fields.

A v1.1.0 database was upgraded during testing while preserving its local contact and connection identity.

## After installing the Windows update

1. Open **Connected Business**.
2. Press **Test connection and load data** or **Sync now**.
3. Open **API Sync Inspector**.
4. Verify that `ping` and `connection-map` are green.
5. Review the count and error for each account-specific resource.
6. Grant any missing scope in AutoMarket Pro, rotate the key when necessary, and synchronize again.

Connected data is read-only inside Nexa. Original marketplace records remain controlled by AutoMarket Pro.
