# Nexa Smart Office Bot 1.0.1 — Manual Delivery

This is a complete source replacement prepared for the existing **Nexa Smart Office Bot** project.

## Apply it

1. Open **Manual Delivery** in Nexa App Builder Pro.
2. Select the existing project **Nexa Smart Office Bot**.
3. Create a **new** manual delivery. Do not reopen the blocked delivery.
4. Upload `Nexa_Smart_Office_Bot_v1.0.1_NEXA_GATE_FULL_REPLACEMENT.zip`.
5. Confirm that Nexa stages approximately 45 files.
6. Select **Apply staged files** once.
7. Open **Windows readiness / Local build validation** again.
8. Only when it is green, select **Push to GitHub & Build**.

Keep the existing repository:

`somosanimales239-cmd/Nexa-Smart-Office-Bot`

## Important

- This package contains no API keys, SQLite production database, node_modules or compiled artifacts.
- It preserves the application scope: Contacts, Leads, Agenda, Tasks, Alerts, OpenAI, DeepSeek, backups, Installer, Portable and ZIP.
- It replaces all source files required by the approved SBO-01 through SBO-04 contracts.
- The application package version is 1.0.1. Nexa may assign a separate workspace revision such as v1.0.3 when the delivery is applied.

## Expected workflow

The Windows workflow executes validation, the exact contract gate, package-script integration tests, the exact contract-declared integration command, implementation tests, acceptance tests, Electron UI smoke, electron-builder and artifact verification before upload.
