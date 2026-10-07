---
id: specs/2026-09-10-int-001-member-creation-api
type: spec
author: product-manager
created: 2026-09-10
revised: 2026-09-10
revision: 2
status: active
supersedes: null
superseded_by: null
related: [kanban:INT-001, kanban:MBL-020, kanban:WAQ-004, kanban:WAQ-005, kanban:WONB-005, kanban:MBL-011]
---

# PRD: Bidirectional Member-Creation API (INT-001)

Inbound partner endpoint that creates (or finds) a member by phone, plus an outbound
`member.created` / `member.updated` webhook fired from the single member-creation seam.
The load-bearing product question — **whether and how an API-created member receives
the new-member welcome** — was decided by the owner on 2026-09-10; §5 states the
decided model and §11 lists what is still open.

Requirements marked **owner decision** are final. Anything marked
**default — confirm with owner** is still an orchestrator recommendation, traceable to a
cited fact in §3.

---

## 1. Problem Statement

**Who.** Restaurant owners running a POS / reservation / CRM system alongside OhMyClient,
and the vendors of those systems. Today a customer who signs up at the till (POS loyalty
prompt, tablet form, reservation booking) does not exist in OhMyClient until they
separately scan a QR or message the WhatsApp number — two sign-ups for one customer.

**Severity.** Audit 2026-09-09 (kanban INT-001): no external API exists in either
direction. The only outside-reachable member-creating route is the unauthenticated public
QR join form `/api/join/[slug]`; the HMAC-signed POS webhook only awards/deducts points
for an *existing* member and stores unmatched transactions for later claim
(`link-pos-customer.ts`). Outbound, a member record is never pushed to any partner —
the POS never learns that a customer joined via WhatsApp.

**Evidence.** Code audit only (kanban INT-001 description + notes). No partner or owner
interview has been run — see Open Question OQ-1. Demand is inferred from MBL-020
("auto-enrol on POS phone match") and WAQ-004 naming a "member creation API" as a future
import-gate boundary, i.e. two prior specs already assumed this seam would exist.

**Cost of not solving.** Members split across systems, POS transactions land as
"unmatched" and points go unclaimed, partners cannot integrate without screen-scraping
the QR form, and any future partner-driven creation (MBL-020) would have to invent its
own insert path — the thing INT-001 explicitly forbids.

---

## 2. Personas

| Persona | Goal | Pain today |
|---|---|---|
| **Partner developer** (POS vendor, booking platform, agency) | Push a customer into the restaurant's loyalty program with one call; know whether it worked; receive members created elsewhere | No API. Only points endpoints, which fail on unknown phones |
| **Restaurant owner / manager** | One customer list; welcome new members automatically without breaking WhatsApp quality or PDPO rules | Two sign-up flows; cannot connect POS sign-ups; fears of being paused by Meta |
| **Member** (diner) | Join once, get the welcome offer, not be spammed | Asked to join twice; may get marketing they never agreed to |
| **Platform operator** (OhMyClient ops) | One partner cannot flood the shared queue/VM or the shared WABA's quality | No rate limits on integrations; prod is a shared 4GB VM |

---

## 3. Verified Facts (cited, not re-derived)

| # | Fact | Source |
|---|---|---|
| F1 | WhatsApp join: `register-member.ts` → `onboard-new-member.ts`. Member messaged first, so a 24h service window is open; mints coupon, sends welcome body + QR coupon as free-form messages, emits `join` event source `whatsapp` | code |
| F2 | Web QR join: `register-member-web.ts` mints coupon via tenant `welcome_campaign_id` or the default welcome coupon, emits `join` source `web`, **returns** coupon code, **sends nothing on WhatsApp** | code |
| F3 | CSV import: `import-contacts-batch*.ts` grades consent strong/weak; no welcome, no coupon | code |
| F4 | Consent model `038_consent_records.sql`: (restaurant_id, phone_e164) identity; category marketing/utility/authentication; status opted_in/opted_out/pending; consent_grade strong/weak; source, source_reference, business_name_shown, captured_at. WONB-005 (done) added grade, proof_url, expires_at, consent_text | migration + kanban done |
| F5 | WAQ-004 (done): import gate at boundaries + pre-send marketing check requires `consent_records(category='marketing', status='opted_in')`. WAQ-005 (done): STOP revokes. WAQ-009 (done): auto-pause on quality drop | kanban done |
| F6 | Tenant onboarding settings: `welcome_campaign_id`, returning-member templates, `default_language` (`restaurant-onboarding-repository.ts`). No per-integration settings exist | code |
| F7 | `pos_integrations` (migrations 020/024): restaurant_id, provider, name, status, `webhook_secret NOT NULL`, field_mapping, credentials. HMAC-SHA256 auth in `src/app/api/integrations/[integrationId]/verify-signature.ts` | code |
| F8 | Queue infra: BullMQ on REDIS_URL; `campaign-queue.ts` (concurrency 1, attempts 3), `event-dispatch-queue.ts` (attempts 5, bounded removeOnComplete/removeOnFail), `email-job-processor.ts` (permanent vs transient error split); workers via `ensureWorkerStarted` in the daemon. Prod: e2-medium/4GB shared by 17 sites | code + kanban |
| F9 | Meta rule (product knowledge, not repo fact): outside a 24h customer-service window a business may only send **approved templates**; a template carrying a promotion/coupon is **MARKETING** category, which Meta gates on opt-in and which counts against quality rating; UTILITY-category templates are transactional and are not promotional | Meta WhatsApp Business policy |

Consequence chain that drives §5: an API-created member has **never messaged us** (unlike
F1) → no service window (F9) → free-form welcome is impossible → any welcome is a
template → a template send is only permitted when the member's consent covers that
template's category (marketing needs marketing `opted_in` — F5; utility needs utility
`opted_in`). The partner channel is where the member actually joined and was vetted, so
the partner asserts the consent level (§5.2, owner decision).

---

## 4. Jobs To Be Done

- **Partner dev:** "When a customer signs up in my system, I want to create them in the
  restaurant's loyalty program with one idempotent call, tell you what they agreed to, and
  learn the result, so my integration is a one-afternoon job and never double-creates."
- **Owner:** "When a customer joins through my POS, I want them welcomed the same way as a
  WhatsApp joiner — but only if that is safe for my WhatsApp number — so I do not have to
  choose between growth and being paused."
