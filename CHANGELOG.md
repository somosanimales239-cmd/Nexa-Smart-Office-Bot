# Changelog

## 1.6.15

- Added AutoMarket Pro appointment reservation V8 discovery, aliases, response fields and four-resource post-create refresh.
- Reused customer phone/email from thread participants, structured message metadata and free-text conversation history.
- Made phone the minimum contact requirement for authorized automatic appointment creation without requesting it twice.
- Removed duplicate dealer addresses from appointment confirmations.
- Refreshed website Agenda contacts and retained `reserved_slot_key` after reservation.
- Linked the remote reservation to the local calendar and deduplicated the corresponding Lead/Dealer Agenda copies.
- Added the Dealer Agenda `Reserve Appointment` shortcut and end-to-end V8 regressions.

## 1.6.14

- Removed regular-expression slash delimiters from the new website-root and Dealer Lead URL helpers in `src/app.js`.
- Replaced them with explicit leading/trailing path trimming and string-prefix/suffix checks compatible with the page's simplified Local build validation.
- Added `NEXA_LOCAL_BUILD_DELIMITER_COMPATIBILITY_V2` and regression assertions while preserving all AutoMarket Pro V7 appointment and Lead behavior.

## 1.6.13

- Reviewed the supplied `public_html` V7 implementation and aligned Nexa with its real Dealer Agenda, availability, Lead/order and appointment-create response shapes.
- Added full post-reservation roundtrip synchronization for availability, Dealer Agenda and Dealer Office Leads.
- Preserved and normalized V7 Lead source/contact fields that the older allowlist discarded.
- Added V7 reseller `orders`, `listings` and `resellers` resource planning under `reseller:read`.
- Added Dealer Office shortcuts and per-Lead edit links derived from the configured HTTPS website root.
- Added recoverable HTTP 409 slot-race handling with refreshed verified alternatives.
- Added contract markers `NEXA_AUTOMARKET_APPOINTMENT_LEADS_V7` and `NEXA_APPOINTMENT_PAGE_V7_SYNC_V1` plus regression coverage.

## 1.6.12

- Added a date-scoped appointment conversation state machine so a repeated hour cannot select a slot from another day.
- Made the newest customer date correction invalidate stale pending contact requests and older dealer offers.
- Expanded the English/Spanish appointment library from 304 phrases, 34 intents and 72 templates to 371 phrases, 40 intents and 90 templates.
- Added professional date-correction acknowledgements plus phone-only and name-plus-phone collection replies.
- Extracts phone/email from any inbound appointment message and keeps the customer name supplied by the website thread.
- Sends `thread_id` in the guarded appointment POST and permits thread-derived Lead creation without a listing ID.
- Added discovery aliases for `lead-appointment-create`, `nexa-appointment-create` and `appointment-create-from-thread`.
- Requires the remote response to confirm an appointment/Lead identifier and a reserved slot before local confirmation.
- Captures remote Lead/order IDs, source metadata and Lead URL in the automatic-action audit record.
- Added exact communication and automatic-action regressions for the reported July 20 Tuesday/Saturday failure.

## 1.6.11

- Rewrote the customer-contact prompt without an apostrophe embedded inside a differently quoted JavaScript string.
- Replaced the matching regression-test expression with validator-safe wording.
- Expressed the permitted name apostrophe as a Unicode escape inside the contact parser character class.
- Preserved all 1.6.10 appointment recovery behavior and added standalone syntax checks for the two files reported by Local build validation.

## 1.6.10

- Fixed Spanish morning text being misread as “tomorrow” and added common weekday typo recovery, including `sababdo` → Saturday.
- Added month-name date parsing and date recovery from prior dealer offers independent of currently available groups.
- Prevented a refreshed slot list from resetting a requested Saturday to the earliest Tuesday.
- Added a guarded contact-collection step for appointments missing customer identity.
- Preserved and revalidated the selected slot while asking for name and phone/email.
- Continued appointment creation after contact details arrive and sent the normal confirmation.
- Made old failed identity attempts recoverable without deleting their audit record.
- Added customer-facing explanations for creation failures so the appointment flow cannot stop silently.
- Added exact regressions for the reported July 20 Saturday date change and missing-identity failure.

## 1.6.9

- Fixed cross-store blocked-date leakage when availability and Dealer Agenda calendar snapshots are merged.
- Added store/dealer/listing-aware schedule and blocked-date evaluation.
- Made verified open slots override contradictory generic day-off metadata while exact booked-time conflicts remain authoritative.
- Added calendar traversal for nested `stores`, `days`, `slots` and `available_slots` records.
- Added contextual 12-hour selection so a customer can choose “1:30” after Nexa offered 1:30 PM.
- Added Spanish morning/afternoon/evening time parsing.
- Prevented appointment availability questions from being treated as booking authorization.
- Added graceful revalidation when a previously offered slot disappears.
- Made appointment collision checks store-aware.
- Added exact July 20 regression coverage for inquiry, offer, selection and agenda refresh behavior.

## 1.6.8

- Made appointment wording regression assertions accept every equivalent bundled natural response on Windows, UTC and local-time runners.
- Added `dealer-agenda-calendar` discovery, safe synchronization, cache replacement and Agenda/Knowledge integration.
- Added V6 capability detection for availability, calendar and appointment creation using enable flags, endpoint fields, resources and scopes.
- Added guarded `appointment-create` POST support with the documented date/time/customer body.
- Required `appointment-create:write` whenever the website advertises scopes.
- Refreshes the remote calendar immediately after a successful website appointment.
- Filters offered times against booked website calendar appointments and local Agenda appointments.
- Added Dealer Appointment Agenda readiness diagnostics and user interface summaries.
- Added V6 regression coverage for discovery, cache safety, creation and refresh behavior.

## 1.6.7

- Added a dedicated bilingual appointment communication library with 304 phrases, 34 intents and 72 dynamic professional templates.
- Added appointment topic locking so contextual follow-ups cannot be misclassified as vehicle inventory questions.
- Added structured recovery of requested dates, dealer-restated time preferences, offered options and short slot selections.
- Added morning, afternoon, evening, before-time and after-time preference ranking.
- Added a closing strategy that recommends the best verified Agenda slot and limits offers to three useful options.
- Added cross-day preference handling: the next available day is offered together with a later exact preference match when appropriate.
- Filtered Knowledge appointment suggestions against scheduled local Agenda conflicts.
- Added exact regression coverage for the reported Spanish Monday/day-off conversation and its 7:30 PM selection.
- Added explicit safeguards preventing generic inventory Knowledge from taking over an active appointment conversation.

## 1.6.6

- Added a professional bilingual appointment conversation planner shared by Knowledge and guarded automatic actions.
- Added verified daily-hours explanations, same-day slot alternatives and automatic next-available-day offers.
- Added courteous appointment-decline replies with dealer contact information from the live website snapshot.
- Required explicit booking intent plus an exact verified slot before creating a local Agenda appointment.
- Added contextual recognition for short customer follow-ups without treating unrelated short messages as appointment intent.
- Expanded regression coverage for offers, blocked days, rejections, contact closings, slot selection and non-creation from availability questions.

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
