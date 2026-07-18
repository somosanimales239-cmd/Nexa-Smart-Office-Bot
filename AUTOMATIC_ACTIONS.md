# Guarded automatic actions in Nexa 1.6.1

Nexa provides limited autonomy only inside permissions explicitly granted by the user. It cannot automatically change customer records or delete data.

## Two independent message gates

Automatic message interaction now requires both controls:

- **AI Control authorization**: defines allowed actions, confidence, limits, schedules, languages, provider fallback and appointment rules.
- **AI Messages ON/OFF**: a fast operational switch inside Messages.

Turning **AI Messages OFF** immediately prevents background interaction with message threads. Synchronization, reading, analysis and notifications continue.

## Per-conversation block

Every replyable conversation includes:

`Block automatic AI replies for this conversation`

When checked:

- The thread continues to synchronize.
- Nexa can display and analyze the messages.
- Notifications still appear.
- Manual reply preparation and manual sending remain available.
- Background automatic replies are blocked.
- Message-driven automatic confirmations are blocked.

The block is stored locally for that thread and remains active after restart.

## Why a message may not receive an automatic answer

Action History records the exact reason, including:

- AI Messages switch is off.
- AI Control is not authorized.
- Automatic messages are disabled.
- Conversation is blocked.
- Thread is read-only or `can_reply` is false.
- Website send capability is unavailable.
- Required scope is missing.
- Message requires human review.
- Confidence is below the configured threshold.
- Quiet hours, language or rate limits block the action.
- The message was already processed.

## Knowledge and AI

Nexa searches custom approved knowledge first, then the built-in automotive library. OpenAI or DeepSeek is used only when fallback is authorized and the local result is insufficient. External AI never receives API keys or unnecessary sensitive data.

## Appointments

Appointment automation remains governed by AI Control and verified dealer availability. When AI Messages is off, message-driven appointment interaction is paused. Existing appointments are not changed or deleted.

## Actionable notifications

Notification metadata now carries a safe destination. Selecting a notification can open:

- The exact message conversation.
- Agenda for an appointment or reminder.
- Leads for an order or lead.
- Tasks.
- Alerts or Nexa Pulse.
- API Sync Inspector for connection failures.

A destination failure never deletes or marks the underlying record complete.

## Emergency pause

**Emergency pause** disables the master authorization, automatic messages and automatic appointments without deleting any existing information.