- **Owner:** "When a customer joins through a partner, I want to be able to message them
  later (campaigns, notifications) to the extent they agreed at sign-up, without a second
  opt-in dance."
- **Owner:** "When a customer joins on WhatsApp, I want my POS to know, so the cashier can
  see and award points without a phone lookup."
- **Member:** "When I join at the till, I want the welcome offer I was promised, and
  nothing I did not agree to."

---

## 5. Welcome Promotion and Consent for API-Created Members (decided)

### 5.0 Design principle — server-to-server, partner-vetted (owner decision)

The inbound member-creation API accepts **server-to-server calls only**: every request
is HMAC-signed with the integration's inbound secret (F7). There is no browser or
public-form variant, no CORS allowlist and no session-auth path — a member who wants to
join from a web page uses the existing QR join (F2), never this API. Consequently,
**vetting the member is the partner system's responsibility**: it verified the identity
(the phone belongs to the person in front of it) and it collected whatever consent it
asserts. The platform accepts the partner-asserted `consent_level` as given (D6, OD-12)
and attributes it to the integration; it does not re-verify, re-prompt, or collect proof.

### 5.1 What happens on the three existing paths

| Path | Coupon minted | WhatsApp message | `join` source |
|---|---|---|---|
| WhatsApp (F1) | yes | free-form welcome + QR (window open) | `whatsapp` |
| Web QR (F2) | yes | none (code returned to the browser) | `web` |
| CSV import (F3) | no | none | (import) |

### 5.2 Requirements — what the API path does

**D1 — Idempotent create-or-get (default — confirm with owner; OD-2 standing).**
Existing member for (restaurant, phone) → return the existing member id with
`outcome: existing`; **no welcome, no coupon, no `join` event.** Consent level on the
request is still applied to the existing member under the upgrade-only rule (D6).
Trace: F1/F2 both key members on phone; a second welcome on re-submission would be a
duplicate promotion and, if sent, a duplicate marketing message.

**D2 — New member: `join` event + consent records; welcome coupon and WhatsApp delivery
only per the integration's `new_join_template_id` (owner decision OD-3: default is no
send; default OD-15: no coupon unless a welcome is actually sent).** A new member via the
API emits `join` with source `partner_api` and writes consent records (D6). The welcome
coupon is resolved exactly as on web join (tenant `welcome_campaign_id`, else default
welcome coupon — F2, F6) but is **minted inside the welcome job, immediately before the
send, after the send-time checks pass** (OD-15, default — confirm with owner). The partner
is never told the coupon code — not in the job result, not in the outbound webhook (owner
decision OD-11); the member learns of it only through the WhatsApp welcome, when a
template is configured. With the OD-3 default (`null`) nothing is minted and nothing is
sent — on that configuration the API path behaves like CSV import (F3), not web join
(F2). Trace: F9 (no service window) + OD-11: a coupon minted for a member who is never
told the code and a partner who never sees it is an orphan promotion row that nobody can
redeem, and it would inflate issued-coupon metrics.

**D3 — Welcome template source is configurable per integration by design (owner
decision OD-1); at launch only the tenant default is selectable.** Per-integration
setting `new_join_template_id`:

| `new_join_template_id` | Meaning | Availability |
|---|---|---|
| `null` (**default**) | Do not send anything on WhatsApp for members this integration creates | launch |
| `'default'` | Send the tenant's default welcome campaign template (the approved template behind `welcome_campaign_id` — F6, OQ-3) | launch |
| `<template id>` | Send a specific approved template of this tenant | model + API: launch; **dashboard UI: post-launch** |

The old three-level delivery mode is gone: there is one setting (which template, or
none) and one gate (D4). A send always requires, in addition: the resolved template is
`APPROVED`, the tenant is not quality-paused (WAQ-009), and the send passes the pre-send
consent check for the template's category.

**D4 — A send proceeds only when the template's category is permitted by the member's
effective consent level (owner decision).** Category → required level:

| Template category | Requires effective level | Trace |
|---|---|---|
| UTILITY | `utility` or `all` | F9 |
| MARKETING (any coupon/promo welcome — the tenant default welcome is expected to be this) | `all` | F5, F9 |
| AUTHENTICATION | never used as a welcome | — |

If not permitted, **the create still succeeds** and the welcome is skipped with a recorded
reason (`skipped_consent_level`, carrying `required_level` and `effective_level`) on the
delivery log and the member timeline — never in the job result (OD-11) — and no coupon is
minted (OD-15). The check runs at send time
against consent records (not against the request payload alone), so a STOP between create
and send (WAQ-005) blocks the send.

