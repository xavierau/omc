---
id: artifacts/2026-11-03-camp-expiry-001-r2-handoff
type: handoff
contract: handoff-file-v1
author: dev
created: 2026-11-03
status: active
supersedes: artifacts/2026-11-03-camp-expiry-001-r1-handoff
superseded_by: null
item: CAMP-EXPIRY-001-R2
state: done
brief: inline
base: 65c68e88
head: 5a16f48b  # code commit; this handoff file is committed on top
branch: fix/campaign-expiry-no-discount-alert
pushed: true
stage: poc
suite_changed: "yes, per brief: the round-1 couponFormMode cases were rewritten for the new modes (claim_no_discount removed; blocked and unknown added). A new domain suite src/domain/services/__tests__/coupon-requirement.test.ts was added. enforce-coupon-params.test.ts was not touched."
gate: {result: none, at: none}
next: {owner: main, action: "re-review PR #173 round 2; do not merge from this run"}
blockers: []
refs: [debugging_journals/2026-11-03-campaign-expiry-dropped-without-discount, artifacts/2026-11-03-camp-expiry-001-r2-screens, artifacts/2026-11-03-camp-expiry-001-r1-handoff]
---
ac:
  AC-1: {result: pass, evidence: "npx vitest run src/application/__tests__/enforce-coupon-params.test.ts → 13/13. git diff 65c68e88..HEAD on that file has 0 lines. Indirect consumers also pass: execute-campaign.test.ts + campaign-queue.test.ts 67/67, the campaigns/[id]/execute route tests 15/15."}
  AC-2: {result: pass, evidence: "RED first: the new domain suite failed because the module did not exist, and 3 form-adapter cases failed (blocked, inline {{couponCode}}, unknown). GREEN: npx vitest run src/domain/services/__tests__ src/components/dashboard/__tests__/campaign-form-fields.test.ts → 588/588. Domain cases: config set → satisfied (also for a claim template or {{code}} copy); QUICK_REPLY → blocked claim, subject = template name; {{code}} body, {{discount}} body, dynamic URL {{1}}, COPY_CODE → blocked template; nov_promo_2026 shape (IMAGE header + plain BODY) → marketing_only; static URL button → marketing_only; inline {{couponCode}}/{{code}}/{{discount}} → blocked inline, subject = the placeholder; plain inline → marketing_only; a template given → inline texts ignored. Form adapter: plain inline → marketing_only; inline {{couponCode}} → blocked; wa_template + claim → blocked; wa_template + BODY-only → marketing_only, even with leftover {{couponCode}} inline text; wa_template with unresolved template → unknown; '10' → discount in every case, including an unresolved template; '0', '-5', 'abc' → no discount."}
  AC-3: {result: pass, evidence: "headless Chromium (playwright-core 1.58.2, chrome-headless-shell 1208) against next dev on localhost:3070 (zh-HK). Real login as a throwaway admin on DEV test tenant, then nav link /dashboard/campaigns, then 建立推廣活動. Plain inline copy + blank discount: marketing notice shown, blocked notice absent, Discount Type enabled (switched to fixed_amount and back), Expiry disabled. Inline copy with {{couponCode}} + blank: blocked notice, role=status, exact zh-HK copy, marketing notice absent. WhatsApp 範本 with no template chosen: no notice (unknown). camp_expiry_r2_test_claim + blank: blocked notice. camp_expiry_r2_test_body (BODY only) + blank: marketing notice. Claim + '10': no notice, Expiry enabled. Mobile 390x844 claim + blank: blocked notice visible, documentElement.scrollWidth 390. The old testid campaign-coupon-claim-no-discount-alert was absent in every state. Discount Type was enabled in every state. Screenshots: .claude-workspace/artifacts/2026-11-03-camp-expiry-001-r2-screens/zh-HK-{inline-plain-blank-desktop,inline-couponcode-blank-desktop,claim-blank-desktop,claim-discount10-desktop,claim-blank-mobile}.jpg. Console: 2x 500 from GET /api/dashboard/campaigns/guardrails (DEV is missing the tenant_campaign_settings table; this gap predates the PR). GET /api/dashboard/wa-templates?status=approved returned 200. All DEV rows were deleted afterwards (see DEV side effects)."}
  AC-4: {result: pass, evidence: "python3 ~/.claude/bin/resource-lock.py heavy -- npx tsc --noEmit -p . waited briefly behind PID 75300 (payment_management typecheck), then exited 0 with no diagnostics (04:30:47–04:31:21Z). eslint on the 8 touched TS/TSX files: 2 errors, both in src/hooks/use-wa-templates.ts (react-hooks/preserve-manual-memoization at the useCallback and react-hooks/set-state-in-effect at the useEffect). Both are pre-existing: linting the base 65c68e88 copy of the file gives the same 2 rules. No new errors. The other 7 files are clean. Scoped tsc (the touched files + wa-templates/page.tsx, execute-campaign.ts, the execute route, and their import graph) exited 0."}
  AC-5: {result: pass, evidence: "https://github.com/xavierau/omc/pull/173: commit 5a16f48b 'fix: campaign form coupon notices mirror enforceCouponParams via shared domain rule (review round 2)', plus the handoff-file commit, pushed with rtk proxy git push. git ls-remote origin fix/campaign-expiry-no-discount-alert equals local HEAD. PR not merged."}
