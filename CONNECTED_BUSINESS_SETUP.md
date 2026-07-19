# Connected Business setup

## API endpoint and authentication

Nexa accepts the public AutoMarket Pro website URL and adds `/api/v1/index.php` automatically.

Every request sends both supported authentication headers:

- `Authorization: Bearer YOUR_API_KEY`
- `X-Nexa-Api-Key: YOUR_API_KEY`

The API key is protected with Electron `safeStorage`. It is not returned to the renderer, stored as plain text in SQLite, written to logs or included in builds.

## Base synchronization

Nexa performs this sequence:

1. `resource=ping`
2. `resource=connection-map`
3. Detect Dealer, Reseller or Administrator account.
4. Read granted scopes and available resources.
5. Synchronize each permitted resource.
6. Filter responses to documented safe fields.
7. Store a read-only local cache.
8. Update Dashboard, Contacts, Leads, Agenda, Messages and Connected Business.
9. Record each result in API Sync Inspector.

## Recommended dealer key scopes

- `store:read`
- `dealer:read`
- `listings:read`
- `orders:read`
- `agenda:read`
- `messages:read`
- `resellers:read`
- `dealer-appointment-availability:read`
- `messages:write` for manual or authorized automatic replies

Recommended reseller keys should include `reseller-profile:read`, `reseller:read`, `reseller-listings:read`, `reseller-appointments:read`, `agenda:read`, `messages:read`, `messages:write` and `dealer-appointment-availability:read`.

The website may require a separate appointment-write scope for optional remote appointment creation.

## Message resources

For complete conversations and replies, the website should advertise:

- `messages`
- `message-thread`
- `message-send`
- `message-read`

Nexa stores authorized conversation bodies locally and never includes API keys in AI context.

Nexa 1.6.5 also accepts `endpoints` / `allowed_endpoints`, `messages_write_enabled`, `message_send_endpoint`, `two_way_chat_enabled` and the plural aliases `messages-thread`, `messages-send` and `messages-read`. It discovers `dealer-appointment-availability`, requires `dealer-appointment-availability:read`, and synchronizes a rolling 14-day verified schedule. Scopes are compared case-insensitively. Saving a new URL or API key invalidates the cached discovery contract; run **Test connection** and **Sync now** to load the current key.

## Dealer Appointment Availability

AI Control reads:

- `dealer-appointment-availability`

Nexa calls `GET resource=dealer-appointment-availability&from=YYYY-MM-DD&days=14`. The endpoint should expose only the connected dealer's verified schedule, including weekly hours, blocked/off dates, special open dates and verified open slots. Reseller keys may also return assigned listings. Nexa can create a local calendar appointment from an exact selected slot after the user authorizes automatic appointments.

For optional website-side creation, the connection map must advertise:

- `appointment-create`

Nexa leaves remote creation off by default. When it is unavailable, local calendar appointments continue to work.

## Partial capability behavior

Each resource is diagnosed independently in API Sync Inspector. One missing capability does not disconnect other working resources. Messages, contacts, leads, orders, agenda and appointment availability retain their last successful local cache when another resource fails.