**D5 — Per-request `send_welcome: false` suppresses; it never forces (kept).** Use case:
bulk backfill of historical POS customers, where the partner must not trigger hundreds of
welcome sends against a template-enabled integration. A request cannot set
`send_welcome: true` to override `new_join_template_id = null` or bypass D4 — the owner's
setting is the ceiling. Default `true`. Trace: F8 (queue/VM budget) + F5 (consent gate is
not the partner's to waive).

**D6 — Partner-asserted consent level (owner decision).** The partner channel vets the
member when they join there; the platform does **not** collect consent proof. The
create request carries a required `consent_level`:

```
consent_level: "none" | "utility" | "all"     // required; absent or other value → 422
```

| `consent_level` | utility record | marketing record | Enables (future sends to this member) |
|---|---|---|---|
| `none` | `pending` | `pending` | no template sends of any category |
| `utility` | `opted_in` | `pending` | utility templates (notifications); no campaigns |
| `all` | `opted_in` | `opted_in` | utility + marketing (campaigns, promo welcome) |

Records written for a **new** member, per category: `source = 'partner_api'`,
`source_reference = <integrationId>`, `captured_at = request receipt time`,
`business_name_shown = tenant's registered name`, `consent_text = null`,
`proof_url = null`. The consent level is what later campaign / notification sends check
(F5); the welcome is just the first such send.

- **Grade (default — confirm with owner, OD-13):** `strong`, attributed to the
  integration. Rationale: the owner configured that integration and is accountable for
  its vetting; a `weak` grade would make every partner-created member fail the WAQ-004
  marketing gate and defeat the purpose of the level.
- **Existing member (default — confirm with owner, OD-14): upgrade-only.** A request may
  move a category `pending → opted_in`; it never moves `opted_in → pending`, and it never
  touches `opted_out` (STOP is the member's channel — WAQ-005; re-opt-in after STOP is
  not available via this API). A lower level on a re-submit is ignored. Downgrades happen
  only through the member's own opt-out path, which fires `member.updated`.

The **effective** level is derived from consent records after the write: `all` if both
categories `opted_in`, `utility` if only utility `opted_in`, else `none`. It drives D4 and
every later campaign / notification gate, and is visible in the member consent view with
per-category status (so an `opted_out` is visible). It is **not** returned to the partner
in the job result (owner decision OD-11); it does travel in the outbound webhook (OD-7).

**D7 — Welcome sends are their own queued jobs under the limiter (default — confirm
with owner).** The member-create job never calls the WhatsApp provider inline; it enqueues
a welcome job that runs under the existing per-tenant pacing/limiter (F8, WAQ-010). A
welcome that fails does not fail the create.

**D8 — A `join` event with source `partner_api` and the integration id in metadata
(default — confirm with owner)** so analytics can split acquisition by channel and so
the outbound webhook (§7) has one seam to hook. Trace: F1/F2 already emit `join` with a
source discriminator.

### 5.3 What the member experiences

| Scenario | Member sees |
|---|---|
| `new_join_template_id = null` (default) | Nothing on WhatsApp. No welcome coupon (OD-15). Whatever the partner's own system shows them (the partner is not told anything about a coupon — OD-11) |
| `'default'` (marketing template), `consent_level: all` | One approved welcome template on WhatsApp carrying the coupon code / QR minted for that send (OD-15) |
| `'default'` (marketing template), `consent_level: utility` or `none` | Nothing on WhatsApp (`skipped_consent_level`); no coupon. If the member later messages the number, the existing returning-member / onboarding logic applies (F1, F6) — not in scope to change |
| utility-category template (post-launch UI), `consent_level: utility` | One utility template (e.g. "Your membership is set up") |
| Already a member | Nothing. No duplicate coupon. Consent may be upgraded silently (D6) |

---

## 6. Success Metrics

| Metric | Current | Target (90 days post-launch) | How measured |
|---|---|---|---|
| Members created via `partner_api` / month (per active integration) | 0 | ≥ 30% of new members on tenants with an active integration | `join` events by source |
| Duplicate-member rate on API path | n/a | 0 (idempotency) | members with same (restaurant, phone) created within 24h |
| Share of API-created members asserted at `consent_level: all` | n/a | ≥ 70% on integrations with a template configured | consent_records by source `partner_api` |
| Welcome skipped for `consent_level` on template-enabled integrations | n/a | < 30% of creates (signals partner is not asking for consent) | welcome outcome records `skipped_consent_level` (delivery log) |
| Welcome template delivered / sent (API path) | n/a | ≥ 95% delivered; read ≥ 60% | message status ingestion (WAQ-001/002) |
| Quality-rating incidents attributable to API welcomes | n/a | 0 tenant auto-pauses within 7 days of an API welcome burst | tenant_quality_state (WAQ-006) vs welcome job timestamps |
| Outbound webhook delivery success (first 5 attempts) | n/a | ≥ 99% ; p95 first-attempt latency < 30s from creation | delivery log |
| Dead-lettered deliveries / week | n/a | < 1% of deliveries; every dead-letter surfaced in dashboard + Slack | dead-letter queue |
| 429/503 responses to partners | n/a | < 0.5% of requests; zero cross-tenant starvation | edge counters, queue depth per integration |
| Partner time-to-first-successful-create | n/a | < 1 working day from receiving credentials | support log / OQ-1 interviews |

---

## 7. User Stories

### Inbound

#### US-1 Create-or-get a member by phone
**As a** partner developer **I want** `POST /api/integrations/{integrationId}/members` to
create the member if new or return the existing one **so that** my retry logic never
double-creates.

Acceptance criteria
- [ ] Given a valid HMAC-signed request (per-integration secret, F7 scheme — owner decision
      OD-6: signature over timestamp + raw body, timestamp within ±5 min, replay of the
      same nonce/timestamp+body rejected) with a valid phone and a valid `consent_level`,
      when received, then the route does only: verify → validate/normalize → enqueue →
      respond `202 Accepted` with `{ job_id, status: "queued", poll_url }`. No DB write to
      `members` happens in the request handler.
- [ ] Given the same (integrationId, normalized E.164 phone) is submitted while a job is
      queued/processing, when received, then the same `job_id` is returned (`jobId =
      hash(integrationId, phone)`) with `202` and `status: "queued"|"processing"` — no second job.
- [ ] Given the member already exists when the worker runs, then the job succeeds with
      `outcome: "existing"` and `member_id`; no coupon is minted, no `join` event, no
      welcome (welcome outcome recorded as `skipped_existing`); the request's
      `consent_level` is applied under the upgrade-only rule (D1, D6). Nothing about
      consent or welcome is returned (OD-11).
- [ ] Given the member is new, then the job succeeds with `outcome: "created"` and
      `member_id`; consent records are written per D6; the welcome outcome
      (`queued` | `skipped_<reason>`) is recorded on the delivery log and member timeline
      per D3–D5/D7; a coupon is minted only inside a welcome job that sends (OD-15). The
      job result carries **no** coupon, consent or welcome fields (OD-11).
- [ ] Given a phone that cannot be normalized to E.164 (HK default region from tenant
      `default_language`/country — F6; OQ-7), then `422` with field-level errors.
- [ ] Given `consent_level` absent or not one of `none|utility|all`, then `422` with
      `consent_level` in errors (rejected at the edge, before enqueue).
- [ ] Member creation reuses the `register-member*` domain logic (kanban INT-001) — the
      acceptance suite proves the API path and the web path produce identical member rows
      for the same inputs, and identical coupon rows when a welcome is sent (OD-15).
- [ ] Server-to-server only (§5.0): the route rejects any request without a valid HMAC
      signature with `401`, sets no CORS headers (a browser preflight gets no
      `Access-Control-Allow-*`), and never consults a dashboard session — a logged-in
      owner's browser cannot call it. The acceptance suite asserts all three.
- [ ] Request fields: `phone` (required), `consent_level` (required, D6), `name` (≤80
      chars), `external_ref` (partner's customer id, ≤128, stored and echoed in every
      outbound event), `language` (`en`|`zh-HK`|…; default tenant `default_language` —
      F6), `send_welcome` (boolean, default `true`, D5), `metadata` (≤2 KB JSON, opaque,
      echoed).

Out of scope / notes
- Batch create: not in v1 (§9). Body limit 16 KB; oversize → `413`.
- Cross-brand lookup (MBL-020): never — lookup is strictly (restaurant_id, phone).

#### US-2 Poll the async result
**As a** partner developer **I want** `GET /api/integrations/{integrationId}/members/jobs/{jobId}`
**so that** I can learn whether the member was created or already existed, and its id,
without a webhook.

Response schema (owner decision OD-11 — this is the complete field list):

```
{ status: "queued" | "processing" | "succeeded" | "failed",
  member_id?: string,                       // succeeded only
  outcome?: "created" | "existing",         // succeeded only
  error?: { code, message } }               // failed only
```

- [ ] Given a signed GET (same HMAC scheme, empty body), when the job is
      queued/processing, then `200 { status: "queued"|"processing", submitted_at, attempts }`.
- [ ] When succeeded, then `200 { status: "succeeded", member_id, outcome }` for at least
      24h after completion (bounded retention — F8 `removeOnComplete` counts must be set so
      24h of a partner's volume fits; the architect sizes this).
- [ ] The response never contains a coupon code, a consent level, per-category consent
      status, grade, or a welcome outcome (OD-11). Those are visible to the owner in the
      dashboard (member timeline, consent view, delivery log); partner-facing coupon /
      consent lookup endpoints are a non-goal for INT-001 (§9 Future).
- [ ] When failed permanently, then `200 { status: "failed", error: { code, message } }`
      with a stable code list (`validation`, `tenant_inactive`, `integration_paused`,
      `internal`).
- [ ] Given a jobId that belongs to another integration or does not exist, then `404` —
      never `403` (no cross-tenant enumeration).
- [ ] Job results are readable only with the integration's own secret; the result never
      contains another member's data.

#### US-3 Partner-asserted consent level (PDPO)
**As a** restaurant owner **I want** the API to record, per member, the consent level my
partner vetted at sign-up **so that** later campaigns and notifications reach exactly the
members who agreed, and I can point to which integration asserted it.

- [ ] Given a new member with `consent_level: all`, then utility and marketing records are
      written `opted_in`, grade `strong` (OD-13 default), `source = 'partner_api'`,
      `source_reference = <integrationId>`, `captured_at = request receipt time`,
      `business_name_shown = tenant name`, `consent_text`/`proof_url` null (D6).
- [ ] Given `consent_level: utility`, then utility `opted_in` and marketing `pending`;
      effective level `utility`.
- [ ] Given `consent_level: none`, then both records `pending`; effective level `none`; no
      template of any category is sent to this member by the welcome or by any later
      campaign until the level is raised.
- [ ] The level is accepted exactly as asserted (owner decision OD-12); the request carries
      no grade field and any grade field is ignored — grade is always set server-side
      (OD-13 default).
- [ ] Given an existing member with a category `pending` and a request level that covers
      it, then that category becomes `opted_in` (upgrade) with a fresh `captured_at`
      (OD-14 default). The new effective level is visible in the member consent view; it
      is not returned to the partner (OD-11).
- [ ] Given an existing member whose current level exceeds the request level, then nothing
      changes (never downgrade — OD-14); the job still succeeds with `outcome: "existing"`.
- [ ] Given an existing `opted_out` record for a category (e.g. STOP, WAQ-005), then the
      record is left untouched whatever the request level, the member is still
      created/returned, the consent view shows that category `opted_out`, and any template
      of that category is `skipped_opted_out`.
- [ ] A marketing campaign send (WAQ-004 gate) to a partner-created member succeeds iff
      marketing is `opted_in` — the acceptance suite proves `all` members pass and
      `utility`/`none` members are excluded.
- [ ] Every consent record written by this path is visible in the existing member consent
      view (wherever WAQ-004 surfaces it) with source `partner_api` and the integration
      name.

#### US-4 Welcome delivery per integration (`new_join_template_id`)
**As a** restaurant owner **I want** to choose per integration which welcome template (if
any) API-created members receive **so that** I control the WhatsApp quality risk.

Welcome outcomes (`queued` | `skipped_<reason>`) are recorded on the delivery log and the
member timeline. They are never part of the partner's job result (OD-11).

- [ ] Given `new_join_template_id = null` (default for every new and every existing
      integration — OD-3), then no welcome job is enqueued and no coupon is minted (OD-15);
      welcome outcome `skipped_off`.
- [ ] Given `'default'`, a new member, an `APPROVED` tenant default welcome template, and
      an effective level that permits the template's category (D4), then a welcome job is
      enqueued on the limited queue (D7); welcome outcome `queued` with the welcome job id
      on the delivery log row. At send time the job re-runs the D4 / quality-pause /
      `APPROVED` checks, **then** mints the coupon (web-join resolution — F2, F6; OD-15)
      and sends the template with it. If any send-time check fails, no coupon is minted.
- [ ] Given a template whose category is not permitted by the effective level (marketing
      template with `utility`/`none`; utility template with `none`), then no job and no
      coupon; welcome outcome `skipped_consent_level` with `required_level` and
      `effective_level` on the delivery log and member timeline.
- [ ] Given a specific `<template id>` (API/model — launch; dashboard — post-launch), then
      the same rules apply with that template's category; a template id not owned by the
      tenant or not `APPROVED` cannot be saved (`422` on the settings API).
- [ ] Given the tenant is quality-paused (WAQ-009) or the resolved template is not
      `APPROVED` at send time, then `skipped_quality_paused` / `skipped_no_template`; the
      create still succeeds.
- [ ] Given `send_welcome: false` in the request, then `skipped_by_request` regardless of
      setting (D5). `send_welcome: true` has no effect beyond the setting.
- [ ] Given an existing member, then `skipped_existing` (D1).
- [ ] The category check is re-run inside the welcome job at send time (a STOP between
      create and send blocks the send — `skipped_opted_out`).
- [ ] A welcome job failure (provider error, 131047-class rejection) is retried per the
      limiter's policy and never re-runs or fails the member-create job.
- [ ] Welcome sends appear in the same per-message tracking as campaign sends (WAQ-001)
      with a `source: welcome_partner_api` discriminator.

#### US-5 Abuse limits (queue-bounded)
**As a** platform operator **I want** per-integration rate and queue-depth limits **so
that** one partner cannot flood the shared queue or VM (F8).

- [ ] Per-integration token bucket at the edge (Redis): default 60 req/min, burst 20
      (configurable per integration by platform admin, not by owner). Exceeded → `429`
      with `Retry-After` seconds and `X-RateLimit-Remaining`.
- [ ] Per-integration waiting-job cap: default 500. Exceeded → `503` with `Retry-After`
      and body `{ error: "queue_depth_exceeded" }` — distinguishable from 429 so the
      partner knows it is *our* backlog, not their pace.
- [ ] Redis unavailable → `503 { error: "queue_unavailable" }`; nothing is written
      synchronously as a fallback (a fallback insert would violate the "never in the
      request handler" constraint).
- [ ] Limits are keyed on `integrationId`, never on tenant only, so two integrations of
      one tenant do not share a bucket, and never global.
- [ ] Load test before release (kanban INT-001 c): 500 creates in 60s on one integration
      leaves p95 API response < 200ms and daemon RSS growth < 100 MB; the architect sets the
      budget in the plan, this spec only demands that one exists.

### Outbound

#### US-6 Receive `member.created` / `member.updated`
**As a** partner developer **I want** a signed webhook when a member is created on any path
**so that** my POS knows about WhatsApp / QR joiners without polling.

- [ ] Fired from the single member-creation seam so **all** of F1, F2, F3 and the API path
      emit `member.created`; the acceptance suite asserts one event per path.
- [ ] Payload (JSON, ≤ 8 KB):
      ```
      { id: "evt_…", type: "member.created", occurred_at, api_version: "2026-09-01",
        restaurant_id, integration_id,
        data: { member_id, phone_e164, name, language, source: "whatsapp"|"web"|"csv_import"|"partner_api",
                external_ref, created_at,
                consent: { effective_level: "none"|"utility"|"all",
                           utility: "opted_in"|"pending"|"opted_out",
                           marketing: "opted_in"|"pending"|"opted_out", grade } } }
      ```
      No coupon field on any path: the partner never learns a coupon code in INT-001
      (owner decision OD-11). `consent` stays because OD-7 makes consent changes a
      `member.updated` trigger.
      `member.updated` carries the same envelope with `data.changed: [field…]` and the new
      values. Triggers (owner decision OD-7): name/language/external_ref change, consent
      status change (incl. STOP and level upgrades via the API), member status
      (active/blocked). **Not** points balance changes.
- [ ] `phone_e164` is the full E.164 number (owner decision OD-8); no masking option.
- [ ] Signature header `X-OMC-Signature: t=<unix>,v1=<hex HMAC-SHA256(outbound_secret,
      "<t>.<body>")>` where `outbound_secret` is the secret the **partner** issued and the
      owner pasted into the integration settings (OD-9); partner is told to reject
      `|now − t| > 5 min`. `X-OMC-Event-Id` and `X-OMC-Delivery-Attempt` headers for
      de-duplication.
- [ ] Delivery is a job on a dedicated `integration-outbound` queue: concurrency 2 (config
      up to 4), limiter max jobs/duration, per-destination-host budget, 5s timeout, ≤ 5
      attempts exponential backoff (F8, kanban INT-001 b).
- [ ] 2xx = delivered. 4xx (except 408, 429) = **permanent**, straight to dead-letter
      (F8 email-job-processor split). 5xx / 408 / 429 / timeout / DNS = transient → retry.
- [ ] Exhausted → dead-letter (bounded like event-dispatch-queue — F8) + Slack alert +
      dashboard row.
- [ ] Circuit breaker: 10 consecutive transient failures (default) → integration outbound
      status `paused_auto`; no new deliveries are attempted; dashboard shows the pause and
      the owner can Resume (US-9). Events that occur while paused are **queued, not
      dropped**, up to the queue-depth cap; beyond the cap they are dead-lettered.
- [ ] Destination URL must be `https://`, resolve to a public IP (SSRF: reject
      loopback/link-local/private ranges at save time and at delivery time), and respond
      within 5s. Redirects are not followed.
- [ ] Outbound PII: the payload contains `phone_e164` and `name`. Owner acknowledges this
      when enabling outbound (US-7 checkbox).

### Dashboard

#### US-7 Configure outbound webhook
**As a** restaurant owner **I want** to set the outbound URL and see the secret once **so
that** I can connect my POS without a support ticket.

- [ ] Integration settings page (existing `pos_integrations` entry — F7) gains an
      "Outbound webhook" card: URL, event checkboxes (`member.created` on by default,
      `member.updated` off), PII acknowledgement checkbox, "Send test event", and the
      **partner-issued signing secret** field (owner pastes the secret the partner's
      system generated; stored, displayed masked, never shown again — OD-9).
- [ ] Saving with an invalid/non-https/private-IP URL is rejected inline; nothing is
      persisted.
- [ ] "Send test event" enqueues a `ping` event through the real outbound queue and shows
      the delivery row live (queued → delivered / failed with response code).

#### US-8 Configure the welcome template per integration
- [ ] "Welcome message for members created by this integration" control with two options
      at launch: **Off** (`null`, default) and **Tenant default welcome template**
      (`'default'`), each with a one-line explanation (copy in §8.3). The chosen template's
      name and category are shown next to the option.
- [ ] Helper text under the control states the consent rule in plain words: "Sent only
      to members the partner marked as consenting to <category> messages
      (`consent_level: all` for marketing, `utility` or `all` for utility)."
- [ ] Choosing the tenant default when no approved welcome template exists (OQ-3) blocks
      the save with a link to the template page.
- [ ] **Specific template id (post-launch):** the settings API accepts a `<template id>`
      from launch (US-4); the dashboard shows no picker for it at launch. If an integration
      already holds a specific id (set via API), the control displays "Specific template:
      <name>" read-only with Off as the only other choice.
- [ ] Every change to the setting is logged (who, when, old → new) on the integration.

#### US-9 Delivery log, retry, resume, outbound secret replacement
- [ ] Delivery log table (last 30 days or 500 rows, whichever smaller): event type, event
      id, occurred_at, attempts, status (queued / delivered / retrying / dead-lettered /
      paused), last HTTP code, next retry at. Filter by status.
- [ ] "Retry" on a dead-lettered row re-enqueues it once (new attempt counter, same event
      id).
- [ ] When auto-paused, a banner shows the failure streak and a "Resume deliveries"
      button; resume resets the streak.
- [ ] Outbound signing secret (owner decision OD-9): the secret is **minted by the
      partner's system**, not by the platform. The owner pastes it into the integration
      settings; it is stored, shown masked, and never displayed again. Rotation = the
      owner enters the partner's new secret; it is active **immediately** for every
      delivery attempted after the save — no grace window, no dual signatures, no
      scheduled retirement. The change is logged (who, when).
- [ ] Deliveries already in flight at the moment of the swap may fail signature
      verification at the partner (their 401/403 is a permanent 4xx — US-6) — the
      settings page warns about this before saving (§8.2); the owner is expected to
      swap in the partner's system and ours back-to-back and use "Retry" on any
      dead-lettered rows.
- [ ] Validation: empty secret, or shorter than 16 characters, is rejected inline;
      nothing is persisted.
- [ ] Inbound (partner-signs) secret rotation: OQ-5 — today `webhook_secret` exists (F7)
      but whether the dashboard can rotate it is unverified.

---

## 8. UI Feedback States

### 8.1 API responses (the partner's "UI")

| Action | Success | Warning (accepted with caveat) | Rejected |
|---|---|---|---|
| POST members | `202 { job_id, status:"queued", poll_url }` | `202` with `status:"processing"`/`"queued"` on duplicate submit (same job id) | `401` bad/expired signature, unknown integration (same body — no enumeration) · `403` integration `status != active` · `413` body > 16 KB · `415` not JSON · `422` validation (field list, incl. `phone`, `consent_level`) · `429` rate limit + `Retry-After` · `503 queue_depth_exceeded` / `queue_unavailable` + `Retry-After` |
| GET job | `200 { status:"succeeded", member_id, outcome }` | `200 { status:"queued"\|"processing" }` | `401` · `404` unknown / foreign job · `410` result expired (retention passed) |
| Job result (async, OD-11) | `outcome:"created"` + `member_id` — nothing else | `outcome:"existing"` (idempotent hit: no coupon, no welcome, consent possibly upgraded — none of which is in the response) | `status:"failed"` + `error: { code, message }` |
| Welcome outcome (owner-visible only: delivery log + member timeline, never the API) | `queued` → later `delivered` with the coupon minted for that send | `skipped_off` / `skipped_consent_level {required_level, effective_level}` / `skipped_by_request` / `skipped_existing` / `skipped_quality_paused` / `skipped_no_template` / `skipped_opted_out` — no coupon minted in any of these (OD-15) | welcome job failed after retries (create unaffected) |
| PUT integration settings (`new_join_template_id`) | `200` with the resolved template name + category | `200` + `warnings: ["tenant_quality_paused"]` | `422 template_not_found` / `template_not_approved` / `template_not_owned` / `no_default_welcome_template` |

### 8.2 Dashboard — outbound webhook card

| Action | Success | Warning | Rejected |
|---|---|---|---|
| Save URL | Toast "Webhook saved"; card shows URL + status Active | Saved, but no PII acknowledgement → outbound stays **Disabled** with inline "Acknowledge to enable" | Inline: "Must be https" / "Private or local addresses are not allowed" / "Not a valid URL"; nothing persisted |
| Send test event | Row appears: queued → "Delivered · 200 · 312 ms" | "Delivered · 2xx but empty body" (informational) | Row "Failed · 404 (permanent)" or "Retrying · timeout · next in 30s"; if breaker trips, banner "Deliveries paused after 10 failures" |
| Save / replace outbound secret (OD-9) | Toast "Signing secret saved"; field shows masked value (`••••••••` + last 4) and "Updated <when> by <user>"; log row. The pasted value is never displayed again | Before save, when a secret already exists: "Deliveries in flight during the swap may fail signature verification at your partner and will retry under normal backoff — update the partner side first." Confirm to proceed | Inline: "Secret is required" / "Secret must be at least 16 characters"; nothing persisted |
| Retry dead-letter | Row flips to queued, then final status | — | "Already retried — retry once per event" |
| Resume deliveries | Banner clears; queued events start flowing | "Resumed — 37 queued events will deliver over the next few minutes" | "Cannot resume: URL invalid" (must fix URL first) |

### 8.3 Dashboard — welcome template control

| Action | Success | Warning | Rejected |
|---|---|---|---|
| Select Off | Saved silently; helper "Members created by this integration are not messaged on WhatsApp and receive no welcome coupon" | — | — |
| Select Tenant default welcome template | Saved; helper "Sends <template name> (<category>) with the welcome coupon to new members whose partner-asserted consent level allows <category> messages. Others are not messaged and receive no coupon"; audit row | If the template is APPROVED but the tenant is currently quality-paused: "Saved — sends will resume when quality recovers". If the template is MARKETING: "Only members created with `consent_level: all` will receive this" | "Map an approved welcome template first" (link); cancelling reverts to previous value |
| Specific template (post-launch) | (no picker at launch) — read-only display if set via API | — | — |
| Per-request `send_welcome:false` (no UI) | — | Delivery log / member timeline shows "Welcome suppressed by partner request" | — |
| Welcome skipped for consent level (no UI action) | — | Member timeline: "Welcome not sent — partner marked consent as <level>; <template> needs <required level>" | — |

States this spec cannot specify → Open Questions: what the member timeline shows for
`pending` consent created by a partner (OQ-8).

---

## 9. Scope

**In (v1)**
- Inbound `POST …/members` (single member), `GET …/members/jobs/{jobId}`, per-integration HMAC auth reusing F7 (OD-6), edge limits, member-create worker reusing register-member logic, consent records from `consent_level` per D6, `join` source `partner_api`, welcome job per D3–D5/D7 with `new_join_template_id` (`null` | `'default'` | `<template id>` in model + API), coupon minted inside the sending welcome job (D2, OD-15); polling result limited to status / member id / outcome / error (OD-11).
- Outbound `member.created` + `member.updated` on a dedicated bounded queue, signing, retry/dead-letter, breaker, delivery log, test event, partner-issued signing secret entered by the owner (OD-9).
- Inbound API is **server-to-server only**: HMAC-signed calls from the partner's backend; no browser / public-form variant, no CORS allowlist, no session-auth path (owner decision, §5.0).
- Dashboard: outbound card, welcome template control (Off / Tenant default only at launch), delivery log.
- Security-architect threat model before the plan (auth, PII, tenant isolation, replay, SSRF).

**Out (non-goals — explicit)**
- Cross-brand auto-enrol or sibling-brand lookup — **MBL-020**, untouched.
- Hardening `/api/join/[slug]` (rate limit / signature) — **not in this work item** (owner closed OD-10 on 2026-09-10; no separate task filed).
- Batch create endpoint — future (§ below). The body/batch limits in kanban apply when it ships.
- A tenant-wide API key scheme — auth is per integration (owner decision OD-6).
- Collecting or validating consent proof (text shown, business name shown, proof URL) from partners — the partner channel vets; the platform records the asserted level only.
- Phone masking in outbound payloads (owner decision OD-8).
- Returning coupon codes to the partner (job result or outbound payload), or consent level / status or welcome outcome in the job result (owner decision OD-11).
- Platform-minted or auto-rotating outbound secrets, grace windows, dual signatures (owner decision OD-9: the partner mints the secret; the owner pastes it; a replacement is immediate).
- Any browser-callable variant of the member-creation API (CORS, session auth, public form) — server-to-server only.
- Any change to the inbound secret model: `pos_integrations.webhook_secret` stays platform-minted and verified by the existing `verify-signature.ts` precedent (F7).
- `member.deleted`, points/transaction events (the POS already originates those), coupon redemption events.
- Pulling customers *from* a POS (PosApi has no customer methods — kanban note; stays that way).
- Changing what WhatsApp or web joiners receive (F1/F2 unchanged).
- Building on `import-members-with-consent.ts` — dead code per kanban note.

**Future**
- Dashboard picker for a specific `new_join_template_id` (model + API ship at launch).
- Batch create (≤ 100 rows/request, one job per row under the same caps).
- Partner-facing developer docs page + sandbox integration.
- Partner-facing coupon lookup and consent lookup endpoints (noted by the owner as possible later endpoints when closing OD-11).

---

## 10. Dependencies & Risks

| Dependency / Risk | Impact | Mitigation |
|---|---|---|
| WAQ-004 pre-send gate checks marketing consent only (F5) | A utility-category template needs a utility-consent check the gate may not have; `consent_level: none` must block utility sends too | OQ-2 — architect verifies; if absent, the welcome job performs the category check itself (D4) and the campaign path stays marketing-only |
| Tenant default welcome template must exist and be APPROVED per tenant | `'default'` unusable for tenants without one | US-8 blocks the save; OQ-3 identifies the template |
| Shared WABA quality (WAQ-009) | A partner backfill on a template-enabled integration can pause the tenant | D5 suppression, D7 limiter, welcome burst metric |
| Partner asserts a level the member did not actually give | Marketing sent to a member who never agreed; PDPO Part VI A exposure lands on the owner | Level attributed to the integration (`source_reference`), `strong` grade is the owner's accountability (OD-13); `skipped_consent_level` rate metric flags lazy partners; STOP still revokes (WAQ-005) |
| Shared 4GB VM (F8) | Worker concurrency/memory | Caps in US-5/US-6; load test gate before release |
| PII in outbound payloads | Owner ships full phone numbers to a third party (OD-8) | PII acknowledgement, https + SSRF checks |
| Coupon is minted inside the welcome job at send time (OD-15) | A retry after a crash between mint and send could double-mint; a welcome that is skipped at send time must leave no coupon | Mint idempotently keyed on (member, welcome campaign) — architect; acceptance suite asserts zero coupon rows for every `skipped_*` outcome |
| Meta 24h window rules (F9) | Any inline "free-form welcome" shortcut would be rejected (131047-class) | D2 hard rule: no free-form on this path |
| Kanban has WAQ-004 in both `backlog` and `done` | Contradictory tracking state | Reported to orchestrator; done entry treated as authoritative (F5); not repaired here |
| `.claude-workspace/specs/` was absent in this worktree although INDEX lists a spec | Index rot | Folder created for this artifact; reported, not repaired |

---

## 11. Decisions

### 11.1 Owner decisions (final, 2026-09-10)

| # | Decision | Where applied |
|---|---|---|
| OD-1 | Welcome template source is configurable per integration by design; at launch only the tenant default is selectable in the dashboard; specific template id is in the model/API at launch, dashboard post-launch | D3, US-4, US-8 |
| OD-3 | Default welcome delivery is OFF (`new_join_template_id = null`) | D2, D3, US-4 |
| Consent | Partner asserts `consent_level: none \| utility \| all`; platform collects no proof; level drives future template sends; old three-level delivery mode and OD-5 removed | D4, D6, US-1, US-3, US-4 |
| OD-6 | Inbound auth per integration (F7 HMAC secret); no tenant-wide API key | US-1, §9 |
| OD-7 | `member.updated` fires on profile / consent / status changes, not points | US-6 |
| OD-8 | Full E.164 phone in outbound payloads; masking stays a non-goal | US-6, §9 |
| OD-9 | The **outbound** signing secret is minted by the partner's system and pasted by the owner into the integration settings; a replacement is active immediately — no grace window, no dual signatures, no scheduled retirement. The **inbound** secret model is unchanged (platform-minted `pos_integrations.webhook_secret`, existing `verify-signature.ts`) | US-6, US-7, US-9, §8.2 |
| S2S | The inbound member-creation API is server-to-server only (HMAC-signed; no browser / public-form variant, no CORS allowlist, no session auth). Member vetting — identity and consent — is the partner system's responsibility; the platform accepts the asserted `consent_level` as given (with OD-12) | §5.0, US-1, §9 |
| OD-10 | Closed: `/api/join/[slug]` hardening is out of scope and **no separate task is filed** | §9 |
| OD-11 | The job-result polling endpoint returns **only** `status` (`queued\|processing\|succeeded\|failed`), `member_id`, `outcome` (`created\|existing`) and a structured `error` on failure. No coupon code anywhere the partner can read it (result or outbound payload); no consent level / status and no welcome outcome in the result (consent stays in the outbound payload per OD-7). Coupon / consent lookups may become separate endpoints later (non-goal for INT-001) | D2, D4, D6, US-1, US-2, US-3, US-4, US-6, §8.1 |
| OD-12 | Consent **level** is partner-asserted and accepted as given; the request carries no grade field and grade is always set server-side | D6, US-3 |

### 11.2 Open decisions for owner (each shipped as a labelled default unless overruled)

| # | Decision | Default | Trace |
|---|---|---|---|
| OD-2 | Idempotent create-or-get | **Existing member → `outcome: existing`, no welcome, no coupon, no `join` event**; request `consent_level` still applied under OD-14 | D1, US-1 |
| OD-13 | Grade recorded for partner-asserted levels | **`strong`**, attributed to the integration (owner configured it and is accountable for its vetting) | D6, US-3 |
| OD-14 | `consent_level` on an existing member | **Upgrade-only**: `pending → opted_in` allowed; never downgrade; `opted_out` untouched (STOP path only) | D6, US-3 |
| OD-15 | When is the welcome coupon minted on the API path (new, raised by OD-11) | **Mint the coupon only when a welcome will actually be sent** — inside the welcome job, after the send-time checks, immediately before the send. `null` setting or any `skipped_*` outcome → no coupon. With the OD-3 default the API path therefore mints nothing (like CSV import, F3) | D2, D4, US-1, US-4, §8.3, §10 |

Why OD-15 exists: with OD-11 the partner never sees a coupon code and with OD-3 the
member gets no WhatsApp message, so a coupon minted at create time on the default
configuration would be visible to nobody — an orphan row that inflates issued-coupon
counts and can never be redeemed. Consequence the owner should be aware of: a member
created at the till on the default configuration receives **no welcome offer at all**,
and because OD-2 treats them as existing if they later message on WhatsApp, the
returning-member logic (F6) applies — the welcome offer never arrives on any channel
unless the owner configures a template. If that is unacceptable, the alternative is to
mint at create and surface the coupon to the owner's staff in the member view (not to
the partner); that is not specified here.

---

## 12. Open Questions

1. **OQ-1** No partner or owner has been interviewed; which POS/booking vendors are the
   first two integrations, and do they ask for consent at sign-up today? (Determines what
   share of creates will arrive as `consent_level: all` and whether the tenant default
   welcome will ever fire.)
2. **OQ-2** Does the WAQ-004 pre-send gate check utility consent for UTILITY-category
   templates, or marketing only (F5)? If marketing only, the welcome job must own the
   category check (D4) and a `none` member must still be excluded from utility sends.
3. **OQ-3** Which existing template is "the tenant default welcome template" — is there an
   approved template behind `welcome_campaign_id` today, or only the free-form body used on
   F1? (Blocks `'default'` resolution and US-8 copy.)
4. (OQ-4 — partner-controlled coupon expiry for receipt-printed codes — withdrawn: the
   partner never sees the code (OD-11); expiry follows the web-join resolution.)
5. **OQ-5** Can the dashboard rotate the *inbound* `webhook_secret` today (F7)? If not,
   is it in scope here or a follow-up? (OD-9 covers the outbound secret only; the inbound
   model is explicitly unchanged.)
6. **OQ-7** Phone normalization default region: tenant country (not stored today per F6)
   vs assume HK (+852) for all tenants.
7. **OQ-8** What does the member timeline show for a partner-created member with `pending`
   consent — and should ops get a weekly "pending consent from partner X" digest?
8. **OQ-9** Retention of job results (24h proposed) and of the delivery log (30 days / 500
   rows proposed) — confirm against storage budget on the shared VM.
9. **OQ-10** Should `member.created` for CSV-imported members fire per row (hundreds of
   webhooks per import) or be suppressed/batched? Default here: fire per row under the
   limiter, but a large import will visibly lag.

(OQ-6 — `business_name_shown` validation — withdrawn: proof fields are no longer collected.)

---

## Revision log

- **2026-09-10 (rev 1)** — Owner decisions applied: OD-1 (configurable template source;
  launch = tenant default only, specific id post-launch), OD-3 (default OFF), OD-6 (per-
  integration HMAC), OD-7, OD-8 final. Consent model replaced: proof fields dropped in
  favour of partner-asserted `consent_level: none | utility | all` written as
  `consent_records` (source `partner_api`, source_reference = integration id); the
  three-level `welcome_delivery` setting replaced by `new_join_template_id`
  (`null` | `'default'` | `<template id>`) gated by template category vs effective level;
  OD-4 and OD-5 removed as subsumed. New labelled defaults OD-13 (grade `strong`) and
  OD-14 (upgrade-only). OD-9/10/11 unchanged; OD-12 reworded to the grade only. OQ-2 and
  OQ-6 rewritten/withdrawn. §5, §6, US-1/3/4/6/8, §8, §9, §10 updated accordingly.
- **2026-09-10 (rev 2)** — Owner's final answers applied. OD-9 final (corrected in the
  same pass): the outbound signing secret is partner-minted and pasted by the owner;
  replacement is immediate, no grace / dual signature / retirement; inbound secret model
  untouched (US-6, US-7, US-9, §8.2, §9). New design principle §5.0: inbound API is
  server-to-server only, partner vets identity + consent (US-1 AC, §9, §11.1 "S2S").
  OD-10 closed: `/api/join/[slug]` hardening out of scope, no task filed.
  OD-11 final = **no**: polling returns only `status` (`queued|processing|succeeded|
  failed`), `member_id`, `outcome` (`created|existing`), `error`; coupon, consent and
  welcome fields removed from US-1/US-2/US-3/US-4, §8.1 and the outbound payload (US-6);
  "only way to print the coupon" rationale removed; OQ-4 withdrawn. OD-12 final: level
  accepted as asserted, no grade field. New labelled default **OD-15**: coupon minted
  only inside a welcome job that actually sends (D2, D4, US-4, §8.3, §10 risk row);
  OD-2 promoted to a listed labelled default. Remaining open: OD-2, OD-13, OD-14, OD-15.
