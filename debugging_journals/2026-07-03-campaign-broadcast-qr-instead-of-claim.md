# 2026-07-03 — Campaign broadcast sends QR eagerly; no claim-button flow

## Problem

User report: broadcasting a campaign delivers "only the QR code image with a description" to customers. Expected (per reporter): a template message with a *claim* button, with the coupon/QR generated only when the customer taps claim.

## Root Cause

**Feature gap, not a regression.** The claim-button + lazy-coupon flow was never designed or implemented. Since the original feature commit (`76a00fc`, 2026-04-01) the broadcast pipeline unconditionally, per recipient:

1. Mints a coupon row (`src/application/execute-campaign-broadcast.ts:31-33`)
2. Sends the body — WhatsApp template or inline text (`:34`)
3. Sends the QR image encoding `REDEEM <code>` (`:35`)

No CLAIM webhook route exists (`route-resolver.ts`, `command-keywords.ts`); interactive buttons are only used for opt-in YES/NO and help. Docs/PRDs contain no claim-button design.

Contributing mechanism for the literal "only QR arrived" symptom: body-send failures are swallowed (`execute-campaign-send.ts:24-37` discards `SendResult`; `record-outbound-send.ts:59-71` catches throws; `kapso/client.ts` returns `errorResult`), so the QR still goes out when the template send is rejected.

## Solution Implemented

CAMP-001, PR #50 → develop (squash `b40efaa`). Plan: `.claude-workspace/plans/2026-07-03-camp-001-claim-button-flow.md`.

Broadcast `sendToMember` now branches on template shape (`isClaimTemplate` = the resolved template has a `QUICK_REPLY` button):

- **Claim mode**: send ONLY the template, injecting a dynamic quick-reply payload `CLAIM_<campaignId>` at the QUICK_REPLY button index (`send-template-message.ts` `buildQuickReplyButtonParams`; SDK `buildTemplateSendPayload` supports `subType:'quick_reply'`). No coupon, no QR until the tap.
- **Eager mode** (inline text / URL-button, no quick-reply): preserved, but reordered — body sent FIRST, coupon/QR/increment/emit only on send success; tolerates a duplicate-coupon 23505 on retry.

Both modes: a failed send throws → `Promise.allSettled` tallies it `failed`, `recordOutboundSend` persists a failed row, and `incrementCampaignSent`/`emitEvent` never run (fixes the swallow).

Inbound: `webhook-parser` handles Meta `messages[0].type:'button'`, surfacing `button.payload` as `message.text`; `route-resolver` adds the `CLAIM_` route (raw campaignId, case preserved); `handleClaim` re-checks tenant (`campaign.restaurantId === restaurantId`) + membership + **audience targeting** (selected campaigns → `getCampaignMemberIds`) + status, then mints idempotently (app pre-check + 23505 catch + migration `053` partial unique index on `coupons(campaign_id, member_id) WHERE type='promo'`) and sends the QR — falling back to texting the code if the image send fails.

Gates: `tsc --noEmit` 0, `next build` green, new unit coverage per acceptance criterion. Independent `/review` (code-review-analyzer + security-architect + qa-engineer + adversarial): the audience-targeting leak (a forwarded `CLAIM_` payload minting for non-targeted members) was found and fixed here.

## Prevention Measures / Next Steps

- **Lazy-generation flows need authorization parity with the eager path.** The eager broadcast was implicitly audience-scoped; the first lazy-claim cut re-checked tenant + membership but not *targeting*, re-opening the discount to any member. When moving a side effect from a push (broadcast) to a pull (claim), re-derive every access-control invariant the push had.
- **A DB unique index has blast radius beyond its author's feature.** `053` also constrains welcome-flow promo coupons; the deploy-gate query + comment now say so. Any new partial unique index: enumerate every code path that inserts a matching row.
- Follow-ups filed: CAMP-002 (broadcast retry idempotency / double-count), CAMP-003 (button-payload↔keyword collision), CAMP-004 (explicit claim-campaign flag), CAMP-005 (claim window + template param validation), CAMP-006 (welcome-coupon 23505 robustness).
- Unrelated: full `vitest run` has pre-existing flaky WAQ webhook-route integration tests (shared in-memory store, pass in isolation) — surfaced by adding a test file; tracked under CI-001.
