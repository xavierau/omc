---
id: reviews/2026-09-10-int-001-confirmation
type: review
author: code-review-analyzer
created: 2026-09-10
status: active
supersedes: null
superseded_by: null
related: [reviews/2026-09-10-int-001-analyzer, reviews/2026-09-10-int-001-grok, artifacts/2026-09-10-int-001-wi14-backend, artifacts/2026-09-10-int-001-wi16-backend, artifacts/2026-09-10-int-001-wi15-frontend, threats/2026-09-10-int-001-member-creation-api, plans/2026-09-10-int-001-member-creation-api, kanban:INT-001, kanban:SEC-005]
---

# Confirmation Review: INT-001 fix rounds (branch `feature/int-001-member-api` @ `fb61330`, vs `main`)

Cold re-review of the two fix rounds (WI-14 + addendum, WI-16, WI-15, and commit `fb61330`) against every finding in `reviews/2026-09-10-int-001-analyzer` and `reviews/2026-09-10-int-001-grok`. Working tree is clean (all fix work is committed; `git diff main` = the diff of record). Gate reported green by the caller (tsc, eslint, vitest 5556/0); not re-run here. Test-suite integrity was checked by diffing `src/**/*.test.ts` between the review-time commit `1904cab` and `HEAD`: 9 `it()` blocks were removed, every one replaced by a mechanism-equivalent test under a new name (listed in §Test-suite integrity below); no `.skip`/`.todo`/`.only` was added.

## Summary

All 2 Critical and 8 Important analyzer findings are closed, with tests I located and read. Of grok's 8 Important findings, 5 are closed, 2 are partial (G-3 legacy-phone fallback misses the CSV path and the re-join path; #6 error hygiene), and 1 is a product decision (#7 consent grade). SEC-005 (`next@16.2.1`) is untouched on this branch — `package.json:32`, `package-lock.json:10886` — and remains tracked as a deploy precondition.

The fix rounds introduced two new Important findings, both in the areas the fixes touched hardest: (N-1) the I-1 pre-auth throttle is keyed on the public `integrationId` alone, so an unauthenticated flood now 429s the legitimate partner's signed traffic — the exact outcome T-H5's "charge after signature" rule exists to prevent; (N-2) BullMQ's `moveToDelayed` counts an attempt by default, so the per-host throttle silently consumes the 5-attempt budget and, combined with the C-1 fix, a delivery to a busy partner host can dead-letter on its first real HTTP failure. Neither is a security-critical defect; both should be fixed before merge because they contradict the plan's own contracts (T-H5, "5 attempts of exponential backoff").

## Finding-by-finding confirmation

Status legend: CLOSED = fix closes the reviewer's concrete scenario; PARTIAL = symptom addressed, scenario not fully covered; OPEN = not addressed (with reason).

### Analyzer review (`reviews/2026-09-10-int-001-analyzer`)

