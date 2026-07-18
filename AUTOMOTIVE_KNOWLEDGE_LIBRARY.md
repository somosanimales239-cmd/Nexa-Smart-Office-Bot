# Nexa Automotive Dealer Knowledge Library

Version 1.0.0 is bundled with Nexa Smart Office Bot 1.6.0.

## Installed coverage

- 2,880 built-in knowledge records.
- 120 core dealership intentions.
- 12 dealer segments.
- English and Spanish.
- Three natural response variants per record.
- 8,640 total built-in response variations.
- Nine business categories.

## Dealer segments

- Used automobiles.
- New automobiles.
- Trucks and commercial vehicles.
- Motorcycles.
- Powersports.
- RVs and campers.
- Trailers.
- Marine and boats.
- Fleet sales.
- Luxury and exotic vehicles.
- Heavy equipment.
- Electric and hybrid vehicles.

## Business categories

- Inventory and availability.
- Pricing and payments.
- Appointments and follow-up.
- Financing and credit.
- Trade-in and appraisal.
- Vehicle details and condition.
- Delivery and documents.
- Service and ownership.
- Safety, privacy and escalation.

## How Nexa uses it

1. Nexa reads the selected conversation and detects English or Spanish.
2. It identifies the likely dealer segment from the listing, subject and conversation.
3. User-approved custom knowledge receives priority.
4. Nexa searches the built-in automotive library.
5. A local response is used only when confidence reaches the configured safe threshold.
6. Nexa rotates among approved natural variants so repeated replies do not always sound identical.
7. OpenAI or DeepSeek is used only when the local library does not contain a sufficiently strong answer and AI fallback is enabled.
8. Every outgoing response still requires user review and confirmation.

## Safety rules

The library does not guarantee or invent:

- Inventory availability.
- Final prices or discounts.
- Financing approval, APR, down payment or monthly payment.
- Appointment confirmation.
- Warranty coverage.
- Trade-in value.
- Delivery dates.
- Legal rights or state-specific requirements.

Those answers ask Nexa to verify connected data, use the dealer's written policy, or escalate to an authorized person. Sensitive identity and financial documents are directed to secure channels rather than ordinary chat.

## User control

Built-in records cannot be deleted accidentally. A user may disable or re-enable any built-in record. Custom dealership knowledge can be added, edited through replacement, learned from an approved reply, or deleted.
