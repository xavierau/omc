# Ops Playbook — INT-001 Member API

Audience: on-call / ops / whoever runs `deploy.sh`.
Covers: the two `integration-inbound` / `integration-outbound` BullMQ queues, their Redis
keys, env vars, the pre-deploy migration gate, secret rotation, and the
breaker/dead-letter/resume runbook for the partner-facing member API
(`docs/integrations/member-api.md` is the partner-facing counterpart to this document).

---

## 1. Env vars

| Var | Default | Required in prod | Read by |
|---|---|---|---|
| `INT_JOBID_KEY` | none — throws if unset when a job id needs minting | **yes** | `src/application/build-member-job-id.ts` (HMAC key for the content-addressed job id / idempotency key) |
| `INT001_SECRET_KEY` | none — throws if unset when the outbound secret box is touched | **yes** | `src/infrastructure/crypto/secret-box.ts` — AES-256-GCM key for the encrypted outbound webhook signing secret. Must decode to exactly 32 bytes (base64 or hex) |
| `INT001_INBOUND_CONCURRENCY` | `4` | no | `integration-inbound-queue.ts` — worker concurrency for `member-create`/`welcome-send` jobs |
| `INT001_OUTBOUND_CONCURRENCY` | `2` (hard-capped at `4` regardless of the value set) | no | `integration-outbound-queue.ts` — worker concurrency for `deliver` jobs |
| `INT001_GLOBAL_QUEUE_CEILING` | `5000` | no | `check-global-queue-ceiling.ts` — total waiting+delayed `integration-inbound` jobs across ALL integrations before every request gets `503 queue_depth_exceeded` |
| `INT001_WELCOME_HOURLY_CAP` | `60` | no | Read independently by `process-member-create-job.ts` (create-time enqueue gate) and `process-welcome-send-job.ts` (send-time gate, own dedicated counter) — both under the same var name, both should move together |
| `INT001_DISABLE_INBOUND` | unset (`=1` to trip) | no (emergency kill switch) | `POST`/`GET` partner routes — `1` makes every request answer `503 feature_disabled` before touching Redis or Postgres |
| `INT001_DISABLE_OUTBOUND` | unset (`=1` to trip) | no (emergency kill switch) | `deliver-outbound-webhook.ts` — `1` marks every attempted delivery `paused` without dialling out; deliveries resume from where they left off once cleared |
| `INT001_TEST_REDIS_URL` | unset | no — **test-only** | Gates the real-Redis lane of every `RateLimiterPort`/queue contract test. Never set in prod; setting it in CI would make CI depend on a live Redis |
| `REDIS_URL` | `redis://localhost:6379` | yes (already required by the pre-existing queues) | Shared by every BullMQ queue and the INT-001 rate limiter/counters — **must carry a password in prod** (see §5) |

`.env.example` has been updated with all nine INT-001-specific vars (see the repo root
file) — copy from there for a new environment rather than retyping this table.

## 2. Deploy preconditions

Both of these gate shipping the new **public, partner-facing** routes — the threat
model (`threats/2026-09-10-int-001-member-creation-api.md` §10, item 13) makes the
first one blocking; do not deploy this feature without them.

### 2a. `next` CRITICAL advisories (kanban SEC-005)

`npm audit` on this worktree (2026-09-10) flags `next@16.2.1` with five advisories
severe enough to block: `GHSA-q4gf-8mx6-v5v3` / `GHSA-8h8q-6873-q5fj` (DoS with Server
Components), `GHSA-26hh-7cqf-hhc6` (middleware/proxy bypass via segment-prefetch),
`GHSA-3g8h-86w9-wvmq` (redirect cache poisoning), `GHSA-ffhc-5mcf-pf4q` (XSS with CSP
nonces), `GHSA-vfv6-92ff-j949` (RSC cache-busting collisions). Kanban `SEC-005` (backlog,
priority high) tracks the bump to patched `16.3.x` — run the mechanical gate + full
`vitest run` + an off-box `next build` (the prod VM cannot build in place — see
`incident_prod_vm_too_small_for_next_build`), then smoke the dashboard and webhooks,
before this feature's public routes go live.

### 2b. Prod Node version for `undici@8.10.2`

WI-5 pinned `undici@8.10.2` (the outbound SSRF-safe sender's HTTP client), which
declares `"engines": { "node": ">=22.19.0" }`. **This worktree's `package.json` has no
`engines` field today, and I could not confirm prod's actual Node minor/patch version**
from anything available to this dispatch:

- `release.sh`'s build-machine gate only asserts `node_major -lt 22` (major version 22,
  not a specific minor/patch) and a comment that "production runs Node 22+" — no exact
  version recorded anywhere in this repo or its `.claude-workspace/deploys/*` runbooks.
