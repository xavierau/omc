---
id: artifacts/2026-08-27-camp-008-stream-bc-failure-reconcile-rerun-backend
type: artifact
author: claude (main thread; Stream B started by senior-backend-dev, finished in-thread after a session-limit kill)
created: 2026-08-27
status: active
supersedes: null
superseded_by: null
related: [kanban:CAMP-008, kanban:CAMP-002, github:131]
---

# CAMP-008 Streams B + C — async Meta rejection → campaign, and re-run idempotency (#131)

Plan: `plans/2026-08-27-camp-008-outbound-status-and-claim-button` (D2–D5 as amended by A1–A8).
Stream A (v2 classifier) is in `artifacts/2026-08-27-camp-008-stream-a-webhooks-v2-backend`.

## Stream B — failed status webhook → campaign counters / status

| File | Change |
|---|---|
| `src/application/message-tracking-flag.ts` (+test) | `isMessageTrackingEnabled()` — `WAQ_TRACK_MESSAGES !== '0'` (opt-OUT; was opt-in `=== '1'`, never set in prod). Used by `execute-campaign.ts` + `claim-handler.ts`. `.env.example` / `deploy/README.md` updated. |
| `supabase/migrations/064_retract_campaign_sent.sql` | `retract_campaign_sent(p_campaign_id, p_restaurant_id, p_failure_reason)` — ONE `UPDATE … RETURNING`: decrements the bucket matching the row's own `is_chargeable` (GREATEST 0) and flips `completed → failed` + `failure_reason` when both buckets hit 0. Scoped by `(id, restaurant_id)`. |
| `campaign-counters.ts` (+test) | `retractCampaignSent()` wrapper → `{status, chargeableSentCount, nonChargeableSentCount} \| null`. Re-exported from `campaign-repository.ts`. |
| `campaign-repository.ts` | `completeCampaignRunIfCounted(id)` — CAS `status='completed' WHERE status='sending' AND (chargeable > 0 OR non_chargeable > 0)`. |
| `whatsapp-message-campaign-queries.ts` | `findLatestCampaignFailure(campaignId, restaurantId)` + `CAMPAIGN_BODY_MESSAGE_TYPES = ['template','text']`. |
| `src/domain/services/campaign-delivery-failure-reason.ts` (+test) | `deliveryFailureReason(code, title)` — 131042 / 131047 / generic wording; every branch names Meta and disclaims OhMyClient review. |
| `src/application/reconcile-campaign-send-failure.ts` (+test) | Guard: `campaignId` set, pre-image ≠ failed, post-image = failed, `errorCode` present, `messageType ∈ {template,text}` (QR image never counted). Calls the RPC; logs `campaign.send_retracted` / `campaign.retract_no_match` / `campaign.retract_failed` (error, with campaignId); never throws. |
| `status-handlers.ts` (+tests) | `handleStatusUpdate` returns if the repo found no row; calls reconcile with `{before: message, after: updated, log}` BEFORE `dispatchErrorAction` (a throwing dispatch must not skip the billing write). |
| `execute-campaign.ts` (+tests) | `finalizeCampaignRun({campaignId, restaurantId, counters, template})`: sent=0 & broken → `failed` (unchanged, #127); sent=0 & nothing broken → `completed` (unchanged); sent>0 → CAS; CAS false → `failed` with `deliveryFailureReason(latest failed body row)`. |
| `whatsapp-error-code.ts` (+test) | `'131042' → log_only / error` — no per-message Slack post (A5). |
| `route.status-event.integration.test.ts` | Fake client gains `campaigns` + `rpc('retract_campaign_sent')`; 3 end-to-end cases on the real 131042 v2 fixture: row failed + RPC once + campaign flipped; duplicate POST → no second retract; QR image failure → no retract. |

## Stream C — re-execution (CAMP-002 minimum)

| File | Change |
|---|---|
| `whatsapp-message-ledger-queries.ts` | `findMemberIdsWithCountedSend({campaignId, restaurantId, memberIds})` — one `IN` query per chunk; body rows with `status <> 'failed'` (queued counts as sent). |
| `coupon-campaign-queries.ts` | `findCouponsByMembersAndCampaign({restaurantId, campaignId, memberIds})` → `Map<memberId, Coupon>` (bulk; coupon-repository.ts is at the size limit). |
| `src/domain/services/campaign-mode.ts` (+test) | `isClaimTemplate()` moved out of broadcast.ts (pure domain rule; needed by the prefetch without an import cycle). |
| `execute-campaign-rerun-prefetch.ts` | `loadRerunPrefetch(members, ctx)` → `{countedMemberIds, existingCoupons}`; ledger only when tracking is on; coupons only in eager mode. `EMPTY_PREFETCH` default. |
| `execute-campaign-batch.ts` | `runChunk` loads the prefetch once per chunk; `attemptMember` returns `skipped_already_sent` for counted members before the consent/cooldown gate; `sendToMember` now returns the `MemberOutcome`. |
| `execute-campaign-batch-counters.ts` (+test), `-probe-log.ts` | New outcome `skipped_already_sent` / counter `alreadySent`, tallied, logged, included in the probe-boundary `skipped` sum. |
| `execute-campaign-broadcast.ts` (+tests) | `sendToMember(member, ctx, prefetch = EMPTY_PREFETCH): Promise<MemberOutcome>`. Eager: existing non-redeemable coupon → `skipped_already_sent`; existing active coupon → its code in the body, no mint, then QR + counter + event; none → mint as before. 23505 keeps today's semantics (log, no QR/count, tally `sent`). Claim mode ignores coupons. |

## Decisions made in-thread (beyond the plan)
- Dropped the "re-read campaign status before failing the run" guard from the plan draft: it added a read + a status race for a case the old code did not handle either (operator changing status mid-run). CAS false → `failed`, full stop.
- Re-run counting rule: increment unless the ledger shows a counted send. A member with no ledger row at all (pre-#131 history, e.g. Kushiro's two campaigns) IS counted on re-run — correct once the runbook's one-off correction zeroes those campaigns' phantom counts (A8).
- `reconcile` runs before `dispatchErrorAction`, not after as the brief said — reasons in the code comment.

## Verification
- `./node_modules/.bin/vitest run` (whole project) → **365 files / 3708 tests passed**, 0 failed (21 skipped, 2 todo — pre-existing).
- `./node_modules/.bin/tsc --noEmit` → clean.
- `./node_modules/.bin/eslint src/application src/domain src/infrastructure/supabase/repositories src/infrastructure/whatsapp src/app/api/webhooks/whatsapp` → 0 errors (9 pre-existing warnings in untouched test files).

## Left out / follow-ups (say so in the PR)
- Exact-once retraction (`counter_applied_at` / `counter_retracted_at` stamps) — at-most-once with an error-level log is what ships (A4).
- No mid-run stop on 131042; no dashboard revive control (#129); CAMP-004 explicit flag; ANALYTICS-001 reporting.
- `webhooks.ts` is 177 lines (was 167) and `execute-campaign-broadcast.ts` ~170 — pre-existing overage, not refactored (Surgical Changes).
- Prod runbook: one-off SQL correction for Kushiro campaigns `7bed8f1b` / `b4ed3737` (record before/after), ops heads-up that WAQ-007's 1/24h per-user marketing cap is now live for every tenant.
