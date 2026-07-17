# AutoMarket Pro two-way Messages API contract for Nexa 1.5.0

This contract is the required website-side addition for complete message history and user-approved replies. The current metadata-only `messages` resource may remain unchanged.

## Security requirements

- All endpoints require an active API key.
- Dealer and reseller keys may access only threads belonging to their authorized store/account.
- `messages:read` is required to list and read conversations.
- `messages:write` is required to send a reply.
- Admin announcements are read-only.
- The server must reject a reply when `can_reply` is false.
- API keys, password hashes, SMTP secrets and unrelated private fields must never appear in responses.
- Every send request must be logged and idempotent.

## Connection map advertisement

`resource=connection-map` should include these resource names in `available_resources`:

```json
[
  "messages",
  "message-thread",
  "message-send",
  "message-read"
]
```

It may also include:

```json
{
  "capabilities": {
    "message_threads": true,
    "message_send": true,
    "message_read": true
  }
}
```

## Read a complete conversation

```http
GET /api/v1/index.php?resource=message-thread&thread_id=THREAD_ID&limit=100
Authorization: Bearer API_KEY
```

Successful response:

```json
{
  "data": {
    "thread": {
      "thread_id": "thread-123",
      "subject": "Listing inquiry",
      "context_type": "listing",
      "context_id": "listing-45",
      "store_id": "store-7",
      "participant_name": "Customer Name",
      "participant_type": "buyer",
      "last_message_id": "message-88",
      "last_message_at": "2026-07-17T12:30:00Z",
      "message_count": 8,
      "unread_count": 1,
      "is_announcement": false,
      "can_reply": true
    },
    "messages": [
      {
        "message_id": "message-88",
        "thread_id": "thread-123",
        "sender_type": "buyer",
        "sender_name": "Customer Name",
        "direction": "inbound",
        "body": "Is this item still available?",
        "body_format": "text",
        "sent_at": "2026-07-17T12:30:00Z",
        "status": "delivered",
        "is_read": false,
        "attachments": []
      }
    ],
    "count": 8,
    "has_more": false,
    "next_cursor": null
  }
}
```

The server may paginate older history with `cursor` or return newer messages with `after`.

## Send a user-approved reply

```http
POST /api/v1/index.php?resource=message-send
Authorization: Bearer API_KEY
Content-Type: application/json
Idempotency-Key: CLIENT_MESSAGE_ID
```

Request body:

```json
{
  "thread_id": "thread-123",
  "body": "Yes, it is available. Would you like to schedule a visit?",
  "client_message_id": "unique-client-message-id",
  "reply_to_message_id": "message-88"
}
```

Successful response:

```json
{
  "data": {
    "message_id": "message-89",
    "thread_id": "thread-123",
    "client_message_id": "unique-client-message-id",
    "sender_type": "dealer",
    "sender_name": "Business",
    "direction": "outbound",
    "body": "Yes, it is available. Would you like to schedule a visit?",
    "sent_at": "2026-07-17T12:31:00Z",
    "status": "sent",
    "is_read": true
  }
}
```

A repeated request with the same idempotency key must return the original message rather than insert a duplicate.

## Mark conversation as read

```http
POST /api/v1/index.php?resource=message-read
Authorization: Bearer API_KEY
Content-Type: application/json
```

Request body:

```json
{
  "thread_id": "thread-123",
  "last_message_id": "message-88"
}
```

## Recommended errors

- HTTP 401: invalid or expired key.
- HTTP 403: missing scope or thread belongs to another account.
- HTTP 404: thread not found.
- HTTP 409: thread is read-only or idempotency conflict.
- HTTP 422: invalid body or missing thread ID.
- HTTP 429: rate limit exceeded.

Error responses should include a safe `message`, `code` and `required_scope` when applicable.
