---
id: artifacts/2026-08-28-camp-009-stream-b-marketing-only-broadcast-backend
type: artifact
author: senior-backend-dev
created: 2026-08-28
status: active
supersedes: null
superseded_by: null
related: [kanban:CAMP-009, github:134]
---

# CAMP-009 Stream B — marketing-only broadcast (#134)

Plan: `plans/2026-08-28-camp-009-create-autosend-and-marketing-only-broadcast` (Stream B section).

## Files Changed

| File | Lines | Purpose |
|---|---|---|
| `src/application/execute-campaign-broadcast.ts` | +36/-3 (header comments + new branch + new function) | Add third dispatch mode: marketing-only (couponConfig null) — sends the body with empty code, no coupon mint, no QR |
| `src/application/__tests__/execute-campaign-broadcast.test.ts` | +114 | New `describe('sendToMember — marketing-only (couponConfig null) #134')` with 7 tests |

## Key Decisions

- Implemented `sendToMember` exactly as specified in the plan: claim precedence first, then `if (!ctx.campaign.couponConfig) return sendMarketingOnlyToMember(...)`, else eager. `sendMarketingOnlyToMember` mirrors `sendClaimToMember`'s shape (body send → `throwIfNotOk` → increment → `emitEvent` with `dataJson: { campaignId }`, no `couponCode` key) rather than eager mode's shape, per the plan.
- `sendMarketingOnlyToMember` takes no `prefetch`/`existing` parameter at all — the call site in `sendToMember` never looks up `prefetch.existingCoupons` for this branch, so a leftover coupon from a pre-fix run structurally cannot be read, reused, or cause a skip (AC4/AC5). This is stronger than "ignore the value" — there's no code path that could accidentally consult it.
- `buildCouponDescription(member, ctx, '')` reused as-is (no new helper) — with `code: ''` it renders the inline template text (falling back to campaign name if blank), same as the plan specified.
- Updated both header comment blocks (module-level responsibility comment + the CAMP-001 dispatch comment above `sendToMember`) to name the third mode and its precedence order, per the plan's requirement.

## Tests

7 new tests added, all passing; 76/76 total in `execute-campaign-broadcast.test.ts` + `execute-campaign.test.ts` + `execute-campaign-batch-counters.test.ts` combined.

- `AC1: sends body with empty code, mints/QRs nothing, increments once, emits without couponCode` — asserts `sendCampaignBody` called with `''`, `generateCouponCode`/`createCampaignBroadcastCoupon`/`sendCouponQr` NOT called, `incrementCampaignSent('camp-1', true)`, and `emitEvent`'s `dataJson` `toStrictEqual({ campaignId: 'camp-1' })` (strict equal — proves no `couponCode` key present, not just "wasn't asserted").
- `AC2: throws and does NOT increment/emit/mint/QR when the body send fails`
- `AC3: claim precedence — claim template + null couponConfig still uses the claim path`
- `AC4: an existing ACTIVE leftover coupon is ignored — still marketing-only, no mint/QR`
- `AC5: an existing REDEEMED leftover coupon does not skip — still sends the announcement` (proves the marketing-only branch never reads `countedMemberIds`-adjacent redeemable-coupon skip logic that `sendEagerToMember` has)
- `a URL-button template with null couponConfig goes marketing-only (no mint)` (extra test named in the brief)

### Red → green evidence

Before the code change, 4 of the 6 core-behavior tests failed against the pre-fix code (confirming they exercise the new branch, not already-passing behavior):
- `AC1` — failed: `sendCampaignBody` was called with the eager path's minted code, not `''`.
- `AC4` — failed: eager path's `existing.code` ('OLDCODE') was sent instead of `''`.
- `AC5` — failed: outcome was `'skipped_already_sent'` (eager path's `isCouponRedeemable` gate fired) instead of `'sent'`.
- `a URL-button template ...` — failed: `createCampaignBroadcastCoupon` was called once (eager mint) when the test asserts it must NOT be called.

`AC2` and `AC3` passed even before the fix — they exercise behavior (fail-throws-nothing-happens, claim-precedence-over-coupon-config) that eager mode already satisfied structurally, so they're regression guards rather than red→green proof for those two ACs specifically. This is expected and matches the plan's AC list (AC2/AC3 describe invariants that must hold in the new branch too, not necessarily new behavior).

### Command output summary

- `./node_modules/.bin/vitest run src/application/__tests__/execute-campaign-broadcast.test.ts src/application/__tests__/execute-campaign.test.ts src/application/__tests__/execute-campaign-batch-counters.test.ts` → **76 passed (76)**, 3 test files passed.
- `./node_modules/.bin/tsc --noEmit` → clean, no output.
- `./node_modules/.bin/eslint src/application/execute-campaign-broadcast.ts src/application/__tests__/execute-campaign-broadcast.test.ts` (`npm run lint` maps directly to `eslint`) → clean, no output.

## Deferred / Tech Debt

None introduced. Per the plan's "Out of scope" note, an explicit `sends_coupon` flag and skipping the rerun-coupon prefetch query for coupon-less campaigns are deliberately NOT implemented here (CAMP-004 territory / harmless extra read).

## Grep for conflicting assertions (boundary check requested in the brief)

Grepped `src/application/__tests__/execute-campaign.test.ts` for `couponConfig`: all 6 hits use a non-null config (`{ discountType: 'percentage'|'fixed_amount', ... }`), including every `buildCampaign`/`buildCampaignFor` default. **No campaign in that file is built with a null coupon config**, so there is no existing coupon-mint/QR assertion that conflicts with the new marketing-only branch. `execute-campaign.test.ts` was left untouched, as the boundary allowed only if a conflict existed.

## Review Hand-off

- Nothing flagged as a concern beyond the risk already named in the plan itself (prod row "Free Drink Promotion" with `couponConfig: null` may have intended to hand out a coupon; the form cannot currently express a zero-discount coupon, so this is a pre-existing representability gap, not something this change introduces or worsens).
- `execute-campaign-broadcast.ts` is now further over the 150-line guideline (192 → ~220 lines with the new branch/function/comments) — left as-is per the brief's explicit instruction to match the file's existing style rather than split it.
- Did not touch, run, or verify `campaign-form-dialog.tsx`/`campaign-form-dialog.test.ts`/`en.json`/`zh-HK.json`/`.claude/kanban.json` — those are modified in the same worktree by the parallel Stream A (#136) frontend teammate; confirmed via `git status --porcelain` that my diff is isolated to the two files listed above.
