---
id: plans/2026-11-27-book-014-booking-deposits
type: plan
author: main
created: 2026-11-27
status: active
supersedes: null
superseded_by: null
related: [kanban:BOOK-014, specs/2026-11-27-book-014-booking-deposits, threats/2026-11-27-book-014-booking-deposits, docs/architecture/2026-04-20-whatsapp-commerce-mvp]
---

# Plan: Booking deposits, Stripe Connect behind a provider port (BOOK-014)

## Objective

Restaurants collect a booking deposit on all four channels, settled in their own Stripe account
(Connect Standard, direct charges, hosted Checkout), through a provider-agnostic port, so another
region can add an adapter without touching booking code. Spec AC-1..AC-16; threats R47..R66.

## Context (files, constraints, dependencies)

- Stage **POC** (repo has no mature import). Payments → threat model (done, CONDITIONAL) and
  `/code-review` on the money paths are still mandatory.
- Base: `origin/develop` 2f922d5 (BOOK-013). Next migration **096**. Local `main` is stale; never branch from it.
- Reuse the ADR design (`docs/architecture/2026-04-20-whatsapp-commerce-mvp.md` §3–4): `Money`,
  `PaymentProviderCode`, `merchant_payment_accounts`, port + registry. Deposit slice only: no deals,
  no application fee, no `payment_intents` table (deposits get their own `booking_deposits`).
- Hooks from the code map (Explore 2026-11-27):
  - Status CHECK + `booking_requests_decision_consistent` (087:24-31); `insert_booking_request_if_room` (092:139) takes no status.
  - Seat counts `booking_room_refusal` / `booking_guest_counts` (092:85,96,277) count pending + confirmed only.
  - Explicit status lists in `booking-request-repository.ts:186,284`, `staff-booking-repository.ts:136`, `booking-groups.ts:13`.
  - `/b` token spent before the insert (`submit-booking-request.ts:186-189`).
  - Booking templates are body-only by R21 (`booking-templates.ts:5,58-60`); owner allowed ONE deposit template with a URL button.
  - Expiry step goes into `/api/cron/booking-reminders` (every 5 min), so no new Forge job.
- Dependency: `stripe@23.1.0` exact (R65). Stripe CLI is on the Mac (`stripe listen --forward-connect-to`).
- Owner supplies `STRIPE_SECRET_KEY` (restricted, test mode), `STRIPE_WEBHOOK_SECRET` and `STRIPE_MODE=test` in `.env.local`. Not present yet (checked 2026-11-27); only W6 needs them.

## Domain Model (entities, VOs, aggregates)

- **VO `Money`** `{amountMinor:int, currency}`; integer math only.
- **VO `DepositRule`** in `booking_config.deposit`: `{enabled, mode: per_guest|per_booking, amount (whole units), fromPartySize (1..1000), refundNote {zh_hk,en} ≤500}`. `depositFor(rule, partySize, currency) → Money|null`. Cap HK$10,000, min HK$4 (R53). Added to `SETTINGS_FIELDS`, `parseBookingSettings` and `applyBookingSettings`.
- **Entity `MerchantPaymentAccount`** (table `merchant_payment_accounts`, ADR name): restaurant_id, provider_code, provider_account_id, status `pending|active|restricted|disabled`, charges_enabled, currency, restriction_reason; UNIQUE(restaurant_id, provider_code). One account per restaurant is used (latest active).
- **Aggregate `BookingDeposit`** (table `booking_deposits`, 1:1 with booking): provider_code, account id + provider_account_id snapshot, amount_minor, currency, status `awaiting → paid → refund_pending → refunded|refund_failed`, `paid → kept`, `awaiting → lapsed`, provider_session_id (unique), session_url, link_token_hash, hold_expires_at, provider_payment_ref, refund_ref, refund_reason `declined|late_payment|staff`, decided_by/at. Transitions are CAS (`WHERE status = from`), and the pure transition table lives in the domain.
- **`deposit_events`** append-only (R60). Booking status gains **`awaiting_deposit`** and **`lapsed`**. `awaiting_deposit` counts for seats and the per-phone cap; `lapsed` is hidden from staff like `unverified`.
- **Port `PaymentGatewayPort`** (`src/domain/ports/payment-gateway.ts`): `createAccount`, `createOnboardingLink`, `getAccountStatus`, `createHostedPayment`, `expireHostedPayment`, `refund`, `parseWebhook(rawBody, headers) → NormalizedPaymentEvent[]`, `allowedRedirectHosts`. **Registry** `get(code)`. Adapters: `infrastructure/payments/stripe/*`, `infrastructure/payments/test/*`.

