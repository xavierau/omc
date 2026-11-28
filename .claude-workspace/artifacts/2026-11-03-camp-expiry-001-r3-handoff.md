---
id: artifacts/2026-11-03-camp-expiry-001-r3-handoff
type: handoff
contract: handoff-file-v1
author: dev
created: 2026-11-03
status: active
supersedes: artifacts/2026-11-03-camp-expiry-001-r2-handoff
superseded_by: null
item: CAMP-EXPIRY-001-R3
state: done
brief: inline (r3, amended by ruling r3.1)
base: 6d8559a4
head: a9769a46  # code commit; this handoff file is committed on top
branch: fix/campaign-expiry-no-discount-alert
pushed: true
stage: poc
suite_changed: "yes, per brief. The round-2 couponFormMode cases were rewritten: the second argument is now a TemplateLookup, and the result carries only mode (+ pending for unknown); the discount field is gone. Added: the welcome cases, templateLookup/singleTemplateIdToFetch/pickerTemplates cases, and a new src/hooks/__tests__/use-wa-templates.test.ts (store, view, targets, parse point). enforce-coupon-params.test.ts was not touched (0-line diff vs base)."
gate: {result: none, at: none}
next: {owner: main, action: "final re-review of PR #173 (round 3); do not merge from this run"}
blockers: []
refs: [artifacts/2026-11-03-camp-expiry-001-r3-screens, artifacts/2026-11-03-camp-expiry-001-r2-handoff, debugging_journals/2026-11-03-campaign-expiry-dropped-without-discount]
---
ac:
  AC-1: {result: pass, evidence: "RED first: 46 of 75 failing (missing exports, new modes). GREEN: npx vitest run src/components/dashboard/__tests__/campaign-form-fields.test.ts src/hooks/__tests__ src/application/__tests__/enforce-coupon-params.test.ts → 15 files, 237/237. Covered: welcome + blank → welcome_requires_discount (inline plain, inline {{couponCode}}, claim template, template still loading, '0'); validateCampaignForm → welcomeDiscountRequired; welcome + 10 → discount, valid, couponConfig 10; promo + blank still valid. A template not in the list page → singleTemplateIdToFetch returns its id → resolved → claim gives blocked (not unknown). Stale response ignored (slow A resolves after B; state stays B); previous signal aborted on a new load and on destroy; a late response after destroy is dropped; failure after an earlier success clears data to [] and sets error; load(null) does not fetch and isLoading is false; templateListTarget(null, …) is null. enforce-coupon-params.test.ts: 0-line diff vs 6d8559a4, passing. Ruling r3.1 extras: template-review-submit 10/10, wa-template-form-types + wa-template-table + buttons-section + form-fields + submit all pass."}
  AC-2: {result: pass, evidence: "Headless Chromium (playwright-core from oma/e2e, chrome-headless-shell 1208) against next dev localhost:3070, zh-HK, with a real login as a throwaway admin on the DEV test tenant, then the nav link to /dashboard/campaigns, then 建立推廣活動. Welcome + blank discount: the notice has the exact zh-HK copy and role=status, and Expiry is disabled. Clicking 建立 shows 迎新推廣必須設定折扣數值。; there were 0 POST/PATCH to /api/dashboard/campaigns and the sheet stayed open. Welcome + claim template + blank: still the welcome notice. '10': notice gone, Expiry enabled. Mobile 390x844: notice visible, scrollWidth 390. Edit flow on a saved promo campaign (claim template, blank discount), with the list response intercepted to drop the claim template and the single GET delayed 2.5 s: campaign-coupon-mode-checking '正在檢查範本…' visible, then 1 GET /api/dashboard/wa-templates/<id>, then the blocked notice, picker value = claim id. Single GET forced to 500: campaign-coupon-mode-error '無法載入範本，未能檢查優惠券設定。'. Screenshots: .claude-workspace/artifacts/2026-11-03-camp-expiry-001-r3-screens/zh-HK-{welcome-blank-desktop,welcome-blank-save-desktop,welcome-blank-mobile,edit-checking-desktop,edit-beyond-list-blocked-desktop,edit-template-error-desktop}.jpg. Console errors: GET /api/dashboard/campaigns/guardrails 500 (the DEV gap noted in r2, from before this PR) plus the one deliberately injected 500. DEV rows were deleted afterwards (see DEV side effects)."}
  AC-3: {result: pass, evidence: "python3 ~/.claude/bin/resource-lock.py heavy -- npx tsc --noEmit -p . → exit 0 (second run; the first found TS2353 in template-review-submit.test.ts, fixed, see decisions). npx eslint on the 7 touched TS/TSX files → no output. The 2 react-hooks errors that use-wa-templates.ts had before are gone."}
  AC-4: {result: pass, evidence: "https://github.com/xavierau/omc/pull/173: commit a9769a46 'fix: campaign form — welcome requires discount, resolve template beyond first page, race-safe templates hook (review round 3)', pushed with rtk proxy git push. git ls-remote origin fix/campaign-expiry-no-discount-alert = a9769a46b89e7c934196e0ce0137b1d97d811fa0 = local HEAD at push time. PR body rewritten with gh pr edit (mode table, shared rule, round-3 verification, follow-up: the server still accepts a welcome campaign with no discount), attribution footer kept. State OPEN, not merged."}
