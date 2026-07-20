# Nexa AI Control and Message Runtime Diagnostics

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

## Notification navigation

Opening an in-app or Windows notification routes to the related conversation, appointment, task, lead, contact, listing or appropriate fallback area.

## Hard boundaries

Nexa does not automatically edit contacts, leads, orders, reseller records or customer profiles. It does not automatically delete messages, appointments, records, files or database content. Sensitive conversations remain subject to human review.
