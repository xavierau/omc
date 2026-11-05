---
id: reviews/2026-08-27-camp-008-issue-131-analyzer
type: review
author: code-review-analyzer
created: 2026-08-28
status: active
supersedes: null
superseded_by: null
related: [plans/2026-08-27-camp-008-outbound-status-and-claim-button, artifacts/2026-08-27-camp-008-stream-a-webhooks-v2-backend, artifacts/2026-08-27-camp-008-stream-bc-failure-reconcile-rerun-backend, reviews/2026-08-27-camp-008-issue-131-gemini, kanban:CAMP-008, github:131]
---

# Code Review (analyzer lane): CAMP-008 / #131 — Kapso v2 status webhooks, sent-counter retraction, idempotent re-runs

Reviewed: branch `fix/camp-008-issues-131-132`, commits `4831b5e` + `1775d79` on top of `origin/develop` (PR #135 → develop). Second lane alongside `reviews/2026-08-27-camp-008-issue-131-gemini` (grok lane unavailable). Lens: security, architecture, adversarial correctness. Stream D (#132) is a separate PR and out of scope.

## Summary

The three gaps in #131 are closed and the fix is well-structured: the v2 classifier is a pure, fixture-tested body discriminator; the retraction is one atomic `UPDATE … RETURNING` scoped by `(id, restaurant_id)` and keyed off the row's own `is_chargeable`; the finaliser completes only through a CAS; and re-runs are at-most-once per member via a bulk-per-chunk ledger plus coupon reuse. **The gemini Critical (CTE lost-update in migration 064) is fixed correctly in `1775d79`** — verified below, not re-reported.

No Critical findings. Three Important findings remain, all cheap: (1) a CAS loss that is *not* caused by Meta (tenant PATCHes status mid-run, or a swallowed DB error) is written up as a Meta rejection — a false, tenant-visible statement naming the wrong deciding system; (2) the webhook path still never compares the row's tenant to the resolved tenant, and #131 adds billing writes to the blast radius of an unsigned (demo-mode) payload; (3) the new billing RPC is executable by the `authenticated` PostgREST role, unlike the repo's own precedent for sensitive RPCs (045).

## Migration 064 verification (gemini Critical — fixed)

`supabase/migrations/064_retract_campaign_sent.sql:44-64`:
- Every `SET` expression and both `CASE` predicates read `c.chargeable_sent_count` / `c.non_chargeable_sent_count` / `c.is_chargeable` / `c.status` inline. In READ COMMITTED a second concurrent `UPDATE` on the same row blocks on the row lock, then re-evaluates `WHERE` and the `SET` expressions against the committed new row version (EvalPlanQual), so two `failed` webhooks for the same campaign produce `n-2`, not `n-1` twice. Correct.
- Both buckets use the same `CASE WHEN c.is_chargeable` selector, so exactly one bucket moves per call; `GREATEST(0, …)` floors it. The status/`failure_reason` predicates recompute the same post-values from the pre-image (`SET` reads OLD values), so "both buckets are zero after this decrement" is evaluated consistently. Flip is gated on `c.status = 'completed'` only — `sending`/`active` rows are decremented and left for the finaliser CAS. Correct.
- Types: `campaigns.status` is `TEXT` (001), counters are `INT` (027) → `RETURNS TABLE (status text, … int)` matches exactly; no enum coercion issue. Output-parameter names collide with column names but every reference is qualified (`c.status`) or is a `SET` target, so SQL-function name precedence is not a problem.
- `RETURNING` on a `RETURNS TABLE` SQL function is set-returning → supabase-js returns `[]` on no match and `[row]` otherwise; the wrapper's `Array.isArray(data) ? data[0] : data` → `null` on `[]` is right. `LANGUAGE sql`, SECURITY INVOKER, no grants — matches 027's increment RPCs (but see Important 3).

## 🔴 Critical (Must Fix)

None.

## 🟡 Important (Should Fix)

### 1. A lost CAS that is not a Meta rejection is reported to the tenant as one
- `src/application/execute-campaign.ts:110-129`, `src/infrastructure/supabase/repositories/campaign-repository.ts:201-212`, `src/app/api/dashboard/campaigns/[id]/patch-helpers.ts:63-70`.
- **Problem**: `completeCampaignRunIfCounted` returns `false` for three distinct causes, and only one is Meta: (a) webhooks drained the counters (the intended case); (b) the status is no longer `sending` — `validatePatchStatus` forbids only `'failed'`, so a tenant can PATCH a `sending` campaign to `paused`/`active`/`completed` mid-run; (c) `const { data } = await supabase…` at `:205` discards `error`, so a transient DB error also reads as "CAS lost". In (b) and (c) `failRunRetractedByMeta` finds no failed body row (`latest === null`) and still writes `status: 'failed'` + "WhatsApp (Meta) reported every message in this campaign as failed after it was sent…", overwriting the tenant's own status change. The handoff records dropping the re-read guard deliberately ("CAS false → failed, full stop"); the old code overwrote the status too, but it never fabricated a Meta failure.
- **Risk**: false, tenant-visible statement naming the wrong deciding system (the WAQ-014 principle this PR otherwise honours), and a `paused` campaign silently flipped to terminal `failed`.
- **Fix** (small): make the failure write scoped like the completion write — `.eq('status','sending')` (a `failCampaignRunIfSending(id, reason)` sibling of `completeCampaignRunIfCounted`, or extend `transitionCampaignStatus` to carry `failure_reason`), so an externally changed status is left alone; when `latest === null`, use neutral wording that does not assert Meta ("No sent message remained counted when the run finished — check the campaign's message log before re-running") instead of the generic Meta branch; and surface `error` in `completeCampaignRunIfCounted` (`if (error) throw …`) as the other repository functions in `campaign-counters.ts` do. Add a test: CAS false + `findLatestCampaignFailure → null` ⇒ reason does not contain "Meta rejected/reported".

### 2. Webhook tenant is never compared to the row's tenant; #131 adds billing writes to that gap
- `src/app/api/webhooks/whatsapp/status-handlers.ts:74-88`, `src/app/api/webhooks/whatsapp/route.ts:135-152` (`verifySignature` returns `true` when `KAPSO_WEBHOOK_SECRET` is unset, or when the header is missing outside production).
- **Trace**: `resolveRestaurant` derives tenant A from `conversation.phone_number_id` → `findMessageByKapsoIdWithRetry(status.id)` looks the wamid up **globally** (`whatsapp-message-repository.ts:findByKapsoMessageId`, no `restaurant_id` filter) → `reconcileCampaignSendFailure` and the RPC use `after.snapshot.restaurantId`/`campaignId` (the **row's** tenant), so the retraction itself cannot be redirected to another tenant's campaign by the payload — good. But nothing ever checks `message.snapshot.restaurantId === restaurantId`. A crafted unsigned v2 payload carrying tenant A's `phone_number_id` and tenant B's wamid will mark B's row `failed` with an attacker-chosen error code/title, retract B's campaign counter, possibly flip B's `completed` campaign to `failed` with attacker-influenced wording (see Minor 3), and run `dispatchErrorAction(updated, restaurantId=A)` (pre-existing WAQ-002: member mutations keyed on the *webhook's* tenant).
- **Risk**: in production the secret is set, so exploitation needs the secret or a non-prod deployment with real data; wamids are opaque but do appear in logs and the Kapso dashboard. Not Critical for that reason — but the guard is one line in a file this PR already touches and it closes the pre-existing WAQ-002 gap as well.
- **Fix**: after `:75`, `if (message.snapshot.restaurantId !== restaurantId) { await releaseIdempotencyKey(idempotencyKey); log('warn','status.tenant_mismatch',{kapsoMessageId: status.id, restaurantId}); return }` (release so a legitimately-routed retry can still land). Unit test in `status-handlers.test.ts`: mismatched tenant ⇒ no `applyStatusUpdate`, no reconcile, claim released.

### 3. `retract_campaign_sent` is callable by the `authenticated` PostgREST role
- `supabase/migrations/064_retract_campaign_sent.sql:35-65` vs `supabase/migrations/045_quality_kpi_rpcs.sql:139-153`.
- **Problem**: no `REVOKE`/`GRANT`, so under Supabase's default `EXECUTE … TO PUBLIC` any dashboard session (`createAuthBrowserClient`, anon key + user JWT) can call the RPC directly. Because it is SECURITY INVOKER and `campaigns_update` (011) scopes to `restaurant_id IN user_restaurant_ids()`, cross-tenant calls match zero rows and `anon` matches nothing — so **no cross-tenant exposure**. A tenant *can* zero their own `chargeable_sent_count` (the billing source of truth) and set `failure_reason` to arbitrary text on their own `completed` campaign. This is **not new surface**: the same policy has no column restriction, so a direct `PATCH /rest/v1/campaigns` already allows it today (and 027's increment RPCs are equally open).
- **Risk**: self-tenant under-billing via a first-class, discoverable RPC name; the repo's own precedent for sensitive RPCs (045) is explicit lock-down.
- **Fix**: append to 064: `REVOKE EXECUTE ON FUNCTION public.retract_campaign_sent(uuid, uuid, text) FROM PUBLIC, anon, authenticated; GRANT EXECUTE ON FUNCTION public.retract_campaign_sent(uuid, uuid, text) TO service_role;`. Mention the pre-existing column-level exposure on `campaigns_update` as a follow-up (out of scope here).

