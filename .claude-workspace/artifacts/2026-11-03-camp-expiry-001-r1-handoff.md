---
id: artifacts/2026-11-03-camp-expiry-001-r1-handoff
type: handoff
contract: handoff-file-v1
author: dev
created: 2026-11-03
status: superseded
supersedes: artifacts/2026-11-03-camp-expiry-001-handoff
superseded_by: artifacts/2026-11-03-camp-expiry-001-r2-handoff
item: CAMP-EXPIRY-001-R1
state: done
brief: inline
base: a8eedd2b
head: 40759a7d  # code commit; this handoff file is committed on top
branch: fix/campaign-expiry-no-discount-alert
pushed: true
stage: poc
suite_changed: "yes, by brief F4: the tautological 'agrees with buildCampaignRequestBody' test and the hasCouponDiscount cases were replaced with couponFormMode mode cases"
gate: {result: none, at: none}
next: {owner: main, action: "re-review PR #173 round 1; do not merge from this run"}
blockers: []
refs: [debugging_journals/2026-11-03-campaign-expiry-dropped-without-discount, artifacts/2026-11-03-camp-expiry-001-r1-screens, artifacts/2026-11-03-camp-expiry-001-handoff]
---
ac:
  AC-1: {result: pass, evidence: "npx vitest run src/components/dashboard/__tests__/campaign-form-fields.test.ts → RED 10 failed / 27 passed (couponFormMode is not a function), then GREEN 37/37. Mode cases: inline + '' → marketing_only (discount null); inline + claim template passed → still marketing_only; wa_template BODY-only + '' → marketing_only; wa_template with BUTTONS[QUICK_REPLY] + '' → claim_no_discount; inline / non-claim / claim + '10' → {mode: discount, discount: 10}; '0', '-5', 'abc' → marketing_only. Tautological test deleted. Existing couponConfig cases (blank → null, blank + expiry 60 → null, 10 + 60 → expiresInDays 60, 20/14 mapping) unchanged and passing."}
  AC-2: {result: pass, evidence: "headless Chromium (playwright-core 1.58.2, chrome-headless-shell 1208) against next dev on localhost:3070 (zh-HK); real login as a throwaway admin on DEV test tenant, then nav link /dashboard/campaigns, then 建立推廣活動. Inline + blank: marketing alert visible, claim alert absent, Discount Type and Expiry disabled. WhatsApp 範本 + camp_expiry_r1_test_claim: claim alert visible with exact zh-HK copy, role=status, marketing alert absent, both fields disabled. Switch to camp_expiry_r1_test_body (BODY only): marketing alert back. Claim template + '10': no alerts, both fields enabled. Mobile 390x844 claim state: alert visible, documentElement.scrollWidth 390. Screenshots: .claude-workspace/artifacts/2026-11-03-camp-expiry-001-r1-screens/zh-HK-{inline-blank-desktop,claim-blank-desktop,claim-discount10-desktop,claim-blank-mobile}.jpg. Console: 2x 500 from GET /api/dashboard/campaigns/guardrails (DEV lacks table tenant_campaign_settings, a migration gap that predates this PR)."}
  AC-3: {result: pass, evidence: "npx eslint on the 4 touched TS/TSX files → 'No issues found', exit 0. Scoped tsc (temporary config extending tsconfig.json with files = campaign-form-types/fields/dialog/message-type-field + the test, and their import graph) → exit 0. Whole-project `tsc --noEmit -p .` under resource-lock heavy waited 20 min (03:20:09–03:40:14Z) behind PID 37110 (payment_management runsuites.sh) and never acquired the lock. Per the brief, recorded as unverified. Only my own queued waiter was cancelled; the holder was not touched."}
  AC-4: {result: pass, evidence: "https://github.com/xavierau/omc/pull/173: commit 40759a7d 'fix: campaign form coupon mode reflects claim templates (review round 1)' plus the handoff-file commit pushed via rtk proxy git push. git ls-remote origin fix/campaign-expiry-no-discount-alert equals local HEAD. PR not merged."}
