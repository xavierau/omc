---
id: plans/2026-09-10-int-001-member-creation-api
type: plan
author: solution-architect
created: 2026-09-10
status: active
supersedes: null
superseded_by: null
related: [specs/2026-09-10-int-001-member-creation-api, threats/2026-09-10-int-001-member-creation-api, kanban:INT-001, kanban:WAQ-004, kanban:WAQ-005, kanban:WAQ-009, kanban:WONB-005]
---

# Plan: INT-001 Bidirectional Member-Creation API

Technical plan for spec rev 2 + the CONDITIONAL threat model. Every one of the 13 blocking
threat items (§10) and every non-blocking item maps to a named work item (§Traceability).
Branch `feature/int-001-member-api`, worktree `~/Code/js/whatsapp-crm--int-001-member-api`.

## Assumptions recorded as decided (orchestrator, 2026-09-10 — owner not yet consulted)

| # | Decision | Where it lands |
|---|---|---|
| OD-2 | Endorsed with both amendments: idempotency key = HMAC(INT_JOBID_KEY, integrationId:e164:bodyHash) with 24 h TTL; `outcome: existing` never reactivates an `unsubscribed` member row and never touches its consent beyond the invariant below | WI-2, WI-3 |
| OD-13 | Adopted per security-architect: per-integration `consent_attestation_text` + owner acknowledgement. Present → grade `strong` and the attestation is copied into `consent_text_shown`; absent → grade `weak`. **Code fact the spec got wrong:** the WAQ-004 gate allows any `opted_in` row regardless of grade (`check-marketing-consent.ts` `decideFromRecord`), so `weak` does *not* fail campaign sends today; the only effect of `weak` is that WONB-008 re-confirmation will target those rows. Flagged for the owner | WI-1, WI-3, WI-8, WI-9 |
| OD-14 | Restated as the invariant over the identity (restaurant, phone, category): the **latest** row (by `captured_at`) decides; `opted_out` latest → absorbing on every branch (new or existing member, deleted-and-recreated member). ONE repository function used by all INT-001 paths + a DB trigger for `source='partner_api'` inserts | WI-1, WI-3 |
| OD-15 | Endorsed. Mint inside the welcome job only after every send-time check passes; idempotent on (member_id, welcome campaign_id) via the existing `uniq_coupon_campaign_member` partial index (053); zero coupon rows for every `skipped_*` outcome, asserted by test | WI-4 |
| OQ-2 | Gate checks marketing only → the welcome job owns the category check (D4) for both categories | WI-4 |
| OQ-3 | "Tenant default welcome template" = the approved WhatsApp template behind `campaigns.whatsapp_template_id` of `restaurants.welcome_campaign_id`. Null → `no_default_welcome_template` on save, `skipped_no_template` at send | WI-4, WI-8 |
| OQ-5 | Inbound secret rotation is in scope as a dedicated server-minting endpoint (T-C4 forbids PATCH). Without it T-H1's projection would make a lost secret unrecoverable | WI-0 |
| OQ-7 | Default region `HK`, a named constant `DEFAULT_PHONE_REGION`; `restaurants` has no country column | WI-1 |
| OQ-9 | Job results: partner-readable 24 h (then `410`), row retained ≥ 24 months for audit (T-M1). Delivery log: 30 days / 500 rows per integration, pruned by the sweeper | WI-3, WI-6 |
| OQ-10 | CSV import fires one `member.created` per row under the limiter (threat §9 recommendation) | WI-7 |
| `next` CRITICAL advisory | NOT in this diff. Deploy precondition (§Rollout). Orchestrator files separately | WI-11 lists it |
| T-C4 / T-H1 pre-existing | In scope, fixed first | WI-0 |
| Brief said "zod schema file" | Resolved toward threat §7 + Surgical Changes: the repo has no zod and hand-rolls validators. Contract-first is kept — the first backend WI writes the request/response **types** (`src/application/dtos/integration-member-api.ts`) and the hand-rolled validators against them; the partner doc (WI-11) is generated from the same types | WI-1 |

---

## Objective

Ship a server-to-server, HMAC-v2-authenticated `POST /api/integrations/{integrationId}/members`
that does only verify → validate/normalise → enqueue → `202`, a signed `GET …/members/jobs/{jobId}`
poll, a worker that creates-or-gets the member through the **single** member-creation seam,
records partner-asserted consent under the opted_out-absorbing invariant, optionally enqueues a
consent-gated welcome template send that mints its coupon only when it sends, and an outbound
`member.created` / `member.updated` webhook on a bounded, SSRF-safe, circuit-broken
`integration-outbound` queue with a delivery log, retry, resume and per-integration settings in a
new dashboard Integrations area — while closing T-C4 and T-H1 first.

## Context

**Precedents reused (read these before writing code)**

| Concern | File | What to copy |
|---|---|---|
| Queue plumbing | `src/infrastructure/queue/email-queue.ts` | lazy Queue, `ensureWorkerStarted`/`getWorker`, separate producer (fail-fast) vs worker (`maxRetriesPerRequest: null`) connections, `withTimeout` on `add`, bounded `removeOnComplete`/`removeOnFail` with `age` |
| Permanent vs transient | `src/infrastructure/queue/email-job-processor.ts` | `UnrecoverableError` for permanent, plain `Error` for transient, `handleExhaustedRetries`, `alertDeadLetter` via `notifyOpsAlert` |
| Failure bookkeeping | `src/infrastructure/queue/campaign-queue.ts`, `event-dispatch-queue.ts` | `handleFailedJob` shape, dynamic import inside worker |
| Worker registration | `scripts/start-worker.ts` | `startAll()` + `activeWorkers()` — the prod worker daemon runs `npx tsx scripts/start-worker.ts` under Forge supervisor; `deploy.sh` restarts it |
| Inbound auth (to be extended, not copied) | `src/app/api/integrations/[integrationId]/verify-signature.ts` | `timingSafeEqual` + length pre-check; everything else changes (T-H2, T-M12) |
| Rate limit (do NOT copy) | `src/lib/rate-limit.ts`, `src/infrastructure/rate-limit/rate-limiter.ts` | both in-process Maps, charged before auth in the POS route — the anti-pattern (T-H5) |
| Result type | `src/domain/value-objects/send-result.ts` (`SendResult { ok, kapsoMessageId, raw, error?: {title, details?} }`) + `email-send-result.ts` | The outbound delivery result mirrors this shape exactly (`ok`, `error: {title, details?}`); classification is a pure function like `isPermanentFailure` |
| Member creation (three inserts, no seam) | `src/application/register-member.ts`, `register-member-web.ts`, `import-contacts-batch-row-member.ts` | All three route through the new seam in WI-7. Dead fourth insert `import-members-with-consent.ts` — see WI-7 |
| Consent sole writer | `src/infrastructure/supabase/repositories/consent-record-repository.ts` | New `applyPartnerAssertedConsent` lives here; `findActiveConsent` deliberately excludes `opted_out` — the new lookup must not |
| Consent schema | `supabase/migrations/038_consent_records.sql`, `047_consent_records_v2.sql` | `idx_consent_active_uniq` is partial on `('opted_in','pending')`; `consent_text_shown`, `proof_url`, `granted_at` exist |
| Integration schema | `020_pos_integrations.sql`, `024` | `pos_integrations(webhook_secret NOT NULL, credentials JSONB)`; `mapRow` returns both (T-H1) |
| Tenant guard | `src/infrastructure/supabase/guards/tenant-guard.ts` | returns `role` (`admin` \| `staff` — `user_tenants.role` CHECK, 011) but no route reads it (T-M5) |
| Template resolution | `src/application/resolve-whatsapp-template.ts`, `whatsapp-template-repository.findByIdForRestaurant` | scoped-by-tenant lookup + `isTemplateSendable` (`status === 'approved'`); `TemplateCategory = 'MARKETING' \| 'UTILITY'` |
| Template send + tracking | `src/application/send-template-message.ts`, `record-outbound-send.ts`, `execute-campaign-send.ts` | `recordOutboundSend({... send: () => sendWhatsAppTemplateMessage(...)})` |
| Quality pause | `tenant-trust-queries.isTenantAutoPaused` | re-checked inside the welcome job |
| Coupon mint | `coupon-factory.createCampaignCoupon` / `createWelcomeCoupon`; `053_coupon_claim_unique.sql` | `uniq_coupon_campaign_member` on `(campaign_id, member_id) WHERE type='promo'` — the OD-15 idempotency anchor |
| Onboarding settings | `restaurant-onboarding-repository.ts` | `welcomeCampaignId`, `defaultLanguage` (`en` \| `zh_hk`) |
| Slack | `src/application/notify-ops-alert.ts` (`kind: 'engineering_alert'` → platform channel) | dead-letter alerts |
| Validators style | `src/infrastructure/validation/validators.ts` | hand-rolled, no zod |
| Route tests | `src/app/api/dashboard/members/[id]/__tests__/route.test.ts` | vitest, mocked repositories, `NextRequest` |
| i18n | `src/messages/en.json`, `zh-HK.json` (namespaces `nav`, `settings`, …) via next-intl | new namespace `integrations` + `nav.integrations` |
| Sidebar | `src/components/dashboard/sidebar.tsx` (items array, lines 57–70) | add `/dashboard/integrations` |
| Migrations | `supabase/migrations/068_upsert_tags_by_name.sql` is the latest → this feature is **069–072**. `deploy.sh` runs `supabase db push`. Scratch-DB validation per memory `project_validate_migrations_on_scratch_db` |
| Cron | `scripts/cron/*.sh` → `/api/cron/*` via Forge Scheduled Jobs | **Not used here** — the sweeper is a BullMQ job scheduler inside the worker process (no Forge change; avoids `principle_documented_env_var_is_not_a_scheduled_job`) |

**Constraints (binding)**
- Kanban INT-001 CONSTRAINT paragraph (a)–(d): request handler does only verify/validate/enqueue; per-integration limits; dedicated bounded outbound queue with breaker; workers in the daemon; polling contract documented.
- Clean-architecture layering: `domain` (zero external deps) ← `application` ← `infrastructure`/routes. `libphonenumber-js` and Node builtins live in infrastructure behind domain ports.
- Surgical Changes in existing files; new files ≤150 lines / functions ≤20 lines.
- No new runtime dependency except `libphonenumber-js` (exact pin, `max` build) and listing `ioredis` explicitly at the version bullmq already resolves (no lockfile addition). Dev-only: `fast-check` (exact pin) for property tests — run `supply-chain-guard` on both in WI-1.

