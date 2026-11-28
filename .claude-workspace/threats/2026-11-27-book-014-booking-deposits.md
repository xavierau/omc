---
id: threats/2026-11-27-book-014-booking-deposits
type: threat
author: claude (main thread)
created: 2026-11-27
status: final
supersedes: null
superseded_by: null
related: [kanban:BOOK-014, specs/2026-11-27-book-014-booking-deposits, threats/2026-11-19-agent-booking-poppy, docs/architecture/2026-04-20-whatsapp-commerce-mvp]
---

# Threat Model: Booking deposits via Stripe Connect behind a provider port (BOOK-014)

R-ids continue the repo's numbering (BOOK-003 ended at R46). Design under review: spec
`specs/2026-11-27-book-014-booking-deposits` + Stripe Connect **Standard**, **direct charges** on
the connected account (`Stripe-Account` header with the platform key), **hosted Checkout**
(no card data on our servers), one payment webhook per provider.

## Assets

- **A1 Diner money:** deposits on each restaurant's connected account; refunds out of it.
- **A2 Platform Stripe secret key:** with Connect it can create charges and refunds on EVERY
  connected restaurant. Highest-value secret in the system.
- **A3 Webhook signing secrets:** the platform endpoint and the Connect ("connected accounts")
  endpoint have separate secrets.
- **A4 Account linkage:** `restaurant → provider_account_id`. A wrong link sends a restaurant's
  deposits to another account or lets another account confirm its bookings.
- **A5 Booking integrity:** seat holds and the status machine (awaiting_deposit → pending/lapsed).
- **A6 Diner PII:** name, phone, party, date, already in `booking_requests`; card data stays with Stripe.
- **A7 Payment-link tokens** (`/p/<token>`, the template URL button and the PAP `payment_url`).

## Trust Boundaries

1. Diner browser → `/b/<token>` submit and `/p/<token>` redirect (public, unauthenticated).
2. Stripe → our payment webhook (public endpoint, authenticated only by signature).
3. Our server → Stripe API (platform key; `Stripe-Account` scopes the call to a restaurant).
4. Personal agent → PAP API (public, existing BOOK-003 controls, phone-verified by WhatsApp code).
5. LLM (WhatsApp AI agent) → booking tools (model output is untrusted input).
6. Staff / admin dashboard → deposit, refund, onboarding routes (tenant session, role).
7. Forge cron → expiry step (CRON_SECRET bearer).
8. Connected-account owner (a restaurant) → their own Stripe account: they can create arbitrary
   Checkout Sessions with arbitrary metadata, and Stripe will deliver those events to our Connect
   webhook **correctly signed**. A signature proves Stripe sent it, not that WE created it.

## STRIDE

**Spoofing**
- S1 Forged "payment succeeded" webhook confirms a booking with no money. → R47, R48.
- S2 A restaurant (or anyone controlling a connected account) creates its own Checkout Session with
  `metadata.booking_id` of another tenant's booking; the signed Connect event marks that booking
  paid. → R49 (resolve by OUR stored session id + `event.account` match; metadata is never a key).
- S3 Onboarding return URL carries an attacker's `acct_…` id and links it to a restaurant. → R52.
- S4 Test-mode event accepted by a live deployment (or the reverse). → R50.

**Tampering**
- T1 Diner or agent alters the deposit amount. → R53 (server computes; no amount input anywhere).
- T2 Paid amount/currency differs from what the booking needed (session edited, wrong price). → R49.
- T3 Double refund (double click, retry, two staff, webhook + staff race). → R56.
- T4 Late payment after lapse leaves money with no booking; or lapse and payment both "win". → R57.
- T5 Cross-tenant refund / keep / onboarding by id. → R58.

**Repudiation**
- RP1 "Who refunded / kept this deposit?" disputes between staff and owner. → R60.
- RP2 No trace linking a provider charge to a booking for reconciliation. → R60.

**Information disclosure**
- I1 Diner PII sent to Stripe in metadata / descriptions. → R61.
- I2 `/p/<token>` guessable or long-lived, revealing booking details or allowing pay-for-other. → R62.
- I3 Platform key or webhook secret in logs, errors, workspace artifacts, client bundle. → R63.
- I4 Provider error text (account ids, internal codes) shown to diners or agents. → R64.
- I5 Open redirect via `/p/<token>` or the success/cancel URLs. → R62.

