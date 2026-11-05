# 2026-11-05 — Bicho campaign failed on Meta 131042; tenant told the wrong cause and offered a re-run that doesn't exist

## Problem

Bicho's "Nov promo_batch1" (250 members, 2026-11-04 15:30 HKT) shows failed, 0 sent. The card says the WhatsApp Business account has no billing currency configured and to re-run the campaign. Every template failed with 131042 and every QR image with 131047. Nobody received the offer.

## Root cause analysis

- **Actual cause:** Meta's detail on all 250 rows says the account's "payment has been restricted". The tenant must clear this in Meta's billing hub.
- **Wrong message:** `deliveryFailureReason` hardcodes one cause for all 131042 and never reads `error_details`. Prod has three different details under that code.
- **Missing remedy:** failed cards have no edit or send action, and `/execute` rejects non-active campaigns.
- **Latent, after billing clears:** `nov_promo_2026` puts the code only in a free-form QR image, sent after the template. Customers outside a 24-hour window should get 131047 on it, and the failure is uncounted and swallowed, so the campaign would read as a success. Not yet observed end to end.

Full analysis: `.claude-workspace/investigations/2026-11-05-bicho-campaign-131042-wrong-reason.md`.

## Solution implemented

CAMP-014, branch `fix/camp-014-failed-campaign-remedy`:

- **Reason:** `deliveryFailureReason` takes Meta's `error_details` and picks fixed wording per cause under 131042: restricted, currency, payment method, or a generic payment problem that asserts no cause. Both callers pass it. 131047 now says to create a new campaign, because a failed campaign's template cannot change.
- **Re-run:** new tenant-scoped `POST /api/dashboard/campaigns/[id]/rerun`, sharing its gates and error mapping with `/execute`. Order: gates, then the `failed -> active` CAS that clears the reason, then the enqueue lease, then the job. Refused for welcome campaigns and for the delivery-unknown reason, which can double-send. The failed card offers it behind a confirmation sheet.
- **QR-only warning:** one domain rule, `isQrOnlyCouponCampaign`, shown in the campaign form and on active and failed cards. Warn only, never a block.
- **QR failures:** the list API returns an exact head count of failed QR images per campaign with counted sends, degrading off on error. The card warns when that count is above 0. `uploadCouponQr` moved inside the tracked send, so a failed upload also leaves a failed row.
- **Billing:** unchanged. A delivered template with a failed QR stays counted.

Stored reasons are not rewritten: Bicho's and 長盈行's existing failed cards keep their old wording until a new run writes a new reason.

No production data or code changed by this investigation.

## Prevention measures

- Tenant-facing diagnosis must come from what the deciding system said, not from one past incident's cause. An error code can cover several causes.
- Any remedy named in an error message must exist in the UI (already in WAQ-014's principle; missed here).
- A follow-up message that carries the actual offer needs its own delivery outcome on the campaign. "Never counted" must not mean "never reported".
