# API Sync Inspector

API Sync Inspector answers the difference between **the key connects** and **the application loaded usable data**.

Each resource displays:

- Resource name.
- Status: OK, syncing, missing scope or failed.
- Loaded item count.
- Required scope.
- HTTP status.
- Request duration.
- Last successful synchronization.
- Exact last error.

The inspector also shows synchronization history with the trigger type, account type, planned resources, successes and failures.

Examples:

- `agenda · OK · 84`
- `orders · OK · 12`
- `messages · Missing scope · messages:read`
- `resellers · Failed · invalid JSON response`

A partial run keeps previously loaded cache available while clearly identifying the failed resource. Use **Sync all resources** after correcting scopes or server errors.
