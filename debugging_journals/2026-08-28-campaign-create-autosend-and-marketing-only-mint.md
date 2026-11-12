# 2026-08-28 — Create auto-sends the campaign (#136); marketing-only campaigns mint a coupon + doomed QR (#134)

## Problem

**#136 (P1).** Clicking *Create* on the campaign form broadcast the campaign to the whole audience
immediately, with no confirmation and no undo. Two Kushiro campaigns were enqueued ~3 s after their
row was written — the create→execute round trip, not the cron. Worse, a blocked send (403 guardrail,
409 template gate) looked identical to a successful one: the dialog closed and the list refreshed.
Reported by the operator as "when i create the campaign it will send immediately after save".

**#134 (P2).** Kushiro's 5th-anniversary sends are marketing announcements with `coupon_config = null`.
The broadcast still minted a `promo` coupon per recipient (null discount, null expiry) and pushed a
free-form QR image that Meta rejected with `131047` (outside the 24 h service window). Because the
counter increment sat after the mint, a mint short-circuit also under-counted real sends.

## Root cause

- `campaign-form-dialog.tsx` `submitCampaign` fired `POST /api/dashboard/campaigns/<id>/execute`
  after a successful create whenever `form.execution === 'now'` — and `'now'` is the form default.
  The response was never checked. This was the second copy of the fire-and-forget `/execute` call
  that #102 Part A had already fixed on `CampaignCard.handleExecute`; the card was fixed, the
  dialog's duplicate was not.
- `execute-campaign-broadcast.ts` `sendEagerToMember` dispatched on template shape only (claim vs
  eager) and never consulted `campaign.couponConfig`. `createCampaignBroadcastCoupon` tolerates a
  null config by writing nulls instead of declining to mint, so nothing in the pipeline ever said
  "this campaign has no coupon".

## Solution (PR on `fix/camp-009-issues-136-134`, kanban CAMP-009)

- **#136:** deleted the auto-execute block. Creation leaves the campaign `active` with
  `scheduled_at = null`; `getDueCampaigns` requires a non-null `scheduled_at`, so the cron ignores
  it and the card's **Send Now** (already error-handled via `readExecuteError`) is the only trigger.
  The radio label became *Send manually* / *手動發送* (key and `'now'` state value unchanged).
  `submitCampaign` is exported and pinned by tests: one POST, never `/execute`.
- **#134:** third broadcast mode. `sendToMember` order is claim → **marketing-only**
  (`couponConfig === null`: send body with empty code → increment → emit `{ campaignId }`) → eager.
  The marketing-only path takes no re-run prefetch, so a leftover coupon from a pre-fix run can
  neither be reused nor trigger the redeemed-coupon skip. Re-run idempotency for coupon-less
  campaigns comes from the `countedMemberIds` ledger (tracking is opt-out since #131), exactly as
  for claim mode.
- **Review finding I-1 (analyzer):** a WhatsApp template that still *expects* a code — `{{code}}`
  body variable or a `{{1}}` dynamic URL button — with a null `couponConfig` would now send an
  empty parameter that Meta rejects per recipient. Prod check found the class real (`4ce3b1e4`
  "Free Drink Promotion", template `free_drink` with a `{{1}}` URL button — completed, not active).
  Added `enforceCouponParams(campaign, template)` next to `enforceHeaderMedia` in both the execute
  route (→ 409, rendered on the card) and the worker `execute-campaign.ts` (→ campaign fails with
  the reason, covering cron-scheduled runs).
- **`/code-review` on PR #140** widened that gate from a `{{code}}`/`{{1}}` allow-list to the real
  invariant — *no coupon config ⇒ nothing coupon-derived may be needed*: `{{discount}}` (the
  sender fills it from `formatDiscount(couponConfig)` → `''`), `COPY_CODE` buttons, inline copy
  referencing `{{code}}` / `{{couponCode}}` / `{{discount}}`, and claim-button templates (claim
  mode mints from `couponConfig` at tap time — the exemption would have re-opened the junk-coupon
  path lazily). The dynamic-URL predicate is shared with the sender (`isDynamicUrlButton`) so the
  gate and `buildUrlButtonParams` cannot drift.

## Prevention

- **Every `/execute` call site checks the response, and there is exactly one trigger.** A
  fire-and-forget execute is the bug #102 fixed; a second copy survived because the fix was applied
  to the symptom site, not searched for. When fixing a call-site bug, `grep` for every other call
  to the same endpoint before closing.
- **Irreversible, chargeable actions never ride on a button that says something else.** *Create*
  creates. A form default must not select the destructive branch.
- **A mode selected by data shape needs every shape enumerated.** Claim vs eager was inferred from
  the template; coupon vs no-coupon was never a mode at all, so `null` fell into the coupon path.
  When adding a nullable config, ask what each consumer does with `null` — "tolerates it" is not
  the same as "handles it". CAMP-004 (explicit campaign flags: claim, sends-coupon) remains the
  proper fix; `coupon_config IS NULL` is the signal until then.
- **Removing a value from a payload needs a preflight for the shapes that required it.** The
  marketing-only path stopped sending a code; the template gate now refuses the combination up
  front, in the deciding system's own words, instead of letting Meta reject every message.