- The Laravel Forge account reachable from this environment (`FORGE_API_KEY`, org
  "Xavier Au") does not list a server matching the production box described in memory
  (`project_prod_vm_too_small_for_next_build`: an e2-medium GCP host serving ~17 sites)
  — the servers visible here (`fancy-farm`, `Kai-Magento`, `server-1`, `phb-gcp-sg-server-1`,
  etc.) host unrelated projects with at most 8 sites each. The actual OhMyClient
  production server is not accessible with the credentials available to this dispatch.

**Before shipping this feature, whoever has access to the actual OhMyClient production
box must run `node -v` there and confirm it is ≥ 22.19.0.** Two ways to close this:

- **If prod is ≥ 22.19.0**: add `"engines": { "node": ">=22.19.0" }` to `package.json`
  (not done by this dispatch, since it was not confirmed) so a future deploy fails loud
  instead of silently running `undici` below its declared floor.
- **If prod is < 22.19.0**: downgrade to `undici@7.29.1` (`engines: >=20.18.1`) — a
  one-line `package.json`/lockfile change with **no code changes**, per WI-5's own
  handoff: "I coded to the stable `request`/`Agent`/`connect.lookup` surface, unchanged
  across 7.x→8.x."

## 3. Scratch-DB migration gate (run before every `supabase db push` that includes 069–072)

Migrations 069–072 (integration settings, member jobs, outbound events/deliveries, the
consent partner-guard trigger) were scratch-DB validated twice during development (WI-1's
own pass, and WI-7's — WI-7's pass also caught and fixed a real bug in migration 071's
`member_updated_outbox()` trigger: an untyped string literal made Postgres's `||`
resolve to array-concat instead of array-append, which threw `malformed array literal`
on the very first `UPDATE members SET name = ...` after the migration landed — see
`debugging_journals/2026-09-10-migration-071-array-append-literal.md`). **Re-run this
exact gate before the first `supabase db push` against staging or prod** — it is cheap
(a rolled-back transaction against a disposable scratch database) and it is the only
thing that would have caught that bug before it hit a shared environment.

Build technique (per `project_validate_migrations_on_scratch_db`): a fresh
`scratch_int001_<label>` database, stub `auth.uid()/role()/jwt()` as SQL functions, an
`extensions` schema with `pgcrypto`, `storage.buckets`/`storage.objects`/`storage.foldername`
stubs, and a `supabase_realtime` publication if one doesn't exist — then apply every
migration in `supabase/migrations/*.sql` in filename order, `BEGIN`, run the fixtures
and assertions below, `ROLLBACK`, drop the database.

