---
id: reviews/2026-08-24-camp-007-media-header-analyzer
type: review
author: code-review-analyzer
created: 2026-08-24
status: active
supersedes: null
superseded_by: null
related: [plans/2026-08-24-camp-007-media-header-send, reviews/2026-08-24-camp-007-media-header-gemini, kanban:CAMP-007, github:#127]
---

# Code Review: CAMP-007 media-header send fix (#127) — second lane

Commit `324a086` on `fix/camp-007-media-header-send` (worktree `whatsapp-crm-camp-007-worktree`), diff vs `origin/develop`: 17 files, +777/−10. Independent second lane (Grok/Codex CLIs down); Gemini lane: `reviews/2026-08-24-camp-007-media-header-gemini` (APPROVED, 1 Important).

## Summary

The fix is correct on the incident's two root causes and well-verified. (1) `headerParams` are now built from the template row's stored header URL and proven at the wire boundary — the template-client test drives the REAL `buildTemplateSendPayload`, so the "declared but never assigned" failure class is now compile-and-CI-visible. (2) All-failed runs terminate as `status:'failed'` with a fixed, tenant-safe `failureReason`; I verified the full state machine (BullMQ no-retry on the terminal write, pre-claim throw → CAS'd `markCampaignFailed` on exhaustion, cron `getDueCampaigns` exclusion, PATCH revival clearing the reason). Verification performed hands-on: 104/104 tests green across all 6 touched test files, `tsc --noEmit` clean, no template send path bypasses the fixed facade, and the status-sync cron does not overwrite stored components (so the URL source assumption holds).

One real regression risk found on an untargeted path: the new guard turns a formerly-silent misconfiguration into a **post-idempotency-claim throw on the webhook my-card path**, the exact class the webhook code documents as forbidden (issue #45). Cheap fix, hence CONDITIONAL.

## 🔴 Critical (Must Fix)

None.

## 🟡 Important (Should Fix)

### 1. Webhook my-card path: new deterministic post-claim throw (dropped event + 500)
- **Files**: `src/app/api/webhooks/whatsapp/my-card-handler.ts:26-31` (unguarded call site); throw originates from the new `enforceHeaderMedia` in `src/application/send-template-message.ts:39`.
- **Problem**: `handleMyCard` calls `promptMarketingOptin` bare. The sibling path wraps it in a NEVER-throws contract (`optin-prompt.ts` `maybePromptOptin`, "webhook reliability is the paramount invariant"), but my-card does not. A tenant whose opt-in confirmation template declares a media header with no stored URL now gets a deterministic `TemplateHeaderMediaMissingError` on every first MY CARD message from a non-consented member. The throw lands AFTER `tryMarkProcessed` claims the idempotency key — `route.ts:104-108`'s own comment (issue #45) names the consequence: 500 → provider retry → retry hits `duplicate` → event dropped forever. Pre-change this misconfiguration failed silently at Meta (`ok:false` ignored); post-change it 500s the webhook and half-processes the event (pending consent row inserted at `prompt-marketing-optin.ts:67`, prompt never sent, and that pending row then suppresses re-prompting).
- **Risk**: webhook 500s + dropped inbound events for any tenant with a media-header opt-in template; violates the codebase's documented post-claim no-throw invariant. Low-probability config, but deterministic and per-member once hit.
- **Fix**: give the my-card prompt the same contract as `maybePromptOptin` — wrap the `promptMarketingOptin` call in try/catch + log (or route it through `maybePromptOptin`'s wrapper). Do not remove the guard from the facade; the call-site contract is the right layer.

### 2. `patch-helpers.ts` system-invariant doc now falsified
- **File**: `src/app/api/dashboard/campaigns/[id]/patch-helpers.ts:52-58` (`validatePatchStatus` doc).
- **Problem**: the comment states 'failed' is set ONLY by the queue worker via `markCampaignFailed`. `finalizeCampaignRun` (execute-campaign.ts:77-94) is now a second writer, via plain `updateCampaign`. The load-bearing invariant (failed ⇒ non-null reason) is preserved — both writers pair status with reason — but the documented ownership claim is stale.
- **Risk**: a future change "restores" the documented single-writer rule and blocks or reroutes the new terminal write, silently reintroducing the incident's `completed`-on-all-failed behavior.
- **Fix**: amend the comment to name both writers and restate the actual invariant (failed is system-managed and always paired with a reason). Two lines; no behavior change.

## 🟢 Minor (Optional)

1. **`failureReason` wording vs post-send failures** — `execute-campaign.ts:88-92`: the `failed` tally also counts eager-mode throws AFTER the body was delivered (`mintEagerCoupon` non-23505, `incrementCampaignSent`, `emitEvent` — `execute-campaign-broadcast.ts:82-92`). In a systemic outage of those (rare), the row reads "All N message sends failed" though bodies landed, and the revive advice re-sends bodies to everyone (re-run re-send semantics pre-exist per the `mintEagerCoupon` comment). Optional: soften to "could not be completed", or split pre/post-send failure counters later.
2. **Terminal-write CAS asymmetry** — `finalizeCampaignRun`'s writes are unconditional while `markCampaignFailed` CASes on 'active'; an operator PATCH mid-send (e.g. pause) gets clobbered by the finalize write. Pre-existing pattern for the 'completed' write — noting the asymmetry only, no action required in this fix.
3. **Missing all-skipped unit case** — plan's test plan implies it; the new suite covers zero-members but not failed=0 ∧ skips>0 → completed. The branch only reads `failed`/`sent` so coverage is effectively equivalent, and pre-existing gate tests assert completed-after-skips. One-line test if touched again.

## ✅ Strengths

- **Boundary-proving test**: `template-client.test.ts` runs headerParams through the real `buildTemplateSendPayload` zod schema — directly kills the "declared-but-never-assigned plumbing invisible to tests" failure class this incident exposed.
- **Gate discipline**: `enforceHeaderMedia` sits pre-claim in `executeCampaign` (status untouched on throw — asserted by test), in the route in the same order (409, matching the not-approved contract), in the send facade (defense in depth), and in the queue's tenant-meaningful allowlist. Every template send funnels through the one fixed facade (verified: no direct infra `sendTemplateMessage` callers outside it).
- **Failure-reason hygiene**: fixed wording only, explicit no-internals-leak test (`not.toContain('kapso')`), class-based allowlist, message names only the tenant's own template; revival path verified end-to-end (`applyFailureReasonRevivalGuard` clears it, `validatePatchStatus` still blocks direct PATCH-to-failed).
- **Correct BullMQ semantics**: terminal 'failed' on a successfully-completing job → no retry burn; pre-claim throw leaves 'active' so exhaustion's `markCampaignFailed` CAS succeeds; 'failed' exits `getDueCampaigns` so the cron can't re-enqueue. Test explicitly asserts no bounce to 'active'.
- **Root-cause discipline**: plan corrected the issue's own wrong prescription (campaign image_url is welcome-only/nulled) and verified the stored-URL source; I confirmed `sync-template-status` never rewrites `components`, so the source can't be clobbered by the #93 cron. Debugging journal written and accurate.
- Verified green: 104/104 tests across the 6 affected files; `tsc --noEmit` clean.

## Open Questions

- None blocking. Operational (release step already covers it): confirm the affected prod template row (`5th_anniversary`) actually stores an https URL in `example.header_handle` before the re-run — if it holds only a `4:` handle, the operator must resubmit the template first (the new 409/`failed` reason will say exactly that).

## Verdict: CONDITIONAL

Approve once 🟡-1 (my-card try/catch parity) is addressed; 🟡-2 is a two-line comment amendment. No re-review round needed for either — a green targeted test run (or the existing webhook handler tests) suffices.

## Next Steps

1. Wrap the `handleMyCard` → `promptMarketingOptin` call in the `maybePromptOptin` never-throws contract (or reuse it).
2. Amend the `validatePatchStatus` doc comment to name both 'failed' writers.
3. Proceed to PR per plan's release section; keep the operator step from Open Questions.
