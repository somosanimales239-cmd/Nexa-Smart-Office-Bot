# Nexa Smart Office Bot 1.6.20

Nexa Smart Office Bot is a local-first Windows business assistant for connected website conversations, automotive dealer knowledge, contacts, leads, orders, agenda, tasks, notifications and controlled AI assistance.

## New in 1.6.20

- Adds a mandatory pre-book contact checkpoint after the customer accepts a verified offered time.
- Sends the structured bilingual Name/Phone/Email form before calling the website `appointment-create` endpoint.
- Prefills valid contact values already present in the conversation and leaves only missing values blank.
- Explicitly states that the appointment is not confirmed until the form is returned, Dealer Agenda reserves the slot, and Dealer Leads is created.
- Prevents AI or Knowledge from sending a premature booking confirmation during this checkpoint.
- Preserves the website Lead source labels `Nexa Smart Office Bot` and `Software appointment` after the verified reservation succeeds.
- Adds the exact Samir Tabarcia “Sí por favor” conversation as an automatic regression.

## Included from 1.6.19

- Prevents contact phrases such as `mi número`, `mi teléfono`, `my number`, or a phone-like value from becoming the Dealer Lead customer name.
- Requests missing appointment contact data through a bilingual, structured fill-in form with separate Name, Phone, and optional Email fields.
- Ignores blank form placeholders and asks only for fields that are still missing from the conversation or website thread.
- Reuses an existing valid name, phone, or email without requesting it again.
- Adds exact regressions for the reported `mi numero 2394446565` failure and for structured Spanish contact parsing.

## Included from 1.6.18

- Answers dealer and vehicle address questions immediately from synchronized website data instead of promising to verify later.
- Resolves `order/lead → listing → store/dealer` so reseller conversations receive the address for the correct dealer.
- Keeps the dealer address available to both the Knowledge engine and external AI reply context.
- Supports Spanish and English address follow-ups such as “ok dame la dirección” and “what is the address?”.
- Adds the reported `2003 EZGO Gol` conversation as an automatic end-to-end regression.

## Included from 1.6.17

- Reads the real nested Dealer Appointment Availability structure, including `stores`, `days`, and `mon` through `sun` schedule keys.
- Recovers customer name, phone, email, and location from the Dealer Lead linked to an order conversation.
- Treats reseller-authored messages as outbound on reseller connections so appointment context stays correct.
- Defaults upgraded workspaces to website Lead creation plus a verified Dealer Agenda reservation.
- Never confirms a local-only appointment when website reservation is selected but `appointment-create` is not ready.

## Included from 1.6.16

- Treats Dealer Agenda reservation as an all-or-nothing transaction. A Lead alone is no longer accepted as a completed appointment.
- Sends the complete Reserve Appointment data: thread, customer name, phone, optional email/location/listing, date, time and notes.
- Confirms success only after the website returns `reserved=true`, a remote ID, a complete Lead, the appointment appears in `dealer-agenda-calendar`, and the selected slot disappears from `dealer-appointment-availability`.
- Refreshes availability, Dealer Agenda, Dealer Leads and Agenda contacts after reservation; retries only the read verification and never repeats the POST.
- Reuses customer name, phone and email from thread participants, structured message fields and conversation text, and asks only for the missing field.
- Supports the complete V8 alias set, including `reserve-appointment-slot`, `agenda-reserve-appointment` and `lead-appointment-reserve`.
- Prevents duplicate local/Lead/Dealer Agenda calendar entries and exposes a direct Reserve Appointment shortcut.
- Mentions the dealer address only once in confirmations.

## Existing 1.6.14 improvements

- Rewrites the website-root and Dealer Lead link helpers with conservative string operations so the page's Local build validation no longer mistakes regular-expression slash delimiters for comments and reports a false extra `}` in `src/app.js`.
- Keeps the complete AutoMarket Pro V7 Dealer Agenda, availability, appointment-create and Dealer Office Lead synchronization from 1.6.13.
- Adds a permanent compatibility marker and implementation checks for the exact helper paths that triggered the local validator.

