---
id: artifacts/2026-08-23-campaign-send-feedback-backend
type: artifact
author: senior-backend-dev
created: 2026-08-23
status: active
supersedes: null
superseded_by: null
related: [kanban:issue-102]
---

# Campaign send feedback + queue retention — backend (#102)

Branch `fix/issue-102-send-feedback` off `origin/develop` (1bd2019 / 0302a70).
Implements issue #102 items B–F (backend half). Item A (WAQ-011 submit/admin
UI) and Part A fix 3/4 UI wiring are out of scope — frontend agent owns those
against the contract in item D below.

## Files Changed

| File | Lines | Purpose |
|---|---|---|
| `supabase/migrations/062_campaign_failed_status.sql` | +17 | Adds `'failed'` to `campaigns_status_check`, nullable `failure_reason text` |
| `src/domain/entities/campaign.ts` | +4/-1 | `status` union gains `'failed'`; new `failureReason: string \| null` |
| `src/infrastructure/supabase/repositories/campaign-mapper.ts` | +4 | Maps `failure_reason` ↔ `failureReason` both directions |
| `src/infrastructure/supabase/repositories/campaign-repository.ts` | +23 | New `markCampaignFailed(id, reason)` — CAS `status='active'→'failed'` |
| `src/application/resolve-whatsapp-template.ts` (new) | 24 | Extracted from `execute-campaign.ts` so the route can reuse identical template resolution |
| `src/application/execute-campaign.ts` | -13 net | Now imports `resolveWhatsAppTemplate` instead of a local copy |
| `src/app/api/dashboard/campaigns/[id]/execute/route.ts` | +15 | Runs `resolveWhatsAppTemplate` + `enforceTemplateReview` synchronously BEFORE `addCampaignJob`; existing `CampaignGuardrailError` catch now live |
| `src/application/build-campaign-template-review-states.ts` (new) | 74 | N+1-free per-campaign `{required, status}` computation |
| `src/app/api/dashboard/campaigns/with-template-review.ts` (new) | 17 | Attaches `templateReview` to a campaign's JSON only when applicable |
| `src/app/api/dashboard/campaigns/route.ts` | +12 | List GET wires in `buildCampaignTemplateReviewStates` |
| `src/app/api/dashboard/campaigns/[id]/route.ts` | +12 | Single GET wires in the same (campaign-scoped) |
| `src/infrastructure/supabase/repositories/whatsapp-template-repository.ts` | +22 | New `findManyByIdsForRestaurant` — batch fetch for the enrichment |
| `src/infrastructure/supabase/repositories/template-review-repository.ts` | +43 | New `findLatestTemplateReviewsByNames` — latest row per name, ANY status (unlike `findActiveTemplateReviewByName`) |
| `src/infrastructure/queue/campaign-queue.ts` | +35 | `removeOnComplete`/`removeOnFail` on `addCampaignJob`; new `handleFailedJob` calling `markCampaignFailed` when `attemptsMade >= attempts` |
| `src/infrastructure/queue/receipt-queue.ts`, `event-dispatch-queue.ts` | +5 each | Same retention options |
| `src/test-utils/builders.ts` + 14 test fixture files | +1 each | Added `failureReason: null` to `Campaign` object literals (new required field) |

## Key Decisions