decisions:
  - "Domain function: couponRequirement({ hasCouponConfig, template, inlineTexts }) → satisfied | marketing_only | blocked{reason, subject}, in a new file src/domain/services/coupon-requirement.ts. It sits beside campaign-mode.ts and reuses its isClaimTemplate and templateExpectsCouponCode. INLINE_COUPON_PLACEHOLDERS moved there and is exported. Check order matches the old guard: config → inline (template null) → claim → template-expects-code."
  - "enforceCouponParams passes inlineTexts [templateEn, templateZhHk, template (legacy)], the same three fields as before. The form passes [templateEn, templateZhHk] only when messageType is inline, and [] for wa_template. The form has no legacy template field."
  - "unknown = wa_template, no discount, and no resolved template object. That covers 'no template chosen yet' as well as loading, failed fetch, and not in the loaded page. A discount > 0 always gives 'discount' (the server is satisfied whatever the template is)."
  - "useWaTemplates gained two things, both defaulting to today's behaviour. A type parameter <T = WaTemplate> lets the form type the list as the domain WhatsAppTemplate, which is what the route returns; WaTemplate.components is too loose for the domain rule. An options.enabled flag (default true; isLoading starts as enabled) stops inline forms from fetching. The only other caller is the wa-templates page, which passes neither argument."
  - "The selected-template lookup and the template list stay in CampaignFormFields, which passes them to the picker and the coupon fields. CampaignMessageTypeField's useApprovedWaTemplates and its useState/useEffect imports were deleted."
failed: []
invariants:
  - "Whether a campaign without a coupon config is refused is decided only in couponRequirement. The server guard and the form both call it."
  - "couponConfig is null whenever the parsed discount is not > 0. Server, validators, couponConfig model and the 0/blank → 30 expiry coercion were not touched."
unverified:
  - "Edit flow when the campaign's saved template is not in the approved list (paused, or past the route's default page size of 20): the form now shows no coupon notice (unknown) instead of guessing. This is the intended behaviour, but it was not exercised in the browser."
  - "Playwright feature spec + scripts.layout: this repo has no harness.md or Playwright config. At POC stage the scripted browser pass above replaces them."
review_focus:
  - "src/domain/services/coupon-requirement.ts (rule order, inline placeholder scan) and the enforce-coupon-params.ts refactor"
  - "src/components/dashboard/campaign-form-types.ts couponFormMode: the unknown guard and the inlineTexts selection"
  - "src/hooks/use-wa-templates.ts: the type parameter and enabled flag, defaults unchanged for the wa-templates page"
scope_drift: []
in_flight: []
next_step: "Main thread re-reviews PR #173 round 2. Then the owner merges into develop."
---

## Notes outside files_allowed (not done; listed for the caller)
- `.claude-workspace/ui-map/testid-registry.md` should list `campaign-coupon-no-discount-alert` and `campaign-coupon-blocked-alert`. The round-1 id `campaign-coupon-claim-no-discount-alert` was removed and never registered. Not in files_allowed.
- `.claude-workspace/INDEX.md` has no entries for the CAMP-EXPIRY-001 handoffs (rounds 0–2). Not in files_allowed.
- The 2 pre-existing react-hooks lint errors in `src/hooks/use-wa-templates.ts` are mentioned, not fixed.
- `next dev` rewrote `CLAUDE.md` (Next.js agent-rules block) again. Restored with git checkout, not committed.

## DEV side effects (all cleaned up)
- Throwaway user `ui-test-camp-expiry-001-r2@example.com` (id 488669a3-ce81-4a02-9352-995f0459b8f8, user_tenants ff195d2e-a6a9-46ba-906c-694ea6047744, admin on test tenant 00000000-0000-4000-a000-000000000001).
- Two `whatsapp_templates` rows on the test tenant, status approved, meta_template_id null: `camp_expiry_r2_test_claim` (60dee1f6-8556-46e4-966d-ad0889c487ea, BODY + BUTTONS[QUICK_REPLY]) and `camp_expiry_r2_test_body` (923bccd8-7554-4e0f-8f4f-2f4246eff864, BODY only). Inserted through PostgREST, so nothing went to Meta.
- Cleanup: both templates deleted by id after a name and tenant check (0 campaigns referenced them), then the user_tenants row and the auth user. No campaigns were created.

## Design gate
- `impeccable detect --json` on campaign-form-fields.tsx and campaign-message-type-field.tsx: exit 0, `[]`. No rendered-route pass: the form is inside an authenticated sheet that the detector cannot open.
