---
id: specs/2026-11-27-book-014-booking-deposits
type: spec
author: claude (main thread)
created: 2026-11-27
status: draft
supersedes: null
superseded_by: null
related: [kanban:BOOK-014, specs/2026-11-20-book-009-booking-hours-and-form, specs/2026-11-26-book-013-staff-booking-crud, docs/architecture/2026-04-20-whatsapp-commerce-mvp]
---

# PRD: Booking deposits, Stripe first, provider-agnostic (BOOK-014)

## Problem Statement

The ask (owner, 2026-11-27): "create a feature that allow restaurant to collect deposit for the
booking. we use stripe for now. make it abstract, so that we can change provider in different region."

BOOK-009 deferred deposits ("deposits / payment later"). Nothing payment-related exists in the code
today. The unbuilt commerce ADR (`docs/architecture/2026-04-20-whatsapp-commerce-mvp.md`) already
designs a provider-agnostic `PaymentGatewayPort`, a registry keyed by provider code and a
per-restaurant `merchant_payment_accounts` row on Stripe Connect Standard; this feature builds the
deposit slice of that design, not the voucher marketplace.

Owner decisions (2026-11-27, interactive):
1. **Money flow:** Stripe Connect Standard. Deposits settle in the restaurant's own Stripe account;
   OhMyClient never holds diner money.
2. **Timing:** the diner pays to submit. The booking waits as *awaiting deposit* (seats held) until
   paid, lapses if unpaid, and a declined booking is refunded in full automatically. Charge, not a
   card hold (Stripe holds expire in about 7 days; bookings run up to 90 days ahead).
3. **Channels:** all four: booking page `/b`, WhatsApp AI agent, personal agents (PAP / poppy.json),
   staff-created.
4. **Refunds:** decline refunds automatically; on cancel and no-show, staff decide (Refund / Keep).

## User Stories

### S1. Admin connects the restaurant's Stripe account
> "we use stripe for now"

- **AC-1** Given an admin on Settings → Booking with no payment account, when they press
  "Connect Stripe", then they are sent to Stripe's hosted onboarding for a Standard account and,
  on return, the section shows the account as *Connecting*, *Active* (charges enabled) or
  *Action needed* (Stripe restricted it), driven by the provider's account status, not the return URL.
- **AC-2** Given a non-admin staff user, when they open the section, then they see the status but
  cannot connect, disconnect or change deposit settings (403 on the API).

### S2. Admin sets the deposit rule
> "allow restaurant to collect deposit for the booking"