decisions:
  - "Ruling r3.1 (main, mid-run): src/components/dashboard/template-review-submit.ts added to files_allowed, only to widen extractTemplateBodyText's param; WaTemplate = Pick<WhatsAppTemplate, id|name|language|category|status|components|createdAt> & { rejectionReason?: string | null }; templateToFormState widened the same way."
  - "Deviation from the literal ruling type: extractTemplateBodyText takes ReadonlyArray<{ type?: unknown; text?: unknown } | Record<string, unknown>>. The bare { type?, text? } failed whole-project tsc with TS2353 in template-review-submit.test.ts (outside files_allowed): a fresh literal with `format` is an excess property. The union admits it. Still only a widening, with no behaviour change."
  - "templateToFormState takes components: ReadonlyArray<{ type?: unknown; text?: unknown }> and reads each one through Object.fromEntries(Object.entries(component)). That keeps extractMediaUrl/parseButtons and wa-template-form-types.test.ts (outside files_allowed) unchanged, with no cast. A shallow copy per component; parseButtons' raw button objects are the originals."
  - "R3-2: the existing single-template route GET /api/dashboard/wa-templates/[id] (tenant-scoped, any status) is used through a new useWaTemplate(id). singleTemplateIdToFetch fires only when wa_template is selected, an id is set, the list has finished loading, and the id is not in it. templateLookup order: unselected → listed → (list or single loading) → single result whose id matches → error/loading."
  - "pickerTemplates adds a template resolved individually to the picker options. Without it, a controlled <select> whose value is not in the options shows the placeholder, and the user would see '選擇範本…' next to a notice about the template. Traces to R3-2."
  - "R3-3: the request store follows use-tag-recipient-count.ts (no React renderer in the repo). The key is tenant + url, so a tenant switch never shows the old rows. Same-key refetch keeps the rows on screen while loading; a new key starts empty. viewRequest reports isLoading true for a target the store has not started yet, so the first render is 'loading', not an empty list. refetch now returns void (callers: wa-templates page, without await)."
  - "R3-5: CouponFormModeResult = { mode } | { mode: 'unknown'; pending: 'loading'|'error'|'unselected' }; the discount field was dropped (nothing read it). parseCouponDiscount stays the single 'has discount' helper, used by couponFormMode, buildCampaignRequestBody and validateCampaignForm."
  - "validateCampaignForm order: name → tag → welcomeDiscountRequired → template."
failed:
  - "The first browser walk timed out on the card's edit control: getByRole('button', { name: '編輯' }) found nothing because the pencil button has no accessible name. Re-ran the edit section with button:has(svg.lucide-pencil). That control's missing aria-label is pre-existing and not fixed."
invariants:
  - "Whether a campaign without a coupon config is refused is still decided only in couponRequirement. The welcome rule is form-only (save-time), per the brief."
  - "The server, validators, enforceCouponParams and the welcome send path are untouched."
unverified:
  - "The server still accepts a welcome campaign with no discount through POST/PATCH (API, or rows that already exist). It is in the PR follow-up and out of scope."
  - "Playwright feature spec + scripts.layout: this repo has no harness.md. At POC stage the scripted browser pass replaces them."
  - "The en copy was not exercised in the browser, only zh-HK. The en strings were checked by JSON parse and key presence."
review_focus:
  - "src/hooks/use-wa-templates.ts: createRequestStore (generation/abort), viewRequest, the parse point"
  - "src/components/dashboard/campaign-form-types.ts: templateLookup order, couponFormMode welcome-first check"
  - "src/components/dashboard/template-review-submit.ts: the union param (deviation from the ruling's literal type)"
scope_drift: []
in_flight: []
next_step: "Main thread runs the final re-review of PR #173; the owner merges into develop."
---

## Notes outside files_allowed (not done; listed for the caller)
- `.claude-workspace/INDEX.md` still has no CAMP-EXPIRY-001 handoff entries (rounds 0–3).
- `.claude-workspace/poc-log.md` has no entry for this slice.
- The campaign card's pencil edit button (`campaign-card-view.tsx:67`) has no accessible name.
- `next dev` rewrote `CLAUDE.md` again. Restored with git checkout, not committed.

## DEV side effects (all cleaned up)
- Throwaway user `ui-test-camp-expiry-001-r3@example.com` (id 1ec4c8b3-9ee4-40e9-9379-69308167e7b5, user_tenants e1c096e3-4833-44c7-8ee4-2c73c73a4de9, admin on test tenant 00000000-0000-4000-a000-000000000001).
- Templates `camp_expiry_r3_test_claim` (43a4fca4-58a4-44f7-8ddb-560c5526e631) and `camp_expiry_r3_test_body` (78017c6c-8a60-42c5-a717-4d7c2f11a5b7), status approved, inserted through PostgREST, so nothing went to Meta.
- One campaign `camp-expiry-r3-test-edit` (f65fd516-7d04-4736-adef-273be7ca91f1, promo, claim template, couponConfig null), created through the form and never sent.
- Cleanup order: the campaign (exact name + run template ids; aborts if a foreign campaign references them), the templates (name + tenant check), user_tenants, the auth user. Leftover check: 0 r3 campaigns.

## Design gate
- `impeccable detect --json` on campaign-form-fields.tsx and campaign-message-type-field.tsx: exit 0, `[]`. No rendered-route pass: the form is inside an authenticated sheet.
