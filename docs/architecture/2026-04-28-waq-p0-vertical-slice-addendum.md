# WAQ P0 Vertical Slice — Revision Addendum

Date: 2026-04-28
Status: Patches the original design at `docs/architecture/2026-04-28-waq-p0-vertical-slice.md`
Purpose: Apply review feedback from code-review-analyzer and Gemini. References sections by their original numbers; supersedes only the stated passages.

---

## Critical fixes

### Patch §5.3 + §5.4 — Restore claim-then-process idempotency (analyzer)

**Why**: My §5.4 sketch checks `alreadyProcessed(idempotencyKey)`, then runs the handler, then calls `markProcessed`. Two concurrent Kapso retries can both clear the read, both run `dispatchErrorAction`, and emit duplicate `events` rows + double-mutate `members.pmm_throttled_until`. The existing inbound path at `src/app/api/webhooks/whatsapp/route.ts:108-127` already does it correctly with `INSERT ... ON CONFLICT (PG error 23505)` as an atomic claim. Reuse that.

**§5.3 replacement** — idempotency keying stays `kapsoMessageId:status`, but write *before* dispatch using the existing helper:

```typescript
// Reuses tryMarkProcessed from route.ts:108-127, lifted to a shared helper
// at src/infrastructure/supabase/idempotency.ts so both inbound and status
// branches call the same function.
const claim = await tryMarkProcessed(`${status.id}:${status.status}`, log)
if (claim === 'duplicate') return  // another worker already handling this
```

**§5.4 replacement sketch** — claim first, dispatch second, release claim if we cannot resolve the message yet:

```typescript
export async function handleStatusUpdate(
  status: MessageStatusUpdate,
  restaurantId: string,
  log: LogFn,
): Promise<void> {
  const idempotencyKey = `${status.id}:${status.status}`
  const claim = await tryMarkProcessed(idempotencyKey, log)
  if (claim === 'duplicate') return

  const message = await findMessageByKapsoIdWithRetry(status.id)  // see §4.2 patch
  if (!message) {
    // RACE: BSP webhook arrived before we UPDATEd kapso_message_id.
    // Release the claim so Kapso's retry (or a sibling worker) can succeed.
    await releaseIdempotencyKey(idempotencyKey)
    log('warn', 'status.unknown_message', { kapsoMessageId: status.id })
    return
  }

  const updated = await applyStatusUpdate(status.id, mapStatusUpdate(status))
  if (updated?.snapshot.status === 'failed' && updated.snapshot.errorCode) {
    await dispatchErrorAction(updated, restaurantId, log)
  }
  // Claim row stays — successful processing is final.
}
```

`releaseIdempotencyKey(key)` is a one-line `DELETE FROM processed_webhooks WHERE idempotency_key = $1`. It exists *only* on the orphan-claim path; it must never be called after `dispatchErrorAction` so duplicates remain blocked once side effects fire.

`tryMarkProcessed` becomes a typed return (`'new' | 'duplicate' | 'error'`) instead of a `NextResponse | null` so it's reusable from the status branch. That's a tiny refactor, ~10 lines; bundle into the WAQ-002 PR.

---

### Patch §5.2 — Move sandbox capture to day 0 (analyzer)

**Why**: §8.1 admits the SDK's `MessageStatusUpdate.errors` is loosely typed and Kapso's pass-through behaviour is unconfirmed. If our assumption is wrong, two days of repository + send-instrumentation code targets the wrong shape. A 30-minute sandbox call before any code starts is cheap insurance.

**Replacement plan in §5.2** — keep the `normalizeWebhook` recommendation, but stamp it as conditional:

> **Day-0 prerequisite (before any WAQ code merges):** capture three real Kapso webhook payloads in the sandbox account: (a) successful `delivered`, (b) successful `read`, (c) `failed` with error code 131049 against an invalid recipient. Save them to `docs/playbooks/fixtures/kapso-status-*.json` so the integration tests in §7.3 use real shapes, not synthetic ones. Confirm `errors[0].code` field path; if Kapso wraps differently, adjust `mapStatusUpdate` before §1 begins.