## Subtasks (ordered, each assigned to an agent, each citing the spec AC ids it serves)

| WI | Agent | Depends | Serves | Content |
|---|---|---|---|---|
| **W0** SEC-NEXT | dev | — | R66 | `next` 16.3.4 → 16.4.6 (+ matching eslint-config-next), build + full suite, PR to develop. Separate kanban item; released BEFORE live keys. |
| **W1** core | dev | — | AC-6,7,8,15,16 · R47–R57, R60, R62–R65 | Migration 096 (tables, statuses, CHECKs, seat counts + per-phone cap incl. awaiting, `insert_booking_request_if_room` gains status + deposit insert in one txn, expiry RPC, REVOKE/GRANT service_role). Money, DepositRule, BookingDeposit, port, registry, test adapter, Stripe adapter (stripe 23.1.0). Use cases: `startDeposit` (shared by every channel), `handlePaymentEvents`, `expireDeposits` (cron step), `refundDeposit`, `keepDeposit`. Route `POST /api/webhooks/payments/stripe` (fail closed). `GET /p/[token]` redirect + neutral pages. Kanban BOOK-014 entry + commit of spec, threat and plan into the branch. |
| **W2** admin | dev | W1 | AC-1..4 · R52, R53, R58 | Routes: `POST /api/dashboard/settings/payments/connect`, `GET …/payments` (status), return/refresh pages; `account.updated`/deauthorized handling. Settings → Booking: Payments block (status chip, Connect / Continue setup) + Deposit block (toggle, mode, amount, from N, refund note) + summary line; deposit added to terms on page, AI agent and PAP text. |
| **W3** /b page | dev | W1 | AC-5,6,7 · R54, R61, R64 | Submit with deposit → `startDeposit` → JSON `{redirect}` → client navigates; return page `/b/[token]/paid` states (paid / not finished + Pay now / lapsed / unavailable); "received" message moves to the paid event; collection statement sentence (zh-HK/en). |
| **W4** staff | dev | W1 | AC-11..14 · R56, R58, R60 | Deposit badge + states on row, calendar and Today; decline → auto refund + decline text; cancel dialog and no-show row → Refund / Keep / Retry; staff create "Require deposit" (on by default, waivable, waiver logged) → awaiting, 24 h hold, paid → confirmed; new UTILITY template `booking_deposit_request` with a URL button `{base}/p/{{1}}` + provisioning; "Copy link" fallback. |
| **W5** agents | dev | W1 | AC-9,10 · R59, R61 | WhatsApp AI agent: `create_booking_request` runs `startDeposit` and returns the link + amount + hold to relay; prompt text; change tool refuses deposit bookings; diner cancel says the restaurant decides. PAP: after code verification → awaiting + link in chat; status endpoint `awaiting_deposit` + `payment_url` + `deposit{}`; poppy.json / OpenAPI deposit fields; collection statement. |
| **W6** I-task | dev | W1–W5 | all AC, Integration Map | Merge the stack, Stripe test mode with a real Standard test connected account, `stripe listen --forward-connect-to`, walk all four channels + decline/cancel/no-show refund + lapse + late payment; evidence log + screenshots; PR(s) green; `/code-review` on the money paths. |