**Denial of service**
- D1 Seat-hold squatting: unpaid awaiting-deposit bookings fill a busy night for 30 minutes at a
  time, repeatedly. → R55.
- D2 Webhook flood / large bodies before the signature check. → R48.
- D3 Provider outage at submit leaves orphan holds. → R54.

**Elevation of privilege**
- E1 Prompt injection makes the AI agent waive the deposit, set the amount, refund, or mark paid. → R59.
- E2 A non-admin staff user connects or changes the payment account or deposit rule. → R58.
- E3 Platform key over-privileged: a leak drains or refunds every restaurant. → R63, Open Risk OR1.

## OWASP Top 10 Coverage (applicable categories only)

- **A01 Broken access control:** R58 (tenant-scoped queries, admin-only settings), R49 (cross-account events).
- **A02 Cryptographic failures:** R48 signature with constant-time compare by the SDK; R62 token entropy.
- **A04 Insecure design:** R49, R56, R57 (state machine with CAS, money-first invariants).
- **A05 Security misconfiguration:** R47 fail closed on a missing secret; R50 mode mismatch.
- **A06 Vulnerable components:** R65 (`stripe` exact pin), R66 (`next` RCE advisories).
- **A07 Identification and authentication failures:** R52 (account linking), existing PAP phone verification.
- **A08 Software and data integrity:** R48 webhook integrity, R65.
- **A09 Logging and monitoring:** R60, R64.
- **A10 SSRF:** N/A. We call only the Stripe SDK's fixed hosts, and no URL is taken from input.
- A03 Injection: covered by existing parameterised Supabase calls and RPCs; no new raw SQL from input.

## Secrets & PII

- **Secrets, by name only:** `STRIPE_SECRET_KEY` (platform, restricted `rk_` key, see R63),
  `STRIPE_WEBHOOK_SECRET` (the Connect endpoint), `STRIPE_PLATFORM_WEBHOOK_SECRET` (only if a
  platform-account event is needed), `STRIPE_MODE` (`test|live`). They live in `.env.local` and Forge
  site env. No per-restaurant secret is stored (Standard + direct charges use the platform key with
  `Stripe-Account`), so `secret-box` is not needed.
- **PCI DSS:** hosted Checkout only → SAQ-A. No Stripe Elements, no card fields, no card data in logs.
- **PDPO (Cap. 486):**
  - DPP1 Collection purpose: **gap**. The collection statement (`collection-statement.tsx`, PAP
    `collection_statement`) must say the deposit is processed by Stripe for the restaurant, and that
    Stripe may process data outside Hong Kong. → R61.
  - DPP2 Accuracy and retention: deposit rows keep amount, currency, status, provider refs and
    timestamps, and **no PII**. The existing booking PII purge still clears name and phone; deposit
    rows outlive it for reconciliation. Met by R61.
  - DPP3 Use: payment data is used only for the deposit. Met; no new use.
  - DPP4 Security: R47–R64.
  - DPP5 Openness: the refund rule text is in the booking terms (AC-3). Met.
  - DPP6 Access and correction: unchanged; card data access goes through Stripe/the restaurant. N/A for us.
  - Part 6A direct marketing: N/A. Payment links are transactional, and the new template is UTILITY.
  - Cross-border: Stripe (US/IE processing). Disclosed via R61.

## Auth & Authz

| Surface | Who | Rule |
|---|---|---|
| Connect / continue onboarding, deposit rule PUT | tenant **admin** | `requireTenantAdmin`; 403 for staff (AC-2) |
| Payment account status GET | any tenant member | read only |
| Refund / Keep / Retry refund | admin or staff of the booking's tenant | `staffContext` + `findByIdForRestaurant` scoped query; 404 on a foreign id |
| Staff create with deposit waived | admin or staff | the waiver is recorded on the booking (R60) |
| `/p/<token>` | anyone holding the token | token resolves one deposit; shows restaurant, date, party, amount only |
| Payment webhook | Stripe | signature + mode + account match (R47–R50) |
| Expiry cron step | Forge | existing CRON_SECRET bearer, fail closed |
| AI agent tools | LLM | no deposit parameters (R59) |