**Acceptance gate**: WAQ-001 day-1 PR cannot start until the three fixture files exist on the branch.

---

### Patch §4.2 — Bounded retry on `findByKapsoMessageId` miss (both reviewers)

**Why**: I called the race "sub-second; we accept it". Gemini correctly notes this can be >1% of webhook traffic in real load — a marketing-heavy tenant sending 2k/day means ~20 lost status events/day, which corrupts delivery-rate metrics that WAQ-008 will read.

**Replacement helper** — a single retry with a fixed 250ms backoff, reused by `handleStatusUpdate`:

```typescript
// src/application/find-message-by-kapso-id.ts
const RETRY_DELAY_MS = 250

export async function findMessageByKapsoIdWithRetry(
  kapsoMessageId: string,
): Promise<WhatsAppMessage | null> {
  const first = await findByKapsoMessageId(kapsoMessageId)
  if (first) return first
  await delay(RETRY_DELAY_MS)
  return findByKapsoMessageId(kapsoMessageId)
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
```

Why these numbers:
- `recordOutboundSend` issues the UPDATE immediately after `await client.messages.send*()` resolves. The Kapso → us status webhook fires from Meta's side after Kapso receives the BSP `messages.write` ack, then proxies to us. Median total round-trip from BSP-ack to our handler is ~150-300ms in the existing inbound path. A 250ms wait covers >90% of the race.
- One retry, not many. Persistent misses (BSP id never written) are real lost messages; we want them surfaced via `unknown_message` log so ops can investigate, not buried under indefinite retries.
- This is application-layer, not webhook-layer, so the route handler stays under its 5-second response budget even on the slow path.

If the second lookup also misses: `releaseIdempotencyKey` (per §5 patch) so Kapso's own webhook retry has another chance ~30s later.

---

### Patch §4.3 — Read feature flag once per batch (analyzer)

**Why**: My §4.3 says `recordOutboundSend` checks `WAQ_TRACK_MESSAGES` per call. If ops flips the env mid-campaign (or a deploy rotates the runtime mid-batch), in-flight `queued` rows become orphans because subsequent calls in the same batch will skip the UPDATE.

**Replacement** — read once at the top of `executeCampaign` and propagate via `SendContext`:

```typescript
// src/application/execute-campaign.ts (revised buildSendContext)
async function buildSendContext(
  campaign: Campaign,
  restaurantId: string,
  template: WhatsAppTemplate | null,
): Promise<SendContext> {
  const phoneNumberId = await getRestaurantPhoneNumberId(restaurantId)
  const restaurantDefaultLanguage = await getRestaurantDefaultLanguage(restaurantId)
  const trackingEnabled = process.env.WAQ_TRACK_MESSAGES === '1'  // captured once
  return { campaign, phoneNumberId, template, restaurantDefaultLanguage, trackingEnabled }
}
```

```typescript
// src/application/execute-campaign-batch.ts (revised SendContext)
export interface SendContext {
  campaign: Campaign
  phoneNumberId: string
  template: WhatsAppTemplate | null
  restaurantDefaultLanguage: string | null
  trackingEnabled: boolean   // ← new field
}
```

`recordOutboundSend` accepts `trackingEnabled` as part of its args object (already an object param, so no signature churn). Default to `false` in test fixtures unless the test specifically exercises tracking.

Same change in any other entry point that builds a `SendContext` (welcome campaign, manual test-send) — capture once, pass down.

---

### Patch §4.1 + §0 — Promote `WhatsAppMessagingPort` change to first-class scope (analyzer)

**Why**: I phrased the port-return-type change as a side-effect of the slice. It is the load-bearing change: without it, `kapso_message_id` is permanently NULL, the §11 WAQ-001 acceptance criterion ("non-null `kapso_message_id`") is unachievable, and §6 error dispatch has no key to look up against. Treat it as a peer of the schema migration, not an aside.

