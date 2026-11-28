---
id: artifacts/2026-08-28-camp-009-stream-c-coupon-param-preflight-backend
type: artifact
author: senior-backend-dev
created: 2026-08-28
status: active
supersedes: null
superseded_by: null
related: [kanban:CAMP-009, github:134]
---

# CAMP-009 Stream C — coupon-param preflight (I-1)

Resolves `reviews/2026-08-28-camp-009-issues-136-134-analyzer` finding **I-1** (and **M-3**).
`enforceHeaderMedia` was the pattern mirrored throughout.

## Files Changed

| File | Lines | Purpose |
|---|---|---|
| `src/application/enforce-coupon-params.ts` (new) | 29 | `CampaignCouponConfigMissingError` + `enforceCouponParams(campaign, template)` — throws when `couponConfig === null`, template is non-null, non-claim, and expects a code |
| `src/domain/services/campaign-mode.ts` | +21/-2 | New pure predicate `templateExpectsCouponCode(template)`: `extractParameters(template).includes('code')` OR a `BUTTONS` component has a `URL` button whose `url` includes `'{{1}}'` |
| `src/app/api/dashboard/campaigns/[id]/execute/route.ts` | +8 | Call `enforceCouponParams(campaign, template)` right after `enforceHeaderMedia(template)`; catch branch maps `CampaignCouponConfigMissingError` → 409 |
| `src/application/execute-campaign.ts` (worker) | +5 | Same call, same position, right after `enforceHeaderMedia(template)`, before `transitionCampaignStatus` — matches the header-media fail-fast-before-claim pattern exactly |
| `src/infrastructure/queue/campaign-queue.ts` | +6/-1 | **Deviation from the brief's touch-list** (see below) — added `CampaignCouponConfigMissingError` to `isTenantMeaningfulError` so a cron-scheduled run that exhausts retries writes the real message to `failure_reason` instead of the generic one |
| `src/application/__tests__/enforce-coupon-params.test.ts` (new) | 92 | 7 cases: null template ok, coupon-configured+`{{code}}` ok, null+neither ok, null+`{{code}}` body throws (asserts template name + "OhMyClient"), null+dynamic URL button throws, null+static URL button ok, null+claim(QUICK_REPLY) template with `{{code}}` ok (claim exemption) |
| `src/domain/services/__tests__/campaign-mode.test.ts` | +46 | New `describe('templateExpectsCouponCode')`, 3 tests (body code / URL button / neither) |
| `src/app/api/dashboard/campaigns/[id]/execute/__tests__/route.test.ts` | +29 | New 409 case: coupon-less campaign + `{{code}}` template → 409, `addCampaignJob` not called |
| `src/application/__tests__/execute-campaign.test.ts` | +23 | New case in the `#127 all-failed runs and media-header guard` describe: same "fails fast BEFORE status transition" assertions as the header-media test, for `CampaignCouponConfigMissingError` |
| `src/infrastructure/queue/__tests__/campaign-queue.test.ts` | +6 | New `it.each` row for `CampaignCouponConfigMissingError` in the "failure_reason wording (item 8)" table |
| `src/application/__tests__/execute-campaign-broadcast.test.ts` | +30 (appended) | M-3: one test using `vi.importActual` to delegate `renderTemplate` to the real implementation, proving `'Hi {{name}}, code {{code}}'` + null couponConfig renders as `'Hi Alice, code '` (trailing space, real renderer, not the module-mocked `'desc'`) |

## Key Decisions

