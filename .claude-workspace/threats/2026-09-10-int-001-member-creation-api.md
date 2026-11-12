---
id: threats/2026-09-10-int-001-member-creation-api
type: threat
author: security-architect
created: 2026-09-10
status: active
supersedes: null
superseded_by: null
related: [specs/2026-09-10-int-001-member-creation-api, kanban:INT-001, kanban:WAQ-004, kanban:WAQ-005, kanban:WAQ-009, kanban:WONB-005]
---

# Threat Model: INT-001 Bidirectional Member-Creation API

Design-time model of `specs/2026-09-10-int-001-member-creation-api` (rev 2) against the
code that exists on `feature/int-001-member-api`. Every threat carries a severity, the
story/decision it lands on, a mitigation the dev must implement, and the acceptance test
that proves it.

**Verdict: CONDITIONAL** — 4 CRITICAL and 8 HIGH threats must be closed in the plan before
implementation. See §10 Required Changes and §11 for the OD-2/13/14/15 verdicts.

---

## 1. Assets

| Asset | Why it matters | Where it lives |
|---|---|---|
| Member PII | phone E.164, name, language, `external_ref` — PDPO personal data | `members`, outbound payloads, Redis job data, delivery log |
| Consent records | The owner's *only* evidence in a PDPO Part VIA complaint and the WAQ-004 send gate's input | `consent_records` (service-role sole writer) |
| Inbound HMAC secret | Forging it = creating members and asserting consent as the partner | `pos_integrations.webhook_secret` |
| Outbound partner secret | Forging it = injecting fake `member.created` into the partner's POS | integration settings (new column) |
| Coupon codes / promotion budget | Minted value; issued-coupon metrics | `coupons` |
| Tenant isolation boundary | One restaurant's members must never reach another's partner | every scoped query |
| WABA quality rating | A pause stops **all** campaigns for that tenant, not just this feature | Meta-side, tracked by WAQ-006/009 |
| Shared Redis + e2-medium/4GB VM | 17 sites share it; exhaustion is a platform-wide outage | prod VM |
| **GCE instance metadata credentials** | `169.254.169.254` hands out service-account tokens — the SSRF prize | prod VM link-local |
| Dashboard session + role | Gate on settings, secrets, retry, resume | Supabase auth + `user_tenants.role` |

## 2. Trust Boundaries

1. **Internet → `POST /api/integrations/{integrationId}/members`** — authenticated by HMAC only. No session, no CORS, no browser path (§5.0). Everything past this line is trusted.
2. **Internet → `GET .../members/jobs/{jobId}`** — same secret; reads back a member id.
3. **Our worker → partner-controlled destination URL** — *egress* from the prod VM. This is the SSRF boundary and the only place our process makes an outbound request to an address a user chose.
4. **Owner browser → dashboard settings/retry/resume APIs** — session + tenant + role.
5. **Job payload → Redis** — shared instance; anything written there is at rest outside Postgres and outside RLS.
6. **Member's WhatsApp channel (STOP) → consent store** — the member's authority must dominate the partner's assertion. This boundary is the one the current schema does **not** enforce (T-C1).
7. **Service-role writes → `consent_records`** — RLS is bypassed by design; the repository is the sole writer and therefore the sole enforcement point.

---

## 3. STRIDE

### S — Spoofing

| id | Threat | Sev | Story/decision |
|---|---|---|---|
| T-H2 | **Replay: the precedent signing scheme has no timestamp and no nonce.** `verify-signature.ts` signs `rawBody` alone. Reused verbatim (as §9 says: "F7 scheme"), a captured create request replays forever — and a replayed create re-runs the consent write, so a replay is a consent-mutation primitive, not just a duplicate. | HIGH | US-1, OD-6 |
| T-C4 | **Inbound secret takeover via mass assignment.** `PATCH /api/dashboard/pos-integrations/[id]` calls `updateIntegration(id, body)` with the unvalidated JSON body; `updateIntegration`'s TS type omits `webhookSecret`, but types are erased at runtime and `toUpdateRow()` writes `row.webhook_secret` whenever the key is present. Any authenticated tenant user (including `staff`) can set the signing secret to a value they choose and then sign partner requests. INT-001 puts the outbound URL and the outbound secret on this same path. | CRITICAL | US-7, US-9 |
| T-M12 | **Status checked before signature.** `authenticateIntegration` returns 401 for `status !== 'active'` *before* validating the signature — an enumeration channel, and it contradicts §8.1 which specifies `403` for inactive. | MEDIUM | US-1, §8.1 |
| T-L3 | `X-OMC-Signature: t=…,v1=…` parsed loosely (duplicate keys, unknown params) invites parser-differential forgery. | LOW | US-6 |

**Mitigations**

- T-H2 — Sign a **domain-separated** base string: `v1:member.create:<t>.<rawBody>` (and `v1:member.job:<t>.` for the GET). Require `X-OMC-Timestamp`; reject `|now − t| > 300s` with 401. Record `sha256(integrationId|t|rawBody)` in Redis with a 600s TTL; a second presentation inside the window returns the **same** `202 { job_id }` (retry-safe) and never re-enqueues; outside the window it is 401. Domain separation is required because the same `webhook_secret` also signs the legacy POS points webhook — without a scheme prefix, one endpoint's signature is a candidate for another. Keep `timingSafeEqual` + the length pre-check from the precedent.
- T-C4 — Replace `updateIntegration(id, body)` with an explicit per-field allowlist parsed in the route (repo has no zod — hand-roll, matching existing style). `webhook_secret` is **never** settable through PATCH; rotation, if offered (OQ-5), is a dedicated endpoint that mints server-side. Outbound URL, outbound secret and `new_join_template_id` each get their own validated application function.
- T-M12 — Verify the signature first, then map `status !== 'active'` to 403. Unknown integration and bad signature return a byte-identical 401 body.
- T-L3 — Strict header parse: exactly two params, `t` then `v1`, reject anything else.