## Existing 1.6.13 improvements

- Matches the attached AutoMarket Pro Leads Appointment API V7 contract. A confirmed conversation appointment is created through `appointment-create`, stored by the website as a Lead/order and reserved in Dealer Appointment Agenda.
- After a successful reservation Nexa immediately refreshes `dealer-appointment-availability`, `dealer-agenda-calendar`, and `orders`, so the consumed slot disappears and the new Lead is visible locally without waiting for the next full sync.
- Dealer and reseller order responses preserve and normalize the safe V7 Lead fields, including customer contact data, appointment fields, `source_context`, `source_label`, and `created_by_platform`.
- Reseller synchronization follows the website's real V7 resources: `reseller:read` can load `orders`, `listings`, and `resellers` when connection-map advertises them.
- Connected Business and Agenda include HTTPS shortcuts to Dealer Appointment Agenda, Edit Availability, and Dealer Office Leads. Editing availability remains an authenticated Dealer Office operation because the website exposes no availability-write API.
- If the website returns HTTP 409 because a slot changed between selection and reservation, Nexa reloads live availability and offers updated verified alternatives.

## New in 1.6.12

- Replaces time-only appointment matching with a date-scoped conversation state machine. Identical times on Tuesday and Saturday can no longer cross days.
- Gives the latest customer date correction priority over stale offers and old contact requests.
- Invalidates a pending contact step when the customer changes the date or time, then continues from the corrected verified slot.
- Expands the dedicated bilingual appointment library to 371 English/Spanish phrases, 40 intents and 90 dynamic templates, including date corrections, explicit time selections and phone collection.
- Reads the customer name from the message thread and accepts a phone number in the same message as the selected time.
- Sends `thread_id`, date, time and phone to `appointment-create`, allowing the website to create the Lead and reserve the Agenda slot without requiring a listing ID when the thread supplies the context.
- Supports `lead-appointment-create`, `nexa-appointment-create` and `appointment-create-from-thread` as discovery aliases.
- Preserves `lead_id`, `order_id`, `appointment_id`, `reserved`, `source`, `source_context` and `lead_url` from the website response.
- Adds the complete reported Tuesday-to-Saturday conversation as a permanent end-to-end regression, including Lead creation and confirmation.

## Existing 1.6.11 improvements

- Removes the ambiguous apostrophe constructs that the website Local build validation incorrectly reported as unterminated JavaScript strings.
- Keeps the complete 1.6.10 appointment date, contact-collection, revalidation and booking recovery behavior unchanged.
- Validates both affected files as standalone JavaScript before delivery and verifies the complete extracted ZIP.

## Existing 1.6.10 improvements

- Recognizes the reported typo “sababdo” as Saturday and distinguishes “en la mañana” from “mañana” meaning tomorrow.
- Keeps an explicitly changed appointment date even when the old day's slots disappear during a calendar refresh.
- Reads natural Spanish/English month dates from prior appointment offers so the conversation cannot fall back to the earliest unrelated day.
- Converts missing customer identity into a recoverable chat step instead of a terminal automatic-action error.
- Asks for the customer's name and a phone or email while preserving the selected verified date and time.
- Revalidates that exact slot after the customer supplies contact information, then creates the appointment and sends confirmation.
- If the slot changed while collecting details, offers current verified alternatives instead of claiming success or going silent.
- Explains other appointment-creation failures to the customer rather than leaving only an internal notification.
- Recovers conversations that already contain the previous “Customer identity is not available” failed action.
- Adds the reported Saturday July 25 and missing-identity conversations as permanent automated regressions.

## Existing 1.6.9 improvements