## Supply Chain (new deps + scanner / native-audit result)

- **New dependency:** `stripe` (official Node SDK, maintainer `stripe-bindings`, 0 runtime
  dependencies). Pin **exactly `23.1.0`** (published 2026-10-29, 29 days old). Do not take 23.2.0
  (2026-11-19, 8 days old, under the 14-day bar) or any pre-release. → R65.
- **Scanner** (`scan_advisories.py`, OSV/GHSA data updated 2026-11-27T04:14Z, 1 h old), run on the
  current checkout:
  - 3 "confirmed compromised" hits are **false positives**. They are npm alias keys inside
    published manifests (`scheduler-0-13: npm:scheduler@0.13.0` in next's compiled react-refresh;
    `eslint-v7` / `eslint-v9: npm:eslint@…` in eslint-plugin-react-hooks' devDependencies), not
    installed packages with those names.
  - The "at risk" hits are transitive declared ranges inside `node_modules` manifests (e.g.
    `debug ^4.3.1`, `error-ex ^1.3.1`); the lockfile pins resolved versions. Pre-existing, not
    introduced here; dev re-runs the scanner after adding `stripe` (R65).
- **npm audit --omit=dev:** 25 pre-existing (2 critical, 14 high). **`next` 16.3.4 (direct) is
  affected by three unauthenticated RCE advisories** (GHSA-vcvr-r3jv-pc5j, GHSA-2464-fhr4-w9xw,
  GHSA-673q-mjm6-r5xr; fixed after 16.4.4). An RCE on the box exposes `STRIPE_SECRET_KEY` and so
  every connected restaurant. → R66, a release precondition. Others (undici, zod, ws, hono…) are
  pre-existing; tracked outside this feature.

## Required Mitigations

| ID | Mitigation | Test that proves it | Phase |
|---|---|---|---|
| R47 | Payment webhook **fails closed**: secret unset → 500 and no processing, in every environment (unlike the Kapso route). Missing or invalid signature → 400, nothing written. | Route tests: unset secret → 500 and the deposit store is never called; no header → 400; bad signature → 400; valid signature (SDK `generateTestHeaderString`) → 200. | build |
| R48 | Signature verified by the adapter on the **raw body** (`stripe.webhooks.constructEvent`, default 300 s tolerance) BEFORE JSON parse or any DB call; body capped at 256 KB (413). Idempotency through `processed_webhooks` keyed by `stripe:<event.id>`, claimed after verification; a processing failure releases the claim and returns 5xx so Stripe retries. | Replay of the same signed event twice → one state change, second 200 'duplicate'. Handler throws → claim released, 500, and the next delivery succeeds. Oversize body → 413 with no verify call. | build |
| R49 | A payment event is matched ONLY by the provider session id we stored on the deposit row, and accepted only when `event.account == deposit.provider_account_id`, `amount_total == deposit.amount_minor`, `currency == deposit.currency` and `payment_status == 'paid'`. `metadata` is never used to find a row. A mismatch → logged security event, no state change, 200. | Tests: session id unknown → no change; same session id but a different `account` → no change; amount −1 → no change; currency differs → no change; metadata booking id of another tenant with an unknown session → no change; all match → paid. | build |
| R50 | `event.livemode` must equal the configured `STRIPE_MODE`; a mismatch → ignored + logged. The adapter refuses to start with an `sk_test_`/`rk_test_` key in live mode or the reverse. | Test: livemode true with mode test → no change; key-prefix/mode mismatch → adapter construction throws. | build |
| R51 | Normalised port: the adapter maps provider events to `{type: payment_succeeded|payment_expired|refund_succeeded|refund_failed|account_updated|account_deauthorized, providerRef, accountRef, amount, currency}`; unknown types → ignored 200. No Stripe type crosses the port (AC-15). | Lint/grep test: `src/domain` and `src/application` import nothing from `stripe` or `infrastructure/payments/stripe`. The test-adapter suite runs AC-5..AC-8, AC-12, AC-13. | build |
| R52 | The connected account is created server-side (`accounts.create`, Standard) and its id stored BEFORE the onboarding link is issued; the return/refresh URLs carry no account id, and the return handler only re-reads the account status from the provider. Deposits can be turned on only while the stored account is `charges_enabled`. `account.application.deauthorized` / restriction → account `disabled`/`restricted`, and new bookings take no deposit (AC-4). | Tests: a return URL with `?account=acct_x` changes nothing; deauthorized event → status disabled and the next submit has no deposit; settings PUT with deposit on and the account not active → 409. | build |
| R53 | The deposit amount is computed server-side at creation from the stored rule (mode, amount, from N) × party size, in integer minor units, and written on the deposit row; no route, tool or form accepts an amount. Rule validation: whole units, ≥ the provider's minimum (HK$4), ≤ HK$10,000 per booking cap, N 1..1000. | Tests: a submit body with `amount`/`deposit` fields is rejected by the strict parser; per-guest 100 × 8 → 80000 minor; flat 300 → 30000; cap exceeded → settings 400. | build |
| R54 | Order at submit: compute the rule → insert the booking + deposit `awaiting` atomically with the seat check → create the hosted session (idempotency key = deposit id) → store the session id/url. Provider failure → the booking and its hold are rolled back (deleted or lapsed in the same request) and the diner sees "payment unavailable" (spec). | Test with a failing fake provider: no booking remains in seat counts, response 503 `payment_unavailable`. | build |
| R55 | `awaiting_deposit` counts toward seats (`booking_room_refusal`, `booking_guest_counts`) AND toward the per-phone pending cap (`MAX_PENDING_PER_PHONE`); holds lapse at 30 min (diner) / 24 h (staff); the cron expiry step runs every 5 min and lapses only `WHERE status='awaiting_deposit' AND hold_expires_at < now()`. | DB test: an awaiting booking blocks the last seats; a 4th awaiting/pending for one phone → 409; expiry RPC lapses only expired awaiting rows and releases their seats. | build |
| R56 | Refund state machine with CAS: `paid → refund_pending → refunded | refund_failed`, `refund_failed → refund_pending` (Retry), `paid → kept` (terminal). The provider refund is called only by the request that won the `paid→refund_pending` transition, with idempotency key `refund:<deposit id>:<attempt>`; amount = the full paid amount. | Tests: two concurrent Refund calls → one provider call; Refund after Keep → 409; Keep after Refund → 409; refund webhook succeeded → refunded; failed → refund_failed with Retry. | build |
| R57 | Lapse and payment race resolved in the DB: the expiry RPC (`awaiting→lapsed`) and the paid transition (`awaiting→pending/confirmed`) are both conditional on `status='awaiting_deposit'`; the loser does nothing to the booking. A payment event for a lapsed booking → automatic full refund (AC-8). The expiry step also expires the provider session (best effort; "already completed" → leave it to the webhook). | Tests: paid event after lapse → booking lapsed, refund issued once; lapse after paid → no change; expire call failing with "already complete" → no lapse error. | build |
| R58 | Every deposit, refund, keep and onboarding route finds rows with a tenant-scoped query (`…ForRestaurant(restaurantId, id)`), 404 on a foreign id; onboarding and the deposit rule are admin-only. | Tests: staff of restaurant A refunding B's booking id → 404 with no provider call; staff PUT deposit rule → 403. | build |
| R59 | AI agent and PAP: no tool or API parameter for amount, waiver, refund or payment status; the deposit is applied by the server rule inside `create_booking_request` / `createAgentBooking`. The agent gets only the payment URL to relay. The AI change tool refuses deposit-held bookings (spec Not Handled). | Tool-schema snapshot test: no deposit fields; a tool call with injected `deposit:false` → parser rejects; change tool on a paid booking → refusal result. | build |
| R60 | Append-only `deposit_events` (deposit id, event type, actor user id or `provider`/`cron`/`system`, provider ref, amount, created_at) for: created, session created, paid, lapsed, refund requested/succeeded/failed, kept, waived (staff create). No PII. | Tests: each transition writes exactly one event with the right actor; staff refund records the user id. | build |
| R61 | Provider metadata contains only `deposit_id` and `booking_id` (UUIDs); no name, phone or notes in metadata, description or line items (line item = "Deposit · <restaurant> · <date> <time> · <party> guests"); no `customer_email`/phone prefill. Collection statements (page + PAP) add the Stripe processing and cross-border sentence, zh-HK and en. | Adapter test asserts the exact `checkout.sessions.create` params contain no phone/name; snapshot of the collection statement in both languages. | build |
| R62 | `/p/<token>`: ≥32 random bytes (base64url, ≥43 chars, like `booking_tokens`), stored hashed, bound to one deposit, valid until the hold expires; it redirects (303) only to the stored session URL, and only if that URL's host is in the adapter's allow-list (`checkout.stripe.com`); otherwise it shows a neutral page. Success/cancel URLs are built server-side from `appBaseUrl()`. Page headers reuse `booking-security-headers` (no-store, no-referrer, noindex). | Tests: short/unknown/expired token → neutral 404/410 page with no booking details; stored URL on another host → no redirect; token row holds only the hash. | build |
| R63 | `STRIPE_SECRET_KEY` is a **restricted key** limited to Connect accounts + account links (write), Checkout Sessions (write), Refunds (write), Events (read); never logged (redact `sk_`/`rk_`/`whsec_` patterns in the payment logger), never `NEXT_PUBLIC_`, never in workspace artifacts. | Test: the logger redacts a key-shaped string; build check that no `STRIPE_` variable is `NEXT_PUBLIC_`. Restricted-key scope: owner action, checked in the deploy runbook. | build + deploy |
| R64 | Diners and agents get fixed codes/messages (`payment_unavailable`, `hold_lapsed`); provider error details go only to the server log with the deposit id. | Test: provider throws with an account id in its message → response body contains neither the id nor the message. | build |
| R65 | `stripe` pinned exactly `23.1.0` in package.json and the lockfile; scanner + `npm audit` re-run after install, results in the dev handoff. | `package.json` has `"stripe": "23.1.0"` with no caret; handoff carries the scan output. | build |
| R66 | **Release precondition:** `next` upgraded to a patched version (16.4.6, 18 days old) and deployed to production BEFORE any live Stripe key is put in Forge env. Separate work item. | `npm audit` on the release commit shows no `next` critical; deploy record shows the Next upgrade released first. | before live keys |

## Open Risks & Acceptance (risks not mitigated, who owns acceptance)

- **OR1 Platform key blast radius (owner: Xavier).** Even restricted, the key can refund every
  connected account. Accepted for Connect Standard by design; mitigated by R63 + R66 + Forge env
  access control. Rotation runbook in the release deploy record.
- **OR2 Seat-hold squatting by many phones (owner: Xavier).** R55 caps per phone and the /b token
  is one-time, but a determined attacker with many WhatsApp numbers can still hold a night for 30
  minutes at a time. Accepted for POC; revisit with a per-restaurant concurrent-hold cap if seen.
- **OR3 Rate limiters fail open after restart** (existing BOOK-OPS-1) also apply to deposit submits.
  Accepted; tracked as BOOK-OPS-1.
- **OR4 Disputes/chargebacks** are handled in the restaurant's Stripe dashboard; our status can say
  *paid* for a disputed charge. Accepted (spec Not Handled).
- **OR5 Pre-existing high/critical npm audit findings** other than `next` (undici, zod, ws, hono,
  sharp…). Not introduced here; owner to schedule.

## Verdict: CONDITIONAL

No CRITICAL lacks an R-id. Accepted when the plan maps every R47–R66 to a work item and the dev
acceptance suite has the test named for each; R66 must be released before live keys.

## Required Changes (if BLOCKED/CONDITIONAL)

1. The plan carries R47–R65 as acceptance items on the work items that touch them.
2. R66 (Next RCE patch) is a separate work item, released to production before `STRIPE_MODE=live`.
3. Spec amendment folded into the plan: the provider-outage path deletes or lapses the hold in the
   same request (R54), and the collection statement change (R61) is part of the /b and PAP work.
