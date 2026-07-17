# Connected Business setup

## AutoMarket Pro API key

Create the key from one of these existing AutoMarket Pro areas:

- Admin: `Admin > API Keys` (`/admin/api_keys.php`)
- Dealer: `Dealer Office > API Keys` (`/dealer/api_keys.php`)

Recommended dealer scopes:

- `store:read`
- `dealer:read`
- `listings:read`
- `orders:read`
- `agenda:read`
- `messages:read`
- `resellers:read`

An administrator may additionally grant `admin:read` when platform totals are needed.

The complete API key is displayed only once by AutoMarket Pro. Paste it directly into Nexa Smart Office Bot and keep the original in a secure password manager.

## Connect the application

1. Open **Connected Business**.
2. Enter the public HTTPS URL of the AutoMarket Pro website. A domain such as `https://example.com` is sufficient; Nexa adds `/api/v1/index.php` automatically.
3. Paste the API key.
4. Choose an automatic synchronization interval.
5. Press **Test connection**. The application saves the key encrypted before testing.
6. Press **Sync now** to create the first local baseline.

The first synchronization does not announce all historical records. Later changes can create notifications according to the choices in **Nexa Pulse**.

## Security behavior

- The API key is stored through Windows/Electron `safeStorage` and is never returned to the renderer.
- Nexa sends the key through `Authorization: Bearer` only to the configured HTTPS endpoint.
- The key is never written to logs, backups, GitHub, build artifacts, HTML, or SQLite.
- Nexa only reads scopes granted by the key.
- Dealer keys remain limited by the server to their store.
- Passwords, validation documents, driver-license images, raw credit applications, full private message bodies, database files, and server secrets are not imported.
- Disconnecting removes the encrypted local key and stops automatic synchronization.

## Nexa Pulse permission

1. Open **Nexa Pulse**.
2. Press **Enable notifications**.
3. Review the confirmation dialog and choose **Allow notifications**.
4. Select which categories can appear inside the application, as Windows notifications, both, or neither.
5. Configure quiet hours, sound, tray monitoring, and optional Windows startup.
6. Press **Send test**.

Large notifications appear inside Nexa with the animated AI assistant and thought cloud. Windows receives a smaller native notification while the program is running in the foreground or system tray.
