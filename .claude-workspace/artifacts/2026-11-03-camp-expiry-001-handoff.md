---
id: artifacts/2026-11-03-camp-expiry-001-handoff
type: handoff
contract: handoff-file-v1
author: dev
created: 2026-11-03
status: active
item: CAMP-EXPIRY-001
state: done
brief: inline
base: 07316f36
head: 8286d286
branch: fix/campaign-expiry-no-discount-alert
pushed: true
stage: poc
suite_changed: false
gate: {result: none, at: none}
next: {owner: none, action: "owner reviews PR against develop; do not merge from this run"}
blockers: []
refs: [debugging_journals/2026-11-03-campaign-expiry-dropped-without-discount, artifacts/2026-11-03-camp-expiry-001-screens]
---
ac:
  AC-1: {result: pass, evidence: "npx vitest run src/components/dashboard/__tests__/campaign-form-fields.test.ts → RED 6 failed/27 passed (hasCouponDiscount is not a function), then GREEN 33/33. Cases: predicate false for '', '0', '-5', 'abc'; true for '10'; agrees with buildCampaignRequestBody for '', '0', '0.5', '10', '-1'; blank discount + expiry 60 → couponConfig null; discount 10 + expiry 60 → expiresInDays 60"}
  AC-2: {result: pass, evidence: "headless Chromium (playwright-core 1.58.2, scratchpad) against next dev on localhost:3070 (zh-HK) and :3071 (en, NEXT_PUBLIC_DEFAULT_LOCALE=en), real login, then nav link /dashboard/campaigns, then Create Campaign. In both locales: blank and '0' → alert visible, role=status, exact brief copy, expiry disabled; '10' → alert hidden, expiry enabled; mobile 390x844 alert visible, documentElement.scrollWidth 390. Create with discount 10 + expiry 60 → POST 201, reopen shows discount 10 / expiry 60 (DB row coupon_config.expiresInDays=60 confirmed). Screenshots: .claude-workspace/artifacts/2026-11-03-camp-expiry-001-screens/{zh-HK,en}-{blank-desktop,discount10-desktop,blank-mobile,reopen-desktop}.jpg. Edit (PATCH) round-trip blocked by DEV DB: PATCH 500 'Could not find the failure_reason column of campaigns in the schema cache' (DEV migration gap, unrelated)."}
  AC-3: {result: pass, evidence: "npx eslint on the 3 touched TS files → 'No issues found', exit 0. Typecheck: tsc -p on a temporary config extending tsconfig.json with files = the 4 campaign-form files (types, fields, dialog, test) and their import graph → exit 0; a planted control error (boolean assigned to string) was caught (TS2322), so the scoped check works. The whole-project `tsc --noEmit -p .` under resource-lock heavy waited >11 min behind another agent's full gate (my-tasks: typecheck+lint+build+test+e2e) and was cancelled before it ran. Not run whole-project."}
  AC-4: {result: pass, evidence: "https://github.com/xavierau/omc/pull/173, base develop, title as briefed, body cites root cause + campaign 6fff0fa9, ends with attribution lines. Not merged."}
  AC-5: {result: pass, evidence: "debugging_journals/2026-11-03-campaign-expiry-dropped-without-discount.md"}
decisions:
  - "hasCouponDiscount takes Pick<CampaignFormState,'discountValue'> and is the single predicate for both buildCampaignRequestBody and CouponConfigFields — brief fixed item"
  - "Alert is a styled div copying campaign-guardrail-banner's amber classes (no Alert primitive in src/components/ui) — decide_yourself"
  - "Alert sits between Discount Value and Expiry inside the coupon fieldset, so it is next to the field it explains"
  - "Expiry is disabled but keeps its value. Re-entering a discount re-enables it with what the merchant typed"
invariants:
  - "couponConfig stays null when Number(discountValue) > 0 is false (marketing-only send, #134)"
unverified:
  - "Whole-project tsc --noEmit (heavy lock busy, cancelled). Only the touched files' import graph was typechecked. Owner: CI on PR #173 or the next gate run"
  - "Edit/PATCH save round-trip on a real DB: DEV lacks campaigns.failure_reason. Owner: whoever next syncs DEV migrations, or a prod smoke after release"
  - "Playwright feature spec + scripts.layout: this repo has no harness.md / playwright config. POC stage: replaced by the scripted browser pass above"
review_focus:
  - "src/components/dashboard/campaign-form-types.ts hasCouponDiscount + couponConfig ternary"
  - "src/components/dashboard/campaign-form-fields.tsx CouponConfigFields alert + disabled expiry"
scope_drift: []
in_flight: []
next_step: "Owner reviews and merges the PR into develop, then releases to prod."
---

## Notes outside files_allowed (not done; listed for the caller)
- `.claude-workspace/ui-map/testid-registry.md` should gain `campaign-coupon-no-discount-alert` (rule frontend-testing.md). It is not in files_allowed, so it was left for the caller.
- `.claude-workspace/poc-log.md` entry and the INDEX.md line: not in files_allowed.
- `next dev` rewrote `CLAUDE.md` (Next.js agent-rules block). The file was restored and not committed.

## DEV side effects (all cleaned up)
- Minted throwaway user `ui-test-camp-expiry-001@example.com` (id 10c8d4e0-…, role admin on test tenant 00000000-0000-4000-a000-000000000001) per env-policy.md. Deleted after the run, together with its user_tenants row 233af35c-….
- Created 3 campaigns named `CAMP-EXPIRY-001 test <ts>` (343c9a40, 4e98c578, 3e2cd6bc) on the test tenant. All deleted by id after a name and tenant check.
