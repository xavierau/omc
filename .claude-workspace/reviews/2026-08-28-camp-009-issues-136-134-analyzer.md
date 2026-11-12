---
id: reviews/2026-08-28-camp-009-issues-136-134-analyzer
type: review
author: code-review-analyzer
created: 2026-08-28
status: active
supersedes: null
superseded_by: null
related: [kanban:CAMP-009, github:136, github:134, plans/2026-08-28-camp-009-create-autosend-and-marketing-only-broadcast, artifacts/2026-08-28-camp-009-stream-a-create-autosend-frontend, artifacts/2026-08-28-camp-009-stream-b-marketing-only-broadcast-backend]
---

# Code Review: CAMP-009 — #136 create-path auto-send removed, #134 marketing-only broadcast (second lane)

Scope: uncommitted working tree on `fix/camp-009-issues-136-134` over `origin/develop@85419d5`
(worktree `/Users/xavierau/Code/js/whatsapp-crm-camp-009-worktree`). Second-lane stand-in for the
Grok CLI (billing-down). `.claude/kanban.json` and `.claude-workspace/**` ignored per brief.

Files reviewed: `src/application/execute-campaign-broadcast.ts`, its test, `src/components/dashboard/campaign-form-dialog.tsx`,
new `src/components/dashboard/__tests__/campaign-form-dialog.test.ts`, `src/messages/{en,zh-HK}.json`; context files
`execute-campaign-batch.ts`, `execute-campaign-rerun-prefetch.ts`, `execute-campaign-send.ts`, `send-template-message.ts`,
`execute-campaign-coupon.ts`, `campaign-form-types.ts`, `wa-template-form-fields.tsx`, `campaign-card.tsx`,
`campaign-card-view.tsx`, `campaigns/page.tsx`, `campaign-repository.ts`, `campaigns/route.ts`, `[id]/execute/route.ts`,
`infrastructure/kapso/template-client.ts`, `event-feed-item.tsx`.

Verified myself (not taken from the handoffs): full `vitest run` → 367 files / 3743 tests passed, 21 skipped;
`tsc --noEmit` clean; eslint on the four changed TS files → only the pre-existing
`react-hooks/set-state-in-effect` at `campaign-form-dialog.tsx:100` (present on `origin/develop`).

## Summary

Both fixes do what the plan says and nothing else — every changed line traces to #136 or #134. The #136 deletion is
clean and the server side is genuinely idle after create (no enqueue anywhere on the POST path; cron ignores null
`scheduled_at`; the list re-fetches so Send Now appears). The #134 branch sits in the right place (after claim
precedence, before the re-run coupon lookup) and structurally cannot read a leftover coupon.

