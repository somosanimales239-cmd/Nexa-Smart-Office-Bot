# Nexa AI Control and Guarded Automatic Actions

Nexa Smart Office Bot 1.6.0 adds optional, user-authorized automatic actions. Every automatic feature is disabled on first installation and remains disabled until the user enables the master authorization and confirms consent inside AI Control.

## What Nexa may do when authorized

- Read new customer conversations from the connected website.
- Search the local Automotive Dealer Knowledge Library first.
- Use the selected AI provider only when the user separately enables AI fallback.
- Send a customer reply through the website API when automatic messages are enabled and every configured safety rule passes.
- Read Dealer Appointment Availability from the website.
- Offer verified open appointment slots.
- Create an appointment in Nexa's local calendar when the customer selects an exact available slot.
- Create the same appointment on the website only when the API advertises `appointment-create` and the user explicitly enables remote appointment creation.
- Send an appointment confirmation only when automatic messages are also authorized.
- Record every completed, blocked and failed automatic action in the local audit history.

## Hard boundaries

These protections are not configurable:

- Nexa does not automatically edit contacts, leads, orders, reseller records or customer profiles.
- Nexa does not automatically delete messages, appointments, records, files or database content.
- Admin announcements and read-only threads are never answered.
- Sensitive conversations involving legal issues, emergencies, complaints, refund disputes, payment disputes or financing approvals are blocked for human review.
- Automatic appointment creation uses only a verified available slot and is idempotent to prevent duplicates.
- The Emergency pause button immediately disables automatic message sending and automatic appointment creation.

## AI Control parameters

The user can authorize and configure:

- Master automatic-action switch.
- Background check interval.
- Automatic messages on or off.
- Knowledge-only mode or Knowledge plus AI fallback.
- Minimum local confidence.
- Delay before sending.
- Hourly and daily limits.
- Unread-only processing.
- Quiet hours.
- Allowed languages.
- Human-review-only intents.
- Automatic appointments on or off.
- Slot offering.
- Appointment duration.
- Minimum notice.
- Maximum booking window.
- Required customer identity.
- Local-only or website plus local appointment creation.
- Appointment confirmation messages.

## Website resources

The connected AutoMarket Pro API should advertise and support the following resources as applicable:

- `messages`
- `message-thread`
- `message-send`
- `message-read`
- `dealer-appointment-availability`
- `appointment-create` for optional remote appointment creation

The required scopes remain enforced by the website API. Nexa does not bypass API permissions.