| Finding | Status | Fix (file:line) | Test |
|---|---|---|---|
| C-1 transient exhaustion never dead-letters | CLOSED | `src/application/deliver-outbound-webhook.ts:60-67` (`isFinalAttempt` dep), `:192-205` (final transient → `deadLetter()` + alert, returns `permanent`); `src/infrastructure/queue/integration-outbound-processor.ts:89-95` (`attemptNumber = attemptsMade+1`, `isFinalAttempt = attemptNumber >= (job.opts.attempts ?? ATTEMPTS)`) → `UnrecoverableError` `:98-100`. BullMQ 5.76.5 increments `atm` only in `moveToFinished` on failure (`moveToFinished-14.lua:166`), so attempt 1 ↔ `attemptsMade 0`: the arithmetic is right | `deliver-outbound-webhook.test.ts:341-385` ("C-1: final-attempt transient exhaustion dead-letters", 3 tests incl. breaker+dead-letter double alert); `integration-outbound-processor.test.ts:150,165,180` (3). See N-2 for the interaction with the per-host throttle |
| C-2 resume no-op on jobId dedup | CLOSED | `src/infrastructure/queue/integration-outbound-queue.ts:78-107` `addRelayDeliverJob`: `getJob(deliveryId)` → if `completed`/`failed` → `remove()` → re-add under the same id; in-flight jobs still dedupe; `src/application/sweep-integration-queues.ts:50` relay uses it. Retry keeps `:r1` (`retry-delivery.ts:36`) so a retried-then-paused-then-resumed row also re-runs (relay looks up the base id) | `integration-outbound-queue.test.ts:83-122` (4, mocked); `integration-outbound-queue.c2-real-redis.test.ts:52` (CONTROL reproduces the bug), `:94` (FIX proves second run) — real BullMQ+Redis, gated on `INT001_TEST_REDIS_URL` |
| I-1 pre-auth DB reads + unbounded body buffer | CLOSED (see N-1, N-7) | `src/application/integration-inbound-guard.ts:128-144` `checkPreAuthThrottle` (300/min, burst 50, fails closed 503); `members/route.ts:53-57` first statement, `:63-67` Content-Length check before `request.text()`; `jobs/[jobId]/route.ts:30-34`. Reviewer's fix (c) (load settings after auth) was not taken — `members/route.ts:82` still reads settings pre-auth, now behind the throttle | `integration-inbound-guard.test.ts:310-363` (5); `members/__tests__/route.test.ts:242` (413 from header), `:251` (throttle before either DB read and before body), `:271` (Redis down → 503). Residual: a chunked body with no Content-Length is still fully buffered before the byte check (`route.ts:69-72`); bounded by the throttle, not by size |
| I-2 auth-failure bucket keyed on client XFF | CLOSED | `integration-inbound-guard.ts:91-93` key is `int001:rlf:{integrationId}` only; `clientIp` removed from `GuardInboundRequestInput`/`AuthenticateV2Input` (`verify-signature-v2.ts:56-67`) | `integration-inbound-guard.test.ts:299` (structural: no `clientIp` field), `:304` |
| I-3 PII in consent-race error path | CLOSED | `consent-record-repository.ts:36-38` `maskPhoneForError` (last4) in both `ConsentImportError` sites; `applyPartnerAssertedConsent` catches `duplicate_active` and returns `'noop'` (root cause, no retry wasted); `process-member-create-job.ts:53-56,368` redacts any E.164-shaped run in any caught error before job row / Slack / rethrow | `consent-record-repository.test.ts:237,336` (last4 only), `:1100` (race → noop); `process-member-create-job.test.ts:220` |
| I-4 nonce-replay verdict never consumed | CLOSED (owner ruling) | `integration-inbound-guard.ts:48-64` required `digest`, `:220-271`: nonce key drives `replayed`; digest key recorded on every request; nonce reuse + different digest → `chargeAuthFailureAndDecide` (401, same shape); same digest → accepted `replayed:true`; `verify-signature-v2.ts:135` threads `input.digest`; both routes log the same-body replay (`members/route.ts:117-122`, `jobs/[jobId]/route.ts:69-74`). Partner doc updated `docs/integrations/member-api.md:40`. Adversarial check: a modified body can never pass the signature (digest is in the signed base, `webhook-signature.ts`), so the digest rule is a defence for future non-content-addressed endpoints, as the reviewer intended; the concurrent same-nonce interleavings resolve first-writer-wins (see N-6 for the residual) | `integration-inbound-guard.test.ts:192-257` ("I-4: same-nonce reuse is accepted only when the digest also matches", 5); `members/__tests__/route.test.ts:134`; jobs route test file (`I-4` block) |
| I-5 welcome double-send on retry | CLOSED (residual disclosed) | `process-welcome-send-job.ts:90-103` re-reads the create job first; `welcome_outcome === 'sent'` short-circuits before any gate/mint/send. Window "send succeeded, `sent` write never landed" remains, as the artifact says | `process-welcome-send-job.test.ts:197-231` (4) |
| I-6 member-create failed-set PII 7 d | CLOSED | `integration-inbound-queue.ts` `MEMBER_CREATE_REMOVE_ON_FAIL = { count: 1000, age: 3600 }`; welcome-send unchanged 7 d | `integration-inbound-queue.test.ts:47-66` (3) |
| I-7 sticky COALESCE mis-attributes a member's STOP | CLOSED | `supabase/migrations/074_integration_event_origin_mixed_write_fix.sql:83-90,121-128,156-163` — `CASE WHEN existing IS NOT DISTINCT FROM EXCLUDED THEN existing ELSE NULL END` on all three outbox triggers. Transaction-locality verified: origin is `set_config(..., true)` inside the 073 RPCs (`073:174,201,222`), PostgREST runs each request in its own transaction, and `current_origin_integration_id()` (`073:41-53`) maps both NULL and the post-transaction `''` residue to NULL — so the member's STOP (`revokeConsent`, plain `.update()`) always carries NULL and collapses the bucket to NULL in either order. Partner doc explains NULL semantics `member-api.md:298-323` | No committed SQL test; evidence is the WI-14 scratch-DB assertions L/M/N (artifact-reported) plus the formula review above. Acceptable for a trigger; a scratch-DB script under `scripts/` would make it repeatable |
| I-8 breaker streak RMW race | CLOSED | `075_outbound_breaker_atomic_streak.sql:21-49` (single-statement `+1 RETURNING`, threshold trip in the same function, EXECUTE locked to `service_role`); `integration-settings-repository.ts:319-331`; `deliver-outbound-webhook.ts:183-190` decides the alert from the returned value; `updateOutboundBreakerState` kept for the two absolute writes only | `integration-settings-repository.test.ts:364-395` (3); `deliver-outbound-webhook.test.ts:289,309,321` (rewired); WI-14 20-way concurrent psql race (artifact-reported). See N-5 |
| M-1 depth reservation leak | CLOSED | `enqueue-member-create.ts:146-160` try/catch releases before rethrow | `enqueue-member-create.test.ts:180` |
| M-2 retry after create skips welcome | CLOSED (via G-1) | see G-1 | see G-1 |
| M-3 phantom `'upgraded'` on 0 rows | CLOSED | `consent-record-repository.ts` `return didUpgrade ? action : 'noop'` | `consent-record-repository.test.ts:1210` |
| M-4 stale comment | CLOSED | `process-welcome-send-job.ts:42-56` | n/a (docs) |
| M-5 unbounded selects | OPEN (deferred with rationale) | — | — |
| M-6 upgrade RPC ignores `consent_grade` | OPEN (product) | — | — |
| M-7 pre-existing `error.message` on PATCH 400 | OPEN (out of scope, mention only) | — | — |
| M-8 literal-IP outbound host | OPEN (policy call) | — | — |

