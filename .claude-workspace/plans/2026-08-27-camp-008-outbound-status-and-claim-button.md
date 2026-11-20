---
title: "CAMP-008 / #131 + #132: outbound status webhooks dropped, all-failed runs read completed, claim mode unreachable"
date: 2026-08-27
author: claude (main thread — acting architect; autonomous /goal run, no user approval gate available)
status: active
related: [kanban:CAMP-008, kanban:CAMP-004, kanban:CAMP-002, github:131, github:132, github:127]
supersedes: []
---

# Problem (verified against code + Kapso docs, not just the issue text)

1. **Kapso v2 status webhooks are classified `inbound` and dropped.** Kapso v2 delivers
   `whatsapp.message.{sent,delivered,read,failed}` as
   `{ message: { id, timestamp, type, to, kapso: { direction: 'outbound', status, statuses: [...] } }, conversation, phone_number_id }`
   (docs.kapso.ai/docs/platform/webhooks/message-events — verbatim examples captured in
   `src/infrastructure/whatsapp/__tests__/fixtures/kapso-v2-*.json`, see Stream A).
   `classifyWebhookKind` (`src/infrastructure/whatsapp/webhooks.ts`) only knows the flat
   `message_status` / `event === 'message_status'` shapes, so `hasKapsoFlatMessage` (any object
   with a `message` key) wins → inbound → `parseKapsoFormat` returns null (no `from`) → ignored.