- Keeps Dealer Appointment Agenda availability isolated by `store_id`, `dealer_id` and `listing_id` so a different dealer's day off cannot erase valid slots.
- Treats current verified open slots as authoritative when a mixed or stale calendar snapshot also contains a conflicting generic blocked date.
- Reads `stores[]`, `days[]`, `slots[]` and `available_slots[]` from `dealer-agenda-calendar` with inherited dealer/store/date context.
- Understands Spanish time expressions such as “2 de la tarde” and resolves a short “1:30” against the AM/PM option Nexa just offered.
- Separates a time inquiry (“¿qué tal a las 2?”) from a booking commitment (“1:30 está bien, allá nos vemos”).
- If an offered time becomes occupied during refresh, explains that the exact time changed and offers the remaining verified times instead of calling the entire day off.
- Prevents an appointment belonging to another store from blocking the connected dealer's same-time slot.
- Adds the reported July 20 conversation as an exact permanent regression test.

After updating, run **Test connection** and **Sync now** once so Nexa replaces both cached appointment snapshots.

## Existing 1.6.8 improvements

- Discovers the complete V6 appointment contract from `connection-map`, including explicit enable flags and endpoint names.
- Adds read support for `dealer-agenda-calendar` with the `dealer-agenda-calendar:read` scope and a rolling `from` + `days=14` window.
- Safely caches dealer/store schedules, closed dates, open slots and website appointments, replacing stale calendar data after every successful sync.
- Shows website appointments in Nexa Agenda and exposes a Dealer Appointment Agenda live summary.
- Adds the current Dealer Agenda calendar to daily AI context and bilingual appointment Knowledge.
- Filters recommendations against both local Nexa appointments and booked website calendar appointments.
- Creates authorized website appointments with the V6 `appointment-create` body only when `appointment-create:write` is present.
- Refreshes `dealer-agenda-calendar` immediately after a successful website appointment, then updates the local Agenda and audit trail.
- Adds exact contract tests for V6 discovery, safe calendar parsing, the POST body and the post-create refresh.

After updating, create or rotate the API key with `dealer-appointment-availability:read`, `dealer-agenda-calendar:read` and `appointment-create:write`, then run **Test connection** and **Sync now**.

## Existing 1.6.7 improvements

- Adds a separate `NEXA_BILINGUAL_APPOINTMENT_LIBRARY_V1` communication library exclusively for appointment conversations.
- Includes 304 curated English/Spanish customer expressions, 34 appointment intents and 72 professional dynamic response templates.
- Locks the active appointment topic across natural references such as “ese día”, “algo más disponible”, “the second one” and “that works”.
- Prevents ambiguous appointment follow-ups from falling into vehicle-inventory Knowledge while still allowing an explicit topic change.
- Preserves the requested date and time preference, including morning, afternoon, evening, before and after constraints.
- Recommends up to three verified conflict-free Agenda slots, identifies the best match and asks for a clear booking selection.
- When the next available day cannot satisfy the requested time band, offers its closest slot and also identifies a later date that does satisfy the preference.
- Filters live website availability against the local Agenda before Knowledge can recommend a time.
- Prohibits “I will check and reply later” promises; Nexa answers immediately from the verified data it currently has.
- Adds the reported July 19 appointment conversation as a permanent regression test in both Spanish and English flows.

## Existing 1.6.6 improvements

- Adds a professional bilingual appointment conversation system backed only by live, verified website availability.
- States the dealer's verified opening window for the requested day and offers all usable same-day times, up to a safe conversational limit.
- If the requested hour is unavailable, offers verified alternatives for that day and asks whether one is convenient.
- If the day is off, blocked, fully booked or the customer rejects its times, proposes the next available day with its hours and verified slots.
- Recognizes short follow-ups such as a time, an ordinal option or acceptance only within an active appointment conversation.
- Creates an Agenda appointment only after a clear booking commitment and an exact verified-slot selection; an availability question alone never creates one.
- If the customer declines the appointment, replies cordially and leaves the dealer phone, email, location and same-chat contact options when provided by the website.
- Uses the same appointment policy in Knowledge replies, guarded automatic messages and configured external AI instructions.

