---
id: artifacts/2026-08-28-camp-009-round-2-code-review-fixes-backend
type: artifact
author: senior-backend-dev
created: 2026-08-28
status: active
supersedes: null
superseded_by: null
related: [kanban:CAMP-009, github:134]
---

# CAMP-009 round 2 — /code-review fixes on PR #140 (R1–R7)

Tightens the coupon-param preflight gate from the round-1 partial allow-list to the full
invariant: `couponConfig === null` means "nothing coupon-related will ever be supplied or
minted" — refuse any campaign with no coupon config whose message (real template OR inline
copy) would need coupon data.

## Files Changed

| File | Lines | Purpose |
|---|---|---|
| `src/domain/entities/whatsapp-template.ts` | +8 | R2: new exported `isDynamicUrlButton(b)` predicate, shared by the gate and the sender |
| `src/domain/services/campaign-mode.ts` | ~+18/-8 | R1: `templateExpectsCouponCode` now also matches `{{discount}}` in the body and a `COPY_CODE` button; uses `isDynamicUrlButton` |
| `src/application/enforce-coupon-params.ts` | rewritten, 82 lines | R3+R4: dropped the claim exemption (claim mints at tap time → now throws); added `inlineCopyExpectsCoupon(campaign)` for `template === null` campaigns; `CampaignCouponConfigMissingError` gained a `reason` param (`'template' \| 'claim' \| 'inline'`, default `'template'` — backward compatible with the existing single-string call in `campaign-queue.test.ts`, untouched) driving three message variants |
| `src/application/send-template-message.ts` | 1-line swap + import | R2: `buildUrlButtonParams` now calls `isDynamicUrlButton(btn)` instead of the inline `btn.type === 'URL' && btn.url?.includes('{{1}}')` check — behaviour identical, single source of truth |
| `src/application/execute-campaign-rerun-prefetch.ts` | ~+3 | R5: coupon-prefetch query also skipped when `!ctx.campaign.couponConfig` (marketing-only never reads `existingCoupons`), alongside the existing claim-mode skip |
| `src/application/execute-campaign-broadcast.ts` | ~+12/-24 | R6: extracted `recordSent(member, ctx, couponCode?)` — the `incrementCampaignSent` + `emitEvent` + `return 'sent'` tail that was triplicated across claim/marketing-only/eager. `dataJson` includes `couponCode` only when passed (ternary), matching both pinned test shapes exactly |
| `src/application/__tests__/enforce-coupon-params.test.ts` | +7 tests, 1 fixed, 1 reversed | See Tests below |
| `src/domain/services/__tests__/campaign-mode.test.ts` | +2 tests | `{{discount}}` and `COPY_CODE` cases for `templateExpectsCouponCode` |
| `src/domain/entities/__tests__/whatsapp-template.test.ts` | +1 describe, 4 tests | New coverage for `isDynamicUrlButton` (dynamic / static / no-url / non-URL-type) |
| `src/application/__tests__/execute-campaign-rerun-prefetch.test.ts` (new) | 100 lines | No test file existed for `loadRerunPrefetch` before this dispatch — created one covering tracking on/off, claim-mode skip, the new R5 null-couponConfig skip, and the normal fetch path |
| `src/application/__tests__/execute-campaign-broadcast.test.ts` | R6 assertions unchanged; R7 hygiene | Hoisted the duplicated `prefetchWith` helper to file scope (was defined identically in both the #131 and #134 `describe` blocks); M-3 test switched `mockImplementation`/`mockReturnValue` → `mockImplementationOnce`/`mockReturnValueOnce` and the "MUST stay last" ordering comment was deleted (verified: the once-variants fall back cleanly to the describe's `beforeEach` defaults on the next call, so ordering no longer matters) |
| `src/app/api/dashboard/campaigns/[id]/execute/__tests__/route.test.ts` | +12 (3 fixtures) | See "Unplanned but required fix" below |

## Key Decisions

- **`CampaignCouponConfigMissingError` constructor kept backward-compatible.** `campaign-queue.test.ts` (out of the touch-list) calls `new CampaignCouponConfigMissingError('free_drink')` directly with one arg. Rather than a breaking redesign, the `reason` param defaults to `'template'`, so that call site keeps compiling and asserting byte-for-byte what it always asserted (message passed through verbatim to `markCampaignFailed`) — untouched, per Boundaries.
- **R3+R4 combined via one gate, not `isClaimTemplate(...) || templateExpectsCouponCode(...)`.** The dispatch's shorthand OR'd the two conditions, but they need different messages ("mints a coupon when the customer taps Claim" vs "expects a coupon code / discount..."), so `enforceCouponParams` branches them separately while preserving the same boolean gate.
- **`inlineCopyExpectsCoupon` returns `string | null` (the placeholder found), not `boolean`** — satisfies both the truthy `if (placeholder)` check the dispatch describes and the requirement to name the placeholder in the error message.
- **Truthiness, not `!== null`, for `campaign.couponConfig`** everywhere in this dispatch (`enforceCouponParams`, `execute-campaign-rerun-prefetch.ts`) — matches `sendToMember`'s existing `!ctx.campaign.couponConfig` predicate so an accidental `undefined` can never slip through the gate as "configured". Covered by a dedicated test.

## Unplanned but required fix (flag for reviewer)

R4 (the inline-copy guard) exposed a pre-existing landmine in the shared test builder:
`buildCampaign()` in `src/test-utils/builders.ts` defaults `template: 'Hi {{name}}, use code
{{code}}!'` (contains `{{code}}`) with `couponConfig: null`. Three `route.test.ts` happy-path
tests built a campaign via `buildCampaign({ ...only id/restaurantId/status })` with
`resolveWhatsAppTemplate` mocked to `null` (inline-campaign path) — under R4 this now
correctly throws `CampaignCouponConfigMissingError`, which flipped those three tests from
200→409 red. This wasn't the claim-exemption case the dispatch called out, but it's the same
class of problem (fixture relied on the pre-R4 "template === null always passes"
short-circuit), so I fixed it the same way as the analogous case in
`enforce-coupon-params.test.ts`: gave the three fixtures (`route.test.ts` — the shared
`beforeEach` default, the "runs guardrails -> ... -> enqueue" ordering test, and "enqueues
normally for a same-tenant request") an explicit placeholder-free `template` string instead of
weakening the production check. `src/test-utils/builders.ts` itself was left untouched
(shared infra, out of Boundaries, and other suites may rely on its `{{code}}` default) —
worth a follow-up ticket if this collision recurs elsewhere. `execute-campaign.test.ts` (the
worker test, same carve-out) uses its own local builder and was unaffected — ran green
untouched.

## Tests

Per-item, TDD (red confirmed before each production change):

- **R1**: `campaign-mode.test.ts` — `{{discount}}`-only body → true (red: was false); `COPY_CODE` button → true (red: was false).
- **R2**: `whatsapp-template.test.ts` — new `isDynamicUrlButton` describe (4 cases); `send-template-message.test.ts` unchanged, still green (behaviour-preserving swap).
- **R3**: `enforce-coupon-params.test.ts` — claim + null config now **throws** naming "taps Claim" (reverses the old exemption test, red: was not-throw); claim + config set → ok (new); `couponConfig: undefined` + `{{code}}` → throws (new, proves truthiness check).
- **R4**: `enforce-coupon-params.test.ts` — inline `templateEn` with `{{couponCode}}` + null config → throws naming `{{couponCode}}` (new, red: `Cannot find` — old code always returned on `!template`); inline copy with no placeholder → ok (new); fixed test 1's fixture (see above) so it tests the intended "no placeholder" case instead of accidentally colliding with R4.
- **R5**: `execute-campaign-rerun-prefetch.test.ts` (new file, no prior coverage existed) — 5 cases: tracking on/off, claim-mode coupon-query skip, **new null-couponConfig coupon-query skip**, normal fetch path.
- **R6**: `execute-campaign-broadcast.test.ts` — all existing `dataJson` shape assertions (`{ campaignId }` for claim/marketing-only, `{ campaignId, couponCode }` for eager) passed unchanged against the refactored `recordSent`, proving the extraction is behaviour-preserving.
- **R7**: hygiene-only, no new assertions; full file still green after the `Once`-mock swap and the `prefetchWith` hoist.

Full command output:
- `./node_modules/.bin/tsc --noEmit` → clean, no output.
- `./node_modules/.bin/vitest run` (full suite) → **369 test files passed, 4 skipped; 3774 tests passed, 21 skipped, 2 todo. 0 failed.** (the known-flaky `route.quality-event.integration.test.ts` #92 did not misfire this run).
- `./node_modules/.bin/eslint` on all 12 touched files (7 production, 5 test) → clean, no output.

## Deferred / Tech Debt

- `src/test-utils/builders.ts`'s `buildCampaign()` default `template` field containing `{{code}}` is a footgun for any future coupon-related gate — flagged above, not fixed (out of Boundaries).
- Everything else from the round-1 artifact (`2026-08-28-camp-009-stream-c-coupon-param-preflight-backend.md`) that was already deferred remains deferred; nothing new introduced beyond the builder footgun.

## Review Hand-off

- Flag the three `route.test.ts` fixture edits explicitly — they're outside the literal R1–R7 list but required to keep the suite green after R4, and are the same "give the fixture a placeholder-free copy" pattern already used in `enforce-coupon-params.test.ts`'s own test 1 fix.
- `CampaignCouponConfigMissingError`'s constructor signature changed (`(subject, reason = 'template')`) but stayed source-compatible with the one external call site (`campaign-queue.test.ts`) — worth a quick instanceof/message sanity check by the reviewer since the class no longer always says "expects a coupon code" for every reason.
- Three unrelated files (`.claude-workspace/INDEX.md`, `.claude/kanban.json`,
  `debugging_journals/2026-08-28-campaign-create-autosend-and-marketing-only-mint.md`) show as
  modified in this worktree — not touched by this dispatch; likely another concurrent
  teammate writing to the same shared worktree. Not staged or committed by this dispatch.
