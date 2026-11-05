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
- **Re-run:** new tenant-scoped `POST /api/dashboard/campaigns/[id]/rerun`, sharing its gates and error mapping with `/execute`. Order: field refusals (`rerunBlock`), row evidence, gates, the `failed -> active` CAS that clears the reason, the enqueue lease, the job. The failed card offers it behind a confirmation sheet, which states that coupons keep their original expiry.
- **When a re-run is refused:** `rerunBlock` refuses welcome campaigns, the delivery-unknown reason and the 131047 reason, and the card hides the button for those. `findRerunEvidenceRefusal` then answers 409 when tracking is off, when the campaign has no body rows, when any failed body row has a null `error_code`, or when any of its coupons has expired. A null code means our side recorded the failure with no decision from Meta, for example a Kapso timeout that may have reached Meta. That check uses exact head counts and fails closed: a query error answers 500 with no write. The send pipeline is unchanged, so every campaign send behaves as before. The card still shows the button in these cases, and the server's message appears on the card.
- **Known cost of that guard:** a synchronous Meta 4xx is stored with a null code and a queue failure before any send leaves no body rows, so both get the contact-support refusal, while "All N message sends failed... before retrying" still invites a retry. A status webhook with no `errors`, or with an unknown status string, also leaves a null code and refuses. All of these are wrong refusals, which are recoverable. A duplicate blast is not.
- **Enqueue failures:** if the lease, stamp or job throws after the CAS, the campaign goes back to `failed` with its original reason and the route answers 500; a failed revert is logged at error with the campaign id. On a lost lease, an unscheduled campaign stamps `last_enqueued_at` and adds the job, because no cron selects it. A scheduled one adds no job, because the cron enqueues it once the lease lapses.
- **Refetch on refusal:** the card refetches after any non-OK re-run response. The page now shows its skeleton only on the first load, because a refetch that unmounted the cards would have erased the refusal before anyone read it.
- **Retracted runs:** a run whose CAS lost with `errored` members now writes the delivery-unknown reason, not Meta's wording.
- **QR-only warning:** one domain rule, `isQrOnlyCouponCampaign`, shown in the campaign form and on active and failed cards. Warn only, never a block. `{{couponCode}}` and `COPY_CODE` no longer count as carrying the code, because the sender fills neither. A failed card and the confirmation sheet say to create a new campaign with a quick-reply (claim) template, because a failed campaign's template cannot change.
- **QR failures:** the list API returns an exact head count of failed QR images only for QR-only campaigns with counted sends, from `last_enqueued_at` onward when that is set, degrading off on error. Other campaigns get no count and show no warning. The card warns when the count is above 0, in wording that names no deciding system. `uploadCouponQr` moved inside the tracked send, so a failed upload also leaves a failed row.
- **Billing:** unchanged. A delivered template with a failed QR stays counted.

Stored reasons are not rewritten: Bicho's and 長盈行's existing failed cards keep their old wording until a new run writes a new reason.

No production data or code changed by this investigation.

## Prevention measures

- Tenant-facing diagnosis must come from what the deciding system said, not from one past incident's cause. An error code can cover several causes.
- Any remedy named in an error message must exist in the UI (already in WAQ-014's principle; missed here).
- A follow-up message that carries the actual offer needs its own delivery outcome on the campaign. "Never counted" must not mean "never reported".
