# 2026-08-27 — Outbound status webhooks dropped; all-failed campaigns read "completed / 2 sent" (#131) + claim mode unreachable (#132)

## Problem

Every campaign message for 釧 Kushiro (tenant `96676002-…`) since 2026-08-26 was rejected
asynchronously by Meta — `131042 Business eligibility payment issue` (WABA currency not
configured; tenant-side) and, for the follow-up coupon QR images, `131047` (no open 24-hour
service window because the template never landed). The app recorded both runs
(`b4ed3737`, `7bed8f1b`) as `completed` with `chargeable_sent_count = 2`, `failure_reason = null`,
two minted coupons each, two `campaign` events each. Four chargeable sends were billed for
messages nobody received, and the dashboard showed a healthy campaign.

Re-running a failed campaign was also broken: the second run's coupon mint hit the
migration-053 unique index (`(campaign_id, member_id) WHERE type='promo'`), `mintEagerCoupon`
returned `false`, and the pipeline skipped the QR, the counter and the event — while the
template body had already gone out carrying a *new* code that matched no coupon.

Separately (#132): claim-mode campaigns (CAMP-001) were dead code in production because the
dashboard template form could not author a `QUICK_REPLY` button, and `isClaimTemplate` is the
only mode selector.

## Root cause

Three independent gaps lined up:

1. **Classifier blind to Kapso payload v2.** `classifyWebhookKind`
   (`src/infrastructure/whatsapp/webhooks.ts`) recognised status events only in the legacy flat
   shapes (`message_status` / `event: 'message_status'`) or the Meta envelope (`entry[].changes[]
   .value.statuses[]`). Kapso v2 — the default for every webhook created since the v2 rollout,
   and what `app.ohmyclient.io/api/webhooks/whatsapp` is subscribed with (`payload_version: v2`)
   — delivers `whatsapp.message.{sent,delivered,read,failed}` as
   `{ message: { id, …, kapso: { direction: 'outbound', status, statuses: [...] } }, phone_number_id }`.
   `hasKapsoFlatMessage` matches any object with a `message` key, so the event was routed as
   `inbound`; `parseKapsoFormat` then returned `null` (no `from`) and the route logged
   `webhook.ignored / parse returned null`. Six such POSTs on 2026-08-27 13:58–13:59 UTC.
   `whatsapp.message.failed` was subscribed but functionally unhandled.

2. **No campaign-side reaction to an async failure, and no rows to react to.**
   `sendTemplateMessage` treats the synchronous Cloud API ack as success, so
   `sendInBatches` tallied `sent: 2, failed: 0` and `finalizeCampaignRun` (#127) wrote
   `completed`. The WAQ-002 status handler needs a `whatsapp_messages` row per wamid, but
   `recordOutboundSend` only wrote rows when `WAQ_TRACK_MESSAGES === '1'` — the April WAQ
   vertical-slice plan said "OFF for the first prod deploy, then flip ON"; it was never flipped,
   so the table was empty in prod. Nothing ever decremented `chargeable_sent_count` (the billing
   source of truth) or moved a `completed` campaign to `failed`.

3. **Re-execution assumed a coupon collision meant "already fully served".**
   `sendEagerToMember` minted *after* sending the body and treated 23505 as "skip everything".

## Fix

(PR to `develop`, then `develop → main`, released via `scripts/release.sh`; see the plan
`.claude-workspace/plans/2026-08-27-camp-008-outbound-status-and-claim-button.md` and the
per-stream handoff artifacts under `.claude-workspace/artifacts/2026-08-27-camp-008-*`.)

- **Stream A** — `classifyWebhookKind` recognises v2 outbound status payloads
  (`message.kapso.direction === 'outbound'` with `statuses[]` or `kapso.status`) *before* the
  inbound test; `normalizeStatusPayload` emits the single current status entry (last entry whose
  `status` equals `kapso.status`). Fixtures recorded verbatim from Kapso's docs and from the
  real 131042 rejection shape (`src/infrastructure/whatsapp/__tests__/fixtures/kapso-v2-*.json`).
- **Stream B** — message tracking is now opt-**out** (`WAQ_TRACK_MESSAGES=0` disables;
  `isMessageTrackingEnabled()`); migration 064 adds `retract_campaign_sent(...)`, a single
  `UPDATE … RETURNING` that decrements the matching sent bucket and flips a `completed`
  campaign whose buckets are now both 0 to `failed` with a tenant-visible reason;
  `handleStatusUpdate` calls `reconcileCampaignSendFailure` when a campaign *body* row
  (template/text — never the QR image) transitions to `failed` with an error code;
  `finalizeCampaignRun` completes via CAS (`status='sending' AND a sent bucket > 0`) and
  otherwise marks `failed`, so a webhook that beats the finaliser cannot be overwritten.
  Failure reasons name Meta as the deciding system and disclaim OhMyClient review (WAQ-014).
  `131042` is classified `log_only` so a 200-recipient rejection is not 200 Slack posts.
- **Stream C** — per-chunk ledger: members with a counted (non-failed) body row for the
  campaign are skipped (`skipped_already_sent`); eager mode reuses an existing `(campaign,
  member)` coupon's code in the body and skips the mint; redeemed/inactive/expired coupons
  skip the member. Fixes the CAMP-002 double-send/double-count for re-runs.
- **Stream D (#132, own PR)** — `QUICK_REPLY` option in the template form; unknown stored
  button types round-trip as a read-only `UNSUPPORTED` variant instead of being rewritten.

## Prevention

- Fixture-based classifier tests now cover every Kapso v2 message event; any future payload
  version change fails a test instead of silently downgrading to `inbound`.
- "Ignored" webhooks are the signal: `webhook.ignored / parse returned null` on a
  `kind: inbound` classification for an **outbound** conversation is exactly this bug class —
  grep prod logs for it after any Kapso SDK/API change.
- A feature that only works when an env var is set is not shipped. Defaults must be the
  production behaviour; opt-out flags only (memory: documented env var ≠ scheduled job).
- Sent counters are provisional until Meta confirms: every path that increments a billing
  counter must have a matching retraction driven by the async status. Follow-up (kanban):
  exact-once retraction via `counter_applied_at` / `counter_retracted_at` stamps on
  `whatsapp_messages`.
- Billing corrections for the two already-billed Kushiro campaigns are a recorded runbook step
  in the release notes, not a code path.