2. **Even with (1) fixed, nothing reaches the campaign.** `handleStatusUpdate` looks the wamid
   up in `whatsapp_messages`; rows exist only when `WAQ_TRACK_MESSAGES === '1'`, which prod never
   set (table empty per #131). And no code path ever retracts `chargeable_sent_count` or flips a
   `completed` campaign to `failed` on an async Meta rejection — `finalizeCampaignRun` (#127)
   only sees the synchronous tally.
3. **Re-running a failed campaign is broken** (`sendEagerToMember`): the 053 unique index makes the
   re-mint raise 23505 → `mintEagerCoupon` returns false → QR, counter and event are skipped, and
   the body was sent with a *new* code that matches no coupon.
4. **#132**: the dashboard template form cannot author a `QUICK_REPLY` button, so
   `isClaimTemplate` is never true and claim mode is dead code. The round-trip cast in
   `parseButtons` also silently rewrites unknown button types on save.

# Decisions (autonomous — flagged for the user in the report)

| # | Decision | Why | Rejected |
|---|----------|-----|----------|
| D1 | Classify v2 by `message.kapso.direction === 'outbound'` + (`statuses[]` non-empty or `kapso.status` string), checked **before** the inbound test. Normalize to ONE status entry: the `statuses[]` entry whose `status === message.kapso.status` (last match), else the last entry, else synthesised from `message.id/kapso.status/timestamp/to`. | The statuses array is full history; replaying all would re-claim `${id}:sent` on every later webhook (WAQ-OPS-001 row growth) for no gain — the lattice already ignores regressions. | Header-based routing (`X-Webhook-Event`): classifier is a pure body discriminator with 30+ tests; keep it pure, header can be added later. |
| D2 | **Message tracking becomes opt-OUT**: `isMessageTrackingEnabled()` = `process.env.WAQ_TRACK_MESSAGES !== '0'` (new `src/application/message-tracking-flag.ts`, used by execute-campaign + claim-handler). | The fix is structurally impossible without `whatsapp_messages` rows, and "flip the env var on Forge later" is the exact failure class this repo has already paid for twice (memory: documented env var ≠ scheduled job; the WAQ slice doc said "flip ON in prod after first deploy" in April — never happened). Cooldown counts only sent/delivered/read, so tracking failed sends does not burn the per-user cap. | Forge env change only: invisible, unverifiable in tests, forgettable. |
| D3 | On a `failed` status for a campaign **body** message (`campaign_id` set, `message_type` in `template|text` — the QR `image` is never counted), call RPC `retract_campaign_sent(p_campaign_id, p_chargeable)` (`GREATEST(0, n-1)`, migration 064) and, if the campaign is `completed` and both sent counters are now 0, mark it `failed` with a tenant-visible reason derived from the Meta error code. `finalizeCampaignRun` additionally re-reads the campaign after the run: if the batch tallied sends but the DB counters are already 0 (webhooks beat the finaliser), it marks `failed` the same way. Once-only is guaranteed by the `${id}:failed` idempotency claim + the status lattice (`read` never regresses to `failed`). | `chargeable_sent_count` is the billing source of truth (#131: "4 phantom chargeable sends billed"). Meta does not bill failed messages. | Deferred cron reconciliation (ANALYTICS-001): needs a 4th Forge scheduled job, same forgettable-ops class. Decrement is at-webhook-time and idempotent. |
| D4 | Failure-reason wording lives in `src/domain/services/campaign-delivery-failure-reason.ts`: 131042 → names Meta Business Manager billing currency; 131047 → 24h window; default → "WhatsApp (Meta) reported every message as failed after sending (error <code>)". Every variant states it is **not** an OhMyClient review/template decision (WAQ-014 principle: name the deciding system). | Item 3 of #131. | Stopping a run mid-batch on 131042: the worker has no channel to hear the webhook; YAGNI. |
| D5 | Re-execution (CAMP-002 minimum): (a) per-chunk bulk ledger `findMemberIdsWithCountedSend(campaignId, memberIds)` = rows with `message_type in (template,text)` and `status <> 'failed'` (queued/unknown counts as sent — never double-send); members in it → new outcome `skipped_already_sent` (counter `alreadySent`, logged). (b) Eager mode looks up the existing `(campaign, member)` promo coupon **before** sending and reuses its code; mint is skipped when it exists; a 23505 on a fresh mint is treated the same way. QR + counter + event then run normally. | Lets a tenant re-run a failed campaign after fixing the Meta-side cause without manual coupon deletion, without double-sending/double-counting members whose first send landed. | Deleting orphan coupons on re-run: destroys audit trail; a claimed/redeemed coupon may exist. |
| D6 | #132 minimum fix: `QUICK_REPLY` added to the form union + `<option>` (label only, no url/phone field); `parseButtons` maps unknown stored types (`COPY_CODE`, anything else) to a typed `UNSUPPORTED` variant that the form renders read-only and `buildWaTemplateRequestBody` passes through unchanged. | Unblocks claim mode today; CAMP-004 (explicit flag) stays open as the proper fix. | Full CAMP-004 schema + builder UI: not a hotfix. |

# Streams (one dispatch per work item)

## Stream A — Kapso v2 status classification (senior-backend-dev)
Files: `src/infrastructure/whatsapp/webhooks.ts` (+ split helpers into
`webhooks-kapso-v2.ts` if the file passes 150 lines), `src/infrastructure/whatsapp/__tests__/webhooks.test.ts`,
new fixtures `src/infrastructure/whatsapp/__tests__/fixtures/kapso-v2-{sent,delivered,failed,received}.json`
(verbatim from Kapso docs; failed fixture must carry a 131047 error AND a second fixture with
131042 "Business eligibility payment issue").
Tests (must fail first):
- v2 failed/sent/delivered payloads → `'status'`; v2 received (direction inbound, has `from`) → `'inbound'`.
- `normalizeStatusPayload(v2 failed)` → exactly ONE entry, `status: 'failed'`, `id: message.id`, `errors[0].code === 131047`, `recipientId` from `recipient_id`.
- v2 delivered (history [sent, delivered], `kapso.status: 'delivered'`) → one entry with status delivered.
- statuses[] missing but `kapso.status` present → synthesised entry from `message.id` / `timestamp` / `to`.
- inbound v2 with a `kapso.direction: 'inbound'` and no statuses → `[]`.
- Existing 30+ tests unchanged.
Boundary: do NOT touch route.ts / status-handlers.ts / parser.

## Stream B — Async failure → campaign (senior-backend-dev)
Files: `supabase/migrations/064_retract_campaign_sent.sql` (two `CREATE OR REPLACE FUNCTION`
`retract_chargeable_sent` / `retract_non_chargeable_sent`, mirroring 027's increment RPCs, `GREATEST(0, …)`),
`src/infrastructure/supabase/repositories/campaign-counters.ts` (+ `retractCampaignSent(id, isChargeable)`),
`src/infrastructure/supabase/repositories/whatsapp-message-repository.ts` or a new
`whatsapp-message-campaign-queries.ts` (`findLatestCampaignFailure(campaignId) → {errorCode, errorTitle} | null`),
new `src/application/message-tracking-flag.ts`, `src/application/reconcile-campaign-send-failure.ts`,
new `src/domain/services/campaign-delivery-failure-reason.ts`,
`src/app/api/webhooks/whatsapp/status-handlers.ts` (call reconcile after `dispatchErrorAction`, errors isolated — never block the webhook),
`src/application/execute-campaign.ts` (flag helper + finalize re-read), `src/app/api/webhooks/whatsapp/claim-handler.ts` (flag helper),
`.env.example` + `deploy/README.md` row for the flag (opt-out wording), and the affected tests
(`execute-campaign.test.ts` env assumptions, `status-handlers.test.ts`, `route.status-event.integration.test.ts`).
Tests (must fail first):
- `isMessageTrackingEnabled()`: unset → true, `'1'` → true, `'0'` → false.
- reconcile: campaign body message failed → retract called with the campaign's `isChargeable`; image message → no-op; no campaignId → no-op; campaign `completed` + counters now 0 → `updateCampaign(id, {status:'failed', failureReason})`; campaign `completed` + counters > 0 → status untouched; campaign `sending` → retract only.
- failure-reason service: 131042 / 131047 / unknown wording; each names Meta and disclaims OhMyClient review.
- status-handlers: reconcile failure (throws) is logged and does not propagate; non-failed statuses never call it.
- finalize: tally sent>0 but re-read counters 0 → `failed` with reason from `findLatestCampaignFailure`; counters > 0 → `completed` (existing tests keep passing).
Boundary: do NOT touch webhooks.ts (Stream A) or execute-campaign-broadcast/batch (Stream C).

## Stream C — Re-execution idempotency (senior-backend-dev, dispatched AFTER B lands)
Files: `src/application/execute-campaign-broadcast.ts`, `src/application/execute-campaign-batch.ts`,
`src/application/execute-campaign-batch-counters.ts`, new
`src/infrastructure/supabase/repositories/whatsapp-message-ledger-queries.ts`
(`findMemberIdsWithCountedSend({campaignId, memberIds}) → Set<string>` — single `IN` query, covered by `idx_wa_messages_campaign_status`),
tests in `execute-campaign-broadcast.test.ts`, `execute-campaign-batch-counters.test.ts`, `execute-campaign.test.ts`.
Tests (must fail first):
- eager re-run with existing coupon: body sent with the EXISTING code, no mint, QR sent, counter incremented, event emitted.
- eager first run: mint happens with the generated code (unchanged behaviour).
- 23505 race on a fresh mint → continues as "existing" (QR + counter + event), no throw.
- member with a counted (non-failed) prior body row → `skipped_already_sent`, nothing sent, counter `alreadySent` +1; member whose prior row is `failed` → sent normally; tracking off → ledger not consulted.
- claim mode: same ledger skip applies (fixes CAMP-002 double-count).
Boundary: do NOT touch status-handlers / webhooks.ts.

## Stream D — #132 QUICK_REPLY authoring (react-frontend-dev)
Files: `src/components/dashboard/wa-template-form-types.ts`, `wa-template-buttons-section.tsx`,
`__tests__/wa-template-form-types.test.ts`, `__tests__/wa-template-form-fields.test.tsx` (if it renders buttons).
Tests (must fail first):
- `buildWaTemplateRequestBody` with a QUICK_REPLY button emits `{ type: 'QUICK_REPLY', text }` and no `url`/`phoneNumber` keys.
- `applyTemplateButtonChange(type → QUICK_REPLY)` clears url + phone.
- `validateWaTemplateButtons`: QUICK_REPLY needs a label only.
- `templateToFormState` round-trips QUICK_REPLY; `COPY_CODE`/unknown → `UNSUPPORTED` variant carrying the original raw button, and `buildWaTemplateRequestBody` re-emits it byte-for-byte.
- Buttons section renders a "Quick reply" option and no url/phone input for it; an UNSUPPORTED button shows a read-only notice.
Boundary: domain/validation/send/claim paths need no change (verified: `TemplateButtonType` already has QUICK_REPLY; `validateButtons` is type-gated; `prepareButtons` passes through; API route does not validate button types).

# Integration map
- Webhook POST → `classifyWebhookKind` (A) → `routeStatusEvent` → `handleStatusUpdate` (row exists because D2) → `dispatchErrorAction` → `reconcileCampaignSendFailure` (B) → counters retracted / campaign failed → dashboard card already renders `failure_reason` (`campaign-card-view.tsx` failed banner).
- Worker → `executeCampaign` → `sendInBatches` → ledger skip (C) → `sendToMember` → coupon reuse (C) → `finalizeCampaignRun` re-read (B).
- Dashboard template form → QUICK_REPLY (D) → stored components → `isClaimTemplate` true → claim path (already shipped, CAMP-001).

# Perf budget
- One extra bulk query per chunk (C) and one campaign read + one RPC per failed webhook (B). No per-member round-trips added.

# Out of scope (left open, say so in the PR)
- CAMP-004 explicit claim flag; ANALYTICS-001 delivery reporting UI; stopping a run mid-batch on 131042; a dashboard "revive" control for failed campaigns (#129); Meta-side currency fix (tenant).

# Amendment 1 — advisor review (2026-08-27, before Stream B/C dispatch)

Verdict: proceed with caveats. Changes folded into the stream briefs below; the D3/D5 text
above is superseded where it conflicts.

- **A1 (D3 race)** `finalizeCampaignRun` must not write `completed` unconditionally when the
  tally has sends. Use a CAS on the campaign row: `status='completed' WHERE id AND
  status='sending' AND (chargeable_sent_count > 0 OR non_chargeable_sent_count > 0)`; zero
  rows → `failed` with the reason from the latest failed body row (generic wording if none).
  All-skipped / nothing-attempted runs keep the unconditional `completed` path.
- **A2 (D3 atomicity)** the retract RPC decrements AND conditionally flips
  `completed → failed` (+ `failure_reason`) in ONE `UPDATE … RETURNING`, scoped by
  `(id, restaurant_id)`, reading `is_chargeable` off the row — no read-then-decide in JS.
- **A3 (once-only guard)** the idempotency key is on the RAW status string and
  `coerceStatus` maps unknown strings to `failed` with no error code. Retract iff
  pre-image status ≠ `failed` AND post-image status = `failed` AND `errorCode` present.
- **A4 (at-most-once)** a reconcile failure is logged at `error` with `campaignId`
  (greppable over-count), never propagated. Exact-once (`counter_applied_at` /
  `counter_retracted_at` stamps) → follow-up kanban item, not the hotfix.
- **A5 (Slack cannon)** 131042 is unknown to the error table → `engineering_alert` → one Slack
  post per failed message. Add `'131042'` → `log_only` / `error`; the tenant-visible reason now
  comes from D3.
- **A6 (D2 blast radius)** WAQ-007's per-user cap (default 1/24h) becomes live for every tenant
  once rows exist (counts only sent/delivered/read). Consent gate unchanged. Ops heads-up in the
  release notes.
- **A7 (D5 double-count)** increment on re-run only when the ledger shows no counted
  (non-failed) body row for the member; a member with a counted row is skipped
  (`skipped_already_sent`). Coupon lookup is bulk per chunk, not per member. Reused coupon
  that is redeemed / inactive / expired → skip the member. A 23505 on a fresh mint keeps
  today's behaviour (log + skip QR/count) — the body already carries a different code.
- **A8 (history)** nothing in code repairs the two Kushiro campaigns already billed
  (`7bed8f1b`, `b4ed3737`): release runbook gets a recorded-before/after SQL correction
  (`chargeable_sent_count=0, status='failed', failure_reason=<131042 wording>`).
- **A9** #132 (Stream D) ships as its own PR — it shares no files with the billing incident.

# Release
PR → develop (squash) → PR develop → main → `scripts/release.sh` from main (builds locally, pushes `release`, Forge deploys + migrates 064) → `curl /api/health` + watch `logs/webhook-*.log` for `webhook.kind: status` on the next Kushiro send.