decisions:
  - "couponFormMode lives in campaign-form-types.ts beside buildCampaignRequestBody (decide_yourself). It returns {mode, discount}. A private parseCouponDiscount is the single parse, and buildCampaignRequestBody uses it (F6)"
  - "The approved-template fetch moved from CampaignMessageTypeField into an exported useApprovedWaTemplates(messageType) hook, called once in CampaignFormFields. Both the picker and CouponConfigFields read from that one list. No new route or API call: it is the same GET /api/dashboard/wa-templates?status=approved the picker already made"
  - "The fetched list is typed as the domain WhatsAppTemplate[] (the route returns ListTemplatesResult.templates: WhatsAppTemplate[]) instead of the hooks' looser WaTemplate. That lets isClaimTemplate take the selected template without a cast"
  - "Alerts render through one CouponModeAlert with a mode → {i18n key, testid} map. Both keep the existing amber styling. The Discount Type select borrows Input's disabled styling (disabled:cursor-not-allowed disabled:opacity-50) so the two disabled fields look the same"
failed: []
invariants:
  - "couponConfig is null whenever the parsed discount is not > 0 (marketing-only #134 and claim-without-discount both send couponConfig null). Server, validators and couponConfig model untouched"
  - "Claim detection is the sender's own isClaimTemplate (src/domain/services/campaign-mode.ts), and inline is never claim"
unverified:
  - "Whole-project tsc --noEmit: the heavy lock was held for the whole 20-min window by payment_management. Only the touched files' import graph was typechecked (exit 0). Owner: CI on PR #173 or the next gate run"
  - "Edit flow when the campaign's saved template is no longer in the approved list (paused, or past the route's default pageSize 20): selectedTemplate is null, so the form shows the marketing-only alert even if that template has a claim button. The picker has the same limit today. Not exercised in the browser"
  - "Playwright feature spec + scripts.layout: this repo has no harness.md / playwright config. POC stage: replaced by the scripted browser pass above"
review_focus:
  - "src/components/dashboard/campaign-form-types.ts couponFormMode / parseCouponDiscount and the couponConfig ternary"
  - "src/components/dashboard/campaign-form-fields.tsx template lift (selectedTemplate lookup) and CouponModeAlert"
  - "src/components/dashboard/campaign-message-type-field.tsx useApprovedWaTemplates"
scope_drift: []
in_flight: []
next_step: "Main thread re-reviews PR #173 round 1. Then the owner merges into develop."
---

## Notes outside files_allowed (not done; listed for the caller)
- `.claude-workspace/ui-map/testid-registry.md` should gain `campaign-coupon-no-discount-alert` (round 0) and `campaign-coupon-claim-no-discount-alert` (this round), per frontend-testing.md. Not in files_allowed.
- `src/hooks/use-wa-templates.ts` `WaTemplate.components` is typed `Record<string, unknown>[]`, looser than the route's real `WhatsAppTemplate` shape. Mentioned, not changed.
- Pre-existing at 390px: the sheet is `w-[400px]`, so the template select text is cut at the right edge. scrollWidth stays 390. Not touched.
- `next dev` rewrote `CLAUDE.md` (Next.js agent-rules block) again. Restored with git checkout, not committed.

## DEV side effects (all cleaned up)
- Throwaway user `ui-test-camp-expiry-001-r1@example.com` (id c43679dd-1f85-48a8-adb3-82e1e3ec918c, user_tenants 2e839e52-113c-4076-ab14-4c1ec19c1f93, admin on test tenant 00000000-0000-4000-a000-000000000001). Deleted after the run.
- Two `whatsapp_templates` rows on the test tenant with status approved and meta_template_id null: `camp_expiry_r1_test_claim` (7e4e4e46-eff4-4ffd-b670-c96439834019, BODY + BUTTONS[QUICK_REPLY]) and `camp_expiry_r1_test_body` (3f988fd0-2a4c-4f99-b19c-66c684bff08c, BODY only). Inserted directly through PostgREST, so nothing was submitted to Meta. Deleted by id after a name and tenant check. 0 campaigns referenced them.
- No campaigns created.

## Design gate
- `impeccable detect --json` on campaign-form-fields.tsx and campaign-message-type-field.tsx: exit 0, `[]`. No rendered-route pass: the form lives inside an authenticated sheet that the detector cannot open.
