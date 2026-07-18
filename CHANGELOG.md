# Changelog

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