**Dependencies**: Redis with a password in prod (`REDIS_URL` — verify, WI-11); Node 22 global `fetch`/undici; Forge worker daemon restart on deploy (already in `deploy.sh`).

---

## Architecture

### Layering and the single seam

```
routes (Next.js)            src/app/api/integrations/[integrationId]/members/*, dashboard/pos-integrations/[id]/*
   │ verify → validate → enqueue (POST) / read job (GET)
application                 create-or-get-member (THE SEAM) · apply-partner-consent · process-member-create-job
                            · process-welcome-send-job · emit-integration-event · deliver-outbound-webhook
                            · integration settings use cases · sweep-integration-queues
   │ ports: RateLimiterPort · OutboundWebhookSender · IntegrationEventPublisher · Clock · PhoneNormalizer
domain                      E164Phone · ConsentLevel · partner-consent-policy · ip-range · webhook-signature
                            · IntegrationSettings · MemberJob · IntegrationDelivery entities
infrastructure              supabase repositories (member-create-repository = sole `members` insert) ·
                            redis-rate-limiter · undici outbound sender + ssrf-guard · secret-box (AES-GCM) ·
                            queue/integration-inbound-* · queue/integration-outbound-* · e164-parser
```

**The seam.** `createOrGetMember(input)` in `src/application/create-or-get-member.ts` is the only
application entry that creates a member. It calls `insertMember()` in
`src/infrastructure/supabase/repositories/member-create-repository.ts` — the only
`.from('members').insert(` in `src/` (boundary test, WI-7). `23505` on
`idx_members_restaurant_phone` → re-select → `{ outcome: 'existing' }`; never an error. After a
`created` outcome it publishes `member.created` through `IntegrationEventPublisher`. Each legacy
caller keeps its own post-create behaviour (WhatsApp welcome, web coupon, import consent).

```
createOrGetMember({ restaurantId, phoneE164 /* E164Phone */, name, preferredLanguage, source,
                    originIntegrationId?, externalRef? })
  → { outcome: 'created' | 'existing', memberId, status: 'active' | 'unsubscribed' }
```

### Queues

| Queue | Jobs | Worker concurrency | Limiter | attempts / backoff | removeOnComplete | removeOnFail | Payload |
|---|---|---|---|---|---|---|---|
| `integration-inbound` | `member-create` (jobId = idempotent id), `welcome-send` (jobId = `wel:` + memberId + `:` + createJobId) | `INT001_INBOUND_CONCURRENCY` default **4** | `{ max: 50, duration: 1000 }` | member-create **3**, exp 2000 ms; welcome-send **3**, exp 5000 ms | `{ count: 500, age: 3600 }` | `{ count: 1000, age: 7d }` | ids + validated fields only for member-create (phone E.164, name, level, flags — this IS the request, ≤ 3 KB); welcome-send `{ memberId, restaurantId, integrationId, createJobId }` |
| `integration-outbound` | `deliver` (jobId = deliveryId, retries `deliveryId:r1`), `sweep` (job scheduler, every 30 s relay / 5 min maintenance) | `INT001_OUTBOUND_CONCURRENCY` default **2**, hard max 4 | `{ max: 20, duration: 1000 }` + per-destination-host Redis budget 10 req/s (exhausted → `job.moveToDelayed(+1000)` + `DelayedError`) | **5**, exp 3000 ms (3 s, 6, 12, 24, 48) | `{ count: 200, age: 3600 }` | `{ count: 1000, age: 7d }` | `{ deliveryId }` only (T-H7) |

Producer connections fail fast (`enableOfflineQueue: false`, `maxRetriesPerRequest: 1`,
`connectTimeout: 5000`) and `add` is wrapped in a 3 s timeout → route returns
`503 { error: "queue_unavailable" }`; never a synchronous fallback. Redis connection options
are built once in `src/infrastructure/redis/connection.ts` (new code; existing queues keep their
copies — surgical).

Global ceiling (T-M7): `getWaitingCount() + getDelayedCount()` on `integration-inbound`, cached
1 s in-process; ≥ `INT001_GLOBAL_QUEUE_CEILING` (default 5000) → `503 queue_depth_exceeded`.

### Inbound auth v2 (T-H2, T-M12, T-L3, T-H5)

Headers: `X-OMC-Timestamp` (unix seconds), `X-OMC-Nonce` (16–64 chars `[A-Za-z0-9_-]`),
`X-OMC-Signature: v2=<64 hex>` (exactly one param, strict parse).

```
POST base = "v2:member.create:" + integrationId + ":" + t + ":" + nonce + ":" + sha256hex(rawBody)
GET  base = "v2:member.job:"    + integrationId + ":" + t + ":" + nonce + ":" + jobId
sig  = HMAC-SHA256(pos_integrations.webhook_secret, base)
```

Order in `verify-signature-v2.ts` (new file; legacy `verify-signature.ts` untouched):
1. Strict header parse; malformed → `401` body `{ "error": "unauthorized" }` (byte-identical everywhere below).
2. Load integration by id **regardless of status**; unknown → verify against a process-constant dummy secret (constant time) → `401`.
3. `|now − t| > 300 s` → `401`. Charge auth-failure bucket `int001:rlf:{integrationId}:{ip}` (10/min fixed window) on every failure in 1–4; when exhausted → `429` without touching the partner bucket.
4. `timingSafeEqual` on the HMAC; mismatch → `401`.
5. `status !== 'active'` → `403 { "error": "integration_inactive" }`.
6. Kill switch `INT001_DISABLE_INBOUND=1` → `503 { "error": "feature_disabled" }`.
7. Partner token bucket `int001:rl:{integrationId}` (Lua, capacity `inbound_burst` default 20, refill `inbound_rate_per_min` default 60) — charged only here. Exceeded → `429` + `Retry-After` + `X-RateLimit-Remaining`.
8. Replay: `SET int001:replay:{integrationId}:{nonce} <jobId> NX EX 600`. Hit → return the cached `202` for that nonce (retry-safe, no re-enqueue); if the cached jobId's record is gone → `401`.
9. Body → size (`413` > 16 KB, measured on raw bytes), content-type (`415`), validate/normalise (`422`), then depth cap, then enqueue.

### Job id + idempotency (T-H3a/b, T-H4)

```
canonicalBody = JSON.stringify(sortKeysDeep({ phone: e164, consent_level, name, external_ref, language, send_welcome, metadata }))
bodyHash      = sha256hex(canonicalBody)
jobId         = "mj_" + base32(HMAC-SHA256(INT_JOBID_KEY, integrationId + ":" + e164 + ":" + bodyHash)).slice(0, 32)
```
`int001:idem:{jobId}` → `{ jobId }` EX 86400. Same body within 24 h → same `202`, no second job.
Different body (e.g. level upgrade) → new job. `integration_member_jobs` row is written by the
route (status `queued`) **before** `q.add` (this is not a `members` write); poll reads Postgres
scoped by `(job_id, integration_id)` — foreign or unknown → `404 { "error": "not_found" }`
byte-identical; `result_expires_at < now` → `410`.

### Per-integration queue-depth cap

`int001:depth:{integrationId}` INCR before `q.add` (DECR on add failure); DECR in the processor
`finally` when the job is terminal (success, `UnrecoverableError`, or `attemptsMade + 1 >= attempts`).
≥ `inbound_queue_cap` (default 500) → `503 { "error": "queue_depth_exceeded" }` + `Retry-After`.
The 5-min sweeper re-derives every counter from `integration_member_jobs WHERE status IN ('queued','processing')`
(a counter is a cache, the table is truth).

### Member-create job (worker)

1. Load integration + settings; `status !== 'active'` → permanent `integration_paused`; tenant inactive → `tenant_inactive`.
2. `createOrGetMember(...)` (seam) with `source: 'partner_api'`, `originIntegrationId`.
3. `applyPartnerAssertedConsent` for `utility` and `marketing` (one call each; §Consent invariant). Grade + `consent_text_shown` from OD-13.
4. Upsert `integration_member_refs(member_id, integration_id, external_ref)`.
5. `created` → `emitEvent({ type: 'join', dataJson: { source: 'partner_api', integration_id }, source: 'pos:' + integrationId })` (no `coupon_code` — OD-15).
6. Welcome decision (D3–D5, T-H8): `existing` → `skipped_existing`; `send_welcome:false` → `skipped_by_request`; `new_join_template_id null` → `skipped_off`; member `unsubscribed` or category latest `opted_out` → `skipped_opted_out`; resolved template missing/not approved/foreign → `skipped_no_template`; category not permitted by effective level → `skipped_consent_level {required_level, effective_level}`; tenant auto-paused → `skipped_quality_paused`; per-tenant hourly cap `int001:welcome:{restaurantId}:{yyyymmddhh}` ≥ `INT001_WELCOME_HOURLY_CAP` (60) → `skipped_rate_capped`; else enqueue `welcome-send` → `queued`.
7. Update the job row: status, outcome, member_id, consent_actions, welcome_outcome/detail, completed_at, `result_expires_at = now + 24 h`.
Permanent (`UnrecoverableError`): validation (should not happen — edge rejects), `tenant_inactive`, `integration_paused`. Transient: DB/Redis errors. Exhausted → job row `failed { code: 'internal' }` + engineering alert.

### Welcome-send job (OD-15, T-M11, T-H8)