Order: W0 ∥ W1 → W2 ∥ W3 ∥ W4 (≤3 dev) → W5 → W6. Branches: W1 `feature/book-014-core` from origin/develop; W2–W5 branch from the W1 head and open PRs with base `feature/book-014-core` (retarget to develop once W1 merges).
Migrations: only W1 writes one (096). A later WI that needs schema escalates instead of numbering its own.

## Integration Map

| Registration point | WI |
|---|---|
| `booking_requests` status CHECK + decision CHECK; seat RPCs; per-phone cap; staff list filters (`booking-request-repository.ts:186,284,344`, `staff-booking-repository.ts:35,136`, `booking-member-repository.ts:30,79`) | W1 |
| `BookingStatus` type + every typed status map (`booking-row.tsx:50`, `calendar-month-grid.tsx:19,28`, `bookings-today.tsx:33`, `agent-booking.ts:151`, `booking-groups.ts:13`) | W1 types, W4 UI tones |
| Registry composition root (`booking-deps.ts`, `agent-deps.ts`) | W1, W5 |
| Webhook route + Stripe dashboard Connect endpoint (events: checkout.session.completed / expired, charge.refunded, refund.updated, account.updated, account.application.deauthorized) | W1 route, W6 endpoint |
| Cron step in `/api/cron/booking-reminders` + `deploy/README.md` note | W1 |
| `/p/[token]` page + `booking-security-headers` + `next.config.ts` headers | W1 |
| `booking_config.deposit` in `SETTINGS_FIELDS` / parse / apply; settings route PUT | W2 |
| Settings UI blocks in `BookingSettingsSection` (`booking-settings/`), `use-booking-settings` | W2 |
| Payments routes + return pages | W2 |
| `/b` client response handling (`booking-form-client.ts`) + return page | W3 |
| Template list + provisioning (`booking-templates.ts`, `provision-booking-templates.ts`) | W4 |
| Agent tool, skill prompt, PAP OpenAPI/poppy.json status enum (`poppy-documents.ts:342`) | W5 |
| `.env.example` STRIPE_* block (names only), `deploy/README.md` env table | W1 |
| i18n zh-HK / en strings for every new UI and message | each WI for its own surface |
| Test ids (spec list) + `.claude-workspace/ui-map/testid-registry.md` | W2, W3, W4 |
| Kanban BOOK-014 (+ SEC-NEXT) with `workspace_artifacts` | W1 (W0 for its own) |

## Acceptance Criteria

- Spec AC-1..AC-16 and threat R47..R65 each pass in the WI that serves them; R66 is released before live keys.
- **Reachable end to end (W6):** an admin connects a Stripe test account from Settings → Booking, turns the deposit on, a diner books on `/b` from the WhatsApp BOOK link, pays on Stripe Checkout (test card), and staff see the booking *pending · Deposit paid*; declining it shows *Refunded* in Stripe test mode. Evidence: log + screenshots under `.claude-workspace/artifacts/evidence/2026-11-27-book-014/`.
- The test adapter runs the same flow in vitest (AC-16).

## Performance Budgets

- `/b` submit with deposit → redirect response p95 ≤ 1.5 s (one Stripe session create, ≈300–700 ms).
- Webhook handler ≤ 2 s per event (Stripe times out at 10 s and retries).
- `/p/[token]` redirect ≤ 300 ms (one indexed lookup).
- Expiry cron step ≤ 10 s for 200 lapses (batched RPC).

## Out of Scope

Spec Out + Explicitly Not Handled: platform fees, partial refunds, automatic refund rules, deposit
moves on change requests, top-ups on party edits, disputes, multi-currency, retry from a spent `/b` link,
regional adapters beyond the test adapter.

## Risks & Open Questions

- Meta must approve `booking_deposit_request` before staff links are delivered; until then staff use Copy link (spec UI state).
- Stripe Checkout `expires_at` minimum is 30 min, so the diner hold equals the session life; the staff hold of 24 h equals the session maximum.
- Stack merges into develop need owner OK (not low-risk): W1 first.
- Q3 hold windows and Q5 diner-cancel wording run on the spec defaults.
