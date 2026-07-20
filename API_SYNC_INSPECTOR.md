# API Sync Inspector

API Sync Inspector shows whether the connected key loaded usable data, not merely whether authentication succeeded.

Each resource displays:

- Resource name.
- Status: OK, syncing, missing scope or failed.
- Loaded item count.
- Required scope.
- HTTP status.
- Request duration.
- Last successful synchronization.
- Exact last error.

Important resources for version 1.6.8 include:

- `messages`
- `message-thread`
- `message-send`
- `message-read`
- `dealer-appointment-availability`
- `dealer-agenda-calendar`
- `appointment-create` when supported

`appointment-create` is write-only and is never called during read synchronization. AI Control reports its endpoint and `appointment-create:write` scope separately.

Examples:

- `agenda · OK · 84`
- `orders · OK · 12`
- `messages · Missing scope · messages:read`
- `dealer-appointment-availability · OK · 18`
- `appointment-create · Not advertised`

A partial run keeps previously loaded cache available while identifying the failed resource. AI Control never bypasses a missing resource or scope.