Re-run at send time, in order: member still `active`; template re-resolved **scoped to the tenant** and `approved`; category vs effective level from **latest** consent rows; `isTenantAutoPaused`; hourly cap. Any failure → job row `welcome_outcome = skipped_*`, no mint, job completes. Then mint idempotently: welcome campaign present → `createCampaignCoupon` and on `23505` (`uniq_coupon_campaign_member`) re-select by `(campaign_id, member_id)`; no campaign → select existing `type='welcome'` coupon for the member before `createWelcomeCoupon`. Then `recordOutboundSend({ category: template.category.toLowerCase(), messageType: 'template', campaignId: welcomeCampaign?.id ?? null, contentPreview: '[welcome_partner_api] …', send: () => sendWhatsAppTemplateMessage({ couponCode }) })`. `whatsapp_messages` has no `source` column and is a shared hot-path table — the discriminator is the `contentPreview` prefix plus `integration_member_jobs.welcome_detail.whatsapp_message_id` (deviation from US-4's literal `source:` field, flagged). Send failure → transient (retry ≤ 3, re-running the checks; the coupon is already idempotent); exhausted → `welcome_outcome = failed`, create job unaffected.

### Outbound (T-C3, T-H7, T-M4, T-M8, US-6, US-9)

**Emit.** `emitIntegrationEvent({ restaurantId, memberId, type, changed, originIntegrationId })` inserts
`integration_events`; the DB trigger fans out one `integration_deliveries` row per integration with
`outbound_enabled`, `outbound_url`, `outbound_pii_ack_at`, and the type in `outbound_events`
(status `queued`, or `paused` when `outbound_status != 'active'`). The app then enqueues each
`queued` delivery (`jobId = deliveryId`) and stamps `enqueued_at`. `member.created` is emitted by the
seam (fast path). `member.updated` is produced entirely by DB triggers on `members`
(`UPDATE OF name, preferred_language, status`), `consent_records` (`INSERT`, `UPDATE OF status`) and
`integration_member_refs` — coalesced per `(member_id, 5-second bucket)` with `changed` unioned — and
enqueued by the 30 s relay. The relay selects `status='queued' AND enqueued_at IS NULL AND created_at < now() - 5 s`
(the fast path stamps `enqueued_at`, so the backstop's WHERE clause is exactly the set the fast path
missed — `principle_backstop_only_repairs_what_it_selects`).

**Attempt** (`deliverOutboundWebhook(deliveryId)` — the only code allowed to fetch a user URL):
1. Load delivery + integration settings; `INT001_DISABLE_OUTBOUND=1` or `outbound_status != 'active'` → mark `paused`, complete without throwing.
2. Materialise payload from Postgres now (member, latest consent per category, refs) — never from the job (T-H7).
3. `assertSafeUrl(url)` (https, port 443 only, no userinfo, name blocklist) → `resolveAndPin(host)` (all A/AAAA public per the CIDR list in threat §3-E; IPv4-mapped v6 checked as v4) → dispatch with an undici `Agent` whose `connect.lookup` returns the pinned IP, `servername` = host, `redirect: 'manual'`, 5 s `AbortSignal.timeout`, no env proxy (`HTTP_PROXY`/`HTTPS_PROXY` ignored by using an explicit dispatcher).
4. Sign at attempt time with the **decrypted current** secret: `X-OMC-Signature: t=<unix>,v1=<hex HMAC-SHA256(secret, t + "." + body)>`, `X-OMC-Event-Id`, `X-OMC-Delivery-Attempt`, `X-OMC-Event-Type`, `Content-Type: application/json`, `User-Agent: OhMyClient-Webhooks/1`.
5. Classify (`classifyDeliveryOutcome`, pure): 2xx → `delivered`, streak reset. 3xx, 4xx except 408/429, SSRF rejection, invalid URL, signature/secret missing → permanent → `UnrecoverableError` → `dead_lettered` + Slack (event id, integration name, HTTP code only — T-L4). 5xx/408/429/timeout/DNS/ECONNRESET → transient → streak +1 → plain `Error` (429 honours `Retry-After` via `moveToDelayed`). Streak ≥ 10 → `outbound_status = 'paused_auto'`, `outbound_paused_at`, Slack, dashboard banner.
6. Log row: status, attempts, HTTP code, latency, response excerpt ≤ 512 chars, `next_retry_at`. Never the request payload.

**Retry / resume.** Retry = `retried_at IS NULL` → set + enqueue `deliveryId:r1` with fresh attempts; second call `409`. Resume = `outbound_status = 'active'`, streak 0; the relay re-enqueues `paused` rows (`enqueued_at` cleared) up to `inbound_queue_cap`; beyond → `dead_lettered`. Test event = `integration_events(type='ping', member_id null)` through the identical path against the **saved** URL only.

**Sweeper** (`sweep` job scheduler, in the outbound worker): every 30 s relay; every 5 min: depth-counter rebuild, delivery-log pruning (> 30 days or beyond newest 500 per integration), `integration_events` orphans > 30 days, T-M2 anomaly check (per integration, last hour `existing`/`created` and volume vs 7-day hourly baseline; > 3× → `engineering_alert`).

### Dashboard read projection (T-H1, T-C4, T-M5)

`toPublicIntegration()` — `{ id, name, provider, status, createdAt, updatedAt, webhookUrl, inboundSecretLast4,
inboundSecretUpdatedAt, settings: { newJoinTemplateId, resolvedTemplate: {name, category} | null,
consentAttestationText, consentAttestationAckAt, outboundUrl, outboundEvents, outboundEnabled,
outboundPiiAckAt, outboundStatus, outboundFailureStreak, outboundPausedAt, outboundSecretLast4,
outboundSecretUpdatedAt, outboundSecretUpdatedBy } }` — used by every dashboard read; a test asserts
`Object.keys` equality against this allowlist so a new field fails the test. `webhookSecret`,
`credentials`, `outbound_secret_enc` never cross a route. Every INT-001 dashboard mutation:
`getTenantContext()` → `role === 'admin'` else `403` → integration loaded by
`findByIdForRestaurant(id, restaurantId)` (scoped query, #111 lesson) → explicit per-field validated
use case → audit row.

### Consent invariant (T-C1, OD-14) — one function, all paths

`applyPartnerAssertedConsent({ restaurantId, phoneE164, memberId, category, assertedLevel, integrationId, grade, consentText, businessNameShown })`
in `consent-record-repository.ts` (sole-writer file):
1. `findLatestByCategory` — **all statuses**, `ORDER BY captured_at DESC LIMIT 1`.
2. Decision (pure, `src/domain/services/partner-consent-policy.ts`): latest `opted_out` → `blocked_opted_out` (write nothing); no row → `inserted` at the asserted status (`opted_in` if level covers the category, else `pending`); latest `pending` and level covers → `upgraded` (`upgradeToOptedIn`, fresh `granted_at`); latest `pending` and level does not cover, or latest `opted_in` → `noop`.
3. Never calls `insertConsentRecord` for a category whose latest row is `opted_out`. DB belt-and-braces: migration 072 trigger raises `consent_opted_out_absorbing` on any `source='partner_api'` insert over an `opted_out`-latest identity (scoped to `partner_api` so the member's own WhatsApp re-opt-in path keeps working).
Effective level = `all` if both latest rows `opted_in`, `utility` if only utility, else `none`.

### Ports with fake + real adapters → shared contract suites

| Port (domain) | Fake (test-utils) | Real (infrastructure) | Contract suite (runs against both) |
|---|---|---|---|
| `RateLimiterPort { takeToken(key, {ratePerMin, burst}) → {allowed, remaining, retryAfterSec}; incrWindow(key, limit, windowSec) → {allowed, count}; incr/decr(key); get(key) }` | `FakeRateLimiter` with injected `Clock` | `RedisRateLimiter` (ioredis, Lua token bucket, atomic) | `src/infrastructure/rate-limit/__tests__/rate-limiter.contract.ts` — fake always; Redis when `INT001_TEST_REDIS_URL` is set (integration lane) |
| `OutboundWebhookSender { send(req: {url, body, headers, pinnedIp?}) → DeliveryResult }` where `DeliveryResult = { ok: boolean; status: number \| null; latencyMs: number; responseExcerpt: string \| null; error?: {title, details?} }` (SendResult shape) | `FakeOutboundSender` (scripted responses, records requests) | `UndiciOutboundSender` with injected `resolver` + `guard` | `src/infrastructure/http/__tests__/outbound-sender.contract.ts` — fake always; real against a `node:http` server on 127.0.0.1 using `createLoopbackTestGuard()` from `src/test-utils` (never exported from `src/infrastructure`); the rebinding test uses the **real** guard with a stubbed resolver |
| `Clock { now(): Date }` / `NonceSource { next(): string }` | `FakeClock`, `SequenceNonce` | `SystemClock`, `crypto.randomUUID` | `src/domain/__tests__/clock-nonce.contract.ts` (monotonic, format) |
| `IntegrationEventPublisher { publish(event) }` | `RecordingPublisher` | `emitIntegrationEvent` adapter | `src/application/__tests__/integration-event-publisher.contract.ts` (one row per subscribed integration, none for unsubscribed/disabled/unacknowledged) — real against the scratch DB lane |
| `PhoneNormalizer { parse(raw, region) → E164Phone \| {error} }` | — (pure, tested directly) | `libphonenumber-js/max` wrapper | property test in WI-1 |

---

## Domain Model

| Type | Kind | Fields / behaviour |
|---|---|---|
| `E164Phone` | VO | `of(value)` asserts `^\+[1-9]\d{7,14}$`; `value`; `last4`. Only value that reaches idempotency, member lookup, consent, payloads |
| `ConsentLevel` | VO | `'none' \| 'utility' \| 'all'`; `requiredLevelFor(category)` (UTILITY → utility, MARKETING → all); `permits(level, category)`; `effectiveLevel(utilityStatus, marketingStatus)`; `covers(level, category)` |
| `PartnerConsentAction` | VO | `inserted \| upgraded \| noop \| blocked_opted_out` + `decidePartnerConsentAction(latestRow, level, category)` pure |
| `IntegrationSettings` | entity | 1:1 with `pos_integrations`; invariants: `outbound_enabled` requires `outbound_url` + `outbound_pii_ack_at` + secret; `new_join_template_id` ∈ `null \| 'default' \| uuid` |
| `MemberJob` | entity | id, integrationId, restaurantId, status (`queued→processing→succeeded\|failed`), outcome, memberId, error, assertedLevel, consentActions, welcomeOutcome + detail, timestamps, `resultExpiresAt`; `partnerView()` returns only OD-11 fields |
| `IntegrationEvent` | entity | id (`evt_` + uuid), type `member.created \| member.updated \| ping`, memberId, changed[], originIntegrationId, occurredAt |
| `IntegrationDelivery` | entity | id, integrationId, eventId, status (`queued \| delivering \| retrying \| delivered \| dead_lettered \| paused \| skipped`), attempts, lastHttpStatus, lastErrorCode, lastLatencyMs, responseExcerpt, nextRetryAt, enqueuedAt, retriedAt; transitions enforced in the entity |
| `WebhookSignature` | domain service | `signOutbound(secret, t, body)`, `buildInboundBase(kind, integrationId, t, nonce, digest)`, `parseSignatureHeader` (strict) |
| `IpRange` | domain service | pure CIDR containment over the blocklist (v4 + v6 + v4-mapped) |
| `DeliveryOutcome` | domain service | `classifyDeliveryOutcome(result) → 'delivered' \| 'permanent' \| 'transient'` |

Aggregates: `pos_integrations` + `integration_settings` (one aggregate, integration id root);
`MemberJob` (root, own table); `IntegrationEvent` → `IntegrationDelivery[]` (event root, deliveries children).
Consent identity stays (restaurant, phone, category) per 038.

---

## Data Model — migrations 069–072 (scratch-DB validated, rolled-back txn, WI-1)

**069_integration_settings.sql**
- `integration_settings(integration_id UUID PK REFERENCES pos_integrations ON DELETE CASCADE, restaurant_id UUID NOT NULL REFERENCES restaurants, new_join_template_id TEXT CHECK (new_join_template_id IS NULL OR new_join_template_id = 'default' OR new_join_template_id ~ '^[0-9a-f-]{36}$'), consent_attestation_text TEXT, consent_attestation_ack_at TIMESTAMPTZ, consent_attestation_ack_by UUID, outbound_url TEXT, outbound_secret_enc TEXT, outbound_secret_last4 TEXT, outbound_secret_updated_at TIMESTAMPTZ, outbound_secret_updated_by UUID, outbound_events TEXT[] NOT NULL DEFAULT '{member.created}', outbound_enabled BOOLEAN NOT NULL DEFAULT false, outbound_pii_ack_at TIMESTAMPTZ, outbound_pii_ack_by UUID, outbound_status TEXT NOT NULL DEFAULT 'active' CHECK (outbound_status IN ('active','paused_auto','paused_manual')), outbound_failure_streak INT NOT NULL DEFAULT 0, outbound_paused_at TIMESTAMPTZ, inbound_rate_per_min INT, inbound_burst INT, inbound_queue_cap INT, inbound_secret_updated_at TIMESTAMPTZ, created_at, updated_at)` + `updated_at` trigger. RLS enabled, **service_role policy only** (no tenant SELECT — the row carries the encrypted secret; dashboards read through the projection).
- `integration_settings_audit(id UUID PK, integration_id, restaurant_id, actor_user_id UUID, field TEXT, old_value TEXT, new_value TEXT, created_at)` — secrets logged as `last4` only. Index `(integration_id, created_at DESC)`. RLS service-only.
- Backfill: one `integration_settings` row per existing `pos_integrations` row (all defaults → OD-3 `null`).

**070_integration_member_jobs.sql**
- `integration_member_jobs(job_id TEXT PK, integration_id UUID NOT NULL REFERENCES pos_integrations ON DELETE CASCADE, restaurant_id UUID NOT NULL, status TEXT NOT NULL CHECK (status IN ('queued','processing','succeeded','failed')), outcome TEXT CHECK (outcome IN ('created','existing')), member_id UUID REFERENCES members ON DELETE SET NULL, error_code TEXT, error_message TEXT, attempts INT NOT NULL DEFAULT 0, asserted_level TEXT NOT NULL CHECK (asserted_level IN ('none','utility','all')), send_welcome BOOLEAN NOT NULL DEFAULT true, consent_actions JSONB, welcome_outcome TEXT, welcome_detail JSONB, metadata JSONB, external_ref TEXT, phone_last4 TEXT, submitted_at TIMESTAMPTZ NOT NULL DEFAULT now(), started_at, completed_at, result_expires_at TIMESTAMPTZ)`. No full phone on the row (T-M1: audit needs the action, not the PII; the member row holds the phone). Indexes `(integration_id, submitted_at DESC)`, `(restaurant_id, submitted_at DESC)`, `(status) WHERE status IN ('queued','processing')`. RLS service-only.
- `integration_member_refs(member_id UUID REFERENCES members ON DELETE CASCADE, integration_id UUID REFERENCES pos_integrations ON DELETE CASCADE, external_ref TEXT NOT NULL, created_at, updated_at, PRIMARY KEY (member_id, integration_id))`, index `(integration_id, external_ref)`. RLS service-only.

**071_integration_outbound.sql**
- `integration_events(id TEXT PK, restaurant_id UUID NOT NULL, member_id UUID REFERENCES members ON DELETE CASCADE, type TEXT NOT NULL CHECK (type IN ('member.created','member.updated','ping')), changed TEXT[] NOT NULL DEFAULT '{}', source TEXT, origin_integration_id UUID, coalesce_bucket BIGINT, occurred_at TIMESTAMPTZ NOT NULL DEFAULT now(), created_at)`; unique `(member_id, type, coalesce_bucket) WHERE type = 'member.updated'`.
- `integration_deliveries(id UUID PK DEFAULT gen_random_uuid(), integration_id UUID NOT NULL REFERENCES pos_integrations ON DELETE CASCADE, restaurant_id UUID NOT NULL, event_id TEXT NOT NULL REFERENCES integration_events ON DELETE CASCADE, status TEXT NOT NULL CHECK (status IN ('queued','delivering','retrying','delivered','dead_lettered','paused','skipped')), attempts INT NOT NULL DEFAULT 0, last_http_status INT, last_error_code TEXT, last_response_excerpt TEXT CHECK (char_length(last_response_excerpt) <= 512), last_latency_ms INT, next_retry_at, enqueued_at, delivered_at, dead_lettered_at, retried_at, created_at, updated_at, UNIQUE (integration_id, event_id))`; indexes `(integration_id, created_at DESC)`, `(status, created_at) WHERE status IN ('queued','paused')`.
- Trigger `integration_events_fanout` AFTER INSERT ON integration_events → INSERT deliveries for every `integration_settings` row of the restaurant with `outbound_enabled AND outbound_url IS NOT NULL AND outbound_pii_ack_at IS NOT NULL AND NEW.type = ANY(outbound_events)` (`ping` always allowed when a URL is saved), status = `queued` if `outbound_status = 'active'` else `paused`.
- Trigger functions `member_updated_outbox()` on `members AFTER UPDATE OF name, preferred_language, status`, `consent_changed_outbox()` on `consent_records AFTER INSERT OR UPDATE OF status` (member resolved via `(restaurant_id, phone)` → `members`), `member_ref_outbox()` on `integration_member_refs AFTER INSERT OR UPDATE OF external_ref` — each upserts `integration_events(type='member.updated', coalesce_bucket = floor(extract(epoch from now())/5))` with `changed = array_union` on conflict. Never fires for `points_balance`, `last_visit_at`, `pmm_throttled_until`, `unreachable_at` (column-list triggers).
- RLS service-only on both tables.

**072_consent_partner_guard.sql**
- BEFORE INSERT trigger on `consent_records` WHEN `NEW.source = 'partner_api'`: if the latest row for `(restaurant_id, phone_e164, category)` has `status = 'opted_out'` → `RAISE EXCEPTION 'consent_opted_out_absorbing'`. Decision recorded: keep `idx_consent_active_uniq` partial (widening it would break the member's own re-opt-in after STOP); the invariant is owned by the repository function + this scoped trigger + the acceptance suite.

No change to `events_type_check` (no new `events.type`); no change to `whatsapp_messages`; no change to `pos_integrations` columns.
Migration-number collision risk with `develop` (WONB-008 in progress) — flagged in Risks.

---

## API Contracts (types in `src/application/dtos/integration-member-api.ts`, WI-1; partner doc WI-11)

**POST `/api/integrations/{integrationId}/members`** — headers above; body ≤ 16 KB JSON:
```
{ phone: string (required), consent_level: "none"|"utility"|"all" (required),
  name?: string (≤80 code points after control-char strip + whitespace collapse; reject, never truncate),
  external_ref?: string (≤128), language?: "en"|"zh-HK" (default tenant default_language → stored as en|zh_hk),
  send_welcome?: boolean (default true), metadata?: object (≤2 KB serialised, depth ≤3, JSON object only) }
202 { job_id, status: "queued"|"processing", poll_url }
401 { error: "unauthorized" } · 403 { error: "integration_inactive" } · 413 { error: "payload_too_large" } · 415 { error: "unsupported_media_type" }
422 { error: "validation", fields: [{ field, code }] }  codes: required | invalid_type | invalid_e164 | invalid_enum | too_long | too_deep | not_object   (never echoes the value)
429 { error: "rate_limited" } + Retry-After, X-RateLimit-Remaining · 503 { error: "queue_depth_exceeded" | "queue_unavailable" | "feature_disabled" } + Retry-After
```
No `Access-Control-Allow-*` headers; no OPTIONS handler; no session lookup.

**GET `/api/integrations/{integrationId}/members/jobs/{jobId}`** — signed, empty body:
```
200 { status: "queued"|"processing", submitted_at, attempts }
200 { status: "succeeded", member_id, outcome: "created"|"existing" }
200 { status: "failed", error: { code: "validation"|"tenant_inactive"|"integration_paused"|"internal", message } }
401 · 404 { error: "not_found" } (unknown or foreign, byte-identical) · 410 { error: "result_expired" } · 429
```

**Outbound payloads** (`api_version: "2026-09-01"`, ≤ 8 KB):
```
member.created: { id: "evt_…", type, occurred_at, api_version, restaurant_id, integration_id, origin_integration_id: string|null,
  data: { member_id, phone_e164, name, language: "en"|"zh-HK", source: "whatsapp"|"web"|"csv_import"|"partner_api",
          external_ref: string|null, created_at,
          consent: { effective_level, utility: "opted_in"|"pending"|"opted_out"|"none", marketing: …, grade: "strong"|"weak"|"medium"|"none"|null } } }
member.updated: same envelope, data adds changed: ["name"|"language"|"status"|"consent"|"external_ref"...], status: "active"|"unsubscribed"
ping: { id, type: "ping", occurred_at, api_version, restaurant_id, integration_id, data: {} }
```
`origin_integration_id` is additive to the spec payload (lets a partner ignore its own echo — flagged).
Signing: `X-OMC-Signature: t=<unix>,v1=<hex>` over `t + "." + body`; `X-OMC-Event-Id`, `X-OMC-Event-Type`, `X-OMC-Delivery-Attempt`. Partner verifies with the secret it minted; rejects `|now − t| > 300 s`.

**Dashboard (session + `role === 'admin'`, all scoped by restaurant; bodies validated per field)**
- `GET /api/dashboard/pos-integrations` and `/[id]` → projection only (WI-0).
- `PATCH /api/dashboard/pos-integrations/[id]` → allowlist `{ name?, status?, fieldMapping?, credentials? }` — every other key `400 { error: "unknown_field", field }` (WI-0).
- `POST /api/dashboard/pos-integrations/[id]/rotate-inbound-secret` → `200 { webhookSecret }` shown once; audit row (WI-0).
- `GET/PATCH /api/dashboard/pos-integrations/[id]/settings` → `{ newJoinTemplateId?, consentAttestationText?, consentAttestationAck?, outboundUrl?, outboundEvents?, outboundEnabled?, outboundPiiAck? }`; `PATCH` returns the projection + `resolvedTemplate {name, category}` + `warnings: ["tenant_quality_paused"]`; errors `422 { error: "template_not_found"|"template_not_approved"|"template_not_owned"|"no_default_welcome_template"|"url_not_https"|"url_private_address"|"url_invalid"|"url_port"|"url_userinfo"|"pii_ack_required" }` (WI-8).
- `PUT …/[id]/outbound-secret` `{ secret }` (≥16 chars) → `200 { last4, updatedAt }`; `422 { error: "secret_too_short" }` (WI-8).
- `GET …/[id]/deliveries?status=&cursor=` → `{ data: IntegrationDelivery[] (≤500 / 30 d), nextCursor }`; `POST …/deliveries/[deliveryId]/retry` → `202` | `409 { error: "already_retried" }`; `POST …/[id]/outbound/resume` → `200 { requeued }` | `422 { error: "url_invalid" }`; `POST …/[id]/outbound/test` → `202 { deliveryId }` | `422 { error: "url_not_saved" }` (WI-8).
- `GET …/[id]/activity?cursor=` → member jobs (owner view: outcome, asserted level, consent actions, welcome outcome/detail, phone last4, submitted_at) (WI-8).
- `PATCH /api/admin/integrations/[id]/limits` (platform admin) `{ inboundRatePerMin?, inboundBurst?, inboundQueueCap? }` (WI-2).

---

## Subtasks (ordered; each = ONE dev dispatch; frozen failing acceptance suite is the dev's first act)

### WI-0 — Pre-existing vulns first: PATCH allowlist, read projection, role gate, inbound-secret rotation — `senior-backend-dev`
- **Closes**: T-C4, T-H1, T-M5 (role gate on the existing integration routes), OQ-5. Spec: US-7/US-9 preconditions.
- **Files**: modify `src/app/api/dashboard/pos-integrations/route.ts`, `[id]/route.ts`, `src/application/configure-pos-integration.ts`; new `src/application/dtos/public-integration.ts` (`toPublicIntegration`), `src/infrastructure/validation/integration-validators.ts` (`parseIntegrationPatch` allowlist), `src/app/api/dashboard/pos-integrations/[id]/rotate-inbound-secret/route.ts`, `src/infrastructure/supabase/repositories/pos-integration-repository.ts` (+ `findPosIntegrationByIdForRestaurant(id, restaurantId)` scoped query — surgical addition), `src/infrastructure/supabase/guards/require-tenant-admin.ts` (`requireTenantAdmin(ctx)` → throws `AuthError(403)`).
- **Tests (first)**: `PATCH {webhookSecret}`, `{outboundUrl}`, `{status:'active'}` from a non-allowlisted key, `{restaurantId: other}` → `400 unknown_field`, row unchanged; `GET` list + detail `Object.keys` equality against the projection allowlist (fails on any new key); `staff` → `403` on PATCH/DELETE/rotate, `admin` → `200`; rotate returns a 64-hex secret once, second `GET` shows only `last4`; foreign id → `404` via the scoped query.
- **Boundaries**: do not touch `verify-signature.ts`, the POS webhook, or any UI; no migration (`inbound_secret_updated_at` lands in 069 — until then rotation audit goes to `integration_settings_audit` only after WI-1; WI-0 logs to console + returns the secret; WI-1 adds the audit row).
- **Acceptance**: all above green; `npm run lint` + `tsc` green; existing `pos-integrations` tests unchanged.

### WI-1 — Migrations 069–072, domain VOs/services, phone parser, consent invariant fn, the seam, ports + fakes + contract suites, DTO contract — `senior-backend-dev`
- **Closes**: T-C1 (function + trigger), T-C2 (parser), T-H6 (seam + `23505`), T-H1 (dedicated encrypted column), OD-13 grade rule, OQ-7. Spec: US-1 (normalisation, seam parity), US-3 (record shape).
- **Files (new)**: `supabase/migrations/069_…072_…sql` (above); `src/domain/value-objects/e164-phone.ts`, `consent-level.ts`, `partner-consent-action.ts`; `src/domain/services/partner-consent-policy.ts`, `webhook-signature.ts`, `ip-range.ts`, `delivery-outcome.ts`; `src/domain/entities/integration-settings.ts`, `member-job.ts`, `integration-event.ts`, `integration-delivery.ts`; `src/domain/ports/rate-limiter.ts`, `outbound-webhook-sender.ts`, `integration-event-publisher.ts`, `clock.ts`, `phone-normalizer.ts`; `src/infrastructure/phone/e164-parser.ts` (`libphonenumber-js/max`, `DEFAULT_PHONE_REGION = 'HK'`, strips nothing — rejects zero-width/letters via `extract: false` + `isValid()` + regex); `src/infrastructure/crypto/secret-box.ts` (AES-256-GCM, `INT001_SECRET_KEY`, `v1:` prefix); `src/infrastructure/supabase/repositories/member-create-repository.ts` (sole insert), `integration-settings-repository.ts` (+ `toRow`/`mapRow` that **never** maps `outbound_secret_enc` onto the entity; a separate `readOutboundSecret(integrationId)` returns the decrypted value to the delivery path only), `integration-settings-audit-repository.ts`, `integration-member-ref-repository.ts`; `src/application/create-or-get-member.ts`; `src/application/dtos/integration-member-api.ts`; `src/test-utils/fake-rate-limiter.ts`, `fake-outbound-sender.ts`, `fake-clock.ts`, `recording-publisher.ts`, `loopback-test-guard.ts`; contract suites listed in §Ports.
- **Files (modify)**: `consent-record-repository.ts` (+ `findLatestByCategory`, `applyPartnerAssertedConsent`; entity port `ConsentRecordRepository` gains both), `package.json` (`libphonenumber-js` exact, `ioredis` explicit at the resolved version, `fast-check` dev exact).
- **Tests (first)**: property test (fast-check + the threat's fixed variant list) — every format variant of one HK number collapses to one `E164Phone`; `9876x5432`, zero-width, 16 digits, empty → rejection with `invalid_e164`, never a throw carrying the raw input; `applyPartnerAssertedConsent` table over {no row, pending, opted_in, opted_out latest, opted_out-then-opted_in latest} × {none, utility, all} × {utility, marketing} → exact action + resulting rows (invariant test: after any sequence, a latest-`opted_out` category has zero newer rows from `partner_api`); STOP-then-create and STOP-then-delete-member-then-create → zero new marketing rows (repository-level with the scratch DB lane, plus trigger test: direct insert raises `consent_opted_out_absorbing`); `createOrGetMember` concurrent double-create → one row, one `created`, one `existing`; publisher contract; migrations 069–072 applied on the scratch DB built from 001..068 inside a rolled-back txn (record the command in the implementation note).
- **Boundaries**: no routes, no queues, no UI; do not alter `PhoneNumber` (existing callers keep it); do not widen `idx_consent_active_uniq`.
- **Acceptance**: contract suites pass on fakes; scratch-DB run recorded; `supply-chain-guard` verdict for the three packages recorded in the implementation note.

### WI-2 — Inbound auth v2, Redis rate limiter, auth-failure bucket, queue-depth caps, job-id/idempotency, admin limits — `senior-backend-dev`
- **Closes**: T-H2, T-H3a, T-H3b (key construction; record written in WI-3), T-H5, T-M7 (global ceiling), T-M12, T-L3. Spec: US-1 (auth ACs, same job id), US-5.
- **Files (new)**: `src/app/api/integrations/[integrationId]/verify-signature-v2.ts`, `src/infrastructure/rate-limit/redis-rate-limiter.ts` (Lua bucket + fixed window + counters), `src/infrastructure/redis/connection.ts`, `src/application/integration-inbound-guard.ts` (`guardInboundRequest(ctx)` — steps 3–8 of §Inbound auth, returns a typed decision, no `NextResponse`), `src/application/build-member-job-id.ts` (HMAC + canonicalisation), `src/app/api/admin/integrations/[id]/limits/route.ts`.
- **Tests (first)**: body-only legacy signature → `401`; 10-min-old timestamp → `401`; signature valid for `/api/webhooks/pos/{id}` → `401`; unknown id vs bad signature → byte-identical `401` bodies; inactive + valid signature → `403`; 100 unsigned requests do not consume the signed bucket (fake limiter) and the auth-failure bucket trips at 10; limiter contract against Redis in the integration lane (two limiter instances share state); Redis down → `503 queue_unavailable`, zero DB writes; same body → same `jobId`; different `INT_JOBID_KEY` → different id; canonicalisation ignores key order/whitespace; global ceiling → `503 queue_depth_exceeded`; strict header parser rejects duplicate/unknown params.
- **Boundaries**: legacy `verify-signature.ts` and the POS webhook untouched; no member creation.
- **Acceptance**: every 401/403/429/503 path has a test; limiter contract green on fake + Redis.

### WI-3 — Inbound route, poll route, `integration-inbound` queue + member-create processor, consent application, audit/job rows — `senior-backend-dev`
- **Closes**: T-H3b (idempotency record), T-H4, T-H7 (jobs in Postgres, no PII on rows), T-M1, T-M3, T-M9, T-M10, OD-2 amendments, OD-14. Spec: US-1, US-2, US-3, US-4 (decision + `skipped_*` recording except the send itself), US-5 (route side).
- **Files (new)**: `src/app/api/integrations/[integrationId]/members/route.ts`, `members/jobs/[jobId]/route.ts`, `src/infrastructure/validation/integration-member-validators.ts` (`validateCreateMemberBody` → `{ ok, value } | { ok:false, fields }`, name hygiene in code points, metadata depth), `src/application/enqueue-member-create.ts`, `process-member-create-job.ts`, `decide-welcome.ts` (pure decision → outcome + reason), `get-member-job.ts`, `src/infrastructure/queue/integration-inbound-queue.ts`, `integration-inbound-processor.ts`, `src/infrastructure/supabase/repositories/integration-member-job-repository.ts`.
- **Files (modify)**: `scripts/start-worker.ts` (register the inbound worker in `startAll` + `activeWorkers`).
- **Tests (first)**: route does no `members` write (spy on the seam + repository); `202` shape + `poll_url`; duplicate submit → same `job_id`; same phone with a raised level → second job runs and the upgrade lands; existing member → `outcome: existing`, no coupon, no `join`, `skipped_existing`, no reactivation of `unsubscribed`; new member → `created`, consent rows per D6 with grade per OD-13 (attestation present/absent), `join` event with `source: 'partner_api'` and no `coupon_code`; `422` for each field code without echoing the value (assert body and console spy); poll from another integration (same tenant and other tenant) → `404` byte-identical; `410` after `result_expires_at`; job row carries no phone/name beyond `phone_last4`; XSS metadata stored as JSONB verbatim; 3 KB metadata → `422`; `name` `"Ada\nLovelace\t"` normalised; 80-emoji name accepted, 81 → `422`; permanent vs transient split; depth counter decrements on terminal outcomes; **parity test**: API path and `registerMemberWeb` produce identical `members` rows for the same inputs (excluding id/timestamps).
- **Boundaries**: no welcome send (WI-4 owns the `welcome-send` processor — WI-3 enqueues a stub job name and records `queued`); no outbound.
- **Acceptance**: all US-1/US-2/US-3 ACs green; worker registered in `start-worker.ts`.

### WI-4 — Welcome-send job: send-time re-checks, idempotent mint (OD-15), template send + tracking, hourly cap — `senior-backend-dev`
- **Closes**: T-H8, T-M11, OD-15 amendment, OQ-2, OQ-3. Spec: US-4, D2–D5, D7.
- **Files (new)**: `src/application/process-welcome-send-job.ts`, `resolve-integration-welcome-template.ts` (`'default'` → onboarding `welcomeCampaignId` → campaign `whatsappTemplateId` → `findByIdForRestaurant`; uuid → `findByIdForRestaurant`), `mint-welcome-coupon-idempotent.ts`; modify `integration-inbound-processor.ts` (dispatch by job name).
- **Tests (first)**: zero coupon rows for every `skipped_*` outcome (parametrised over all reasons); crash-between-mint-and-send retry → exactly one coupon (`23505` re-select); foreign template id → `skipped_no_template`, zero sends; STOP between create and send → `skipped_opted_out`; auto-paused tenant → `skipped_quality_paused`; 300 creates on a template-enabled integration → sends ≤ cap, rest `skipped_rate_capped`, all creates `created`; marketing template + `utility` level → `skipped_consent_level {required_level:'all', effective_level:'utility'}`; utility template + `none` → skipped; utility template + `utility` → sent; send failure retried ≤ 3 and never touches the create job row's `status`; tracking row written via `recordOutboundSend` with the `[welcome_partner_api]` preview and category from the template.
- **Boundaries**: never a free-form text send on this path; do not modify `onboard-new-member.ts`.

### WI-5 — Outbound sender port: SSRF guard, resolve-and-pin undici sender, signer, fake + contract suite — `senior-backend-dev`
- **Closes**: T-C3, T-L3 (outbound header format), T-M6 (URL validator in the application layer, shared by save and delivery). Spec: US-6 (URL rules, signature).
- **Files (new)**: `src/infrastructure/http/ssrf-guard.ts` (`assertSafeUrl`, `resolveAndPin` using `dns.promises.lookup({all:true})` + `net.isIP` + domain `ip-range`), `src/infrastructure/http/outbound-webhook-sender.ts` (undici `Agent` with `connect.lookup` pin, `servername`, `redirect:'manual'`, 5 s abort, explicit dispatcher), `src/application/validate-outbound-url.ts` (used by WI-8 save and WI-6 attempt).
- **Tests (first)**: exhaustive blocklist table (every CIDR in threat §3-E incl. `::ffff:127.0.0.1`, `0.0.0.0`, `169.254.169.254`, `metadata.google.internal`, `*.internal`, `localhost`); `https://user:pass@host/`, `https://host:8080/`, `http://` → rejected; host resolving public at save and private at attempt (stubbed resolver) → attempt rejected as permanent, zero bytes sent; `302 → http://localhost:6379/` not followed; a host with one public and one private address → rejected; the connection dials the pinned IP (assert on the fake lookup call); signature over `t.body` verifies with the partner-side reference implementation in the test; contract suite (fake + real on loopback via `createLoopbackTestGuard`).
- **Boundaries**: no queue, no DB.

### WI-6 — `integration-outbound` queue: emit + fan-out, delivery processor, breaker, dead-letter alert, retry/resume/test, relay + sweeper — `senior-backend-dev`
- **Closes**: T-H7 (ids-only jobs, payload at attempt time), T-M4 (sign at attempt), T-M8, T-L4, T-M2 (detection), OQ-9 retention, US-6 delivery/breaker/dead-letter ACs, US-9 server side. Spec: US-6, US-9.
- **Files (new)**: `src/application/emit-integration-event.ts` (real `IntegrationEventPublisher`), `deliver-outbound-webhook.ts`, `build-outbound-payload.ts`, `retry-delivery.ts`, `resume-outbound.ts`, `send-test-event.ts`, `sweep-integration-queues.ts`, `src/infrastructure/queue/integration-outbound-queue.ts`, `integration-outbound-processor.ts`, `src/infrastructure/supabase/repositories/integration-event-repository.ts`, `integration-delivery-repository.ts`; modify `scripts/start-worker.ts` (worker + `upsertJobScheduler('sweep')`), `create-or-get-member.ts` (wire the real publisher via factory), `.env.example` entries owned by WI-11 but referenced here.
- **Tests (first)**: an outbound job's `data` has no `phone`/`name` key (structural); payload built at attempt time reflects a rename after enqueue; secret rotated while queued → next attempt signs with the new secret; 404 → one attempt then `dead_lettered` + Slack payload containing only event id/integration name/code; 503 → retried; 429 → delayed per `Retry-After`; 10 transient failures → `paused_auto`, subsequent events land `paused`, Resume re-enqueues them, beyond cap → `dead_lettered`; Retry twice → `409`, one delivery attempt; test event only against a saved URL, `ping` payload has no PII; relay picks `queued AND enqueued_at IS NULL` only; fan-out trigger: subscribed/enabled/acknowledged → row, any of the three missing → no row; `member.updated` coalescing: STOP (status + 2 consent rows) → one event with `changed ⊇ ['status','consent']`; pruning keeps ≤ 500 / 30 d; anomaly alert fires at > 3× baseline.
- **Boundaries**: no UI; do not touch `event-dispatch-queue.ts` or the POS listener.

### WI-7 — Route the three legacy creation paths through the seam; boundary test; `member.updated` end-to-end — `senior-backend-dev`
- **Closes**: T-H6 (all paths + boundary test), OQ-10, US-6 "one event per path". Spec: US-6.
- **Files (modify)**: `src/application/register-member.ts`, `register-member-web.ts`, `import-contacts-batch-row-member.ts` (each calls `createOrGetMember`, keeps its own follow-up; `23505` now means existing everywhere); **delete** `src/application/import-members-with-consent.ts` and its test — dead code per kanban, and its `members` insert would fail the T-H6 boundary invariant (deliberate exception to "pre-existing dead code stays"; flagged for the orchestrator).
- **Tests (first)**: `src/__tests__/members-insert-boundary.test.ts` — grep `src/` for `from('members')` followed by `.insert(` within 3 lines → exactly one hit in `member-create-repository.ts`; four fixtures (WhatsApp join, web QR join, CSV import row, API create) → four `member.created` events with the right `source`; existing behaviour of each path unchanged (their current tests stay green untouched); `updateMemberPreferredLanguage` and STOP produce `member.updated` via the triggers (scratch-DB lane).
- **Boundaries**: no behaviour change to what WhatsApp/web joiners receive (F1/F2).

### WI-8 — Dashboard settings/secret/deliveries/retry/resume/test/activity APIs (role-gated, allowlisted, audited) — `senior-backend-dev`
- **Closes**: T-M5 (new routes), T-M6, T-M11 (save-time template ownership check), US-7/US-8/US-9 server side, §8.1 settings responses.
- **Files (new)**: `src/app/api/dashboard/pos-integrations/[id]/settings/route.ts`, `outbound-secret/route.ts`, `deliveries/route.ts`, `deliveries/[deliveryId]/retry/route.ts`, `outbound/resume/route.ts`, `outbound/test/route.ts`, `activity/route.ts`; `src/application/update-integration-settings.ts` (per-field validated functions: `setNewJoinTemplate`, `setConsentAttestation`, `setOutboundUrl`, `setOutboundEvents`, `setOutboundEnabled`, `acknowledgeOutboundPii`), `set-outbound-secret.ts`, `list-integration-deliveries.ts`, `list-integration-activity.ts`; `src/infrastructure/validation/integration-settings-validators.ts`.
- **Tests (first)**: `staff` → `403` on every route; `admin` → `200`; each `422` code; `'default'` with no approved template behind the welcome campaign → `no_default_welcome_template`; foreign template uuid → `template_not_owned`; enabling outbound without PII ack → `pii_ack_required`; secret < 16 → `422`, saved secret returns `last4` only, audit row has `last4` only; every field change writes who/when/old→new; deliveries response ≤ 500 rows, filter by status; responses contain no secret material (`Object.keys` allowlist).
- **Boundaries**: UI untouched.

### WI-9 — Dashboard: Integrations area (list + detail), settings cards, sidebar, i18n — `react-frontend-dev`
- **Closes**: US-7, US-8 (UI), §8.2/§8.3 feedback states, T-M9 (escaped rendering).
- **Files (new)**: `src/app/dashboard/integrations/page.tsx`, `[id]/page.tsx`; `src/components/dashboard/integrations/integration-list.tsx`, `inbound-credentials-card.tsx` (webhook URL, secret last4, Rotate with confirm + one-time reveal), `welcome-template-card.tsx` (Off / Tenant default radio, resolved name + category, helper copy, read-only "Specific template" state, blocked-save link to `/dashboard/wa-templates`), `consent-attestation-card.tsx` (text + ack checkbox, explains strong/weak), `outbound-webhook-card.tsx` (URL, event checkboxes, PII ack, secret paste with swap warning, Send test event); modify `src/components/dashboard/sidebar.tsx` (item `{ label: t('integrations'), href: '/dashboard/integrations', icon: Plug }`), `src/messages/en.json` + `zh-HK.json` (`nav.integrations`, namespace `integrations.*` for every string above incl. all §8.2/§8.3 toasts/inline errors/warnings).
- **Tests (first)**: component tests for each feedback state row in §8.2/§8.3 (success / warning / rejected), i18n key presence test (`src/messages/__tests__` precedent) for both locales, escaped rendering of `<script>` in names, admin-only controls hidden for `staff`.
- **Boundaries**: no API changes; no member detail page.

### WI-10 — Dashboard: delivery log, activity log, retry / resume / paused banner — `react-frontend-dev`
- **Closes**: US-9 (UI), T-M4 post-rotation notice, §8.2 rows.
- **Files (new)**: `src/components/dashboard/integrations/delivery-log-table.tsx` (status filter, columns per US-9, live row after test event via polling every 2 s for 30 s), `paused-banner.tsx` (streak + Resume), `activity-log-table.tsx` (member jobs: outcome, asserted level, consent actions, welcome outcome with the §8.3 sentences, phone last4); i18n additions in both locales.
- **Tests (first)**: retry button disabled after one retry; banner appears on `paused_auto`, clears on resume; "N dead-lettered since secret change — Retry" notice when `outbound_secret_updated_at` > last dead-letter; escaped metadata/external_ref rendering.
- **Boundaries**: no API changes.

### WI-11 — Partner API docs, ops playbook, `.env.example`, load test + release gate — `senior-backend-dev`
- **Closes**: kanban (d) "document the 202 + polling contract", T-M7 load-test gate, §Rollout preconditions, T-H7 Redis password check.
- **Files (new)**: `docs/api/partner-member-api.md` (auth v2 with a reference signer in Node + curl, request/response schemas verbatim from the DTO file, error codes, polling, idempotency, rate limits, outbound events + verification snippet, secret rotation semantics, `INT_JOBID_KEY` rotation caveat), `docs/playbooks/integration-queues-ops.md` (queues, keys, dead-letter triage, breaker, sweeper, kill switches — modelled on `email-queue-ops.md`), `scripts/load/int001-load-test.ts` (500 signed creates in 60 s against a local server + 1000 deliveries to a local mock partner; prints p50/p95, worker RSS delta, Redis `INFO memory` delta, drain time); modify `.env.example` (`INT_JOBID_KEY`, `INT001_SECRET_KEY`, `INT001_INBOUND_CONCURRENCY`, `INT001_OUTBOUND_CONCURRENCY`, `INT001_GLOBAL_QUEUE_CEILING`, `INT001_WELCOME_HOURLY_CAP`, `INT001_DISABLE_INBOUND`, `INT001_DISABLE_OUTBOUND`, `INT001_TEST_REDIS_URL` (tests only), with the kill-switch semantics documented).
- **Acceptance**: load test run locally with results in the implementation note meeting §Performance Budgets; docs reviewed against the DTO types (a test imports the DTO and checks every documented field name exists).

### WI-12 — I-task: end-to-end integration walk from the app entry point — `react-frontend-dev`
- **Spec = the Integration Map below as a checklist** + walk: log in as tenant admin → sidebar "Integrations" → create/open integration → rotate inbound secret → sign a `POST …/members` with the documented Node snippet → `202` → poll → `succeeded/created` → member appears in `/dashboard/members` → Activity shows consent actions + welcome outcome → configure welcome template `'default'` and consent attestation → second create with `consent_level: all` → welcome outcome `queued` (mock provider in dev per `plans/2026-06-10-dev-whatsapp-mocks`) → set outbound URL to the local mock partner + PII ack + secret → Send test event → delivery row `Delivered · 200` → create via web QR join → `member.created` delivered → STOP via the WhatsApp mock → `member.updated` delivered → break the mock partner (500) → 10 failures → paused banner → Resume → drains. Everything running (`next dev` + `npx tsx scripts/start-worker.ts` + Redis).
- Reports: every Integration Map row ticked with evidence (screenshot or log line); any unticked row = the work item fails.
- **Boundaries**: fixes found here go back to the owning WI as a cold redo dispatch, not into this task.

---

## Integration Map (every row owned by a WI; the orchestrator's absence pass walks this)

| # | Registration point | Location | WI |
|---|---|---|---|
| 1 | Inbound POST route | `src/app/api/integrations/[integrationId]/members/route.ts` | WI-3 |
| 2 | Poll GET route | `src/app/api/integrations/[integrationId]/members/jobs/[jobId]/route.ts` | WI-3 |
| 3 | Auth v2 module | `src/app/api/integrations/[integrationId]/verify-signature-v2.ts` | WI-2 |
| 4 | Inbound worker registered | `scripts/start-worker.ts` `startAll()` + `activeWorkers()` (+ log line lists it) | WI-3 |
| 5 | Outbound worker + `sweep` job scheduler registered | `scripts/start-worker.ts` | WI-6 |
| 6 | Sole `members` insert + boundary test | `member-create-repository.ts`, `src/__tests__/members-insert-boundary.test.ts` | WI-1, WI-7 |
| 7 | Three legacy paths call the seam; dead insert removed | `register-member.ts`, `register-member-web.ts`, `import-contacts-batch-row-member.ts`; `import-members-with-consent.ts` deleted | WI-7 |
| 8 | Consent repository port + impl gain `findLatestByCategory`, `applyPartnerAssertedConsent` | `src/domain/repositories/consent-record-repository.ts`, infra impl | WI-1 |
| 9 | Migrations 069, 070, 071, 072 | `supabase/migrations/` (deploy.sh `db push`) | WI-1 |
| 10 | DTO contract + validators | `src/application/dtos/integration-member-api.ts`, `src/infrastructure/validation/integration-member-validators.ts`, `integration-settings-validators.ts`, `integration-validators.ts` | WI-1, WI-3, WI-8, WI-0 |
| 11 | Dashboard read projection on both existing GETs | `public-integration.ts` used in `pos-integrations/route.ts` + `[id]/route.ts` | WI-0 |
| 12 | PATCH allowlist | `[id]/route.ts` + `integration-validators.ts` | WI-0 |
| 13 | Rotate-inbound-secret route | `[id]/rotate-inbound-secret/route.ts` | WI-0 |
| 14 | Settings / secret / deliveries / retry / resume / test / activity routes | `[id]/settings`, `[id]/outbound-secret`, `[id]/deliveries`, `[id]/deliveries/[deliveryId]/retry`, `[id]/outbound/resume`, `[id]/outbound/test`, `[id]/activity` | WI-8 |
| 15 | Platform-admin limits route | `src/app/api/admin/integrations/[id]/limits/route.ts` | WI-2 |
| 16 | Role gate helper used by every INT-001 mutation | `src/infrastructure/supabase/guards/require-tenant-admin.ts` | WI-0 (created), WI-8 (used) |
| 17 | Sidebar nav entry | `src/components/dashboard/sidebar.tsx` → `/dashboard/integrations` | WI-9 |
| 18 | Dashboard pages | `src/app/dashboard/integrations/page.tsx`, `[id]/page.tsx` | WI-9 |
| 19 | i18n keys, both locales | `src/messages/en.json`, `zh-HK.json`: `nav.integrations`, `integrations.*` (every string in WI-9/WI-10) + key-parity test | WI-9, WI-10 |
| 20 | Ports + fakes + contract suites | `src/domain/ports/{rate-limiter,outbound-webhook-sender,integration-event-publisher,clock,phone-normalizer}.ts`; `src/test-utils/fake-*.ts`; `*.contract.ts` | WI-1, WI-2, WI-5 |
| 21 | Real adapters wired via factories (no DI container in repo — module-level factories like `getEmailProvider`) | `src/infrastructure/rate-limit/redis-rate-limiter.ts`, `http/outbound-webhook-sender.ts`, `application/emit-integration-event.ts`, `phone/e164-parser.ts` | WI-2, WI-5, WI-6, WI-1 |
| 22 | Env vars + `.env.example` | `INT_JOBID_KEY`, `INT001_SECRET_KEY`, `INT001_INBOUND_CONCURRENCY`, `INT001_OUTBOUND_CONCURRENCY`, `INT001_GLOBAL_QUEUE_CEILING`, `INT001_WELCOME_HOURLY_CAP`, `INT001_DISABLE_INBOUND`, `INT001_DISABLE_OUTBOUND`, `INT001_TEST_REDIS_URL` | WI-11 |
| 23 | Feature flags (kill switches, default = enabled = prod behaviour) | `INT001_DISABLE_INBOUND`, `INT001_DISABLE_OUTBOUND` read in the guard and the delivery attempt | WI-2, WI-6 |
| 24 | Slack dead-letter / breaker / anomaly alerts | `notifyOpsAlert({ kind: 'engineering_alert' })` — existing env `SLACK_WEBHOOK_URL_PLATFORM` | WI-6 |
| 25 | Forge | No new scheduled job; worker daemon restart already in `deploy.sh` (`npx tsx scripts/start-worker.ts` pattern) — documented in the ops playbook | WI-11 |
| 26 | Docs | `docs/api/partner-member-api.md`, `docs/playbooks/integration-queues-ops.md` | WI-11 |
| 27 | Load test script | `scripts/load/int001-load-test.ts` | WI-11 |
| 28 | New dependencies | `libphonenumber-js` (exact), `ioredis` (explicit, resolved version), `fast-check` (dev, exact) | WI-1 |
| 29 | Kanban | `.claude/kanban.json` INT-001 `workspace_artifacts` += this plan (done by this plan); dev artifacts appended per WI; move to `review` after WI-12 | orchestrator |
| 30 | CORS: none — assert no `Access-Control-Allow-*` and no `OPTIONS` export on the two partner routes | route tests | WI-3 |
| 31 | `events.type` — no change (`join` reused with `source: 'partner_api'`) | — | WI-3 |

---

## Acceptance Criteria (feature level)

1. Feature reachable end-to-end from the app entry point: sidebar → Integrations → configure → signed partner create → poll → member visible → outbound delivered → STOP → `member.updated` → breaker → resume (WI-12 evidence).
2. All 13 blocking threat items have a named WI and a test that fails before and passes after (§Traceability).
3. Every spec US-1…US-9 AC is covered by a test in its WI; §8.1–8.3 feedback states are exercised in WI-9/WI-10 component tests.
4. Frozen acceptance suites per WI are committed before implementation and not weakened (the orchestrator diffs the suites).
5. Mechanical: `npm run lint`, `tsc`, `vitest run` (coverage thresholds in `vitest.config.ts` hold for `src/domain` + `src/application`); contract suites green on fakes in CI and on real adapters in the integration lane at least once before merge (recorded).
6. Absence pass: every Integration Map row present.
7. Perf budgets below met in the WI-11 load test.
8. Scratch-DB migration run recorded for 069–072.

## Performance Budgets

| Target | Budget | Measured by |
|---|---|---|
| `POST …/members` (auth + validate + job row + enqueue) | p95 ≤ 200 ms, p50 ≤ 60 ms at 500 req / 60 s on one integration; ≤ 3 Redis round trips (pipelined) + 1 DB read + 1 DB insert + 1 `q.add` | WI-11 load test |
| `GET …/jobs/{id}` | p95 ≤ 120 ms | WI-11 |
| `member-create` job | p95 ≤ 600 ms wall, ≤ 8 DB round trips | worker timing log |
| `welcome-send` job | p95 ≤ 4 s wall incl. one BSP call (mock in load test) | worker timing log |
| Outbound attempt overhead (materialise + sign + DNS) | p95 ≤ 150 ms excluding partner response; 5 s hard timeout | WI-11 mock partner |
| Outbound first-attempt latency from event creation | p95 < 30 s (spec) — relay tick 30 s bounds `member.updated`; `member.created` fast path p95 < 5 s | WI-11 |
| Drain | 500 creates queued → drained ≤ 120 s at concurrency 4; 1000 deliveries → drained ≤ 10 min at concurrency 2 against a healthy mock (p95 200 ms) | WI-11 |
| Redis memory | ≤ 16 MB per 10 k waiting INT-001 jobs; all INT-001 keys ≤ 64 MB at the load-test peak (`INFO memory` delta) | WI-11 |
| Worker RSS | growth ≤ 100 MB across the full load test; steady state ≤ 350 MB for the whole worker daemon (4 GB VM shared by 17 sites) | WI-11 |
| Dashboard | `/dashboard/integrations/[id]` LCP ≤ 2.5 s on dev; deliveries query p95 ≤ 300 ms (index `(integration_id, created_at DESC)`, limit 500) | WI-12 DevTools |
| 429/503 to partners | < 0.5 % of requests in the load test at the configured limits | WI-11 |

## Out of Scope

Per spec §9: MBL-020 cross-brand; `/api/join/[slug]` hardening (OD-10 closed); batch create; tenant-wide API keys; consent proof collection; phone masking; coupon/consent lookup endpoints; platform-minted outbound secrets; `member.deleted`/points events; pulling customers from a POS; changing F1/F2 behaviour; dashboard picker for a specific template id (model + API only). Plus, from this plan: member detail page / timeline / member-level consent view (none exists — the owner-visible record is the integration Activity tab); `next` and other `npm audit` fixes (separate work item, deploy precondition); legacy POS webhook replay protection (pre-existing, file separately); `INT001_SECRET_KEY` rotation tooling; refactoring the three existing queues onto the shared Redis connection module.

## Rollout

1. **Deploy preconditions**: `next` CRITICAL DoS advisory patched and released (separate work item — the public route must not ship on 16.2.1); prod `REDIS_URL` carries a password (verify on-box); `INT_JOBID_KEY` and `INT001_SECRET_KEY` set in prod env **before** the worker restarts (secret-box refuses to start without a 32-byte key); Slack platform webhook present.
2. Merge order = WI order; one PR per WI or grouped {0}, {1–2}, {3–4}, {5–7}, {8–10}, {11–12}, each behind green gates.
3. Migrations 069 → 072 applied by `deploy.sh` (`supabase db push`) before the app restarts; 069 backfills settings rows so existing integrations default to OFF/disabled (OD-3).
4. `deploy.sh` restarts both daemons; confirm the worker log line lists `integration-inbound, integration-outbound`.
5. Flags default enabled (prod behaviour); `INT001_DISABLE_INBOUND=1` / `INT001_DISABLE_OUTBOUND=1` are the emergency kill switches — inbound answers `503 feature_disabled`, outbound parks deliveries `paused` for the relay to resume when cleared.
6. Post-deploy: run the WI-11 load test against staging (or a throwaway integration on prod off-hours with `send_welcome:false` and outbound disabled), watch worker RSS + Redis memory, then hand partners the doc.
7. Rollback: unset flags → disable; migrations are additive (new tables/triggers only) — dropping the four triggers restores pre-feature write behaviour without data loss.

## Risks & Open Questions

| # | Risk / question | Handling |
|---|---|---|
| R1 | OD-13 adopted without the owner: `weak` for integrations without attestation — and the spec's stated consequence (gate failure) is not what the code does | Flag to owner; if overturned, WI-3 flips one constant |
| R2 | No member detail / timeline / consent view exists although the spec cites them as existing | Activity tab on the integration page is the owner-visible surface; member-level view filed as follow-up |
| R3 | `whatsapp_messages` has no `source` column; US-4's `source: welcome_partner_api` literal is not met | Discriminator via `contentPreview` prefix + job row link; adding a column to the shared hot-path table is deliberately avoided (`principle_shared_select_migration_coupling`) |
| R4 | `origin_integration_id` added to the outbound envelope (not in spec) | Additive; flag |
| R5 | Migration numbers 069–072 may collide with `develop` (WONB-008) | Rebase before merge; renumber if needed; `deploy.sh` applies in name order |
| R6 | Deleting `import-members-with-consent.ts` contradicts "pre-existing dead code stays" | Required by the T-H6 boundary invariant; kanban already declares it dead; flagged |
| R7 | T-M2 membership probing is inherent to create-or-get | Detection alert in WI-6; **owner acceptance required** — must be stated in integration-enablement copy (WI-9 helper text) |
| R8 | `member.updated` via DB triggers adds trigger logic to `members` and `consent_records` | Column-list triggers only; scratch-DB validated; rollback = drop triggers |
| R9 | BullMQ job scheduler (`upsertJobScheduler`) API on the pinned `bullmq ^5.71` — verify via Context7 in WI-6 before relying on it; fallback: `setInterval` in the worker process with a Redis lock | WI-6 |
| R10 | `libphonenumber-js` `extract:false` behaviour for zero-width characters must be confirmed by the property test, not assumed | WI-1 |
| R11 | Real-adapter contract lanes (Redis, scratch DB) do not run in CI | Run locally before each merge; recorded in the implementation note; CI runs fakes |
| R12 | Brief asked for zod; repo has none | Resolved to typed DTO + hand-rolled validators; flagged to orchestrator |
| R13 | Legacy POS webhook still charges the in-process limiter before auth and has no replay protection | Pre-existing; file separately (threat §9) |
| R14 | Per-integration limits are platform-admin only via API (no admin UI) | Documented in the ops playbook |

## Traceability

**Threat §10 blocking** — 1 T-C1 → WI-1, WI-3 · 2 T-C2 → WI-1, WI-3 · 3 T-C3 → WI-5 (+ WI-6 attempt, WI-8 save) · 4 T-C4 → WI-0 · 5 T-H1 → WI-0, WI-1 · 6 T-H2 → WI-2 · 7 T-H3 → WI-2, WI-3 · 8 T-H4 → WI-3 · 9 T-H5 → WI-2 · 10 T-H6 → WI-1, WI-7 · 11 T-H7 → WI-3, WI-6 · 12 T-H8 → WI-4 · 13 `next` → Rollout precondition (WI-11 lists it).
**Non-blocking** — T-M1 → WI-3 · T-M2 → WI-6 (+ R7) · T-M3 → WI-3 · T-M4 → WI-6 · T-M5 → WI-0, WI-8 · T-M6 → WI-5, WI-8 · T-M7 → WI-2, WI-11 · T-M8 → WI-6 · T-M9 → WI-3, WI-9/10 · T-M10 → WI-3 · T-M11 → WI-4, WI-8 · T-M12 → WI-2 · T-L3 → WI-2, WI-5 · T-L4 → WI-6.
**Spec** — US-1 → WI-2, WI-3 (parity, WI-7) · US-2 → WI-3 · US-3 → WI-1, WI-3 · US-4 → WI-3 (decision), WI-4 (send), WI-8/9 (setting) · US-5 → WI-2, WI-11 · US-6 → WI-5, WI-6, WI-7 · US-7 → WI-8, WI-9 · US-8 → WI-8, WI-9 · US-9 → WI-6, WI-8, WI-10 · §8.1 → WI-3, WI-8 · §8.2/8.3 → WI-9, WI-10 · D1–D8 → WI-3/WI-4 · OD-2/13/14/15 → header table.
