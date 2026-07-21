# Connected Business setup

## AutoMarket Pro appointment reservation V8

Nexa 1.6.15 uses the website's stable API resources rather than automating authenticated HTML forms:

1. Read `dealer-appointment-availability` and `dealer-agenda-calendar`.
2. Create the confirmed appointment with `appointment-create` and `appointment-create:write`.
3. Require a successful response containing a Lead/order/appointment ID and `reserved: true`.
4. Preserve `reserved_slot_key` and the server-provided `refresh_resources` list.
5. Immediately reload availability, Dealer Agenda, `orders` and `agenda` so Dealer Office Leads, contacts and Nexa's local calendar reflect the same reservation.

Dealer Office availability has no write endpoint in the supplied V8 website. Nexa therefore provides authenticated HTTPS shortcuts to Dealer Appointment Agenda, Reserve Appointment, Edit Availability and Dealer Leads. Leads open at `dealer/orders.php?highlight_order=...` for authorized manual editing.

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
- `dealer-agenda-calendar:read`
- `appointment-create:write` for authorized website appointment creation
- `messages:write` for manual or authorized automatic replies

Recommended reseller keys should include `reseller-profile:read`, `reseller:read`, `agenda:read`, `messages:read`, `messages:write`, `dealer-appointment-availability:read`, `dealer-agenda-calendar:read` and `appointment-create:write`.

The website may require a separate appointment-write scope for optional remote appointment creation.

For conversation-originated appointments, Nexa posts `thread_id`, `appointment_date`, `appointment_time`, `customer_phone` and notes to `appointment-create`. It also accepts `lead-appointment-create`, `nexa-appointment-create`, `appointment-create-from-thread`, `reserve-appointment-slot`, `agenda-reserve-appointment` and `lead-appointment-reserve`. The website may derive the customer name and listing/order context from the thread, create the Lead, reserve the slot and return the resulting IDs.

## Message resources

For complete conversations and replies, the website should advertise:

- `messages`
- `message-thread`
- `message-send`
- `message-read`

Nexa stores authorized conversation bodies locally and never includes API keys in AI context.

Nexa 1.6.8 accepts `endpoints` / `allowed_endpoints`, the V6 appointment enable/endpoint fields and the plural message aliases. It discovers both appointment read resources, requires their exact scopes and synchronizes a rolling 14-day verified schedule/calendar. Scopes are compared case-insensitively. Saving a new URL or API key invalidates the cached discovery contract; run **Test connection** and **Sync now** to load the current key.

## Dealer Appointment Availability

AI Control reads:

- `dealer-appointment-availability`

Nexa calls `GET resource=dealer-appointment-availability&from=YYYY-MM-DD&days=14`. The endpoint should expose only the connected dealer's verified schedule, including weekly hours, blocked/off dates, special open dates and verified open slots. Reseller keys may also return assigned listings. Nexa explains the dealer's hours, offers verified times on the requested day, moves to the next available day when necessary and creates a local calendar appointment only after the customer clearly selects a slot and the user authorizes automatic appointments.

For optional website-side creation, the connection map must advertise:

- `appointment-create`

It must also grant `appointment-create:write`. Nexa requires at least a customer phone, but first searches the complete conversation and participant metadata so it never asks twice. After a successful POST, Nexa reloads `dealer-appointment-availability`, `dealer-agenda-calendar`, `orders` and `agenda`, then links the returned remote ID to its local calendar entry.

## Dealer Agenda Calendar

Nexa calls `GET resource=dealer-agenda-calendar&from=YYYY-MM-DD&days=14`. It retains only documented safe schedule, blocked-date, slot and appointment fields. The synchronized appointments appear in Agenda, are added to AI/Knowledge context and prevent already occupied times from being recommended.

Nexa leaves remote creation off by default. When it is unavailable, local calendar appointments continue to work.

## Partial capability behavior

Each resource is diagnosed independently in API Sync Inspector. One missing capability does not disconnect other working resources. Messages, contacts, leads, orders, agenda and appointment availability retain their last successful local cache when another resource fails.
