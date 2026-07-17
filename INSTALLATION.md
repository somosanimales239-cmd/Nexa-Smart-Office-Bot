# Nexa Smart Office Bot 1.4.0 — Installation

1. Open Manual Delivery in Nexa App Builder Pro.
2. Select the existing Nexa Smart Office Bot project.
3. Create one new manual delivery.
4. Upload the single ZIP for version 1.4.0.
5. Apply staged files once.
6. Run Local build validation.
7. Push to GitHub & Build only after the local gate is green.

This is a complete source replacement that preserves the installed application data directory, local SQLite records, encrypted AutoMarket API key, AI provider keys and user preferences.

The software works immediately with the existing metadata-only `messages` resource. Full two-way conversations require the connected AutoMarket Pro website to implement the endpoints and scopes described in `MESSAGING_API_SERVER_CONTRACT.md`.
