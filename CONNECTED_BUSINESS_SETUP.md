# Connected Business setup

## API endpoint and authentication

Nexa accepts the public AutoMarket Pro website URL and adds `/api/v1/index.php` automatically.

Every request sends both supported authentication headers:

- `Authorization: Bearer YOUR_API_KEY`
- `X-Nexa-Api-Key: YOUR_API_KEY`

The API key is protected with Electron `safeStorage`. It is not returned to the renderer, stored in SQLite, written to logs or included in builds and backups.

## Base synchronization

Nexa performs the following sequence:

1. `resource=ping`
2. `resource=connection-map`
3. Detect Dealer, Reseller or Administrator account.
4. Read granted scopes and available resources.
5. Synchronize each permitted resource.
6. Filter responses to documented safe fields.
7. Store a read-only local cache.
8. Update Dashboard, Contacts, Leads, Agenda, Messages and Connected Business.
9. Record each result in API Sync Inspector.

## Dealer key scopes

- `store:read`
- `dealer:read`
- `listings:read`
- `orders:read`
- `agenda:read`
- `messages:read`
- `resellers:read`

For two-way Messages, also grant:

- `messages:write`

## Message capabilities

The existing `resource=messages` endpoint supplies the inbox/thread list and safe metadata.

For complete conversations, the website must additionally advertise and implement:

- `message-thread` for full authorized thread history.
- `message-send` for user-approved outgoing replies.
- `message-read` for read-state synchronization.

Nexa stores full message bodies only after the authorized `message-thread` endpoint returns them. Bodies stay in the local app database and are not copied to builds, logs or backups containing secrets.

## Partial capability behavior

When the website still provides metadata only:

- Inbox rows continue to appear.
- Nexa displays a clear API capability warning.
- Full conversation loading and Send remain disabled.
- Contacts, Leads, Agenda and every other connected resource continue working.