### Grok review (`reviews/2026-09-10-int-001-grok`)

| Finding | Status | Fix (file:line) | Test |
|---|---|---|---|
| 🔴 `next@16.2.1` (required change #13) | OPEN — out of scope, tracked | untouched: `package.json:32`, `package-lock.json:10885-10887`; kanban `SEC-005` (priority high, related INT-001) | Deploy precondition, listed separately in the verdict |
| #1 welcome skipped on create-job retry | CLOSED | `process-member-create-job.ts:276-302` reads own job row first, `recordMemberJobMemberId` (`integration-member-job-repository.ts:237-244`) immediately after `created`, `createdByThisJob` exact-match feeds the welcome decision | `process-member-create-job.test.ts:298-353` (4, incl. genuine-pre-existing and different-member negatives). See N-4 |
| #2 welcome coupon has no unique index | CLOSED | `076_coupon_welcome_member_unique.sql:53-55` partial unique on `(restaurant_id, member_id) WHERE type='welcome' AND member_id IS NOT NULL`; `coupon-repository.ts` `findWelcomeCouponByMember` re-select. Checked: campaign coupons are `type='promo'` (migration 053 index, unaffected); a second restaurant is a different key; legacy welcome minters (`onboard-new-member.ts:112` fallback, `register-member-web.ts`) run once per newly created member only, so the index cannot fire on a legitimate path | `mint-welcome-coupon-idempotent.test.ts:150`; WI-14 20-way + WI-16 2-way scratch races (artifact-reported). **Deploy gate**: run the header's duplicate-pair query on prod before applying (a pre-existing duplicate aborts the migration) |
| #3 WI-7 legacy phone 500 (`E164Phone.of` on `PhoneNumber` output) | PARTIAL | `register-member.ts:53-61`, `register-member-web.ts:36-44` `resolveLegacyMemberE164` (strict first, `parseE164Phone` fallback, rethrow in the legacy `Invalid phone number:` shape so `join/[slug]/route.ts:61` still maps to 400) | `register-member.test.ts:223`, `register-member-web.test.ts:111`, `resolve-legacy-member-e164.property.test.ts:78-105` (fast-check, 5). Gaps in §WI-7 parity below (CSV path not fixed; re-join of a fallback-repaired number breaks) |
| #4 inbound job PII in Redis | CLOSED (via I-6) | — | — |
| #5 fetch-then-compare mutations | CLOSED for every named route | `retry-delivery.ts:29` `findDeliveryByIdForIntegration` (`integration-delivery-repository.ts:74-85`); retry route delegates (`retry/route.ts:30`); `pos-integration-repository.ts` `updatePosIntegration`/`deletePosIntegration` take `restaurantId` in the WHERE, threaded through `configure-pos-integration.ts:67,71,98`; `resume-outbound.ts:53`, `send-test-event.ts`, `set-outbound-secret.ts`, `update-integration-settings.ts` use `findIntegrationSettingsByIdForRestaurant` (`integration-settings-repository.ts:127-138`); `saveDelivery` `:122` and `updateOutboundBreakerState` `:302-303` scoped | `retry-delivery.test.ts:59,67`; retry route test (rewritten, 7); `configure-pos-integration.test.ts:160`; `resume-outbound.test.ts:100`; `send-test-event.test.ts:84`; `set-outbound-secret.test.ts:45`; `update-integration-settings.test.ts:90`; `integration-settings-repository.test.ts:99-142,214`. Residual: a full audit of non-INT-001 dashboard mutations was not attempted (both artifacts disclose this) — follow-up ticket, not a branch blocker |
| #6 raw `Error.message` on the partner wire | PARTIAL | Phone: closed by I-3 (mask + noop + redaction). Restaurant id: `ConsentImportError` still embeds `restaurantId`, but that error no longer propagates on the partner path (noop). Remaining: `process-member-create-job.ts:371` persists the redacted *raw* message under code `'internal'`, and `member-job.ts:70` `partnerView()` returns it verbatim — Postgres/driver error text still reaches the partner (T-M3 hygiene, not PII) | `process-member-create-job.test.ts:220` covers the redaction only. Fix: persist a generic message for the partner view, keep the raw one server-side |
| #7 consent grade `weak` without attestation | OPEN — product/doc decision | Code unchanged (`process-member-create-job.ts:305-308`). Note: this is the resolution the threat model §11 (OD-13) explicitly recommended; the stale side is the spec's "always strong" wording, not the code | — |
| #8 resume `Promise.all` over 500 rows | CLOSED | `resume-outbound.ts:33-40` `RESUME_CONCURRENCY_LIMIT = 20` batches (commit `fb61330`). Reviewer's bulk-UPDATE alternative not taken; batching addresses the shared-VM contention concern | `resume-outbound.test.ts:169` ("finding #8: never more than RESUME_CONCURRENCY_LIMIT … in flight") |
| Minor 1 replay short-circuit | OPEN (superseded by I-4 ruling; T-H3b already dedupes) | — | — |
| Minor 2 `partnerView` extras | OPEN (contract question) | — | — |
| Minor 3 `ping` fans out to all integrations | OPEN (disclosed) | — | — |
| Minor 4 trigger lacks row lock | OPEN (not reachable via `applyPartnerAssertedConsent`) | — | — |
| Minor 5 NAT64/6to4 ranges | OPEN | — | — |

## Adversarial re-checks

### (a) Outbound delivery lifecycle

Traced: `queued → delivering → retrying ×4 → (final) dead_lettered + Slack` (C-1); `dead_lettered → Retry → queued(:r1 job) → …` (`retry-delivery.ts`); `retrying → (breaker) paused (job completes) → Resume → queued, enqueued_at NULL → relay → addRelayDeliverJob removes the completed job → new job runs` (C-2). `addRetryDeliverJob` keeps `:r1`, and `addRelayDeliverJob` always looks up the base id, so retry→pause→resume also re-runs. Migration 075's RPC serialises on the row lock; the alert decision uses the returned value. Two defects found:

- **N-2** (`integration-outbound-processor.ts:83`) — BullMQ 5.76.5's `moveToDelayed` increments `atm` unless `skipAttempt` is passed (`moveToDelayed-12.lua:67-69`, `scripts.js:786`); the per-host throttle path calls `job.moveToDelayed(ts, token)` with no opts. Four throttle deferrals make the fifth pickup `isFinalAttempt`, so the first real HTTP transient failure dead-letters and alerts. Pre-fix this same budget loss surfaced as the C-1 "stuck in retrying" bug; the C-1 fix now makes it a spurious dead-letter. Under a 500-row CSV import fanning out to one host at 10 req/s with concurrency 2, multiple throttle rounds per job are routine. The Retry-After path (`:103`) should keep counting (it was a real attempt).
- **N-3** (`retry-delivery.ts:34`, `integration-delivery-repository.ts:160-172`) — a row dead-lettered by `resumeOutbound`'s over-cap branch (`resume-outbound.ts:82-94`) was born `paused` from the fan-out trigger (`071:97-104`) and never enqueued, so `enqueued_at` is NULL. Retry moves it to `queued` without stamping `enqueued_at` and adds `:r1`; within 30 s the relay also selects it (`queued AND enqueued_at IS NULL`) and adds a second job under the base id → two concurrent jobs for one delivery under concurrency 2 (double webhook, or one job failing on an illegal `delivered → delivering` transition). Narrow path, but the fix is one line.
- **N-5** (`deliver-outbound-webhook.ts:188-190`) — concurrent over-threshold attempts each get `streak >= 10` back and each fire `alertBreakerTripped`; alert only when `streak === BREAKER_THRESHOLD`. Pre-existing shape, not a regression.

### (b) Inbound guard ordering after I-1/I-2/I-4

Order in `members/route.ts`: pre-auth throttle (`:53`) → Content-Length (`:63`) → body read (`:69`) → content-type → settings read (`:82`) → `authenticateIntegrationV2` (header parse → integration read → HMAC → window/signature → status → kill switch → partner bucket → nonce → digest). The partner bucket `int001:rl:*` is still charged only after a valid signature (`guard:206`); the auth-failure bucket only shapes failed requests; a modified body cannot pass the signature. Two findings:

- **N-1** (`integration-inbound-guard.ts:40-41,110-112,128-144`; `members/route.ts:53`; `jobs/[jobId]/route.ts:30`) — the pre-auth bucket is keyed on `integrationId` alone, a public URL parameter, and gates *all* traffic. An unauthenticated caller sending > 300 req/min of junk to a partner's URL makes the partner's own signed requests 429 at the first statement. T-H5 (required change #9) exists precisely so an unauthenticated caller cannot burn a partner's budget; this fix reintroduces that outcome one bucket earlier. The I-2 reasoning ("sharing across every IP has no correctness cost") is true for the auth-*failure* bucket, which only shapes failed requests, and does not transfer to a gate in front of valid ones. (The analyzer's own I-1 suggestion (b) — short-circuit on the auth-failure bucket — would have had the same flaw at 10/min; the dev's variant is less bad, not correct.) Net effect vs. main is still an improvement (a flood now DoSes one integration instead of the shared DB), which is why this is Important rather than Critical.
- **N-6** (`guard:206` before `:239`) — a captured, validly signed envelope replayed within the 300 s window is accepted as a same-body retry after charging the partner bucket each time; an attacker holding one such capture can exhaust the partner's 60/min for 5 minutes. Requires TLS MITM or a partner-side leak; ordering is the plan's own (step 7 before 8). Note only.
- **N-7** (`members/route.ts:82`, `verify-signature-v2.ts:119`) — a random-id spray still costs two DB reads per distinct id (each id gets its own 300/min bucket); a UUID-format check before the throttle would close it for free.

### (c) Migrations 074 + 076

074: verified as transaction-local (see I-7 row); the partner's own two writes in one bucket stay attributed (`IS NOT DISTINCT FROM`, NULL=NULL agreement), a partner-vs-STOP or partner-A-vs-partner-B collision collapses to NULL in either order and stays NULL. 076: predicate is `type='welcome' AND member_id IS NOT NULL` — campaign/promo coupons (`type='promo'`, migration 053) and welcome coupons on another restaurant are outside the index. Deploy precondition: the header's duplicate query must return 0 rows on prod before the migration is applied.

## WI-7 legacy-path parity after G-3

Seam insert (`member-create-repository.ts:52-63`) writes the same columns the three legacy inserts wrote (`restaurant_id, phone, name, preferred_language, status:'active', loyalty_token`). Post-create side effects are unchanged: WhatsApp keeps `onboardNewMember` + returning flow (`register-member.ts:96-112,153-175`), web keeps campaign/welcome coupon + `join` event (`register-member-web.ts:92-108`), CSV keeps the merge/reject rule (`import-contacts-batch-row-member.ts:49-73`). `onboard-new-member.ts`, `join/[slug]/route.ts`, `send-returning-welcome.ts`, `member-repository.ts` have no diff vs main. Each path additionally publishes `member.created` with its source — intended. WhatsApp inputs are bare digits from the webhook `from`, so `PhoneNumber.create` output is always strict E.164 there; the gaps below affect web QR and CSV only.

- **N-8 (G-3 gap 1, CSV)** — `import-contacts-batch-row-member.ts:54` still calls `E164Phone.of(input.row.phoneE164)`, where `phoneE164` is `PhoneNumber.create(raw).value` (`import-contacts-batch-validation.ts:119-125`). A CSV phone the validator accepted (dots, letters, leading zero after `+`) throws inside `createViaSeam`, is caught at `:67-72`, and the row is rejected with reason `duplicate_active` — pre-branch it was imported as-is. Parity broken for those formats, with a misleading reject reason. Fix: apply the same `resolveLegacyMemberE164` fallback (or normalise once in the validator and use that value for both the lookup and the seam).
- **N-9 (G-3 gap 2, re-join)** — on both fixed paths the pre-check and the race re-select still use the un-repaired `phone.value`: `register-member.ts:73` (`findExistingMember`), `:142` (`findMemberByPhone`), `register-member-web.ts:58`. A member first created through the fallback is stored normalised; the same raw input on a second join misses the pre-check, hits 23505 → `existing`, then the re-select by the dotted value misses → `throw 'race on create but no row found'` (`register-member.ts:143-146`) → 500 on web (`join/[slug]/route.ts:66`). Pre-branch the second join found the dotted row and took the returning flow. Fix: resolve the E.164 once at the top of each function and use `.value` of the resolved phone for lookup, seam, and re-select. The property suite covers the resolver only, not the round trip.

## Test-suite integrity (review-time `1904cab` → `HEAD`)

Removed `it()` blocks and their replacements: retry route ×3 IDOR/404 tests → `retry/__tests__/route.test.ts` "G-5: calls retryDelivery with … scoped ids" + "byte-identical 404", with the IDOR cases moved to `retry-delivery.test.ts:59,67`; `configure-pos-integration.test.ts` "delegates to repository" ×2 and "mints a new secret…" → restaurantId-scoped variants (`:160`); `deliver-outbound-webhook.test.ts` "503 → transient, streak bumped by 1" and "Nth consecutive…" → RPC-based variants (`:289,309`); `sweep-integration-queues.test.ts` "double run → no duplicate jobs" → asserts `addRelayDeliverJob` (the old assertion tested the C-2 bug directly). 26 `expect` lines removed / 185 added, all in the same mechanism-swap files. No weakening found.

## 🟡 Important (new, ranked)

1. **N-1** pre-auth throttle keyed on public `integrationId` lets an unauthenticated caller 429 the partner — `integration-inbound-guard.ts:110-144`, `members/route.ts:53`, `jobs/[jobId]/route.ts:30`. Fix: key the per-integration pre-auth bucket on `(integrationId, trusted client IP)` where the IP is nginx's `X-Real-IP` / rightmost XFF hop (a dedicated helper for the partner routes, not `audit-logger.ts`'s first-hop `extractIp`), and keep a much higher integrationId-only ceiling (e.g. 10× the partner limit) purely as DB protection. Test: "unsigned flood from IP A never 429s signed traffic from IP B on the same integration".
2. **N-2** per-host throttle consumes BullMQ attempts → premature final-attempt dead-letter — `integration-outbound-processor.ts:83`. Fix: `job.moveToDelayed(ts, token, { skipAttempt: true })` on the throttle path only (supported in 5.76.5, `scripts.js:786`); leave `:103` counting. Test in the real-Redis lane: 4 throttle deferrals then a 503 → row `retrying`, not `dead_lettered`.
3. **N-8 / N-9** G-3 parity gaps (CSV reject reason; re-join 500 on fallback-repaired numbers) — see §WI-7. Fix as described; add a round-trip test (create via fallback, join again with the same raw input → returning flow).
4. **G-#6 residual** raw internal error text on the partner wire under code `'internal'` — `process-member-create-job.ts:371`, `member-job.ts:70`. Fix: generic partner message, raw text server-side only.

## 🟢 Minor (new)

- **N-3** retry after resume-overflow dead-letter creates two jobs — `retry-delivery.ts:34`: stamp `enqueuedAt` on the retry transition, or exclude `retried_at IS NOT NULL` in `findDeliveriesToRelay`.
- **N-4** G-1 retry path reports `outcome:'existing'` to the partner and skips the `join` event — `process-member-create-job.ts:321,344`: use `welcomeMemberOutcome` for both.
- **N-5** duplicate breaker-tripped alerts under concurrency — `deliver-outbound-webhook.ts:188`: alert on `streak === BREAKER_THRESHOLD`.
- **N-6** captured-envelope replay charges the partner bucket for 300 s — ordering note only.
- **N-7** random-id spray costs two DB reads per id — add a UUID-format check before the throttle.
- I-7 has no committed, re-runnable SQL test; the scratch-DB assertions live only in the artifact narrative.

## ✅ Strengths

- C-2 was proven with a real BullMQ+Redis control/fix pair rather than a mocked assertion; the CONTROL test reproduces the original bug.
- I-4's implementation caught and documented its own first-draft bug (digest key only recorded on replay) via the frozen test — the record is honest and the final rule is correct.
- Migration 074 uses the strict `IS NOT DISTINCT FROM` formula after the author verified the lenient variant does not fix the scenario; 075 keeps the increment and the trip in one statement with EXECUTE locked to `service_role`.
- G-5 moved the tenant check into the query for every INT-001 mutation, including `saveDelivery` and the breaker write, not only the route grok named.
- The property suite for G-3 found two residual throw shapes the example tests missed and the fix preserved the legacy error contract the join route depends on.

## Open Questions

1. N-1: is `integrationId` treated as public in the threat model (it is a URL parameter shared with partner staff)? If the owner considers it secret-adjacent, N-1 drops to Minor; the fix is cheap either way.
2. Grok #7: the code follows threat model §11's recommended OD-13 resolution; should the spec's "grade strong" wording be amended rather than the code?
3. Migration 076 deploy gate: who runs the duplicate-pair query on prod before the release?

## Verdict: CONDITIONAL

No Critical finding is open on the branch. Every analyzer Critical/Important is closed with a located test; grok's Important set is closed except #3 (partial), #6 (partial, hygiene) and #7 (product). Conditions before merge: N-1, N-2, N-8/N-9. **Deploy precondition, separate from the branch verdict: SEC-005 (`next` upgrade) is untouched and must land before the partner routes are exposed; migration 076's duplicate-pair check must be run on prod first.**

Counts: CLOSED 19 · PARTIAL 2 (G-3, G-#6) · OPEN 11 (SEC-005 out of scope; G-#7 product; M-5/M-6/M-7/M-8 and grok minors 1–5 deferred with rationale).

## Next Steps

1. One cold backend dispatch: N-1 (trusted-IP keyed pre-auth bucket + ceiling), N-2 (`skipAttempt: true`), N-8/N-9 (CSV fallback + resolved-phone round trip), G-#6 residual; optionally N-3/N-4/N-5 as one-liners. Re-run gate incl. the real-Redis lane.
2. Orchestrator: answer Open Questions 1–2; schedule SEC-005 and the 076 prod dedupe check as release gates.
3. Follow-up ticket: full fetch-then-compare audit of non-INT-001 dashboard mutations (grok #5 residual).