**§0 addendum** — append a third bullet:

> 3. A breaking-but-additive change to `WhatsAppMessagingPort` (`src/domain/ports/whatsapp-messaging.ts`) and its Kapso adapter so the BSP-returned `wamid` reaches the application layer. Today's `Promise<void>` discards it; this slice cannot succeed without the port returning `SendResult`. All three downstream tasks depend on this single change.

**§4.1 reframing** — keep the technical content but replace the opening sentence:

> The `WhatsAppMessagingPort` return-type change is the keystone of WAQ-001. Until this lands, `whatsapp_messages.kapso_message_id` cannot be populated, and webhook correlation in WAQ-002 has nothing to join on. Schedule it as the **first** PR in the slice (before any DB writes), and treat its merge as the gate for everything else.

**§9 implication** — moves to day 1 (see §9 patch below). It is no longer "while we're in there".

---

### New section §6.4 — Reconciliation sweep for orphaned `queued` rows (Gemini)

**Why**: Gemini's strongest catch. The two-phase pattern (`INSERT queued → BSP call → UPDATE sent`) leaves rows stuck at `queued` if the worker process crashes or the request is killed between steps 1 and 3. These are silent corruption: Meta still bills for the send, the recipient still got the message, but our row says `queued` forever. WAQ-008 metrics would under-report sends; cooldown logic in WAQ-007 would not see a recent send.

**New helper** — `src/application/reconcile-orphan-messages.ts`:

```typescript
const ORPHAN_AGE_MIN = 5

export async function reconcileOrphanMessages(): Promise<{ swept: number }> {
  const supabase = createServerSupabaseClient()
  const cutoff = new Date(Date.now() - ORPHAN_AGE_MIN * 60_000).toISOString()
  const { data, error } = await supabase
    .from('whatsapp_messages')
    .update({
      status: 'failed',
      failed_at: new Date().toISOString(),
      error_code: 'internal_orphan',
      error_title: 'Orphaned queued row — process likely crashed mid-send',
    })
    .eq('status', 'queued')
    .is('kapso_message_id', null)
    .lt('queued_at', cutoff)
    .select('id')
  if (error) throw new Error(`reconcileOrphanMessages: ${error.message}`)
  return { swept: data?.length ?? 0 }
}
```

**Cadence**: every 5 minutes. **Where**: a Vercel cron route at `src/app/api/cron/reconcile-orphan-messages/route.ts` (the project does not have a worker process; cron routes are how scheduled work runs today). Authenticate via `process.env.CRON_SECRET` header check, mirroring whatever existing cron routes use.

**Critical caveat** documented in code and runbook: `error_code='internal_orphan'` does **not** mean Meta did not send the message. It means *we lost track of whether they did*. The dispatcher in §6 explicitly excludes `internal_orphan` from member mutations (no `pmm_throttled_until`, no `unreachable_at`) — `classifyErrorCode('internal_orphan')` returns `{ action: 'log_only', severity: 'warn' }`. WAQ-008 reports treat orphan rows as a separate bucket from real failures.

**Acceptance addition for WAQ-001 (§11)**: orphan sweep route exists, deployed cron schedule confirmed, and a unit test verifies a row stuck at `queued` for 6 minutes flips to `failed/internal_orphan`.

---

## Important fixes

### Patch §1.1.3 — Service-role-only writes; SELECT-only RLS

**Why**: Service-role key (`SUPABASE_SERVICE_ROLE_KEY` in `src/infrastructure/supabase/client.ts:11-16`) bypasses RLS unconditionally. The `INSERT`/`UPDATE` policies I wrote could never have any effect — they were dead code suggesting a guarantee we don't enforce.

**Replacement DDL**:

