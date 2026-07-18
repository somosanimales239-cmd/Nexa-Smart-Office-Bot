# AutoMarket Pro Messages and Appointment API contract for Nexa 1.6.2

This contract supports complete conversations, manual or explicitly authorized automatic replies, dealer appointment availability and optional remote appointment creation.

## Security requirements

- Every endpoint requires an active API key.
- Dealer and reseller keys may access only their authorized account and store.
- `messages:read` is required to list and read conversations.
- `messages:write` is required to send replies and mark threads read.
- The appointment availability endpoint must return only the authorized dealer's schedule.
- Remote appointment creation requires an appointment-write capability or scope enforced by the server.
- Admin announcements are read-only.
- The server rejects replies when `can_reply` is false.
- Every send and appointment-create request must support idempotency and be logged.
- API secrets, password hashes, SMTP secrets and unrelated private fields must never be returned.

## Connection map advertisement

`resource=connection-map` should advertise supported resources:

```json
[
  "messages",
  "message-thread",
  "message-send",
  "message-read",
  "dealer-appointment-availability",
  "appointment-create"
]
```

Capabilities may also be advertised:

```json
{
  "capabilities": {
    "message_threads": true,
    "message_send": true,
    "message_read": true,
    "dealer_appointment_availability": true,
    "appointment_create": true
  }
}
```

Omit `appointment-create` or set its capability to false when remote creation is unavailable. Nexa will still create a local calendar appointment from verified availability when the user authorizes that behavior.

## Read a complete conversation

```http
GET /api/v1/index.php?resource=message-thread&thread_id=THREAD_ID&limit=100
Authorization: Bearer API_KEY
```

The response should contain a safe `thread` object and a `messages` array with message ID, direction, sender, body, timestamp, status and read state.

## Send a reply

```http
POST /api/v1/index.php?resource=message-send
Authorization: Bearer API_KEY
Content-Type: application/json
Idempotency-Key: CLIENT_MESSAGE_ID
```

```json
{
  "thread_id": "thread-123",
  "body": "Yes, I can help with that.",
  "client_message_id": "unique-client-message-id",
  "reply_to_message_id": "message-88"
}
```

A repeated idempotency key must return the original message rather than insert a duplicate.

## Mark a conversation read

```http
POST /api/v1/index.php?resource=message-read
Authorization: Bearer API_KEY
Content-Type: application/json
```

```json
{
  "thread_id": "thread-123",
  "last_message_id": "message-88"
}
```

## Read Dealer Appointment Availability

```http
GET /api/v1/index.php?resource=dealer-appointment-availability&limit=50
Authorization: Bearer API_KEY
```

Recommended response:

```json
{
  "data": {
    "slots": [
      {
        "slot_id": "slot-20260720-1000",
        "store_id": "store-7",
        "start_at": "2026-07-20T10:00:00-04:00",
        "end_at": "2026-07-20T10:30:00-04:00",
        "duration_minutes": 30,
        "location": "Main dealership",
        "status": "available",
        "available": true
      }
    ]
  }
}
```

Blocked, booked, closed or unavailable slots must not be returned as available.

## Optional remote appointment creation

```http
POST /api/v1/index.php?resource=appointment-create
Authorization: Bearer API_KEY
Content-Type: application/json
Idempotency-Key: AUTO_APPOINTMENT_KEY
```

```json
{
  "thread_id": "thread-123",
  "customer_name": "Customer Name",
  "customer_phone": "2395550100",
  "customer_email": "customer@example.com",
  "start_at": "2026-07-20T10:00:00-04:00",
  "end_at": "2026-07-20T10:30:00-04:00",
  "location": "Main dealership",
  "listing_id": "listing-45",
  "notes": "Created by Nexa under explicit user authorization."
}
```

The server must verify that the slot is still available, create at most one appointment for the idempotency key and return the appointment ID.

## Recommended errors

- HTTP 401 for invalid or expired key.
- HTTP 403 for a missing scope or unauthorized record.
- HTTP 404 for a missing thread or availability resource.
- HTTP 409 for a read-only thread, unavailable slot or idempotency conflict.
- HTTP 422 for invalid input.
- HTTP 429 for rate limiting.

Error responses should include a safe `message`, `code` and `required_scope` when applicable.
