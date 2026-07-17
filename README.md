# Nexa Smart Office Bot 1.4.0

A local-first Windows business assistant with a complete AutoMarket Pro workspace and a human-approved real-time messaging workflow.

## Main workspaces

- Dashboard with local and connected business totals.
- Unified Contacts with local records and synchronized website agenda contacts.
- Unified Leads with local opportunities, website orders and reseller appointments.
- Visual Agenda for tasks, appointments, reminders and connected events.
- Messages with inbox synchronization, full conversation bubbles, live refresh, read state, reply drafts and user-approved sending.
- Knowledge Engine with reusable approved answers that are checked before OpenAI or DeepSeek.
- AI Suggestions with complete selected conversation context and explicit human approval.
- API Sync Inspector, Nexa Pulse, Activity, Settings and backups.

## Message response order

1. Nexa loads the authorized conversation from AutoMarket Pro.
2. The local Knowledge Engine compares the latest customer message against approved responses.
3. A strong local match creates a draft without using an external AI request.
4. When no approved answer matches, Nexa can call the selected OpenAI or DeepSeek provider.
5. The draft is shown to the user for editing and confirmation.
6. Only the user-approved reply is submitted to the website API.
7. The user may optionally teach Nexa from that approved reply.

Nexa never auto-sends a customer message. Full message bodies are cached locally only when the connected website explicitly grants the message-thread capability.