**Tests**

- Signature over body-only (precedent scheme) → 401. Timestamp 10 min old → 401. Same signed request twice inside the window → one job, same `job_id`, exactly one consent write. A signature valid for `/api/webhooks/pos/{id}` replayed at `/members` → 401.
- `PATCH` with `{webhookSecret:"attacker"}`, `{outboundUrl:"http://169.254.169.254/"}`, `{status:"active"}`, `{restaurantId:"<other-tenant>"}` → rejected, row byte-identical afterwards.
- Inactive integration + **valid** signature → 403; unknown integration id → 401 with the same body as a bad signature (assert equality of the two response bodies).

### T — Tampering

| id | Threat | Sev | Story/decision |
|---|---|---|---|
| **T-C1** | **STOP resurrection — a partner can silently reverse an opt-out.** `idx_consent_active_uniq` is `WHERE status IN ('opted_in','pending')`, so an `opted_out` row does **not** block a fresh insert. STOP (`member-handlers.ts` → `revokeConsent` with no category) moves every active row to `opted_out`. A later create for that (restaurant, phone) — new-member branch, or any code path that inserts rather than upgrades — inserts a new `opted_in` marketing row, and `findActiveConsent` orders by `captured_at DESC` over `('opted_in','pending')` so the new row **wins**. Marketing resumes to a member who sent STOP. This survives member deletion because consent identity is deliberately (restaurant_id, phone_e164). PDPO breach + Meta policy breach. | **CRITICAL** | D6, OD-14, US-3, WAQ-005 |
| **T-C2** | **`PhoneNumber.create` is not an E.164 normalizer.** It strips only `[\s\-()]`, prefixes `+`, and length-checks the *digits* while storing the *uncleaned* string. So `9876x5432` → stored `+9876x5432` (8 digits, passes); `+852.9876.5432` → stored with dots; a HK number sent as `98765432` becomes `+98765432`, a different country entirely. Consequences: the same human is several distinct members (idempotency and `outcome:"existing"` both defeated), and **an opted-out phone re-enters under a format variant with fresh consent** — a second route to T-C1. The partner controls this string. OQ-7 frames this as an open question; it is a live defect on the seam INT-001 hands to third parties. | **CRITICAL** | US-1, D1, D6, OQ-7 |
| T-H3b | **`jobId = hash(integrationId, phone)` silently swallows a second, different request.** BullMQ treats `add()` with an existing job id as a no-op while the job is retained (`removeOnComplete: {count:100}`). A partner submitting a *consent upgrade* (`utility` → `all`) for a phone they already created gets `202` pointing at the **old** job's result; no job runs, the upgrade never lands, and the partner is told "succeeded". Same for a re-create after member deletion. | HIGH | US-1, OD-2, OD-14 |
| T-M4 | **Outbound secret rotation race (OD-9, immediate, no dual signature).** If the signature is computed at *enqueue* time, every already-queued delivery is signed with the retired secret, gets 401/403 at the partner, is classified permanent 4xx and goes straight to dead-letter — silently, because permanent failures do not feed the transient breaker streak. | MEDIUM | US-9, OD-9 |
| T-M11 | `send_welcome` / `new_join_template_id` are ceilings, not requests. A template id can outlive its ownership (set via the API before a transfer), so `'default'` and `<template id>` must be re-resolved and re-checked against the tenant at send time. | MEDIUM | D5, US-4, US-8 |

**Mitigations**

- **T-C1** — One repository function, `applyPartnerAssertedConsent({restaurantId, phoneE164, category, level, integrationId})`, added to `consent-record-repository.ts` (preserving the sole-writer invariant), used by **both** the new-member and existing-member branches. Its first act is a lookup over **all** statuses including `opted_out`. Rule: `opted_out` is **absorbing** — write nothing for that category, return `skipped_opted_out`, never insert a competing row. Otherwise: no row → insert at the asserted status; `pending` and level covers it → `upgradeToOptedIn`; `opted_in` → no-op. Never call `insertConsentRecord` directly from the INT-001 path.
  - Belt and braces at the DB level: add a migration that makes the uniqueness index cover all statuses, or add a `CHECK`-backed "latest row per (restaurant, phone, category)" projection. If the architect prefers to keep the partial index, the acceptance suite must own the invariant.
- **T-C2** — A strict E.164 parser at the route edge, before enqueue: parse with a real library (see §7), default region from the tenant (OQ-7 — until tenant country is stored, `HK` is the correct explicit default and must be a named constant, not an implicit one), require `isValid()`, and assert the result matches `^\+[1-9]\d{7,14}$`. The parsed value is the **only** value that reaches idempotency, member lookup, consent and the outbound payload. `PhoneNumber.create` must not be the sole validator on this route. Reject, never coerce, anything the parser rejects — 422 `{field:"phone", code:"invalid_e164"}` **without echoing the submitted value**.
- T-H3b — `jobId = HMAC-SHA256(INT_JOBID_KEY, integrationId + ':' + e164 + ':' + sha256(canonicalBody))`, plus an explicit Redis idempotency record with a 24h TTL matching OD-11's result retention. A hit with the **same** body hash returns the existing job; a hit on the same phone with a **different** body hash enqueues a new job. (This also closes T-H3a below.)
- T-M4 — Sign at **attempt** time from the integration's current secret, never at enqueue. Post-rotation, surface "N deliveries dead-lettered since the secret change — Retry" in the delivery log, in addition to the §8.2 pre-save warning.
- T-M11 — Resolve the template inside the welcome job and re-assert `template.restaurant_id === member.restaurant_id` and `status === 'APPROVED'`; a foreign or non-approved id → `skipped_no_template`, never a send.