## 🟢 Minor (Optional)

1. **Layering** — `src/application/reconcile-campaign-send-failure.ts:10` imports `CAMPAIGN_BODY_MESSAGE_TYPES` from an infrastructure module, and `whatsapp-message-ledger-queries.ts:6` imports it from a sibling infra module. "Which message types count as a campaign body send" is a domain rule. Move the constant next to `MessageContentType` in `src/domain/entities/whatsapp-message.ts` (typed `readonly MessageContentType[]`) and import it from there in all three places. `execute-campaign-rerun-prefetch.ts` importing two infra queries directly matches the existing application-layer style in this codebase (no ports), so no finding there; `domain/services/campaign-mode.ts` is pure (type-only import).
2. **Interleaving test is not a race** — `src/application/__tests__/execute-campaign.test.ts:1553`: flipping the `completeCampaignRunIfCounted` mock inside the send mock exercises exactly the same code path as the preceding "CAS returns false" test; the real serialisation guard is the SQL `WHERE status='sending' AND (… > 0)`, which no unit test can reach. Either rename it to what it pins (CAS-false after sends were tallied) or drop it; keep the assertion that `completed` is never written.
3. **Webhook-supplied `errorTitle` is interpolated verbatim into tenant-visible text** — `src/domain/services/campaign-delivery-failure-reason.ts:38-41` (generic branch). Unbounded length; attacker-controlled in unsigned mode (Important 2). The 131042/131047 branches ignore the title, and the "never leaks raw internals" test only covers 131042. Cap and sanitise (`title.slice(0, 80)`, strip newlines) or allowlist known Meta titles.
4. **Reused coupon may not match the body it is sent with** — `src/application/execute-campaign-broadcast.ts:57,91`: the re-run body renders `discount` from the campaign's *current* `couponConfig`, while the reused coupon carries the discount minted on the first run. If the tenant edited the offer between runs, the message promises one discount and the code redeems another. Compare `existing.discountType/discountValue` against `campaign.couponConfig` and skip (`skipped_already_sent` with a warn) or log on mismatch.
5. **Perf budget** — `execute-campaign-rerun-prefetch.ts:33-40` issues two bulk queries per chunk (ledger + coupons) on *every* eager run, including first runs; the plan budgeted one. Both are single `IN` queries covered by `idx_wa_messages_campaign_status` / the 053 index and run in parallel, so this is a note, not a fix request.
6. **Stale pre-image can double-retract on two concurrent distinct-raw-status webhooks for the same wamid** — `status-handlers.ts:74-85`: the once-only guard compares the handler's `before` (read at `:74`) with `after`; if two webhooks with different raw strings both mapping to `failed` (e.g. `failed` and an unknown string coerced by `coerceStatus`, both carrying an error code) interleave, both see `before=sent`, and the second `applyStatusUpdate` returns the already-failed row, so both retract. Unlikely from Kapso, and the exact-once stamps (`counter_retracted_at`) listed as a follow-up close it — make sure that follow-up exists as a kanban item (I could not find one).
7. **Under-retract edge** — a body row can reach `sent` without ever incrementing the counter (eager 23505 race path returns `'sent'` at `execute-campaign-broadcast.ts:95-97`; `incrementCampaignSent` throwing → `errored`). A later `failed` webhook for that row still retracts, floored by `GREATEST(0, …)`. Same follow-up (`counter_applied_at`) covers it.
8. **File size** — `webhooks.ts` 166 → 177 (+11, all v2 logic lives in the new 75-line module), `execute-campaign-broadcast.ts` 155 → 171 (+16). Both were over the 150 target before this PR; the deltas are surgical. New files are all under the limit. No action.