```sql
ALTER TABLE whatsapp_messages ENABLE ROW LEVEL SECURITY;

-- Writes: service role only (bypasses RLS). Application code at
-- src/infrastructure/supabase/repositories/whatsapp-message-repository.ts
-- is the single writer; no INSERT/UPDATE policy is granted to authenticated
-- users by design.

-- Reads: tenant-scoped for dashboards; platform admin sees all.
CREATE POLICY whatsapp_messages_select ON whatsapp_messages
  FOR SELECT USING (
    restaurant_id IN (SELECT user_restaurant_ids()) OR is_platform_admin()
  );
```

Document the writer-side invariant in the repository file's top-of-file comment so future maintainers don't accidentally add a browser-client write path.

---

### Patch §1.1.2 — Drop `idx_wa_messages_member_category_sent`

**Why**: WAQ-007 cooldown gates on `members.pmm_throttled_until` (a single column lookup, set by §6 dispatcher). The compound index on `whatsapp_messages` would only matter if cooldown re-derived the throttle from send history at every send — it doesn't. Two write paths for one signal is wasted disk + slower inserts on the hot send path.

**Replacement** — delete the index from the migration. The remaining indexes (`campaign_status`, `restaurant_sent_at`, `error_code`) cover the §1.1.2 read patterns. Add a note:

> If WAQ-008 adds analytics that need per-recipient send history (e.g. "show me the last 5 marketing messages this contact received from this tenant"), reintroduce the index in that slice with concrete query plans.

---

### Patch §1.1.4 — Rename trigger function in 035, not later

**Why**: I deferred the rename of `update_campaign_settings_updated_at` → `update_updated_at_column` as "future cleanup". That just means the next migration that needs the trigger has the same dilemma. Do it once, now.

**Replacement DDL** (in 035):

```sql
-- Rename the misnamed trigger function from migration 016 so any table can
-- reuse it. CREATE OR REPLACE keeps the existing trigger on
-- tenant_campaign_settings working without recreation.
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Recreate the existing trigger to reference the new name. The DROP is
-- harmless — no rows lock because we re-create immediately.
DROP TRIGGER IF EXISTS set_campaign_settings_updated_at ON tenant_campaign_settings;
CREATE TRIGGER set_campaign_settings_updated_at
  BEFORE UPDATE ON tenant_campaign_settings
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Drop the legacy function name only after the trigger is rebound.
DROP FUNCTION IF EXISTS update_campaign_settings_updated_at();

-- New trigger on whatsapp_messages
CREATE TRIGGER set_whatsapp_messages_updated_at
  BEFORE UPDATE ON whatsapp_messages
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
```

Verify locally: `tenant_campaign_settings` updates still bump `updated_at` after the migration applies. Test in the migration's down-script equivalent or via a seed-data round-trip.

---

### Patch §2.5 — Reconcile repository interface method count

**Why**: My narrative said "four-method surface"; the code listed five (`insertQueued`, `attachKapsoMessageId`, `findByKapsoMessageId`, `applyStatusUpdate`, `markFailedNoBspId`). Five is correct — `markFailedNoBspId` covers the BSP-throws-before-id path which is distinct from the status-webhook update path.

**Replacement narrative**:

> The five-method surface is shaped by what application code actually does:
> - `insertQueued` + `attachKapsoMessageId` — the two-phase send (§4.2).
> - `findByKapsoMessageId` — webhook handler lookup, plus ops scripts.
> - `applyStatusUpdate` — webhook handler update path.
> - `markFailedNoBspId` — when the BSP call throws before returning an id, so we never get a `kapso_message_id` to key on.

---

## Patch §9 — Updated implementation order

The original 6-day plan compresses by half a day if day-0 sandbox capture goes smoothly. Sequence is rewritten end-to-end:

### Day 0 — Sandbox capture (~30-60 min, blocking)
- Capture `delivered`, `read`, `failed/131049` Kapso webhook payloads against sandbox.
- Save fixtures to `docs/playbooks/fixtures/kapso-status-{delivered,read,failed-131049}.json`.
- Confirm `errors[0].code` and `MessageStatusUpdate.id` paths against §5.2 expectations.
- **Gate**: no implementation merges before fixtures exist on the branch.

