# 2026-11-03 — Campaign expiry silently dropped when no discount value (CAMP-EXPIRY-001)

## Problem
A merchant edited prod campaign `6fff0fa9…` ("Nov promo_batch1", a free-item offer with Discount Value left blank), changed Expiry (days) from 30 to 60, and saved. When they reopened the form it showed 30 again. Nothing told them the value had not been saved.

## Root cause
- `buildCampaignRequestBody` (`src/components/dashboard/campaign-form-types.ts`) sends `couponConfig: null` whenever `Number(discountValue) > 0` is false. The expiry lives inside `couponConfig`, so it is discarded along with it.
- The PATCH stores `coupon_config = null`.
- `campaignToFormState` (`campaign-form-dialog.tsx`) falls back to `'30'` when `couponConfig` is null, so the reopened form shows the default.
- `couponConfig: null` is the deliberate marketing-only mode (#134): `execute-campaign-broadcast.ts` sends the message with no coupon and no QR. The send semantics were correct. The form just never told the merchant about them, and it let them type an expiry that could not be saved.

## Fix
- Round 0 (PR #173, commit 8286d286) added `hasCouponDiscount(form)` and one amber notice saying "no coupon or QR code is issued". Review found the notice is wrong for any message that needs a coupon, because the server never sends those without a coupon config.
- Round 1 (commit 40759a7d) copied `sendToMember`'s branch order and added a "claim template without discount" notice. That notice was also false. `enforceCouponParams` (`src/application/enforce-coupon-params.ts`) runs before `sendToMember` (`execute-campaign.ts`, and the execute route). It refuses a campaign with no coupon config when the template is a claim template, when the template expects a coupon code, or when the inline copy contains `{{code}}`, `{{couponCode}}` or `{{discount}}`. So the sender's claim branch is never reached without a discount.
- Round 2 (review round 2) moved the rule into one pure domain function, `couponRequirement({ hasCouponConfig, template, inlineTexts })` in `src/domain/services/coupon-requirement.ts`. It returns:
  - `satisfied`: a coupon config is set.
  - `blocked` (with a reason of `claim`, `template` or `inline`, and a subject): no coupon config, and the message needs a coupon. Send will be refused.
  - `marketing_only`: no coupon config, and nothing in the message needs one (#134).
- `enforceCouponParams` now calls `couponRequirement` and throws `CampaignCouponConfigMissingError(subject, reason)` on `blocked`, exactly as before. Its test file is unchanged and passes.
- The form's `couponFormMode` (`campaign-form-types.ts`) is a thin adapter over the same function. It returns `discount`, `marketing_only`, `blocked`, or `unknown`. `unknown` means a WhatsApp template is chosen but its object has not been resolved (still loading, the fetch failed, or it is not in the loaded page), so the form does not guess.
- `CouponConfigFields` shows the existing notice for `marketing_only` and a new "Send will be refused" notice for `blocked` (`campaign-coupon-blocked-alert`, `campaigns.couponBlockedAlert`). It shows no notice for `discount` or `unknown`. Discount Type is always enabled. Expiry is disabled whenever there is no discount, because it cannot be saved without one.
- The form reads approved templates through the shared `useWaTemplates` hook (`src/hooks/use-wa-templates.ts`, with a new `enabled` option), replacing round 1's second fetch.
- Send and server semantics are unchanged. `couponConfig` is null whenever the discount is not > 0.

## Prevention
- The server guard and the form now share one domain function, so they cannot drift. Rounds 0 and 1 both restated the server's decision in the form, and each copy missed a step: round 0 missed claim templates, and round 1 missed the pre-send guard.
- Tests: `src/domain/services/__tests__/coupon-requirement.test.ts` covers each branch, including a body-only template like prod `nov_promo_2026` (IMAGE header + plain BODY) giving `marketing_only`. `campaign-form-fields.test.ts` checks the form's mapping, including `unknown`. `enforce-coupon-params.test.ts` is unchanged and pins the guard's behaviour.
- Rule of thumb: when a form explains what a send will do, call the same decision function the server uses, and trace the whole server path (guards and validators as well as the sender) before writing the explanation.
- Rule of thumb: a field that a mode silently ignores must be disabled in that mode, and the form must say why.