## ✅ Strengths

- Migration 064 as fixed is correct under concurrency (see verification section); the comment block documents *why* the CTE was wrong, so the next reader will not reintroduce it.
- Retraction scoping is derived entirely from the row (`after.snapshot.restaurantId` + `campaignId`), never from the payload — the RPC cannot be aimed at another tenant's campaign.
- `reconcileCampaignSendFailure` guard matrix (campaignId, pre≠failed, post=failed, errorCode present, body type only) is fully unit-tested, and the integration test drives the **real** 131042 v2 shape through route → classifier → handler → fake RPC (faithful to 064: bucket by `is_chargeable`, `max(0,…)`, flip only when `completed` and both zero) with duplicate-POST and QR-image negatives.
- Classification order (`hasKapsoV2OutboundStatus` before `hasKapsoFlatMessage`) is right and pinned by fixtures; inbound v2 still routes inbound; a bare outbound ack is not misclassified.
- Opt-out flip is complete: no `=== '1'` call site remains anywhere in `src/` (verified by grep), and the batch captures the flag once per run.
- 131042 → `log_only` prevents a per-member Slack storm; the reason text names Meta, disclaims OhMyClient review, and points at the exact Business Manager screen.
- `finalizeCampaignRun` preserves the #127 paths byte-for-byte and adds the CAS only where sends were tallied; "nothing attempted" still completes unconditionally.
- Ledger treats `queued` as counted (never double-blast) and claim mode is covered (claim body rows are `template` with `campaign_id`).

