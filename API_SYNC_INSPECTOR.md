# API Sync Inspector — Nexa 1.6.1

API Sync Inspector shows the status, count, required scope, HTTP result, last success and last error for every connected resource.

Important resources for version 1.6.1 include:

- `ping`
- `connection-map`
- `messages`
- `message-thread`
- `message-send`
- `message-read`
- `dealer-appointment-availability`
- `appointment-create`
- `orders`
- `agenda`
- `listings`
- `resellers`

Messages displays a **Website send ready** badge only when the connection map and scopes allow a real message send. A missing capability does not stop reading or synchronization, but it prevents Nexa from claiming that an outgoing message was sent.