```sql
BEGIN;

INSERT INTO restaurants (id, name, slug, whatsapp_number)
VALUES ('11111111-1111-1111-1111-111111111111', 'Scratch Cafe', 'scratch-cafe-wi7', '85290000000');

INSERT INTO pos_integrations (id, restaurant_id, name, webhook_secret, credentials)
VALUES ('22222222-2222-2222-2222-222222222222', '11111111-1111-1111-1111-111111111111', 'Scratch POS', 'sec', '{}'::jsonb);

INSERT INTO integration_settings (integration_id, restaurant_id, outbound_url, outbound_events, outbound_enabled, outbound_pii_ack_at)
VALUES ('22222222-2222-2222-2222-222222222222', '11111111-1111-1111-1111-111111111111',
        'https://partner.example.com/hook', ARRAY['member.created','member.updated'], true, now());

-- One member per assertion -- avoids the 5-second coalesce bucket merging
-- separate column-changes into a single event row.
INSERT INTO members (id, restaurant_id, phone, name, status, loyalty_token)
VALUES
  ('33333333-3333-3333-3333-333333333333', '11111111-1111-1111-1111-111111111111', '+85291110001', 'A', 'active', 'tok1'),
  ('44444444-4444-4444-4444-444444444444', '11111111-1111-1111-1111-111111111111', '+85291110002', 'B', 'active', 'tok2'),
  ('55555555-5555-5555-5555-555555555555', '11111111-1111-1111-1111-111111111111', '+85291110003', 'C', 'active', 'tok3');

-- Assertion A: profile change (mirrors updateMemberPreferredLanguage).
UPDATE members SET preferred_language = 'zh_hk' WHERE id = '33333333-3333-3333-3333-333333333333';
-- expect: 1 row in integration_events WHERE member_id = '333...' AND type = 'member.updated'
--   AND changed = ARRAY['language'] AND origin_integration_id IS NULL;
-- expect: 1 row in integration_deliveries WHERE event_id = <that event> AND integration_id =
--   '222...' AND status = 'queued'.

-- Assertion B: status change (mirrors STOP's handleUnsubscribe raw UPDATE).
UPDATE members SET status = 'unsubscribed' WHERE id = '44444444-4444-4444-4444-444444444444';
-- expect: 1 row, type='member.updated', changed = ARRAY['status']; 1 queued delivery, same shape as A.

-- Assertion C: consent change.
INSERT INTO consent_records (restaurant_id, member_id, phone_e164, category, status, source)
VALUES ('11111111-1111-1111-1111-111111111111', '55555555-5555-5555-5555-555555555555',
        '+85291110003', 'marketing', 'opted_in', 'scratch-test');
-- expect: 1 row, type='member.updated', changed = ARRAY['consent']; 1 queued delivery, same shape as A.

-- Assertion D (negative): points must never produce an event.
UPDATE members SET points_balance = 50 WHERE id = '33333333-3333-3333-3333-333333333333';
-- expect: 0 rows in integration_events WHERE member_id = '333...' AND type = 'member.updated'
--   AND 'points' = ANY(changed) -- i.e. no new event row attributable to this UPDATE.

-- Assertion E (T-C1 / OD-14, from WI-1's own pass): STOP-then-delete-member-then-create
-- for the same (restaurant, phone, category) must still be blocked by migration 072's
-- trigger -- confirm zero new marketing consent_records rows land for a partner_api
-- insert once that identity's latest row is opted_out, independent of member_id.

ROLLBACK;
```

If assertion A or B fails with `malformed array literal`, migration 071 has regressed
to the pre-fix state — check `member_updated_outbox()`'s three `changed_cols := ... ||`
lines all cast the literal to `::text` before array-append.

## 4. Redis keys this feature owns

| Key pattern | TTL | Purpose |
|---|---|---|
| `int001:preauth:{integrationId}:{trustedClientIp}` | 120s (re-armed on every use) | **(WI-14 I-1, re-keyed WI-17 N-1)** cheap pre-auth throttle, generous (300/min, burst 50) — checked BEFORE any Postgres read or body buffering, needs no DB row. **Ops precondition**: nginx MUST set `X-Real-IP` to the real connecting peer (or append it as the rightmost `X-Forwarded-For` hop via `$proxy_add_x_forwarded_for`) — `extractTrustedClientIp` reads ONLY those two, never the client-supplied leftmost XFF hop. Without that header set correctly every request resolves to the shared `'unknown'` bucket, degrading back to the pre-N-1 integrationId-only behaviour (an unauthenticated flood could then 429 the partner's own traffic) |
| `int001:preauthceil:{integrationId}` | 120s (re-armed on every use) | **(WI-17 N-1)** integrationId-ONLY last-resort ceiling, 10x the per-ip rate/burst (3000/min, burst 500) — bounds aggregate DB-read cost against a genuinely distributed flood (many real IPs each individually under the per-ip limit above); only requests that already clear the per-ip bucket count against it |
| `int001:idem:{jobId}` | 24h (86400s) | fast-path idempotency cache for a create request's content-addressed job id — Postgres's `job_id` primary key is the actual correctness backstop |
| `int001:depth:{integrationId}` | none (plain counter, INCR/DECR) | per-integration in-flight job count against `inbound_queue_cap` (default 500) — reconciled against Postgres every 5 minutes, see §7 |
| `int001:rl:{integrationId}` | 120s (re-armed on every use) | partner token bucket (default 60/min, burst 20) |
| `int001:rlf:{integrationId}` | 60s fixed window | auth-failure bucket (10 failures/60s trips a `429` before the partner bucket is ever charged) — **(WI-14 I-2)** keyed on `integrationId` alone, NOT `{clientIp}` as originally shipped: the client IP came from `X-Forwarded-For`'s first hop, which an attacker behind an append-only proxy controls, so the per-IP key was bypassable by rotating IPs. An unauthenticated caller can't burn a *partner's* budget with this bucket regardless (that's `int001:rl:*` above, charged only post-signature), so sharing it across every IP hitting one integration has no correctness cost |
| `int001:replay:{integrationId}:{nonce}` | 600s (10 min) | nonce-replay dedup — defense in depth; the real retry-safety net is `int001:idem:*` above. **(WI-14 I-4)** the verdict is logged (`[IntegrationInboundAuth] replayed nonce`) but does NOT reject the request — the partner doc (§2) documents a repeat nonce as "treated as a retried, not a new, request", and POST is already content-addressed (T-H3b) so rejecting would both break that documented contract and duplicate work the idempotency cache already does for free |
| `int001:welcome:{restaurantId}:{yyyymmddhh}` | ~1h fixed window | create-time welcome-send enqueue gate (bounds how many `welcome-send` jobs get created in an hour) |
| `int001:welcome:sent:{restaurantId}:{yyyymmddhh}` | ~1h fixed window | **separate** send-time gate inside the `welcome-send` job itself — see WI-4's handoff for why this is intentionally a second counter, not a re-read of the one above |
| `int001:host:{hostname}` | 120s (re-armed on every use) | per-destination-host outbound throttle (10 req/s) — fails **open** on a Redis error (a worker-side throttle, not the request-path T-H5 limiter, which fails closed) |