- **Predicate placed in the domain service** (`campaign-mode.ts`), not inside `enforce-coupon-params.ts` — it's a pure function over `WhatsAppTemplate` shape with no application-layer dependency, same rationale as `isClaimTemplate` living there. Kept the addition to 21 lines.
- **Claim-mode exemption is structural, not special-cased**: `enforceCouponParams` calls `isClaimTemplate(template)` from the same module — claim templates never pass a code (pre-existing, out of scope per the brief) so they're exempted the same way `sendToMember` branches on `isClaimTemplate` first.
- **Deviation beyond the stated touch-list**: `src/infrastructure/queue/campaign-queue.ts` + its test. The brief said to give the new error "the SAME treatment" as `TemplateHeaderMediaMissingError` in the worker path and named `execute-campaign.ts` as that place. Investigating `execute-campaign.ts` showed `enforceHeaderMedia` throwing there is *not* itself where the tenant-visible `failure_reason` gets written — it just propagates the rejection out of `executeCampaign` untouched (confirmed by the pre-existing test `execute-campaign.test.ts:1637`, which asserts `updateCampaign` is NOT called on that error). The actual translation into a tenant-visible `failure_reason` happens one layer up, in the BullMQ `worker.on('failed', ...)` handler in `campaign-queue.ts`, via `isTenantMeaningfulError` / `resolveFailureReason` / `markCampaignFailed`, once `attemptsMade >= maxAttempts` (3 retries). Without adding `CampaignCouponConfigMissingError` to that allow-list, a scheduled campaign hitting I-1 would retry 3 times, exhaust, and land on the **generic** "unexpected error" message — defeating the stated goal ("fails loudly with the reason on the card"). This was a 1-line addition to an existing boolean OR chain plus one `it.each` row mirroring the existing `TemplateHeaderMediaMissingError` row exactly; no other line in either file was touched. Flagging this explicitly since it's outside the literal "Touch ONLY" list — happy to revert if the intent was narrower than the stated goal implies.
- **Error message** names the deciding system ("This is an OhMyClient pre-send check; Meta was not contacted") per `principle_error_names_deciding_system` (WAQ-014/#117), matching the memory convention the team already follows.

## Tests

- New/changed test files: 7 (2 new, 5 modified). All TDD — each addition was run red (confirmed failing for the right reason) before the corresponding production change, individually verified:
  - `enforce-coupon-params.test.ts`: 0→7 passing (module didn't exist → `Cannot find module`)
  - `campaign-mode.test.ts`: 3 new tests red (`templateExpectsCouponCode is not a function`) → green
  - route test: new 409 case red (`expected 200 to be 409`) → green
  - `execute-campaign.test.ts`: new case red (`promise resolved "undefined" instead of rejecting`) → green
  - `campaign-queue.test.ts`: new `it.each` row red (generic message instead of verbatim) → green
  - `execute-campaign-broadcast.test.ts` M-3 test: not a red→green case (pins pre-existing renderer behaviour), passed on first run — expected, since `template-renderer.ts:18-24` already maps nullish → `''`.
- Full command output:
  - `vitest run src/application src/app/api/dashboard/campaigns src/domain/services/__tests__/campaign-mode.test.ts src/infrastructure/queue/__tests__/campaign-queue.test.ts` → **126 files / 1014 tests passed**, 0 failed.
  - `tsc --noEmit` → clean, no output.
  - `eslint` on all 11 touched files → clean, no output (did not touch `campaign-form-dialog.tsx`, so the pre-existing `react-hooks/set-state-in-effect` there is untouched).
- Gaps: no test exercises the full route→worker→BullMQ integration end-to-end (each layer is tested in isolation per its own existing mock boundaries, matching how `TemplateHeaderMediaMissingError` is already tested in this codebase).

## Deferred / Tech Debt

- None introduced. M-4 (pre-existing inline-placeholder/renderer-key mismatch) from the review remains open and untouched — out of scope for I-1.

## Review Hand-off

- Flag the `campaign-queue.ts` deviation above for the reviewer explicitly — it's the one place I went past the literal "Touch ONLY" list in the dispatch, though it's required for the stated goal and is a minimal, precedent-following change (mirrors `TemplateHeaderMediaMissingError`'s existing treatment line-for-line).
- `enforceCouponParams` is NOT wired into `sendWhatsAppTemplateMessage` itself (unlike `enforceHeaderMedia`, which the send-time function also calls defensively at `send-template-message.ts:33`) — per the Boundaries, `send-template-message.ts` was explicitly off-limits for this dispatch. The two preflight call sites (route + worker) are the only send paths that reach `sendCampaignBody`/`sendWhatsAppTemplateMessage` for campaigns, so this is a complete gate for the campaign flow, but note it for anyone later adding a third campaign-send entry point.
- I-2 (missing debugging journal) is being handled elsewhere in this branch — `debugging_journals/2026-08-28-campaign-create-autosend-and-marketing-only-mint.md` already exists in the working tree (not authored by this dispatch); worth confirming it's updated to mention I-1's fix before the branch ships.
