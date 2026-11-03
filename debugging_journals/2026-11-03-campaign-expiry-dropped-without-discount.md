# 2026-11-03 — Campaign expiry silently dropped when no discount value (CAMP-EXPIRY-001)

## Problem
A merchant edited prod campaign `6fff0fa9…` ("Nov promo_batch1", a free-item offer with Discount Value left blank), changed Expiry (days) from 30 to 60, and saved. When they reopened the form it showed 30 again. Nothing told them the value had not been saved.

## Root cause
- `buildCampaignRequestBody` (`src/components/dashboard/campaign-form-types.ts`) sends `couponConfig: null` whenever `Number(discountValue) > 0` is false. The expiry lives inside `couponConfig`, so it is discarded along with it.
- The PATCH stores `coupon_config = null`.
- `campaignToFormState` (`campaign-form-dialog.tsx`) falls back to `'30'` when `couponConfig` is null, so the reopened form shows the default.
- `couponConfig: null` is the deliberate marketing-only mode (#134): `execute-campaign-broadcast.ts` sends the message with no coupon and no QR. The send semantics were correct. The form just never told the merchant about them, and it let them type an expiry that could not be saved.

## Fix
- Round 0 (PR #173, commit 8286d286) added `hasCouponDiscount(form)` and one amber notice saying "no coupon or QR code is issued". Review found that notice is wrong for claim-button templates: `sendToMember` (`execute-campaign-broadcast.ts`) checks `isClaimTemplate` before `couponConfig`, and `claim-campaign-coupon.ts` mints a coupon on tap even when `couponConfig` is null. That coupon has no discount and never expires (`expiresAt` null).
- Round 1 (review round 1) replaced the predicate with `couponFormMode(form, selectedTemplate)` in `campaign-form-types.ts`. It returns `{ mode, discount }`, with the mode in the same order as `sendToMember`:
  - `discount`: the discount value is > 0. A coupon is issued and the expiry is saved.
  - `claim_no_discount`: no discount, and the selected WhatsApp template is a claim template (`isClaimTemplate` from `src/domain/services/campaign-mode.ts`, the function the sender uses). Inline campaigns are never claim campaigns.
  - `marketing_only`: anything else. No coupon is issued (#134).
- `CouponConfigFields` (`campaign-form-fields.tsx`) shows the existing notice for `marketing_only` (`campaign-coupon-no-discount-alert`, `campaigns.couponNoDiscountAlert`). For `claim_no_discount` it shows a second notice (`campaign-coupon-claim-no-discount-alert`, `campaigns.couponClaimNoDiscountAlert`). In both modes the Discount Type and Expiry fields are disabled.
- The approved-template list moved out of `CampaignMessageTypeField` into `useApprovedWaTemplates`, so the coupon fields can see the selected template's components. No new route was added.
- Send and server semantics are unchanged. `couponConfig` is null whenever the discount is not > 0, and `buildCampaignRequestBody` uses the same parsed discount.

## Prevention
- The form's mode copies the sender's branch order and calls the sender's own `isClaimTemplate`. A form helper that only looked at the form fields could not see the claim path. That is how round 0 shipped a wrong "no coupon" message for claim templates, even though its request-body check was internally consistent.
- Tests in `campaign-form-fields.test.ts` check the mode for each send path. Inline with a blank discount gives `marketing_only`. A BODY-only template with a blank discount gives `marketing_only`. A QUICK_REPLY claim template with a blank discount gives `claim_no_discount`. Any send with a discount of 10 gives `discount`.
- Rule of thumb: when a form explains what a send will do, derive the explanation from the sender's own decision functions, in the sender's order. Never restate them from the form's fields alone.
- Rule of thumb: a field that a mode silently ignores must be disabled in that mode, and the form must say why.
