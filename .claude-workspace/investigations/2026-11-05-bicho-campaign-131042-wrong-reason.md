---
id: investigations/2026-11-05-bicho-campaign-131042-wrong-reason
type: investigation
author: main
created: 2026-11-05
status: active
related: [debugging_journals/2026-11-05-bicho-campaign-131042-wrong-reason.md, debugging_journals/2026-08-27-outbound-status-webhooks-dropped.md, debugging_journals/2026-07-03-campaign-broadcast-qr-instead-of-claim.md]
---

# Investigation: Bicho "Nov promo_batch1" failed; the reason shown blames a missing billing currency

## Severity / Confidence / Category

- **Severity**: High. The tenant's whole batch reached nobody and the on-screen remedy is wrong twice (wrong cause, and a re-run the UI does not offer). A correct billing fix then leads into defect 3, which would look like success while customers get an unusable offer.
- **Confidence**: High on defects 1, 2 and the delivery outcome (prod rows and code). Medium-high on defect 3: Meta's own error text and third-party docs agree, but prod has no case of a delivered template followed by its QR image, so it has never been observed end to end.
- **Category**: Tenant-side Meta billing block, plus OhMyClient diagnosis and flow defects.

## Reproduction Steps (deterministic)

No failing test written yet (code changes go through a `dev` brief). Deterministic by reading:

- `deliveryFailureReason('131042', 'Business eligibility payment issue')` returns the currency text for every 131042, because the function does not receive `error_details`.
- Campaign `6fff0fa9-ccf3-4d55-9598-72f7f55421ed`, tenant Bicho `55f33c80-62c2-4050-8330-5b6c38ea804f`, prod release 53e6e3f (`RELEASE.json`).

Prod facts, read-only, 2026-11-05:

| Fact | Value |
|---|---|
| Run window | 2026-11-04 07:30:08 to 07:31:32 UTC, on schedule |
| Template rows | 250 `failed`, 131042 |
| QR image rows | 250 `failed`, 131047 |
| Delivered | 0 |
| Audience | tag `tier1_batch1`, 250 members; other batches 250 / 250 / 165 |
| Counters | chargeable 0, non-chargeable 0 (retraction worked) |
| Coupons | 250 `promo`, `active`, unredeemed, expiring 2027-01-03 |
| Meta detail (all 250) | "Message failed to send because your WhatsApp Business account payment has been restricted. Visit <billing hub> to resolve this issue." |
| Template history on this number | Kapso: 0 `delivered`, 0 `read` |
| Number health | CONNECTED, GREEN, `TIER_250`; `messaging_health` LIMITED; BUSINESS entity LIMITED, no reason given; WABA AVAILABLE |

The welcome campaign's count of 7 is unrelated: those are customer-initiated service messages (Kapso shows `free_customer_service` image deliveries on this number), which do not need a working billing account.

## Root Cause Analysis

1. **The Meta block is the cause of the failure.** Meta rejected every marketing template because the WABA's payment is restricted. WABA `2524443331364599`, portfolio `3173944262794452`. The restriction's specific cause is only visible in the billing hub. OhMyClient cannot clear it.
2. **Defect 1: one error code, one hardcoded cause.** `src/domain/services/campaign-delivery-failure-reason.ts:16-20` maps all 131042 to "no billing currency configured", written from Kushiro's case. Prod has three distinct Meta details under 131042: currency not configured, payment method errors, payment restricted. `reconcile-campaign-send-failure.ts` passes only code and title, though `error_details` is on the row.
3. **Defect 2: the remedy does not exist in the UI.** The text says "re-run the campaign". `campaign-card-view.tsx` sets `canEdit` to draft/active/paused and `canSendNow` to active only, so a failed card has no action, matching the screenshot. `execute/route.ts` returns 400 unless `active`. Revival exists only through a direct PATCH `status`, and a past `scheduled_at` then fires on the next cron tick.
4. **Defect 3: the QR step cannot reach dormant customers.** `nov_promo_2026` has an IMAGE header, no buttons and no body variable, so `isClaimTemplate` is false and it runs in eager mode (`execute-campaign-broadcast.ts:92-113`): template, then a free-form QR image. Free-form needs an open customer service window, which is opened by the customer writing in. The body says 「出示以下優惠QR碼」 and the code exists only in that image.
   - The August journal attributed 131047 to "the template never landed". That explanation is unproven; Meta's text ("since the customer last replied") points to customer replies, not template delivery.
5. **Defect 3 would be silent.** `sendCouponQr` swallows send errors, `recordSent` still counts the member, and `reconcileCampaignSendFailure` ignores non-body rows ("The coupon-QR image is never counted"). Expected result after a billing fix: campaign `completed`, 250 charged sends, customers holding a free-food offer with no redeemable code.

