# Connected Business setup

## API endpoint and authentication

Nexa accepts the public AutoMarket Pro website URL and adds `/api/v1/index.php` automatically.

Every request sends both supported headers:

- `Authorization: Bearer YOUR_API_KEY`
- `X-Nexa-Api-Key: YOUR_API_KEY`

The API key is protected with Electron `safeStorage`. It is not returned to the renderer, stored in SQLite, written to logs or included in builds and backups.

## Synchronization order

Nexa now performs the complete sequence:

1. `resource=ping`
2. `resource=connection-map`
3. Detect Dealer, Reseller or Administrator account.
4. Read the granted scopes and available resources.
5. Synchronize each permitted resource.
6. Filter the response to the documented safe fields.
7. Store a read-only local cache.
8. Update Dashboard, Contacts, Leads, Agenda and Connected Business.
9. Record the result in API Sync Inspector.

## Dealer key

Recommended scopes:

- `store:read`
- `dealer:read`
- `listings:read`
- `orders:read`
- `agenda:read`
- `messages:read`
- `resellers:read`

Nexa synchronizes store, dealer-summary, listings, orders, agenda, message metadata and reseller activity.

## Reseller key

Recommended scopes:

- `reseller-profile:read`
- `reseller:read`
- `reseller-listings:read`
- `reseller-appointments:read`
- `agenda:read`
- `messages:read`

Nexa synchronizes the reseller profile, summary, assigned listings, appointments, agenda contacts and message metadata.

## Administrator key

Recommended scopes depend on the desired views:

- `admin:read`
- `users:read`
- `stores:read`
- `listings:read`
- `orders:read`
- `agenda:read`
- `messages:read`
- `resellers:read`
- `validation:read`

Nexa can synchronize the administrative summary, stores, safe user metadata, listings, orders, agenda, message metadata, resellers, dealer validation metadata and API-key status.

## Security filtering

Nexa only caches documented safe fields. It rejects or discards unexpected password, API secret, SMTP secret, reset-token and private database fields even if a remote endpoint mistakenly includes them.

It does not import full private message bodies, database files, password vaults, API key hashes, sensitive document images or complete credit applications.

## Partial synchronization

A missing scope does not disconnect the whole account. API Sync Inspector records the affected resource as **Missing scope** and continues loading every other permitted resource.
