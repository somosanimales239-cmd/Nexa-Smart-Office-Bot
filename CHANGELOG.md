# Changelog

## 1.6.5

- Added full discovery and synchronization for `dealer-appointment-availability` with the `dealer-appointment-availability:read` scope.
- Preserved weekly schedules, blocked/off dates, special open dates, booked times, verified slots and reseller listing assignments in a safe live snapshot.
- Connected live website availability to Knowledge replies and external AI context.
- Prevented automatic appointments from overlapping existing local Agenda entries.
- Kept remote appointment creation optional while always supporting the authorized local Agenda path.

## 1.6.4

- Added compatibility with the website's current `messages_write_enabled`, `message_send_endpoint` and `two_way_chat_enabled` discovery fields.
- Merged safe top-level and nested `data` discovery values before capability detection.
- Changed the message-send JSON payload to the website contract: `thread_id` plus `message`.
- Kept both `Authorization: Bearer` and `X-Nexa-Api-Key` on every request.
- Invalidated the stored ping/connection-map when a new URL or API key is saved.

## 1.6.3

- Prevented background conversation synchronization from silently marking website messages as read.
- Kept unread messages eligible for later automatic attempts when the first response engine pass is delayed or skipped.
- Added an exact diagnostic for the `Require unread message` filter and recovery of already-read unanswered threads.
- Preserved the website API `message_capabilities` contract.

## 1.6.2

- Fixed the connection-map sanitizer so safe message scopes and endpoint advertisements are not discarded.
- Normalized scope and endpoint aliases before calculating AI Control readiness.
- Unified Messages composer and AI Control readiness so they no longer disagree about write access.
- Added regression coverage for `messages:write`, `messages-send`, mixed-case scopes and explicitly disabled capabilities.

## 1.6.1

- Added the Messages-level AI Messages ON/OFF master switch.
- Fixed the renderer bug that treated a nonzero per-message skipped count as a skipped whole automation cycle and displayed the misleading `not ready` message.
- Replaced the ambiguous cycle result with `cycle_skipped`, `skipped_count`, `failed_count`, `reason_counts`, readiness and refresh diagnostics.
- Added exact user-facing explanations for no unanswered messages, thread-loading failures, quiet hours, limits, confidence, missing verified context, disabled fallback and blocked threads.
- Added per-conversation automatic-reply blocking while retaining synchronization, reading, notifications and manual AI review.
- Removed implicit learning from sent replies; approved knowledge remains a deliberate user action.
- Added notification deep links for messages, appointments, tasks, leads, contacts, listings and notification center fallback.
- Added migration 8 for message automation controls. It is additive and idempotent.
- Prevented stale removed website threads from being considered for automatic replies.

## 1.6.0

- Added AI Control with explicit master authorization and detailed automatic-action parameters.
- Added guarded automatic customer message sending and verified-slot appointment creation.
- Added Dealer Appointment Availability, Emergency pause and automatic-action audit history.
- Added hard protections preventing automatic customer-record changes and automatic deletion.

## 1.5.0

- Added the Automotive Dealer Knowledge Library with 2,880 bilingual knowledge records and 8,640 response variations.

## 1.4.0

- Added complete conversation reading, Knowledge-first reply preparation, AI fallback, drafts, outbox and two-way message API support.