**Tests**

- **T-C1** (blocking): member sends STOP → marketing `opted_out`; POST create with `consent_level:"all"` → assert zero new marketing rows, marketing still `opted_out`, effective level excludes marketing, welcome outcome `skipped_opted_out`, and a WAQ-004 marketing campaign still excludes that member. Repeat with the member row **deleted** first (the new-member branch) — same assertions.
- **T-C2** (blocking, property test): a generator of format variants for one HK number (`+852 9876 5432`, `85298765432`, `+852-9876-5432`, `+852.9876.5432`, `0085298765432`, `9876 5432`) — all creates collapse to exactly one member and one consent row per category; `9876x5432`, `+852<zero-width>98765432`, a 16-digit number and an empty string are each 422 and write nothing.
- T-H3b: same body twice → one job, same id. Same phone, `consent_level` raised → a second job runs and the upgrade lands. After the 24h TTL → a new job, not a stale hit.
- T-M4: rotate the secret while a delivery sits queued → the next attempt's signature verifies against the **new** secret.
- T-M11: `new_join_template_id` pointing at another tenant's template → `skipped_no_template`, zero sends, zero coupons.

### R — Repudiation

| id | Threat | Sev | Story/decision |
|---|---|---|---|
| T-M1 | **Partner-asserted consent is an unverifiable claim recorded at grade `strong`.** When a member complains under PDPO, the owner (the data user) must show what notice was given. `consent_text = null`, `proof_url = null`, and the platform never saw the interaction — so `strong` records something we cannot evidence. See §11 for the OD-13 verdict. | MEDIUM | D6, OD-13, US-3 |
| T-M5 | Retry / Resume / settings changes are state-changing and PII-moving, with no role check and no server-side once-only enforcement (US-9's "Already retried" is UI copy). | MEDIUM | US-7, US-8, US-9 |

**Mitigations**

- T-M1 — Every consent row on this path carries `source='partner_api'`, `source_reference=<integrationId>`, `captured_at` = request receipt time, `business_name_shown` = tenant registered name. Additionally persist a per-request **audit row** (integration id, request timestamp, signature key last-4, asserted level, resulting per-category action: `inserted|upgraded|noop|blocked_opted_out`) retained ≥ 24 months. Do **not** store the raw request body — it carries PII beyond what the audit needs. Surface integration name + asserted level in the member consent view (US-3 already requires this).
- T-M5 — `getTenantContext().role` gate (admin/owner) on every INT-001 settings, retry, resume and test-event route — today the role is returned and never read. `retried_at` column enforces once-only server-side. Every settings change writes who/when/old→new (US-8 already requires this for the template; extend it to the URL, the secret and the event checkboxes).

**Tests**

- Create with `consent_level:"all"` → assert the audit row exists with the integration id and the per-category action; assert the raw phone does not appear in the audit row's free-text fields.
- `staff` role → 403 on settings PATCH, retry, resume and test-event; `admin` → 200. Retry the same dead-letter row twice → second call 409, one delivery attempt.

### I — Information Disclosure

| id | Threat | Sev | Story/decision |
|---|---|---|---|
| **T-H1** | **The inbound HMAC secret is served to the browser today.** `mapRow()` maps `webhook_secret` and `credentials` onto the entity, and both `GET /api/dashboard/pos-integrations` and `GET .../[id]` return that entity verbatim. Any authenticated tenant user — `staff` included — can read every integration's signing secret. US-9 requires the outbound secret be "stored, displayed masked, and never displayed again"; storing it in `credentials` (as §9 implies) ships it to the browser through the same mapper. | HIGH | US-7, US-9, OD-9 |
| T-H3a | **The job id is a phone-number oracle.** `hash(integrationId, phone)` over an 8-digit HK mobile space is brute-forced offline in seconds by anyone holding the (non-secret) integration id — and the job id travels in `poll_url`, in the 202 body, in partner logs, in our access logs. | HIGH | US-1, US-2 |
| T-H4 | **Cross-integration job read.** Job ids are global on one queue and derived from inputs a multi-tenant POS vendor legitimately holds for several restaurants. If the 404 rule is enforced by "the id is unguessable", vendor A reads vendor B's `member_id`. | HIGH | US-2 |
| T-H7 | **PII at rest in Redis and in the dead-letter set.** Every outbound job payload carries `phone_e164` + `name`; `removeOnFail: {count:1000}` keeps up to 1000 of them indefinitely, on a Redis instance shared by 17 sites on one VM. Plus a 30-day delivery log. None of this retention was chosen by the owner. | HIGH | US-6, US-9, OQ-9 |
| T-M3 | Error/log leakage. `PhoneNumber.create` throws `Invalid phone number: ${raw}` — that message must never become a response body or an unstructured log line. `verify-signature.ts` logs `id/found/status`, which is fine, but the response must stay uniform. | MEDIUM | US-1, §8.1 |
| T-M2 | **Membership-existence probing.** `outcome:"existing"` tells the partner whether an arbitrary phone belongs to that tenant. It is destructive (a miss creates a member), so not a clean oracle — but a targeted "is this person a customer here" check is free at 60/min. Residual by design: OD-12/S2S makes the partner trusted, and it already receives full member data on every create. | MEDIUM | OD-12, S2S, US-1 |
| T-M9 | `metadata` (≤2 KB opaque) and `external_ref` (≤128) are partner-controlled strings echoed into the outbound payload, the delivery log and the dashboard — XSS and JSON-log-injection surface. | MEDIUM | US-1, US-6, US-9 |
| T-L4 | The dead-letter Slack alert leaves our infrastructure for a third-party SaaS. | LOW | US-6 |
| T-M-PII | **Residual, accepted by OD-8:** full E.164 + name are shipped to a third party the platform does not control, with no masking option. The owner's PII-acknowledgement checkbox (US-7) is the only control, and it gates *enabling*, not *ongoing* review. | MEDIUM (accepted) | OD-8, US-6, US-7 |

**Mitigations**

- T-H1 — A `toPublicIntegration()` projection (`id, name, provider, status, outboundUrl, outboundEvents, secretLast4, secretUpdatedAt, secretUpdatedBy, newJoinTemplateId`) used by **every** dashboard read. `webhookSecret` and the outbound secret never cross the route boundary; the inbound secret is returned exactly once, by `createIntegration`. Store the outbound secret in a **dedicated column**, not `credentials`, so no `SELECT *` mapper can leak it by default. Encrypt it at rest with an app key if the architect judges the effort proportionate — the projection is the load-bearing control either way.
- T-H3a — HMAC the job id with a server-side key (see T-H3b's construction); `INT_JOBID_KEY` lives in env, never in the DB.
- T-H4 — Store `integrationId` in the job's data and compare it against the authenticated integration on every poll; mismatch → 404 with a body byte-identical to unknown-job. Never rely on id entropy for authorization. (This is the repo's own `principle_authorize_by_scoped_query` / issue #111 lesson.)
- T-H7 — The outbound job carries only `{eventId, integrationId, restaurantId, memberId, type}`; the worker re-materialises the payload from Postgres at attempt time (which also makes a delivery after a rename consistent). The delivery log stores status, HTTP code, attempts, latency, and the response body truncated to 512 chars — never the request payload. Dead-letter entries carry the event id only. Confirm `REDIS_URL` carries a password in production.
- T-M3 — Structured field errors only: `{field, code}`, never the submitted value. Wrap `PhoneNumber.create`/parser throws so the raw input never reaches a response or a log line.
- T-M2 — Not fixable without abandoning create-or-get. Mitigate by detection: alert the owner when an integration's `existing`:`created` ratio or absolute volume deviates > 3× from its 7-day baseline; log every create with the integration id so a rogue partner is reconstructable. **Requires explicit owner acceptance** (§9).
- T-M9 — Enforce sizes at the edge (413/422 before enqueue, not in the worker); reject non-object `metadata` and nesting deeper than 3; store as JSONB, never string-concatenated into a log line; render through React's default escaping with no `dangerouslySetInnerHTML`.
- T-L4 — Slack payload carries event id, integration name and HTTP code only.

**Tests**

- Assert `GET /api/dashboard/pos-integrations` and `.../[id]` JSON contain no `webhookSecret`, no `credentials`, no outbound secret — as an `Object.keys` allowlist assertion that **fails when a new field is added**, not a field-by-field check.
- Given a job id and its integration id, a brute force over the 8-digit HK space does not recover the phone (assert the id is not a plain hash: same inputs with a different `INT_JOBID_KEY` produce a different id).
- Integration A polls a job created by integration B (different tenant, and same tenant) → 404 in both cases, response bodies byte-identical to the unknown-job 404.
- Structural test: an outbound job's `data` has no `phone`/`name`/`phone_e164` key. A failed delivery's log row contains no phone. A payload built at attempt time reflects a name changed after enqueue.
- 422 body for a bad phone does not contain the submitted string; the same holds for the log line emitted on that path.
- `metadata` containing `</script><img src=x onerror=alert(1)>` renders escaped in the delivery log; 3 KB metadata → 422; 200-char `external_ref` → 422.

### D — Denial of Service

| id | Threat | Sev | Story/decision |
|---|---|---|---|
| T-H5 | **Rate-limit poisoning + a limiter that is not a platform limit.** (a) The POS precedent charges `checkRateLimit('webhook:'+integrationId)` **before** authentication, so anyone holding an integration id burns a paying partner's bucket with unsigned junk. (b) `src/lib/rate-limit.ts` is an in-process `Map` — per Node process, reset on every deploy. The spec's "Redis token bucket" is a genuinely **new** component, not a reuse of the precedent. | HIGH | US-5 |
| T-H8 | **Welcome burst → WABA quality → tenant-wide pause.** A backfill on a template-enabled integration is exactly the failure WAQ-009 auto-pauses for, and the pause stops every campaign for that tenant. D5 (`send_welcome:false`) is the partner's choice, so the owner's protection depends on the partner behaving. | HIGH | D5, D7, US-4, WAQ-009 |
| T-M7 | Queue-depth cap is per integration (500). Twenty integrations × 500 = 10k waiting jobs on a 4GB VM shared by 17 sites. No global ceiling is specified. | MEDIUM | US-5, F8 |
| T-M8 | Poison jobs: a deterministically-failing job (deleted template, 404 destination) burns all 5 attempts unless classified permanent. | MEDIUM | US-6, F8 |
| T-M6 | "Send test event" is an owner-triggered outbound request — the same SSRF/DoS primitive as delivery, and reachable pre-save if the UI posts the URL inline. | MEDIUM | US-7 |
| T-M10 | `name` (≤80) with control characters or newlines breaks WhatsApp template parameters (132000-class rejections) for every welcome that uses it; naive length-slicing splits surrogate pairs. | MEDIUM | US-1, US-4 |

**Mitigations**

- T-H5 — Two Redis buckets: an **auth-failure** bucket keyed `(integrationId, client IP)` charged only when the signature fails (small, ~10/min), and the partner's 60/min bucket charged only **after** a valid signature. Implement as an atomic Lua token bucket (or `INCR`+`EXPIRE`) so the limit holds across processes. Redis unavailable → 503 `queue_unavailable`; **never fail open**, and never fall back to a synchronous insert (US-5 already forbids the fallback — make the fail-closed direction explicit too).
- T-H8 — A per-tenant welcome-send cap on the API path (platform-configurable, e.g. ≤ 60/hour): beyond it, record `skipped_rate_capped` rather than queueing. Re-check the WAQ-009 quality pause **inside** the welcome job, not only at enqueue.
- T-M7 — A global waiting-job ceiling in addition to the per-integration cap; worker concurrency pinned at 2 (max 4); tiny job payloads (T-H7). The US-5 load test is a **release gate**: 500 creates in 60s → p95 API < 200 ms and daemon RSS growth < 100 MB (the spec's own numbers).
- T-M8 — Reuse the `email-job-processor.ts` split verbatim in shape: `UnrecoverableError` for permanent (4xx except 408/429, validation, `tenant_inactive`, `integration_paused`), plain `Error` for transient (5xx/408/429/timeout/DNS).
- T-M6 — Test event fires only against a **saved, validated** URL, through the identical validated delivery path (no bypass), with a `ping` payload containing no member PII.
- T-M10 — Strip control characters and collapse whitespace on `name` at the edge; measure length in code points; reject rather than truncate.

**Tests**

- 100 unsigned requests do not consume the signed bucket — a valid request still gets 202 immediately after. Limiter counts across two process instances (integration test against Redis). Redis down → 503 and **zero** DB writes.
- 300 creates in a minute on a template-enabled integration → welcome jobs enqueued ≤ cap, the remainder `skipped_rate_capped`, all creates `outcome:"created"`.
- Partner returns 404 → one attempt then dead-letter. 503 → retried. 429 → retried honouring `Retry-After`.
- Test event against an unsaved URL → 422; `ping` payload contains no phone.
- `name` = `"Ada\nLovelace\t"` → stored normalized; an 80-emoji name → deterministic accept or 422, never a lone surrogate in the DB.

### E — Elevation of Privilege

| id | Threat | Sev | Story/decision |
|---|---|---|---|
| **T-C3** | **SSRF to GCE metadata via the owner-entered destination URL.** Prod is a GCE VM: `http://169.254.169.254/computeMetadata/v1/…` returns service-account access tokens. §9's save-time private-range check is necessary and insufficient — DNS rebinding (a hostname that resolves public at save and link-local at delivery) defeats it entirely, and a redirect chain does too. Reachable by any tenant user via T-C4 even without the settings UI. | **CRITICAL** | US-6, US-7 |
| T-C4 | (see Spoofing) mass assignment is also an EoP: `staff` → arbitrary outbound URL → continuous PII exfiltration, bypassing the route's URL validation. | **CRITICAL** | US-7 |
| T-H6 | **The "single member-creation seam" does not exist.** US-6 asserts the outbound event fires from one seam; the repo has three independent `members` inserts (`register-member.ts`, `register-member-web.ts`, `import-contacts-batch-row-member.ts`), each SELECT-then-INSERT with no transaction. Wiring the fan-out into three call sites means the fourth insert site — the one written next month — silently emits nothing, and the partner's mirror desyncs with no error anywhere. | HIGH | US-6, OQ-10 |
| T-M5 | (see Repudiation) role is fetched and never checked. | MEDIUM | US-7/8/9 |

**Mitigations**

- **T-C3** — A single `deliverOutboundWebhook()` that is the only code allowed to fetch a user-supplied URL, enforcing, at **both** save time and every delivery attempt:
  1. `https:` only, port 443 only, no userinfo in the URL, no credentials.
  2. Resolve the hostname yourself (`dns.promises.lookup(host, {all:true})`); **every** returned A/AAAA must be public. Reject IPv4 `0.0.0.0/8, 10/8, 100.64/10, 127/8, 169.254/16, 172.16/12, 192.0.0/24, 192.168/16, 198.18/15, 224/4, 240/4` and IPv6 `::1, ::, ::ffff:0:0/96 (IPv4-mapped — check the embedded v4), fc00::/7, fe80::/10, 2001:db8::/32`.
  3. **Pin the resolved IP for the connection** (custom `lookup` on the agent, or connect to the IP with an explicit `Host` header + SNI) so the address checked is the address dialled — this is the anti-rebinding control and it is the one that actually matters.
  4. `redirect: 'manual'`; any 3xx is a permanent failure, never followed.
  5. Reject by name: `localhost`, `*.localhost`, `*.internal`, `*.local`, `metadata.google.internal`.
  6. 5 s timeout; do not inherit `HTTP_PROXY`/`HTTPS_PROXY` from the environment.
- T-C4 — see Spoofing. The URL validator must live in the application layer that both the settings save and the delivery attempt call — never only in the React form.
- T-H6 — Extract one `createMemberRecord()` used by all four paths (or emit from a DB trigger into an outbox table, which is the more durable answer given the count of call sites). Add a boundary test asserting no `.from('members').insert(` occurs outside that function — the same grep-shaped invariant the repo already uses for `consent_records`' sole writer. Rely on `idx_members_restaurant_phone`: treat `23505` as "existing", never as a failure (`import-contacts-batch-row-member.ts` already does this; `register-member.ts` and `register-member-web.ts` do not).

**Tests**

- Save a URL whose host resolves to `169.254.169.254` → rejected at save. A host that resolves public at save and private at delivery (mock the resolver between the two) → **delivery** rejected, marked permanent, zero bytes sent. A 302 to `http://localhost:6379/` → not followed. `https://user:pass@host/` → rejected. `https://host:8080/` → rejected. IPv4-mapped IPv6 `::ffff:127.0.0.1` → rejected.
- Boundary test: grep the `src/` tree for `from('members')` + `.insert(` and assert exactly one call site.
- One `member.created` per path: WhatsApp join, web QR join, CSV import row, API create — four fixtures, four events, correct `source` on each.
- Concurrent double-create for the same (restaurant, phone) → exactly one member, exactly one `member.created`, the loser returns `outcome:"existing"`.

---

## 4. OWASP Top 10 Coverage

| Category | Applies | Where addressed |
|---|---|---|
| A01 Broken Access Control | yes | T-C4, T-H1, T-H4, T-M5, T-M12 |
| A02 Cryptographic Failures | yes | T-H1 (secret exposure), T-H2 (signing scheme + domain separation), T-H3a (low-entropy identifier) |
| A03 Injection | yes | T-M9 (XSS/log injection), T-M10 (template-parameter injection). SQL injection n/a — all access is via the parameterised Supabase client; no raw SQL is introduced by this feature |
| A04 Insecure Design | yes | T-C1 (consent resurrection is a schema-level design gap), T-M1, T-M2, and OD-15's mint-at-send (a *good* design decision — see §11) |
| A05 Security Misconfiguration | yes | absence of CORS headers is a requirement, not a default (US-1 AC); T-H5 fail-closed; Redis password |
| A06 Vulnerable / Outdated Components | yes | §7 — 2 CRITICAL / 11 HIGH advisories in the current lockfile, incl. `next` |
| A07 Identification & Authentication Failures | yes | T-H2 (replay), T-H5 (unauthenticated bucket burn), T-M12 (check order) |
| A08 Software & Data Integrity Failures | yes | T-H3b (stale job), T-H6 (missing event), T-M4 (rotation), T-C2 (identity integrity) |
| A09 Security Logging & Monitoring Failures | yes | T-M1 (audit trail), T-M2 (anomaly alerting), T-M3, T-H7 (over-retention is its own failure) |
| A10 SSRF | yes | **T-C3** — the headline threat of the outbound half |

---

## 5. Secrets & PII

| Secret | Minted by | Stored | Rotation | Exposure control |
|---|---|---|---|---|
| Inbound `webhook_secret` | platform (`crypto.randomBytes(32)`) | `pos_integrations.webhook_secret`, plaintext | OQ-5 — unverified; **not** via PATCH (T-C4) | Returned once at create; never in a dashboard read (T-H1) |
| Outbound signing secret | **partner** (OD-9) | dedicated column, **not** `credentials` | owner replaces; immediate, sign-at-attempt-time (T-M4) | Masked + last-4 only; never re-displayed (T-H1) |
| `INT_JOBID_KEY` | platform | env only, never in the DB | manual; rotation invalidates outstanding job ids (document it) | never leaves the server |

**PII collected:** phone E.164, name (≤80), preferred language, `external_ref`, opaque `metadata` (≤2 KB).
**Where it goes:** `members`, `consent_records` (phone only), `events`, Redis job data (→ eliminate per T-H7), the outbound payload (a third party, per OD-8), the delivery log, the dead-letter set, Slack alerts (→ strip per T-L4).
**Retention:** job results 24h (OD-11/OQ-9), delivery log 30 days / 500 rows, dead-letter bounded like `event-dispatch-queue`. Redis must not be the long-term home of any of it.
**Access control:** `consent_records` RLS is SELECT-only, scoped to the tenant; writes are service-role and must all pass through the repository. Dashboard reads of member PII already flow through the tenant guard; INT-001 adds no new browser-facing PII surface beyond the delivery log, which must be role-gated (T-M5).
**Compliance:** HK **PDPO** — DPP1 (collection + notice), DPP3 (use limited to the purpose consented), DPP4 (security), and **Part VIA** (direct marketing: consent must be shown, and opt-out must be honoured — T-C1 is a direct Part VIA failure). No PCI (no card data). No GDPR unless the owner takes EU diners' data, which OD-8's full-phone export to a third party would make materially worse — flag if it arises.

## 6. Auth & Authz

| Surface | Mechanism | Authorization |
|---|---|---|
| `POST .../members` | HMAC-SHA256 over `v1:member.create:<t>.<body>`, per-integration secret, ±5 min, replay cache | `integrationId` → `restaurant_id` binding is the *only* tenant selector; lookup is strictly `(restaurant_id, phone)`, never cross-brand (MBL-020 stays out) |
| `GET .../jobs/{jobId}` | same scheme, empty body | job's stored `integrationId` must equal the authenticated one; else 404 (T-H4) |
| Outbound delivery | we sign with the partner's secret; the partner verifies | n/a (egress) |
| Dashboard settings / retry / resume / test | Supabase session → `getTenantContext()` | tenant from `user_tenants` **plus a role gate** (admin/owner) — currently absent (T-M5). Scope every integration read by `restaurant_id` in the query, not by fetch-then-compare (issue #111 lesson; the existing `[id]` route still fetch-then-compares) |

Session lifetime: unchanged (Supabase auth). No new session type. No API keys — per-integration HMAC only (OD-6).

## 7. Supply Chain

**New dependencies this design requires**

| Package | Need | `supply-chain-guard` verdict |
|---|---|---|
| `libphonenumber-js` | T-C2 — real E.164 parsing/validation; the repo has none | **APPROVED with conditions.** MIT, pure JS, no install scripts, no runtime network, very high download volume, single well-known maintainer. Pin an **exact** version, keep `package-lock.json` committed, use the `max` metadata build (the `min` build under-validates). Alternative considered and rejected: a hand-rolled `+852` regex — smaller surface, but wrong the moment a non-HK tenant exists, and T-C2 is a CRITICAL that must not depend on a home-made parser. |
| IP-range checking | T-C3 | **No new dependency.** Use Node's `net.isIP` + `dns.promises.lookup` + ~40 lines of explicit CIDR checks. `ipaddr.js`/`ip-address` are not worth the surface for a fixed block list — and note `ip-address` already appears in this lockfile with a HIGH advisory. |
| Request validation | route input | **No new dependency.** The repo has no `zod`; existing routes hand-roll validation. Match the existing style (Surgical Changes). |
| HTTP client | outbound delivery | **No new dependency.** Node 20+ global `fetch`/`undici`, with a custom agent for IP pinning. |

**Existing lockfile — `npm audit` on this worktree, 2026-09-10: 25 advisories (2 CRITICAL, 11 HIGH, 8 moderate, 4 low), fixes available for all listed.**

- **CRITICAL `next` — "Denial of Service with Server Components"** (direct dependency, `next 16.2.1`). This one is in scope: INT-001 puts a new *internet-facing, unauthenticated-until-verified* route on this Next runtime. Patch before shipping the endpoint.
- **CRITICAL `tar`** — parser interpretation differential / file smuggling. Transitive; relevant to the release tarball path (`principle_bsdtar_exclude_unanchored`, PR #115) rather than to this feature. Patch, but not a blocker for INT-001.
- HIGH: `brace-expansion`, `browserslist`, `fast-uri`, `hono`, `ip-address`, `js-yaml`, `nanoid`, `postcss`, `sharp`, `vite`, `ws` — all transitive, all with fixes available. Not INT-001 blockers; run `npm audit fix` in a separate, reviewed work item so it does not contaminate this diff.

## 8. Spec ↔ code contradictions (flagged, not repaired)

| # | Spec says | Code says | Consequence |
|---|---|---|---|
| 1 | §9 / OD-6: reuse the F7 HMAC scheme | `verify-signature.ts` signs `rawBody` alone — no timestamp, no nonce | Reused verbatim → zero replay protection (T-H2). The precedent must be **extended**, and the legacy POS webhook's own lack of replay protection noted as a separate pre-existing gap (out of scope here). |
| 2 | US-5 / kanban: "Redis token bucket … reuse `src/infrastructure/queue/*` precedent" | `src/lib/rate-limit.ts` is an in-process `Map`; the POS route charges it **before** auth | A new Redis component is required; the precedent is also actively harmful to copy (T-H5). |
| 3 | US-6: "fired from the **single** member-creation seam" | Three independent `members` inserts, no shared function | The seam has to be created before it can be hooked (T-H6). |
| 4 | D6 / OD-14: "never touches `opted_out`" | `upgradeToOptedIn` only flips `pending`; `insertConsentRecord` succeeds when only an `opted_out` row exists (partial unique index excludes it) | STOP is silently reversible (T-C1, CRITICAL). |
| 5 | §8.1: `403` for `status != active` | `authenticateIntegration` returns `401` for inactive, **before** signature verification | Wrong code, plus an enumeration channel (T-M12). |
| 6 | US-9: outbound secret "displayed masked, never shown again" | `mapRow` returns `webhook_secret` + `credentials`; both dashboard GETs return them | Storing the outbound secret in `credentials` leaks it on every dashboard load (T-H1). |
| 7 | OQ-7: phone default region is an open question | `PhoneNumber.create` is not an E.164 normalizer at all and stores unsanitised input | Not merely open — a live CRITICAL on the shared seam (T-C2). |
| 8 | US-1: `phone` invalid → 422 with field-level errors | `PhoneNumber.create` throws `Invalid phone number: ${raw}` | Raw PII in an error path (T-M3). |

## 9. Open Risks & Acceptance

| Risk | Severity | Owner of acceptance | Note |
|---|---|---|---|
| **T-M2** — a partner can probe whether an arbitrary phone is a member of the tenant | MEDIUM | **Restaurant owner** (per integration), surfaced by the platform | Inherent to create-or-get + the S2S trust model (OD-12). Mitigated by detection only. Must be stated in the integration-enablement copy. |
| **T-M-PII / OD-8** — full E.164 + name shipped to a third party, no masking | MEDIUM | **Restaurant owner** via the US-7 acknowledgement | Recommend the acknowledgement record who ticked it and when, and that the delivery-log page repeat the statement — a one-time checkbox is thin evidence for a PDPO DPP3 question a year later. |
| **T-M1 / OD-13** — `strong` grade on evidence the platform never saw | MEDIUM | **Restaurant owner**, per integration | See §11 — recommend overturning as written. |
| Pre-existing: legacy POS points webhook has no replay protection | MEDIUM | Platform | Out of INT-001 scope. File separately; do not fix in this diff. |
| Pre-existing: `next` CRITICAL DoS advisory | HIGH | Platform | Patch before the new public route ships. |
| OQ-10 — CSV import fires one `member.created` per row | LOW | Owner | A 5,000-row import is 5,000 signed outbound requests. Under the limiter it is slow, not dangerous. Recommend the default stays per-row; revisit if a partner complains. |

No CRITICAL threat is being accepted. All four are in §10.

## 10. Required Changes (CONDITIONAL)

**Blocking — must be in the plan and in the frozen acceptance suite before implementation.**

1. **T-C1** — `opted_out` is absorbing, enforced in one repository function used by both branches, with the STOP-then-create test (including the member-deleted variant).
2. **T-C2** — Real E.164 normalization at the edge, with a named default region; the parsed value is the only one that reaches idempotency, member lookup, consent and the outbound payload. Property test over format variants.
3. **T-C3** — One `deliverOutboundWebhook()` with resolve-and-pin, all-addresses-public, no redirects, https/443 only, enforced at save **and** every attempt. Rebinding test with a mocked resolver.
4. **T-C4** — Field allowlist on the integration PATCH; `webhook_secret` unsettable via PATCH; URL/template/secret each through their own validated function.
5. **T-H1** — `toPublicIntegration()` projection on every dashboard read; outbound secret in a dedicated column; `Object.keys` allowlist assertion.
6. **T-H2** — Domain-separated, timestamped signature + replay cache.
7. **T-H3** — HMAC'd job id including a body hash, with a 24h idempotency record.
8. **T-H4** — `integrationId` stored on the job and compared on every poll; 404 byte-identical to unknown-job.
9. **T-H5** — Redis token bucket, charged after signature; separate auth-failure bucket; fail closed.
10. **T-H6** — One `createMemberRecord()` seam + boundary test; `23505` means "existing".
11. **T-H7** — Job payloads carry ids only; payload re-materialised at attempt time; no PII in the delivery log, dead-letter set or Slack alert.
12. **T-H8** — Per-tenant welcome-send cap with `skipped_rate_capped`; quality pause re-checked inside the job.
13. Patch the **CRITICAL `next` advisory** before the public route ships (separate work item, but a release precondition).

**Non-blocking but expected in the plan:** T-M1 audit row, T-M3 error hygiene, T-M4 sign-at-attempt, T-M5 role gate + `retried_at`, T-M6 saved-URL-only test event, T-M7 global ceiling + load-test gate, T-M8 permanent/transient split, T-M9/T-M10 input hygiene, T-M11 send-time template re-check, T-M12 check order, T-L3 strict header parse, T-L4 Slack payload.

## 11. Verdict on the labelled defaults

**OD-2 — idempotent create-or-get: ENDORSE, with two amendments.**
The decision itself is right: a second welcome or a second `join` on re-submission is a duplicate promotion and a duplicate marketing message. Two things must ride with it. (a) The idempotency **key** as specified (`hash(integrationId, phone)`) makes a legitimate second request with different content a silent no-op — a consent upgrade would vanish while the partner is told "succeeded" (T-H3b). Add the body hash and the bounded TTL. (b) `outcome:"existing"` must never reactivate an `unsubscribed` member row; the STOP path sets both member status and consent, and create-or-get must respect both.

**OD-13 — grade `strong` for partner-asserted consent: RECOMMEND THE OWNER OVERTURN, as written.**
`consent_grade` already has a defined meaning in this repo: migration 038 calls `strong` "fresh, source-attributed consents" and `weak` the backfilled/pre-system records that WONB-008 exists to re-confirm. A partner assertion with `consent_text = null` and `proof_url = null`, for an interaction the platform never observed, is exactly a record with no evidence. Stamping it `strong` makes the field stop distinguishing "we can show the notice given" from "someone told us they gave one" — and that distinction is the whole point of the column when a PDPO DPP1(3) / Part VIA question arrives. The spec's counter-argument is also correct: a blanket `weak` fails the WAQ-004 gate and makes the feature pointless.
**Recommended resolution — keep the gate passing, stop overloading the grade.** Add one per-integration field the owner fills in once: the partner's consent wording (`consent_attestation_text`) plus the owner's acknowledgement that the partner collects it. When that attestation is present, write `strong` **and copy the attestation into `consent_text`** on every row — now the grade is backed by something the owner can point at. When it is absent, write `weak`. Cost: one text field, one boolean, one copied string. If the owner declines this, ship `strong` — but the acceptance must be written down in this artifact's §9 with the owner named, because the residual is the owner's legal exposure, not the platform's.

**OD-14 — upgrade-only on an existing member: ENDORSE the rule, REJECT the current framing.**
"Never moves `opted_in → pending`, never touches `opted_out`" is the right rule. As written it is scoped to the *existing-member* branch, and that is precisely why T-C1 exists: the new-member branch inserts fresh rows, and the schema does not stop an insert over an `opted_out` history because the unique index is partial on `('opted_in','pending')`. The rule must be restated as an invariant over the **(restaurant, phone, category) identity**, not over the member row — `opted_out` is absorbing on every branch — and enforced in a single repository function. With that amendment: endorsed.

**OD-15 — mint the coupon only inside a welcome job that actually sends: ENDORSE, unreservedly.**
This is the strongest security decision in the spec and it should not be revisited. It removes a partner's ability to mint coupon rows at 60/min (a promotion-budget DoS that a create-time mint would hand over for free), it removes orphan codes that nobody can redeem and nobody can audit, and it makes a coupon's existence follow the send rather than the request. One amendment, which the spec's own §10 already names as a note and should be an acceptance test instead: mint **idempotently keyed on (member_id, welcome_campaign_id)**, so a crash between mint and send cannot double-mint on retry, and assert **zero** coupon rows for every `skipped_*` outcome. The product consequence the spec flags — a till-joined member on the default configuration receives no welcome offer on any channel — is a product decision, not a security one, and OD-15 is the right default regardless of how the owner resolves it.
