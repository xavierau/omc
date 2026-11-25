---
id: reviews/2026-11-25-agent-006-re-review
type: review
author: verifier
mode: re-review
created: 2026-11-25
status: active
supersedes: null
superseded_by: null
related: [artifacts/2026-11-25-agent-006-handoff, artifacts/2026-11-25-agent-006-fix1-handoff, artifacts/2026-11-25-agent-006-campaign-context-impl, tests/2026-11-25-agent-006/fix1-ac3-README, github:229]
---
# Code Review: AGENT-006 fix round 1 re-review (PR #229, get_recent_campaigns)

## Summary

Scope: range `c37fdba0..997b90c4` in `/Users/xavierau/Code/js/whatsapp-crm--agent-006`. The worktree HEAD is `997b90c4`, which equals the PR #229 head (`gh pr view 229`: headRefOid 997b90c4, base develop, OPEN, MERGEABLE). The prior findings F1–F5 came from `/code-review` and have no review artifact, so this review supersedes nothing (`supersedes: null`).

All five findings are fixed in the tree. Tenant and member scoping holds on every query, and the executor ignores model arguments, so there is no leak path. The fix round adds no critical defect. It leaves one Important gap: a template campaign whose only accepted row is the coupon-QR image is shown with the campaign's inline text, which the diner never received (N1). There are four Minor items. AC-4: the four test files pass, 45/45, exit 0 at 997b90c4.

Fixed per brief and not reopened: tool-call delivery, the window (≤3 campaigns / 30 days), the status set sent|delivered|read, and no migration.

### AC-1: F1–F5 status

| F | Finding | Status | Evidence |
|---|---|---|---|
| F1 | An inline-text campaign returned empty text | **fixed** | `agent-campaign-repository.ts:129-132` `inlineContent` runs `resolveLocalizedTemplate` over `template_en` / `template_zh_hk` / legacy `template` (selected at `:90`). The language comes from `:123-127` `sendLanguage`: member `preferred_language`, then `restaurants.default_language` (read only when the member value is invalid, `:124-125`), then zh_hk via `resolvePreferredLanguage`. This is the same chain as `execute-campaign-broadcast.ts:178-181` (`buildCouponDescription` → `resolveCampaignTemplate`). Tests: `agent-campaign-repository.test.ts:109-136` cover all six language and column cases, and that the restaurant read is skipped when the member has a language. |
| F2 | A template edited in place after the send (TPL-012); fallback to `campaigns.whatsapp_template_id` | **fixed** | The fallback is gone: the campaigns select (`:90`) no longer reads `whatsapp_template_id`. The template comes only from a send's own `template_id` (`:72`, `:79`). `editedAfterSend` is set at `:134-137`, comparing `whatsapp_templates.updated_at` with the `queued_at` of the newest send that carried the template (newest-first fold, `:75-85`). The skill rule is at `campaigns-skill.ts:22` and the tool description at `agent-tools.ts:52-55`. Tests: repo `:138-150` (no fallback, no templates query), `:152-174` (flag true/false, and the later QR row is not the reference); skill test asserts the rule wording. Prod check: the flag fires on 0 of 6,568 sends over 90 days (`tests/2026-11-25-agent-006/fix1-ac3-README.md`, the dev's numbers, not re-run). |
| F3 | URL buttons with `{{` placeholders exposed the raw URL | **fixed** | `agent-campaign-tool.ts:31-36`: `button.url?.includes('{{')` → `Button "<text>": personal link in the diner's message`. Static URLs and phone numbers are kept; quick-reply buttons are dropped. Test: `agent-tools.test.ts` "returns {sentAt, templateText, editedAfterSend}" (`Book now` → the note). |
| F4 | The internal `campaigns.name` reached the model | **fixed** | `AgentRecentCampaign` (`agent-campaign-tool.ts:21-26`) has only `sentAt`, `templateText`, `editedAfterSend`. The campaigns select (`agent-campaign-repository.ts:90`) does not read `name`. Tests: `expect(JSON.stringify(out)).not.toContain('campaignName')`, and the declaration test checks the description does not mention a campaign name. |
| F5 | The 1500-char cut could split a surrogate pair | **fixed** | `agent-campaign-tool.ts:46-48`: `Array.from(text).slice(0, 1500).join('')` cuts by code points. It applies to both content kinds (`:55-56`). Tests: the 4000×x, 1499+🍶 and 酒×1499+🍶🍶 cases, with no lone high surrogate at the end. |