## Existing 1.6.5 improvements

- Discovers `dealer-appointment-availability` through `connection-map` and requires the new `dealer-appointment-availability:read` scope.
- Requests a rolling verified window with `from=YYYY-MM-DD&days=14`, with optional dealer `store_id` filtering.
- Safely retains dealer/store identity, contact and location data, slot duration, weekly schedules, blocked/off dates, special open dates, booked/unavailable times, verified open slots and reseller-assigned listings.
- Replaces the previous availability snapshot after every successful sync so website schedule changes become live Knowledge instead of stale custom text.
- Uses live verified availability for bilingual Knowledge replies, including explicit day-off and blocked-date answers.
- Filters website slots against the local Agenda and rechecks before creation so Nexa cannot double-book a local appointment.
- Keeps website appointment creation optional; without `appointment-create`, authorized appointments are created in Nexa's local Agenda.

After updating, create or rotate the website API key with `dealer-appointment-availability:read`, then run **Test connection** and **Sync now**.

## Existing 1.6.4 improvements

- Matches the current website connection contract without requiring any website-file changes.
- Reads scopes and endpoints from both nested `data` and top-level discovery fields.
- Supports `messages_write_enabled`, `message_send_endpoint`, `two_way_chat_enabled` and their endpoint aliases.
- Sends replies as `POST resource=message-send` with `{ thread_id, message }` and both authentication headers.
- Clears the old cached discovery contract whenever a new URL or API key is saved.

## Existing 1.6.3 improvements

- Conversation synchronization no longer marks customer messages read; only the explicit **Mark read** action or a completed automatic reply changes read state.
- A failed, delayed or low-confidence first pass no longer makes the unread message disappear from later automatic cycles.
- AI Control now explains when **Require unread message** is filtering an already-read thread.

## Existing 1.6.2 improvements

- Fixed false `Message send endpoint` and `messages:write scope` blocks caused by the connection-map safety filter removing valid capability fields.
- Preserved and normalized `scopes`, `allowed_scopes`, `permissions`, `endpoints` and `allowed_endpoints` from the safe connection contract.
- Added compatibility for singular/plural message endpoint names and case-insensitive scopes.
- Kept explicit server denials authoritative: a genuinely absent or disabled write capability still remains blocked.

## Existing 1.6.1 improvements

- Added a visible **AI Messages ON/OFF** switch inside Messages.
- Fixed the false **Automatic cycle skipped: not ready** result. A completed cycle with messages skipped for individual reasons is no longer misclassified as an unready cycle.
- Added exact automatic-cycle diagnostics for authorization, message endpoints, scopes, quiet hours, limits, confidence, missing verified context, AI fallback and per-thread blocks.
- Added a per-conversation option to block automatic replies while Nexa continues to synchronize, read, analyze and notify.
- Removed automatic Knowledge Engine learning from the send path. Knowledge is added only through deliberate user actions.
- Added notification deep links so in-app and Windows notifications open the related conversation, appointment, task, lead, contact or connected area.
- Prevented automatic processing of stale message threads that are no longer returned by the website API.

## Existing capabilities preserved

- Guarded AI Control and Emergency pause.
- Optional automatic messages and verified-slot appointments.
- 2,880 bilingual automotive dealer knowledge records and 8,640 approved response variations.
- Complete website conversation module, drafts, outbox and local audit history.
- Contacts, leads, orders, agenda, tasks, notifications and API Sync Inspector.

## Safety model

AI Messages can run only when both AI Control and the Messages switch authorize it. Blocking one conversation stops automatic sending for that thread but does not stop reading or manual AI review. Existing customer records stay read-only; when website appointment creation is explicitly authorized, Nexa may create one new Lead for the confirmed appointment. It has no automatic delete operation.

Existing SQLite data, encrypted API keys, provider keys, conversations, appointments, custom knowledge and settings are preserved during this update.