All INT-001 Redis keys are namespaced under the `int001:` prefix plus BullMQ's own
`bull:integration-inbound:*` / `bull:integration-outbound:*` job/queue keys — a
`redis-cli --scan --pattern 'int001:*'` or `'bull:integration-*'` finds everything this
feature has written.

**(WI-14 I-6) `member-create` job retention shortened.** Both `integration-inbound`
job types used to share a 7-day `removeOnFail` window. `member-create` job data
carries phone/name/metadata (the normalised request body); `welcome-send`'s is
ids-only (T-H7). Leaving a week of partner-submitted PII in Redis's failed set on
every exhausted create was unnecessary — the `integration_member_jobs` Postgres row
already carries everything needed for triage (`phone_last4`, `error_code`,
`error_message`, now redacted of any phone-shaped substring — see I-3 below). Fixed:
`member-create`'s `removeOnFail.age` is now **1 hour** (enough to catch a failure on
the BullMQ dashboard shortly after it happens); `welcome-send` is unchanged at 7 days.
If ops ever needs longer BullMQ-level retention for `member-create` failures, raise
this window rather than reaching into the failed-job payload for its own sake — the
data ages out of Postgres via the existing 30-day delivery-log/event pruning either
way.

**(WI-14 I-3) Consent-error PII.** A `ConsentImportError('duplicate_active', …)` used
to embed the full E.164 phone number in its message; that message could reach the job
row's `error_message`, a Slack alert, and the worker's failed-job log line. Fixed at
the source (`consent-record-repository.ts` masks to last4) and structurally (a
concurrent-create race that used to throw this error is now caught and treated as a
benign `noop` — the row already exists, written by the whichever request won). A
second, general-purpose layer in `process-member-create-job.ts` also redacts any
E.164-shaped substring in ANY caught error's message before it's persisted/alerted, as
defense in depth against a future regression elsewhere on this path.

## 5. Redis sizing

Per the plan's perf budgets (`plans/2026-09-10-int-001-member-creation-api.md`
§Performance Budgets), measured by the WI-11 load test (§load test below):

- ≤ 16 MB per 10,000 waiting `integration-inbound` jobs.
- All INT-001 keys combined ≤ 64 MB at the load-test peak (`redis-cli INFO memory`
  delta before/after).
- Worker RSS growth ≤ 100 MB across a full load-test run; steady-state ≤ 350 MB for the
  whole worker daemon (the VM this shares with 17 other sites is 4 GB total per
  `incident_prod_vm_too_small_for_next_build` — this budget is not generous).

**`REDIS_URL` must carry a password in prod** (plan §Rollout precondition, T-H7). Verify
on the box: `redis-cli -u "$REDIS_URL" PING` should require auth; if it succeeds with no
password, that's a live finding — the inbound rate limiter, idempotency cache, and job
counters are the only thing standing between an unauthenticated partner request and an
unbounded queue, and an open Redis port lets anyone bypass all of it directly.

## 6. Forge daemon restart

No new Forge Scheduled Job is needed — the sweeper (`sweep-integration-queues.ts`) runs
as a BullMQ job scheduler *inside* the existing worker process, not a cron-triggered
route (the plan deliberately avoided the
`principle_documented_env_var_is_not_a_scheduled_job` trap this way).

