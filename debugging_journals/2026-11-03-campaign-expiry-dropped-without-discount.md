# 2026-11-03 — Campaign expiry silently dropped when no discount value (CAMP-EXPIRY-001)

## Problem
A merchant edited prod campaign `6fff0fa9…` ("Nov promo_batch1", a free-item offer with Discount Value left blank), changed Expiry (days) from 30 to 60, and saved. When they reopened the form it showed 30 again. Nothing told them the value had not been saved.

## Root cause
- `buildCampaignRequestBody` (`src/components/dashboard/campaign-form-types.ts`) sends `couponConfig: null` whenever `Number(discountValue) > 0` is false. The expiry lives inside `couponConfig`, so it is discarded along with it.
- The PATCH stores `coupon_config = null`.
- `campaignToFormState` (`campaign-form-dialog.tsx`) falls back to `'30'` when `couponConfig` is null, so the reopened form shows the default.
- `couponConfig: null` is the deliberate marketing-only mode (#134): `execute-campaign-broadcast.ts` sends the message with no coupon and no QR. The send semantics were correct. The form just never told the merchant about them, and it let them type an expiry that could not be saved.

## Fix
- Added `hasCouponDiscount(form)` in `campaign-form-types.ts`. It is now the only definition of "this form issues a coupon". `buildCampaignRequestBody` uses it to decide `couponConfig`, and the form uses it for the UI.
- `CouponConfigFields` (`campaign-form-fields.tsx`): when `hasCouponDiscount` is false it shows an amber `role="status"` notice (`data-testid="campaign-coupon-no-discount-alert"`, i18n key `campaigns.couponNoDiscountAlert` in en and zh-HK). The notice says no coupon or QR code will be issued and the expiry will not be saved. The Expiry input is disabled in that state.
- Send semantics are unchanged: a blank or 0 discount still sends `couponConfig: null`.

## Prevention
- One shared predicate means the form's warning and the request body cannot disagree about when a coupon exists. A test in `campaign-form-fields.test.ts` asserts that `buildCampaignRequestBody(form).couponConfig !== null` equals `hasCouponDiscount(form)` for blank, 0, 0.5, 10 and -1.
- Rule of thumb: a form field that a mode silently ignores must be disabled in that mode, and the form must say why.
