# Nexa AI Control and Message Runtime Diagnostics

## Pre-book contact checkpoint (1.6.20)

When a customer accepts a time Nexa just offered, website appointment creation pauses for one structured contact review. The form displays known values, leaves missing values blank and says the appointment is not yet confirmed. `appointment-create` runs only after the customer returns or confirms that form. Nexa then requires the normal all-or-nothing Dealer Agenda and Dealer Leads verification before sending the final confirmation. The resulting Lead keeps `Nexa Smart Office Bot` and `Software appointment` as its source labels.

## Structured appointment contact collection (1.6.19)

When a verified appointment is ready but the website thread lacks a valid customer name or phone, Nexa sends a small bilingual fill-in form with separate `Name/Nombre`, `Phone/Teléfono`, and optional `Email` fields. Existing valid fields are reused and omitted from the request. Blank placeholders are ignored, and phrases such as “mi número” or “my phone” can never be written into Dealer Leads as a customer name.

## Live dealer address replies (1.6.18)

Address questions are resolved from the connected order/Lead, listing and dealer/store records before Knowledge or AI drafts a reply. Nexa returns the synchronized address immediately and never sends a placeholder promising to verify it later. If several reseller dealers exist, listing/store context is required before an address is selected.

## Dealer Agenda reservation commit (1.6.16)

Remote appointment creation is not complete merely because `appointment-create` returned a Lead ID. Nexa sends the complete customer, thread, date, time, optional listing/location and notes payload, then reloads `dealer-appointment-availability`, `dealer-agenda-calendar`, `orders` and `agenda`.

Nexa confirms the appointment only when the response says `reserved=true`, a remote ID exists, the completed Lead contains name/phone/date/time, Dealer Agenda contains the matching appointment, and the selected slot is no longer available. If verification fails, Nexa may repeat the read refresh once but never repeats the reservation POST.

Nexa Smart Office Bot 1.6.1 keeps the guarded autonomy introduced in 1.6.0 and adds a second explicit control inside Messages.

## Two required message controls

Automatic customer replies require both:

1. AI Control master authorization and Automatic message sending enabled.
2. **AI Messages ON** in the Messages screen.

Turning AI Messages OFF does not disconnect the inbox. Nexa continues synchronizing, reading, displaying and analyzing conversations, but it cannot send an automatic reply.

## Per-conversation block

The conversation composer includes:

`Block Nexa from replying automatically to this conversation`

When selected, Nexa continues to read the complete thread, refresh it, create notifications and allow manual AI review. Only automatic sending for that thread is blocked. Clearing it reauthorizes that thread, subject to the global controls.

## Exact Run Now results

`Run authorized actions now` no longer reports a generic `not ready` state for a completed cycle. It distinguishes:

- Whole-cycle blockers such as missing authorization or all actions disabled.
- No unanswered messages.
- Message-thread loading failures.
- Messages AI OFF.
- Per-thread automatic-reply block.
- Response delay.
- Quiet hours.
- Hourly or daily limit.
- Knowledge confidence below the configured threshold.
- Missing verified business context.
- AI fallback disabled or provider unavailable.
- Safety and human-review rules.
- Processing or website API errors.

The Live Readiness card shows connection, scopes and endpoint capabilities separately from per-message decisions.

## Knowledge behavior

Sending a reply no longer teaches Nexa automatically. The Knowledge Engine can be updated only through a deliberate user action. This prevents a customer thread or an unreviewed response from silently changing the business knowledge base.

Version 1.6.8 combines the separate English/Spanish appointment communication library with `dealer-appointment-availability` and `dealer-agenda-calendar`. It keeps the requested date, time preference and offered slots ahead of general automotive Knowledge, excludes both local and website-calendar conflicts, and requires a clear verified-slot selection before creation. Website creation additionally requires `appointment-create:write`; after success Nexa immediately reloads the dealer calendar.

Version 1.6.10 makes missing appointment identity recoverable. When the selected slot is valid but the website thread does not expose a customer name, phone or email, Nexa asks for those details in the same conversation instead of ending with an internal-only error. The exact selected date/time remains pending, is revalidated when the customer answers, and is then created and confirmed. If it changed, Nexa offers current verified alternatives. Common Spanish weekday typos and morning/tomorrow ambiguity are also resolved before slot selection.

Version 1.6.12 introduced the date-scoped appointment state machine. The newest customer correction becomes the active date, and a time mentioned on several days can be selected only inside that active date. A stale contact request is cancelled when the customer corrects the date or time. If the message thread already supplies the customer name, Nexa asks only for a phone number; the customer may also include that phone in the same message as the selected time.

Version 1.6.16 preserves the earlier roundtrip and adds strict AutoMarket Pro V8 reservation commit verification. With website appointment creation authorized, Nexa sends the complete thread and customer data, requires `reserved: true`, reloads availability, Dealer Appointment Agenda, `orders`/Dealer Leads and `agenda`, and verifies that the Lead is complete, the appointment exists and the slot is consumed before confirming the reservation. A 409 slot conflict triggers a fresh availability check and updated customer-facing alternatives.

## Notification navigation

Opening an in-app or Windows notification routes to the related conversation, appointment, task, lead, contact, listing or appropriate fallback area.

## Hard boundaries

Nexa does not automatically edit existing contacts, leads, orders, reseller records or customer profiles. An explicitly authorized confirmed appointment may create one new website Lead through `appointment-create`. Nexa does not automatically delete messages, appointments, records, files or database content. Sensitive conversations remain subject to human review.