### Day 1 — Port change + schema (WAQ-001 part A)
- **PR 1 (morning)**: change `WhatsAppMessagingPort` + Kapso adapter to return `SendResult`. All existing callers ignore the new fields. This is the keystone change (§4.1 patch); merging it first unblocks everything.
- **PR 2 (afternoon)**: migration 035 + 036 (with the §1.1.2/§1.1.4 patches). Domain entities, value objects, repository interface.
- **Checkpoint**: `SendResult` reaches campaign batch in dev with a real `kapsoMessageId` populated; migration applied; domain tests green.

### Day 2 — Repo + send instrumentation (WAQ-001 part B)
- Mapper + Supabase repo (5 methods per §2.5 patch).
- `recordOutboundSend` helper.
- Wire into `execute-campaign-batch.ts` behind `trackingEnabled` field on `SendContext` (§4.3 patch).
- Tests as listed in §7.2.
- **Checkpoint**: feature flag ON in dev, campaign run produces rows with `status='sent'`, `kapso_message_id` non-null.

### Day 3 — Webhook routing (WAQ-002 part A)
- `classifyWebhookKind` discriminator.
- Lift `tryMarkProcessed` to `src/infrastructure/supabase/idempotency.ts`; add `releaseIdempotencyKey` (§5.3/§5.4 patch).
- `routeStatusEvent` + `handleStatusUpdate` with claim-then-process.
- `findMessageByKapsoIdWithRetry` (§4.2 patch).
- Integration test from §7.3 using the real fixtures from day 0.
- **Checkpoint**: dev campaign + observe `delivered`/`read` updates on real rows.

### Day 4 — Webhook polish + reconciliation (WAQ-002 part B + new)
- Reconciliation sweep route (§6.4 new) + cron wiring + 6-minute-orphan unit test.
- Telemetry: structured logs for every status transition + every claim/release.
- Update `docs/playbooks/dev-shared-waba-safeguards.md` §4.1 → link to actual files.
- **Checkpoint**: feature flag ON in prod for Green Kitchen tenant only; watch 24h.

### Day 5 — Error code dispatch (WAQ-003 part A)
- `classifyErrorCode` table from §6.1 (plus `internal_orphan` → `log_only` per §6.4).
- `dispatchErrorAction` with action switch.
- `throttleMemberPmm` + `markMemberUnreachable`.
- `emitOpsAlert` writing to `events`.
- Tests for every error code branch.
- **Checkpoint**: synthetic webhook for each code → correct member mutation; reconciliation path's `internal_orphan` row does not mutate any member.

### Day 6 — Integration + handoff (WAQ-003 part B)
- E2E sandbox: trigger 131049, confirm `pmm_throttled_until` set.
- Update kanban: WAQ-007 references `pmm_throttled_until` column.
- Open follow-up tickets: utility-send-path instrumentation, retention sweep (per Q1 below), template `BLOCKED` status.
- Final review against this addendum.

---

## Escalation answers

### Q1 — `processed_webhooks` retention

**Recommendation: Option B (accept unbounded growth, sweep in a follow-up migration).**

Trade-offs:

| | Option A (partition in 035) | Option B (sweep in follow-up) |
|---|---|---|
| Migration risk | Higher — partition syntax is irreversible; mistakes lock the table | Lower — current table unchanged |
| Dev velocity | Slower — partition setup + retention policy in critical path | Faster — sweep is a 0.5d migration whenever it's needed |
| Time to felt pain | Never (preventive) | ~4-6 months at projected volume |
| Reversibility | Hard | Easy |

At the projected ~8k rows/day with the blocking customer onboarded, the table reaches ~3M rows/year. That is well within Postgres comfort for a single-column `UNIQUE` index lookup. The hot-path query (`INSERT ... ON CONFLICT`) does not scan; it hits the unique index by hash.

