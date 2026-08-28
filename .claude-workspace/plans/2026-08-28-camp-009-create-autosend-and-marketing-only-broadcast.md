---
title: "CAMP-009 / #136 + #134: create-path auto-send removed; marketing-only campaigns stop minting coupons + QR"
date: 2026-08-28
author: claude (main thread — acting architect; autonomous /goal run, no user approval gate available)
status: active
related: [kanban:CAMP-009, kanban:CAMP-008, kanban:CAMP-004, github:136, github:134, github:102, github:131]
supersedes: []
---

# Problems (verified against `origin/develop@85419d5`, not just the issue text)

## #136 — creating a campaign broadcasts it immediately (P1)
`src/components/dashboard/campaign-form-dialog.tsx:75-77`

```ts
if (!campaignId && form.execution === 'now' && json.id) {
  await fetch(`/api/dashboard/campaigns/${json.id}/execute`, { method: 'POST' })
}
```

- `initialCampaignForm.execution === 'now'` (`campaign-form-types.ts:38`) and the submit button is
  labelled *Create*, so the default click sends the whole audience with no confirmation.
- The `/execute` response is never checked — a 400/403/409 (not-active / guardrail / template gate)
  is dropped, the dialog closes and `onSuccess()` fires. This is the duplicate of the call site #102
  Part A fixed in `campaign-card.tsx:30-46` (`readExecuteError`).
- Everything for the intended UX already exists: `campaign-card-view.tsx:56` shows **Send Now**
  whenever `status === 'active' && type !== 'welcome'`; `campaign-card.tsx` executes with proper error
  handling; `getDueCampaigns` (`campaign-repository.ts:302-309`) requires `scheduled_at IS NOT NULL`,
  so a "now" campaign left `active` with null `scheduled_at` is NOT picked up by the cron.

## #134 — marketing-only campaigns still mint a coupon and push a doomed QR (P2)
`src/application/execute-campaign-broadcast.ts:76-107 sendEagerToMember`

- Never branches on `ctx.campaign.couponConfig` (typed `CouponConfig | null`). With `null` it still
  `generateCouponCode()`, mints a `promo` coupon with null discount/expiry
  (`execute-campaign-coupon.ts:20-38` tolerates the null config), then `sendCouponQr` — a free-form
  image outside the 24 h service window → Meta `131047`, swallowed at `execute-campaign-send.ts:83`.
- `incrementCampaignSent` sits after the mint, so a mint short-circuit under-counts real sends.
- **Drift since the issue was filed:** #131 added the `existing` (re-run) coupon parameter and
  `loadRerunPrefetch`. The marketing-only branch must sit *before* that logic and ignore any leftover
  coupon (Kushiro's `MAKL6B` / `YQZJ8P` were minted by the pre-fix run — a re-run must still send the
  announcement and never skip or QR on their account).

# Design

## Stream A — frontend (#136) → `react-frontend-dev`
1. `campaign-form-dialog.tsx`: delete the three-line auto-execute block; `submitCampaign` returns the
   JSON. Export `submitCampaign` so it is unit-testable (module-private today). No other logic change.
2. Label rename (issue recommendation — with the auto-execute gone, `'now'` means "no schedule; I
   will send manually"): `src/messages/en.json` `campaigns.executionNow` → "Send manually",
   `zh-HK.json` → "手動發送". Keep the key and the `'now'` state value (touching the value would ripple
   through `campaignToFormState`, the radio, the types and tests for zero functional gain).
3. Tests — new `src/components/dashboard/__tests__/campaign-form-dialog.test.ts` (mock `global.fetch`):
   - AC1: create with `execution: 'now'` → exactly ONE fetch, `POST /api/dashboard/campaigns`; no
     request whose URL contains `/execute`.
   - AC2: create with `execution: 'schedule'` + `scheduledAt` → one POST, body `scheduledAt` set, no
     `/execute`.
   - AC3: edit (`campaignId` given) → one `PATCH /api/dashboard/campaigns/<id>`, no `/execute`.
   - AC4: non-ok create response → throws with the server's `error` message; no further fetch.
   - AC5: `initialCampaignForm.execution === 'now'` still builds `scheduledAt: null`, `status: 'active'`
     (documents the post-fix contract: created idle, waits for Send Now).

## Stream B — backend (#134) → `senior-backend-dev`
1. `execute-campaign-broadcast.ts` `sendToMember`:
   ```ts
   if (isClaimTemplate(ctx.template)) return sendClaimToMember(member, ctx)
   if (!ctx.campaign.couponConfig) return sendMarketingOnlyToMember(member, ctx)
   return sendEagerToMember(member, ctx, prefetch.existingCoupons.get(member.id))
   ```
   `sendMarketingOnlyToMember`: `sendCampaignBody(member, ctx, '', buildCouponDescription(member, ctx, ''))`
   → `throwIfNotOk(result, 'campaign')` → `incrementCampaignSent` → `emitEvent` with
   `dataJson: { campaignId }` (no `couponCode`, same shape as the claim path) → `'sent'`.
   `buildCouponDescription` with `''` renders the inline template (the actual text body for inline
   campaigns) and falls back to the campaign name — no new helper.
2. Update the file header comment to name the third mode. Claim precedence unchanged.
3. Tests — extend `src/application/__tests__/execute-campaign-broadcast.test.ts` with a
   `describe('sendToMember — marketing-only (couponConfig null) #134')`:
   - AC1: body sent once with code `''`; `generateCouponCode`, `createCampaignBroadcastCoupon`,
     `sendCouponQr` NOT called; `incrementCampaignSent('camp-1', true)`; `emitEvent` dataJson equals
     `{ campaignId: 'camp-1' }` (no `couponCode` key).
   - AC2: body send fails → rejects; no increment / emit / mint / QR.
   - AC3: claim template + null couponConfig → claim path (sendClaimBody once, sendCampaignBody not called).
   - AC4: prefetch carries an existing ACTIVE coupon for the member → still marketing-only: body sent,
     no QR, no mint, counted once (leftover pre-fix coupon is ignored, not reused).
   - AC5: prefetch carries an existing REDEEMED coupon → still `'sent'` (no `skipped_already_sent`;
     re-run idempotency for coupon-less campaigns comes from `countedMemberIds`, exercised in
     `execute-campaign-batch` tests already).
   - Regression: existing eager suite (couponConfig set) unchanged and green.

Out of scope (state in the PR, do not implement): explicit `sends_coupon` flag (CAMP-004 territory);
skipping the coupon prefetch query for coupon-less campaigns (harmless extra read); the
`executionNow` state value rename.

# Integration map
- Create flow: dialog → `POST /api/dashboard/campaigns` → card renders Send Now (existing) → operator
  clicks → `POST …/execute` with error surfacing (existing). Nothing new to wire.
- Broadcast: `execute-campaign-batch.ts:124 sendToMember` is the single caller; `onboard-new-member`
  untouched.

# Acceptance (QA verdict basis)
- `npm run test` green (known flaky: `route.quality-event.integration.test.ts` #92 — re-run in isolation).
- `npm run lint` + `tsc --noEmit` clean.
- All ACs above have a named test.

# Risk to flag in the release note
Campaigns whose `coupon_config` is null but were *meant* to hand out a coupon (prod row "Free Drink
Promotion" is ambiguous) stop minting after this ships. The form cannot express a zero-discount coupon
(`discountValue > 0` gates `couponConfig`), so that intent was never representable; an explicit flag is
the CAMP-004 follow-up.