- **AC-3** Given an Active account, when the admin turns on 訂金 Deposit, picks the amount mode
  (**per guest**: amount × party size, or **per booking**: one flat amount), sets the amount (whole
  currency units, the account's currency) and "applies from party size N" (default 1), then every
  channel requires that deposit for bookings at or above N, and the
  booking terms shown to diners and agents state the amount and the refund rule text the admin wrote.
- **AC-4** Given the account is not Active (never connected, restricted or disconnected), then the
  deposit toggle cannot be turned on, and if it was on, new bookings are taken **without** a deposit
  and the section shows a warning; no channel ever sends a diner to a payment that cannot succeed.

### S3. Diner pays on the booking page `/b`
> "collect deposit for the booking" (channel: booking page)

- **AC-5** Given a deposit applies, when the diner submits the form, then the booking is saved as
  *awaiting deposit* holding its seats, the diner is redirected to the provider's hosted payment
  page showing the restaurant, date, party and amount, and staff do not see the booking yet.
- **AC-6** Given the provider confirms payment (signed webhook, never the browser redirect), then the
  booking becomes *pending* exactly once (replays change nothing), the deposit is recorded as *paid*
  with its provider reference, the diner gets the existing "received" message, and staff see it
  with a "Deposit paid HK$X" badge. The return page shows "Deposit paid, request sent".
- **AC-7** Given no payment within the hold window (30 minutes), then the booking lapses: seats are
  released, the provider session is closed so it can no longer be paid, staff never see it, and the
  return/cancel page offers no retry beyond "message us on WhatsApp for a new link".
- **AC-8** Given a payment that the provider confirms **after** the booking lapsed (race), then the
  deposit is refunded in full automatically and the booking stays lapsed. Money is never kept for a
  booking that does not exist.

### S4. Diner books through the WhatsApp AI agent
> channel: WhatsApp AI agent

- **AC-9** Given a deposit applies, when the agent creates the booking, then it is saved *awaiting
  deposit* and the agent replies in the chat with the amount, the hold window and a payment link;
  AC-6 to AC-8 then apply unchanged (paid → pending + "received" message).

### S5. Diner books through a personal agent (PAP)
> channel: personal agents

- **AC-10** Given a deposit applies, then poppy.json and the OpenAPI document state that a deposit is
  required and its amount rule; after the diner verifies the confirm code on WhatsApp, the booking
  becomes *awaiting deposit* (not *pending*), the diner gets the payment link in that WhatsApp chat,
  and `GET …/bookings/{id}` returns status `awaiting_deposit` with the `payment_url` and
  `deposit {amount, currency, expires_at}`; after payment it returns `pending` as today.

### S6. Staff create a booking that needs a deposit
> channel: staff-created

- **AC-11** Given a deposit applies to the party, when staff create a booking, then the dialog shows
  "Require deposit HK$X" (on by default, can be turned off per booking); with it on, the booking is
  saved *awaiting deposit*, the diner is sent the payment link on WhatsApp (template with a link
  button, see Open Questions Q1), and paying confirms the booking directly (staff already accepted).
  The staff hold window is 24 hours, not 30 minutes.

### S7. Staff see, refund or keep the deposit
> "staff decide" (owner decision 4)

- **AC-12** Given a pending booking with a paid deposit, when staff decline it, then the deposit is
  refunded in full automatically and the decline message says so ("Your deposit HK$X will be
  refunded"); a refund the provider refuses shows *Refund failed* on the row with a Retry action.
- **AC-13** Given a booking with a paid deposit that is cancelled (staff cancel, diner cancel through
  the AI agent) or marked no-show, then the row shows "Deposit held HK$X" with **Refund** and
  **Keep** actions; Refund issues a full refund through the provider, Keep records the decision;
  both are recorded with who and when, and either ends the choice (no second refund).
- **AC-14** Every booking row with a deposit shows one deposit state: *awaiting*, *paid*,
  *refund pending*, *refunded*, *kept*, *refund failed*.

### S8. The provider is swappable per region
> "make it abstract, so that we can change provider in different region"

- **AC-15** Booking code talks only to a provider-agnostic payment port (create hosted payment,
  expire it, refund, onboard, read account status, verify + normalize webhooks); no Stripe type,
  id format or API call appears outside the Stripe adapter. The provider is chosen per restaurant
  by its payment account's provider code, so two restaurants can use two providers.
- **AC-16** A second, in-repo test provider adapter runs the full flow (AC-5 to AC-8, AC-12, AC-13)
  in the test suite without Stripe, proving a new region needs only a new adapter plus its webhook
  route and onboarding screen.

## UI Feedback States

| Action | Success | Warning | Rejected |
|---|---|---|---|
| Admin: Connect Stripe | Status chip *Active*, deposit toggle enabled | *Connecting* (onboarding unfinished) with "Continue setup"; *Action needed* with Stripe's reason | Onboarding link failed: inline error "Couldn't reach Stripe, try again" |
| Admin: save deposit rule | Saved; summary line "Deposit HK$X per guest from N guests" | Account not Active: toggle disabled with "Connect Stripe first" | Invalid amount (≤0, not whole, over cap): field error |
| Diner `/b`: submit with deposit | Redirect to hosted payment; return page "Deposit paid, request sent" | Returned without paying, hold open: "Payment not finished, you have until HH:MM" + "Pay now" | Hold lapsed: "This hold has lapsed, message us on WhatsApp"; provider down at submit: "Payment is unavailable right now, please message us" (no booking saved) |
| Diner WhatsApp AI agent | Link message; then "received" message after payment | — | Lapsed: agent says the hold lapsed and offers to start again |
| PAP agent | `awaiting_deposit` + `payment_url`, then `pending` | — | `expired` after the hold |
| Staff: create with deposit | Row *Awaiting deposit*, toast "Payment link sent" | Link not delivered (template missing / not approved): toast "Link not sent, share it yourself" + Copy link | Account not Active: deposit option hidden, booking created without |
| Staff: decline paid booking | Row *Declined · Refunded* (or *Refund pending*) | — | *Refund failed* + Retry |
| Staff: Refund / Keep | *Refunded* / *Kept* with who and when | — | *Refund failed* + Retry |

Test ids follow `rules/frontend-testing.md`: `booking-deposit-badge-<id>`, `booking-row-<id>-refund`,
`booking-row-<id>-keep`, `booking-deposit-error`, `booking-settings-deposit-toggle`,
`booking-settings-payment-status`, `booking-pay-pending`, `booking-pay-lapsed`.

## Scope

**In:**
- Stripe Connect Standard onboarding and account status per restaurant (S1).
- Deposit rule: on/off, amount per guest, minimum party size, refund-rule text in the terms (S2).
- Pay-to-submit with a seat hold, lapse, late-payment refund on the booking page, WhatsApp AI agent,
  PAP and staff-created channels (S3–S6).
- Auto-refund on decline; staff Refund / Keep on cancel and no-show; deposit state on rows (S7).
- Provider-agnostic port, per-restaurant provider registry, Stripe adapter, test adapter (S8).

**Out:**
- The voucher marketplace in the commerce ADR (deals, inventory, application fees).
- Platform fees on deposits (no `application_fee_amount`; deposits pass through 100%).
- Partial refunds; deposits applied to the final bill (that happens at the restaurant's POS).

**Future:**
- Regional adapters (PayMe, FPS, Airwallex…): only the adapter, its webhook route and onboarding.
- Automatic refund rules (refund if cancelled ≥ X hours before).
- A deposit report / payout reconciliation screen.

## Explicitly Not Handled

- Changing a deposit-paid booking through the AI agent: the change tool refuses and hands the diner
  to staff, so a deposit is never orphaned on a cancelled original (moving deposits between rows is
  future work).
- Staff editing party size on a paid booking: no top-up or partial refund; the deposit stays as paid.
- Disputes / chargebacks: visible in the restaurant's own Stripe dashboard only.
- Disconnecting a Stripe account with deposits still held: refunds for those go through the
  restaurant's Stripe dashboard; our Refund action shows *Refund failed*.
- Multi-currency per restaurant: one currency, the connected account's default.
- Retrying payment after a lapse from the same `/b` link (the token is spent at submit).

## Owner rulings at the scope check (2026-11-27)

- Scope approved as written.
- **R21 exception (AC-11):** allowed for ONE utility template, "deposit request", with a URL button
  to our own domain (a `/p/<token>`-style address that redirects to the hosted payment). The other
  three channels send the link in-session or by redirect and need no template.
- **Amount:** configurable per restaurant, per guest × party or flat per booking (AC-3).
- **Stripe platform account:** exists (HK entity, Connect). The owner puts test-mode keys in
  `.env.local` and Forge env; dev builds against Stripe test mode plus the test adapter.

## Open Questions

- **Q3. Hold windows.** 30 minutes for diner channels (the shortest a Stripe Checkout session can
  last), 24 hours for staff-created. Default unless the owner says otherwise.
- **Q5. Diner cancel through the AI agent.** Default: the agent says "the restaurant will decide on
  your deposit" and quotes the admin's refund-rule text; staff see Refund / Keep.

## Product Context

No `PRODUCT.md` exists. Primary users: HK restaurant owners/managers (admin) and floor staff, on the
dashboard on desktop and phone; diners on mobile web (`/b`) and WhatsApp. Job: cut no-shows on busy
slots by asking for money up front, without the restaurant handing diners' cards to us. Durable
constraints: zh-HK first with English; OhMyClient never holds diner funds (Connect Standard);
diners pay on a provider-hosted page (no card data touches our servers, PCI SAQ-A). Platform:
adaptive web.