What IS new: `scripts/start-worker.ts` now starts two more workers,
`integration-inbound` and `integration-outbound`, alongside the four pre-existing ones
(`campaign`, `event-dispatch`, `receipt`, `email-send`). The worker daemon is already
restarted by `deploy.sh` on every deploy (`restart_daemon "worker" "start-worker" "daemon-801730"`,
matched by the `start-worker` command-line pattern regardless of the daemon's
auto-generated Forge program name) — **no `deploy.sh` change is needed**, but confirm
after the first deploy that includes this feature:

```bash
sudo -n /usr/bin/supervisorctl status 'daemon-801730:*'
```

and check the worker's stdout log for the startup line:

```
Workers started: campaign, event-dispatch, receipt, email-send, integration-inbound, integration-outbound
```

If either new worker is missing from that line, the daemon restarted against a build
that doesn't include this feature's `scripts/start-worker.ts` changes — re-deploy rather
than restarting again.

## 7. Per-integration depth counter: automatic rebuild (WI-13)

`int001:depth:{integrationId}` is only ever incremented at enqueue and decremented at
job-terminal-state (`enqueue-member-create.ts`, `process-member-create-job.ts`) — a
worker crash between "reserve the depth slot" and "release it in the job's `finally`"
would otherwise permanently inflate that integration's counter, eventually giving every
request from that integration a false `503 queue_depth_exceeded` even though nothing is
actually queued.