### AC-2: scoping (full range)

| # | Query (`agent-campaign-repository.ts`) | Scope | Source of the scope value |
|---|---|---|---|
| 1 | `members` `:46-51` | `restaurant_id = key.restaurantId`, `phone = key.phone` | `ctx.key` (job) |
| 2 | `whatsapp_messages` `:57-67` | `restaurant_id`, `member_id = member.id` (from #1), outbound, campaign_id not null, status in sent/delivered/read, `queued_at >= sinceIso`, limit 50 | `ctx.key` + #1 |
| 3 | `campaigns` `:88-92` | `restaurant_id`, `id in` the ids from #2 | `ctx.key` |
| 4 | `whatsapp_templates` `:99-103` | `restaurant_id`, `id in` the template ids from #2 | `ctx.key` |
| 5 | `restaurants` `:117` | `id = key.restaurantId` | `ctx.key` |

- Executor: `agent-tools.ts:123-124` calls `getRecentCampaigns(ctx.key, ctx.now(), ctx.data)`. `args` is never read. The offered-tools gate runs first (`:143-144`).
- The declaration has no `parameters` (`agent-tools.ts:52-55`; the test asserts the keys are exactly `name`, `description`).
- `agent-tools.test.ts` passes `{phone, restaurantId:'rest-b', member_id, limit:50}`, and the call record shows `rest-a:+85291234567:…:3`. The window and cap are computed in `agent-campaign-tool.ts:69-71`, and the result is capped again with `slice(0, 3)`.
- A cross-tenant `template_id` or `campaign_id` on a send is dropped by queries #3 and #4 (`:164-167`; the repo test at `:176-188`).
- Column existence is checked by `agent-schema-contract.test.ts`, which covers all five tables plus filter columns for this file.

**No leak path found.**

### AC-4

`npx vitest run` over the four named files at 997b90c4: **Test Files 4 passed, Tests 45 passed, exit 0** (run 2026-11-25 12:17).

## 🔴 Critical (Must Fix)

None.

## 🟡 Important (Should Fix)

**N1: A template campaign seen only through its coupon-QR row is reported as inline text the diner never received.** `agent-campaign-repository.ts:72`, `:149`

- **Problem:** `content.kind` is chosen by whether any *accepted* row of the campaign carried a `template_id`. In eager mode the body (template) send and the QR image (`template_id` null, `execute-campaign-send.ts:68-89`) are separate rows. Suppose the body row later goes `failed` through the async status webhook while the QR image is `delivered`. This can happen when Meta rejects a marketing template asynchronously (for example 131049) and the diner has an open 24 h window, so the service image still lands. Then the only accepted row carries no template, and `inlineContent` returns the campaign's `template_zh_hk` / `template_en`. A template campaign can have those columns filled: `buildCouponDescription` reads them for every mode.
- **Risk:** the agent quotes a price or offer from text the diner never saw. That is the misquote the brief's intent names. Round 1 fell back to the campaign's current template here, so this is a remaining gap in the F1/F2 split, not a new leak. Today's prod data shows 0 accepted QR rows in 60 days (all 250 are failed), so the exposure is latent.
- **Fix:** select `message_type` on the sends and treat a campaign as inline text only when an accepted `text` row exists. A campaign whose accepted rows are all `image` should be skipped, or returned with an explicit "only the coupon code image was delivered" note.
- **How to show it fails:** repo test with `whatsapp_messages` = [`send('c-1', t, null)`] (the QR row; the failed body row is excluded by the status filter) and `campaigns` = [`{id:'c-1', ...INLINE('每位 HK$680', 'HK$680 pp')}`]. Today it returns `{kind:'text', text:'HK$680 pp'}`.

## 🟢 Minor (Optional)

- **M1: A missing template yields an empty, unflagged campaign.** `agent-campaign-repository.ts:134-136`. When the carried `template_id` is not returned (hard-deleted, or another tenant's id dropped by scope), `stored` is undefined, so `components: []` and `editedAfterSend: false`. The model gets an empty `templateText` that claims to be unedited. A soft delete moves `updated_at`, so that case is flagged correctly. Fix: set `editedAfterSend: true` (or drop the item) when `stored` is undefined. Show it: the repo test's `t-4`-style template absent within the limit → `{components: [], editedAfterSend: false}`.
- **M2: The language is resolved now, not at send time.** `:123-127`. If the member changed `preferred_language` after the send, the agent reads the other language's version of the same campaign. The prices are normally the same; low risk. No fix needed for POC.
- **M3: Duplicated language-code knowledge.** `:124` hardcodes `'en' | 'zh_hk'` to skip the restaurant read; `Language.fromCodeOrDefault` has the same set. A third language would silently skip the restaurant default. Could use `Language.fromCodeOrDefault(code, null)`-style parsing, or accept it as a deliberate saving of one query.
- **M4: Inline placeholders are not rendered.** The inline send renders `{{name}}`, `{{code}}` and `{{discount}}` (`execute-campaign-broadcast.ts:188-200`), and falls back to `campaign.name` when the rendered text is blank. The agent gets the raw text, and the skill (`campaigns-skill.ts:21`) forbids quoting `{{…}}`, so the agent cannot state the discount the diner saw. This is the safe direction and consistent with F4; listed for awareness only.

### AC-3: new defects from the fix round, by area

- **Language resolution:** parity with the broadcast confirmed (above). See M2 and M3.
- **`editedAfterSend` reference time:** the newest send carrying the template is the right reference, because an older send's version was superseded by what the newest send carried. `queued_at` comes before the actual Kapso send, so an edit between queue and send gives a false positive. That errs safe. The `updated_at` trigger fires on status-only updates too (fix1-ac3-README), which also errs safe. The webhook and cron skip no-op writes, which the dev cites; I did not re-verify it. Fractional microseconds parse in `Date.parse` (the test at `:166` uses `+00:00` with 6 decimal places and passes). No defect.
- **Union port type handling:** `AgentCampaignContent` (`agent-reply.ts`) is discriminated on `kind`. `toRecent` (`agent-campaign-tool.ts:58-62`) narrows it correctly, and `editedAfterSend` is false for `text`. The fake was updated (`agent-fakes.ts`). No defect. Whole-project `tsc` was not re-run by me; the dev's gate log `fix1-ac2-gate.log` reports exit 0.
- **`parse-schema.ts` test-helper change** (`__tests__/schema-contract/parse-schema.ts:79-86`):
  - The new regex reads every `ADD COLUMN` inside one `ALTER TABLE <t> …;` statement. I compared it with the old regex across all migrations. The new one finds 22 extra columns on 7 tables, for example `campaigns.template_zh_hk`, `image_url_zh_hk`, `audience_lapsed_days`; `members.unreachable_at`; `restaurants.redirect_label`.
  - I spot-checked 7 of them. Each is a genuine second or later `ADD COLUMN` in a comma-separated ALTER (029, 032, 036, 042, 047, 054, 086).
  - So the change fixes a real false negative and adds no false positive.
  - Theoretical edge: a statement missing its `;` would let `[^;]*` run into the next statement. No such case was found in the comparison. No defect.
- **N1 and M1** are the only new correctness items.

## ✅ Strengths

- Five separate queries, each scoped by restaurant, instead of embeds (memory principle_authorize_by_scoped_query). The member id comes from a phone-and-restaurant lookup, never from the model.
- The fold keeps one row per campaign and takes the template from any of that campaign's sends (`??=`), so the later QR row does not hide the body's template. Tested.
- `editedAfterSend` errs toward caution, and the prod numbers show the flag is not noise.
- Tests assert the recorded filter lists exactly, not only the output, which is what proves the scoping.

## Open Questions

- TPL-012 in-place edits of a Meta-linked template: while Meta reviews the edit, does a send deliver the old approved version while the local row already holds the new components? If so, sends queued during review carry `updated_at < queued_at`, so they are not flagged, yet the stored components differ from what Meta delivered. I did not verify Meta's behaviour; it is a question for the plan or main thread, not a finding.

## Verdict: APPROVED

No open 🔴. F1–F5 are fixed with tests, scoping is sound, and AC-4 is green. N1 is 🟡 and latent on today's prod data (0 accepted QR-only rows), so it can merge into develop. N1 is recommended as a follow-up before inline or eager campaigns run with open-window diners.

## Next Steps

1. Main thread: merge PR #229 into develop (not low-risk-auto: it changes src).
2. Optional follow-up item for N1 (select `message_type`; inline only for an accepted `text` row) and M1 (flag or drop when the carried template is missing).
3. Release step from round 1 is unchanged: restart the worker, then tick 最近的推廣.
