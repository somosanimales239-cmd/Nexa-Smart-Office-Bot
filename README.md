# Nexa Smart Office Bot 1.5.0

Nexa Smart Office Bot is a local-first Windows business assistant with AutoMarket Pro synchronization, complete message conversations, user-approved replies, contacts, leads, agenda, tasks, notifications and AI provider fallback.

## New in 1.5.0

The program now includes the Nexa Automotive Dealer Knowledge Library:

- 2,880 built-in dealership knowledge records.
- 120 core customer intentions.
- 12 automotive dealer segments.
- English and Spanish support.
- 8,640 natural response variations.
- Custom approved knowledge takes priority over the built-in library.
- Built-in knowledge can be disabled without being deleted.
- OpenAI or DeepSeek is used only when local knowledge does not match strongly enough.

The library covers inventory, prices, appointments, financing, credit, trade-ins, vehicle details, delivery, documents, service, warranties, safety, privacy, fraud and human escalation.

See `AUTOMOTIVE_KNOWLEDGE_LIBRARY.md` for the complete design.

## Safety

Nexa never automatically sends a customer message. The user reviews and confirms every outgoing response. Built-in answers are designed not to invent prices, availability, approvals, appointments, warranties, legal outcomes or sensitive information.

## Windows delivery

The project remains configured for:

- NSIS Installer.
- Portable EXE.
- Windows ZIP.