**Concrete plan**: ship 035 unpartitioned. Open `WAQ-OPS-001 — processed_webhooks 30-day retention sweep`, scheduled for whenever the row count crosses 5M or query latency on that index exceeds 5ms p95 (whichever comes first). The sweep can be a partial DELETE batched at 10k rows/run via a scheduled function — no partitioning needed unless growth changes character.

If the user disagrees and prefers Option A, the partition DDL would be:

```sql
-- Hypothetical 035 partition variant — NOT recommended
CREATE TABLE processed_webhooks_new (
  id UUID DEFAULT gen_random_uuid(),
  idempotency_key TEXT NOT NULL,
  processed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (idempotency_key, processed_at)
) PARTITION BY RANGE (processed_at);

-- One partition per month; manage via pg_cron + a partition-creation function.
CREATE TABLE processed_webhooks_2026_05 PARTITION OF processed_webhooks_new
  FOR VALUES FROM ('2026-05-01') TO ('2026-06-01');
-- ... data migration, FK swap, etc.
```

The migration is invasive (rebuild + cutover) and changes the primary key shape, breaking the current `INSERT ... ON CONFLICT (idempotency_key)` claim pattern. **Strongly prefer B.**

---

### Q2 — `unreachable_at` reversibility

**Recommendation: Option A (SQL-only) for this slice; commit to Option B in WAQ-009.**

Trade-offs:

| | A: SQL-only | B: UI toggle in slice | C: defer to WAQ-009 admin UI |
|---|---|---|---|
| Time cost | 0d | +0.5d | 0d (this slice) |
| Ops self-serve | No | Yes (CS team) | Yes once WAQ-009 ships |
| Risk of misuse | Low (eng-only) | Medium (CS may clear too eagerly) | Low |
| Audit trail | None | Needs explicit log | Built into admin-UI patterns |

The blocking customer's actual reset frequency is unknown — "ports occasionally" might mean 1/month or 1/week. Option B costs half a day **plus** the policy + audit-log design that an unaudited member-state mutation actually requires. That cost grows the slice by more than 0.5d.

Option A in this slice = ops opens a runbook entry like:

```sql
-- runbooks/clear-unreachable.md
UPDATE members SET unreachable_at = NULL
WHERE id = $1 AND restaurant_id = $2;
-- Reason: <ticket-id>. Cleared by: <ops-handle>.
```

Until that becomes a daily papercut, eng is the gatekeeper. If we hear "I'm running this SQL twice a week" within 2 weeks of go-live, fast-track WAQ-009's admin UI. Document the runbook explicitly so CS knows the path.

C is strictly dominated by A (same outcome, but defers without acknowledging the gap). Choose A.

---

## Summary of section impacts

| Original § | Patched by addendum § | Change kind |
|---|---|---|
| §0 | "§4.1 + §0" | Add port-change as third bullet |
| §1.1.2 | "Drop index" | Remove `idx_wa_messages_member_category_sent` |
| §1.1.3 | "Service-role-only writes" | Drop INSERT/UPDATE policies |
| §1.1.4 | "Rename trigger in 035" | Inline rename, no future tech debt |
| §2.5 | "Reconcile method count" | Narrative says five (matches code) |
| §4.1 | "§4.1 + §0" | Reframe as keystone scope |
| §4.2 | "Bounded retry" | Replace "accept the race" with one-retry helper |
| §4.3 | "Read flag once per batch" | Capture in `SendContext`, propagate |
| §5.2 | "Day-0 sandbox" | Move payload capture to before any code |
| §5.3 | "Restore claim-then-process" | Use existing `INSERT ... 23505` pattern |
| §5.4 | "Restore claim-then-process" | Add `releaseIdempotencyKey` on orphan miss |
| §6 | "§6.4 reconciliation" | New subsection on orphan sweep |
| §9 | "Updated implementation order" | Day-0 prereq + reordered day-1 |
| §11 | (acceptance) | Add orphan-sweep test to WAQ-001 criteria |
