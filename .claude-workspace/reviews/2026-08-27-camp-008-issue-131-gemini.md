---
id: reviews/2026-08-27-camp-008-issue-131-gemini
type: review
author: gemini-cli-reviewer
reviewer_model: gemini-cli
created: 2026-08-27
status: active
supersedes: null
superseded_by: null
related: [plans/2026-08-27-camp-008-outbound-status-and-claim-button, artifacts/2026-08-27-camp-008-stream-a-webhooks-v2-backend, artifacts/2026-08-27-camp-008-stream-bc-failure-reconcile-rerun-backend]
---

# Code Review (Gemini CLI): CAMP-008 / Issue #131 — Outbound Status Webhooks & Billing Retraction

Reviewed: branch `fix/camp-008-issues-131-132`, commit `4831b5e` on top of `origin/develop` (46 files). Streams A (Kapso v2 classification), B (async failure → campaign retraction/finalize), C (re-run idempotency). Stream D (#132 QUICK_REPLY) is a separate PR and out of scope for this review.

## Summary
The diff successfully implements the core requirements for fixing issue #131: Kapso v2 outbound statuses are correctly parsed, tracking is enabled to capture failures, atomic retractions update billing counters, and re-run idempotency allows failed messages to be safely retried without minting duplicate coupons. The architecture cleanly segregates domain logic from infrastructure, and the webhook routing pipeline avoids double-retractions. However, there is a critical concurrency bug in the SQL migration that will cause lost updates during simultaneous webhooks, leading to over-billing.

## 🔴 Critical (Must Fix)
- `supabase/migrations/064_retract_campaign_sent.sql`: The `decremented` CTE reads `chargeable_sent_count` and `non_chargeable_sent_count` without `FOR UPDATE` locking, and the subsequent `UPDATE` applies those pre-calculated values.
  - **Risk**: PostgreSQL CTEs execute independently; under concurrent webhook arrivals for the same campaign, multiple processes will read the same counter value and write back the exact same decremented value (a classic "lost update"). This will cause the system to over-bill tenants because the counters won't fully decrement for all rejected messages.
  - **Fix**: Remove the `decremented` CTE and perform the calculation entirely inline within the `UPDATE` statement to guarantee row-level locking atomicity: `UPDATE campaigns SET chargeable_sent_count = GREATEST(0, chargeable_sent_count - (CASE WHEN is_chargeable THEN 1 ELSE 0 END)) ...`.

## 🟡 Important (Should Fix)
- `src/application/message-tracking-flag.ts`: Flipping `WAQ_TRACK_MESSAGES` to opt-out silently enables two massive system changes globally: 1) The WAQ-007 per-user 1/24h marketing cap will abruptly start blocking campaigns for all tenants that previously bypassed it. 2) `whatsapp_messages` will experience a massive write volume increase.
  - **Risk**: Unintended blockage of tenant campaigns and potential DB performance degradation if not provisioned for the load.
  - **Fix**: Document this blast radius in a release note / playbook so operators are aware of the marketing cap enforcement, and ensure the DB indices on `whatsapp_messages` (specifically `idx_wa_messages_campaign_status` used in the new ledger query) are ready for full production volume.

## 🟢 Minor (Optional)
- `src/application/reconcile-campaign-send-failure.ts`: The guard correctly uses `BODY_TYPES.has(after.messageType)`. Since QR images are not counted and their failures aren't retracted, this works perfectly. It's worth adding a small unit test explicitly verifying that a QR message failure does not trigger a retraction, ensuring future maintainers don't accidentally add the QR type to the tracked set.

## ✅ Strengths
- **Completeness (UI Wiring)**: The UI assumption checks out perfectly — `src/components/dashboard/campaign-card-view.tsx` already destructures `failureReason` and renders it within the failed banner (`{failureReason || tg('failedReasonFallback')}`).
- **Race Condition Handling**: The `completeCampaignRunIfCounted` CAS combined with the webhook's `completed` status check elegantly handles the race between the orchestrator finalizing the batch and async webhooks draining the counters to zero. If the CAS fails because counters drained, it safely falls back to a terminal `failed` state.
- **Idempotency Execution**: The `execute-campaign-broadcast.ts` logic beautifully reuses the existing coupon code in the body without re-minting, perfectly sidestepping the migration-053 unique constraint crash while safely re-sending the QR on a retry.
- **Webhook Classification Order**: `webhooks.ts` smartly places `hasKapsoV2OutboundStatus` before `hasKapsoFlatMessage`, ensuring inbound v2 messages correctly fall through while outbound status messages are trapped.

## Open Questions
- Is the `whatsapp_messages` table configured with an aggressive TTL or cleanup cron? Now that tracking is on by default, the table will grow significantly faster.
- Should we expose a way for operators to explicitly bypass the WAQ-007 marketing cap if the sudden enablement causes friction with existing tenants?

## Verdict: CONDITIONAL