- **Extracted `resolveWhatsAppTemplate`** into its own file rather than exporting the private function from `execute-campaign.ts` (which was already at the 149-line file cap). The route now imports the exact same resolution `executeCampaign` uses, so the synchronous pre-check cannot drift from the actual worker-side gate.
- **`enforceTemplateReview` in the route uses `campaign.restaurantId`**, not the requester's tenant-context `restaurantId` — matches exactly what `executeCampaign` does when the worker runs it (enqueued with `campaign.restaurantId`). This route has no `campaign.restaurantId !== restaurantId` ownership check (pre-existing, see Review Hand-off).
- **`markCampaignFailed` is compare-and-swap on `status='active'`**, mirroring `claimCampaignForEnqueue`'s established pattern in the same file, not a blind update — avoids clobbering a campaign a concurrent path already moved (e.g. manual pause).
- **`findLatestTemplateReviewsByNames` deliberately does NOT filter by status** (unlike the existing `findActiveTemplateReviewByName`, which only returns pending/approved). The UI needs to see a *rejected* or *changes-requested* row to explain the block — reporting `status: 'none'` for a rejected submission would be misleading.
- **N+1 prevention for item D**: `buildCampaignTemplateReviewStates` issues exactly one `isTenantTrusted`, one batch template fetch (`.in('id', ids)`), and one batch review fetch (`.in('template_name', names)`) regardless of campaign list size — verified by a dedicated test (`issues exactly ONE trust check...`).
- **`templateReview` is an omitted key, not `null`**, when it doesn't apply (per the D contract's "populate when the campaign references a MARKETING template"). `withTemplateReview` returns a plain campaign spread with no `templateReview` key in that case, not `templateReview: undefined` serialized as `null`.
- **Failure-reason truncation**: 500 chars + ellipsis, matching "truncate sensibly" from the issue. No existing truncate util in the codebase; added a small local helper in `campaign-queue.ts`.
- **Dynamic `import()` for `markCampaignFailed`** inside `handleFailedJob`, mirroring the existing pattern in `event-dispatch-queue.ts`'s `handleFailedJob` (keeps the worker module's static dependency surface thin) rather than introducing a new convention.

## Tests

- 340 test files / 3366 tests pass full-suite (`vitest run`), 0 failures, 21 pre-existing skipped, 2 todo.
- `tsc --noEmit` clean.
- New/updated suites: `campaign-mapper.test.ts`, `campaign-repository.test.ts` (+`markCampaignFailed`), `whatsapp-template-repository.test.ts` (+`findManyByIdsForRestaurant`), `template-review-repository.test.ts` (+`findLatestTemplateReviewsByNames`), `resolve-whatsapp-template.test.ts` (new), `build-campaign-template-review-states.test.ts` (new, includes explicit N+1 query-count assertions), `campaign-queue.test.ts` (new — retention options + `'failed'` handler), `receipt-queue.test.ts` (new), `event-dispatch-queue.test.ts` (extended), execute-route test (new), campaigns list/detail GET tests (extended).
- Known flaky test `route.quality-event.integration.test.ts` (#92) passed both in the full run and in isolation — not a regression from this change.
- Gap: no test directly exercises `getDueCampaigns()` excluding `status='failed'` rows — covered only by the existing query's `.eq('status', 'active')` filter (unchanged) plus the domain reasoning documented in migration 062. Low risk since the filter itself wasn't touched.

## Deferred / Tech Debt

- Item A (WAQ-011 tenant submit / admin approve-reject UI) is fully out of scope for this task — the gate remains unsatisfiable by any product action for untrusted tenants until that ships.
- Part A fix 3 (worker-side failure → terminal status is now recorded via `markCampaignFailed`, but *surfacing* it on the campaign card/banner is frontend work).
- One-off prod cleanup (drain `bull:campaign-execution:failed`, settle campaign `3f663bf2-...`) is explicitly NOT done per the issue — ops action, not code.

## Review Hand-off

- **Pre-existing IDOR-shaped gap, NOT introduced by this change**: neither `GET /api/dashboard/campaigns/[id]/route.ts` nor `POST .../execute/route.ts` checks `campaign.restaurantId === tenantContext.restaurantId` before acting — `getCampaignById` is unscoped by tenant (unlike `findByIdForRestaurant` used elsewhere, e.g. SEC-001 / PR #101 for wa-templates). I did not fix this — it's outside issue #102's stated scope and touching it would be a second security-sensitive change riding on this PR. Flagging for a follow-up issue akin to SEC-001.
- `resolveWhatsAppTemplate` now throws (uncaught by any specific handler) when a campaign's `whatsappTemplateId` points at a missing or unapproved template — this happens synchronously in the execute route now (previously only inside the worker). It falls through to the route's generic 500 handler, which is arguably an improvement (surfaces sooner) but is a behavior change worth eyeballing.
- `campaigns_status_check` constraint in migration 062 assumes `INSERT`/`UPDATE` paths never race the constraint before the migration lands — not a concern here since Supabase migrations are applied server-side ahead of any deploy that could write `status='failed'`.