The 5-minute maintenance sweep (`sweep-integration-queues.ts`'s `runMaintenanceSweep`,
via `reconcile-integration-depth-counters.ts`) now closes this: every tick, it re-derives
each integration's true in-flight count from `integration_member_jobs WHERE status IN
('queued','processing')` (Postgres — "a counter is a cache, the table is truth") and
corrects the Redis counter if it disagrees, in **either** direction (too high from a
lost job, or too low/zero after a Redis flush). No drift → no write; a correction is
logged (`[reconcileIntegrationDepthCounters] corrected drift`) with the integration id,
previous count, and true count. One integration failing to reconcile (a transient Redis
error) never blocks the others or the rest of the sweep tick.

**Manual recovery**, if you need to correct one integration immediately rather than wait
for the next tick:

```bash
npx tsx scripts/ops/reconcile-integration-depth.ts <integrationId>
```

This calls the same `reconcileIntegrationDepthCounter` function the sweep itself uses
(`src/application/reconcile-integration-depth-counters.ts`) — it reads Postgres, writes
Redis only if they disagree, and prints what (if anything) changed. This replaces the
old raw `SELECT count(*) ...` + `redis-cli SET` recipe with a single command that can't
be run against the wrong integration id by a copy-paste typo between two terminals.

Symptom that should make you check this: an integration reports `503
queue_depth_exceeded` on every request but its dashboard Activity tab shows no
`queued`/`processing` jobs — this should now self-heal within 5 minutes; if it
persists, check the worker logs for repeated
`[reconcileIntegrationDepthCounters] ... failed` warnings for that integration.

## 8. Secret rotation

Two separate secrets, two separate rotation stories:

- **Inbound `webhook_secret`** (yours → the partner signs with it) — **platform-minted**.
  Rotate via `POST /api/dashboard/pos-integrations/[id]/rotate-inbound-secret`
  (admin-gated). The new secret is shown **once** in the response and never again — the
  dashboard only ever shows the last 4 characters after that. The partner must update
  their signer immediately; there is no grace period where both the old and new secret
  verify (unlike the outbound secret below). Coordinate the swap with the partner before
  rotating, or their requests will start failing `401` the instant you rotate.
- **Outbound signing secret** (the partner → you sign responses/deliveries with it) —
  **partner-minted**, saved via `PUT /api/dashboard/pos-integrations/[id]/outbound-secret`
  (≥ 16 chars). Rotation is **immediate and sign-at-attempt-time**: `deliver-outbound-webhook.ts`
  reads the *current* decrypted secret fresh on every delivery attempt, so a delivery
  already queued when the secret changes automatically signs with the new secret on its
  next attempt — no in-flight deliveries are stranded on the old secret. The dashboard's
  own save-time warning covers the one real risk: deliveries in flight **at the exact
  moment of the swap** may have been signed with the old secret and fail verification on
  the partner's side; they retry under normal backoff and succeed once both sides agree
  on the new secret.
- **`INT001_SECRET_KEY`** (the AES-256-GCM key encrypting the outbound secret column) —
  manual rotation, no tooling exists (explicitly out of scope per the plan). Rotating it
  without a migration to re-encrypt every `outbound_secret_enc` row would make every
  existing row undecryptable — do not rotate this in place; if it must change, that's a
  dedicated follow-up work item with a re-encryption pass.
- **`INT_JOBID_KEY`** — rotating it changes every future job id's HMAC input, so any
  outstanding partner-side idempotency assumption keyed on the old id scheme is
  unaffected (job ids are opaque to partners), but any client-side caching of "this is
  the job id for that submission" tied to the old key's output is moot going forward.
  Safe to rotate; document the rotation date if partners ever ask why job ids "look
  different" after a given point in time.

## 9. Breaker / dead-letter / resume runbook

**Breaker.** `BREAKER_THRESHOLD = 10` (hardcoded, not an env var — deliberately absent
from `.env.example`; see `deliver-outbound-webhook.ts`'s own comment on why an
undocumented knob would fail the plan's Integration Map check silently). 10
**consecutive transient failures** (5xx/408/429/timeout/DNS/connection-reset) flips
`outbound_status` to `paused_auto`, stamps `outbound_paused_at`, and alerts Slack
(`SLACK_WEBHOOK_URL_PLATFORM`, pre-existing var, `notifyOpsAlert({ kind:
'engineering_alert' })`). A single success resets the streak to 0. **Permanent**
failures (4xx except 408/429, SSRF rejection, bad URL, missing secret) dead-letter
immediately and do **not** touch the breaker streak — a post-secret-rotation dead-letter
storm must not also trip the breaker (T-M4).

**Dead-letter.** One permanent-failure attempt → `dead_lettered`, one Slack alert per
event (`{eventId, integrationId, httpStatus, errorCode}` only — never the request/response
body, T-L4). Find dead-lettered rows:

```sql
SELECT id, event_id, last_http_status, last_error_code, dead_lettered_at
FROM integration_deliveries
WHERE integration_id = '<id>' AND status = 'dead_lettered'
ORDER BY dead_lettered_at DESC;
```

**Retry** (owner-triggered, `POST /api/dashboard/pos-integrations/[id]/deliveries/[deliveryId]/retry`):
one re-attempt with a fresh attempts budget. Retry is **one-shot per delivery**: once
used — whether or not the retried attempt also dead-letters — a second `retry` call on
the same delivery always returns `409 already_retried`. If the underlying cause (bad
URL, dead endpoint, expired secret) wasn't actually fixed before retrying, don't expect
a second retry to help; fix the root cause and use per-integration **Resume** (below)
once new deliveries are flowing again, rather than hammering retry on one row.

**Resume** (owner-triggered, `POST /api/dashboard/pos-integrations/[id]/outbound/resume`):
resets the failure streak to 0, sets `outbound_status = 'active'`, and re-queues every
`paused` row up to `inbound_queue_cap` (an inbound setting, reused here — a disclosed
cross-purpose reuse, not a typo) — anything beyond that cap is dead-lettered rather than
silently dropped or unboundedly queued. `422 url_invalid` if the saved outbound URL no
longer validates (fix the URL first).

**Test event** (`POST /api/dashboard/pos-integrations/[id]/outbound/test`): a `ping`
event through the identical delivery path, against the **saved** URL only — cannot be
used to probe an arbitrary URL. Note: migration 071's fan-out trigger has no
per-integration scoping for `ping` specifically, so a restaurant with two enabled
integrations sees **both** receive a ping when the owner tests either one (harmless — no
PII in a ping payload — but a disclosed UX surprise, not a bug you need to chase).

## 10. Kill switches — quick reference

| Var | Effect when `=1` | What still works |
|---|---|---|
| `INT001_DISABLE_INBOUND` | Every `POST`/`GET` on the two partner routes answers `503 feature_disabled` before touching Redis or Postgres | Outbound deliveries, dashboard, everything else |
| `INT001_DISABLE_OUTBOUND` | Every delivery attempt is marked `paused` without dialling out; nothing is lost — deliveries drain automatically once the flag is cleared (the relay keeps re-selecting them) | Inbound member creation, polling, dashboard |

Both default to prod behaviour (enabled) when unset — these are emergency-only, not a
normal on/off toggle for a single integration (use the per-integration `status`/
`outbound_status` fields on the dashboard for that).

## 11. Load test

`scripts/load/int001-inbound.ts` — see its own header comment for invocation and what
it measures against the plan's perf budgets. Run it against a local `next dev` + worker
+ Redis before every merge that touches the hot path (auth, validation, enqueue, or the
delivery attempt), and once against staging before the first production deploy of this
feature.