## Open Questions

1. Does the dashboard UI expose pause/stop on a `sending` campaign, or is the mid-run PATCH (Important 1b) API-only today?
2. Where is the A8 runbook (before/after SQL for `7bed8f1b` / `b4ed3737`) recorded? The PR checklist item is unchecked and it is not in the diff.
3. Has the exact-once retraction follow-up (`counter_applied_at` / `counter_retracted_at`) been filed in `.claude/kanban.json`? The handoff lists it; I found no entry.
4. `whatsapp_messages` growth with tracking on by default (gemini's open question) — is the orphan-reconcile cron the only retention mechanism?

## Verdict: CONDITIONAL

Gemini's Critical is fixed; no new Critical. Merge after Important 1 (scoped fail write + neutral wording when no failed body row + surface the CAS query error) and Important 2 (one-line tenant guard); Important 3 is a three-line append to 064 and should ride the same commit since the migration has not shipped yet.

## Next Steps

1. Fix Important 1–3 on the branch (one commit; 064 can still be edited pre-release).
2. Re-run `vitest` for `execute-campaign.test.ts`, `status-handlers.test.ts`, `campaign-counters.test.ts`, and the route integration test; add the three tests named above.
3. Re-review (this lane, cold) on the fix commit — focus on the three findings plus regressions in the #127 finalize paths.
4. Answer Open Questions 2–3 in the PR body before merge.