One behavioural regression class is not covered: a WhatsApp-template campaign whose template body uses `{{code}}`
(the variable the template form itself advertises) or whose URL button is dynamic (`{{1}}`), combined with a null
`couponConfig`, used to go out with a real (discount-less) code; it now goes out with an empty body parameter / no
button parameter, which Meta rejects. The send is loud (every recipient fails, run tallies failed) rather than the
old silent doomed-QR, but it is a working campaign turning into a 100%-failed one, and the plan's own "Free Drink
Promotion" row is exactly this ambiguous class. A preflight at `/execute` (same pattern as `enforceHeaderMedia`)
turns it into an actionable 409 the card already surfaces (#102). That plus the missing debugging journal makes this
CONDITIONAL, not blocked.

## 🔴 Critical (Must Fix)

None.

## 🟡 Important (Should Fix)

### I-1 — `{{code}}` / `{{1}}` templates with null `couponConfig` now send an empty parameter Meta rejects

- **Where**: `src/application/execute-campaign-broadcast.ts:75-76` (`sendCampaignBody(member, ctx, '', …)`) →
  `execute-campaign-send.ts:105-124` (`sendViaTemplate` passes `code: ''` as `paramValues.code` and `couponCode: ''`) →
  `send-template-message.ts:41-46` (`text: params.paramValues[name] ?? ''` — an empty `{{code}}` body param is
  emitted as `{ type: 'text', text: '' }`) and `:129` (`if (!couponCode) return undefined` — a dynamic URL button
  gets **no** parameter at all) → `infrastructure/kapso/template-client.ts:292` (`body: params.bodyParams`, passed
  through unfiltered).
- **Why it is realistic**: `wa-template-form-fields.tsx:43-44` advertises `{{code}}` as a standard variable
  ("Hello {{customer_name}}, your code is {{code}}"; "Variables: {{customer_name}}, {{code}}, {{discount}}"), and the
  campaign form leaves discount optional — `campaign-form-types.ts:72-79` yields `couponConfig: null` whenever
  `discountValue` is blank. Nothing in the form or `parse-create-body.ts:110-126` ties the two together.
- **Risk**: pre-fix such a campaign sent a real code (with a null-discount coupon and a doomed QR). Post-fix Meta
  rejects the payload (empty text parameter / parameter-count mismatch, the #132000/#132012 family) for **every**
  recipient → `SendFailedError` per member → `tally` counts all failed → run marked failed. Loud, but a regression
  for that configuration class, and none of the new tests can see it because `sendCampaignBody` is mocked at the
  module boundary (the "URL-button template with null couponConfig goes marketing-only" test asserts `'sent'` for a
  shape that would fail on the wire — see `principle_dead_plumbing_needs_boundary_assertion`, #127).
- **Fix (preferred)**: preflight in `src/app/api/dashboard/campaigns/[id]/execute/route.ts` next to
  `enforceHeaderMedia(template)` (`:68`) — and the cron equivalent — e.g. `enforceCouponParams(campaign, template)`:
  `if (campaign.couponConfig === null && !isClaimTemplate(template) && (extractParameters(template).includes('code') || hasDynamicUrlButton(template)))`
  → throw a typed error mapped to 409 with a message that names the mismatch ("template expects a coupon code but the
  campaign has no coupon config — add a discount or pick a template without {{code}}"). The card already renders the
  409 body via `readExecuteError` (#102). Add a route test for it.
- **Fix (minimum, if explicitly deferred to CAMP-004)**: (a) run the prod check before release —
  `select id, name from campaigns where coupon_config is null and whatsapp_template_id is not null and status = 'active'`
  and inspect those templates for `{{code}}` / `{{1}}`; (b) state the class in the PR/release note; (c) add one
  boundary test through the real `send-template-message` (not the mocked `sendCampaignBody`) pinning the payload
  currently produced for `code: ''` so the behaviour is at least declared, not accidental.

### I-2 — No debugging journal for #136 / #134

- **Where**: `debugging_journals/` has no 2026-08-28 entry; neither handoff mentions one.
- **Risk**: `rules/documentation.md` makes the journal mandatory after a bug fix; the same gap was flagged on #132
  (`reviews/2026-08-27-camp-004-quick-reply-analyzer`). #136 in particular is the second copy of a fire-and-forget
  `/execute` that #102 already fixed once — the anti-recurrence note ("any `/execute` call site must check the
  response; the card is the only trigger") is the whole point of the journal.
- **Fix**: `debugging_journals/2026-08-28-campaign-create-autosend-and-marketing-only-mint.md` (one file for the PR is
  fine): problem, root cause (default `execution: 'now'` + unchecked fetch; `sendEagerToMember` never branched on
  `couponConfig`), solution, prevention (I-1's preflight or its deferral, and the `{{code}}`/couponConfig coupling
  as a CAMP-004 input).

## 🟢 Minor (Optional)

- **M-1** `execute-campaign-broadcast.ts:71-102, 127-133` — the success tail (`incrementCampaignSent` + `emitEvent`)
  is now written three times; DRY's "third repetition" trigger is met. A `recordSent(member, ctx, couponCode?)` helper
  would also pull the file (199 lines, was 171 on develop — already over the 150 guideline) back toward the target.
  Surgical Changes wins for this PR; note it for the next touch of this file. Not a blocker.
- **M-2** `campaign-form-dialog.tsx:74-77` — the comment is changelog-style ("this call used to fire-and-forget…").
  History belongs in git/the journal; one line is enough: `// #136: no auto-execute — the card's Send Now is the only trigger.`
- **M-3** `execute-campaign-broadcast.test.ts` (new describe) — `renderTemplate` is module-mocked to `'desc'`, so
  nothing pins that `buildCouponDescription(member, ctx, '')` yields the announcement text for an inline campaign
  (and that a stray `{{code}}` renders as `''`, not `undefined`). A single test in a file that does not mock the
  renderer (or `vi.importActual`) would close it. Low risk: `template-renderer.ts:18-24` already maps nullish → `''`.
- **M-4 (pre-existing, out of scope — mention only)** the inline placeholders the campaign form advertises
  (`campaign-form-types.ts:19-24`: `{{contactName}}`, `{{couponCode}}`, `{{greeting}}`, `{{points}}`) do not match the
  keys the broadcast renderer supplies (`execute-campaign-broadcast.ts:194-198`: `name`, `code`, `discount`), so a promo
  body written with the advertised placeholders renders them blank. Not introduced or worsened here; worth a kanban item.
- **M-5 (pre-existing)** `react-hooks/set-state-in-effect` lint error at `campaign-form-dialog.tsx:100` — on develop
  already, correctly left alone.

## ✅ Strengths

- **#136 is fully closed server-side, not just client-side**: the only `addCampaignJob` callers are
  `[id]/execute/route.ts:70` and `api/cron/campaigns/route.ts:37`; `campaigns/route.ts` POST never enqueues;
  `getDueCampaigns` (`campaign-repository.ts:302-313`) requires `scheduled_at IS NOT NULL`, so a "Send manually"
  campaign sits idle. UX gap checked: `campaigns/page.tsx:47` and `:93` pass `onSuccess={refetch}`, and
  `campaign-card-view.tsx:56` shows Send Now for `status === 'active' && type !== 'welcome'` — the new card is
  actionable immediately after create.
- **No consumer of `dataJson.couponCode` on `campaign` events**: the only `dataJson` reader in the UI is
  `event-feed-item.tsx:32-33` (`amount` for `points`, snake-case `coupon_code` for `redeem`); no migration reads it.
  Emitting `{ campaignId }` only is the same shape the claim path has used since CAMP-001.
- **Marketing-only branch is structurally safe**: `sendMarketingOnlyToMember` takes no `prefetch`/`existing`, so a
  leftover pre-fix coupon can neither be reused nor trigger the `isCouponRedeemable` skip; AC4/AC5 pin both. Claim
  precedence is checked first (AC3). Counter + event still happen only after `throwIfNotOk`.
- **Re-run idempotency for coupon-less campaigns still holds** via `countedMemberIds` in
  `execute-campaign-batch.ts:119`, which runs before `sendToMember` regardless of mode.
- **Tests pin behaviour, not implementation**: `toStrictEqual({ campaignId })` proves the key is absent rather than
  unasserted; the frontend suite asserts call count + URL + method and the absence of any `/execute` URL; AC5
  documents the post-fix contract (`scheduledAt: null`, `status: 'active'`). Handoffs record red→green evidence.
- **Surgical**: 6 source lines net in the dialog, 1 label per locale, key and `'now'` state value untouched (the
  plan's ripple argument is right). Header comments updated to name the third mode.

## Open Questions

1. How many prod campaigns are in the I-1 class (`coupon_config IS NULL` + WhatsApp template using `{{code}}` or a
   dynamic URL button)? If zero, I-1 can be deferred to CAMP-004 with that evidence in the PR; if non-zero the
   preflight should ship with this PR.
2. Does the cron path (`api/cron/campaigns/route.ts`) share the execute route's enforce-* preflights? If not, any
   preflight added for I-1 needs to land in both (or in `execute-campaign.ts`), otherwise scheduled campaigns bypass it.

## Verdict: CONDITIONAL

Approve once I-1 is either fixed (preflight + route test) or explicitly deferred with the prod-data check and a
boundary test, and I-2 (journal) is written. No Critical findings; the feature is reachable and the diff is minimal.

## Next Steps

1. Backend dev (cold spawn): decide I-1 (fix vs. evidenced deferral) → implement → journal (I-2) → re-request review.
2. Optional in the same pass: M-2 comment trim, M-3 renderer test.
3. File a kanban item for M-4 (inline placeholder/renderer key mismatch).