## Hypothesis Experiments (each: hypothesis, minimal change tested, result, reverted)

No code prototypes run; each was tested against prod data, read-only.

- **Audience silently capped at 250 by a limit.** Rejected: the tag has exactly 250 members; the tenant batched to fit `TIER_250`.
- **Currency genuinely missing.** Rejected: Meta's detail on all 250 rows says payment restricted.
- **OhMyClient guardrails or template caused it.** Rejected: the template is approved, the sends left, Meta rejected asynchronously.
- **Failed sends block a retry through the per-user cap.** Rejected: `COUNTED_STATUSES` is sent/delivered/read. The daily limit counts by `created_at`, so batch1 (created 11-02) does not use today's slot.

## Blast Radius

- **Wrong wording:** campaigns stored with this reason are Bicho and 長盈行 "Mid autumn 2026_test". 長盈行 has both currency (2 rows) and payment-method (1 row) details on 2026-09-11. Kushiro's August case predates tracked rows.
- **Eager QR (defect 3):** every coupon campaign on a template with no quick-reply button sent to customers outside a 24-hour window. Prod's only template+image pairs on record are these 250. Bicho's remaining batches (665 members) would hit it if run the same way.
- **Tracked inbound rows:** 0 platform-wide, so window state cannot be computed from `whatsapp_messages` today.
- **Billing:** no phantom charge; counters are 0.
- **Coupons:** 250 active, but no customer received a code (all images failed). Same-campaign re-run reuses them.

## Recommended Fix (code snippet + rationale — for the fix owner to implement)

**Fix A (defects 1 and 2 wording).** Pass Meta's detail through and branch on it, never asserting a cause Meta did not state:

```ts
export function deliveryFailureReason(
  errorCode: string | null,
  errorTitle: string | null,
  errorDetails: string | null
): string
// 131042: match details → /restricted/ | /currency/ | /payment method/
// fallback: "payment issue on the WhatsApp Business account (Meta error 131042)"
```

Keep the result within `FAILURE_REASON_MAX_LEN` (500), naming Meta and disclaiming OhMyClient (WAQ-014). Say "Meta Business Manager → Billing & payments" without a currency claim.

**Fix B (defect 2).** Add a re-run action on failed cards, and only name "re-run" in the text once it exists. It must pass the same gates as `/execute`.

**Fix C (defect 3).** Two parts:
- At campaign create and send: warn or block for an eager template whose code is only in the QR, pointing at the claim (quick-reply) template flow from CAMP-001.
- Surface QR failure on the campaign: a member whose QR image failed did not get the offer, so it must not read as a clean success.

**Bicho now (no code).** Tenant clears the restriction in the billing hub, then uses a template with a quick-reply claim button. Do not re-run `nov_promo_2026` as is.

## Verification Plan (failing test first, then the checks that prove the fix and its siblings)

1. Failing unit tests in `campaign-delivery-failure-reason.test.ts`: each of the three real details gives its own wording; a restricted detail never contains "currency".
2. Fixture copied from a real Bicho `raw_status_payload`, with the phone replaced, beside `kapso-v2-failed-131042.json`.
3. Card test: failed status shows the re-run action; route test: revival passes every gate.
4. Eager test: failed QR image is visible on the campaign and not reported as clean.
5. Live: after Bicho's billing clears, send one claim-template message to an internal test number, then confirm delivered, tap, QR delivered. Only then release the batch.

## Risk & Side Effects

- Same-campaign re-run on eager mode reuses the 250 coupons and resends both messages, which is why it stays held until Fix C or a new template.
- A new claim template needs Meta approval and OhMyClient review before sending.
- Re-sending a promotion after a delay may need its 60-day wording rechecked by the tenant. Coupon expiry is already fixed at 2027-01-03 for this run.

## References

- `src/domain/services/campaign-delivery-failure-reason.ts`, `src/application/reconcile-campaign-send-failure.ts`, `src/application/execute-campaign-broadcast.ts`, `src/application/execute-campaign-send.ts`, `src/components/dashboard/campaign-card-view.tsx`, `src/app/api/dashboard/campaigns/[id]/execute/route.ts` (origin/main 53e6e3f)
- `debugging_journals/2026-08-27-outbound-status-webhooks-dropped.md`, `debugging_journals/2026-07-03-campaign-broadcast-qr-instead-of-claim.md`
- Window rule, third-party: https://chakrahq.com/help/chat/faqs/whatsapp-api-error-code-troubleshooting/whatsapp-api-message-delivery-errors
- 131042 causes, third-party: https://help.wanotifier.com/en/article/fix-error-131042-business-eligibility-payment-issue-fnff3r/
